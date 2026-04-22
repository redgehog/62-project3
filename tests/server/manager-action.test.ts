import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockQuery, mockRequireSignedIn } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  mockRequireSignedIn: vi.fn().mockResolvedValue({ userId: "test-user-id" }),
}));

vi.mock("~/db.server", () => ({ default: { query: mockQuery } }));
vi.mock("~/clerk-auth.server", () => ({ requireSignedIn: mockRequireSignedIn }));
vi.mock("~/root", () => ({ TranslationContext: null }));

import { action, loader } from "~/routes/manager";

function makeRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/manager", {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

const fakeArgs = (request: Request) =>
  ({ request, params: {}, context: {} }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockRequireSignedIn.mockResolvedValue({ userId: "test-user-id" });
});

describe("manager loader", () => {
  it("calls requireSignedIn and returns inventory + employees", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "item-1", name: "Boba Tea" }] })
      .mockResolvedValueOnce({ rows: [{ id: "emp-1", name: "Alice" }] });
    const result = await loader({ request: new Request("http://localhost/manager"), params: {}, context: {} } as any);
    expect(mockRequireSignedIn).toHaveBeenCalled();
    expect(result.inventory).toHaveLength(1);
    expect(result.employees).toHaveLength(1);
  });

  it("redirects (throws) when unauthenticated", async () => {
    mockRequireSignedIn.mockRejectedValueOnce(
      new Response(null, { status: 302, headers: { Location: "/sign-in" } })
    );
    await expect(
      loader({ request: new Request("http://localhost/manager"), params: {}, context: {} } as any)
    ).rejects.toBeInstanceOf(Response);
  });
});

describe("manager action — intent: delete", () => {
  it("marks item inactive and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({ intent: "delete", id: "item-uuid" })));
    expect(result).toEqual({ ok: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("is_active = false");
    expect(params).toContain("item-uuid");
  });
});

describe("manager action — intent: add", () => {
  it("inserts item and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({
      intent: "add", name: "New Tea", category: "Milk Tea",
      price: "5.00", isSeasonal: "false", quantity: "10", minQuantity: "5",
    })));
    expect(result).toEqual({ ok: true });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO");
  });

  it("sets is_active=true when quantity >= minQuantity", async () => {
    await action(fakeArgs(makeRequest({
      intent: "add", name: "Tea", category: "Brewed Tea",
      price: "4.00", isSeasonal: "false", quantity: "10", minQuantity: "5",
    })));
    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBe(true); // is_active = quantity >= minQuantity
  });

  it("sets is_active=false when quantity < minQuantity", async () => {
    await action(fakeArgs(makeRequest({
      intent: "add", name: "Tea", category: "Brewed Tea",
      price: "4.00", isSeasonal: "false", quantity: "3", minQuantity: "5",
    })));
    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBe(false); // is_active = quantity >= minQuantity = false
  });
});

describe("manager action — intent: edit", () => {
  it("updates item and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({
      intent: "edit", id: "item-uuid", name: "Updated Tea",
      category: "Fruit Tea", price: "5.50", isSeasonal: "false",
      quantity: "8", minQuantity: "3",
    })));
    expect(result).toEqual({ ok: true });
  });

  it("SQL contains CASE WHEN to auto-deactivate on low stock", async () => {
    await action(fakeArgs(makeRequest({
      intent: "edit", id: "item-uuid", name: "Tea",
      category: "Brewed Tea", price: "4.00", isSeasonal: "false",
      quantity: "2", minQuantity: "5",
    })));
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("CASE WHEN");
    expect(sql).toContain("is_active");
  });
});

describe("manager action — intent: toggle-menu", () => {
  it("calls UPDATE with CASE WHEN toggle and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({ intent: "toggle-menu", id: "item-uuid" })));
    expect(result).toEqual({ ok: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("CASE");
    expect(sql).toContain("is_active");
    expect(params[0]).toBe("item-uuid");
  });
});

describe("manager action — intent: toggle-seasonal", () => {
  it("toggles seasonal flag and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({ intent: "toggle-seasonal", id: "item-uuid" })));
    expect(result).toEqual({ ok: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("is_seasonal = NOT is_seasonal");
    expect(params[0]).toBe("item-uuid");
  });
});

describe("manager action — intent: add-employee", () => {
  it("inserts employee and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({
      intent: "add-employee", name: "Bob", start_date: "2024-01-01",
    })));
    expect(result).toEqual({ ok: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("Employee");
    expect(params).toContain("Bob");
  });
});

