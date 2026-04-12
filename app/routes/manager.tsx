import { useState, useEffect } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/manager";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Manager — Boba House" }];
}

interface InventoryItem {
  id:         string;
  name:       string;
  category:   string;
  price:      number;
  onMenu:     boolean;
  isSeasonal: boolean;
}

interface Employee {
  id:         string;
  name:       string;
  start_date: string;
}

export async function loader() {
  const [itemsResult, employeesResult] = await Promise.all([
    pool.query(
      `SELECT item_id::text AS id, name, category, price::float AS price,
              is_active AS "onMenu", COALESCE(is_seasonal, false) AS "isSeasonal"
       FROM "Item" ORDER BY category, name`
    ),
    pool.query(
      `SELECT employee_id::text AS id, name, start_date::text
       FROM "Employee" ORDER BY name`
    ),
  ]);
  return {
    inventory: itemsResult.rows as InventoryItem[],
    employees: employeesResult.rows as Employee[],
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await pool.query(`UPDATE "Item" SET is_active = false WHERE item_id = $1::uuid`, [id]);
    return { ok: true };
  }

  if (intent === "add") {
    const name       = formData.get("name") as string;
    const category   = formData.get("category") as string;
    const price      = Number(formData.get("price"));
    const isSeasonal = formData.get("isSeasonal") === "true";
    await pool.query(
      `INSERT INTO "Item" (item_id, name, category, price, is_active, milk, ice, sugar, toppings, is_seasonal)
       VALUES (gen_random_uuid(), $1, $2, $3, true, '', 0, 0.0, '{}', $4)`,
      [name, category, price, isSeasonal]
    );
    return { ok: true };
  }

  if (intent === "edit") {
    const id         = formData.get("id") as string;
    const name       = formData.get("name") as string;
    const category   = formData.get("category") as string;
    const price      = Number(formData.get("price"));
    const isSeasonal = formData.get("isSeasonal") === "true";
    await pool.query(
      `UPDATE "Item" SET name = $1, category = $2, price = $3, is_seasonal = $4
       WHERE item_id = $5::uuid`,
      [name, category, price, isSeasonal, id]
    );
    return { ok: true };
  }

  return { ok: false };
}

const TABS = ["Inventory", "Menu", "Employees"] as const;

const inputCls = "border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 w-full focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600";

function SeasonalToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${value ? "bg-blue-600" : "bg-slate-200"}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      <span className="text-sm font-medium text-slate-700">Seasonal item</span>
      {value && <span className="text-xs text-slate-400">(also appears in Seasonal category)</span>}
    </div>
  );
}

export default function Manager() {
  const { inventory, employees } = useLoaderData<typeof loader>();
  const navigate  = useNavigate();
  const fetcher   = useFetcher<typeof action>();

  const [activeTab, setActiveTab]     = useState("Inventory");
  const [selected, setSelected]       = useState<string | null>(null);
  const [showAdd, setShowAdd]         = useState(false);
  const [editItem, setEditItem]       = useState<InventoryItem | null>(null);
  const [addForm, setAddForm]         = useState({ name: "", category: "", price: "", isSeasonal: false });
  const [editSeasonal, setEditSeasonal] = useState(false);

  // Close modals and clear selection after successful mutation
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setShowAdd(false);
      setEditItem(null);
      setSelected(null);
      setAddForm({ name: "", category: "", price: "", isSeasonal: false });
    }
  }, [fetcher.state, fetcher.data]);

  const openEdit = () => {
    const item = inventory.find((i) => i.id === selected);
    if (!item) return;
    setEditItem(item);
    setEditSeasonal(item.isSeasonal);
  };

  const handleDelete = () => {
    if (!selected) return;
    fetcher.submit({ intent: "delete", id: selected }, { method: "post" });
  };

  const busy = fetcher.state !== "idle";

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <button
          onClick={() => navigate("/portal")}
          className="text-white text-xl font-bold tracking-wide hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded"
        >
          Boba House
        </button>
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
                ${activeTab === tab ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-y-auto">

          {activeTab === "Inventory" && (
            <section aria-label="Inventory management">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">Inventory</h2>
                <button
                  onClick={() => setShowAdd(true)}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                >
                  + Add Item
                </button>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Category</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Price</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Seasonal</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">On Menu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventory.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelected(selected === item.id ? null : item.id)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setSelected(selected === item.id ? null : item.id)}
                        aria-selected={selected === item.id}
                        className={`cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600
                          ${selected === item.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3 text-slate-900 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.category}</td>
                        <td className="px-4 py-3 text-slate-800">${Number(item.price).toFixed(2)}</td>
                        <td className="px-4 py-3 text-slate-600">{item.isSeasonal ? "Yes" : "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{item.onMenu ? "Yes" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={openEdit}
                  disabled={!selected}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Edit selected
                </button>
                <button
                  onClick={handleDelete}
                  disabled={!selected || busy}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium border border-red-300 bg-white text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? "Deleting…" : "Delete selected"}
                </button>
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
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Price</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Seasonal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventory.filter((i) => i.onMenu).map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-900 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.category}</td>
                        <td className="px-4 py-3 text-slate-800">${Number(item.price).toFixed(2)}</td>
                        <td className="px-4 py-3 text-slate-600">{item.isSeasonal ? "🍂 Yes" : "—"}</td>
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
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Start Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-900 font-medium">{emp.name}</td>
                        <td className="px-4 py-3 text-slate-700">{emp.start_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </main>
      </div>

      {/* Status bar */}
      <footer style={{ padding: "6px 20px", borderTop: "1px solid #ccc", fontSize: "12px", color: "#777" }}>
        Manager — menu, inventory, employees
      </footer>

      {/* Add Item Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-5">Add Item</h2>
            <fetcher.Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="add" />
              <input type="hidden" name="isSeasonal" value={String(addForm.isSeasonal)} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input name="name" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} required className={inputCls} placeholder="Item name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <input name="category" value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} required className={inputCls} placeholder="e.g. Milk Teas" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Price ($)</label>
                <input name="price" type="number" step="0.01" min="0" value={addForm.price} onChange={(e) => setAddForm({ ...addForm, price: e.target.value })} required className={inputCls} placeholder="0.00" />
              </div>
              <SeasonalToggle value={addForm.isSeasonal} onChange={(v) => setAddForm({ ...addForm, isSeasonal: v })} />
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 focus:outline-none transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
                  {busy ? "Adding…" : "Add Item"}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {editItem && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setEditItem(null); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-5">Edit Item</h2>
            <fetcher.Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="edit" />
              <input type="hidden" name="id" value={editItem.id} />
              <input type="hidden" name="isSeasonal" value={String(editSeasonal)} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input name="name" defaultValue={editItem.name} required className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <input name="category" defaultValue={editItem.category} required className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Price ($)</label>
                <input name="price" type="number" step="0.01" min="0" defaultValue={editItem.price} required className={inputCls} />
                <p className="text-xs text-slate-400 mt-1">Price changes only apply to new orders</p>
              </div>
              <SeasonalToggle value={editSeasonal} onChange={setEditSeasonal} />
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setEditItem(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 focus:outline-none transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
                  {busy ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}
    </div>
  );
}
