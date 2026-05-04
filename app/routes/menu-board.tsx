import { useLoaderData } from "react-router";
import type { Route } from "./+types/menu-board";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Menu — Boba House" }];
}

const COLUMN_ORDER = ["Milk Tea", "Fruit Tea", "Brewed Tea", "Coffee", "Specialty", "Seasonal"];

const TOPPINGS = [
  { name: "Boba",         price: 0.75 },
  { name: "Lychee Jelly", price: 0.75 },
  { name: "Grass Jelly",  price: 0.75 },
  { name: "Pudding",      price: 0.75 },
];

interface CategoryStyle {
  emoji:   string;
  accent:  string;
  tint:    string;
  ring:    string;
  tagline: string;
}

const CATEGORY_STYLE: Record<string, CategoryStyle> = {
  "Milk Tea":   { emoji: "🧋", accent: "#a06a3a", tint: "#fff1e0", ring: "#f5d4ad", tagline: "Creamy classics"   },
  "Fruit Tea":  { emoji: "🍑", accent: "#e26a5a", tint: "#fff0eb", ring: "#f8c5b9", tagline: "Fresh & bright"    },
  "Brewed Tea": { emoji: "🍵", accent: "#5b8e6b", tint: "#ecf6ee", ring: "#bdd9c2", tagline: "Pure leaf"         },
  "Coffee":     { emoji: "☕", accent: "#6b4423", tint: "#f3ebe1", ring: "#d4bfa5", tagline: "Slow brewed"       },
  "Specialty":  { emoji: "✨", accent: "#7e5aa8", tint: "#f3eefb", ring: "#cfb8e5", tagline: "House favorites"   },
  "Seasonal":   { emoji: "🍂", accent: "#c98a3e", tint: "#fff3e0", ring: "#f1ce9d", tagline: "Limited time"      },
};

const DEFAULT_STYLE: CategoryStyle = {
  emoji: "🍶", accent: "#475569", tint: "#f1f5f9", ring: "#cbd5e1", tagline: "Featured",
};

