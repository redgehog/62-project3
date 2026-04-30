// Customer ordering kiosk
import { useState, useEffect, useContext } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/customer";
import pool from "../db.server";
import type { PoolClient } from "pg";
import { translateText, MAJOR_LANGUAGES, type LanguageCode } from "../translate";
import { applyTax } from "../lib/pricing";
import { qrCodeUrl, receiptQrData } from "../lib/qr";
import { TranslationContext } from "../root";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Order — Boba House" }];
}

const MILK_TYPES        = ["Whole Milk", "Oat Milk", "Almond Milk", "Soy Milk", "No Milk"];
const ICE_LEVELS        = ["No Ice", "Less Ice", "Regular", "Extra Ice"];
const SWEETNESS_OPTIONS = [25, 50, 75, 100, 125];

const SIZES = [
  { value: "Regular" as const, oz: "16oz", upcharge: 0.00 },
  { value: "Large"   as const, oz: "24oz", upcharge: 1.25 },
];

type SizeValue = "Regular" | "Large";


const ALL_ALLERGENS = ["dairy", "soy", "tree-nuts", "gluten", "eggs"] as const;

const ALLERGEN_ICONS: Record<string, string> = {
  dairy:       "🥛",
  soy:         "🫘",
  "tree-nuts": "🌰",
  gluten:      "🌾",
  eggs:        "🥚",
};

interface MenuItem {
  id:             string;
  name:           string;
  price:          number;
  allergens:      string[];
  hasMilk:        boolean;
  hasTemperature: boolean;
  description:    string;
}

interface Topping {
  id:        number;
  name:      string;
  price:     number;
  allergens: string[];
}

const TOPPINGS: Topping[] = [
  { id: 14, name: "Boba",         price: 0.75, allergens: ["gluten"]        },
  { id: 15, name: "Lychee Jelly", price: 0.75, allergens: []                },
  { id: 16, name: "Grass Jelly",  price: 0.75, allergens: []                },
  { id: 17, name: "Pudding",      price: 0.75, allergens: ["dairy", "eggs"] },
];

const UI_STRINGS = {
  tagline:            "Shop Operations Suite",
  kioskLabel:         "Customer Kiosk",
  cartTitle:          "Your Cart",
  cartDesc:           "Review selected items and place your order.",
  backToMenu:         "Back to Menu",
  emptyCart:          "No items in cart.",
  total:              "Total",
  pointsDiscount:     "points discount applied",
  redeemPoints:       "Redeem Points",
  ptsLeft:            "pts left",
  pts300:             "300 pts → $4 off",
  pts100:             "100 pts → $1 off",
  applyAll:           "Apply All",
  clear:              "Clear",
  phoneLabel:         "Phone Number (optional — earn loyalty points)",
  lookUp:             "Look up",
  noAccount:          "No account found — a new one will be created for this number.",
  placingOrder:       "Placing order…",
  placeOrder:         "Place Order",
  cartLabel:          "Cart",
  menuTitle:          "Menu",
  menuDesc:           "Choose a category, then tap an item to customize and add it to your cart.",
  allergenFilter:     "Filter out allergens — tap to hide items containing:",
  clearAll:           "Clear all",
  hidingItems:        "Hiding items containing:",
  availableItems:     "Available items in this category.",
  noItems:            "No items available in this category right now.",
  allItemsFiltered:   "All items in this category contain your filtered allergens.",
  footer:             "Customer kiosk — tap an item to customize and add to your order",
  contains:           "Contains",
  size:               "Size",
  sizeRegular:        "Regular",
  sizeLarge:          "Large",
  temperature:        "Temperature",
  tempHot:            "🔥 Hot",
  tempCold:           "🧊 Cold",
  sweetness:          "Sweetness",
  iceLevel:           "Ice Level",
  milkType:           "Milk Type",
  toppings:           "Toppings",
  toppingPrice:       "(+$0.75 each)",
  cancel:             "Cancel",
  addToCart:          "Add to Cart",
  updateItem:         "Update Item",
  containsAllergen:   "contains your allergen",
  orderThankYou:      "Thank you!",
  orderReceived:    "Your order was placed.",
  orderNumberLabel:   "Order number",
  orderTotalLabel:    "Total due",
  payAtCounter:       "Please pay at the counter when your drink is ready.",
  startNewOrder:      "Continue ordering",
} as const;

