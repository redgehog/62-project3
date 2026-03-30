import { useNavigate } from "react-router";
import type { Route } from "./+types/portal";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Portal" }];
}

const PORTAL_LINKS = [
  { label: "Manager", path: "/manager" },
  { label: "Cashier", path: "/cashier" },
  { label: "Customer", path: "/customer" },
  { label: "Menu Board", path: "/menu-board" },
  { label: "Kitchen", path: "/kitchen" },
];

export default function Portal() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-8">Portal</h1>
        <div className="flex flex-col gap-4">
          {PORTAL_LINKS.map(({ label, path }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg py-3 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
