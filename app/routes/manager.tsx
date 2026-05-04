import { useState, useEffect, useContext } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/manager";
import pool from "../db.server";
import { requireSignedIn } from "../clerk-auth.server";
import { translateText } from "../translate";
import { TranslationContext } from "../root";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Manager — Boba House" }];
}

interface InventoryItem {
  id:          string;
  name:        string;
  category:    string;
  price:       number;
  onMenu:      boolean;
  isSeasonal:  boolean;
  quantity:    number;
  minQuantity: number;
}

interface Employee {
  id:         string;
  name:       string;
  start_date: string;
  hasPin:     boolean;
  pin:        string;
}

interface CustomerRow {
  id:          string;
  name:        string;
  phone:       string;
  points:      number;
  orderCount:  number;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireSignedIn({ request, context });
  const [itemsResult, employeesResult, customersResult] = await Promise.all([
    pool.query(
      `SELECT item_id::text AS id, name, category, price::float AS price,
              is_active AS "onMenu", COALESCE(is_seasonal, false) AS "isSeasonal",
              COALESCE(quantity, 0) AS quantity, COALESCE(min_quantity, 0) AS "minQuantity"
       FROM "Item" ORDER BY category, name`
    ),
    pool.query(
      `SELECT employee_id::text AS id, name, start_date::text,
              COALESCE(pin, '') AS pin,
              (pin IS NOT NULL AND pin <> '') AS "hasPin"
       FROM "Employee" ORDER BY name`
    ),
    pool.query(
      `SELECT c.customer_id::text AS id, c.name, c.phone_number AS phone,
              COALESCE(c.points, 0)::int AS points,
              COUNT(o.order_id)::int AS "orderCount"
       FROM "Customer" c
       LEFT JOIN "Order" o ON o.customer_id = c.customer_id
       WHERE c.phone_number IS NOT NULL AND c.phone_number <> ''
       GROUP BY c.customer_id, c.name, c.phone_number, c.points
       ORDER BY c.points DESC`
    ),
  ]);
  return {
    inventory: itemsResult.rows as InventoryItem[],
    employees: employeesResult.rows as Employee[],
    customers: customersResult.rows as CustomerRow[],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await requireSignedIn({ request, context });
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await pool.query(`DELETE FROM "Order_Item" WHERE item_id = $1::uuid`, [id]);
    await pool.query(`DELETE FROM "Item" WHERE item_id = $1::uuid`, [id]);
    return { ok: true };
  }

  if (intent === "add") {
    const name        = formData.get("name") as string;
    const category    = formData.get("category") as string;
    const price       = Number(formData.get("price"));
    const isSeasonal  = formData.get("isSeasonal") === "true";
    const quantity    = Number(formData.get("quantity") ?? 0);
    const minQuantity = Number(formData.get("minQuantity") ?? 0);
    await pool.query(
      `INSERT INTO "Item" (item_id, name, category, price, is_active, milk, ice, sugar, toppings, is_seasonal, quantity, min_quantity)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, '', 0, 0.0, '{}', $5, $6, $7)`,
      [name, category, price, quantity >= minQuantity, isSeasonal, quantity, minQuantity]
    );
    return { ok: true };
  }

  if (intent === "edit") {
    const id          = formData.get("id") as string;
    const name        = formData.get("name") as string;
    const category    = formData.get("category") as string;
    const price       = Number(formData.get("price"));
    const isSeasonal  = formData.get("isSeasonal") === "true";
    const quantity    = Number(formData.get("quantity") ?? 0);
    const minQuantity = Number(formData.get("minQuantity") ?? 0);
    // Auto-remove from menu when stock drops below minimum
    await pool.query(
      `UPDATE "Item"
       SET name = $1, category = $2, price = $3, is_seasonal = $4,
           quantity = $5, min_quantity = $6,
           is_active = CASE WHEN $5::int < $6::int THEN false ELSE is_active END
       WHERE item_id = $7::uuid`,
      [name, category, price, isSeasonal, quantity, minQuantity, id]
    );
    return { ok: true };
  }

  if (intent === "toggle-menu") {
    const id = formData.get("id") as string;
    await pool.query(
      `UPDATE "Item"
       SET is_active = CASE
         WHEN is_active = true THEN false
         WHEN quantity >= min_quantity THEN true
         ELSE false
       END
       WHERE item_id = $1::uuid`,
      [id]
    );
    return { ok: true };
  }

