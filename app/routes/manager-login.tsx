import { useClerk } from "@clerk/react-router";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/manager-login";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Manager Access — Boba House" }];
}

export default function ManagerLogin() {
  void useClerk();
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/sign-in?redirect_url=%2Fmanager&fresh=1", { replace: true });
  }, [navigate]);

  return (
    <div className="app-shell">
      <header className="app-header px-6 py-4">
        <div className="topbar-row">
          <div className="topbar-brand">
            <Link to="/portal" className="brand-link hover:text-slate-300">
              Boba House
            </Link>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Manager Access</span>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="surface-card p-8 text-sm text-slate-600">
          Preparing manager sign-in...
        </div>
      </main>
    </div>
  );
}