export async function loader() {
  const result = await pool.query(
    `SELECT name, category, price::float AS price,
            COALESCE(is_seasonal, false) AS "isSeasonal"
     FROM "Item"
     WHERE is_active = true
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

  const known = new Set(COLUMN_ORDER);
  const others = [...dbCategories].filter((c) => !known.has(c) && c !== "Seasonal");
  const categories = [
    ...COLUMN_ORDER.filter((c) => c !== "Seasonal" && menu[c]),
    ...others,
    ...(menu["Seasonal"] ? ["Seasonal"] : []),
  ];

  // "Toppings" is appended for backwards-compat with prior consumers; the
  // visual layout renders it as a dedicated footer strip instead of a column.
  categories.push("Toppings");

  return { categories, menu };
}

export default function MenuBoard() {
  const { categories, menu } = useLoaderData<typeof loader>();
  const mainCategories = categories.filter((c) => c !== "Toppings");

  return (
    <div
      className="relative h-screen w-screen overflow-hidden flex flex-col"
      style={{
        background: `
          radial-gradient(ellipse at 12% 0%, #ffe7d1 0%, transparent 48%),
          radial-gradient(ellipse at 88% 100%, #f7d9e6 0%, transparent 48%),
          linear-gradient(180deg, #fff8f0 0%, #fbeed9 100%)
        `,
        fontFeatureSettings: '"ss01", "cv11"',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="relative shrink-0 flex items-center justify-between gap-4 px-8 pt-5 pb-3">
        <div className="flex items-center gap-4">
          <div className="relative w-14 h-14 rounded-full bg-[#3c2415] flex items-center justify-center shrink-0 shadow-[0_10px_25px_-10px_rgba(60,36,21,0.7)] ring-[6px] ring-white/60">
            <span className="text-3xl leading-none -translate-y-px" aria-hidden>🧋</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[#9c7a5e] text-[0.7rem] font-bold uppercase tracking-[0.4em] mb-1">
              Welcome to
            </span>
            <h1
              className="text-[#3c2415] font-black tracking-tight leading-none"
              style={{ fontSize: "clamp(2rem, 3.4vw, 3.25rem)" }}
            >
              Boba House
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end leading-none">
            <span className="text-[#9c7a5e] text-[0.65rem] font-bold uppercase tracking-[0.35em] mb-1">
              Today's
            </span>
            <span
              className="text-[#3c2415] font-extrabold tracking-tight"
              style={{ fontSize: "clamp(1.25rem, 1.8vw, 1.75rem)" }}
            >
              Menu
            </span>
          </div>
          <span className="px-4 py-2 rounded-full bg-[#3c2415] text-[#fff8f0] text-[0.7rem] font-bold tracking-[0.25em] uppercase shadow-[0_8px_18px_-10px_rgba(60,36,21,0.7)]">
            Brewed Daily
          </span>
        </div>
      </header>

      {/* ── Main grid ──────────────────────────────────────────────────── */}
      <main
        className="relative flex-1 min-h-0 grid gap-3 px-6 pt-1 pb-2"
        style={{ gridTemplateColumns: `repeat(${mainCategories.length}, minmax(0, 1fr))` }}
      >
        {mainCategories.map((cat) => {
          const style = CATEGORY_STYLE[cat] ?? DEFAULT_STYLE;
          const items = menu[cat] ?? [];
          const isSeasonal = cat === "Seasonal";

          return (
            <section
              key={cat}
              className="relative flex flex-col min-h-0 rounded-[1.75rem] border border-white shadow-[0_18px_40px_-25px_rgba(60,36,21,0.45)] overflow-hidden backdrop-blur-sm"
              style={{
                background: isSeasonal
                  ? `linear-gradient(165deg, ${style.tint} 0%, rgba(255,255,255,0.92) 65%)`
                  : "rgba(255,255,255,0.86)",
              }}
            >
              {/* Accent header */}
              <header
                className="relative px-4 pt-4 pb-3 flex items-center gap-2.5"
                style={{ borderBottom: `1px dashed ${style.ring}` }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                  style={{
                    background: style.tint,
                    boxShadow: `inset 0 0 0 1.5px ${style.ring}`,
                  }}
                  aria-hidden
                >
                  <span>{style.emoji}</span>
                </div>
                <div className="flex flex-col leading-tight min-w-0 flex-1">
                  <h2
                    className="font-black tracking-tight truncate"
                    style={{ color: style.accent, fontSize: "clamp(0.95rem, 1.25vw, 1.4rem)" }}
                  >
                    {cat}
                  </h2>
                  <span
                    className="text-[#9c7a5e] font-semibold uppercase tracking-[0.18em] truncate"
                    style={{ fontSize: "clamp(0.55rem, 0.65vw, 0.72rem)" }}
                  >
                    {style.tagline}
                  </span>
                </div>
                {isSeasonal && (
                  <span
                    className="ml-1 px-2 py-0.5 rounded-full text-white shrink-0 font-bold uppercase tracking-[0.15em]"
                    style={{ background: style.accent, fontSize: "0.55rem" }}
                  >
                    New
                  </span>
                )}
              </header>

              {/* Items */}
              <ul
                className="flex-1 min-h-0 flex flex-col justify-start gap-6 px-4 py-3 overflow-hidden"
                role="list"
              >
                {items.length === 0 ? (
                  <li className="text-center text-[#b29680] italic text-xs">
                    Coming soon
                  </li>
                ) : (
                  items.map((item) => (
                    <li
                      key={item.name}
                      className="flex items-baseline gap-2 leading-tight"
                    >
                      <span
                        className="text-[#3c2415] font-semibold tracking-tight truncate"
                        style={{ fontSize: "clamp(0.72rem, 0.92vw, 1.05rem)" }}
                      >
                        {item.name}
                      </span>
                      <span
                        className="flex-1 border-b border-dotted translate-y-[-3px]"
                        style={{ borderColor: "#d8c4ad" }}
                        aria-hidden
                      />
                      <span
                        className="font-extrabold tabular-nums shrink-0"
                        style={{
                          color: style.accent,
                          fontSize: "clamp(0.72rem, 0.92vw, 1.05rem)",
                        }}
                      >
                        {item.price.toFixed(2)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </main>

      {/* ── Toppings strip ─────────────────────────────────────────────── */}
      <footer className="relative shrink-0 px-6 pt-1 pb-4">
        <div className="rounded-3xl bg-[#3c2415] text-[#fff8f0] px-5 py-3 flex items-center gap-5 shadow-[0_15px_35px_-22px_rgba(60,36,21,0.85)]">
          <div className="flex items-center gap-2.5 shrink-0 pr-4 border-r border-[#5a3a25]">
            <span className="text-2xl" aria-hidden>🍡</span>
            <div className="flex flex-col leading-none">
              <span className="text-[#f5c98a] text-[0.6rem] font-bold uppercase tracking-[0.3em] mb-0.5">
                Add-ons
              </span>
              <span className="font-black text-lg tracking-tight">Toppings</span>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-around gap-4 flex-wrap">
            {TOPPINGS.map((t) => (
              <div key={t.name} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full bg-[#d4a574] shrink-0"
                  aria-hidden
                />
                <span className="font-semibold text-[0.95rem] tracking-tight">
                  {t.name}
                </span>
                <span className="text-[#f5c98a] font-bold tabular-nums text-[0.85rem]">
                  +${t.price.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="hidden lg:block text-[#f5c98a] text-xs font-semibold tracking-wide italic shrink-0 pl-4 border-l border-[#5a3a25]">
            Make it yours.
          </div>
        </div>
      </footer>
    </div>
  );
}
