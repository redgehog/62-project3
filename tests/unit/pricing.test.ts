import { describe, it, expect } from "vitest";
import {
  applyTax,
  calcTax,
  calcItemTotal,
  calcCartSubtotal,
  TAX_RATE,
  TOPPING_PRICE,
} from "~/lib/pricing";

describe("TAX_RATE", () => {
  it("is 8.25%", () => {
    expect(TAX_RATE).toBe(0.0825);
  });
});

describe("TOPPING_PRICE", () => {
  it("is $0.75", () => {
    expect(TOPPING_PRICE).toBe(0.75);
  });
});

describe("applyTax", () => {
  it("adds 8.25% to a non-zero subtotal", () => {
    expect(applyTax(10)).toBeCloseTo(10.825, 3);
  });

  it("returns 0 for $0 subtotal", () => {
    expect(applyTax(0)).toBe(0);
  });

  it("rounds correctly for $5.50 subtotal", () => {
    expect(applyTax(5.5)).toBeCloseTo(5.95375, 5);
  });

  it("is consistent: applyTax(x) === x + calcTax(x)", () => {
    const subtotal = 12.99;
    expect(applyTax(subtotal)).toBeCloseTo(subtotal + calcTax(subtotal), 10);
  });
});

describe("calcTax", () => {
  it("returns 8.25% of the subtotal", () => {
    expect(calcTax(10)).toBeCloseTo(0.825, 3);
  });

  it("returns 0 for $0 subtotal", () => {
    expect(calcTax(0)).toBe(0);
  });

  it("rounds correctly for $4.00 subtotal", () => {
    expect(calcTax(4)).toBeCloseTo(0.33, 2);
  });
});

describe("calcItemTotal", () => {
  it("returns base price when no toppings", () => {
    expect(calcItemTotal(5, 0)).toBe(5);
  });

  it("adds one topping ($0.75) to base price", () => {
    expect(calcItemTotal(5, 1)).toBeCloseTo(5.75, 2);
  });

  it("adds four toppings to base price", () => {
    expect(calcItemTotal(5, 4)).toBeCloseTo(8.0, 2);
  });

  it("works with a fractional base price", () => {
    expect(calcItemTotal(4.5, 2)).toBeCloseTo(6.0, 2);
  });
});

describe("calcCartSubtotal", () => {
  it("returns 0 for an empty cart", () => {
    expect(calcCartSubtotal([])).toBe(0);
  });

  it("computes a single item", () => {
    expect(calcCartSubtotal([{ basePrice: 5, qty: 1 }])).toBe(5);
  });

  it("multiplies price by quantity", () => {
    expect(calcCartSubtotal([{ basePrice: 5, qty: 2 }])).toBe(10);
  });

  it("sums multiple items correctly", () => {
    expect(
      calcCartSubtotal([
        { basePrice: 5, qty: 2 },
        { basePrice: 3, qty: 3 },
      ])
    ).toBe(19);
  });

  it("handles fractional prices", () => {
    expect(calcCartSubtotal([{ basePrice: 4.75, qty: 4 }])).toBeCloseTo(19.0, 2);
  });
});
