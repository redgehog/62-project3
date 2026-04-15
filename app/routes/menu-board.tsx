import { useLoaderData } from "react-router";
import type { Route } from "./+types/menu-board";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Menu Board — Boba House" }];
}

const COLUMN_ORDER = ["Milk Tea", "Fruit Tea", "Brewed Tea", "Specialty", "Seasonal"];

const TOPPINGS = [
  { name: "Boba",         price: 0.75 },
  { name: "Lychee Jelly", price: 0.75 },
  { name: "Grass Jelly",  price: 0.75 },
  { name: "Pudding",      price: 0.75 },
];

export async function loader() {
  const result = await pool.query(
    `SELECT name, category, price::float AS price,
            COALESCE(is_seasonal, false) AS "isSeasonal"
     FROM "Item"
     WHERE is_active = true
       AND LOWER(category) != 'poo'
     ORDER BY category, name`
  );

  const menu: Record<string, { name: string; price: number }[]> = {};
  const dbCategories = new Set<string>();

  for (const row of result.rows) {
    if (!menu[row.category]) {
      menu[row.category] = [];
      dbCategories.add(row.category);
    }
    const item = { name: row.name, price: Number(row.price) };
    menu[row.category].push(item);
    if (row.isSeasonal) {
      if (!menu["Seasonal"]) {
        menu["Seasonal"] = [];
        dbCategories.add("Seasonal");
      }
      menu["Seasonal"].push(item);
    }
  }

  // Enforce display order; unknown categories slot in after known non-seasonal ones
  const known = new Set(COLUMN_ORDER);
  const others = [...dbCategories].filter((c) => !known.has(c) && c !== "Seasonal");
  const categories = [
    ...COLUMN_ORDER.filter((c) => c !== "Seasonal" && menu[c]),
    ...others,
    ...(menu["Seasonal"] ? ["Seasonal"] : []),
  ];

  categories.push("Toppings");

  return { categories, menu };
}

export default function MenuBoard() {
  const { categories, menu } = useLoaderData<typeof loader>();

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-8 py-5 flex items-center justify-between shrink-0">
        <h1 className="text-white text-3xl font-extrabold tracking-wide">Boba House</h1>
        <span className="text-slate-300 text-sm font-medium uppercase tracking-widest">Menu</span>
      </header>

      {/* Menu grid */}
      <div
        className="flex-1 grid overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${categories.length}, 1fr)` }}
      >
        {categories.map((cat, i) => (
          <div
            key={cat}
            className={`flex flex-col overflow-y-auto px-8 py-8 ${i < categories.length - 1 ? "border-r border-slate-700" : ""}`}
          >
            <h2 className="text-blue-400 text-xl font-bold uppercase tracking-widest mb-6 pb-3 border-b border-slate-700">
              {cat === "Seasonal" ? "🍂 Seasonal" : cat}
            </h2>
            <ul className="flex flex-col gap-5" role="list">
              {(cat === "Toppings" ? TOPPINGS : menu[cat]).map((item) => (
                <li key={item.name} className="flex items-baseline justify-between gap-4">
                  <span className="text-slate-100 text-base font-medium">{item.name}</span>
                  <span className="text-slate-300 text-sm whitespace-nowrap">${item.price.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

    </div>
  );
}