describe("manager action — intent: edit-employee", () => {
  it("updates employee and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({
      intent: "edit-employee", id: "emp-uuid", name: "Alice Updated", start_date: "2023-06-01",
    })));
    expect(result).toEqual({ ok: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE");
    expect(sql).toContain("Employee");
    expect(params).toContain("emp-uuid");
  });
});

describe("manager action — intent: delete-employee", () => {
  it("deletes employee and returns ok:true", async () => {
    const result = await action(fakeArgs(makeRequest({ intent: "delete-employee", id: "emp-uuid" })));
    expect(result).toEqual({ ok: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE");
    expect(sql).toContain("Employee");
    expect(params).toContain("emp-uuid");
  });
});

describe("manager action — intent: x-report", () => {
  it("returns ok:true with a report string starting with 'X REPORT'", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // hourly rows (no sales)
      .mockResolvedValueOnce({             // totals row
        rows: [{ sales_count: 5, item_count: 12, sales_total: 50.0, tax_total: 4.13, cash_total: 30.0, non_cash_total: 20.0 }],
      });
    const result = await action(fakeArgs(makeRequest({ intent: "x-report" }))) as any;
    expect(result.ok).toBe(true);
    expect(result.report).toMatch(/^X REPORT/);
    expect(result.report).toContain(`Business date: ${today}`);
  });

  it("includes '(no sales recorded today)' when no hourly data", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ sales_count: 0, item_count: 0, sales_total: 0, tax_total: 0, cash_total: 0, non_cash_total: 0 }],
      });
    const result = await action(fakeArgs(makeRequest({ intent: "x-report" }))) as any;
    expect(result.report).toContain("(no sales recorded today)");
  });
});

describe("manager action — intent: z-report-view", () => {
  it("returns existing report text when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ report_text: "Z REPORT\nSome data" }] });
    const result = await action(fakeArgs(makeRequest({ intent: "z-report-view" }))) as any;
    expect(result.ok).toBe(true);
    expect(result.report).toBe("Z REPORT\nSome data");
  });

  it("returns placeholder when no report exists yet", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await action(fakeArgs(makeRequest({ intent: "z-report-view" }))) as any;
    expect(result.report).toContain("No Z-report generated yet today");
  });
});

describe("manager action — intent: z-report-generate", () => {
  it("returns already-generated message when report exists for today", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ report_text: "Z REPORT\nExisting" }] });
    const result = await action(fakeArgs(makeRequest({ intent: "z-report-generate" }))) as any;
    expect(result.ok).toBe(true);
    expect(result.report).toContain("Already generated today");
  });

  it("generates new report, inserts it, and clears sales_activity", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no existing z-report
      .mockResolvedValueOnce({             // totals
        rows: [{ sales_count: 10, item_count: 25, sales_total: 100.0, tax_total: 8.25, cash_total: 60.0, non_cash_total: 40.0 }],
      })
      .mockResolvedValueOnce({ rows: [] }) // INSERT z-report
      .mockResolvedValueOnce({ rows: [] }); // DELETE sales_activity

    const result = await action(fakeArgs(makeRequest({ intent: "z-report-generate" }))) as any;
    expect(result.ok).toBe(true);
    expect(result.report).toMatch(/^Z REPORT/);
    expect(result.report).toContain("Gross sales:");
    expect(result.report).toContain("X/Z counters reset");
    // 4 DB calls: check-existing, totals, INSERT z-report, DELETE sales_activity
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it("calls DELETE on pos_sales_activity when generating new report", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sales_count: 0, item_count: 0, sales_total: 0, tax_total: 0, cash_total: 0, non_cash_total: 0 }] })
      .mockResolvedValue({ rows: [] });

    await action(fakeArgs(makeRequest({ intent: "z-report-generate" })));
    const sqls = mockQuery.mock.calls.map(([sql]: [string]) => sql);
    expect(sqls.some((s: string) => s.includes("DELETE") && s.includes("pos_sales_activity"))).toBe(true);
  });
});

describe("manager action — unknown intent", () => {
  it("returns ok:false", async () => {
    const result = await action(fakeArgs(makeRequest({ intent: "unknown-intent" })));
    expect(result).toEqual({ ok: false });
  });
});
