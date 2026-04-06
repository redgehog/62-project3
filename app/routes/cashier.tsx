import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/cashier";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Cashier — Boba House" }];
}

const MENU_ITEMS = [
  { id: 1,  name: "Black Tea",            price: 4.00 },
  { id: 2,  name: "Green Tea",            price: 4.00 },
  { id: 3,  name: "Oolong Tea",           price: 4.00 },
  { id: 4,  name: "Chai Tea",             price: 4.00 },
  { id: 5,  name: "Milk Tea",             price: 5.00 },
  { id: 6,  name: "Boba Tea",             price: 5.00 },
  { id: 7,  name: "Taro Milk Tea",        price: 5.00 },
  { id: 8,  name: "Matcha Latte",         price: 5.00 },
  { id: 9,  name: "Brown Sugar Milk Tea", price: 5.00 },
  { id: 10, name: "Strawberry Milk Tea",  price: 5.00 },
  { id: 11, name: "Mango Milk Tea",       price: 5.00 },
  { id: 12, name: "Peach Tea",            price: 4.00 },
];

const TAX_RATE = 0.0825;

interface OrderItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

export default function Cashier() {
  const navigate = useNavigate();
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

  const addItem = (item: { id: number; name: string; price: number }) => {
    setOrderItems((prev) => {
      const existing = prev.find((o) => o.id === item.id);
      if (existing) return prev.map((o) => o.id === item.id ? { ...o, qty: o.qty + 1 } : o);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeItem = (id: number) => setOrderItems((prev) => prev.filter((o) => o.id !== id));

  const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  const handleSubmit = () => {
    if (orderItems.length === 0) return;
    alert(`Order submitted! Total: $${total.toFixed(2)}`);
    setOrderItems([]);
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <button onClick={() => navigate("/portal")} className="text-white text-xl font-bold tracking-wide hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded">Boba House</button>
        <span className="text-slate-300 text-sm font-medium">Cashier</span>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Menu grid */}
        <div className="flex-1 p-5 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                className="bg-white border border-slate-200 rounded-lg p-5 text-left hover:bg-blue-50 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-colors"
              >
                <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                <p className="text-sm text-slate-500 mt-1">${item.price.toFixed(2)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Order summary */}
        <aside className="w-64 border-l border-slate-200 bg-white flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700">Order Summary</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2">
            {orderItems.length === 0 ? (
              <p className="text-sm text-slate-400 mt-2">No items added yet.</p>
            ) : (
              orderItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                  <span className="text-slate-800">{item.name} ×{item.qty}</span>
                  <span className="flex items-center gap-2 text-slate-700">
                    <span>${(item.price * item.qty).toFixed(2)}</span>
                    <button
                      onClick={() => removeItem(item.id)}
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
              disabled={orderItems.length === 0}
              className="w-full mt-2 py-2.5 rounded-lg font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700"
            >
              Submit Order
            </button>
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <footer className="bg-slate-700 px-6 py-1.5">
        <p className="text-slate-300 text-xs">Cashier — click items to add to order</p>
      </footer>
    </div>
  );
}
