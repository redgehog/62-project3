import { useState, useEffect, useContext } from "react";
import { Form, redirect, useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/cashier";
import pool from "../db.server";
import {
  destroyCashierSession,
  getCashierSession,
  requireCashierAccess,
} from "../cashier-access.server";
import { translateText } from "../translate";
import { TranslationContext } from "../root";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Cashier — Boba House" }];
}

const MILK_TYPES = ["Whole Milk", "Oat Milk", "Almond Milk", "Soy Milk", "No Milk"];
const ICE_LEVELS  = ["No Ice", "Less Ice", "Regular", "Extra Ice"];

interface Topping {
  id:    number;
  name:  string;
  price: number;
}

const TOPPINGS: Topping[] = [
  { id: 14, name: "Boba",         price: 0.75 },
  { id: 15, name: "Lychee Jelly", price: 0.75 },
  { id: 16, name: "Grass Jelly",  price: 0.75 },
  { id: 17, name: "Pudding",      price: 0.75 },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireCashierAccess(request);
  const result = await pool.query(
    `SELECT item_id::text AS id, name, category, price::float AS price,
            COALESCE(is_seasonal, false) AS "isSeasonal", milk
     FROM "Item"
     WHERE is_active = true
     ORDER BY category, name`
  );

  const rows = result.rows as { id: string; name: string; category: string; price: number; isSeasonal: boolean; milk: string }[];
  const byCategory: Record<string, { id: string; name: string; price: number; hasMilk: boolean }[]> = {};
  const categories: string[] = [];

  for (const row of rows) {
    if (!byCategory[row.category]) {
      byCategory[row.category] = [];
      categories.push(row.category);
    }
    const item = { id: row.id, name: row.name, price: row.price, hasMilk: !!row.milk && row.milk.toLowerCase() !== "none" && row.milk.trim() !== "" };
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

  await requireCashierAccess(request);
  const items = JSON.parse(formData.get("cart") as string) as Array<{
    id: string; price: number; qty: number;
  }>;

  if (!items.length) return { ok: false };

  const session = await getCashierSession(request);
  const sessionEmployeeId = session.get("cashier:employeeId") as string | undefined;

  const [empRow, custRow] = await Promise.all([
    sessionEmployeeId
      ? pool.query(
          `SELECT employee_id
           FROM "Employee"
           WHERE employee_id = $1::uuid
           LIMIT 1`,
          [sessionEmployeeId]
        )
      : pool.query(`SELECT employee_id FROM "Employee" LIMIT 1`),
    pool.query(`SELECT customer_id FROM "Customer" LIMIT 1`),
  ]);
  const employeeId = empRow.rows[0]?.employee_id;
  const customerId = custRow.rows[0]?.customer_id;
  if (!employeeId || !customerId) return { ok: false, error: "No employee or customer record found" };

  const subtotal   = items.reduce((s, i) => s + i.price * i.qty, 0);
  const totalPrice = subtotal * (1 + 0.0825);
  const totalQty   = items.reduce((s, i) => s + i.qty, 0);

  const { rows } = await pool.query(
    `INSERT INTO "Order" (order_id, employee_id, customer_id, date, total_price, payment_method, item_quantity)
     VALUES (gen_random_uuid(), $1, $2, now(), $3, 'Cash', $4) RETURNING order_id`,
    [employeeId, customerId, totalPrice.toFixed(2), totalQty]
  );
  const orderId = rows[0].order_id;

  for (const item of items) {
    await pool.query(
      `INSERT INTO "Order_Item" (id, order_id, item_id, quantity, unit_price)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4)`,
      [orderId, item.id, item.qty, item.price.toFixed(2)]
    );
  }

  const taxAmount = (totalPrice - subtotal).toFixed(2);
  await pool.query(
    `INSERT INTO pos_sales_activity
     (activity_id, business_date, event_time, activity_type, order_id, amount, tax_amount, payment_method, item_count)
     VALUES (gen_random_uuid(), CURRENT_DATE, now(), 'SALE', $1, $2, $3, 'Cash', $4)`,
    [orderId, totalPrice.toFixed(2), taxAmount, totalQty]
  );

  return { ok: true };
}

const TAX_RATE = 0.0825;

interface CashierMenuItem {
  id:      string;
  name:    string;
  price:   number;
  hasMilk: boolean;
}

interface OrderItem {
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

export default function Cashier() {
  const navigate = useNavigate();
  const { categories, byCategory } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const translationContext = useContext(TranslationContext);
  if (!translationContext) throw new Error("Cashier must be rendered within TranslationContext");
  const { language } = translationContext;

  useEffect(() => {
    if (!sessionStorage.getItem("loggedIn")) navigate("/login?redirect=/cashier");
  }, []);
  const [activeCategory, setActiveCategory] = useState(() => categories[0] ?? "");
  const [translatedCategories, setTranslatedCategories] = useState(categories);
  const [translatedMilkTypes, setTranslatedMilkTypes] = useState(MILK_TYPES);
  const [translatedIceLevels, setTranslatedIceLevels] = useState(ICE_LEVELS);
  const [translatedToppings, setTranslatedToppings] = useState(TOPPINGS);
  const [translatedUI, setTranslatedUI] = useState({ menu: "Menu", select: "Select items to build the current order." });

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
      translateText("Select items to build the current order.", { to: language })
    ]).then(([menu, select]) => setTranslatedUI({ menu, select }));
  }, [language, categories]);
  const [orderItems, setOrderItems]             = useState<OrderItem[]>([]);
  const [selectedItem, setSelectedItem]         = useState<CashierMenuItem | null>(null);
  const [milkLevel, setMilkLevel]               = useState("Whole Milk");
  const [iceLevel, setIceLevel]                 = useState("Regular");
  const [selectedToppings, setSelectedToppings] = useState<number[]>([]);

  // Clear cart on successful order
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setOrderItems([]);
    }
  }, [fetcher.state, fetcher.data]);

  const openItem = (item: CashierMenuItem) => {
    setSelectedItem(item);
    setMilkLevel("Whole Milk");
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
    const toppings   = TOPPINGS.filter((t) => selectedToppings.includes(t.id));
    const toppingIds = toppings.map((t) => t.id).sort().join(",");
    const key        = `${selectedItem.id}-${milkLevel}-${iceLevel}-${toppingIds}`;
    const itemTotal  = selectedItem.price + toppings.reduce((s, t) => s + t.price, 0);
    setOrderItems((prev) => {
      const existing = prev.find((o) => o.cartKey === key);
      if (existing) return prev.map((o) => o.cartKey === key ? { ...o, qty: o.qty + 1 } : o);
      return [...prev, {
        cartKey: key, id: selectedItem.id, name: selectedItem.name,
        basePrice: selectedItem.price, price: itemTotal,
        qty: 1, milkLevel, iceLevel, toppings,
      }];
    });
    closePopup();
  };

  const removeItem = (cartKey: string) => setOrderItems((prev) => prev.filter((o) => o.cartKey !== cartKey));

  const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const tax      = subtotal * TAX_RATE;
  const total    = subtotal + tax;
  const submitting = fetcher.state !== "idle";

  const handleSubmit = () => {
    if (orderItems.length === 0) return;
    fetcher.submit(
      { cart: JSON.stringify(orderItems.map((i) => ({ id: i.id, price: i.price, qty: i.qty }))) },
      { method: "post" }
    );
  };

  const items = byCategory[activeCategory] ?? [];

  return (
    <div className="h-screen flex flex-col app-shell">
      {/* Header */}
      <header className="app-header px-6 py-4 shrink-0">
        <div className="topbar-row">
          <div className="topbar-brand">
            <button onClick={() => navigate("/portal")} className="brand-link hover:text-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded">Boba House</button>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Cashier Workspace</span>
        </div>
      </header>

      {/* Category tabs */}
      <nav className="bg-white/80 backdrop-blur border-b border-slate-200 flex shrink-0 overflow-x-auto" aria-label="Menu categories">
        {categories.map((cat) => (
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
            {cat === "Seasonal" ? "🍂 Seasonal" : cat}
          </button>
        ))}
      </nav>

      {/* Body */}
      <div className="flex-1 page-section w-full flex overflow-hidden px-4 py-5 gap-4">
        {/* Menu grid */}
        <div className="flex-1 section-card p-5 overflow-y-auto">
          <div className="mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="section-title">Menu</h2>
                <p className="section-description">Select items to build the current order.</p>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="logout" />
                <button
                  type="submit"
                  className="secondary-btn px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  Cashier Logout
                </button>
              </Form>
            </div>
            <h2 className="section-title">{translatedUI.menu}</h2>
            <p className="section-description">{translatedUI.select}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="section-card p-5 text-left hover:bg-indigo-50 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
              >
                <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                <p className="text-sm text-slate-500 mt-1">${item.price.toFixed(2)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Order summary */}
        <aside className="w-72 section-card bg-white/90 backdrop-blur flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700">Order Summary</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2">
            {orderItems.length === 0 ? (
              <p className="text-sm text-slate-400 mt-2">No items added yet.</p>
            ) : (
              orderItems.map((item) => (
                <div key={item.cartKey} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                  <div>
                    <p className="text-slate-800">{item.name} ×{item.qty}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {[
                        item.milkLevel !== "Whole Milk" && `Milk: ${item.milkLevel}`,
                        item.iceLevel  !== "Regular"    && `Ice: ${item.iceLevel}`,
                        item.toppings.length > 0 && item.toppings.map((t) => t.name).join(", "),
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="flex items-center gap-2 text-slate-700">
                    <span>${(item.price * item.qty).toFixed(2)}</span>
                    <button
                      onClick={() => removeItem(item.cartKey)}
                      aria-label={`Remove ${item.name}`}
                      className="text-slate-400 hover:text-red-600 focus:outline-none focus:ring-1 focus:ring-red-500 rounded"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-4 border-t border-slate-200 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax (8.25%)</span><span>${tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-900 text-base pt-1 border-t border-slate-200">
              <span>Total</span><span>${total.toFixed(2)}</span>
            </div>
            <button
              onClick={handleSubmit}
              disabled={orderItems.length === 0 || submitting}
              className="primary-btn w-full mt-2 py-2.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting…" : "Submit Order"}
            </button>
            {fetcher.data && !fetcher.data.ok && (
              <p className="text-xs text-red-600 mt-1 text-center">
                {"error" in fetcher.data ? fetcher.data.error : "Failed to submit order"}
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <footer className="soft-footer px-6 py-1.5">
        <p className="text-xs">Cashier — click an item to customize and add to order</p>
      </footer>

      {/* Customization modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Customize ${selectedItem.name}`}
          onClick={(e) => { if (e.target === e.currentTarget) closePopup(); }}
        >
          <div className="surface-card w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedItem.name}</h2>
                <p className="text-slate-500 text-sm mt-0.5">${selectedItem.price.toFixed(2)}</p>
              </div>
            </div>

            {/* Ice level */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Ice Level</p>
              <div className="grid grid-cols-4 gap-2">
                {ICE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setIceLevel(level)}
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

            {/* Milk type — only for milk-based drinks */}
            {selectedItem.hasMilk && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-700 mb-2">Milk Type</p>
                <div className="grid grid-cols-3 gap-2">
                  {MILK_TYPES.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setMilkLevel(level)}
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
                {TOPPINGS.map((topping) => (
                  <button
                    key={topping.id}
                    type="button"
                    onClick={() => toggleTopping(topping.id)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${selectedToppings.includes(topping.id)
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                      }`}
                  >
                    {topping.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={closePopup}
                className="secondary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAddToCart}
                className="primary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors"
              >
                Add to Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
