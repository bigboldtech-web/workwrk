import { describe, expect, it } from "vitest";
import { fetchAllPages } from "./fetch-all-pages";

function fakeFetch(total: number, fail?: number) {
  const calls: string[] = [];
  const fn = (async (input: string) => {
    calls.push(input);
    const u = new URL(input, "http://x");
    const page = Number(u.searchParams.get("page"));
    const limit = Number(u.searchParams.get("limit"));
    if (fail === page) return new Response("no", { status: 500 });
    const start = (page - 1) * limit;
    const data = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({ id: start + i }));
    const totalPages = Math.ceil(total / limit);
    return new Response(JSON.stringify({ data, pagination: { page, limit, total, totalPages, hasMore: page < totalPages } }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("fetchAllPages", () => {
  it("reads past the 500-row page", async () => {
    const { fn, calls } = fakeFetch(1234);
    const r = await fetchAllPages<{ id: number }>("/api/users?scope=directory", { fetcher: fn });
    expect(r.items).toHaveLength(1234);
    expect(r.total).toBe(1234);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("/api/users?scope=directory&limit=500&page=1");
  });
  it("one page when small", async () => {
    const { fn, calls } = fakeFetch(3);
    const r = await fetchAllPages("/api/x", { fetcher: fn });
    expect(r.items).toHaveLength(3);
    expect(calls[0]).toBe("/api/x?limit=500&page=1");
  });
  it("throws instead of returning a partial list", async () => {
    const { fn } = fakeFetch(1200, 2);
    await expect(fetchAllPages("/api/x", { fetcher: fn })).rejects.toThrow("HTTP 500");
  });
});
