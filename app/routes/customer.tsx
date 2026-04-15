import { useState, useEffect } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/customer";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Order — Boba House" }];
}

const MILK_TYPES = ["Whole Milk", "Oat Milk", "Almond Milk", "Soy Milk", "No Milk"];
const ICE_LEVELS  = ["No Ice", "Less Ice", "Regular", "Extra Ice"];

const ALLERGEN_ICONS: Record<string, string> = {
  dairy:      "🥛",
  soy:        "🫘",
  "tree-nuts":"🌰",
  gluten:     "🌾",
  eggs:       "🥚",
};

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

interface MenuItem {
  id:        string;
  name:      string;
  price:     number;
  allergens: string[];
  hasMilk:   boolean;
}

interface Topping {
  id:        number;
  name:      string;
  price:     number;
  allergens: string[];
}

const TOPPINGS: Topping[] = [
  { id: 14, name: "Boba",         price: 0.75, allergens: ["gluten"]        },
  { id: 15, name: "Lychee Jelly", price: 0.75, allergens: []                },
  { id: 16, name: "Grass Jelly",  price: 0.75, allergens: []                },
  { id: 17, name: "Pudding",      price: 0.75, allergens: ["dairy", "eggs"] },
];

interface CartItem {
  cartKey:   string;
  id:        string;
  name:      string;
  basePrice: number;
  price:     number;
  qty:       number;
  milkLevel: string;
  iceLevel:  string;
  toppings:  Topping[];
}

export async function loader() {

  function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function createCartItem(item: MenuItem): CartItem {
  return {
    cartKey: `${item.id}-Whole Milk-Regular-`,
    id: item.id,
    name: item.name,
    basePrice: item.price,
    price: item.price,
    qty: 1,
    milkLevel: item.hasMilk ? "Whole Milk" : "No Milk",
    iceLevel: "Regular",
    toppings: [],
  };
}
  const result = await pool.query(
    `SELECT item_id::text AS id, name, category, price::float AS price, milk,
            COALESCE(is_seasonal, false) AS "isSeasonal"
     FROM "Item"
     WHERE is_active = true
     ORDER BY category, name`
  );

  const menuItems: Record<string, MenuItem[]> = {};
  const categories: string[] = [];

  for (const row of result.rows) {
    if (!menuItems[row.category]) {
      menuItems[row.category] = [];
      categories.push(row.category);
    }
    const item: MenuItem = {
      id:        row.id,
      name:      row.name,
      price:     Number(row.price),
      allergens: [],
      hasMilk:   !!row.milk && row.milk.toLowerCase() !== "none" && row.milk.trim() !== "",
    };
    menuItems[row.category].push(item);
    if (row.isSeasonal) {
      if (!menuItems["Seasonal"]) {
        menuItems["Seasonal"] = [];
        categories.push("Seasonal");
      }
      menuItems["Seasonal"].push(item);
    }
  }

  return { categories, menuItems };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const items = JSON.parse(formData.get("cart") as string) as Array<{
    id: string; basePrice: number; qty: number;
  }>;

  if (!items.length) return { ok: false };

  const [empRow, custRow] = await Promise.all([
    pool.query(`SELECT employee_id FROM "Employee" LIMIT 1`),
    pool.query(`SELECT customer_id FROM "Customer" LIMIT 1`),
  ]);
  const employeeId = empRow.rows[0]?.employee_id;
  const customerId = custRow.rows[0]?.customer_id;
  if (!employeeId || !customerId) return { ok: false, error: "No employee or customer record found" };

  // Group by item_id — same item with different customizations shares a DB row
  const grouped: Record<string, { price: number; qty: number }> = {};
  for (const item of items) {
    if (grouped[item.id]) {
      grouped[item.id].qty += item.qty;
    } else {
      grouped[item.id] = { price: item.basePrice, qty: item.qty };
    }
  }

  const totalQty   = items.reduce((s, i) => s + i.qty, 0);
  const totalPrice = items.reduce((s, i) => s + i.basePrice * i.qty, 0) * (1 + 0.0825);

  const { rows } = await pool.query(
    `INSERT INTO "Order" (order_id, employee_id, customer_id, date, total_price, payment_method, item_quantity)
     VALUES (gen_random_uuid(), $1, $2, now(), $3, 'Cash', $4) RETURNING order_id`,
    [employeeId, customerId, totalPrice.toFixed(2), totalQty]
  );
  const orderId = rows[0].order_id;

  for (const [itemId, { price, qty }] of Object.entries(grouped)) {
    await pool.query(
      `INSERT INTO "Order_Item" (id, order_id, item_id, quantity, unit_price)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4)`,
      [orderId, itemId, qty, price.toFixed(2)]
    );
  }

  const subtotal = items.reduce((s, i) => s + i.basePrice * i.qty, 0);
  const taxAmount = (totalPrice - subtotal).toFixed(2);
  await pool.query(
    `INSERT INTO pos_sales_activity
     (activity_id, business_date, event_time, activity_type, order_id, amount, tax_amount, payment_method, item_count)
     VALUES (gen_random_uuid(), CURRENT_DATE, now(), 'SALE', $1, $2, $3, 'Cash', $4)`,
    [orderId, totalPrice.toFixed(2), taxAmount, totalQty]
  );

  return { ok: true };
}

