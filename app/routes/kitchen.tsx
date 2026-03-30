import { useState } from "react";
import type { Route } from "./+types/kitchen";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Kitchen — Boba House" }];
}

interface Order {
  id: number;
  items: string[];
}

const INITIAL_ORDERS: Order[] = [
  { id: 101, items: ["Classic Milk Tea", "Boba Tea"] },
  { id: 102, items: ["Taro Milk Tea", "Peach Tea", "Boba"] },
  { id: 103, items: ["Mango Smoothie"] },
  { id: 104, items: ["Brown Sugar Milk Tea", "Lychee Tea"] },
  { id: 105, items: ["Matcha Latte", "Taro Smoothie", "Grass Jelly"] },
  { id: 106, items: ["Strawberry Milk Tea"] },
  { id: 107, items: ["Combo A"] },
];

export default function Kitchen() {
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);

  const completeOrder = (id: number) => setOrders((prev) => prev.filter((o) => o.id !== id));

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-white text-xl font-bold tracking-wide">Boba House</h1>
        <span className="text-slate-300 text-sm font-medium">Kitchen Display</span>
      </header>

      {/* Order cards */}
      <div className="flex-1 p-5 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-400 text-lg font-medium">No pending orders</p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col min-h-48"
              >
                <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 rounded-t-lg">
                  <span className="text-sm font-bold text-slate-800">Order #{order.id}</span>
                </div>
                <ul className="flex-1 px-4 py-3 space-y-2" role="list">
                  {order.items.map((item, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="px-4 pb-4">
                  <button
                    onClick={() => completeOrder(order.id)}
                    className="w-full py-2 bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    Mark Complete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <footer className="bg-slate-700 px-6 py-1.5 shrink-0">
        <p className="text-slate-300 text-xs">{orders.length} order{orders.length !== 1 ? "s" : ""} pending</p>
      </footer>
    </div>
  );
}
