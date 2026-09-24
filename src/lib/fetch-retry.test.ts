import { describe, expect, it } from "vitest";
import { fetchWithRetry, keepaliveBytesInFlight, shouldKeepalive } from "./fetch-retry";

const res = (status: number) => new Response(null, { status });
const noSleep = async () => undefined;

describe("fetchWithRetry (cell writes and form submits)", () => {
  it("retries a network failure and a 5xx, then succeeds", async () => {
    const seen: string[] = [];
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      seen.push(String(n));
      if (n === 1) throw new TypeError("network");
      if (n === 2) return res(503);
      return res(200);
    }) as unknown as typeof fetch;
    const r = await fetchWithRetry("/x", { method: "PATCH", body: "{}" }, { fetchImpl, sleep: noSleep });
    expect(r.status).toBe(200);
    expect(n).toBe(3);
  });
  it("never retries a 4xx: a conflict or a refusal is an answer", async () => {
    let n = 0;
    const fetchImpl = (async () => { n += 1; return res(409); }) as unknown as typeof fetch;
    const r = await fetchWithRetry("/x", { method: "PATCH", body: "{}" }, { fetchImpl, sleep: noSleep });
    expect(r.status).toBe(409);
    expect(n).toBe(1);
  });
  it("throws after the last attempt so the caller can surface it", async () => {
    const fetchImpl = (async () => res(500)) as unknown as typeof fetch;
    await expect(fetchWithRetry("/x", { method: "POST", body: "{}" }, { fetchImpl, sleep: noSleep, attempts: 2 })).rejects.toThrow("HTTP 500");
  });
  it("sends keepalive only under the browser's body limit", async () => {
    const inits: RequestInit[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => { inits.push(init); return res(200); }) as unknown as typeof fetch;
    await fetchWithRetry("/x", { method: "POST", body: "{}" }, { fetchImpl, sleep: noSleep });
    await fetchWithRetry("/x", { method: "POST", body: "x".repeat(70_000) }, { fetchImpl, sleep: noSleep });
    expect(inits[0].keepalive).toBe(true);
    expect(inits[1].keepalive).toBeUndefined();
    expect(shouldKeepalive(undefined)).toBe(false);
  });
});

describe("shouldKeepalive measures bytes, not characters", () => {
  it("refuses a multi-byte body under the character limit but over the byte limit", () => {
    const body = "日".repeat(30_000); // 30,000 characters, 90,000 bytes
    expect(shouldKeepalive(body)).toBe(false);
    expect(shouldKeepalive("a".repeat(30_000))).toBe(true);
    expect(shouldKeepalive("é".repeat(25_000))).toBe(true); // 50,000 bytes
  });
});

describe("the keepalive quota is shared by every write in flight", () => {
  it("sends a second write without keepalive while the first holds most of the budget", async () => {
    const inits: RequestInit[] = [];
    let releaseFirst: () => void = () => undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      inits.push(init);
      if (inits.length === 1) await new Promise<void>((r) => { releaseFirst = r; });
      return res(200);
    }) as unknown as typeof fetch;
    const big = fetchWithRetry("/batch", { method: "POST", body: "x".repeat(50_000) }, { fetchImpl, sleep: noSleep });
    await Promise.resolve();
    expect(keepaliveBytesInFlight()).toBe(50_000);
    await fetchWithRetry("/cols", { method: "PATCH", body: "y".repeat(20_000) }, { fetchImpl, sleep: noSleep });
    releaseFirst();
    await big;
    expect(inits[0].keepalive).toBe(true);
    expect(inits[1].keepalive).toBeUndefined();
    expect(keepaliveBytesInFlight()).toBe(0);
  });
  it("retries a keepalive attempt the browser refused without keepalive", async () => {
    const inits: RequestInit[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      inits.push(init);
      if (init.keepalive) throw new TypeError("Failed to fetch");
      return res(200);
    }) as unknown as typeof fetch;
    const r = await fetchWithRetry("/x", { method: "PATCH", body: "{}" }, { fetchImpl, sleep: noSleep });
    expect(r.status).toBe(200);
    expect(inits.map((i) => i.keepalive === true)).toEqual([true, false]);
    expect(keepaliveBytesInFlight()).toBe(0);
  });
});