export default function Customer() {
  const navigate = useNavigate();
  const { categories, menuItems } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [activeCategory, setActiveCategory] = useState(() => categories[0] ?? "");
  const [cart, setCart]                     = useState<CartItem[]>([]);
  const [showCart, setShowCart]             = useState(false);

  // Clear cart on successful order
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setCart([]);
      setShowCart(false);
    }
  }, [fetcher.state, fetcher.data]);
  const [selectedItem, setSelectedItem]         = useState<MenuItem | null>(null);
  const [milkLevel, setMilkLevel]               = useState("Whole Milk");
  const [iceLevel, setIceLevel]                 = useState("Regular");
  const [selectedToppings, setSelectedToppings] = useState<number[]>([]);

  const openItem = (item: MenuItem) => {
    setSelectedItem(item);
    setMilkLevel("Regular");
    setIceLevel("Regular");
    setSelectedToppings([]);
  };

  const closePopup = () => setSelectedItem(null);

  const toggleTopping = (id: number) =>
    setSelectedToppings((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );

  const confirmAddToCart = () => {
    if (!selectedItem) return;
    const toppings = TOPPINGS.filter((t) => selectedToppings.includes(t.id));
    const toppingIds = toppings.map((t) => t.id).sort().join(",");
    const key = `${selectedItem.id}-${milkLevel}-${iceLevel}-${toppingIds}`;
    const itemTotal = selectedItem.price + toppings.reduce((s, t) => s + t.price, 0);
    setCart((prev) => {
      const existing = prev.find((c) => c.cartKey === key);
      if (existing) return prev.map((c) => c.cartKey === key ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, {
        cartKey: key,
        id: selectedItem.id,
        name: selectedItem.name,
        basePrice: selectedItem.price,
        price: itemTotal,
        qty: 1,
        milkLevel,
        iceLevel,
        toppings,
      }];
    });
    closePopup();
  };

  const removeFromCart = (cartKey: string) =>
    setCart((prev) => prev.filter((c) => c.cartKey !== cartKey));

  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  const total      = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const items      = menuItems[activeCategory] ?? [];
const [isChatOpen, setIsChatOpen] = useState(true);
const [chatInput, setChatInput] = useState("");
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
  {
    id: "welcome",
    role: "assistant",
    text: "Hi! I'm Bobi, your Boba House assistant. Ask about categories, prices, toppings, recommendations, or say 'add thai milk tea' and I'll put it in your cart.",
  },
]);

const flatMenu = useMemo(
  () =>
    categories.flatMap((category) =>
      (menuItems[category] ?? []).map((item) => ({ ...item, category }))
    ),
  [categories, menuItems]
);

