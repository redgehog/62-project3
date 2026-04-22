import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("~/db.server", () => ({ default: { query: mockQuery } }));

import { action, loader } from "~/routes/customer";

function makeOrderRequest(cart: unknown[]) {
  const body = new URLSearchParams({ cart: JSON.stringify(cart) });
  return new Request("http://localhost/customer", {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("customer loader", () => {
  it("returns empty categories and menuItems when DB returns no rows", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await loader();
    expect(result).toEqual({ categories: [], menuItems: {} });
  });

  it("groups non-seasonal items under their category", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "item-1", name: "Green Tea", category: "Brewed Tea", price: 4.5, isSeasonal: false, milk: "" }],
    });
    const result = await loader();
    expect(result.categories).toContain("Brewed Tea");
    expect(result.menuItems["Brewed Tea"]).toHaveLength(1);
    expect(result.menuItems["Seasonal"]).toBeUndefined();
  });

  it("adds seasonal items to both their category and Seasonal", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "item-2", name: "Pumpkin Spice", category: "Milk Tea", price: 5.0, isSeasonal: true, milk: "whole" }],
    });
    const result = await loader();
    expect(result.categories).toContain("Milk Tea");
    expect(result.categories).toContain("Seasonal");
    expect(result.menuItems["Milk Tea"]).toHaveLength(1);
    expect(result.menuItems["Seasonal"]).toHaveLength(1);
    expect(result.menuItems["Seasonal"][0].name).toBe("Pumpkin Spice");
  });
});

describe("customer action — validation", () => {
  it("returns ok:false for an empty cart", async () => {
    const result = await action({ request: makeOrderRequest([]), params: {}, context: {} } as any);
    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false when no employee row exists", async () => {
    // Promise.all for empRow + custRow both return empty
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await action({
      request: makeOrderRequest([{ id: "item-uuid", basePrice: 5, qty: 1 }]),
      params: {},
      context: {},
    } as any);
    expect(result).toEqual({ ok: false, error: "No employee or customer record found" });
  });

  it("returns ok:false when employee exists but no customer row", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ employee_id: "emp-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await action({
      request: makeOrderRequest([{ id: "item-uuid", basePrice: 5, qty: 1 }]),
      params: {},
      context: {},
    } as any);
    expect(result).toEqual({ ok: false, error: "No employee or customer record found" });
  });
});

describe("customer action — successful order", () => {
  beforeEach(() => {
    // Sequential mock responses: empRow, custRow, INSERT Order, INSERT Order_Item, INSERT sales_activity
    mockQuery
      .mockResolvedValueOnce({ rows: [{ employee_id: "emp-uuid" }] })
      .mockResolvedValueOnce({ rows: [{ customer_id: "cust-uuid" }] })
      .mockResolvedValueOnce({ rows: [{ order_id: "order-uuid" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
  });

  it("returns ok:true for a valid cart", async () => {
    const result = await action({
      request: makeOrderRequest([{ id: "item-uuid", basePrice: 5, qty: 1 }]),
      params: {},
      context: {},
    } as any);
    expect(result).toEqual({ ok: true });
  });

  it("calls pool.query exactly 5 times (emp, cust, order, item, activity)", async () => {
    await action({
      request: makeOrderRequest([{ id: "item-uuid", basePrice: 5, qty: 1 }]),
      params: {},
      context: {},
    } as any);
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("stores total price with 8.25% tax applied", async () => {
    await action({
      request: makeOrderRequest([{ id: "item-uuid", basePrice: 10, qty: 1 }]),
      params: {},
      context: {},
    } as any);
    // INSERT Order call (3rd call, index 2) — $3 param is total_price
    // 10 * 1.0825 = 10.824999... in IEEE 754, so toFixed(2) = "10.82"
    const insertOrderCall = mockQuery.mock.calls[2];
    const totalPriceArg = insertOrderCall[1][2]; // $3 param
    expect(totalPriceArg).toBe("10.82");
  });

  it("stores tax amount separately in sales_activity", async () => {
    await action({
      request: makeOrderRequest([{ id: "item-uuid", basePrice: 10, qty: 1 }]),
      params: {},
      context: {},
    } as any);
    // INSERT sales_activity call (5th call, index 4)
    // calcTax(10) = 10 * 0.0825 = 0.8250000000000001 in IEEE 754 → toFixed(2) = "0.83"
    const activityCall = mockQuery.mock.calls[4];
    const taxAmountArg = activityCall[1][2]; // $3 param = taxAmount
    expect(taxAmountArg).toBe("0.83");
  });
});

describe("customer action — cart grouping", () => {
  it("groups two cart entries with the same item_id into one Order_Item", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ employee_id: "emp-uuid" }] })
      .mockResolvedValueOnce({ rows: [{ customer_id: "cust-uuid" }] })
      .mockResolvedValueOnce({ rows: [{ order_id: "order-uuid" }] })
      .mockResolvedValue({ rows: [] });

    await action({
      request: makeOrderRequest([
        { id: "same-id", basePrice: 5, qty: 1 },
        { id: "same-id", basePrice: 5, qty: 1 },
      ]),
      params: {},
      context: {},
    } as any);

    // Only 1 INSERT Order_Item call (for the 1 unique item id), plus the sales_activity call
    // Total calls: emp(1) + cust(1) + order(1) + order_item(1) + activity(1) = 5
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("uses combined qty when grouping duplicate items", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ employee_id: "emp-uuid" }] })
      .mockResolvedValueOnce({ rows: [{ customer_id: "cust-uuid" }] })
      .mockResolvedValueOnce({ rows: [{ order_id: "order-uuid" }] })
      .mockResolvedValue({ rows: [] });

    await action({
      request: makeOrderRequest([
        { id: "same-id", basePrice: 5, qty: 2 },
        { id: "same-id", basePrice: 5, qty: 3 },
      ]),
      params: {},
      context: {},
    } as any);

    // The Order_Item INSERT (4th call) should use combined qty=5
    const orderItemCall = mockQuery.mock.calls[3];
    expect(orderItemCall[1][2]).toBe(5); // $3 = quantity
  });
});
