import { useState, useEffect } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/customer";
import pool from "../db.server";
import { translateText, MAJOR_LANGUAGES, type LanguageCode } from "../translate";
import { applyTax, calcTax } from "../lib/pricing";

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

export async function loader() {
  const result = await pool.query(
    `SELECT item_id::text AS id, name, category, price::float AS price, milk,
            COALESCE(is_seasonal, false) AS "isSeasonal",
            COALESCE(allergens, '{}') AS allergens
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
      allergens: row.allergens as string[],
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
  const items = JSON.parse(formData.get("cart") as string) as Array<{
    id: string; basePrice: number; qty: number;
  }>;

  if (!items.length) return { ok: false };

  const [empRow, custRow] = await Promise.all([
    pool.query(`SELECT employee_id FROM "Employee" LIMIT 1`),
    pool.query(`SELECT customer_id FROM "Customer" LIMIT 1`),
  ]);
  const employeeId = empRow.rows[0]?.employee_id;
  const customerId = custRow.rows[0]?.customer_id;
  if (!employeeId || !customerId) return { ok: false, error: "No employee or customer record found" };

  // Group by item_id — same item with different customizations shares a DB row
  const grouped: Record<string, { price: number; qty: number }> = {};
  for (const item of items) {
    if (grouped[item.id]) {
      grouped[item.id].qty += item.qty;
    } else {
      grouped[item.id] = { price: item.basePrice, qty: item.qty };
    }
  }

  const totalQty   = items.reduce((s, i) => s + i.qty, 0);
  const subtotalRaw = items.reduce((s, i) => s + i.basePrice * i.qty, 0);
  const totalPrice = applyTax(subtotalRaw);

  const { rows } = await pool.query(
    `INSERT INTO "Order" (order_id, employee_id, customer_id, date, total_price, payment_method, item_quantity)
     VALUES (gen_random_uuid(), $1, $2, now(), $3, 'Cash', $4) RETURNING order_id`,
    [employeeId, customerId, totalPrice.toFixed(2), totalQty]
  );
  const orderId = rows[0].order_id;

  for (const [itemId, { price, qty }] of Object.entries(grouped)) {
    await pool.query(
      `INSERT INTO "Order_Item" (id, order_id, item_id, quantity, unit_price)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4)`,
      [orderId, itemId, qty, price.toFixed(2)]
    );
  }

  const taxAmount = calcTax(subtotalRaw).toFixed(2);
  await pool.query(
    `INSERT INTO pos_sales_activity
     (activity_id, business_date, event_time, activity_type, order_id, amount, tax_amount, payment_method, item_count)
     VALUES (gen_random_uuid(), CURRENT_DATE, now(), 'SALE', $1, $2, $3, 'Cash', $4)`,
    [orderId, totalPrice.toFixed(2), taxAmount, totalQty]
  );

  return { ok: true };
}

export default function Customer() {
  const navigate = useNavigate();
  const { categories, menuItems } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [activeCategory, setActiveCategory] = useState(0); // index of category
  const [blockedAllergens, setBlockedAllergens] = useState<string[]>([]);
  const [cart, setCart]                     = useState<CartItem[]>([]);
  const [showCart, setShowCart]             = useState(false);

  // Clear cart on successful order
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setCart([]);
      setShowCart(false);
    }
  }, [fetcher.state, fetcher.data]);
  const [selectedItem, setSelectedItem]         = useState<MenuItem | null>(null);
  const [milkLevel, setMilkLevel]               = useState("Whole Milk");
  const [iceLevel, setIceLevel]                 = useState("Regular");
  const [selectedToppings, setSelectedToppings] = useState<number[]>([]);
  const [weather, setWeather] = useState<{ temp_f: number; condition: string } | null>(null);

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

  const [language, setLanguage] = useState<LanguageCode>('en');
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

  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  const total      = cart.reduce((s, c) => s + c.price * c.qty, 0);

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
                  <span>Total</span><span>${total.toFixed(2)}</span>
                </div>
                <button
                  onClick={() => fetcher.submit(
                    { cart: JSON.stringify(cart.map((i) => ({ id: i.id, basePrice: i.basePrice, qty: i.qty }))) },
                    { method: "post" }
                  )}
                  disabled={fetcher.state !== "idle"}
                  className="primary-btn mt-4 w-full py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {fetcher.state !== "idle" ? "Placing order…" : "Place Order"}
                </button>
                {fetcher.data && !fetcher.data.ok && (
                  <p className="text-xs text-red-600 mt-2 text-center">
                    {"error" in fetcher.data ? fetcher.data.error : "Failed to place order"}
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