useEffect(() => {
  chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [chatMessages, isChatOpen]);

useEffect(() => {
  if (fetcher.state === "idle" && fetcher.data?.ok) {
    setCart([]);
    setShowCart(false);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: "Your order was placed successfully. Want help starting another order?",
      },
    ]);
  }
}, [fetcher.state, fetcher.data]);
const buildAssistantReply = (message: string): string => {
  const normalized = normalizeText(message);

  if (!normalized) {
    return "Ask me anything about the menu or ordering.";
  }

  if (normalized.includes("help")) {
    return "You can ask things like: 'show fruit tea', 'what toppings do you have', 'what is the cheapest drink', 'recommend something', or 'add classic milk tea'.";
  }

  if (normalized.includes("cart") || normalized.includes("order summary")) {
    if (cart.length === 0) return "Your cart is empty right now.";
    const summary = cart.map((item) => `${item.name} x${item.qty}`).join(", ");
    return `Your cart has ${summary}. Current total: $${total.toFixed(2)}.`;
  }

  if (normalized.includes("topping")) {
    return `Available toppings are ${TOPPINGS.map((t) => `${t.name} ($${t.price.toFixed(2)})`).join(", ")}.`;
  }

  if (normalized.includes("category") || normalized.startsWith("show menu")) {
    return `Our categories are ${categories.join(", ")}.`;
  }

  const matchingCategory = categories.find((category) => {
    const normalizedCategory = normalizeText(category);
    return normalized.includes(normalizedCategory) || normalizedCategory.includes(normalized);
  });

  if (
    matchingCategory &&
    (normalized.includes("show") ||
      normalized.includes("have") ||
      normalized.includes("what") ||
      normalized.includes("category"))
  ) {
    setActiveCategory(matchingCategory);
    setShowCart(false);
    const categoryItems = (menuItems[matchingCategory] ?? []).slice(0, 6);
    const list = categoryItems.map((item) => `${item.name} ($${item.price.toFixed(2)})`).join(", ");
    return `${matchingCategory} includes ${list}${(menuItems[matchingCategory] ?? []).length > 6 ? ", and more." : "."}`;
  }

  if (normalized.includes("cheapest") || normalized.includes("lowest price")) {
    const cheapest = [...flatMenu].sort((a, b) => a.price - b.price)[0];
    if (!cheapest) return "I couldn't find any menu items right now.";
    return `The cheapest item right now is ${cheapest.name} from ${cheapest.category} for $${cheapest.price.toFixed(2)}.`;
  }

  if (
    normalized.includes("recommend") ||
    normalized.includes("popular") ||
    normalized.includes("suggest")
  ) {
    const picks = [...flatMenu].slice(0, 3);
    if (picks.length === 0) return "I couldn't load recommendations right now.";
    return `You could try ${picks.map((item) => `${item.name} ($${item.price.toFixed(2)})`).join(", ")}.`;
  }

  const itemMatch = flatMenu.find((item) => {
    const normalizedName = normalizeText(item.name);
    return normalized.includes(normalizedName) || normalizedName.includes(normalized);
  });

  if (
    itemMatch &&
    (normalized.includes("price") || normalized.includes("cost") || normalized.includes("how much"))
  ) {
    return `${itemMatch.name} costs $${itemMatch.price.toFixed(2)}.`;
  }

  if (
    itemMatch &&
    (normalized.startsWith("add ") ||
      normalized.includes("add to cart") ||
      normalized.includes("order ") ||
      normalized.includes("i want "))
  ) {
    addGeneratedCartItem(createCartItem(itemMatch));
    setShowCart(true);
    return `${itemMatch.name} was added to your cart with default options.`;
  }

  if (itemMatch) {
    return `${itemMatch.name} is in the ${itemMatch.category} category and costs $${itemMatch.price.toFixed(2)}. Say 'add ${itemMatch.name.toLowerCase()}' if you want it in your cart.`;
  }

  return "I can help with categories, prices, toppings, recommendations, and adding drinks to your cart. Try 'show milk tea' or 'add taro milk tea'.";
};


