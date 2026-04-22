import { vi, describe, it, expect, afterEach } from "vitest";

import { loader } from "~/routes/api.weather";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WEATHERAPI_KEY;
  delete process.env.WEATHERAPI_LOCATION;
});

describe("weather loader", () => {
  it("returns status 500 when WEATHERAPI_KEY is not set", async () => {
    delete process.env.WEATHERAPI_KEY;
    // React Router's data() returns a DataWithResponseInit wrapper, not a plain Response
    const result = await loader() as any;
    expect(result.init?.status).toBe(500);
    expect(result.data?.error).toBe("WEATHERAPI_KEY not configured");
  });

  it("returns status 500 when fetch fails (non-ok response)", async () => {
    process.env.WEATHERAPI_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));
    const result = await loader() as any;
    expect(result.init?.status).toBe(500);
    expect(result.data?.error).toBe("Weather fetch failed");
  });

  it("returns temp_f and condition on success", async () => {
    process.env.WEATHERAPI_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        current: { temp_f: 72.5, condition: { text: "Partly cloudy" } },
      }),
    }));
    const result = await loader() as { temp_f: number; condition: string };
    expect(result.temp_f).toBe(72.5);
    expect(result.condition).toBe("Partly cloudy");
  });

  it("uses WEATHERAPI_LOCATION env var in the fetch URL", async () => {
    process.env.WEATHERAPI_KEY = "test-key";
    process.env.WEATHERAPI_LOCATION = "Austin, TX";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        current: { temp_f: 85.0, condition: { text: "Sunny" } },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    await loader();
    const fetchedUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchedUrl).toContain(encodeURIComponent("Austin, TX"));
  });

  it("defaults to College Station, TX when WEATHERAPI_LOCATION is unset", async () => {
    process.env.WEATHERAPI_KEY = "test-key";
    delete process.env.WEATHERAPI_LOCATION;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        current: { temp_f: 80.0, condition: { text: "Clear" } },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    await loader();
    const fetchedUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchedUrl).toContain(encodeURIComponent("College Station, TX"));
  });
});
