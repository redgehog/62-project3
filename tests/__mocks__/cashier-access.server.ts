import { vi } from "vitest";

export const mockSession = {
  get: vi.fn((k: string) => (k === "allow:cashier" ? true : undefined)),
  set: vi.fn(),
};

export const getCashierSession = vi.fn().mockResolvedValue(mockSession);
export const commitCashierSession = vi.fn().mockResolvedValue("Set-Cookie: test");
export const destroyCashierSession = vi.fn().mockResolvedValue("Set-Cookie: cleared");
export const requireCashierAccess = vi.fn().mockResolvedValue(mockSession);
