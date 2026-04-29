// Customer ordering kiosk
import { useState, useEffect, useContext } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/customer";
import pool from "../db.server";
import type { PoolClient } from "pg";
import { translateText, MAJOR_LANGUAGES, type LanguageCode } from "../translate";
import { applyTax } from "../lib/pricing";
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

interface MenuItem {
  id:             string;
  name:           string;
  price:          number;
  allergens:      string[];
  hasMilk:        boolean;
  hasTemperature: boolean;
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
            COALESCE(has_temperature, false) AS "hasTemperature"
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
      allergens:      [],
      hasMilk:        !!row.milk && row.milk.toLowerCase() !== "none" && row.milk.trim() !== "",
      hasTemperature: Boolean(row.hasTemperature),
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
  const discountedTotal = Math.max(0, totalPrice - redeemDiscount);

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

  const chatFetcher = useFetcher<typeof action>();
  const [chatOpen, setChatOpen] = useState(false);
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

  const closePopup = () => { setSelectedItem(null); setEditCartKey(null); if (editCartKey) setShowCart(true); };

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

    if (editCartKey) {
      setShowCart(true);
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
  const adjustedTotal   = Math.max(0, total - redeemDiscount);

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

      <div className="flex-1 overflow-y-auto page-section w-full px-4 py-5">
        {showCart ? (
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
                <div className="mt-4 flex items-center justify-between font-bold text-slate-900 text-base">
                  <span>{translatedUI.total}</span><span>${adjustedTotal.toFixed(2)}</span>
                </div>
                {redeemDiscount > 0 && (
                  <p className="text-xs text-emerald-600 text-right">-${redeemDiscount.toFixed(2)} {translatedUI.pointsDiscount}</p>
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
                        {item.allergens.length > 0 && (
                          <p className="mt-2 text-xs text-amber-700 leading-snug" aria-label={`Contains: ${item.allergens.join(", ")}`}>
                            {item.allergens.map(a => a.replace("-", " ")).join(", ")}
                          </p>
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
