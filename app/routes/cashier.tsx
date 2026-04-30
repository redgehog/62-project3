import { useState, useEffect, useContext } from "react";
import { Form, redirect, useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/cashier";
import pool from "../db.server";
import type { PoolClient } from "pg";
import {
  destroyCashierSession,
  getCashierSession,
  requireCashierAccess,
} from "../cashier-access.server";
import { translateText } from "../translate";
import { TranslationContext } from "../root";
import { applyTax, TAX_RATE } from "../lib/pricing";
import { qrCodeUrl, receiptQrData } from "../lib/qr";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Cashier — Boba House" }];
}

const MILK_TYPES       = ["Whole Milk", "Oat Milk", "Almond Milk", "Soy Milk", "No Milk"];
const ICE_LEVELS       = ["No Ice", "Less Ice", "Regular", "Extra Ice"];
const SWEETNESS_OPTIONS = [25, 50, 75, 100, 125];

const SIZES = [
  { value: "Regular" as const, oz: "16oz", upcharge: 0.00 },
  { value: "Large"   as const, oz: "24oz", upcharge: 1.25 },
];

type SizeValue = "Regular" | "Large";

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

const ALL_ALLERGENS = ["dairy", "soy", "tree-nuts", "gluten", "eggs"] as const;

const normalizePhone = (p: string) => p.replace(/\D/g, "");

