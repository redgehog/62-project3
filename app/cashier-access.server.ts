import { createCookieSessionStorage, redirect } from "react-router";

const sessionSecret =
  process.env.SESSION_SECRET || "dev-session-secret-change-me";

const cashierStorage = createCookieSessionStorage({
  cookie: {
    name: "__boba_cashier_access",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
    secrets: [sessionSecret],
  },
});

export async function getCashierSession(request: Request) {
  return cashierStorage.getSession(request.headers.get("Cookie"));
}

export async function commitCashierSession(
  session: Awaited<ReturnType<typeof getCashierSession>>
) {
  return cashierStorage.commitSession(session);
}

export async function destroyCashierSession(
  session: Awaited<ReturnType<typeof getCashierSession>>
) {
  return cashierStorage.destroySession(session);
}

export async function requireCashierAccess(request: Request) {
  const session = await getCashierSession(request);
  const allowed = session.get("allow:cashier") === true;
  if (!allowed) {
    throw redirect("/cashier-login");
  }
  return session;
}