  if (intent === "toggle-seasonal") {
    const id = formData.get("id") as string;
    await pool.query(`UPDATE "Item" SET is_seasonal = NOT is_seasonal WHERE item_id = $1::uuid`, [id]);
    return { ok: true };
  }

  if (intent === "x-report") {
    const today = new Date().toISOString().slice(0, 10);
    const hourly = await pool.query(
      `SELECT EXTRACT(HOUR FROM event_time AT TIME ZONE 'America/Chicago')::int AS hr,
              COUNT(*)::int AS sales_count,
              COALESCE(SUM(amount), 0)::float AS sales_total,
              COALESCE(SUM(tax_amount), 0)::float AS tax_total
         FROM pos_sales_activity
        WHERE business_date = $1 AND activity_type = 'SALE'
     GROUP BY hr ORDER BY hr`,
      [today]
    );
    const totals = await pool.query(
      `SELECT COUNT(*)::int AS sales_count,
              COALESCE(SUM(amount), 0)::float AS sales_total,
              COALESCE(SUM(tax_amount), 0)::float AS tax_total,
              COALESCE(SUM(CASE WHEN LOWER(payment_method)='cash' THEN amount ELSE 0 END), 0)::float AS cash_total,
              COALESCE(SUM(CASE WHEN LOWER(payment_method)<>'cash' THEN amount ELSE 0 END), 0)::float AS non_cash_total,
              COALESCE(SUM(item_count), 0)::int AS item_count
         FROM pos_sales_activity
        WHERE business_date = $1 AND activity_type = 'SALE'`,
      [today]
    );
    const lines: string[] = [`X REPORT`, `Business date: ${today}`, ``];
    lines.push(`${"Hour".padEnd(8)}${"Sales".padEnd(8)}${"Revenue".padEnd(14)}Tax`);
    for (const r of hourly.rows) {
      lines.push(`${String(r.hr).padStart(2, "0")}:00   ${String(r.sales_count).padEnd(8)}$${Number(r.sales_total).toFixed(2).padEnd(13)} $${Number(r.tax_total).toFixed(2)}`);
    }
    if (hourly.rows.length === 0) lines.push("(no sales recorded today)");
    const t = totals.rows[0];
    lines.push(``, `Totals`, `Sales: ${t.sales_count}`, `Items sold: ${t.item_count}`,
      `Revenue: $${Number(t.sales_total).toFixed(2)}`, `Tax: $${Number(t.tax_total).toFixed(2)}`,
      `Returns: 0  Voids: 0  Discards: 0`,
      `Cash payments: $${Number(t.cash_total).toFixed(2)}`,
      `Other payments: $${Number(t.non_cash_total).toFixed(2)}`);
    return { ok: true, report: lines.join("\n") };
  }

  if (intent === "z-report-view") {
    const today = new Date().toISOString().slice(0, 10);
    const result = await pool.query(`SELECT report_text FROM pos_z_report WHERE report_date = $1`, [today]);
    const text = result.rows[0]?.report_text;
    return { ok: true, report: text ?? `Z REPORT\nBusiness date: ${today}\n\nNo Z-report generated yet today.` };
  }