export async function loader({ request }: Route.LoaderArgs) {
  await requireCashierAccess(request);
  const result = await pool.query(
    `SELECT item_id::text AS id, name, category, price::float AS price,
            COALESCE(is_seasonal, false) AS "isSeasonal", milk,
            COALESCE(has_temperature, false) AS "hasTemperature",
            COALESCE(allergens, '{}') AS allergens,
            COALESCE(description, '') AS description
     FROM "Item"
     WHERE is_active = true
     ORDER BY category, name`
  );

  const rows = result.rows as {
    id: string; name: string; category: string; price: number;
    isSeasonal: boolean; milk: string; hasTemperature: boolean;
    allergens: string[]; description: string;
  }[];
  const byCategory: Record<string, { id: string; name: string; price: number; hasMilk: boolean; hasTemperature: boolean; allergens: string[]; description: string }[]> = {};
  const categories: string[] = [];

  for (const row of rows) {
    if (!byCategory[row.category]) {
      byCategory[row.category] = [];
      categories.push(row.category);
    }
    const item = {
      id: row.id, name: row.name, price: row.price,
      hasMilk: !!row.milk && row.milk.toLowerCase() !== "none" && row.milk.trim() !== "",
      hasTemperature: row.hasTemperature,
      allergens: row.allergens ?? [],
      description: row.description ?? "",
    };
    byCategory[row.category].push(item);
    if (row.isSeasonal) {
      if (!byCategory["Seasonal"]) {
        byCategory["Seasonal"] = [];
        categories.push("Seasonal");
      }
      byCategory["Seasonal"].push(item);
    }
  }

  return { categories, byCategory };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "logout") {
    const session = await getCashierSession(request);
    return redirect("/portal", {
      headers: { "Set-Cookie": await destroyCashierSession(session) },
    });
  }

  if (intent === "lookup-customer") {
    await requireCashierAccess(request);
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

  if (intent === "verify-pin") {
    await requireCashierAccess(request);
    const pin = String(formData.get("pin") || "").trim();
    const session = await getCashierSession(request);
    const sessionEmployeeId = session.get("cashier:employeeId") as string | undefined;
    const result = sessionEmployeeId
      ? await pool.query(
          `SELECT 1 FROM "Employee" WHERE employee_id = $1::uuid AND pin = $2 LIMIT 1`,
          [sessionEmployeeId, pin]
        )
      : await pool.query(`SELECT 1 FROM "Employee" WHERE pin = $1 LIMIT 1`, [pin]);
    return { ok: result.rows.length > 0 };
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

  await requireCashierAccess(request);
  const items = JSON.parse(formData.get("cart") as string) as Array<{
    id: string; price: number; qty: number;
    size: string; iceLevel: string; milkType: string;
    toppingNames: string[]; temperature: string | null; sweetness: number | null;
  }>;
  const customerName = String(formData.get("customerName") || "").trim();

  if (!items.length) return { ok: false };
  if (!customerName) return { ok: false, error: "Customer name is required" };

  const session = await getCashierSession(request);
  const sessionEmployeeId = session.get("cashier:employeeId") as string | undefined;

  const formCustomerId    = String(formData.get("customerId")    || "").trim();
  const formCustomerPhone = normalizePhone(String(formData.get("customerPhone") || ""));

  const empRow = await (sessionEmployeeId
    ? pool.query(`SELECT employee_id FROM "Employee" WHERE employee_id = $1::uuid LIMIT 1`, [sessionEmployeeId])
    : pool.query(`SELECT employee_id FROM "Employee" LIMIT 1`));
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
        [customerName, formCustomerPhone]
      );
      customerId = created.rows[0].customer_id;
    }
    earnPoints = true;
  } else {
    const fallback = await pool.query(`SELECT customer_id FROM "Customer" LIMIT 1`);
    customerId = fallback.rows[0]?.customer_id;
    if (!customerId) return { ok: false, error: "No customer record found" };
  }

  const subtotal    = items.reduce((s, i) => s + i.price * i.qty, 0);
  const totalPrice  = applyTax(subtotal);
  const totalQty    = items.reduce((s, i) => s + i.qty, 0);

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
      `SELECT discount_pct::float AS "discountPct" FROM promo_codes
       WHERE code = $1 AND is_active = true LIMIT 1`,
      [promoCodeInput]
    );
    promoDiscountPct = pr.rows[0]?.discountPct ?? 0;
  }
  const promoDiscountAmt = parseFloat((afterPoints * promoDiscountPct / 100).toFixed(2));
  const discountedTotal  = parseFloat(Math.max(0, afterPoints - promoDiscountAmt).toFixed(2));

  const client = await pool.connect();
  let orderId: string;
  let placedOrderNumber: number | undefined;
  try {
    await client.query("BEGIN");
    const orderNumber = await getNextOrderNumber(client);
    placedOrderNumber = orderNumber;
    const { rows } = await client.query(
      `INSERT INTO "Order" (order_id, employee_id, customer_id, date, total_price, payment_method, item_quantity, customer_name, order_number)
       VALUES (gen_random_uuid(), $1, $2, now(), $3, 'Cash', $4, $5, $6) RETURNING order_id`,
      [employeeId, customerId, discountedTotal.toFixed(2), totalQty, customerName, orderNumber]
    );
    orderId = rows[0].order_id;

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

const ALLERGEN_ICONS: Record<string, string> = {
  dairy:       "🥛",
  soy:         "🫘",
  "tree-nuts": "🌰",
  gluten:      "🌾",
  eggs:        "🥚",
};

interface CashierMenuItem {
  id:             string;
  name:           string;
  price:          number;
  hasMilk:        boolean;
  hasTemperature: boolean;
  allergens:      string[];
  description:    string;
}

function generateSurprise(allItems: CashierMenuItem[], excluded: string[]) {
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

interface OrderItem {
  cartKey:        string;
  id:             string;
  name:           string;
  basePrice:      number;
  price:          number;
  qty:            number;
  size:           SizeValue;
  milkType:       string;
  iceLevel:       string;
  toppings:       Topping[];
  temperature:    string;
  sweetness:      number;
  priceOverridden: boolean;
}

export default function Cashier() {
  const navigate = useNavigate();
  const { categories, byCategory } = useLoaderData<typeof loader>();
  const fetcher       = useFetcher<typeof action>();
  const lookupFetcher = useFetcher<typeof action>();
  const pinFetcher    = useFetcher<typeof action>();
  const promoFetcher  = useFetcher<typeof action>();

  const translationContext = useContext(TranslationContext);
  const language = translationContext?.language ?? "en";

  useEffect(() => {
    if (!sessionStorage.getItem("loggedIn")) navigate("/cashier-login");
  }, []);

  const [activeCategory, setActiveCategory]     = useState(() => categories[0] ?? "");
  const [blockedAllergens, setBlockedAllergens] = useState<string[]>([]);
  const [translatedCategories, setTranslatedCategories] = useState(categories);
  const [translatedMilkTypes, setTranslatedMilkTypes]   = useState(MILK_TYPES);
  const [translatedIceLevels, setTranslatedIceLevels]   = useState(ICE_LEVELS);
  const [translatedToppings, setTranslatedToppings]     = useState(TOPPINGS);
  const [translatedUI, setTranslatedUI] = useState({ menu: "Menu", select: "Select items to build the current order." });

  const translatedCategoryByName = categories.reduce<Record<string, string>>((acc, cat, i) => {
    acc[cat] = translatedCategories[i] ?? cat;
    return acc;
  }, {});

  useEffect(() => {
    if (language === "en") {
      setTranslatedCategories(categories);
      setTranslatedMilkTypes(MILK_TYPES);
      setTranslatedIceLevels(ICE_LEVELS);
      setTranslatedToppings(TOPPINGS);
      setTranslatedUI({ menu: "Menu", select: "Select items to build the current order." });
      return;
    }
    Promise.all(categories.map(cat => translateText(cat, { to: language }))).then(setTranslatedCategories);
    Promise.all(MILK_TYPES.map(mt => translateText(mt, { to: language }))).then(setTranslatedMilkTypes);
    Promise.all(ICE_LEVELS.map(il => translateText(il, { to: language }))).then(setTranslatedIceLevels);
    Promise.all(TOPPINGS.map(async t => ({ ...t, name: await translateText(t.name, { to: language }) }))).then(setTranslatedToppings);
    Promise.all([
      translateText("Menu", { to: language }),
      translateText("Select items to build the current order.", { to: language }),
    ]).then(([menu, select]) => setTranslatedUI({ menu, select }));
  }, [language, categories]);

  const [orderItems, setOrderItems]             = useState<OrderItem[]>([]);
  const [selectedItem, setSelectedItem]         = useState<CashierMenuItem | null>(null);
  const [editCartKey, setEditCartKey]           = useState<string | null>(null);
  const [size, setSize]                         = useState<SizeValue>("Regular");
  const [milkType, setMilkType]                 = useState("Whole Milk");
  const [iceLevel, setIceLevel]                 = useState("Regular");
  const [temperature, setTemperature]           = useState("cold");
  const [sweetness, setSweetness]               = useState(100);
  const [selectedToppings, setSelectedToppings] = useState<number[]>([]);
  const [priceOverride, setPriceOverride]       = useState("");
  const [pinInput, setPinInput]                 = useState("");
  const [pinError, setPinError]                 = useState<string | null>(null);
  const [promoInput, setPromoInput]             = useState("");
  const [appliedPromo, setAppliedPromo]         = useState<{ code: string; discountPct: number } | null>(null);
  const [promoError, setPromoError]             = useState<string | null>(null);
  const [customerName, setCustomerName]         = useState("");
  const [customerPhone, setCustomerPhone]       = useState("");
  const [lookedUpCustomer, setLookedUpCustomer] = useState<{ id: string; name: string; points: number } | "not-found" | null>(null);
  const [redeem300, setRedeem300]               = useState(0);
  const [redeem100, setRedeem100]               = useState(0);
  const [surpriseExcluded, setSurpriseExcluded] = useState<string[]>([]);
  const [surpriseResult,   setSurpriseResult]   = useState<ReturnType<typeof generateSurprise>>(null);
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
      setOrderItems([]);
      setCustomerName("");
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
      const c = data.customer as { id: string; name: string; points: number };
      setLookedUpCustomer(c);
      setCustomerName(c.name);
    } else if ("notFound" in data) {
      setLookedUpCustomer("not-found");
    }
  }, [lookupFetcher.state, lookupFetcher.data]);

  useEffect(() => {
    if (pinFetcher.state !== "idle" || !pinFetcher.data) return;
    const data = pinFetcher.data as { ok: boolean };
    if (data.ok) {
      const override = priceOverride.trim() ? parseFloat(priceOverride) : null;
      doAddToCart(override);
      setPinError(null);
      setPinInput("");
    } else {
      setPinError("Incorrect PIN — try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinFetcher.state, pinFetcher.data]);

  useEffect(() => {
    if (promoFetcher.state !== "idle" || !promoFetcher.data) return;
    const data = promoFetcher.data;
    if ("promo" in data && data.ok) {
      setAppliedPromo((data as { ok: true; promo: { code: string; discountPct: number } }).promo);
      setPromoError(null);
    } else if ("error" in data) {
      setPromoError((data as { error: string }).error);
      setAppliedPromo(null);
    }
  }, [promoFetcher.state, promoFetcher.data]);

  useEffect(() => {
    if (!selectedItem) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") closePopup(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem]);

  const resetPopupState = () => {
    setPriceOverride("");
    setPinInput("");
    setPinError(null);
  };

  const openItem = (item: CashierMenuItem) => {
    setSelectedItem(item);
    setEditCartKey(null);
    setSize("Regular");
    setMilkType("Whole Milk");
    setIceLevel("Regular");
    setTemperature("cold");
    setSweetness(100);
    setSelectedToppings([]);
    resetPopupState();
  };

  const openItemForEdit = (cartItem: OrderItem) => {
    const menuItem = Object.values(byCategory).flat().find(i => i.id === cartItem.id);
    if (!menuItem) return;
    setSelectedItem(menuItem);
    setEditCartKey(cartItem.cartKey);
    setSize(cartItem.size);
    setMilkType(cartItem.milkType);
    setIceLevel(cartItem.iceLevel);
    setTemperature(cartItem.temperature || "cold");
    setSweetness(cartItem.sweetness || 100);
    setSelectedToppings(cartItem.toppings.map(t => t.id));
    resetPopupState();
  };

  const closePopup = () => { setSelectedItem(null); setEditCartKey(null); resetPopupState(); };

  const toggleTopping = (id: number) =>
    setSelectedToppings(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const doAddToCart = (overridePrice: number | null) => {
    if (!selectedItem) return;
    const toppings   = TOPPINGS.filter(t => selectedToppings.includes(t.id));
    const toppingIds = toppings.map(t => t.id).sort().join(",");
    const key        = `${selectedItem.id}-${size}-${milkType}-${iceLevel}-${temperature}-${sweetness}-${toppingIds}`;
    const sizeUpcharge = SIZES.find(s => s.value === size)?.upcharge ?? 0;
    const sizedPrice   = parseFloat((selectedItem.price + sizeUpcharge).toFixed(2));
    const calculated   = parseFloat((sizedPrice + toppings.reduce((s, t) => s + t.price, 0)).toFixed(2));
    const finalPrice   = overridePrice !== null ? overridePrice : calculated;
    const newItem: OrderItem = {
      cartKey: key, id: selectedItem.id, name: selectedItem.name,
      basePrice: selectedItem.price, price: finalPrice,
      qty: 1, size, milkType, iceLevel, toppings,
      temperature: selectedItem.hasTemperature ? temperature : "",
      sweetness,
      priceOverridden: overridePrice !== null && overridePrice !== calculated,
    };
    setOrderItems(prev => {
      if (editCartKey) {
        const oldItem = prev.find(o => o.cartKey === editCartKey);
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
    closePopup();
  };

  const handleAddToOrder = () => {
    if (!selectedItem) return;
    const overrideVal     = priceOverride.trim() ? parseFloat(priceOverride) : null;
    const sizeUpcharge    = SIZES.find(s => s.value === size)?.upcharge ?? 0;
    const calculated      = parseFloat((selectedItem.price + sizeUpcharge + selectedToppings.length * 0.75).toFixed(2));
    const hasOverride     = overrideVal !== null && overrideVal !== calculated;
    if (hasOverride) {
      pinFetcher.submit({ intent: "verify-pin", pin: pinInput }, { method: "post" });
    } else {
      doAddToCart(null);
    }
  };

  const removeItem = (cartKey: string) => setOrderItems(prev => prev.filter(o => o.cartKey !== cartKey));

  const subtotal        = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const tax             = subtotal * TAX_RATE;
  const total           = subtotal + tax;
  const availablePoints = lookedUpCustomer && lookedUpCustomer !== "not-found" ? lookedUpCustomer.points : 0;
  const pointsUsed      = redeem300 * 300 + redeem100 * 100;
  const remainingPoints = availablePoints - pointsUsed;
  const redeemDiscount  = redeem300 * 4 + redeem100 * 1;
  const afterPoints     = Math.max(0, total - redeemDiscount);
  const promoDiscountAmt = appliedPromo ? parseFloat((afterPoints * appliedPromo.discountPct / 100).toFixed(2)) : 0;
  const adjustedTotal   = Math.max(0, afterPoints - promoDiscountAmt);
  const submitting      = fetcher.state !== "idle";

  const applyAllPoints = () => {
    const max300 = Math.floor(availablePoints / 300);
    const max100 = Math.floor((availablePoints - max300 * 300) / 100);
    setRedeem300(max300);
    setRedeem100(max100);
  };

  const handleLookup = () => {
    if (!customerPhone.trim()) return;
    lookupFetcher.submit({ intent: "lookup-customer", phone: customerPhone.trim() }, { method: "post" });
  };

  const handleSubmit = () => {
    if (orderItems.length === 0 || !customerName.trim()) return;
    const payload: Record<string, string> = {
      cart: JSON.stringify(orderItems.map(i => ({
        id: i.id, price: i.price, qty: i.qty,
        size: i.size, iceLevel: i.iceLevel, milkType: i.milkType,
        toppingNames: i.toppings.map(t => t.name),
        temperature: i.temperature || null,
        sweetness: i.sweetness,
      }))),
      customerName: customerName.trim(),
      redeem300: String(redeem300),
      redeem100: String(redeem100),
      promoCode: appliedPromo?.code ?? "",
    };
    if (lookedUpCustomer && lookedUpCustomer !== "not-found") {
      payload.customerId = lookedUpCustomer.id;
    } else if (customerPhone.trim()) {
      payload.customerPhone = customerPhone.trim();
    }
    fetcher.submit(payload, { method: "post" });
  };

  const items = byCategory[activeCategory] ?? [];

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
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Cashier Workspace</span>
        </div>
      </header>

      <nav className="bg-white/80 backdrop-blur border-b border-slate-200 flex shrink-0 overflow-x-auto" aria-label="Menu categories">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            aria-pressed={activeCategory === cat}
            className={`flex-1 min-w-max py-3 px-4 text-sm font-semibold border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600 whitespace-nowrap
              ${activeCategory === cat
                ? "border-indigo-500 text-indigo-700 bg-indigo-50"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
          >
            {translatedCategoryByName[cat] ?? cat}
          </button>
        ))}
        <button
          onClick={() => setActiveCategory("__surprise__")}
          aria-pressed={activeCategory === "__surprise__"}
          className={`flex-1 min-w-max py-3 px-4 text-sm font-semibold border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600 whitespace-nowrap
            ${activeCategory === "__surprise__"
              ? "border-purple-500 text-purple-700 bg-purple-50"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
        >
          Surprise Me
        </button>
      </nav>

      <div className="flex-1 page-section w-full flex overflow-hidden px-4 py-5 gap-4">
        {/* Menu grid */}
        <div className="flex-1 section-card p-5 overflow-y-auto">
          <div className="mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="section-title">{translatedUI.menu}</h2>
                <p className="section-description">{translatedUI.select}</p>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="logout" />
                <button type="submit" className="secondary-btn px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  Cashier Logout
                </button>
              </Form>
            </div>
          </div>
          {activeCategory === "__surprise__" ? (
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
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500
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
                          Object.entries(byCategory)
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const toppingIds = r.toppings.map(t => t.id).sort().join(",");
                          const milkType   = r.item.hasMilk ? "Whole Milk" : "No Milk";
                          const key        = `${r.item.id}-${r.size}-${milkType}-${r.iceLevel}-cold-${r.sweetness}-${toppingIds}`;
                          const sizedPrice = parseFloat((r.item.price + sizeUpcharge).toFixed(2));
                          const newItem: OrderItem = {
                            cartKey: key, id: r.item.id, name: r.item.name,
                            basePrice: r.item.price, price: sizedPrice + r.toppings.reduce((s, t) => s + t.price, 0),
                            qty: 1, size: r.size, milkType, iceLevel: r.iceLevel, toppings: r.toppings,
                            temperature: r.item.hasTemperature ? "cold" : "",
                            sweetness: r.sweetness,
                          };
                          setOrderItems(prev => {
                            const existing = prev.find(o => o.cartKey === key);
                            if (existing) return prev.map(o => o.cartKey === key ? { ...o, qty: o.qty + 1 } : o);
                            return [...prev, newItem];
                          });
                          setSurpriseResult(null);
                        }}
                        className="primary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        Add to Order
                      </button>
                      <button
                        onClick={() => setSurpriseResult(generateSurprise(
                          Object.entries(byCategory)
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
            <>{/* Allergen filter */}
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-800 mb-2">Filter allergens — hide items containing:</p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_ALLERGENS.map(allergen => {
                  const blocked = blockedAllergens.includes(allergen);
                  return (
                    <button key={allergen} onClick={() => setBlockedAllergens(prev => blocked ? prev.filter(a => a !== allergen) : [...prev, allergen])}
                      aria-pressed={blocked}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors focus:outline-none
                        ${blocked ? "bg-amber-600 border-amber-600 text-white" : "bg-white border-amber-300 text-amber-800 hover:bg-amber-100"}`}>
                      {ALLERGEN_ICONS[allergen]} {allergen.replace("-"," ")}
                    </button>
                  );
                })}
                {blockedAllergens.length > 0 && (
                  <button onClick={() => setBlockedAllergens([])}
                    className="px-2.5 py-1 rounded-full text-xs font-semibold border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 transition-colors">
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {items.filter(item => !item.allergens.some(a => blockedAllergens.includes(a))).map(item => (
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
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.allergens.map(a => (
                        <span key={a} className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-1.5 py-0.5">
                          {ALLERGEN_ICONS[a]} {a.replace("-"," ")}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
            </>
          )}
        </div>

        {/* Order summary */}
        <aside className="w-72 section-card bg-white/90 backdrop-blur flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-slate-200 shrink-0">
            <h2 className="text-sm font-semibold text-slate-700">Order Summary</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 text-sm">
            {/* Cart items */}
            {orderItems.length === 0 ? (
              <p className="text-slate-400">No items added yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 mb-2">
                {orderItems.map(item => (
                  <div key={item.cartKey} className="flex items-start justify-between py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-800">
                        {item.name} ×{item.qty}
                        {item.priceOverridden && <span className="ml-1 text-xs text-amber-600 font-normal">(override)</span>}
                      </p>
                      <p className="text-slate-400 text-xs mt-0.5 truncate">
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
                    <span className="flex items-center gap-1 text-slate-700 shrink-0 ml-2">
                      <span className="text-xs">${(item.price * item.qty).toFixed(2)}</span>
                      <button onClick={() => openItemForEdit(item)} aria-label={`Edit ${item.name}`}
                        className="text-slate-400 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-0.5">✎</button>
                      <button onClick={() => removeItem(item.cartKey)} aria-label={`Remove ${item.name}`}
                        className="text-slate-400 hover:text-red-600 focus:outline-none focus:ring-1 focus:ring-red-500 rounded">✕</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Checkout fields */}
            <div className="border-t border-slate-200 pt-3 space-y-2">
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-600">Phone Number</span>
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
                  onClick={handleLookup}
                  disabled={!customerPhone.trim() || lookupFetcher.state !== "idle"}
                  className="secondary-btn px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {lookupFetcher.state !== "idle" ? "…" : "Look up"}
                </button>
              </div>
              {lookedUpCustomer === "not-found" && (
                <p className="text-xs text-amber-600">No member found — enter a name below to create one.</p>
              )}
              {lookedUpCustomer && lookedUpCustomer !== "not-found" && (
                <p className="text-xs text-emerald-600 font-medium">
                  Found: {lookedUpCustomer.name} · {lookedUpCustomer.points} pts
                </p>
              )}
            </div>
            <label className="block text-slate-600">
              <span className="mb-1 block text-xs font-medium">
                {lookedUpCustomer === "not-found" ? "Customer Name (new member)" : "Customer Name"}
              </span>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Enter customer name"
              />
            </label>
            {lookedUpCustomer && lookedUpCustomer !== "not-found" && availablePoints >= 100 && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-700">Redeem Points</span>
                  <span className="text-xs text-indigo-500">{remainingPoints} pts left</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setRedeem300(r => r + 1)}
                    disabled={remainingPoints < 300}
                    className="text-xs px-2 py-1 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                    300 pts → $4 off
                  </button>
                  <button type="button" onClick={() => setRedeem100(r => r + 1)}
                    disabled={remainingPoints < 100}
                    className="text-xs px-2 py-1 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                    100 pts → $1 off
                  </button>
                  <button type="button" onClick={applyAllPoints}
                    disabled={availablePoints < 100}
                    className="text-xs px-2 py-1 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                    Apply All
                  </button>
                </div>
                {pointsUsed > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-indigo-600">{pointsUsed} pts → -${redeemDiscount.toFixed(2)} off</span>
                    <button type="button" onClick={() => { setRedeem300(0); setRedeem100(0); }}
                      className="text-xs text-slate-400 hover:text-red-500">Clear</button>
                  </div>
                )}
              </div>
            )}
            {/* Promo code */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-600">Promo Code</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={appliedPromo ? appliedPromo.code : promoInput}
                  onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null); }}
                  disabled={!!appliedPromo}
                  placeholder="BOBA10"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 uppercase focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
                />
                {appliedPromo ? (
                  <button type="button" onClick={() => { setAppliedPromo(null); setPromoInput(""); }}
                    className="secondary-btn px-3 py-2 text-xs">
                    Remove
                  </button>
                ) : (
                  <button type="button"
                    onClick={() => promoFetcher.submit({ intent: "verify-promo", code: promoInput }, { method: "post" })}
                    disabled={!promoInput.trim() || promoFetcher.state !== "idle"}
                    className="secondary-btn px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                    {promoFetcher.state !== "idle" ? "…" : "Apply"}
                  </button>
                )}
              </div>
              {appliedPromo && (
                <p className="text-xs text-emerald-600 font-medium">
                  {appliedPromo.discountPct}% off applied
                </p>
              )}
              {promoError && <p className="text-xs text-red-600">{promoError}</p>}
            </div>

            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax (8.25%)</span><span>${tax.toFixed(2)}</span>
            </div>
            {redeemDiscount > 0 && (
              <div className="flex justify-between text-emerald-600 text-xs">
                <span>Points discount</span><span>-${redeemDiscount.toFixed(2)}</span>
              </div>
            )}
            {promoDiscountAmt > 0 && (
              <div className="flex justify-between text-emerald-600 text-xs">
                <span>Promo ({appliedPromo?.discountPct}% off)</span>
                <span>-${promoDiscountAmt.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-slate-900 text-base pt-1 border-t border-slate-200">
              <span>Total</span><span>${adjustedTotal.toFixed(2)}</span>
            </div>
            <button
              onClick={handleSubmit}
              disabled={orderItems.length === 0 || submitting || !customerName.trim()}
              className="primary-btn w-full mt-2 py-2.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting…" : "Submit Order"}
            </button>
            {"ok" in (fetcher.data ?? {}) && !(fetcher.data as { ok: boolean }).ok && (
              <p className="text-xs text-red-600 mt-1 text-center">
                {"error" in fetcher.data! ? (fetcher.data as { error: string }).error : "Failed to submit order"}
              </p>
            )}
            </div>{/* end checkout fields */}
          </div>{/* end scrollable */}
        </aside>
      </div>

      <footer className="soft-footer px-6 py-1.5">
        <p className="text-xs">Cashier — click an item to customize and add to order</p>
      </footer>

      {orderConfirmation && (
        <div
          className="fixed inset-0 bg-black/55 flex items-center justify-center z-60 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cashier-order-confirm"
        >
          <div className="surface-card max-w-md w-full p-8 text-center space-y-4">
            <p id="cashier-order-confirm" className="text-2xl font-bold text-slate-900">
              Order placed
            </p>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 py-6 px-4">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
                Order number
              </p>
              <p className="text-4xl font-black text-emerald-900 mt-1 tabular-nums tracking-tight">
                #{orderConfirmation.orderNumber}
              </p>
              <p className="text-sm text-slate-600 mt-3">
                Total:{" "}
                <span className="font-semibold text-slate-900">${orderConfirmation.total}</span>
              </p>
              <div className="mt-4 flex flex-col items-center gap-1.5">
                <img
                  src={qrCodeUrl(receiptQrData({ orderNumber: orderConfirmation.orderNumber, total: orderConfirmation.total }))}
                  alt="Order receipt QR code"
                  width={140}
                  height={140}
                  className="rounded-lg border border-emerald-200 bg-white p-1"
                />
                <p className="text-[10px] text-emerald-600 font-medium">Scan for receipt</p>
              </div>
            </div>
            <button
              type="button"
              className="primary-btn w-full py-3"
              onClick={() => setOrderConfirmation(null)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Customization modal */}
      {selectedItem && (
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
                {selectedItem.allergens.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedItem.allergens.map(a => (
                      <span key={a} className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-1.5 py-0.5">
                        {ALLERGEN_ICONS[a]} {a.replace("-"," ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Size */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Size</p>
              <div className="grid grid-cols-2 gap-2">
                {SIZES.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSize(s.value)}
                    aria-pressed={size === s.value}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${size === s.value ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                  >
                    <span className="block font-bold">{s.value}</span>
                    <span className="block text-[10px] opacity-75">{s.oz}{s.upcharge > 0 ? ` +$${s.upcharge.toFixed(2)}` : ""}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Temperature */}
            {selectedItem.hasTemperature && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-700 mb-2">Temperature</p>
                <div className="grid grid-cols-2 gap-2">
                  {["hot", "cold"].map(temp => (
                    <button
                      key={temp}
                      type="button"
                      onClick={() => setTemperature(temp)}
                      aria-pressed={temperature === temp}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${temperature === temp ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                    >
                      {temp === "hot" ? "🔥 Hot" : "🧊 Cold"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sweetness */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Sweetness</p>
              <div className="grid grid-cols-5 gap-1.5">
                {SWEETNESS_OPTIONS.map(pct => (
                  <button
                    key={pct}
                    type="button"
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
              <p className="text-sm font-semibold text-slate-700 mb-2">Ice Level</p>
              <div className="grid grid-cols-4 gap-2">
                {ICE_LEVELS.map((level, i) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setIceLevel(level)}
                    aria-pressed={iceLevel === level}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${iceLevel === level ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                  >
                    {translatedIceLevels[i] ?? level}
                  </button>
                ))}
              </div>
            </div>

            {/* Milk type */}
            {selectedItem.hasMilk && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-700 mb-2">Milk Type</p>
                <div className="grid grid-cols-3 gap-2">
                  {MILK_TYPES.map((level, i) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setMilkType(level)}
                      aria-pressed={milkType === level}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${milkType === level ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                    >
                      {translatedMilkTypes[i] ?? level}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Toppings */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Toppings <span className="text-slate-400 font-normal">(+$0.75 each)</span></p>
              <div className="grid grid-cols-2 gap-2">
                {TOPPINGS.map((topping, i) => (
                  <button
                    key={topping.id}
                    type="button"
                    onClick={() => toggleTopping(topping.id)}
                    aria-pressed={selectedToppings.includes(topping.id)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${selectedToppings.includes(topping.id) ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}
                  >
                    {translatedToppings[i]?.name ?? topping.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Price override */}
            <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
              <p className="text-xs font-semibold text-amber-800">Price Override <span className="font-normal text-amber-600">(requires manager PIN)</span></p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceOverride}
                  onChange={e => { setPriceOverride(e.target.value); setPinError(null); }}
                  placeholder={modalPrice.toFixed(2)}
                  className="flex-1 rounded-lg border border-amber-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              {priceOverride.trim() && parseFloat(priceOverride) !== modalPrice && (
                <div className="space-y-1.5">
                  <input
                    type="password"
                    maxLength={8}
                    value={pinInput}
                    onChange={e => { setPinInput(e.target.value); setPinError(null); }}
                    placeholder="Manager PIN"
                    className="w-full rounded-lg border border-amber-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {pinError && <p className="text-xs text-red-600">{pinError}</p>}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-2">
              <button type="button" onClick={closePopup}
                className="secondary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleAddToOrder}
                disabled={pinFetcher.state !== "idle"}
                className="primary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
                {pinFetcher.state !== "idle" ? "Verifying…" : editCartKey ? "Update Item" : "Add to Order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
