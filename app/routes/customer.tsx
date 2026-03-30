import { useState } from "react";
import type { Route } from "./+types/customer";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Customer" }];
}

const CATEGORIES = ["Milk Teas", "Fruit Teas", "Smoothies", "Toppings", "Combos"];

const MENU_ITEMS: Record<string, { id: number; name: string; price: number }[]> = {
  "Milk Teas":  [{ id: 1, name: "Classic Milk Tea", price: 5.00 }, { id: 2, name: "Taro Milk Tea", price: 5.00 }, { id: 3, name: "Brown Sugar Milk Tea", price: 5.00 }, { id: 4, name: "Mango Milk Tea", price: 5.00 }, { id: 5, name: "Strawberry Milk Tea", price: 5.00 }, { id: 6, name: "Honeydew Milk Tea", price: 5.00 }],
  "Fruit Teas": [{ id: 7, name: "Peach Tea", price: 4.00 }, { id: 8, name: "Lychee Tea", price: 4.00 }, { id: 9, name: "Passion Fruit Tea", price: 4.00 }, { id: 10, name: "Mango Green Tea", price: 4.00 }],
  "Smoothies":  [{ id: 11, name: "Strawberry Smoothie", price: 5.50 }, { id: 12, name: "Mango Smoothie", price: 5.50 }, { id: 13, name: "Taro Smoothie", price: 5.50 }],
  "Toppings":   [{ id: 14, name: "Boba", price: 0.75 }, { id: 15, name: "Lychee Jelly", price: 0.75 }, { id: 16, name: "Grass Jelly", price: 0.75 }, { id: 17, name: "Pudding", price: 0.75 }],
  "Combos":     [{ id: 18, name: "Combo A", price: 9.00 }, { id: 19, name: "Combo B", price: 9.00 }, { id: 20, name: "Combo C", price: 9.00 }],
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
  const items = MENU_ITEMS[activeCategory] || [];

  return (
    <div style={{ fontFamily: "sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#fff" }}>

      {/* TOP NAV */}
      <div style={{ display: "flex", borderBottom: "1px solid #ccc" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => { setActiveCategory(cat); setShowCart(false); }}
            style={{ flex: 1, padding: "16px", border: "none", borderRight: "1px solid #ccc", background: activeCategory === cat && !showCart ? "#eee" : "#fff", fontWeight: activeCategory === cat && !showCart ? "bold" : "normal", cursor: "pointer", fontSize: "15px" }}
          >
            {cat}
          </button>
        ))}
        <button
          onClick={() => setShowCart(true)}
          style={{ padding: "16px 24px", border: "none", borderLeft: "1px solid #ccc", background: showCart ? "#333" : "#fff", color: showCart ? "#fff" : "#000", cursor: "pointer", fontSize: "15px", fontWeight: showCart ? "bold" : "normal", whiteSpace: "nowrap" }}
        >
          Cart &nbsp; {totalItems} Items
        </button>
      </div>

      {/* CONTENT */}
      {showCart ? (
        <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
          <h2 style={{ marginBottom: "16px" }}>Cart</h2>
          {cart.length === 0 ? (
            <p style={{ color: "#999" }}>No items in cart.</p>
          ) : (
            <>
              {cart.map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #eee", fontSize: "14px" }}>
                  <span>{item.name} x{item.qty}</span>
                  <span style={{ display: "flex", gap: "12px" }}>
                    <span>${(item.price * item.qty).toFixed(2)}</span>
                    <button onClick={() => removeFromCart(item.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#999" }}>x</button>
                  </span>
                </div>
              ))}
              <div style={{ marginTop: "16px", fontWeight: "bold", fontSize: "16px" }}>Total: ${total.toFixed(2)}</div>
              <button
                onClick={() => { alert("Order placed!"); setCart([]); setShowCart(false); }}
                style={{ marginTop: "16px", padding: "12px 32px", background: "#333", color: "#fff", border: "none", cursor: "pointer", fontSize: "14px" }}
              >
                Place Order
              </button>
            </>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                style={{ padding: "32px 12px", border: "1px solid #ccc", background: "#f4f4f4", cursor: "pointer", fontSize: "14px", textAlign: "center" }}
              >
                <div>{item.name}</div>
                <div style={{ marginTop: "6px", color: "#555" }}>${item.price.toFixed(2)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}