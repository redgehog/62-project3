import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/manager";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Manager" }];
}

export async function loader() {
  const result = await pool.query("SELECT current_database() AS db, now() AS time");
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
  { id: 1, name: "Passion Fruit",        category: "Milk Tea",   qty: 145, min: 10, onMenu: true },
  { id: 2, name: "Matcha Latte",         category: "Specialty",  qty: 16,  min: 10, onMenu: true },
  { id: 3, name: "Peach Milk Tea",       category: "Milk Tea",   qty: 20,  min: 10, onMenu: true },
  { id: 4, name: "Wintermelon Milk Tea", category: "Milk Tea",   qty: 20,  min: 10, onMenu: true },
  { id: 5, name: "Honeydew Milk Tea",    category: "Milk Tea",   qty: 16,  min: 10, onMenu: true },
  { id: 6, name: "Mango Milk Tea",       category: "Milk Tea",   qty: 16,  min: 10, onMenu: true },
  { id: 7, name: "Classic Milk Tea",     category: "Milk Tea",   qty: 19,  min: 10, onMenu: true },
  { id: 8, name: "Grape Chia",           category: "Milk Tea",   qty: 199, min: 10, onMenu: true },
  { id: 9, name: "Jasmine Green Tea",    category: "Brewed Tea", qty: 3,   min: 10, onMenu: true },
];

const INITIAL_EMPLOYEES: Employee[] = [
  { id: 1, name: "Alice Johnson", role: "Cashier", hours: 32 },
  { id: 2, name: "Bob Smith",     role: "Kitchen", hours: 28 },
  { id: 3, name: "Carol Lee",     role: "Manager", hours: 40 },
];

const TABS = ["Inventory", "Menu", "Employees"];

const th: React.CSSProperties = { padding: "8px 12px", border: "1px solid #ccc", textAlign: "left", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px 12px", border: "1px solid #ccc" };
const actionBtn: React.CSSProperties = { padding: "6px 14px", border: "1px solid #ccc", background: "#f0f0f0", cursor: "pointer", fontSize: "13px" };
const inputStyle: React.CSSProperties = { padding: "4px 8px", border: "1px solid #ccc", fontSize: "13px", width: "120px" };

export default function Manager() {
  const { dbCheck } = useLoaderData<typeof loader>();
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
    setInventory((prev) => [...prev, { id: nextId, name: newItem.name, category: newItem.category, qty: Number(newItem.qty) || 0, min: Number(newItem.min) || 0, onMenu: false }]);
    setNewItem({ name: "", category: "", qty: "", min: "" });
  };

  const toggleMenu = (id: number) => setInventory((prev) => prev.map((i) => i.id === id ? { ...i, onMenu: !i.onMenu } : i));

  return (
    <div style={{ fontFamily: "sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>

      {/* HEADER */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #ccc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "20px", margin: 0 }}>Boba Shop POS</h1>
        <div>
          <span style={{ marginRight: "12px", color: "#999", fontSize: "14px" }}>View:</span>
          <span style={{ marginRight: "8px", fontSize: "14px", cursor: "pointer", color: "#999" }}>Cashier</span>
          <button style={{ padding: "6px 16px", background: "#333", color: "#fff", border: "none", cursor: "pointer", fontSize: "14px" }}>Manager</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* SIDEBAR */}
        <div style={{ width: "180px", borderRight: "1px solid #ccc", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "8px" }}>Manager</div>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{ padding: "8px 12px", border: "1px solid #ccc", background: activeTab === tab ? "#dceeff" : "#fff", cursor: "pointer", textAlign: "left", fontSize: "14px", outline: activeTab === tab ? "2px solid #4a90d9" : "none" }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* MAIN CONTENT */}
        <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>

          {activeTab === "Inventory" && (
            <>
              <h2 style={{ marginBottom: "16px" }}>Inventory — View, Add &amp; Edit Items &amp; Quantities</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", marginBottom: "12px" }}>
                <thead>
                  <tr style={{ background: "#f0f0f0" }}>
                    <th style={th}>ID</th>
                    <th style={th}>Name</th>
                    <th style={th}>Category</th>
                    <th style={th}>Quantity</th>
                    <th style={th}>Minimum</th>
                    <th style={th}>On Menu</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => handleSelect(item.id)}
                      style={{ background: selected === item.id ? "#dceeff" : "#fff", cursor: "pointer" }}
                    >
                      <td style={td}>{item.id}</td>
                      <td style={td}>{item.name}</td>
                      <td style={td}>{item.category}</td>
                      <td style={td}>{item.qty}</td>
                      <td style={td}>{item.min}</td>
                      <td style={td}>{item.onMenu ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
                <button style={actionBtn}>Edit selected</button>
                <button onClick={handleDelete} style={{ ...actionBtn, color: "red", borderColor: "red" }}>Delete selected</button>
                <button onClick={() => selected !== null && toggleMenu(selected)} style={actionBtn}>Add to menu</button>
                <button onClick={() => selected !== null && toggleMenu(selected)} style={actionBtn}>Remove from menu</button>
              </div>
              <div>
                <strong style={{ fontSize: "14px" }}>Add new inventory item</strong>
                <div style={{ display: "flex", gap: "12px", marginTop: "10px", alignItems: "center", flexWrap: "wrap", fontSize: "14px" }}>
                  <label>Name: <input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="Name" style={inputStyle} /></label>
                  <label>Category: <input value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} placeholder="Category" style={inputStyle} /></label>
                  <label>Qty: <input value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} placeholder="Qty" style={{ ...inputStyle, width: "60px" }} /></label>
                  <label>Minimum: <input value={newItem.min} onChange={(e) => setNewItem({ ...newItem, min: e.target.value })} placeholder="Min" style={{ ...inputStyle, width: "60px" }} /></label>
                  <button onClick={handleAdd} style={{ padding: "6px 16px", border: "1px solid #ccc", background: "#f0f0f0", cursor: "pointer", fontSize: "14px" }}>Add</button>
                </div>
              </div>
            </>
          )}

          {activeTab === "Menu" && (
            <>
              <h2 style={{ marginBottom: "16px" }}>Menu</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ background: "#f0f0f0" }}>
                    <th style={th}>Name</th>
                    <th style={th}>Category</th>
                    <th style={th}>On Menu</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.filter((i) => i.onMenu).map((item) => (
                    <tr key={item.id}>
                      <td style={td}>{item.name}</td>
                      <td style={td}>{item.category}</td>
                      <td style={td}>✓</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {activeTab === "Employees" && (
            <>
              <h2 style={{ marginBottom: "16px" }}>Employees</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ background: "#f0f0f0" }}>
                    <th style={th}>ID</th>
                    <th style={th}>Name</th>
                    <th style={th}>Role</th>
                    <th style={th}>Hours This Week</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id}>
                      <td style={td}>{emp.id}</td>
                      <td style={td}>{emp.name}</td>
                      <td style={td}>{emp.role}</td>
                      <td style={td}>{emp.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

        </div>
      </div>

      {/* STATUS BAR */}
      <div style={{ padding: "6px 20px", borderTop: "1px solid #ccc", fontSize: "12px", color: "#777" }}>
        Manager — menu, inventory, employees &nbsp;|&nbsp; DB: {dbCheck?.db} @ {dbCheck?.time}
      </div>
    </div>
  );
}