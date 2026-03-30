import { useState } from "react";
import type { Route } from "./+types/customer";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Order — Boba House" }];
}

const CATEGORIES = ["Milk Teas", "Fruit Teas", "Smoothies", "Toppings", "Combos"];

const MENU_ITEMS: Record<string, { id: number; name: string; price: number }[]> = {
  "Milk Teas":  [
    { id: 1,  name: "Classic Milk Tea",     price: 5.00 },
    { id: 2,  name: "Taro Milk Tea",        price: 5.00 },
    { id: 3,  name: "Brown Sugar Milk Tea", price: 5.00 },
    { id: 4,  name: "Mango Milk Tea",       price: 5.00 },
    { id: 5,  name: "Strawberry Milk Tea",  price: 5.00 },
    { id: 6,  name: "Honeydew Milk Tea",    price: 5.00 },
  ],
  "Fruit Teas": [
    { id: 7,  name: "Peach Tea",            price: 4.00 },
    { id: 8,  name: "Lychee Tea",           price: 4.00 },
    { id: 9,  name: "Passion Fruit Tea",    price: 4.00 },
    { id: 10, name: "Mango Green Tea",      price: 4.00 },
  ],
  "Smoothies":  [
    { id: 11, name: "Strawberry Smoothie",  price: 5.50 },
    { id: 12, name: "Mango Smoothie",       price: 5.50 },
    { id: 13, name: "Taro Smoothie",        price: 5.50 },
  ],
  "Toppings":   [
    { id: 14, name: "Boba",                 price: 0.75 },
    { id: 15, name: "Lychee Jelly",         price: 0.75 },
    { id: 16, name: "Grass Jelly",          price: 0.75 },
    { id: 17, name: "Pudding",              price: 0.75 },
  ],
  "Combos":     [
    { id: 18, name: "Combo A",              price: 9.00 },
    { id: 19, name: "Combo B",              price: 9.00 },
    { id: 20, name: "Combo C",              price: 9.00 },
  ],
};

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

export default function Customer() {
  const [activeCategory, setActiveCategory] = useState("Milk Teas");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  const addToCart = (item: { id: number; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) return prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (id: number) => setCart((prev) => prev.filter((c) => c.id !== id));

  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const items = MENU_ITEMS[activeCategory] ?? [];

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-white text-xl font-bold tracking-wide">Boba House</h1>
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
                    <div key={item.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <span className="text-slate-800 font-medium">{item.name} ×{item.qty}</span>
                      <span className="flex items-center gap-3 text-slate-700">
                        <span>${(item.price * item.qty).toFixed(2)}</span>
                        <button
                          onClick={() => removeFromCart(item.id)}
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
                onClick={() => addToCart(item)}
                className="bg-white border border-slate-200 rounded-lg p-5 text-left hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-colors"
              >
                <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                <p className="text-sm text-slate-500 mt-1">${item.price.toFixed(2)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <footer className="bg-slate-700 px-6 py-1.5 shrink-0">
        <p className="text-slate-300 text-xs">Customer kiosk — tap items to add to your order</p>
      </footer>
    </div>
  );
}
