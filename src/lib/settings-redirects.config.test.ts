import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { SETTINGS_REDIRECTS } from "./settings-registry";
import { registerTarget } from "./nav/auth-redirects";

// The redirect table in next.config.ts and SETTINGS_REDIRECTS in the
// registry are one table in two places (config runs before routing in
// production; the registry drives the route twins, search and the shell).
// This holds them in step.
type Row = { source: string; destination: string; permanent?: boolean; has?: { type: string; key: string; value?: string }[] };

async function rows(): Promise<Row[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Row[]> }).redirects;
  return fn ? await fn() : [];
}

describe("next.config redirects match the settings registry", () => {
  it("has a permanent row for every SETTINGS_REDIRECTS entry, with the same target", async () => {
    const all = await rows();
    for (const r of SETTINGS_REDIRECTS) {
      const hit = all.find((c) => {
        if (c.source !== r.source) return false;
        const q = c.has?.find((h) => h.type === "query");
        if (r.query) return !!q && q.key === r.query.key && q.value === r.query.value;
        return !q;
      });
      expect(hit, `${r.source}${r.query ? `?${r.query.key}=${r.query.value}` : ""}`).toBeTruthy();
      expect(hit!.destination).toBe(r.destination);
      expect(hit!.permanent).toBe(true);
    }
  });
  it("lists every settings or account config row in the registry", async () => {
    const all = await rows();
    for (const c of all) {
      if (!/^\/(settings|account)(\/|$)/.test(c.source)) continue;
      const q = c.has?.find((h) => h.type === "query");
      const known = SETTINGS_REDIRECTS.some((r) => r.source === c.source && (q ? r.query?.key === q.key && r.query?.value === q.value : !r.query));
      expect(known, c.source).toBe(true);
    }
  });
  it("splits /register: the token row first, to /join, then /signup; /signup and /join are no longer redirected", async () => {
    const all = await rows();
    const reg = all.filter((c) => c.source === "/register");
    expect(reg.map((c) => [c.destination, !!c.has?.some((h) => h.key === "token")])).toEqual([
      ["/join", true],
      ["/signup", false],
    ]);
    expect(all.some((c) => c.source === "/signup" || c.source === "/join")).toBe(false);
    expect(registerTarget(new URLSearchParams("token=abc&x=1"))).toBe("/join?token=abc&x=1");
    expect(registerTarget(new URLSearchParams("utm_content=hero"))).toBe("/signup?utm_content=hero");
    expect(registerTarget(new URLSearchParams(""))).toBe("/signup");
  });
});
