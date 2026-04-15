import { SignUp } from "@clerk/react-router";
import { Link } from "react-router";
import type { Route } from "./+types/sign-up";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign Up — Boba House" }];
}

export default function SignUpPage() {
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
          <span className="topbar-chip">Create Account</span>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="surface-card p-2">
          <SignUp fallbackRedirectUrl="/portal" signInUrl="/sign-in" />
        </div>
      </main>
    </div>
  );
}
