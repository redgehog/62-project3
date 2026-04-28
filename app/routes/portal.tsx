import { useNavigate } from "react-router";
import type { Route } from "./+types/portal";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Portal — Boba House" }];
}

const PORTAL_LINKS = [
  { label: "Manager", path: "/manager-login", description: "Inventory, staffing, and reporting controls" },
  { label: "Cashier", path: "/cashier-login?fresh=1", description: "Fast checkout and order capture" },
  { label: "Customer", path: "/customer", description: "Self-service ordering experience" },
  { label: "Menu Board", path: "/menu-board", description: "Live menu display for storefront screens" },
  { label: "Kitchen", path: "/kitchen", description: "Order queue and preparation workflow" },
];

export default function Portal() {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header px-6 py-4">
        <div className="topbar-row">
          <div className="topbar-brand">
            <h1 className="brand-link">Boba House</h1>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Control Center</span>
        </div>
      </header>

      {/* Card */}
      <div className="flex-1 px-4 py-8">
        <div className="page-section">
          <div className="mb-6">
            <h2 className="section-title">Portal</h2>
            <p className="section-description">Choose a workspace to manage daily operations.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {PORTAL_LINKS.map(({ label, path, description }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="section-card p-5 text-left hover:border-indigo-300 hover:bg-indigo-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors cursor-pointer"
              >
                <p className="text-base font-semibold text-slate-900">{label}</p>
                <p className="text-sm text-slate-500 mt-1">{description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