interface CartItem {
  cartKey:     string;
  id:          string;
  name:        string;
  basePrice:   number;
  price:       number;
  qty:         number;
  size:        SizeValue;
  milkType:    string;
  iceLevel:    string;
  toppings:    Topping[];
  temperature: string;
  sweetness:   number;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const normalizePhone = (p: string) => p.replace(/\D/g, "");

export async function loader() {
  const result = await pool.query(
    `SELECT item_id::text AS id, name, category, price::float AS price, milk,
            COALESCE(is_seasonal, false) AS "isSeasonal",
            COALESCE(has_temperature, false) AS "hasTemperature",
            COALESCE(allergens, '{}') AS allergens,
            COALESCE(description, '') AS description
     FROM "Item"
     WHERE is_active = true
     ORDER BY category, name`
  );

  const menuItems: Record<string, MenuItem[]> = {};
  const categories: string[] = [];

  for (const row of result.rows) {
    if (!menuItems[row.category]) {
      menuItems[row.category] = [];
      categories.push(row.category);
    }
    const item: MenuItem = {
      id:             row.id,
      name:           row.name,
      price:          Number(row.price),
      allergens:      (row.allergens as string[]) ?? [],
      hasMilk:        !!row.milk && row.milk.toLowerCase() !== "none" && row.milk.trim() !== "",
      hasTemperature: Boolean(row.hasTemperature),
      description:    (row.description as string) ?? "",
    };
    menuItems[row.category].push(item);
    if (row.isSeasonal) {
      if (!menuItems["Seasonal"]) {
        menuItems["Seasonal"] = [];
        categories.push("Seasonal");
      }
      menuItems["Seasonal"].push(item);
    }
  }

  return { categories, menuItems };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "ai-chat") {
    const message = String(formData.get("message") || "").trim();
    if (!message) return { ok: false as const, error: "Message required" };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI chat is not configured yet." };

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: message,
      config: { maxOutputTokens: 300 },
    });
    return {
      ok: true as const,
      reply: response.text?.trim() || "I could not generate a response. Please try again.",
    };
  }

  if (intent === "lookup-customer") {
    const phone = normalizePhone(String(formData.get("phone") || ""));
    if (!phone) return { ok: false as const, error: "Phone required" };
    const { rows } = await pool.query(
      `SELECT customer_id::text AS id, name, COALESCE(points, 0)::int AS points
       FROM "Customer" WHERE phone_number = $1 LIMIT 1`,
      [phone]
    );
    if (rows.length === 0) return { notFound: true as const };
    return { customer: rows[0] as { id: string; name: string; points: number } };
  }

  if (intent === "verify-promo") {
    const code = String(formData.get("code") || "").trim().toUpperCase();
    if (!code) return { ok: false as const, error: "Enter a promo code" };
    const result = await pool.query(
      `SELECT code, discount_pct::float AS "discountPct"
       FROM promo_codes
       WHERE code = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
       LIMIT 1`,
      [code]
    );
    if (!result.rows.length) return { ok: false as const, error: "Invalid or expired promo code" };
    return { ok: true as const, promo: result.rows[0] as { code: string; discountPct: number } };
  }

  if (intent === "place-scheduled-order") {
    const oaItems = JSON.parse(formData.get("cart") as string) as Array<{ id: string; price: number; qty: number }>;
    const scheduledFor   = String(formData.get("scheduledFor") || "");
    const oaName         = String(formData.get("customerName") || "App Customer").trim();
    const oaPhone        = normalizePhone(String(formData.get("customerPhone") || ""));
    const oaPromoCode    = String(formData.get("promoCode") || "").trim().toUpperCase();
    if (!oaItems.length || !scheduledFor) return { ok: false };

    const empRow = await pool.query(`SELECT employee_id FROM "Employee" LIMIT 1`);
    const employeeId = empRow.rows[0]?.employee_id;
    if (!employeeId) return { ok: false, error: "No employee record" };

    let customerId: string;
    if (oaPhone) {
      const ex = await pool.query(`SELECT customer_id FROM "Customer" WHERE phone_number = $1 LIMIT 1`, [oaPhone]);
      if (ex.rows.length > 0) {
        customerId = ex.rows[0].customer_id;
      } else {
        const cr = await pool.query(
          `INSERT INTO "Customer" (customer_id, name, phone_number, points) VALUES (gen_random_uuid(), $1, $2, 0) RETURNING customer_id`,
          [oaName, oaPhone]
        );
        customerId = cr.rows[0].customer_id;
      }
    } else {
      const fallback = await pool.query(`SELECT customer_id FROM "Customer" LIMIT 1`);
      customerId = fallback.rows[0]?.customer_id;
      if (!customerId) return { ok: false, error: "No customer record" };
    }

    const totalQty  = oaItems.reduce((s, i) => s + i.qty, 0);
    const subtotal  = oaItems.reduce((s, i) => s + i.price * i.qty, 0);
    let totalPrice  = applyTax(subtotal);

    if (oaPromoCode) {
      const pr = await pool.query(
        `SELECT discount_pct::float AS "discountPct" FROM promo_codes WHERE code = $1 AND is_active = true LIMIT 1`,
        [oaPromoCode]
      );
      const pct = pr.rows[0]?.discountPct ?? 0;
      totalPrice = parseFloat(Math.max(0, totalPrice * (1 - pct / 100)).toFixed(2));
    }

    const client = await pool.connect();
    let oaOrderNumber: number | undefined;
    try {
      await client.query("BEGIN");
      const orderNumber = await getNextOrderNumber(client);
      oaOrderNumber = orderNumber;
      const { rows } = await client.query(
        `INSERT INTO "Order" (order_id, employee_id, customer_id, date, total_price, payment_method, item_quantity, customer_name, order_number, status, scheduled_for)
         VALUES (gen_random_uuid(), $1, $2, now(), $3, 'Cash', $4, $5, $6, 'scheduled', $7::timestamptz) RETURNING order_id`,
        [employeeId, customerId, totalPrice.toFixed(2), totalQty, oaName, orderNumber, scheduledFor]
      );
      const orderId = rows[0].order_id;
      for (const item of oaItems) {
        await client.query(
          `INSERT INTO "Order_Item" (id, order_id, item_id, quantity, unit_price)
           VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4)`,
          [orderId, item.id, item.qty, item.price.toFixed(2)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return { ok: true as const, scheduledOrder: { orderNumber: oaOrderNumber ?? 0, scheduledFor, total: totalPrice.toFixed(2) } };
  }

  const items = JSON.parse(formData.get("cart") as string) as Array<{
    id: string; price: number; qty: number;
    size: string; iceLevel: string; milkType: string;
    toppingNames: string[]; temperature: string | null; sweetness: number | null;
  }>;

  if (!items.length) return { ok: false };

  const formCustomerId    = String(formData.get("customerId")    || "").trim();
  const formCustomerPhone = normalizePhone(String(formData.get("customerPhone") || ""));
  const formCustomerName  = String(formData.get("customerName")  || "").trim() || "Kiosk Customer";

  const empRow = await pool.query(`SELECT employee_id FROM "Employee" LIMIT 1`);
  const employeeId = empRow.rows[0]?.employee_id;
  if (!employeeId) return { ok: false, error: "No employee record found" };

  let customerId: string;
  let earnPoints = false;
  if (formCustomerId) {
    customerId = formCustomerId;
    earnPoints = true;
  } else if (formCustomerPhone) {
    const existing = await pool.query(
      `SELECT customer_id FROM "Customer" WHERE phone_number = $1 LIMIT 1`,
      [formCustomerPhone]
    );
    if (existing.rows.length > 0) {
      customerId = existing.rows[0].customer_id;
    } else {
      const created = await pool.query(
        `INSERT INTO "Customer" (customer_id, name, phone_number, points)
         VALUES (gen_random_uuid(), $1, $2, 0) RETURNING customer_id`,
        [formCustomerName, formCustomerPhone]
      );
      customerId = created.rows[0].customer_id;
    }
    earnPoints = true;
  } else {
    const fallback = await pool.query(`SELECT customer_id FROM "Customer" LIMIT 1`);
    customerId = fallback.rows[0]?.customer_id;
    if (!customerId) return { ok: false, error: "No customer record found" };
  }

  const totalQty    = items.reduce((s, i) => s + i.qty, 0);
  const subtotal    = items.reduce((s, i) => s + i.price * i.qty, 0);
  const totalPrice  = applyTax(subtotal);

  const redeem300Count  = Math.max(0, parseInt(String(formData.get("redeem300") || "0"), 10));
  const redeem100Count  = Math.max(0, parseInt(String(formData.get("redeem100") || "0"), 10));
  const pointsRedeemed  = earnPoints ? redeem300Count * 300 + redeem100Count * 100 : 0;
  const redeemDiscount  = earnPoints ? redeem300Count * 4  + redeem100Count * 1   : 0;
  const afterPoints     = Math.max(0, totalPrice - redeemDiscount);

  // Apply promo code
  const promoCodeInput = String(formData.get("promoCode") || "").trim().toUpperCase();
  let promoDiscountPct = 0;
  if (promoCodeInput) {
    const pr = await pool.query(
      `SELECT discount_pct::float AS "discountPct" FROM promo_codes WHERE code = $1 AND is_active = true LIMIT 1`,
      [promoCodeInput]
    );
    promoDiscountPct = pr.rows[0]?.discountPct ?? 0;
  }
  const promoDiscountAmt = parseFloat((afterPoints * promoDiscountPct / 100).toFixed(2));
  const discountedTotal  = parseFloat(Math.max(0, afterPoints - promoDiscountAmt).toFixed(2));

  const client = await pool.connect();
  let placedOrderNumber: number | undefined;
  try {
    await client.query("BEGIN");
    const orderNumber = await getNextOrderNumber(client);
    placedOrderNumber = orderNumber;
    const { rows } = await client.query(
      `INSERT INTO "Order" (order_id, employee_id, customer_id, date, total_price, payment_method, item_quantity, customer_name, order_number)
       VALUES (gen_random_uuid(), $1, $2, now(), $3, 'Cash', $4, $5, $6) RETURNING order_id`,
      [employeeId, customerId, discountedTotal.toFixed(2), totalQty, formCustomerName, orderNumber]
    );
    const orderId = rows[0].order_id;

    for (const item of items) {
      await client.query(
        `INSERT INTO "Order_Item" (id, order_id, item_id, quantity, unit_price, size, ice_level, milk_type, toppings, temperature, sweetness)
         VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [orderId, item.id, item.qty, item.price.toFixed(2),
         item.size, item.iceLevel, item.milkType,
         item.toppingNames, item.temperature || null, item.sweetness || null]
      );
    }

    const taxAmount = (totalPrice - subtotal).toFixed(2);
    await client.query(
      `INSERT INTO pos_sales_activity
       (activity_id, business_date, event_time, activity_type, order_id, amount, tax_amount, payment_method, item_count)
       VALUES (gen_random_uuid(), CURRENT_DATE, now(), 'SALE', $1, $2, $3, 'Cash', $4)`,
      [orderId, totalPrice.toFixed(2), taxAmount, totalQty]
    );
    if (earnPoints) {
      await client.query(
        `UPDATE "Customer" SET points = points + floor($1::numeric * 5) - $2 WHERE customer_id = $3::uuid`,
        [discountedTotal.toFixed(2), pointsRedeemed, customerId]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    ok: true as const,
    orderNumber: placedOrderNumber ?? 0,
    total: discountedTotal.toFixed(2),
  };
}

async function getNextOrderNumber(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [62003]);
  const { rows } = await client.query<{ next_order_number: number }>(
    `SELECT CASE
       WHEN COALESCE(last_order_number, 0) >= 100 THEN 1
       ELSE COALESCE(last_order_number, 0) + 1
     END AS next_order_number
     FROM (
       SELECT order_number AS last_order_number
       FROM "Order"
       ORDER BY date DESC, order_id DESC
       LIMIT 1
     ) latest`
  );
  return rows[0]?.next_order_number ?? 1;
}

function generateSurprise(allItems: MenuItem[], excluded: string[]) {
  const pool = allItems.filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
  if (pool.length === 0) return null;
  const item      = pool[Math.floor(Math.random() * pool.length)];
  const eligible  = TOPPINGS.filter(t => !t.allergens.some(a => excluded.includes(a)));
  const count     = Math.floor(Math.random() * Math.min(eligible.length + 1, 3));
  const toppings  = [...eligible].sort(() => Math.random() - 0.5).slice(0, count);
  const sweetness = SWEETNESS_OPTIONS[Math.floor(Math.random() * SWEETNESS_OPTIONS.length)];
  const iceLevel  = ICE_LEVELS[Math.floor(Math.random() * ICE_LEVELS.length)];
  const size      = SIZES[Math.floor(Math.random() * SIZES.length)].value;
  return { item, toppings, sweetness, iceLevel, size };
}

export default function Customer() {
  const { categories, menuItems } = useLoaderData<typeof loader>();
  const fetcher       = useFetcher<typeof action>();
  const lookupFetcher = useFetcher<typeof action>();
  const translationContext = useContext(TranslationContext);
  const language = translationContext?.language ?? "en";
  const setLanguage = translationContext?.setLanguage ?? (() => {});

  const [activeCategory, setActiveCategory]     = useState(0);
  const [blockedAllergens, setBlockedAllergens] = useState<string[]>([]);
  const [cart, setCart]                         = useState<CartItem[]>([]);
  const [showCart, setShowCart]                 = useState(false);
  const [customerPhone, setCustomerPhone]       = useState("");
  const [lookedUpCustomer, setLookedUpCustomer] = useState<{ id: string; name: string; points: number } | "not-found" | null>(null);
  const [redeem300, setRedeem300]               = useState(0);
  const [redeem100, setRedeem100]               = useState(0);
  const [orderConfirmation, setOrderConfirmation] = useState<{
    orderNumber: number;
    total: string;
  } | null>(null);

  useEffect(() => {
    if (
      fetcher.state === "idle"
      && fetcher.data
      && "ok" in fetcher.data
      && fetcher.data.ok
      && "orderNumber" in fetcher.data
    ) {
      const d = fetcher.data as { ok: true; orderNumber: number; total: string };
      setOrderConfirmation({ orderNumber: d.orderNumber, total: d.total });
      setCart([]);
      setShowCart(false);
      setCustomerPhone("");
      setLookedUpCustomer(null);
      setRedeem300(0);
      setRedeem100(0);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    const data = lookupFetcher.data;
    if (!data || lookupFetcher.state !== "idle") return;
    if ("customer" in data) {
      setLookedUpCustomer(data.customer as { id: string; name: string; points: number });
    } else if ("notFound" in data) {
      setLookedUpCustomer("not-found");
    }
  }, [lookupFetcher.state, lookupFetcher.data]);

  const [selectedItem, setSelectedItem]         = useState<MenuItem | null>(null);
  const [editCartKey, setEditCartKey]           = useState<string | null>(null);
  const [size, setSize]                         = useState<SizeValue>("Regular");
  const [milkType, setMilkType]                 = useState("Whole Milk");
  const [iceLevel, setIceLevel]                 = useState("Regular");
  const [temperature, setTemperature]           = useState("cold");
  const [sweetness, setSweetness]               = useState(100);
  const [selectedToppings, setSelectedToppings] = useState<number[]>([]);
  
  const [weather, setWeather] = useState<{ temp_f: number; condition: string } | null>(null);

  const chatFetcher   = useFetcher<typeof action>();
  const oaFetcher     = useFetcher<typeof action>();
  const promoFetcher  = useFetcher<typeof action>();
  const oaPromoFetcher = useFetcher<typeof action>();
  const [chatOpen, setChatOpen] = useState(false);

  // Order Ahead state
  const [oaActive, setOaActive]       = useState(false);
  const [oaStep, setOaStep]           = useState<"schedule" | "browse" | "customize" | "cart" | "done">("schedule");
  const [oaDate, setOaDate]           = useState("");
  const [oaTime, setOaTime]           = useState("");
  const [oaCart, setOaCart]           = useState<CartItem[]>([]);
  const [oaMode, setOaMode]           = useState(false);
  const [oaCustomerName, setOaCustomerName] = useState("");
  const [oaCustomerPhone, setOaCustomerPhone] = useState("");
  const [oaPromoInput, setOaPromoInput] = useState("");
  const [oaAppliedPromo, setOaAppliedPromo] = useState<{ code: string; discountPct: number } | null>(null);
  const [oaPromoError, setOaPromoError]     = useState<string | null>(null);

  // Regular cart promo
  const [promoInput, setPromoInput]     = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountPct: number } | null>(null);
  const [promoError, setPromoError]     = useState<string | null>(null);
  const [oaCategory, setOaCategory]   = useState(0);
  const [oaConfirmation, setOaConfirmation] = useState<{ orderNumber: number; scheduledFor: string; total: string } | null>(null);

  useEffect(() => {
    if (oaFetcher.state !== "idle" || !oaFetcher.data) return;
    const d = oaFetcher.data;
    if ("scheduledOrder" in d && d.ok) {
      const so = (d as { ok: true; scheduledOrder: { orderNumber: number; scheduledFor: string; total: string } }).scheduledOrder;
      setOaConfirmation(so);
      setOaCart([]);
      setOaCustomerName("");
      setOaCustomerPhone("");
      setOaAppliedPromo(null);
      setOaPromoInput("");
      setOaStep("done");
    }
  }, [oaFetcher.state, oaFetcher.data]);

  useEffect(() => {
    if (promoFetcher.state !== "idle" || !promoFetcher.data) return;
    const d = promoFetcher.data;
    if ("promo" in d && d.ok) {
      setAppliedPromo((d as { ok: true; promo: { code: string; discountPct: number } }).promo);
      setPromoError(null);
    } else if ("error" in d) setPromoError((d as { error: string }).error);
  }, [promoFetcher.state, promoFetcher.data]);

  useEffect(() => {
    if (oaPromoFetcher.state !== "idle" || !oaPromoFetcher.data) return;
    const d = oaPromoFetcher.data;
    if ("promo" in d && d.ok) {
      setOaAppliedPromo((d as { ok: true; promo: { code: string; discountPct: number } }).promo);
      setOaPromoError(null);
    } else if ("error" in d) setOaPromoError((d as { error: string }).error);
  }, [oaPromoFetcher.state, oaPromoFetcher.data]);

  const [clockDisplay, setClockDisplay] = useState(() =>
    new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  );
  useEffect(() => {
    const id = setInterval(() => setClockDisplay(
      new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    ), 30_000);
    return () => clearInterval(id);
  }, []);

  const oaDates = (() => {
    const d0 = new Date(); d0.setHours(0,0,0,0);
    const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    return [
      { label: "Today",    value: d0.toISOString().slice(0,10) },
      { label: "Tomorrow", value: d1.toISOString().slice(0,10) },
    ];
  })();

  const isTomorrow = oaDate === oaDates[1].value;

  // 30-min slots for today: 1h from now → 9 PM
  const oaTimeSlots = (() => {
    if (!oaDate || isTomorrow) return [];
    const slots: Date[] = [];
    const now = new Date();
    const earliest = new Date(now.getTime() + 60 * 60 * 1000);
    let cur = new Date(earliest);
    cur.setMinutes(Math.ceil(cur.getMinutes() / 30) * 30, 0, 0);
    const close = new Date(oaDate + "T21:00:00");
    while (cur <= close) { slots.push(new Date(cur)); cur = new Date(cur.getTime() + 30 * 60 * 1000); }
    return slots;
  })();

  const oaCategories = categories;
  const oaCategoryItems = menuItems[oaCategories[oaCategory]] ?? [];
  const oaTotal = oaCart.reduce((s, i) => s + i.price * i.qty, 0);
  const oaTotalWithTax = applyTax(oaTotal);

  const oaRemoveItem = (cartKey: string) => setOaCart(prev => prev.filter(i => i.cartKey !== cartKey));


  const formatOaTime = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  };
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Hi! I can help with menu questions and ordering." },
  ]);

  const [surpriseExcluded, setSurpriseExcluded] = useState<string[]>([]);
  const [surpriseResult, setSurpriseResult] = useState<ReturnType<typeof generateSurprise>>(null);

  useEffect(() => {
    const fetchWeather = () =>
      fetch("/api/weather")
        .then(r => r.json())
        .then(d => { if (!d.error) setWeather(d); })
        .catch(() => {});
    fetchWeather();
    const id = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const [translatedCategories, setTranslatedCategories] = useState(categories);
  const [translatedMenuItems, setTranslatedMenuItems]   = useState(menuItems);
  const [translatedMilkTypes, setTranslatedMilkTypes]   = useState(MILK_TYPES);
  const [translatedIceLevels, setTranslatedIceLevels]   = useState(ICE_LEVELS);
  const [translatedToppings, setTranslatedToppings]     = useState(TOPPINGS);
  const [translatedUI, setTranslatedUI]                 = useState<typeof UI_STRINGS>({ ...UI_STRINGS });

  const translatedCurrentCategory  = translatedCategories[activeCategory];
  const items                      = translatedMenuItems[translatedCurrentCategory] ?? [];

  useEffect(() => {
    if (language === "en") {
      setTranslatedCategories(categories);
      setTranslatedMenuItems(menuItems);
      setTranslatedMilkTypes(MILK_TYPES);
      setTranslatedIceLevels(ICE_LEVELS);
      setTranslatedToppings(TOPPINGS);
      setTranslatedUI({ ...UI_STRINGS });
      return;
    }
    const keys = Object.keys(UI_STRINGS) as (keyof typeof UI_STRINGS)[];
    Promise.all(keys.map(k => translateText(UI_STRINGS[k], { to: language }))).then(vals => {
      const result = {} as typeof UI_STRINGS;
      keys.forEach((k, i) => { (result as Record<string, string>)[k] = vals[i]; });
      setTranslatedUI(result);
    });

    Promise.all(categories.map(cat => translateText(cat, { to: language }))).then(setTranslatedCategories);
    const translateMenu = async () => {
      const newMenu: typeof menuItems = {};
      for (const [cat, catItems] of Object.entries(menuItems)) {
        const translatedCat = await translateText(cat, { to: language });
        newMenu[translatedCat] = await Promise.all(
          catItems.map(async item => ({ ...item, name: await translateText(item.name, { to: language }) }))
        );
      }
      setTranslatedMenuItems(newMenu);
    };
    translateMenu();
    Promise.all(MILK_TYPES.map(mt => translateText(mt, { to: language }))).then(setTranslatedMilkTypes);
    Promise.all(ICE_LEVELS.map(il => translateText(il, { to: language }))).then(setTranslatedIceLevels);
    Promise.all(TOPPINGS.map(async t => ({ ...t, name: await translateText(t.name, { to: language }) }))).then(setTranslatedToppings);
  }, [language, categories, menuItems]);

  useEffect(() => {
    const data = chatFetcher.data;
    if (!data || chatFetcher.state !== "idle") return;
    if ("reply" in data && data.reply) {
      setChatMessages((prev) => [...prev, { role: "assistant", text: data.reply }]);
      return;
    }
    if ("error" in data && data.error) {
      setChatMessages((prev) => [...prev, { role: "assistant", text: `Sorry, ${data.error}` }]);
    }
  }, [chatFetcher.state, chatFetcher.data]);

  useEffect(() => {
    if (!selectedItem) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") closePopup(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem]);

  const openItem = (item: MenuItem) => {
    setSelectedItem(item);
    setEditCartKey(null);
    setSize("Regular");
    setMilkType("Whole Milk");
    setIceLevel("Regular");
    setTemperature("cold");
    setSweetness(100);
    setSelectedToppings([]);
    if (oaMode) setOaStep("customize");
  };

  const openItemForEdit = (cartItem: CartItem) => {
    const menuItem = Object.values(menuItems).flat().find(i => i.id === cartItem.id);
    if (!menuItem) return;
    setSelectedItem(menuItem);
    setEditCartKey(cartItem.cartKey);
    setSize(cartItem.size);
    setMilkType(cartItem.milkType);
    setIceLevel(cartItem.iceLevel);
    setTemperature(cartItem.temperature || "cold");
    setSweetness(cartItem.sweetness || 100);
    setSelectedToppings(cartItem.toppings.map(t => t.id));
    setShowCart(false);
  };

  const closePopup = () => {
    setSelectedItem(null);
    setEditCartKey(null);
    if (oaMode) {
      setOaMode(false);
      setOaStep("browse");
    } else if (editCartKey) {
      setShowCart(true);
    }
  };

  const toggleTopping = (id: number) =>
    setSelectedToppings(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const confirmAddToCart = () => {
    if (!selectedItem) return;
    const toppings   = TOPPINGS.filter(t => selectedToppings.includes(t.id));
    const toppingIds = toppings.map(t => t.id).sort().join(",");
    const key        = `${selectedItem.id}-${size}-${milkType}-${iceLevel}-${temperature}-${sweetness}-${toppingIds}`;
    const sizeUpcharge = SIZES.find(s => s.value === size)?.upcharge ?? 0;
    const sizedPrice = parseFloat((selectedItem.price + sizeUpcharge).toFixed(2));
    const itemTotal  = sizedPrice + toppings.reduce((s, t) => s + t.price, 0);
    const newItem: CartItem = {
      cartKey: key, id: selectedItem.id, name: selectedItem.name,
      basePrice: selectedItem.price, price: itemTotal,
      qty: 1, size, milkType, iceLevel, toppings,
      temperature: selectedItem.hasTemperature ? temperature : "",
      sweetness,
    };

    if (oaMode) {
      setOaCart(prev => {
        const existing = prev.find(o => o.cartKey === key);
        if (existing) return prev.map(o => o.cartKey === key ? { ...o, qty: o.qty + 1 } : o);
        return [...prev, newItem];
      });
      setOaMode(false);
      setOaStep("browse");
    } else {
      setCart(prev => {
        if (editCartKey) {
          const oldItem  = prev.find(o => o.cartKey === editCartKey);
          const conflict = prev.find(o => o.cartKey === key && o.cartKey !== editCartKey);
          if (conflict) {
            return prev
              .filter(o => o.cartKey !== editCartKey)
              .map(o => o.cartKey === key ? { ...o, qty: o.qty + (oldItem?.qty ?? 1) } : o);
          }
          return prev.map(o => o.cartKey === editCartKey ? { ...newItem, qty: oldItem?.qty ?? 1 } : o);
        }
        const existing = prev.find(o => o.cartKey === key);
        if (existing) return prev.map(o => o.cartKey === key ? { ...o, qty: o.qty + 1 } : o);
        return [...prev, newItem];
      });
      if (editCartKey) setShowCart(true);
    }
    setSelectedItem(null);
    setEditCartKey(null);
  };

  const removeFromCart = (cartKey: string) => setCart(prev => prev.filter(c => c.cartKey !== cartKey));

  const totalItems      = cart.reduce((s, c) => s + c.qty, 0);
  const total           = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const availablePoints = lookedUpCustomer && lookedUpCustomer !== "not-found" ? lookedUpCustomer.points : 0;
  const pointsUsed      = redeem300 * 300 + redeem100 * 100;
  const remainingPoints = availablePoints - pointsUsed;
  const redeemDiscount  = redeem300 * 4 + redeem100 * 1;
  const afterPointsTotal = Math.max(0, total - redeemDiscount);
  const promoDiscountAmt = appliedPromo ? parseFloat((afterPointsTotal * appliedPromo.discountPct / 100).toFixed(2)) : 0;
  const adjustedTotal    = Math.max(0, afterPointsTotal - promoDiscountAmt);

  const applyAllPoints = () => {
    const max300 = Math.floor(availablePoints / 300);
    const max100 = Math.floor((availablePoints - max300 * 300) / 100);
    setRedeem300(max300);
    setRedeem100(max100);
  };

  const sendChatMessage = () => {
    const message = chatInput.trim();
    if (!message || chatFetcher.state !== "idle") return;
    setChatMessages((prev) => [...prev, { role: "user", text: message }]);
    setChatInput("");
    chatFetcher.submit(
      { intent: "ai-chat", message },
      { method: "post" }
    );
  };
  const modalSizeUpcharge = SIZES.find(s => s.value === size)?.upcharge ?? 0;
  const modalPrice = selectedItem
    ? parseFloat((selectedItem.price + modalSizeUpcharge + selectedToppings.length * 0.75).toFixed(2))
    : 0;

  return (
    <div className="h-screen flex flex-col app-shell">
      <header className="app-header px-6 py-4 shrink-0">
        <div className="topbar-row">
          <div className="topbar-brand">
            <span className="brand-link">Boba House</span>
            <p className="topbar-tagline">{translatedUI.tagline}</p>
          </div>
          {weather && (
            <div className="flex items-center gap-1.5 text-white/80 text-sm font-medium">
              <span>{Math.round(weather.temp_f)}°F</span>
              <span className="text-white/50 text-xs hidden sm:inline">· {weather.condition}</span>
            </div>
          )}
          <span className="topbar-chip">{translatedUI.kioskLabel}</span>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value as LanguageCode)}
            aria-label="Select language"
            className="ml-4 px-2 py-1 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {Object.entries(MAJOR_LANGUAGES).map(([name, code]) => (
              <option key={code} value={code}>
                {name.charAt(0).toUpperCase() + name.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Top-level tab strip */}
      <div className="bg-white border-b border-slate-200 flex shrink-0">
        <button
          onClick={() => setOaActive(false)}
          aria-pressed={!oaActive}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors focus:outline-none
            ${!oaActive ? "border-indigo-600 text-indigo-700 bg-indigo-50" : "border-transparent text-slate-600 hover:bg-slate-50"}`}
        >
          Order Now
        </button>
        <button
          onClick={() => { setOaActive(true); setOaStep("schedule"); }}
          aria-pressed={oaActive}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors focus:outline-none
            ${oaActive ? "border-purple-600 text-purple-700 bg-purple-50" : "border-transparent text-slate-600 hover:bg-slate-50"}`}
        >
          📅 Order Ahead
        </button>
      </div>

      <div className="flex-1 overflow-y-auto page-section w-full px-4 py-5">
        {/* ── ORDER AHEAD PHONE UI ─────────────────────────────────── */}
        {oaActive ? (
          <div className="flex justify-center py-4">
            {/* Phone frame */}
            <div className="w-[375px] bg-slate-50 rounded-[40px] shadow-2xl border-[10px] border-slate-800 overflow-hidden flex flex-col" style={{ minHeight: 700 }}>
              {/* Notch */}
              <div className="relative shrink-0 bg-gradient-to-br from-purple-700 to-indigo-600 pt-8 pb-4 px-5">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-slate-800 rounded-b-3xl" />
                <div className="flex justify-between items-center text-white/70 text-[11px] mb-2">
                  <span>{clockDisplay}</span><span>●●●</span>
                </div>
                <h1 className="text-white text-xl font-bold">Boba House</h1>
                <p className="text-purple-200 text-xs mt-0.5">Order Ahead</p>
                {oaStep !== "schedule" && oaStep !== "done" && (
                  <div className="flex gap-2 mt-3 text-[11px]">
                    {(["schedule","browse","cart"] as const).map((s, i) => (
                      <div key={s} className={`flex-1 h-1 rounded-full ${oaStep === s || (i < ["schedule","browse","cart"].indexOf(oaStep)) ? "bg-white" : "bg-white/30"}`} />
                    ))}
                  </div>
                )}
              </div>

              {/* Step: Schedule */}
              {oaStep === "schedule" && (
                <div className="flex-1 overflow-y-auto p-5">
                  <h2 className="text-base font-bold text-slate-900 mb-1">When would you like to pick up?</h2>
                  <p className="text-xs text-slate-500 mb-4">
                    {isTomorrow ? "Enter any time between 10:00 AM and 5:00 PM." : "Choose a slot at least 1 hour from now."}
                  </p>

                  {/* Date picker */}
                  <div className="flex gap-2 mb-5">
                    {oaDates.map(d => (
                      <button key={d.value} onClick={() => { setOaDate(d.value); setOaTime(""); }}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors
                          ${oaDate === d.value ? "border-purple-600 bg-purple-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                        {d.label}
                      </button>
                    ))}
                  </div>

                  {/* Today: 30-min slot grid */}
                  {oaDate && !isTomorrow && (
                    oaTimeSlots.length === 0 ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5 text-center">
                        <p className="text-sm text-slate-500">No slots left today.</p>
                        <p className="text-xs text-slate-400 mt-1">Select Tomorrow to schedule ahead.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 mb-5">
                        {oaTimeSlots.map(slot => {
                          const val = `${slot.getHours().toString().padStart(2,"0")}:${slot.getMinutes().toString().padStart(2,"0")}`;
                          const label = slot.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
                          return (
                            <button key={val} onClick={() => setOaTime(val)}
                              className={`py-2 rounded-xl text-xs font-medium border-2 transition-colors
                                ${oaTime === val ? "border-purple-600 bg-purple-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )
                  )}

                  {/* Tomorrow: free time input (10 AM – 5 PM) */}
                  {isTomorrow && (
                    <div className="mb-5">
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Pickup time</label>
                      <input
                        type="time"
                        min="10:00"
                        max="17:00"
                        value={oaTime}
                        onChange={e => setOaTime(e.target.value)}
                        className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
                      />
                      {oaTime && (oaTime < "10:00" || oaTime > "17:00") && (
                        <p className="text-xs text-red-500 mt-1">Please choose a time between 10:00 AM and 5:00 PM.</p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setOaStep("browse")}
                    disabled={!oaDate || !oaTime || (isTomorrow && (oaTime < "10:00" || oaTime > "17:00"))}
                    className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    Browse Menu →
                  </button>
                </div>
              )}

              {/* Step: Browse */}
              {oaStep === "browse" && (
                <div className="flex-1 overflow-y-auto flex flex-col">
                  <div className="px-4 pt-4 pb-2">
                    <p className="text-xs text-purple-700 font-semibold mb-3">
                      Pickup: {isTomorrow ? "Tomorrow" : "Today"} at {(() => { const [h,m] = oaTime.split(":").map(Number); const d = new Date(); d.setHours(h,m,0,0); return d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}); })()}
                    </p>
                    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
                      {oaCategories.map((cat, i) => (
                        <button key={cat} onClick={() => setOaCategory(i)}
                          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors
                            ${oaCategory === i ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-slate-200 text-slate-600"}`}>
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 pb-4 grid grid-cols-2 gap-3 content-start">
                    {oaCategoryItems.map(item => {
                      const qtyInCart = oaCart.filter(i => i.id === item.id).reduce((s, i) => s + i.qty, 0);
                      return (
                        <button key={item.id} onClick={() => { setOaMode(true); openItem(item); }}
                          className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-col gap-1.5 text-left hover:border-purple-400 hover:bg-purple-50 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500">
                          <p className="text-sm font-semibold text-slate-900 leading-tight">{item.name}</p>
                          <p className="text-xs text-slate-500">${item.price.toFixed(2)}</p>
                          {item.allergens.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.allergens.map(a => (
                                <span key={a} className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-1.5 py-0.5">
                                  {ALLERGEN_ICONS[a]} {a.replace("-"," ")}
                                </span>
                              ))}
                            </div>
                          )}
                          {qtyInCart > 0 && (
                            <span className="mt-auto self-end text-xs font-bold text-purple-700 bg-purple-100 rounded-full px-2 py-0.5">
                              ×{qtyInCart} in cart
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="px-4 pb-4 shrink-0">
                    <button
                      onClick={() => setOaStep("cart")}
                      disabled={oaCart.length === 0}
                      className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      View Cart ({oaCart.reduce((s,i) => s+i.qty, 0)}) →
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Customize (inside phone) */}
              {oaStep === "customize" && selectedItem && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">{selectedItem.name}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">${modalPrice.toFixed(2)}</p>
                      {selectedItem.description && <p className="text-[11px] text-slate-400 mt-1 leading-snug">{selectedItem.description}</p>}
                    </div>
                    <button onClick={closePopup} className="text-xs text-purple-600 font-medium ml-2 shrink-0">✕ Cancel</button>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">Size</p>
                    <div className="grid grid-cols-2 gap-2">
                      {SIZES.map(s => (
                        <button key={s.value} onClick={() => setSize(s.value)} aria-pressed={size === s.value}
                          className={`py-2 text-xs font-medium rounded-xl border-2 transition-colors ${size === s.value ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-slate-200 text-slate-700"}`}>
                          <span className="block font-bold">{s.value}</span>
                          <span className="block text-[10px] opacity-75">{s.oz}{s.upcharge > 0 ? ` +$${s.upcharge.toFixed(2)}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">Sweetness</p>
                    <div className="grid grid-cols-5 gap-1">
                      {SWEETNESS_OPTIONS.map(pct => (
                        <button key={pct} onClick={() => setSweetness(pct)} aria-pressed={sweetness === pct}
                          className={`py-1.5 text-[11px] font-medium rounded-lg border-2 transition-colors ${sweetness === pct ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-slate-200 text-slate-700"}`}>
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">Ice Level</p>
                    <div className="grid grid-cols-4 gap-1">
                      {ICE_LEVELS.map(lv => (
                        <button key={lv} onClick={() => setIceLevel(lv)} aria-pressed={iceLevel === lv}
                          className={`py-1.5 text-[11px] font-medium rounded-lg border-2 transition-colors ${iceLevel === lv ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-slate-200 text-slate-700"}`}>
                          {lv}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedItem.hasMilk && (
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-1.5">Milk Type</p>
                      <div className="grid grid-cols-3 gap-1">
                        {MILK_TYPES.map(mt => (
                          <button key={mt} onClick={() => setMilkType(mt)} aria-pressed={milkType === mt}
                            className={`py-1.5 text-[11px] font-medium rounded-lg border-2 transition-colors ${milkType === mt ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-slate-200 text-slate-700"}`}>
                            {mt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">Toppings <span className="text-slate-400 font-normal">(+$0.75)</span></p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {TOPPINGS.map(t => (
                        <button key={t.id} onClick={() => toggleTopping(t.id)} aria-pressed={selectedToppings.includes(t.id)}
                          className={`py-2 px-2 text-[11px] font-medium rounded-xl border-2 text-left transition-colors ${selectedToppings.includes(t.id) ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-slate-200 text-slate-700"}`}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button onClick={confirmAddToCart}
                    className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm transition-colors">
                    Add to Order — ${modalPrice.toFixed(2)}
                  </button>
                </div>
              )}

              {/* Step: Cart */}
              {oaStep === "cart" && (() => {
                const oaPromoDiscount = oaAppliedPromo ? parseFloat((oaTotalWithTax * oaAppliedPromo.discountPct / 100).toFixed(2)) : 0;
                const oaFinalTotal    = parseFloat(Math.max(0, oaTotalWithTax - oaPromoDiscount).toFixed(2));
                return (
                <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-slate-900">Checkout</h2>
                    <button onClick={() => setOaStep("browse")} className="text-xs text-purple-600 font-medium">← Edit</button>
                  </div>
                  <p className="text-xs text-purple-700 font-semibold -mt-1">
                    Pickup: {isTomorrow ? "Tomorrow" : "Today"} at {(() => { const [h,m] = oaTime.split(":").map(Number); const d = new Date(); d.setHours(h,m,0,0); return d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}); })()}
                  </p>

                  {/* Items */}
                  <div className="space-y-2">
                    {oaCart.map(item => (
                      <div key={item.cartKey} className="bg-white rounded-2xl border border-slate-200 px-3 py-2 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-900">{item.name} ×{item.qty}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {[item.size, item.milkType !== "Whole Milk" && item.milkType, item.iceLevel !== "Regular" && item.iceLevel,
                              item.toppings.length > 0 && item.toppings.map(t => t.name).join(", ")].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span className="text-xs font-bold text-slate-800">${(item.price * item.qty).toFixed(2)}</span>
                          <button onClick={() => oaRemoveItem(item.cartKey)} className="text-red-400 text-base leading-none">×</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Customer info */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Your Details</p>
                    <input type="text" placeholder="Name *" value={oaCustomerName} onChange={e => setOaCustomerName(e.target.value)}
                      className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs focus:outline-none focus:border-purple-500" />
                    <input type="tel" placeholder="Phone (optional — earn points)" value={oaCustomerPhone} onChange={e => setOaCustomerPhone(e.target.value)}
                      className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs focus:outline-none focus:border-purple-500" />
                  </div>

                  {/* Promo code */}
                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">Promo Code</p>
                    <div className="flex gap-2">
                      <input type="text" value={oaAppliedPromo ? oaAppliedPromo.code : oaPromoInput}
                        onChange={e => { setOaPromoInput(e.target.value.toUpperCase()); setOaPromoError(null); }}
                        disabled={!!oaAppliedPromo} placeholder="e.g. BOBA10"
                        className="flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs uppercase focus:outline-none focus:border-purple-500 disabled:bg-slate-50" />
                      {oaAppliedPromo ? (
                        <button onClick={() => { setOaAppliedPromo(null); setOaPromoInput(""); }}
                          className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-semibold text-slate-600">Remove</button>
                      ) : (
                        <button onClick={() => oaPromoFetcher.submit({ intent: "verify-promo", code: oaPromoInput }, { method: "post" })}
                          disabled={!oaPromoInput.trim() || oaPromoFetcher.state !== "idle"}
                          className="px-3 py-2 rounded-xl bg-purple-100 text-xs font-semibold text-purple-700 disabled:opacity-50">
                          {oaPromoFetcher.state !== "idle" ? "…" : "Apply"}
                        </button>
                      )}
                    </div>
                    {oaAppliedPromo && <p className="text-[11px] text-emerald-600 mt-1 font-medium">{oaAppliedPromo.discountPct}% off applied</p>}
                    {oaPromoError && <p className="text-[11px] text-red-500 mt-1">{oaPromoError}</p>}
                  </div>

                  {/* Totals */}
                  <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>${oaTotal.toFixed(2)}</span></div>
                    <div className="flex justify-between text-slate-600"><span>Tax (8.25%)</span><span>${(oaTotalWithTax - oaTotal).toFixed(2)}</span></div>
                    {oaPromoDiscount > 0 && (
                      <div className="flex justify-between text-emerald-600"><span>Promo ({oaAppliedPromo?.discountPct}% off)</span><span>-${oaPromoDiscount.toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100 text-sm"><span>Total</span><span>${oaFinalTotal.toFixed(2)}</span></div>
                  </div>

                  <button
                    onClick={() => {
                      if (!oaCart.length || !oaCustomerName.trim() || !oaDate || !oaTime) return;
                      const scheduledFor = new Date(`${oaDate}T${oaTime}`).toISOString();
                      oaFetcher.submit(
                        { intent: "place-scheduled-order", cart: JSON.stringify(oaCart.map(i => ({ id: i.id, price: i.price, qty: i.qty }))),
                          scheduledFor, customerName: oaCustomerName.trim(), customerPhone: oaCustomerPhone.trim(),
                          promoCode: oaAppliedPromo?.code ?? "" },
                        { method: "post" }
                      );
                    }}
                    disabled={oaFetcher.state !== "idle" || !oaCustomerName.trim()}
                    className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {oaFetcher.state !== "idle" ? "Placing…" : "Place Scheduled Order"}
                  </button>
                  {!oaCustomerName.trim() && <p className="text-[11px] text-red-500 -mt-2 text-center">Name is required</p>}
                </div>
                );
              })()}

              {/* Step: Done — timeline */}
              {oaStep === "done" && oaConfirmation && (
                <div className="flex-1 overflow-y-auto p-5">
                  <div className="text-center mb-5">
                    <div className="text-4xl mb-2">🧋</div>
                    <h2 className="text-lg font-bold text-slate-900">Order Scheduled!</h2>
                    <p className="text-slate-500 text-sm mt-1">Order #{oaConfirmation.orderNumber} · ${oaConfirmation.total}</p>
                    <div className="mt-3 flex flex-col items-center gap-1">
                      <img
                        src={qrCodeUrl(receiptQrData({ orderNumber: oaConfirmation.orderNumber, total: oaConfirmation.total, scheduledFor: formatOaTime(oaConfirmation.scheduledFor) }), 140)}
                        alt="Order receipt QR code"
                        width={120}
                        height={120}
                        className="rounded-xl border-2 border-purple-200 bg-white p-1"
                      />
                      <p className="text-[10px] text-purple-600 font-medium">Scan for receipt</p>
                    </div>
                  </div>
                  {/* Timeline */}
                  <div className="relative pl-8">
                    <div className="absolute left-3.5 top-3 bottom-3 w-0.5 bg-purple-200" />
                    {[
                      { icon: "✅", label: "Order Received", sub: "Right now", done: true },
                      { icon: "👨‍🍳", label: "Being Prepared", sub: `~${(() => { const d = new Date(oaConfirmation.scheduledFor); d.setMinutes(d.getMinutes()-15); return d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}); })()}`, done: false },
                      { icon: "📦", label: "Ready for Pickup", sub: formatOaTime(oaConfirmation.scheduledFor), done: false },
                    ].map((step, i) => (
                      <div key={i} className="flex items-start gap-4 mb-6 relative">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-base shrink-0 z-10 border-2 ${step.done ? "bg-purple-600 border-purple-600" : "bg-white border-purple-300"}`}>
                          {step.icon}
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${step.done ? "text-purple-700" : "text-slate-900"}`}>{step.label}</p>
                          <p className="text-xs text-slate-500">{step.sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setOaStep("schedule"); setOaCart([]); setOaDate(""); setOaTime(""); setOaConfirmation(null); }}
                    className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm transition-colors mt-2">
                    Place Another Order
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : showCart ? (
          <div className="max-w-2xl mx-auto section-card p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="section-title">{translatedUI.cartTitle}</h2>
                <p className="section-description">{translatedUI.cartDesc}</p>
              </div>
              <button
                onClick={() => setShowCart(false)}
                className="secondary-btn px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                {translatedUI.backToMenu}
              </button>
            </div>
            {cart.length === 0 ? (
              <p className="text-slate-500 text-sm">{translatedUI.emptyCart}</p>
            ) : (
              <>
                <div className="section-card divide-y divide-slate-100">
                  {cart.map(item => (
                    <div key={item.cartKey} className="flex items-start justify-between px-4 py-3 text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-800 font-medium">{item.name} ×{item.qty}</p>
                        <p className="text-slate-400 text-xs mt-0.5">
                          {[
                            `${item.size} (${SIZES.find(s => s.value === item.size)?.oz})`,
                            item.temperature && item.temperature,
                            item.sweetness !== 100 && `${item.sweetness}%`,
                            item.milkType !== "Whole Milk" && item.milkType,
                            item.iceLevel !== "Regular" && item.iceLevel,
                            item.toppings.length > 0 && item.toppings.map(t => t.name).join(", "),
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="flex items-center gap-2 text-slate-700 shrink-0 ml-3">
                        <span>${(item.price * item.qty).toFixed(2)}</span>
                        <button
                          onClick={() => openItemForEdit(item)}
                          aria-label={`Edit ${item.name}`}
                          className="text-slate-400 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-0.5"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => removeFromCart(item.cartKey)}
                          aria-label={`Remove ${item.name}`}
                          className="text-slate-400 hover:text-red-600 focus:outline-none focus:ring-1 focus:ring-red-500 rounded"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                {/* Promo code */}
                <div className="mt-4 space-y-1.5">
                  <span className="block text-xs font-medium text-slate-600">Promo Code</span>
                  <div className="flex gap-2">
                    <input type="text" value={appliedPromo ? appliedPromo.code : promoInput}
                      onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null); }}
                      disabled={!!appliedPromo} placeholder="e.g. BOBA10"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50 disabled:text-slate-500" />
                    {appliedPromo ? (
                      <button type="button" onClick={() => { setAppliedPromo(null); setPromoInput(""); }}
                        className="secondary-btn px-3 py-2 text-xs">Remove</button>
                    ) : (
                      <button type="button"
                        onClick={() => promoFetcher.submit({ intent: "verify-promo", code: promoInput }, { method: "post" })}
                        disabled={!promoInput.trim() || promoFetcher.state !== "idle"}
                        className="secondary-btn px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                        {promoFetcher.state !== "idle" ? "…" : "Apply"}
                      </button>
                    )}
                  </div>
                  {appliedPromo && <p className="text-xs text-emerald-600 font-medium">{appliedPromo.discountPct}% off applied</p>}
                  {promoError && <p className="text-xs text-red-600">{promoError}</p>}
                </div>

                <div className="mt-3 flex items-center justify-between font-bold text-slate-900 text-base">
                  <span>{translatedUI.total}</span><span>${adjustedTotal.toFixed(2)}</span>
                </div>
                {redeemDiscount > 0 && (
                  <p className="text-xs text-emerald-600 text-right">-${redeemDiscount.toFixed(2)} {translatedUI.pointsDiscount}</p>
                )}
                {promoDiscountAmt > 0 && (
                  <p className="text-xs text-emerald-600 text-right">-${promoDiscountAmt.toFixed(2)} promo ({appliedPromo?.discountPct}% off)</p>
                )}
                {lookedUpCustomer && lookedUpCustomer !== "not-found" && availablePoints >= 100 && (
                  <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-700">{translatedUI.redeemPoints}</span>
                      <span className="text-xs text-indigo-500">{remainingPoints} {translatedUI.ptsLeft}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setRedeem300(r => r + 1)}
                        disabled={remainingPoints < 300}
                        className="text-xs px-2 py-1.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                        {translatedUI.pts300}
                      </button>
                      <button type="button" onClick={() => setRedeem100(r => r + 1)}
                        disabled={remainingPoints < 100}
                        className="text-xs px-2 py-1.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                        {translatedUI.pts100}
                      </button>
                      <button type="button" onClick={applyAllPoints}
                        className="text-xs px-2 py-1.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100">
                        {translatedUI.applyAll}
                      </button>
                    </div>
                    {pointsUsed > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-indigo-600">{pointsUsed} pts → -${redeemDiscount.toFixed(2)} off</span>
                        <button type="button" onClick={() => { setRedeem300(0); setRedeem100(0); }}
                          className="text-xs text-slate-400 hover:text-red-500">{translatedUI.clear}</button>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  <span className="block text-xs font-medium text-slate-600">{translatedUI.phoneLabel}</span>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={e => { setCustomerPhone(e.target.value); setLookedUpCustomer(null); }}
                      placeholder="555-867-5309"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!customerPhone.trim()) return;
                        lookupFetcher.submit(
                          { intent: "lookup-customer", phone: customerPhone.trim() },
                          { method: "post" }
                        );
                      }}
                      disabled={!customerPhone.trim() || lookupFetcher.state !== "idle"}
                      className="secondary-btn px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {lookupFetcher.state !== "idle" ? "…" : translatedUI.lookUp}
                    </button>
                  </div>
                  {lookedUpCustomer === "not-found" && (
                    <p className="text-xs text-amber-600">{translatedUI.noAccount}</p>
                  )}
                  {lookedUpCustomer && lookedUpCustomer !== "not-found" && (
                    <p className="text-xs text-emerald-600 font-medium">
                      Welcome back, {lookedUpCustomer.name}! · {lookedUpCustomer.points} pts
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    const payload: Record<string, string> = {
                      cart: JSON.stringify(cart.map(i => ({
                        id: i.id, price: i.price, qty: i.qty,
                        size: i.size, iceLevel: i.iceLevel, milkType: i.milkType,
                        toppingNames: i.toppings.map(t => t.name),
                        temperature: i.temperature || null,
                        sweetness: i.sweetness,
                      }))),
                      redeem300: String(redeem300),
                      redeem100: String(redeem100),
                      promoCode: appliedPromo?.code ?? "",
                    };
                    if (lookedUpCustomer && lookedUpCustomer !== "not-found") {
                      payload.customerId   = lookedUpCustomer.id;
                      payload.customerName = lookedUpCustomer.name;
                    } else if (customerPhone.trim()) {
                      payload.customerPhone = customerPhone.trim();
                    }
                    fetcher.submit(payload, { method: "post" });
                  }}
                  disabled={fetcher.state !== "idle"}
                  className="primary-btn mt-4 w-full py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {fetcher.state !== "idle" ? translatedUI.placingOrder : translatedUI.placeOrder}
                </button>
                {"ok" in (fetcher.data ?? {}) && !(fetcher.data as { ok: boolean }).ok && (
                  <p className="text-xs text-red-600 mt-2 text-center">
                    {"error" in fetcher.data! ? (fetcher.data as { error: string }).error : "Failed to place order"}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="section-card p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="section-title">{translatedUI.menuTitle}</h2>
                <p className="section-description">{translatedUI.menuDesc}</p>
              </div>
              <button
                onClick={() => setShowCart(true)}
                className="primary-btn px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 whitespace-nowrap"
              >
                {translatedUI.cartLabel} ({totalItems})
              </button>
            </div>

            {/* Allergen filter */}
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-800 mb-2">{translatedUI.allergenFilter}</p>
              <div className="flex flex-wrap gap-2">
                {ALL_ALLERGENS.map(allergen => {
                  const blocked = blockedAllergens.includes(allergen);
                  return (
                    <button
                      key={allergen}
                      onClick={() => setBlockedAllergens(prev =>
                        blocked ? prev.filter(a => a !== allergen) : [...prev, allergen]
                      )}
                      aria-pressed={blocked}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500
                        ${blocked ? "bg-amber-600 border-amber-600 text-white" : "bg-white border-amber-300 text-amber-800 hover:bg-amber-100"}`}
                    >
                      {allergen.replace("-", " ")}
                    </button>
                  );
                })}
                {blockedAllergens.length > 0 && (
                  <button
                    onClick={() => setBlockedAllergens([])}
                    className="px-3 py-1 rounded-full text-xs font-semibold border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    {translatedUI.clearAll}
                  </button>
                )}
              </div>
              {blockedAllergens.length > 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  {translatedUI.hidingItems} {blockedAllergens.map(a => a.replace("-", " ")).join(", ")}
                </p>
              )}
            </div>

            <div className="mb-5">
              <div
                className="grid gap-2 w-full"
                style={{ gridTemplateColumns: `repeat(${translatedCategories.length + 1}, minmax(0, 1fr))` }}
              >
                {translatedCategories.map((cat, i) => (
                  <button
                    key={i}
                    onClick={() => { setActiveCategory(i); setShowCart(false); }}
                    aria-pressed={activeCategory === i}
                    className={`px-3 py-2.5 rounded-lg text-sm font-semibold text-center transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500
                      ${activeCategory === i ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200"}`}
                  >
                    {cat}
                  </button>
                ))}
                <button
                  onClick={() => { setActiveCategory(translatedCategories.length); setShowCart(false); }}
                  aria-pressed={activeCategory === translatedCategories.length}
                  className={`px-3 py-2.5 rounded-lg text-sm font-semibold text-center transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500
                    ${activeCategory === translatedCategories.length ? "bg-purple-600 text-white shadow-sm" : "bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200"}`}
                >
                  Surprise Me
                </button>
              </div>
            </div>

            {activeCategory === translatedCategories.length ? (
              <div>
                <div className="mb-5 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                  <p className="text-sm font-semibold text-purple-800 mb-3">Exclude allergens from your surprise:</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_ALLERGENS.map(allergen => {
                      const blocked = surpriseExcluded.includes(allergen);
                      return (
                        <button
                          key={allergen}
                          onClick={() => setSurpriseExcluded(prev =>
                            blocked ? prev.filter(a => a !== allergen) : [...prev, allergen]
                          )}
                          aria-pressed={blocked}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500
                            ${blocked ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-purple-300 text-purple-800 hover:bg-purple-100"}`}
                        >
                          {allergen.replace("-", " ")}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={() => setSurpriseResult(generateSurprise(
                          Object.entries(menuItems)
                            .filter(([cat]) => !["Coffee", "Seasonal", "Specialty"].includes(cat))
                            .flatMap(([, items]) => items),
                          surpriseExcluded
                        ))}
                  className="primary-btn w-full py-3 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                >
                  Surprise Me!
                </button>
                {surpriseResult && (() => {
                  const r = surpriseResult;
                  const sizeUpcharge = SIZES.find(s => s.value === r.size)?.upcharge ?? 0;
                  const totalPrice = parseFloat((r.item.price + sizeUpcharge + r.toppings.reduce((s, t) => s + t.price, 0)).toFixed(2));
                  return (
                    <div className="section-card p-5 border-purple-300 bg-purple-50">
                      <h3 className="text-lg font-bold text-slate-900 mb-0.5">{r.item.name}</h3>
                      <p className="text-slate-500 text-sm mb-4">${totalPrice.toFixed(2)}</p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mb-5">
                        <dt className="text-slate-500">Size</dt>
                        <dd className="text-slate-800 font-medium">{r.size} ({SIZES.find(s => s.value === r.size)?.oz})</dd>
                        <dt className="text-slate-500">Sweetness</dt>
                        <dd className="text-slate-800 font-medium">{r.sweetness}%</dd>
                        <dt className="text-slate-500">Ice</dt>
                        <dd className="text-slate-800 font-medium">{r.iceLevel}</dd>
                        <dt className="text-slate-500">Toppings</dt>
                        <dd className="text-slate-800 font-medium">{r.toppings.length > 0 ? r.toppings.map(t => t.name).join(", ") : "None"}</dd>
                      </dl>
                      <div className="flex gap-3">
                        <button
                          onClick={() => {
                            const toppingIds = r.toppings.map(t => t.id).sort().join(",");
                            const milkType   = r.item.hasMilk ? "Whole Milk" : "No Milk";
                            const key        = `${r.item.id}-${r.size}-${milkType}-${r.iceLevel}-cold-${r.sweetness}-${toppingIds}`;
                            const sizedPrice = parseFloat((r.item.price + sizeUpcharge).toFixed(2));
                            const newItem: CartItem = {
                              cartKey: key, id: r.item.id, name: r.item.name,
                              basePrice: r.item.price, price: sizedPrice + r.toppings.reduce((s, t) => s + t.price, 0),
                              qty: 1, size: r.size, milkType, iceLevel: r.iceLevel, toppings: r.toppings,
                              temperature: r.item.hasTemperature ? "cold" : "",
                              sweetness: r.sweetness,
                            };
                            setCart(prev => {
                              const existing = prev.find(o => o.cartKey === key);
                              if (existing) return prev.map(o => o.cartKey === key ? { ...o, qty: o.qty + 1 } : o);
                              return [...prev, newItem];
                            });
                            setSurpriseResult(null);
                          }}
                          className="primary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          Add to Cart
                        </button>
                        <button
                          onClick={() => setSurpriseResult(generateSurprise(
                          Object.entries(menuItems)
                            .filter(([cat]) => !["Coffee", "Seasonal", "Specialty"].includes(cat))
                            .flatMap(([, items]) => items),
                          surpriseExcluded
                        ))}
                          className="secondary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
                        >
                          Try Again
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <h3 className="text-base font-semibold text-slate-900">{translatedCurrentCategory}</h3>
                  <p className="section-description">{translatedUI.availableItems}</p>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {items
                    .filter(item => !item.allergens.some(a => blockedAllergens.includes(a)))
                    .map(item => (
                      <button
                        key={item.id}
                        onClick={() => openItem(item)}
                        className="section-card p-5 text-left hover:bg-indigo-50 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                      >
                        <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                        <p className="text-sm text-slate-500 mt-1">${item.price.toFixed(2)}</p>
                        {item.description && (
                          <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-snug">{item.description}</p>
                        )}
                        {item.allergens.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1" aria-label={`Contains: ${item.allergens.join(", ")}`}>
                            {item.allergens.map(a => (
                              <span key={a} className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-1.5 py-0.5">
                                {ALLERGEN_ICONS[a]} {a.replace("-", " ")}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                </div>
                {items.filter(item => !item.allergens.some(a => blockedAllergens.includes(a))).length === 0 && (
                  <p className="text-sm text-slate-500 py-8 text-center">
                    {items.length === 0
                      ? translatedUI.noItems
                      : translatedUI.allItemsFiltered}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <footer className="soft-footer px-6 py-1.5 shrink-0">
        <p className="text-xs">{translatedUI.footer}</p>
      </footer>

      {orderConfirmation && (
        <div
          className="fixed inset-0 bg-black/55 flex items-center justify-center z-60 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-confirm-title"
        >
          <div className="surface-card max-w-md w-full p-8 text-center space-y-4">
            <p id="order-confirm-title" className="text-2xl font-bold text-slate-900">
              {translatedUI.orderThankYou}
            </p>
            <p className="text-slate-600 text-sm">{translatedUI.orderReceived}</p>
            <div className="rounded-xl bg-indigo-50 border border-indigo-200 py-6 px-4">
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                {translatedUI.orderNumberLabel}
              </p>
              <p className="text-4xl font-black text-indigo-900 mt-1 tabular-nums tracking-tight">
                #{orderConfirmation.orderNumber}
              </p>
              <p className="text-sm text-slate-600 mt-3">
                {translatedUI.orderTotalLabel}:{" "}
                <span className="font-semibold text-slate-900">${orderConfirmation.total}</span>
              </p>
              <div className="mt-4 flex flex-col items-center gap-1.5">
                <img
                  src={qrCodeUrl(receiptQrData({ orderNumber: orderConfirmation.orderNumber, total: orderConfirmation.total }))}
                  alt="Order receipt QR code"
                  width={140}
                  height={140}
                  className="rounded-lg border border-indigo-200 bg-white p-1"
                />
                <p className="text-[10px] text-indigo-600 font-medium">Scan for receipt</p>
              </div>
            </div>
            <p className="text-xs text-slate-500">{translatedUI.payAtCounter}</p>
            <button
              type="button"
              className="primary-btn w-full py-3"
              onClick={() => setOrderConfirmation(null)}
            >
              {translatedUI.startNewOrder}
            </button>
          </div>
        </div>
      )}

      {/* AI chat launcher + popup */}
      <div className="fixed right-5 bottom-5 z-40">
        {chatOpen ? (
          <div className="w-[340px] max-w-[90vw] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="bg-indigo-600 text-white px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Boba Assistant</p>
                <p className="text-[11px] text-indigo-100">Quick menu help</p>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="text-indigo-100 hover:text-white text-lg leading-none"
                aria-label="Close chat"
              >
                ×
              </button>
            </div>
            <div className="h-72 overflow-y-auto bg-slate-50 px-3 py-3 space-y-2">
              {chatMessages.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "ml-auto bg-indigo-600 text-white"
                      : "mr-auto bg-white border border-slate-200 text-slate-700"
                  }`}
                >
                  {msg.text}
                </div>
              ))}
              {chatFetcher.state !== "idle" && (
                <div className="mr-auto bg-white border border-slate-200 text-slate-500 rounded-2xl px-3 py-2 text-sm">
                  Thinking...
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 p-3 bg-white">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChatMessage();
                  }}
                  placeholder="Ask about drinks, toppings, allergens..."
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={sendChatMessage}
                  disabled={!chatInput.trim() || chatFetcher.state !== "idle"}
                  className="primary-btn px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            aria-label="Open AI chat"
            className="h-14 w-14 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-2xl"
          >
            ✦
          </button>
        )}
      </div>

      {/* Customization popup */}
      {selectedItem && !oaMode && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Customize ${selectedItem.name}`}
          onClick={e => { if (e.target === e.currentTarget) closePopup(); }}
        >
          <div className="surface-card w-full max-w-md p-6 overflow-y-auto max-h-[90vh]">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedItem.name}</h2>
                <p className="text-slate-500 text-sm mt-0.5">${modalPrice.toFixed(2)}</p>
                {selectedItem.description && (
                  <p className="text-xs text-slate-400 mt-1.5 leading-snug max-w-[240px]">{selectedItem.description}</p>
                )}
              </div>
              {selectedItem.allergens.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-slate-400 mb-1">{translatedUI.contains}</p>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {selectedItem.allergens.map(a => (
                      <span key={a} title={a.replace("-", " ")}
                        className="inline-flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-2 py-0.5">
                        {a.replace("-", " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Size */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">{translatedUI.size}</p>
              <div className="grid grid-cols-2 gap-2">
                {SIZES.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setSize(s.value)}
                    aria-pressed={size === s.value}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${size === s.value ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                  >
                    <span className="block font-bold">{s.value === "Regular" ? translatedUI.sizeRegular : translatedUI.sizeLarge}</span>
                    <span className="block text-[10px] opacity-75">{s.oz}{s.upcharge > 0 ? ` +$${s.upcharge.toFixed(2)}` : ""}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Temperature */}
            {selectedItem.hasTemperature && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-700 mb-2">{translatedUI.temperature}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["hot", "cold"] as const).map(temp => (
                    <button
                      key={temp}
                      onClick={() => setTemperature(temp)}
                      aria-pressed={temperature === temp}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${temperature === temp ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                    >
                      {temp === "hot" ? translatedUI.tempHot : translatedUI.tempCold}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sweetness */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">{translatedUI.sweetness}</p>
              <div className="grid grid-cols-5 gap-1.5">
                {SWEETNESS_OPTIONS.map(pct => (
                  <button
                    key={pct}
                    onClick={() => setSweetness(pct)}
                    aria-pressed={sweetness === pct}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${sweetness === pct ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            {/* Ice level */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">{translatedUI.iceLevel}</p>
              <div className="grid grid-cols-4 gap-2">
                {translatedIceLevels.map((level, i) => (
                  <button
                    key={ICE_LEVELS[i]}
                    onClick={() => setIceLevel(ICE_LEVELS[i])}
                    aria-pressed={iceLevel === ICE_LEVELS[i]}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${iceLevel === ICE_LEVELS[i] ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Milk type */}
            {selectedItem.hasMilk && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-700 mb-2">{translatedUI.milkType}</p>
                <div className="grid grid-cols-3 gap-2">
                  {translatedMilkTypes.map((level, i) => (
                    <button
                      key={MILK_TYPES[i]}
                      onClick={() => setMilkType(MILK_TYPES[i])}
                      aria-pressed={milkType === MILK_TYPES[i]}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${milkType === MILK_TYPES[i] ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Toppings */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">{translatedUI.toppings} <span className="text-slate-400 font-normal">{translatedUI.toppingPrice}</span></p>
              <div className="grid grid-cols-2 gap-2">
                {translatedToppings.map((topping) => {
                  const hasBlocked = topping.allergens.some(a => blockedAllergens.includes(a));
                  return (
                    <button
                      key={topping.id}
                      onClick={() => toggleTopping(topping.id)}
                      aria-pressed={selectedToppings.includes(topping.id)}
                      className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${selectedToppings.includes(topping.id)
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : hasBlocked
                          ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                          : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                        }`}
                    >
                      <span>{topping.name}</span>
                      {hasBlocked && <span className="block text-amber-600 font-normal" style={{fontSize:"10px"}}>contains your allergen</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                onClick={closePopup}
                className="secondary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
              >
                {translatedUI.cancel}
              </button>
              <button
                onClick={confirmAddToCart}
                className="primary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors"
              >
                {editCartKey ? translatedUI.updateItem : translatedUI.addToCart}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
