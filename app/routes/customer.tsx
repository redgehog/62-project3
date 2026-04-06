import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/customer";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Order — Boba House" }];
}

const MILK_LEVELS = ["None", "Light", "Regular", "Extra"];
const ICE_LEVELS  = ["No Ice", "Less Ice", "Regular", "Extra Ice"];

const ALLERGEN_ICONS: Record<string, string> = {
  dairy:      "🥛",
  soy:        "🫘",
  "tree-nuts":"🌰",
  gluten:     "🌾",
  eggs:       "🥚",
};

interface MenuItem {
  id:        number;
  name:      string;
  price:     number;
  allergens: string[];
  hasMilk:   boolean;
}

const CATEGORIES = ["Milk Teas", "Fruit Teas", "Smoothies", "Toppings", "Combos"];

const MENU_ITEMS: Record<string, MenuItem[]> = {
  "Milk Teas": [
    { id: 1,  name: "Classic Milk Tea",     price: 5.00, allergens: ["dairy", "gluten"],       hasMilk: true  },
    { id: 2,  name: "Taro Milk Tea",        price: 5.00, allergens: ["dairy", "gluten"],       hasMilk: true  },
    { id: 3,  name: "Brown Sugar Milk Tea", price: 5.00, allergens: ["dairy", "gluten"],       hasMilk: true  },
    { id: 4,  name: "Mango Milk Tea",       price: 5.00, allergens: ["dairy", "soy"],          hasMilk: true  },
    { id: 5,  name: "Strawberry Milk Tea",  price: 5.00, allergens: ["dairy"],                 hasMilk: true  },
    { id: 6,  name: "Honeydew Milk Tea",    price: 5.00, allergens: ["dairy", "soy"],          hasMilk: true  },
  ],
  "Fruit Teas": [
    { id: 7,  name: "Peach Tea",            price: 4.00, allergens: [],                        hasMilk: false },
    { id: 8,  name: "Lychee Tea",           price: 4.00, allergens: [],                        hasMilk: false },
    { id: 9,  name: "Passion Fruit Tea",    price: 4.00, allergens: [],                        hasMilk: false },
    { id: 10, name: "Mango Green Tea",      price: 4.00, allergens: [],                        hasMilk: false },
  ],
  "Smoothies": [
    { id: 11, name: "Strawberry Smoothie",  price: 5.50, allergens: ["dairy", "soy"],          hasMilk: true  },
    { id: 12, name: "Mango Smoothie",       price: 5.50, allergens: ["dairy"],                 hasMilk: true  },
    { id: 13, name: "Taro Smoothie",        price: 5.50, allergens: ["dairy", "soy"],          hasMilk: true  },
  ],
  "Toppings": [
    { id: 14, name: "Boba",                 price: 0.75, allergens: ["gluten"],                hasMilk: false },
    { id: 15, name: "Lychee Jelly",         price: 0.75, allergens: [],                        hasMilk: false },
    { id: 16, name: "Grass Jelly",          price: 0.75, allergens: [],                        hasMilk: false },
    { id: 17, name: "Pudding",              price: 0.75, allergens: ["dairy", "eggs"],         hasMilk: false },
  ],
  "Combos": [
    { id: 18, name: "Combo A",              price: 9.00, allergens: ["dairy", "gluten"],       hasMilk: true  },
    { id: 19, name: "Combo B",              price: 9.00, allergens: ["dairy"],                 hasMilk: true  },
    { id: 20, name: "Combo C",              price: 9.00, allergens: ["dairy", "soy"],          hasMilk: true  },
  ],
};

interface CartItem {
  cartKey:   string;
  id:        number;
  name:      string;
  price:     number;
  qty:       number;
  milkLevel: string;
  iceLevel:  string;
}

export default function Customer() {
  const navigate = useNavigate();

  const [activeCategory, setActiveCategory] = useState("Milk Teas");
  const [cart, setCart]                     = useState<CartItem[]>([]);
  const [showCart, setShowCart]             = useState(false);
  const [selectedItem, setSelectedItem]     = useState<MenuItem | null>(null);
  const [milkLevel, setMilkLevel]           = useState("Regular");
  const [iceLevel, setIceLevel]             = useState("Regular");

  const openItem = (item: MenuItem) => {
    setSelectedItem(item);
    setMilkLevel("Regular");
    setIceLevel("Regular");
  };

  const closePopup = () => setSelectedItem(null);

  const confirmAddToCart = () => {
    if (!selectedItem) return;
    const key = `${selectedItem.id}-${milkLevel}-${iceLevel}`;
    setCart((prev) => {
      const existing = prev.find((c) => c.cartKey === key);
      if (existing) return prev.map((c) => c.cartKey === key ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, {
        cartKey: key,
        id: selectedItem.id,
        name: selectedItem.name,
        price: selectedItem.price,
        qty: 1,
        milkLevel,
        iceLevel,
      }];
    });
    closePopup();
  };

  const removeFromCart = (cartKey: string) =>
    setCart((prev) => prev.filter((c) => c.cartKey !== cartKey));

  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  const total      = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const items      = MENU_ITEMS[activeCategory] ?? [];

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
        {CATEGORIES.map((cat) => (
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
                            item.milkLevel !== "Regular" && `Milk: ${item.milkLevel}`,
                            item.iceLevel  !== "Regular" && `Ice: ${item.iceLevel}`,
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
                <p className="text-sm font-semibold text-slate-700 mb-2">Milk Level</p>
                <div className="grid grid-cols-4 gap-2">
                  {MILK_LEVELS.map((level) => (
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