const sendChatMessage = () => {
  const trimmed = chatInput.trim();
  if (!trimmed) return;

  const userMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    role: "user",
    text: trimmed,
  };

  const replyText = buildAssistantReply(trimmed);

  const assistantMessage: ChatMessage = {
    id: `assistant-${Date.now() + 1}`,
    role: "assistant",
    text: replyText,
  };

  setChatMessages((prev) => [...prev, userMessage, assistantMessage]);
  setChatInput("");
};


<div className="section-card p-0 mb-6 overflow-hidden">
  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
    <div>
      <h3 className="text-sm font-bold text-slate-900">Personal Assistant</h3>
      <p className="text-xs text-slate-500">Menu help and ordering assistant</p>
    </div>
    <button
      onClick={() => setIsChatOpen((prev) => !prev)}
      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
    >
      {isChatOpen ? "Collapse" : "Open"}
    </button>
  </div>

  {isChatOpen ? (
    <>
      <div className="h-72 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
        {chatMessages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
              message.role === "assistant"
                ? "bg-white text-slate-800 border border-slate-200"
                : "bg-indigo-600 text-white ml-auto"
            }`}
          >
            {message.text}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="border-t border-slate-200 p-3 bg-white">
        <div className="flex gap-2 mb-2 flex-wrap">
          {[
            "Show milk tea",
            "What toppings do you have?",
            "What is the cheapest drink?",
            "Recommend something",
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => setChatInput(prompt)}
              className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendChatMessage();
            }}
            placeholder="Ask about menu items or type 'add thai milk tea'"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button onClick={sendChatMessage} className="primary-btn px-4 py-2 text-sm">
            Send
          </button>
        </div>
      </div>
    </>
  ) : (
    <button
      onClick={() => setIsChatOpen(true)}
      className="m-4 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 hover:bg-slate-50"
    >
      Open assistant
    </button>
  )}
</div>

const chatEndRef = useRef<HTMLDivElement | null>(null);
  return (
    <div className="h-screen flex flex-col app-shell">
      {/* Header */}
      <header className="app-header px-6 py-4 shrink-0">
        <div className="topbar-row">
          <div className="topbar-brand">
            <button
              onClick={() => navigate("/portal")}
              className="brand-link hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded"
            >
              Boba House
            </button>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Customer Kiosk</span>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto page-section w-full px-4 py-5">
        {showCart ? (
          <div className="max-w-2xl mx-auto section-card p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="section-title">Your Cart</h2>
                <p className="section-description">Review selected items and place your order.</p>
              </div>
              <button
                onClick={() => setShowCart(false)}
                className="secondary-btn px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                Back to Menu
              </button>
            </div>
            {cart.length === 0 ? (
              <p className="text-slate-500 text-sm">No items in cart.</p>
            ) : (
              <>
                <div className="section-card divide-y divide-slate-100">
                  {cart.map((item) => (
                    <div key={item.cartKey} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="text-slate-800 font-medium">{item.name} ×{item.qty}</p>
                        <p className="text-slate-400 text-xs mt-0.5">
                          {[
                            item.milkLevel !== "Whole Milk" && `Milk: ${item.milkLevel}`,
                            item.iceLevel  !== "Regular" && `Ice: ${item.iceLevel}`,
                            item.toppings.length > 0 && item.toppings.map((t) => t.name).join(", "),
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="flex items-center gap-3 text-slate-700">
                        <span>${(item.price * item.qty).toFixed(2)}</span>
                        <button
                          onClick={() => removeFromCart(item.cartKey)}
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
                  onClick={() => fetcher.submit(
                    { cart: JSON.stringify(cart.map((i) => ({ id: i.id, basePrice: i.basePrice, qty: i.qty }))) },
                    { method: "post" }
                  )}
                  disabled={fetcher.state !== "idle"}
                  className="primary-btn mt-4 w-full py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {fetcher.state !== "idle" ? "Placing order…" : "Place Order"}
                </button>
                {fetcher.data && !fetcher.data.ok && (
                  <p className="text-xs text-red-600 mt-2 text-center">
                    {"error" in fetcher.data ? fetcher.data.error : "Failed to place order"}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="section-card p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="section-title">Menu</h2>
                <p className="section-description">Choose a category, then tap an item to customize and add it to your cart.</p>
              </div>
              <button
                onClick={() => setShowCart(true)}
                className="primary-btn px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 whitespace-nowrap"
              >
                Cart ({totalItems})
              </button>
            </div>

            <div className="mb-5">
              <div
                className="grid gap-2 w-full"
                style={{ gridTemplateColumns: `repeat(${Math.max(categories.length, 1)}, minmax(0, 1fr))` }}
              >
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setActiveCategory(cat);
                      setShowCart(false);
                    }}
                    aria-pressed={activeCategory === cat}
                    className={`px-3 py-2.5 rounded-lg text-sm font-semibold text-center transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      activeCategory === cat
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">{activeCategory}</h3>
              <p className="section-description">Available items in this category.</p>
            </div>

            <div className="grid grid-cols-4 gap-3">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openItem(item)}
                    className="section-card p-5 text-left hover:bg-indigo-50 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  >
                    <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="text-sm text-slate-500 mt-1">${item.price.toFixed(2)}</p>
                    {item.allergens.length > 0 && (
                      <p className="mt-2 text-base leading-none" aria-label={`Contains: ${item.allergens.join(", ")}`}>
                        {item.allergens.map((a) => ALLERGEN_ICONS[a]).join(" ")}
                      </p>
                    )}
                  </button>
                ))}
              </div>
              {items.length === 0 && (
              <p className="text-sm text-slate-500 py-8 text-center">No items available in this category right now.</p>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <footer className="soft-footer px-6 py-1.5 shrink-0">
        <p className="text-xs">Customer kiosk — tap an item to customize and add to your order</p>
      </footer>

      {/* Customization popup */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Customize ${selectedItem.name}`}
          onClick={(e) => { if (e.target === e.currentTarget) closePopup(); }}
        >
          <div className="surface-card w-full max-w-md p-6">

            {/* Item header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedItem.name}</h2>
                <p className="text-slate-500 text-sm mt-0.5">${selectedItem.price.toFixed(2)}</p>
              </div>
              {selectedItem.allergens.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-slate-400 mb-1">Contains</p>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {selectedItem.allergens.map((a) => (
                      <span
                        key={a}
                        title={a.replace("-", " ")}
                        className="inline-flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-2 py-0.5"
                      >
                        {ALLERGEN_ICONS[a]} {a.replace("-", " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ice level */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Ice Level</p>
              <div className="grid grid-cols-4 gap-2">
                {ICE_LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() => setIceLevel(level)}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${iceLevel === level
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                      }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Milk level — only for milk-based drinks */}
            {selectedItem.hasMilk && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-700 mb-2">Milk Type</p>
                <div className="grid grid-cols-3 gap-2">
                  {MILK_TYPES.map((level) => (
                    <button
                      key={level}
                      onClick={() => setMilkLevel(level)}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                        ${milkLevel === level
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                        }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Toppings */}
            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-700 mb-2">Toppings <span className="text-slate-400 font-normal">(+$0.75 each)</span></p>
              <div className="grid grid-cols-2 gap-2">
                {TOPPINGS.map((topping) => (
                  <button
                    key={topping.id}
                    onClick={() => toggleTopping(topping.id)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                      ${selectedToppings.includes(topping.id)
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                      }`}
                  >
                    {topping.name}
                    {topping.allergens.length > 0 && (
                      <span className="ml-1">{topping.allergens.map((a) => ALLERGEN_ICONS[a]).join("")}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-2">
              <button
                onClick={closePopup}
                className="secondary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddToCart}
                className="primary-btn flex-1 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors"
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  
}
