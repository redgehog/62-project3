export const TAX_RATE = 0.0825;
export const TOPPING_PRICE = 0.75;

export const applyTax = (subtotal: number) => subtotal * (1 + TAX_RATE);
export const calcTax = (subtotal: number) => subtotal * TAX_RATE;
export const calcItemTotal = (base: number, toppingCount: number) =>
  base + toppingCount * TOPPING_PRICE;
export const calcCartSubtotal = (
  items: Array<{ basePrice: number; qty: number }>
) => items.reduce((s, i) => s + i.basePrice * i.qty, 0);
