import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/manager";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Manager" }];
}

export async function loader() {
  const result = await pool.query("SELECT current_database() AS db, now()::text AS time");
  return { dbCheck: result.rows[0] };
}

interface InventoryItem {
  id: number;
  name: string;
  category: string;
  qty: number;
  min: number;
  onMenu: boolean;
}

interface Employee {
  id: number;
  name: string;
  role: string;
  hours: number;
}

const INITIAL_INVENTORY: InventoryItem[] = [
  { id: 1, name: "Passion Fruit",        category: "Milk Tea",   qty: 145, min: 10, onMenu: true  },
  { id: 2, name: "Matcha Latte",         category: "Specialty",  qty: 16,  min: 10, onMenu: true  },
  { id: 3, name: "Peach Milk Tea",       category: "Milk Tea",   qty: 20,  min: 10, onMenu: true  },
  { id: 4, name: "Wintermelon Milk Tea", category: "Milk Tea",   qty: 20,  min: 10, onMenu: true  },
  { id: 5, name: "Honeydew Milk Tea",    category: "Milk Tea",   qty: 16,  min: 10, onMenu: true  },
  { id: 6, name: "Mango Milk Tea",       category: "Milk Tea",   qty: 16,  min: 10, onMenu: true  },
  { id: 7, name: "Classic Milk Tea",     category: "Milk Tea",   qty: 19,  min: 10, onMenu: true  },
  { id: 8, name: "Grape Chia",           category: "Milk Tea",   qty: 199, min: 10, onMenu: true  },
  { id: 9, name: "Jasmine Green Tea",    category: "Brewed Tea", qty: 3,   min: 10, onMenu: true  },
];

const INITIAL_EMPLOYEES: Employee[] = [
  { id: 1, name: "Alice Johnson", role: "Cashier", hours: 32 },
  { id: 2, name: "Bob Smith",     role: "Kitchen", hours: 28 },
  { id: 3, name: "Carol Lee",     role: "Manager", hours: 40 },
];

const TABS = ["Inventory", "Menu", "Employees"] as const;
type Tab = typeof TABS[number];

export default function Manager() {
  const { dbCheck } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("Inventory");
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [selected, setSelected] = useState<number | null>(null);
  const [newItem, setNewItem] = useState({ name: "", category: "", qty: "", min: "" });
  const [employees] = useState<Employee[]>(INITIAL_EMPLOYEES);

  const handleSelect = (id: number) => setSelected(selected === id ? null : id);

  const handleDelete = () => {
    if (selected === null) return;
    setInventory((prev) => prev.filter((i) => i.id !== selected));
    setSelected(null);
  };

  const handleAdd = () => {
    if (!newItem.name || !newItem.category) return;
    const nextId = inventory.length ? Math.max(...inventory.map((i) => i.id)) + 1 : 1;
    setInventory((prev) => [
      ...prev,
      { id: nextId, name: newItem.name, category: newItem.category, qty: Number(newItem.qty) || 0, min: Number(newItem.min) || 0, onMenu: false },
    ]);
    setNewItem({ name: "", category: "", qty: "", min: "" });
  };

  const toggleMenu = (id: number) =>
    setInventory((prev) => prev.map((i) => i.id === id ? { ...i, onMenu: !i.onMenu } : i));

  const inputCls = "border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600";
  const btnCls = "px-4 py-1.5 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-colors";

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <button onClick={() => navigate("/portal")} className="text-white text-xl font-bold tracking-wide hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded">Boba House</button>
        <span className="text-slate-300 text-sm font-medium">Manager</span>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <nav className="w-44 bg-white border-r border-slate-200 p-4 flex flex-col gap-1 shrink-0" aria-label="Manager sections">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2 px-2">Sections</p>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              aria-pressed={activeTab === tab}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600
                ${activeTab === tab
                  ? "bg-blue-600 text-white"
                  : "text-slate-700 hover:bg-slate-100"
                }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-y-auto">

          {activeTab === "Inventory" && (
            <section aria-label="Inventory management">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Inventory</h2>

              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">ID</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Category</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Qty</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Min</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">On Menu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventory.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => handleSelect(item.id)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && handleSelect(item.id)}
                        aria-selected={selected === item.id}
                        className={`cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600
                          ${selected === item.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3 text-slate-600">{item.id}</td>
                        <td className="px-4 py-3 text-slate-900 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.category}</td>
                        <td className={`px-4 py-3 font-medium ${item.qty <= item.min ? "text-red-600" : "text-slate-800"}`}>{item.qty}</td>
                        <td className="px-4 py-3 text-slate-600">{item.min}</td>
                        <td className="px-4 py-3 text-slate-600">{item.onMenu ? "Yes" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2 mb-8">
                <button onClick={handleDelete} className="px-4 py-1.5 rounded-lg text-sm font-medium border border-red-300 bg-white text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors">
                  Delete selected
                </button>
                <button onClick={() => selected !== null && toggleMenu(selected)} className={btnCls}>
                  Toggle on menu
                </button>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Add new item</h3>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Name</label>
                    <input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="Name" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Category</label>
                    <input value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} placeholder="Category" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Qty</label>
                    <input value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} placeholder="0" className={`${inputCls} w-20`} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Minimum</label>
                    <input value={newItem.min} onChange={(e) => setNewItem({ ...newItem, min: e.target.value })} placeholder="0" className={`${inputCls} w-20`} />
                  </div>
                  <button onClick={handleAdd} className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 text-white text-sm font-semibold rounded-lg transition-colors">
                    Add
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === "Menu" && (
            <section aria-label="Menu items">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Menu</h2>
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Category</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">On Menu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventory.filter((i) => i.onMenu).map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-900 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.category}</td>
                        <td className="px-4 py-3 text-green-700 font-medium">Yes</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "Employees" && (
            <section aria-label="Employee list">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Employees</h2>
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">ID</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Role</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Hours This Week</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600">{emp.id}</td>
                        <td className="px-4 py-3 text-slate-900 font-medium">{emp.name}</td>
                        <td className="px-4 py-3 text-slate-700">{emp.role}</td>
                        <td className="px-4 py-3 text-slate-700">{emp.hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* STATUS BAR */}
      <div style={{ padding: "6px 20px", borderTop: "1px solid #ccc", fontSize: "12px", color: "#777" }}>
        Manager — menu, inventory, employees &nbsp;|&nbsp; DB: {dbCheck?.db} @ {dbCheck?.time}
      </div>
    </div>
  );
}
