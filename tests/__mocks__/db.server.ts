import { vi } from "vitest";

export const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

const pool = { query: mockQuery };

export default pool;
