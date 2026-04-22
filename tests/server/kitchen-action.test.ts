import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("~/db.server", () => ({ default: { query: mockQuery } }));
vi.mock("~/root", () => ({ TranslationContext: null }));

import { action, loader } from "~/routes/kitchen";

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("kitchen loader", () => {
  it("returns empty orders when DB returns no rows", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await loader();
    expect(result).toEqual({ orders: [] });
  });

  it("returns pending orders from DB", async () => {
    const fakeOrders = [
      { id: "order-1", date: "10:30 AM", items: [{ name: "Green Tea", qty: 2 }] },
      { id: "order-2", date: "11:00 AM", items: [{ name: "Boba", qty: 1 }] },
    ];
    mockQuery.mockResolvedValue({ rows: fakeOrders });
    const result = await loader();
    expect(result.orders).toHaveLength(2);
    expect(result.orders[0].id).toBe("order-1");
    expect(result.orders[1].date).toBe("11:00 AM");
  });

  it("passes the order rows through unchanged", async () => {
    const fakeOrder = { id: "order-abc", date: "02:15 PM", items: [{ name: "Milk Tea", qty: 3 }] };
    mockQuery.mockResolvedValue({ rows: [fakeOrder] });
    const { orders } = await loader();
    expect(orders[0]).toEqual(fakeOrder);
  });
});

describe("kitchen action — mark order complete", () => {
  it("calls pool.query with the provided order id", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 2 });
    const body = new URLSearchParams({ id: "order-uuid-123" });
    const request = new Request("http://localhost/kitchen", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await action({ request, params: {}, context: {} } as any);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("order-uuid-123");
  });

  it("returns ok:true with rowCount on success", async () => {
    mockQuery.mockResolvedValue({ rows: [{ item_id: "i1" }, { item_id: "i2" }], rowCount: 2 });
    const body = new URLSearchParams({ id: "order-uuid-123" });
    const request = new Request("http://localhost/kitchen", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const result = await action({ request, params: {}, context: {} } as any);
    expect(result).toEqual({ ok: true, updatedItems: 2 });
  });

  it("returns updatedItems:0 when order is not in pending state", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const body = new URLSearchParams({ id: "non-pending-order" });
    const request = new Request("http://localhost/kitchen", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const result = await action({ request, params: {}, context: {} } as any);
    expect(result).toEqual({ ok: true, updatedItems: 0 });
  });
});