  if (intent === "z-report-generate") {
    const today = new Date().toISOString().slice(0, 10);
    const existing = await pool.query(`SELECT report_text FROM pos_z_report WHERE report_date = $1`, [today]);
    if (existing.rows.length > 0) {
      return { ok: true, report: (existing.rows[0].report_text || "") + "\n\n(Already generated today — Z can only run once per business date.)" };
    }
    const totals = await pool.query(
      `SELECT COUNT(*)::int AS sales_count,
              COALESCE(SUM(amount), 0)::float AS sales_total,
              COALESCE(SUM(tax_amount), 0)::float AS tax_total,
              COALESCE(SUM(CASE WHEN LOWER(payment_method)='cash' THEN amount ELSE 0 END), 0)::float AS cash_total,
              COALESCE(SUM(CASE WHEN LOWER(payment_method)<>'cash' THEN amount ELSE 0 END), 0)::float AS non_cash_total,
              COALESCE(SUM(item_count), 0)::int AS item_count
         FROM pos_sales_activity
        WHERE business_date = $1 AND activity_type = 'SALE'`,
      [today]
    );
    const t = totals.rows[0];
    const reportText = [
      `Z REPORT`, `Business date: ${today}`, ``,
      `Sales count: ${t.sales_count}`,
      `Items sold: ${t.item_count}`,
      `Gross sales: $${Number(t.sales_total).toFixed(2)}`,
      `Tax: $${Number(t.tax_total).toFixed(2)}`,
      `Cash total: $${Number(t.cash_total).toFixed(2)}`,
      `Other payments: $${Number(t.non_cash_total).toFixed(2)}`,
      `Discounts: $0.00  Voids: 0  Service charges: $0.00`,
      ``, `Employee signature: __________________________`,
    ].join("\n");
    await pool.query(
      `INSERT INTO pos_z_report (report_date, report_text) VALUES ($1, $2)`,
      [today, reportText]
    );
    await pool.query(`DELETE FROM pos_sales_activity WHERE business_date = $1`, [today]);
    return { ok: true, report: reportText + "\n\nX/Z counters reset for next business day." };
  }

  if (intent === "set-pin") {
    const id  = formData.get("id")  as string;
    const pin = String(formData.get("pin") || "").trim();
    if (!pin || !/^\d{4,8}$/.test(pin)) return { ok: false, error: "PIN must be 4–8 digits" };
    await pool.query(`UPDATE "Employee" SET pin = $1 WHERE employee_id = $2::uuid`, [pin, id]);
    return { ok: true };
  }

  if (intent === "z-report-reset") {
    const pin   = String(formData.get("pin") || "").trim();
    const today = new Date().toISOString().slice(0, 10);
    if (pin !== "1234") return { ok: true, report: "ERROR: Incorrect master PIN." };

    await pool.query(`DELETE FROM pos_z_report WHERE report_date = $1`, [today]);
    await pool.query(`DELETE FROM pos_sales_activity WHERE business_date = $1`, [today]);

    const orders = await pool.query(
      `SELECT o.order_id, o.date, o.total_price,
              COALESCE(SUM(oi.quantity), 0)::int AS item_count,
              COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric AS subtotal
       FROM "Order" o
       LEFT JOIN "Order_Item" oi ON oi.order_id = o.order_id
       WHERE o.date::date = $1 AND o.status NOT IN ('scheduled')
       GROUP BY o.order_id, o.date, o.total_price ORDER BY o.date`,
      [today]
    );
    for (const row of orders.rows) {
      const total = parseFloat(row.total_price);
      const sub   = parseFloat(row.subtotal);
      const tax   = Math.max(0, total - sub).toFixed(2);
      await pool.query(
        `INSERT INTO pos_sales_activity
         (activity_id, business_date, event_time, activity_type, order_id, amount, tax_amount, payment_method, item_count)
         VALUES (gen_random_uuid(), $1, $2, 'SALE', $3, $4, $5, 'Cash', $6)`,
        [today, row.date, row.order_id, total.toFixed(2), tax, row.item_count]
      );
    }
    return { ok: true, report: `Z-report reset. Rebuilt ${orders.rows.length} sale entries from today's orders.\nYou can now run the X-report and regenerate the Z-report.` };
  }

  if (intent === "add-employee") {
    const name       = formData.get("name") as string;
    const start_date = formData.get("start_date") as string;
    await pool.query(
      `INSERT INTO "Employee" (employee_id, name, start_date) VALUES (gen_random_uuid(), $1, $2)`,
      [name, start_date]
    );
    return { ok: true };
  }

