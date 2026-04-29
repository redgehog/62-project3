// Customer ordering kiosk
import { useState, useEffect, useContext } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/customer";
import pool from "../db.server";
import type { PoolClient } from "pg";
import { translateText, MAJOR_LANGUAGES, type LanguageCode } from "../translate";
import { applyTax, calcTax } from "../lib/pricing";
import { TranslationContext } from "../root";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Order — Boba House" }];
}

const MILK_TYPES = ["Whole Milk", "Oat Milk", "Almond Milk", "Soy Milk", "No Milk"];
const ICE_LEVELS  = ["No Ice", "Less Ice", "Regular", "Extra Ice"];

const ALLERGEN_ICONS: Record<string, string> = {
  dairy:       "🥛",
  soy:         "🫘",
  "tree-nuts": "🌰",
  gluten:      "🌾",
  eggs:        "🥚",
};

const ALL_ALLERGENS = ["dairy", "soy", "tree-nuts", "gluten", "eggs"] as const;

interface MenuItem {
  id:        string;
  name:      string;
  price:     number;
  allergens: string[];
  hasMilk:   boolean;
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

interface CartItem {
  cartKey:   string;
  id:        string;
  name:      string;
  basePrice: number;
  price:     number;
  qty:       number;
  milkLevel: string;
  iceLevel:  string;
  toppings:  Topping[];
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const normalizePhone = (p: string) => p.replace(/\D/g, "");

export async function loader() {
  const result = await pool.query(
    `SELECT item_id::text AS id, name, category, price::float AS price, milk,
            COALESCE(is_seasonal, false) AS "isSeasonal"
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
      id:        row.id,
      name:      row.name,
      price:     Number(row.price),
      allergens: [],
      hasMilk:   !!row.milk && row.milk.toLowerCase() !== "none" && row.milk.trim() !== "",
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
    id: string; basePrice: number; qty: number;
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

  // Group by item_id — same item with different customizations shares a DB row
  const grouped: Record<string, { price: number; qty: number }> = {};
  for (const item of items) {
    if (grouped[item.id]) {
      grouped[item.id].qty += item.qty;
    } else {
      grouped[item.id] = { price: item.basePrice, qty: item.qty };
    }
  }

  const totalQty    = items.reduce((s, i) => s + i.qty, 0);
  const subtotalRaw = items.reduce((s, i) => s + i.basePrice * i.qty, 0);
  const totalPrice  = applyTax(subtotalRaw);

  const redeem300Count = Math.max(0, parseInt(String(formData.get("redeem300") || "0"), 10));
  const redeem100Count = Math.max(0, parseInt(String(formData.get("redeem100") || "0"), 10));
  const pointsRedeemed  = earnPoints ? redeem300Count * 300 + redeem100Count * 100 : 0;
  const redeemDiscount  = earnPoints ? redeem300Count * 4  + redeem100Count * 1   : 0;
  const discountedTotal = Math.max(0, totalPrice - redeemDiscount);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderNumber = await getNextOrderNumber(client);
    const { rows } = await client.query(
      `INSERT INTO "Order" (order_id, employee_id, customer_id, date, total_price, payment_method, item_quantity, customer_name, order_number)
       VALUES (gen_random_uuid(), $1, $2, now(), $3, 'Cash', $4, $5, $6) RETURNING order_id`,
      [employeeId, customerId, discountedTotal.toFixed(2), totalQty, formCustomerName, orderNumber]
    );
    const orderId = rows[0].order_id;

    for (const [itemId, { price, qty }] of Object.entries(grouped)) {
      await client.query(
        `INSERT INTO "Order_Item" (id, order_id, item_id, quantity, unit_price)
         VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4)`,
        [orderId, itemId, qty, price.toFixed(2)]
      );
    }

    const subtotal = items.reduce((s, i) => s + i.basePrice * i.qty, 0);
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

  return { ok: true };
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

export default function Customer() {
  const navigate = useNavigate();
  const { categories, menuItems } = useLoaderData<typeof loader>();
  const fetcher       = useFetcher<typeof action>();
  const lookupFetcher = useFetcher<typeof action>();
  const translationContext = useContext(TranslationContext);
  const language = translationContext?.language ?? "en";
  const setLanguage = translationContext?.setLanguage ?? (() => {});

  const [activeCategory, setActiveCategory] = useState(0); // index of category
  const [blockedAllergens, setBlockedAllergens] = useState<string[]>([]);
  const [cart, setCart]                     = useState<CartItem[]>([]);
  const [showCart, setShowCart]             = useState(false);
  const [customerPhone, setCustomerPhone]       = useState("");
  const [lookedUpCustomer, setLookedUpCustomer] = useState<{ id: string; name: string; points: number } | "not-found" | null>(null);
  const [redeem300, setRedeem300]               = useState(0);
  const [redeem100, setRedeem100]               = useState(0);

  // Clear cart on successful order
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data && fetcher.data.ok) {
      setCart([]);
      setShowCart(false);
      setCustomerPhone("");
      setLookedUpCustomer(null);
      setRedeem300(0);
      setRedeem100(0);
    }
  }, [fetcher.state, fetcher.data]);

  // Handle phone lookup result
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
  const [milkLevel, setMilkLevel]               = useState("Whole Milk");
  const [iceLevel, setIceLevel]                 = useState("Regular");
  const [selectedToppings, setSelectedToppings] = useState<number[]>([]);
  const [weather, setWeather] = useState<{ temp_f: number; condition: string } | null>(null);
  const chatFetcher = useFetcher<typeof action>();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Hi! I can help with menu questions and ordering." },
  ]);

  // Fetch weather on mount, refresh every 10 minutes
  useEffect(() => {
    const fetchWeather = () =>
      fetch("/api/weather")
        .then((r) => r.json())
        .then((d) => { if (!d.error) setWeather(d); })
        .catch(() => {});
    fetchWeather();
    const id = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const [translatedCategories, setTranslatedCategories] = useState(categories);
  const [translatedMenuItems, setTranslatedMenuItems] = useState(menuItems);
  const [translatedMilkTypes, setTranslatedMilkTypes] = useState(MILK_TYPES);
  const [translatedIceLevels, setTranslatedIceLevels] = useState(ICE_LEVELS);
  const [translatedToppings, setTranslatedToppings] = useState(TOPPINGS);

  const currentCategory = categories[activeCategory];
  const translatedCurrentCategory = translatedCategories[activeCategory];
  const items = translatedMenuItems[translatedCurrentCategory] ?? [];

  // Translate strings when language changes
  useEffect(() => {
    if (language === 'en') {
      setTranslatedCategories(categories);
      setTranslatedMenuItems(menuItems);
      setTranslatedMilkTypes(MILK_TYPES);
      setTranslatedIceLevels(ICE_LEVELS);
      setTranslatedToppings(TOPPINGS);
      return;
    }

    // Translate categories
    Promise.all(categories.map(cat => translateText(cat, { to: language })))
      .then(setTranslatedCategories);

    // Translate menu item names
    const translateMenu = async () => {
      const newMenu: typeof menuItems = {};
      for (const [cat, items] of Object.entries(menuItems)) {
        const translatedCat = await translateText(cat, { to: language });
        newMenu[translatedCat] = await Promise.all(
          items.map(async item => ({
            ...item,
            name: await translateText(item.name, { to: language })
          }))
        );
      }
      setTranslatedMenuItems(newMenu);
    };
    translateMenu();

    // Translate milk types
    Promise.all(MILK_TYPES.map(mt => translateText(mt, { to: language })))
      .then(setTranslatedMilkTypes);

    // Translate ice levels
    Promise.all(ICE_LEVELS.map(il => translateText(il, { to: language })))
      .then(setTranslatedIceLevels);

    // Translate toppings
    Promise.all(TOPPINGS.map(async t => ({ ...t, name: await translateText(t.name, { to: language }) })))
      .then(setTranslatedToppings);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePopup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem]);

  const openItem = (item: MenuItem) => {
    setSelectedItem(item);
    setMilkLevel("Regular");
    setIceLevel("Regular");
    setSelectedToppings([]);
  };

  const closePopup = () => setSelectedItem(null);

  const toggleTopping = (id: number) =>
    setSelectedToppings((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );

  const confirmAddToCart = () => {
    if (!selectedItem) return;
    const toppings = TOPPINGS.filter((t) => selectedToppings.includes(t.id));
    const toppingIds = toppings.map((t) => t.id).sort().join(",");
    const key = `${selectedItem.id}-${milkLevel}-${iceLevel}-${toppingIds}`;
    const itemTotal = selectedItem.price + toppings.reduce((s, t) => s + t.price, 0);
    setCart((prev) => {
      const existing = prev.find((c) => c.cartKey === key);
      if (existing) return prev.map((c) => c.cartKey === key ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, {
        cartKey: key,
        id: selectedItem.id,
        name: selectedItem.name,
        basePrice: selectedItem.price,
        price: itemTotal,
        qty: 1,
        milkLevel,
        iceLevel,
        toppings,
      }];
    });
    closePopup();
  };

  const removeFromCart = (cartKey: string) =>
    setCart((prev) => prev.filter((c) => c.cartKey !== cartKey));

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

  return (
    <div className="h-screen flex flex-col app-shell">
      {/* Header */}
      <header className="app-header px-6 py-4 shrink-0">
        <div className="topbar-row">
          <div className="topbar-brand">
            <button
              onClick={() => navigate("/portal")}
              className="brand-link hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded"
            >
              Boba House
            </button>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          {weather && (
            <div className="flex items-center gap-1.5 text-white/80 text-sm font-medium">
              <span>{Math.round(weather.temp_f)}°F</span>
              <span className="text-white/50 text-xs hidden sm:inline">· {weather.condition}</span>
            </div>
          )}
          <span className="topbar-chip">Customer Kiosk</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as LanguageCode)}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto page-section w-full px-4 py-5">
        {showCart ? (
          <div className="max-w-2xl mx-auto section-card p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="section-title">Your Cart</h2>
                <p className="section-description">Review selected items and place your order.</p>
              </div>
              <button
                onClick={() => setShowCart(false)}
                className="secondary-btn px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                Back to Menu
              </button>
            </div>
            {cart.length === 0 ? (
              <p className="text-slate-500 text-sm">No items in cart.</p>
            ) : (
              <>
                <div className="section-card divide-y divide-slate-100">
                  {cart.map((item) => (
                    <div key={item.cartKey} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="text-slate-800 font-medium">{item.name} ×{item.qty}</p>
                        <p className="text-slate-400 text-xs mt-0.5">
                          {[
                            item.milkLevel !== "Whole Milk" && `Milk: ${item.milkLevel}`,
                            item.iceLevel  !== "Regular" && `Ice: ${item.iceLevel}`,
                            item.toppings.length > 0 && item.toppings.map((t) => t.name).join(", "),
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="flex items-center gap-3 text-slate-700">
                        <span>${(item.price * item.qty).toFixed(2)}</span>
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
                  <span>Total</span><span>${adjustedTotal.toFixed(2)}</span>
                </div>
                {redeemDiscount > 0 && (
                  <p className="text-xs text-emerald-600 text-right">-${redeemDiscount.toFixed(2)} points discount applied</p>
                )}
                {lookedUpCustomer && lookedUpCustomer !== "not-found" && availablePoints >= 100 && (
                  <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-700">Redeem Points</span>
                      <span className="text-xs text-indigo-500">{remainingPoints} pts left</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setRedeem300(r => r + 1)}
                        disabled={remainingPoints < 300}
                        className="text-xs px-2 py-1.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                        300 pts → $4 off
                      </button>
                      <button type="button" onClick={() => setRedeem100(r => r + 1)}
                        disabled={remainingPoints < 100}
                        className="text-xs px-2 py-1.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                        100 pts → $1 off
                      </button>
                      <button type="button" onClick={applyAllPoints}
                        className="text-xs px-2 py-1.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100">
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
                <div className="mt-4 space-y-2">
                  <span className="block text-xs font-medium text-slate-600">Phone Number (optional — earn loyalty points)</span>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => { setCustomerPhone(e.target.value); setLookedUpCustomer(null); }}
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
                      {lookupFetcher.state !== "idle" ? "…" : "Look up"}
                    </button>
                  </div>
                  {lookedUpCustomer === "not-found" && (
                    <p className="text-xs text-amber-600">No account found — a new one will be created for this number.</p>
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
                      cart: JSON.stringify(cart.map((i) => ({ id: i.id, basePrice: i.basePrice, qty: i.qty }))),
                      redeem300: String(redeem300),
                      redeem100: String(redeem100),
                    };
                    if (lookedUpCustomer && lookedUpCustomer !== "not-found") {
                      payload.customerId    = lookedUpCustomer.id;
                      payload.customerName  = lookedUpCustomer.name;
                    } else if (customerPhone.trim()) {
                      payload.customerPhone = customerPhone.trim();
                    }
                    fetcher.submit(payload, { method: "post" });
                  }}
                  disabled={fetcher.state !== "idle"}
                  className="primary-btn mt-4 w-full py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {fetcher.state !== "idle" ? "Placing order…" : "Place Order"}
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
                <h2 className="section-title">Menu</h2>
                <p className="section-description">Choose a category, then tap an item to customize and add it to your cart.</p>
              </div>
              <button
                onClick={() => setShowCart(true)}
                className="primary-btn px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 whitespace-nowrap"
              >
                Cart ({totalItems})
              </button>
            </div>

            {/* Allergen filter */}
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-800 mb-2">Filter out allergens — tap to hide items containing:</p>
              <div className="flex flex-wrap gap-2">
                {ALL_ALLERGENS.map((allergen) => {
                  const blocked = blockedAllergens.includes(allergen);
                  return (
                    <button
                      key={allergen}
                      onClick={() => setBlockedAllergens((prev) =>
                        blocked ? prev.filter((a) => a !== allergen) : [...prev, allergen]
                      )}
                      aria-pressed={blocked}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500
                        ${blocked
                          ? "bg-amber-600 border-amber-600 text-white"
                          : "bg-white border-amber-300 text-amber-800 hover:bg-amber-100"
                        }`}
                    >
                      {ALLERGEN_ICONS[allergen]} {allergen.replace("-", " ")}
                    </button>
                  );
                })}
                {blockedAllergens.length > 0 && (
                  <button
                    onClick={() => setBlockedAllergens([])}
                    className="px-3 py-1 rounded-full text-xs font-semibold border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {blockedAllergens.length > 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  Hiding items containing: {blockedAllergens.map((a) => a.replace("-", " ")).join(", ")}
                </p>
              )}
            </div>

            <div className="mb-5">
              <div
                className="grid gap-2 w-full"
                style={{ gridTemplateColumns: `repeat(${Math.max(translatedCategories.length, 1)}, minmax(0, 1fr))` }}
              >
                {translatedCategories.map((cat, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setActiveCategory(i);
                      setShowCart(false);
                    }}
                    aria-pressed={activeCategory === i}
                    className={`px-3 py-2.5 rounded-lg text-sm font-semibold text-center transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      activeCategory === i
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">{translatedCurrentCategory}</h3>
              <p className="section-description">Available items in this category.</p>
            </div>

            <div className="grid grid-cols-4 gap-3">
                {items
                  .filter((item) => !item.allergens.some((a) => blockedAllergens.includes(a)))
                  .map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openItem(item)}
                      className="section-card p-5 text-left hover:bg-indigo-50 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                    >
                      <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                      <p className="text-sm text-slate-500 mt-1">${item.price.toFixed(2)}</p>
                      {item.allergens.length > 0 && (
                        <p className="mt-2 text-base leading-none" aria-label={`Contains: ${item.allergens.join(", ")}`}>
                          {item.allergens.map((a) => ALLERGEN_ICONS[a]).join(" ")}
                        </p>
                      )}
                    </button>
                  ))}
              </div>
              {items.filter((item) => !item.allergens.some((a) => blockedAllergens.includes(a))).length === 0 && (
              <p className="text-sm text-slate-500 py-8 text-center">
                {items.length === 0
                  ? "No items available in this category right now."
                  : "All items in this category contain your filtered allergens."}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <footer className="soft-footer px-6 py-1.5 shrink-0">
        <p className="text-xs">Customer kiosk — tap an item to customize and add to your order</p>
      </footer>

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
          onClick={(e) => { if (e.target === e.currentTarget) closePopup(); }}
        >
          <div className="surface-card w-full max-w-md p-6">

            {/* Item header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedItem.name}</h2>
                <p className="text-slate-500 text-sm mt-0.5">${selectedItem.price.toFixed(2)}</p>
              </div>
              {selectedItem.allergens.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-slate-400 mb-1">Contains</p>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {selectedItem.allergens.map((a) => (
                      <span
                        key={a}
                        title={a.replace("-", " ")}
                        className="inline-flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-2 py-0.5"
                      >
                        {ALLERGEN_ICONS[a]} {a.replace("-", " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ice level */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Ice Level</p>
              <div className="grid grid-cols-4 gap-2">
                {translatedIceLevels.map((level) => (
                  <button
                    key={level}
                    onClick={() => setIceLevel(level)}
                    aria-pressed={iceLevel === level}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${iceLevel === level
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                      }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Milk level — only for milk-based drinks */}
            {selectedItem.hasMilk && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-700 mb-2">Milk Type</p>
                <div className="grid grid-cols-3 gap-2">
                  {translatedMilkTypes.map((level) => (
                    <button
                      key={level}
                      onClick={() => setMilkLevel(level)}
                      aria-pressed={milkLevel === level}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${milkLevel === level
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                        }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Toppings */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Toppings <span className="text-slate-400 font-normal">(+$0.75 each)</span></p>
              <div className="grid grid-cols-2 gap-2">
                {translatedToppings.map((topping) => {
                  const hasBlocked = topping.allergens.some((a) => blockedAllergens.includes(a));
                  return (
                    <button
                      key={topping.id}
                      onClick={() => toggleTopping(topping.id)}
                      aria-pressed={selectedToppings.includes(topping.id)}
                      className={`py-2 px-3 text-xs font-medium rounded-lg border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${selectedToppings.includes(topping.id)
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : hasBlocked
                          ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                          : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                        }`}
                    >
                      <span>{topping.name}</span>
                      {topping.allergens.length > 0 && (
                        <span className="ml-1">{topping.allergens.map((a) => ALLERGEN_ICONS[a]).join("")}</span>
                      )}
                      {hasBlocked && <span className="block text-amber-600 font-normal" style={{fontSize:"10px"}}>contains your allergen</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-2">
              <button
                onClick={closePopup}
                className="secondary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddToCart}
                className="primary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors"
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
