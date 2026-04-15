import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/cashier-login";
import pool from "../db.server";
import {
  commitCashierSession,
  destroyCashierSession,
  getCashierSession,
} from "../cashier-access.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Cashier PIN — Boba House" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const session = await getCashierSession(request);

  if (url.searchParams.get("fresh") === "1") {
    return redirect("/cashier-login", {
      headers: { "Set-Cookie": await destroyCashierSession(session) },
    });
  }

  if (url.searchParams.get("logout") === "1") {
    return redirect("/portal", {
      headers: { "Set-Cookie": await destroyCashierSession(session) },
    });
  }

  const allowed = session.get("allow:cashier") === true;
  if (allowed) return redirect("/cashier");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const pin = String(formData.get("pin") || "").trim();
  if (!/^\d{4,8}$/.test(pin)) {
    return { ok: false, error: "PIN must be 4 to 8 digits." };
  }

  const byEmployeePin = await pool.query(
    `SELECT employee_id::text AS id, name
     FROM "Employee"
     WHERE pin = $1
     LIMIT 1`,
    [pin]
  ).catch(() => ({ rows: [] as Array<{ id: string; name: string }> }));

  const envPin = process.env.CASHIER_PIN;
  const pinMatches =
    byEmployeePin.rows.length > 0 || (envPin ? pin === envPin : false);

  if (!pinMatches) {
    return { ok: false, error: "Incorrect cashier PIN." };
  }

  const session = await getCashierSession(request);
  session.set("allow:cashier", true);
  if (byEmployeePin.rows[0]?.id) {
    session.set("cashier:employeeId", byEmployeePin.rows[0].id);
  }

  return redirect("/cashier", {
    headers: { "Set-Cookie": await commitCashierSession(session) },
  });
}

export default function CashierLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

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
          <span className="topbar-chip">Cashier Access</span>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="surface-card p-10 w-full max-w-md">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Cashier PIN</h2>
          <p className="text-sm text-slate-500 mb-8">
            Enter your cashier PIN to start checkout.
          </p>
          <Form method="post" className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pin" className="text-sm font-medium text-slate-700">
                PIN
              </label>
              <input
                id="pin"
                name="pin"
                type="password"
                required
                inputMode="numeric"
                pattern="\d{4,8}"
                className="field-input placeholder-slate-400"
                placeholder="Enter PIN"
                autoComplete="off"
              />
            </div>
            {actionData && !actionData.ok && (
              <p className="text-sm text-red-600">{actionData.error}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="primary-btn mt-2 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 py-2.5"
            >
              {submitting ? "Verifying..." : "Continue to Cashier"}
            </button>
          </Form>
        </div>
      </main>
    </div>
  );
}