  if (intent === "edit-employee") {
    const id         = formData.get("id") as string;
    const name       = formData.get("name") as string;
    const start_date = formData.get("start_date") as string;
    const pin        = String(formData.get("pin") || "").trim();
    if (pin) {
      if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: "PIN must be 4–8 digits" };
      await pool.query(
        `UPDATE "Employee" SET name = $1, start_date = $2, pin = $3 WHERE employee_id = $4::uuid`,
        [name, start_date, pin, id]
      );
    } else {
      await pool.query(
        `UPDATE "Employee" SET name = $1, start_date = $2 WHERE employee_id = $3::uuid`,
        [name, start_date, id]
      );
    }
    return { ok: true };
  }

  if (intent === "edit-customer") {
    const id     = formData.get("id")    as string;
    const name   = formData.get("name")  as string;
    const phone  = (formData.get("phone") as string).replace(/\D/g, "");
    const points = Math.max(0, parseInt(String(formData.get("points") || "0"), 10));
    await pool.query(
      `UPDATE "Customer" SET name = $1, phone_number = $2, points = $3 WHERE customer_id = $4::uuid`,
      [name, phone, points, id]
    );
    return { ok: true };
  }

  if (intent === "delete-customer") {
    const id = formData.get("id") as string;
    try {
      await pool.query(`DELETE FROM "Customer" WHERE customer_id = $1::uuid`, [id]);
      return { ok: true };
    } catch {
      return { ok: false, error: "Cannot delete: this customer has order history." };
    }
  }

  if (intent === "delete-employee") {
    const id = formData.get("id") as string;
    await pool.query(`DELETE FROM "Employee" WHERE employee_id = $1::uuid`, [id]);
    return { ok: true };
  }

  return { ok: false };
}

const TABS = ["Inventory", "Menu", "Employees", "Customers", "Reports"] as const;

