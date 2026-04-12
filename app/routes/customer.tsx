import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/customer";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Order — Boba House" }];
}

const MILK_TYPES = ["Whole Milk", "Oat Milk", "Almond Milk", "Soy Milk", "No Milk"];
const ICE_LEVELS  = ["No Ice", "Less Ice", "Regular", "Extra Ice"];

const ALLERGEN_ICONS: Record<string, string> = {
  dairy:      "🥛",
  soy:        "🫘",
  "tree-nuts":"🌰",
  gluten:     "🌾",
  eggs:       "🥚",
};

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
  price:     number;
  qty:       number;
  milkLevel: string;
  iceLevel:  string;
  toppings:  Topping[];
}

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

export default function Customer() {
  const navigate = useNavigate();
  const { categories, menuItems } = useLoaderData<typeof loader>();

  const [activeCategory, setActiveCategory] = useState(() => categories[0] ?? "");
  const [cart, setCart]                     = useState<CartItem[]>([]);
  const [showCart, setShowCart]             = useState(false);
  const [selectedItem, setSelectedItem]         = useState<MenuItem | null>(null);
  const [milkLevel, setMilkLevel]               = useState("Whole Milk");
  const [iceLevel, setIceLevel]                 = useState("Regular");
  const [selectedToppings, setSelectedToppings] = useState<number[]>([]);

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
  const items      = menuItems[activeCategory] ?? [];

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <button
          onClick={() => navigate("/portal")}
          className="text-white text-xl font-bold tracking-wide hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded"
        >
          Boba House
        </button>
        <span className="text-slate-300 text-sm font-medium">Self-Order Kiosk</span>
      </header>

      {/* Category tabs */}
      <nav className="bg-white border-b border-slate-200 flex shrink-0" aria-label="Menu categories">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => { setActiveCategory(cat); setShowCart(false); }}
            aria-pressed={activeCategory === cat && !showCart}
            className={`flex-1 py-4 text-sm font-semibold border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600
              ${activeCategory === cat && !showCart
                ? "border-blue-600 text-blue-700 bg-blue-50"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
          >
            {cat}
          </button>
        ))}
        <button
          onClick={() => setShowCart(true)}
          aria-pressed={showCart}
          className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600 whitespace-nowrap
            ${showCart
              ? "border-blue-600 text-blue-700 bg-blue-50"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
        >
          Cart ({totalItems})
        </button>
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {showCart ? (
          <div className="max-w-lg mx-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Your Cart</h2>
            {cart.length === 0 ? (
              <p className="text-slate-500 text-sm">No items in cart.</p>
            ) : (
              <>
                <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
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
                  onClick={() => { alert("Order placed!"); setCart([]); setShowCart(false); }}
                  className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 text-white font-semibold rounded-lg transition-colors"
                >
                  Place Order
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="bg-white border border-slate-200 rounded-lg p-5 text-left hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-colors"
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
        )}
      </div>

      {/* Status bar */}
      <footer className="bg-slate-700 px-6 py-1.5 shrink-0">
        <p className="text-slate-300 text-xs">Customer kiosk — tap an item to customize and add to your order</p>
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">

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
                {ICE_LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() => setIceLevel(level)}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${iceLevel === level
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:border-blue-300"
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
                  {MILK_TYPES.map((level) => (
                    <button
                      key={level}
                      onClick={() => setMilkLevel(level)}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${milkLevel === level
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white border-slate-200 text-slate-700 hover:border-blue-300"
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
                    onClick={() => toggleTopping(topping.id)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${selectedToppings.includes(topping.id)
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:border-blue-300"
                      }`}
                  >
                    {topping.name}
                    {topping.allergens.length > 0 && (
                      <span className="ml-1">{topping.allergens.map((a) => ALLERGEN_ICONS[a]).join("")}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-2">
              <button
                onClick={closePopup}
                className="flex-1 py-3 border border-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddToCart}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors"
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
