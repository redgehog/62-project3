import type { Route } from "./+types/menu-board";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Menu Board — Boba House" }];
}

const MENU: Record<string, { name: string; price: number }[]> = {
  "Milk Teas": [
    { name: "Classic Milk Tea",     price: 5.00 },
    { name: "Taro Milk Tea",        price: 5.00 },
    { name: "Brown Sugar Milk Tea", price: 5.00 },
    { name: "Mango Milk Tea",       price: 5.00 },
    { name: "Strawberry Milk Tea",  price: 5.00 },
    { name: "Honeydew Milk Tea",    price: 5.00 },
  ],
  "Fruit Teas": [
    { name: "Peach Tea",            price: 4.00 },
    { name: "Lychee Tea",           price: 4.00 },
    { name: "Passion Fruit Tea",    price: 4.00 },
    { name: "Mango Green Tea",      price: 4.00 },
    { name: "Strawberry Green Tea", price: 4.00 },
    { name: "Watermelon Tea",       price: 4.00 },
  ],
  "Blended": [
    { name: "Taro Smoothie",        price: 5.50 },
    { name: "Mango Smoothie",       price: 5.50 },
    { name: "Strawberry Smoothie",  price: 5.50 },
    { name: "Matcha Smoothie",      price: 5.50 },
    { name: "Honeydew Smoothie",    price: 5.50 },
    { name: "Peach Smoothie",       price: 5.50 },
  ],
  "Specials": [
    { name: "Tiger Milk Tea",       price: 6.50 },
    { name: "Brown Sugar Boba",     price: 6.50 },
    { name: "Matcha Latte",         price: 6.00 },
    { name: "Chai Latte",           price: 5.75 },
    { name: "Lavender Tea",         price: 5.75 },
    { name: "Seasonal Special",     price: 6.50 },
  ],
};

export default function MenuBoard() {
  const categories = Object.keys(MENU);

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-8 py-5 flex items-center justify-between shrink-0">
        <h1 className="text-white text-3xl font-extrabold tracking-wide">Boba House</h1>
        <span className="text-slate-300 text-sm font-medium uppercase tracking-widest">Menu</span>
      </header>

      {/* Menu grid */}
      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: `repeat(${categories.length}, 1fr)` }}>
        {categories.map((cat, i) => (
          <div
            key={cat}
            className={`flex flex-col overflow-y-auto px-8 py-8 ${i < categories.length - 1 ? "border-r border-slate-700" : ""}`}
          >
            <h2 className="text-blue-400 text-xl font-bold uppercase tracking-widest mb-6 pb-3 border-b border-slate-700">
              {cat}
            </h2>
            <ul className="flex flex-col gap-5" role="list">
              {MENU[cat].map((item) => (
                <li key={item.name} className="flex items-baseline justify-between gap-4">
                  <span className="text-slate-100 text-base font-medium">{item.name}</span>
                  <span className="text-slate-300 text-sm whitespace-nowrap">${item.price.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="bg-slate-800 border-t border-slate-700 px-8 py-2 shrink-0">
        <p className="text-slate-400 text-xs text-center">All drinks available in small (16 oz) or large (24 oz) · Add any topping for $0.75</p>
      </footer>
    </div>
  );
}