const inputCls = "field-input text-sm";

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

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
  const { inventory, employees, customers } = useLoaderData<typeof loader>();
  const navigate  = useNavigate();
  const fetcher   = useFetcher<typeof action>();

  const translationContext = useContext(TranslationContext);
  const language = translationContext?.language ?? "en";

  const [activeTab, setActiveTab]     = useState("Inventory");
  const [translatedUI, setTranslatedUI] = useState({ inventory: "Inventory", employees: "Employees" });

  useEffect(() => {
    if (language === "en") {
      setTranslatedUI({ inventory: "Inventory", employees: "Employees" });
      return;
    }
    Promise.all([
      translateText("Inventory", { to: language }),
      translateText("Employees", { to: language })
    ]).then(([inventory, employees]) => {
      setTranslatedUI({ inventory, employees });
    });
  }, [language]);

  const [selected, setSelected]           = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [showAdd, setShowAdd]             = useState(false);
  const [editItem, setEditItem]           = useState<InventoryItem | null>(null);
  const [setPinFor, setSetPinFor]         = useState<Employee | null>(null);
  const [pinInputVal, setPinInputVal]     = useState("");
  const [pinSetError, setPinSetError]     = useState<string | null>(null);
  const [showPinText, setShowPinText]     = useState(false);
  const [showEditPin, setShowEditPin]     = useState(false);
  const [zResetPin, setZResetPin]         = useState("");
  const [showZReset, setShowZReset]       = useState(false);
  const [addForm, setAddForm]         = useState({ name: "", category: "", price: "", isSeasonal: false, quantity: "0", minQuantity: "0" });
  const [editSeasonal, setEditSeasonal] = useState(false);
  const [xReport, setXReport]           = useState<string | null>(null);
  const [zReport, setZReport]           = useState<string | null>(null);
  const [menuFilter, setMenuFilter]         = useState<"all" | "on" | "off">("all");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [showAddEmployee, setShowAddEmployee]   = useState(false);
  const [editEmployee, setEditEmployee]         = useState<Employee | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [editCustomer, setEditCustomer]         = useState<CustomerRow | null>(null);

  // Close modals after add/edit; update report text when returned
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      if ("report" in (fetcher.data as object)) {
        const d = fetcher.data as { ok: boolean; report: string };
        // Decide which panel to update based on report content
        if (d.report.startsWith("X REPORT")) setXReport(d.report);
        else if (d.report.startsWith("Z-report reset") || d.report.startsWith("ERROR")) { setZReport(d.report); setShowZReset(false); setZResetPin(""); }
        else setZReport(d.report);
      } else {
        setShowAdd(false);
        setEditItem(null);
        setAddForm({ name: "", category: "", price: "", isSeasonal: false, quantity: "0", minQuantity: "0" });
        setShowAddEmployee(false);
        setEditEmployee(null);
        setSelectedEmployee(null);
        setSetPinFor(null);
        setPinInputVal("");
        setPinSetError(null);
        setShowPinText(false);
        setShowEditPin(false);
      }
    }
  }, [fetcher.state, fetcher.data]);

  const openEdit = () => {
    const item = inventory.find((i) => i.id === selected);
    if (!item) return;
    setEditItem(item);
    setEditSeasonal(item.isSeasonal);
  };

  const confirmDelete = (title: string, message: string, onConfirm: () => void) =>
    setDeleteConfirm({ title, message, onConfirm });

  const busy = fetcher.state !== "idle";

  return (
    <div className="h-screen flex flex-col app-shell">
      {/* Header */}
      <header className="app-header px-6 py-4 shrink-0">
        <div className="topbar-row">
          <div className="topbar-brand">
            <span className="brand-link">Boba House</span>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Manager Console</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden page-section w-full px-4 py-5 gap-4">
        {/* Sidebar */}
        <nav className="w-48 bg-white/85 backdrop-blur border-r border-slate-200 p-4 flex flex-col gap-1 shrink-0" aria-label="Manager sections">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2 px-2">Sections</p>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              aria-pressed={activeTab === tab}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500
                ${activeTab === tab ? "bg-indigo-600 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex-1 section-card p-6 overflow-y-auto">

          {activeTab === "Inventory" && (
            <section aria-label="Inventory management">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">{translatedUI.inventory}</h2>
                <button
                  onClick={() => setShowAdd(true)}
                  className="primary-btn px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                >
                  + Add Item
                </button>
              </div>

              <div className="section-card overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Category</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Price</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Qty</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Min Qty</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Seasonal</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">On Menu</th>
                      <th className="px-4 py-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventory.map((item) => (
                      <tr
                        key={item.id}
                        tabIndex={0}
                        aria-selected={selected === item.id}
                        className={`transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600
                          ${selected === item.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3 text-slate-900 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.category}</td>
                        <td className="px-4 py-3 text-slate-800">${Number(item.price).toFixed(2)}</td>
                        <td className={`px-4 py-3 font-medium ${item.quantity < item.minQuantity ? "text-red-600" : "text-slate-800"}`}>
                          {item.quantity}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{item.minQuantity}</td>
                        <td
                          className="px-4 py-3"
                          onClick={(e) => { e.stopPropagation(); fetcher.submit({ intent: "toggle-seasonal", id: item.id }, { method: "post" }); }}
                        >
                          <span className={`cursor-pointer inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${item.isSeasonal ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {item.isSeasonal ? "Yes" : "—"}
                          </span>
                        </td>
                        <td
                          className="px-4 py-3"
                          onClick={(e) => { e.stopPropagation(); fetcher.submit({ intent: "toggle-menu", id: item.id }, { method: "post" }); }}
                        >
                          <span className={`cursor-pointer inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${item.onMenu ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {item.onMenu ? "On" : "Off"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelected(item.id); setEditItem(item); setEditSeasonal(item.isSeasonal); }}
                            aria-label={`Edit ${item.name}`}
                            className="text-slate-400 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded p-0.5"
                          >
                            ✎
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "Menu" && (
            <section aria-label="Menu items">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">Menu</h2>
                <div className="flex gap-2">
                  {([
                    ["all", "All"],
                    ["on", "On Menu"],
                    ["off", "Off Menu"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMenuFilter(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        menuFilter === key
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="section-card px-4 py-3">
                  <p className="text-xs text-slate-500">On menu</p>
                  <p className="text-lg font-bold text-green-700">{inventory.filter((i) => i.onMenu).length}</p>
                </div>
                <div className="section-card px-4 py-3">
                  <p className="text-xs text-slate-500">Off menu</p>
                  <p className="text-lg font-bold text-slate-700">{inventory.filter((i) => !i.onMenu).length}</p>
                </div>
              </div>

              <div className="section-card overflow-hidden">
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
                    {inventory
                      .filter((item) => {
                        if (menuFilter === "on") return item.onMenu;
                        if (menuFilter === "off") return !item.onMenu;
                        return true;
                      })
                      .map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-900 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.category}</td>
                        <td className="px-4 py-3 text-slate-800">${Number(item.price).toFixed(2)}</td>
                        <td className="px-4 py-3"
                          onClick={(e) => { e.stopPropagation(); fetcher.submit({ intent: "toggle-seasonal", id: item.id }, { method: "post" }); }}>
                          <span className={`cursor-pointer inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${item.isSeasonal ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {item.isSeasonal ? "Yes" : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => fetcher.submit({ intent: "toggle-menu", id: item.id }, { method: "post" })}
                            disabled={busy}
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              item.onMenu ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                            title={!item.onMenu && item.quantity < item.minQuantity ? "Cannot enable while stock is below minimum" : "Toggle menu visibility"}
                          >
                            {item.onMenu ? "On" : "Off"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Menu tab is for publish/unpublish control only. Use Inventory tab for stock management and item edits.
              </p>
            </section>
          )}

          {activeTab === "Employees" && (
            <section aria-label="Employee management">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">Employees</h2>
                <button
                  onClick={() => setShowAddEmployee(true)}
                  className="primary-btn px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                >
                  + Add Employee
                </button>
              </div>

              <div className="section-card overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Start Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">PIN</th>
                      <th className="px-4 py-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((emp) => (
                      <tr
                        key={emp.id}
                        onClick={() => setSelectedEmployee(selectedEmployee === emp.id ? null : emp.id)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setSelectedEmployee(selectedEmployee === emp.id ? null : emp.id)}
                        aria-selected={selectedEmployee === emp.id}
                        className={`cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600
                          ${selectedEmployee === emp.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3 text-slate-900 font-medium">{emp.name}</td>
                        <td className="px-4 py-3 text-slate-700">{emp.start_date.slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSetPinFor(emp); setPinInputVal(emp.pin); setPinSetError(null); }}
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${emp.hasPin ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                          >
                            {emp.hasPin ? "Set ✓" : "No PIN"}
                          </button>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedEmployee(emp.id); setEditEmployee(emp); }}
                            aria-label={`Edit ${emp.name}`}
                            className="text-slate-400 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded p-0.5"
                          >
                            ✎
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "Customers" && (
            <section aria-label="Loyalty customers">
              <h2 className="text-lg font-bold text-slate-900 mb-1">Loyalty Members</h2>
              <p className="text-sm text-slate-500 mb-4">Customers who have provided a phone number. Sorted by points balance.</p>
              {customers.length === 0 ? (
                <p className="text-sm text-slate-400">No loyalty members yet.</p>
              ) : (
                <div className="section-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Phone</th>
                        <th className="px-4 py-3 text-right">Points</th>
                        <th className="px-4 py-3 text-right">Orders</th>
                        <th className="px-4 py-3 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customers.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCustomer(selectedCustomer === c.id ? null : c.id)}
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && setSelectedCustomer(selectedCustomer === c.id ? null : c.id)}
                          aria-selected={selectedCustomer === c.id}
                          className={`cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600
                            ${selectedCustomer === c.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                        >
                          <td className="px-4 py-3 font-medium text-slate-800">{c.name ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{c.phone}</td>
                          <td className="px-4 py-3 text-right font-semibold text-indigo-600">{c.points.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{c.orderCount}</td>
                          <td className="px-2 py-3 text-center">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSelectedCustomer(c.id); setEditCustomer(c); }}
                              aria-label={`Edit ${c.name}`}
                              className="text-slate-400 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded p-0.5"
                            >
                              ✎
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === "Reports" && (
            <section aria-label="Reports">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Reports</h2>
              <div className="grid grid-cols-2 gap-6">

                {/* X Report */}
                <div className="section-card p-5 flex flex-col gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">X Report</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Hourly sales totals for today. Non-destructive — safe to run any time.</p>
                  </div>
                  <button
                    onClick={() => fetcher.submit({ intent: "x-report" }, { method: "post" })}
                    disabled={busy}
                    className="primary-btn self-start px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busy ? "Generating…" : "Generate X Report"}
                  </button>
                  {xReport && (
                    <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap overflow-x-auto">
                      {xReport}
                    </pre>
                  )}
                </div>

                {/* Z Report */}
                <div className="section-card p-5 flex flex-col gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Z Report</h3>
                    <p className="text-xs text-slate-500 mt-0.5">End-of-day close-out. Saves the report and resets today's X-report counters. Run once per day at close.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fetcher.submit({ intent: "z-report-view" }, { method: "post" })}
                      disabled={busy}
                      className="secondary-btn px-4 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      View today's Z Report
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm("Run Z Report for today?\n\nThis resets the X-report counters and should only be done once per business day at close.")) return;
                        fetcher.submit({ intent: "z-report-generate" }, { method: "post" });
                      }}
                      disabled={busy}
                      className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Run Z Report (close of day)
                    </button>
                    <button
                      onClick={() => setShowZReset(true)}
                      disabled={busy}
                      className="secondary-btn px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Undo Z Report
                    </button>
                  </div>
                  {zReport && (
                    <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap overflow-x-auto">
                      {zReport}
                    </pre>
                  )}
                </div>

              </div>
            </section>
          )}

        </main>
      </div>

      {/* Status bar */}
      <footer className="soft-footer px-5 py-1.5 text-xs">
        Manager — menu, inventory, employees, reports
      </footer>

      {/* Unified delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true">
          <div className="surface-card w-full max-w-sm p-6 text-center space-y-4">
            <p className="text-lg font-bold text-slate-900">{deleteConfirm.title}</p>
            <p className="text-sm text-slate-600">{deleteConfirm.message}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirm(null)} className="secondary-btn px-5 py-2 text-sm focus:outline-none">Cancel</button>
              <button
                onClick={() => { deleteConfirm.onConfirm(); setDeleteConfirm(null); }}
                className="danger-btn px-5 py-2 text-sm focus:outline-none"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set PIN modal */}
      {setPinFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="surface-card w-full max-w-sm p-6 space-y-4">
            <p className="text-base font-bold text-slate-900">Set PIN — {setPinFor.name}</p>
            <p className="text-xs text-slate-500">Enter a 4–8 digit PIN used for cashier login. Hover the eye icon to reveal.</p>
            <div className="relative">
              <input
                type={showPinText ? "text" : "password"}
                inputMode="numeric"
                maxLength={8}
                placeholder="Enter PIN (digits only)"
                value={pinInputVal}
                onChange={e => { setPinInputVal(e.target.value); setPinSetError(null); }}
                className="field-input text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPinText(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                aria-label={showPinText ? "Hide PIN" : "Show PIN"}
                tabIndex={-1}
              >
                <EyeIcon visible={showPinText} />
              </button>
            </div>
            {pinSetError && <p className="text-xs text-red-600">{pinSetError}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setSetPinFor(null); setPinInputVal(""); setPinSetError(null); }} className="secondary-btn flex-1 py-2 text-sm focus:outline-none">Cancel</button>
              <button
                onClick={() => {
                  if (!/^\d{4,8}$/.test(pinInputVal)) { setPinSetError("PIN must be 4–8 digits."); return; }
                  fetcher.submit({ intent: "set-pin", id: setPinFor.id, pin: pinInputVal }, { method: "post" });
                }}
                disabled={busy}
                className="primary-btn flex-1 py-2 text-sm focus:outline-none disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save PIN"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Z-report reset modal */}
      {showZReset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="surface-card w-full max-w-sm p-6 space-y-4">
            <p className="text-base font-bold text-slate-900">Undo Z Report</p>
            <p className="text-xs text-slate-500">This deletes today's Z-report and rebuilds the sales activity from order history, so you can run the X/Z reports again. Requires manager PIN.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="Manager PIN"
              value={zResetPin}
              onChange={e => setZResetPin(e.target.value)}
              className="field-input text-sm"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowZReset(false); setZResetPin(""); }} className="secondary-btn flex-1 py-2 text-sm focus:outline-none">Cancel</button>
              <button
                onClick={() => {
                  if (!zResetPin.trim()) return;
                  fetcher.submit({ intent: "z-report-reset", pin: zResetPin }, { method: "post" });
                }}
                disabled={busy || !zResetPin.trim()}
                className="primary-btn flex-1 py-2 text-sm focus:outline-none disabled:opacity-60"
              >
                {busy ? "Resetting…" : "Reset Z Report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}
        >
          <div className="surface-card w-full max-w-md p-6">
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Current Qty</label>
                  <input name="quantity" type="number" min="0" value={addForm.quantity} onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })} required className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Min Qty</label>
                  <input name="minQuantity" type="number" min="0" value={addForm.minQuantity} onChange={(e) => setAddForm({ ...addForm, minQuantity: e.target.value })} required className={inputCls} />
                  <p className="text-xs text-slate-400 mt-1">Item auto-removed from menu when qty falls below this</p>
                </div>
              </div>
              <SeasonalToggle value={addForm.isSeasonal} onChange={(v) => setAddForm({ ...addForm, isSeasonal: v })} />
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="secondary-btn flex-1 py-2.5 focus:outline-none transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="primary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
                  {busy ? "Adding…" : "Add Item"}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {showAddEmployee && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddEmployee(false); }}
        >
          <div className="surface-card w-full max-w-sm p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-5">Add Employee</h2>
            <fetcher.Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="add-employee" />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input name="name" required className={inputCls} placeholder="Full name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input name="start_date" type="date" required className={inputCls} defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setShowAddEmployee(false)} className="secondary-btn flex-1 py-2.5 focus:outline-none transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="primary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
                  {busy ? "Adding…" : "Add Employee"}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {editCustomer && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setEditCustomer(null); }}
        >
          <div className="surface-card w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-slate-900">Edit Customer</h2>
              <button type="button" onClick={() => confirmDelete("Delete customer?", "This permanently removes the customer. If they have order history the deletion will be blocked.", () => { fetcher.submit({ intent: "delete-customer", id: editCustomer.id }, { method: "post" }); setEditCustomer(null); })} className="danger-btn px-3 py-1 text-xs focus:outline-none">Delete</button>
            </div>
            <fetcher.Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="edit-customer" />
              <input type="hidden" name="id" value={editCustomer.id} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input name="name" defaultValue={editCustomer.name ?? ""} required className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input name="phone" type="tel" defaultValue={editCustomer.phone} required className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Points</label>
                <input name="points" type="number" min="0" defaultValue={editCustomer.points} required className={inputCls} />
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setEditCustomer(null)} className="secondary-btn flex-1 py-2.5 focus:outline-none transition-colors">Cancel</button>
                <button type="submit" disabled={busy} className="primary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
                  {busy ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {editEmployee && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setEditEmployee(null); }}
        >
          <div className="surface-card w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-slate-900">Edit Employee</h2>
              <button type="button" onClick={() => confirmDelete("Delete employee?", "This permanently removes the employee record.", () => { fetcher.submit({ intent: "delete-employee", id: editEmployee.id }, { method: "post" }); setEditEmployee(null); })} className="danger-btn px-3 py-1 text-xs focus:outline-none">Delete</button>
            </div>
            <fetcher.Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="edit-employee" />
              <input type="hidden" name="id" value={editEmployee.id} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input name="name" defaultValue={editEmployee.name} required className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input name="start_date" type="date" defaultValue={editEmployee.start_date.slice(0, 10)} required className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">PIN <span className="text-slate-400 font-normal text-xs">(4–8 digits — leave blank to keep current)</span></label>
                <div className="relative">
                  <input
                    name="pin"
                    type={showEditPin ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={8}
                    defaultValue={editEmployee.pin}
                    placeholder={editEmployee.hasPin ? "Current PIN hidden" : "Set a PIN"}
                    className={`${inputCls} pr-10`}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowEditPin(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    aria-label={showEditPin ? "Hide PIN" : "Show PIN"}
                  >
                    <EyeIcon visible={showEditPin} />
                  </button>
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => { setEditEmployee(null); setShowEditPin(false); }} className="secondary-btn flex-1 py-2.5 focus:outline-none transition-colors">Cancel</button>
                <button type="submit" disabled={busy} className="primary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
                  {busy ? "Saving…" : "Save Changes"}
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
          <div className="surface-card w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-slate-900">Edit Item</h2>
              <button type="button" onClick={() => confirmDelete("Delete item?", `Permanently delete "${editItem.name}"? This removes it from the database entirely.`, () => { fetcher.submit({ intent: "delete", id: editItem.id }, { method: "post" }); setEditItem(null); })} className="danger-btn px-3 py-1 text-xs focus:outline-none">Delete</button>
            </div>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Current Qty</label>
                  <input name="quantity" type="number" min="0" defaultValue={editItem.quantity} required className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Min Qty</label>
                  <input name="minQuantity" type="number" min="0" defaultValue={editItem.minQuantity} required className={inputCls} />
                  <p className="text-xs text-slate-400 mt-1">Auto-removed from menu if qty &lt; min</p>
                </div>
              </div>
              <SeasonalToggle value={editSeasonal} onChange={setEditSeasonal} />
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setEditItem(null)} className="secondary-btn flex-1 py-2.5 focus:outline-none transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="primary-btn flex-1 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-colors disabled:opacity-60">
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
