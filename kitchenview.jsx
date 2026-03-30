import { useState } from "react";

// Placeholder orders — in production these would come from your backend
const INITIAL_ORDERS = [
  { id: 101, items: ["Classic Milk Tea", "Boba Tea"] },
  { id: 102, items: ["Taro Milk Tea", "Peach Tea", "Boba"] },
  { id: 103, items: ["Mango Smoothie"] },
  { id: 104, items: ["Brown Sugar Milk Tea", "Lychee Tea"] },
  { id: 105, items: ["Matcha Latte", "Taro Smoothie", "Grass Jelly"] },
  { id: 106, items: ["Strawberry Milk Tea"] },
  { id: 107, items: ["Combo A"] },
];

export default function KitchenInterface() {
  const [orders, setOrders] = useState(INITIAL_ORDERS);

  const completeOrder = (id) => setOrders((prev) => prev.filter((o) => o.id !== id));

  return (
    <div style={{ fontFamily: "sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#fff" }}>

      {/* HEADER */}
      <div style={{ padding: "8px 16px", background: "#222", color: "#aaa", fontSize: "13px" }}>
        Kitchen Interface
      </div>

      {/* ORDER CARDS */}
      <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
        {orders.length === 0 ? (
          <p style={{ color: "#999", fontSize: "14px" }}>No pending orders.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
            {orders.map((order) => (
              <div
                key={order.id}
                style={{ border: "1px solid #ccc", background: "#d9d9d9", padding: "14px", display: "flex", flexDirection: "column", minHeight: "220px" }}
              >
                <div style={{ fontWeight: "bold", fontSize: "18px", marginBottom: "12px" }}>Order #{order.id}</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                  {order.items.map((item, i) => (
                    <li key={i} style={{ fontSize: "13px" }}>{item}</li>
                  ))}
                </ul>
                <button
                  onClick={() => completeOrder(order.id)}
                  style={{ marginTop: "14px", padding: "8px", border: "1px solid #aaa", background: "#fff", cursor: "pointer", fontSize: "12px" }}
                >
                  Mark Complete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
