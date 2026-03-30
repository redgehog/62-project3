import { useState } from "react";

const MENU_ITEMS = [
  { id: 1,  name: "Black Tea",              price: 4.00 },
  { id: 2,  name: "Green Tea",              price: 4.00 },
  { id: 3,  name: "Oolong Tea",             price: 4.00 },
  { id: 4,  name: "Chai Tea",               price: 4.00 },
  { id: 5,  name: "Milk Tea",               price: 5.00 },
  { id: 6,  name: "Boba Tea",               price: 5.00 },
  { id: 7,  name: "Taro Milk Tea",          price: 5.00 },
  { id: 8,  name: "Matcha Latte",           price: 5.00 },
  { id: 9,  name: "Brown Sugar Milk Tea",   price: 5.00 },
  { id: 10, name: "Strawberry Milk Tea",    price: 5.00 },
  { id: 11, name: "Mango Milk Tea",         price: 5.00 },
  { id: 12, name: "Peach Tea",              price: 4.00 },
];

const TAX_RATE = 0.0825;

export default function BobaShopPOS() {
  const [orderItems, setOrderItems] = useState([]);

  const addItem = (item) => {
    setOrderItems((prev) => {
      const existing = prev.find((o) => o.id === item.id);
      if (existing) return prev.map((o) => o.id === item.id ? { ...o, qty: o.qty + 1 } : o);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeItem = (id) => {
    setOrderItems((prev) => prev.filter((o) => o.id !== id));
  };

  const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  const handleSubmit = () => {
    if (orderItems.length === 0) return;
    alert(`Order submitted! Total: $${total.toFixed(2)}`);
    setOrderItems([]);
  };

  return (
    <div style={{ fontFamily: "sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>

      {/* HEADER */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #ccc" }}>
        <h1 style={{ fontSize: "20px", margin: 0 }}>Boba Shop POS</h1>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* MENU GRID */}
        <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                style={{ padding: "20px 10px", border: "1px solid #ccc", background: "#f9f9f9", cursor: "pointer", fontSize: "14px", textAlign: "center" }}
              >
                <div>{item.name}</div>
                <div style={{ marginTop: "6px", color: "#555" }}>${item.price.toFixed(2)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ORDER SUMMARY */}
        <div style={{ width: "260px", borderLeft: "1px solid #ccc", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #ccc" }}>
            <strong>Order Summary</strong>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
            {orderItems.length === 0 ? (
              <p style={{ color: "#999", fontSize: "13px" }}>No items added yet.</p>
            ) : (
              orderItems.map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #eee", fontSize: "13px" }}>
                  <span>{item.name} x{item.qty}</span>
                  <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span>${(item.price * item.qty).toFixed(2)}</span>
                    <button onClick={() => removeItem(item.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#999", fontSize: "16px" }}>x</button>
                  </span>
                </div>
              ))
            )}
          </div>

          <div style={{ padding: "12px 16px", borderTop: "1px solid #ccc", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span>Tax/Tip</span><span>${tax.toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "15px", marginBottom: "12px" }}>
              <span>TOTAL</span><span>${total.toFixed(2)}</span>
            </div>
            <button
              onClick={handleSubmit}
              disabled={orderItems.length === 0}
              style={{ width: "100%", padding: "12px", background: orderItems.length === 0 ? "#ccc" : "#333", color: "#fff", border: "none", cursor: orderItems.length === 0 ? "not-allowed" : "pointer", fontSize: "14px" }}
            >
              Submit Order
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
