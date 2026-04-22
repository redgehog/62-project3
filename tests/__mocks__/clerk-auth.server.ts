import { vi } from "vitest";

export const requireSignedIn = vi.fn().mockResolvedValue({ userId: "test-user-id" });
