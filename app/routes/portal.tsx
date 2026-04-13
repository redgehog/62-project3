import { useNavigate } from "react-router";
import type { Route } from "./+types/portal";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Portal — Boba House" }];
}

const PORTAL_LINKS = [
  { label: "Manager",    path: "/login?redirect=/manager" },
  { label: "Cashier",    path: "/login?redirect=/cashier" },
  { label: "Customer",   path: "/customer" },
  { label: "Menu Board", path: "/menu-board" },
  { label: "Kitchen",    path: "/login?redirect=/kitchen" },
];

export default function Portal() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4">
        <h1 className="text-white text-xl font-bold tracking-wide">Boba House</h1>
      </header>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-slate-900 mb-8">Portal</h2>
          <div className="flex flex-col gap-3">
            {PORTAL_LINKS.map(({ label, path }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 text-white font-semibold rounded-lg py-3 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
