import { SignIn, useClerk } from "@clerk/react-router";
import { useEffect } from "react";
import { Link } from "react-router";
import { useSearchParams } from "react-router";
import type { Route } from "./+types/sign-in";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign In — Boba House" }];
}

export default function SignInPage() {
  const clerk = useClerk();
  const [searchParams] = useSearchParams();
  const shouldRefresh = searchParams.get("fresh") === "1";
  const redirectUrl = searchParams.get("redirect_url") || "/manager";
  const ready = !shouldRefresh;

  useEffect(() => {
    if (!shouldRefresh) return;

    let finished = false;
    const cleanSignInUrl = `/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`;

    // Safety fallback so auth screen never hangs.
    const timeout = window.setTimeout(() => {
      if (!finished) {
        finished = true;
        window.location.replace(cleanSignInUrl);
      }
    }, 1500);

    void clerk
      .signOut()
      .catch(() => undefined)
      .finally(() => {
        if (!finished) {
          finished = true;
          window.clearTimeout(timeout);
          window.location.replace(cleanSignInUrl);
        }
      });

    return () => {
      window.clearTimeout(timeout);
    };
  }, [clerk, redirectUrl, shouldRefresh]);

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
          <span className="topbar-chip">Secure Access</span>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        {ready ? (
          <div className="surface-card p-2">
            <SignIn fallbackRedirectUrl="/portal" signUpUrl="/sign-up" />
          </div>
        ) : (
          <div className="surface-card p-8 text-sm text-slate-600">
            Preparing manager sign-in...
          </div>
        )}
      </main>
    </div>
  );
}
