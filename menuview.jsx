const MENU = {
  "Blended": [
    "Taro Smoothie",
    "Mango Smoothie",
    "Strawberry Smoothie",
    "Matcha Smoothie",
    "Honeydew Smoothie",
    "Peach Smoothie",
  ],
  "Milk Teas": [
    "Classic Milk Tea",
    "Taro Milk Tea",
    "Brown Sugar Milk Tea",
    "Mango Milk Tea",
    "Strawberry Milk Tea",
    "Honeydew Milk Tea",
  ],
  "Fruit Teas": [
    "Peach Tea",
    "Lychee Tea",
    "Passion Fruit Tea",
    "Mango Green Tea",
    "Strawberry Green Tea",
    "Watermelon Tea",
  ],
  "Specials": [
    "Tiger Milk Tea",
    "Brown Sugar Boba",
    "Matcha Latte",
    "Chai Latte",
    "Lavender Tea",
    "Seasonal Special",
  ],
};

export default function MenuBoard() {
  const categories = Object.keys(MENU);

  return (
    <div style={{ fontFamily: "sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#fff" }}>

      {/* HEADER */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #ccc", background: "#222", color: "#aaa", fontSize: "13px" }}>
        Menu Board
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, padding: "32px", display: "grid", gridTemplateColumns: `repeat(${categories.length}, 1fr)`, gap: "0" }}>
        {categories.map((cat) => (
          <div key={cat} style={{ borderRight: "1px solid #eee", paddingRight: "24px", paddingLeft: "24px" }}>
            <h2 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "24px" }}>{cat}</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "18px" }}>
              {MENU[cat].map((item, i) => (
                <li key={i} style={{ fontSize: "16px", color: "#222" }}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
