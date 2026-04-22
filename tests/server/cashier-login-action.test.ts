import { vi, describe, it, expect, beforeEach } from "vitest";

// Hoist mock factories so they're available when vi.mock runs
const { mockQuery, mockSession, mockGetSession, mockCommitSession, mockDestroySession } =
  vi.hoisted(() => {
    const mockSession = { get: vi.fn(), set: vi.fn() };
    return {
      mockQuery: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      mockSession,
      mockGetSession: vi.fn().mockResolvedValue(mockSession),
      mockCommitSession: vi.fn().mockResolvedValue("Set-Cookie: test"),
      mockDestroySession: vi.fn().mockResolvedValue("Set-Cookie: cleared"),
    };
  });

vi.mock("~/db.server", () => ({ default: { query: mockQuery } }));
vi.mock("~/cashier-access.server", () => ({
  getCashierSession: mockGetSession,
  commitCashierSession: mockCommitSession,
  destroyCashierSession: mockDestroySession,
}));

import { action, loader } from "~/routes/cashier-login";

function makeActionRequest(pin: string) {
  const body = new URLSearchParams({ pin });
  return new Request("http://localhost/cashier-login", {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

function makeLoaderRequest(params = "") {
  return new Request(`http://localhost/cashier-login${params}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockResolvedValue(mockSession);
  mockCommitSession.mockResolvedValue("Set-Cookie: test");
  mockDestroySession.mockResolvedValue("Set-Cookie: cleared");
  mockSession.get.mockImplementation((k: string) =>
    k === "allow:cashier" ? false : undefined
  );
  mockSession.set.mockReset();
  delete process.env.CASHIER_PIN;
});

describe("cashier-login action — PIN validation", () => {
  it("rejects a 3-digit PIN", async () => {
    const result = await action({ request: makeActionRequest("123"), params: {}, context: {} } as any);
    expect(result).toEqual({ ok: false, error: "PIN must be 4 to 8 digits." });
  });

  it("rejects an alphabetic PIN", async () => {
    const result = await action({ request: makeActionRequest("abcd"), params: {}, context: {} } as any);
    expect(result).toEqual({ ok: false, error: "PIN must be 4 to 8 digits." });
  });

  it("rejects a 9-digit PIN", async () => {
    const result = await action({ request: makeActionRequest("123456789"), params: {}, context: {} } as any);
    expect(result).toEqual({ ok: false, error: "PIN must be 4 to 8 digits." });
  });

  it("rejects an empty PIN", async () => {
    const result = await action({ request: makeActionRequest(""), params: {}, context: {} } as any);
    expect(result).toEqual({ ok: false, error: "PIN must be 4 to 8 digits." });
  });
});

describe("cashier-login action — PIN matching", () => {
  it("returns error when DB and env both miss", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await action({ request: makeActionRequest("1234"), params: {}, context: {} } as any);
    expect(result).toEqual({ ok: false, error: "Incorrect cashier PIN." });
  });

  it("redirects to /cashier when DB PIN matches", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "emp-uuid", name: "Alice" }] });
    const result = await action({ request: makeActionRequest("1234"), params: {}, context: {} } as any) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/cashier");
  });

  it("sets session.set('allow:cashier', true) on DB match", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "emp-uuid", name: "Alice" }] });
    await action({ request: makeActionRequest("1234"), params: {}, context: {} } as any);
    expect(mockSession.set).toHaveBeenCalledWith("allow:cashier", true);
  });

  it("sets cashier:employeeId in session when DB row found", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "emp-uuid", name: "Alice" }] });
    await action({ request: makeActionRequest("1234"), params: {}, context: {} } as any);
    expect(mockSession.set).toHaveBeenCalledWith("cashier:employeeId", "emp-uuid");
  });

  it("redirects when env CASHIER_PIN matches and DB misses", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    process.env.CASHIER_PIN = "5678";
    const result = await action({ request: makeActionRequest("5678"), params: {}, context: {} } as any) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/cashier");
  });

  it("rejects when env CASHIER_PIN doesn't match and DB misses", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    process.env.CASHIER_PIN = "5678";
    const result = await action({ request: makeActionRequest("9999"), params: {}, context: {} } as any);
    expect(result).toEqual({ ok: false, error: "Incorrect cashier PIN." });
  });

  it("does not set employeeId when only env PIN matches", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    process.env.CASHIER_PIN = "1234";
    await action({ request: makeActionRequest("1234"), params: {}, context: {} } as any);
    expect(mockSession.set).not.toHaveBeenCalledWith(
      "cashier:employeeId",
      expect.anything()
    );
  });
});

describe("cashier-login loader", () => {
  it("redirects to /cashier when session is already valid", async () => {
    mockSession.get.mockImplementation((k: string) =>
      k === "allow:cashier" ? true : undefined
    );
    const result = await loader({ request: makeLoaderRequest(), params: {}, context: {} } as any) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/cashier");
  });

  it("returns null when session is not valid (shows login form)", async () => {
    mockSession.get.mockReturnValue(undefined);
    const result = await loader({ request: makeLoaderRequest(), params: {}, context: {} } as any);
    expect(result).toBeNull();
  });

  it("?fresh=1 clears session and redirects to /cashier-login", async () => {
    const result = await loader({ request: makeLoaderRequest("?fresh=1"), params: {}, context: {} } as any) as Response;
    expect(mockDestroySession).toHaveBeenCalled();
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/cashier-login");
  });

  it("?logout=1 clears session and redirects to /portal", async () => {
    const result = await loader({ request: makeLoaderRequest("?logout=1"), params: {}, context: {} } as any) as Response;
    expect(mockDestroySession).toHaveBeenCalled();
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/portal");
  });
});
