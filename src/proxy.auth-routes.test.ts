import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

// spec-account-auth A0(b): the four routing cases, run with the edge gate
// AND the hard host split on together (either flag alone hides the other's
// failure). Production runs both as true.
const APP = "app.workwrk.test";
const MKT = "workwrk.test";

function req(url: string, host: string, cookie?: string) {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(url, `https://${host}`), { headers });
}

describe("proxy: sign-in routes with AUTH_EDGE_GATE and HARD_HOST_SPLIT on", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.AUTH_EDGE_GATE = "true";
    process.env.HARD_HOST_SPLIT = "true";
    process.env.APP_HOST = APP;
    process.env.MARKETING_HOST = MKT;
    delete process.env.ADMIN_HOST;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("1. a marketing-host Start free (/signup) is sent to the app host with its query", async () => {
    const res = await proxy(req("/signup?utm_content=hero", MKT));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`https://${APP}/signup?utm_content=hero`);
  });

  it("2. /join?token= opens signed out on the app host (never bounced to /login)", async () => {
    const res = await proxy(req("/join?token=abc", APP));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
    // and an invitation link on the marketing host reaches the app host first
    const mk = await proxy(req("/join?token=abc", MKT));
    expect(mk.headers.get("location")).toBe(`https://${APP}/join?token=abc`);
  });

  it("3. /register?token= passes the proxy untouched so its 308 to /join can run (config + route twin)", async () => {
    const res = await proxy(req("/register?token=abc", APP));
    expect(res.headers.get("location")).toBeNull();
    const mk = await proxy(req("/register?token=abc", MKT));
    expect(mk.headers.get("location")).toBe(`https://${APP}/register?token=abc`);
  });

  it("4. /onboard signed out still goes to /login with the callback", async () => {
    const res = await proxy(req("/onboard", APP));
    expect(res.status).toBeGreaterThanOrEqual(300);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("callbackUrl")).toBe("/onboard");
  });

  it("keeps the old wizard URLs on the app host so their redirects can run there", async () => {
    for (const p of ["/welcome", "/setup"]) {
      const mk = await proxy(req(p, MKT));
      expect(mk.headers.get("location")).toBe(`https://${APP}${p}`);
    }
  });

  it("a signed-in /onboard passes (the wizard needs a session, nothing more at the edge)", async () => {
    const res = await proxy(req("/onboard", APP, "next-auth.session-token=x"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("/loader-preview is not an app path: never gated, never moved", async () => {
    const res = await proxy(req("/loader-preview", APP));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("proxy: the Staff console host", () => {
  const saved = { ...process.env };
  const ADMIN = "admin.workwrk.test";
  beforeEach(() => {
    process.env.ADMIN_HOST = ADMIN;
    process.env.APP_HOST = APP;
    process.env.MARKETING_HOST = MKT;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("serves robots.txt there (it turns every crawler away) and sends other pages to the console", async () => {
    const robots = await proxy(req("/robots.txt", ADMIN));
    expect(robots.headers.get("location")).toBeNull();
    const page = await proxy(req("/pricing", ADMIN));
    expect(new URL(page.headers.get("location")!).pathname).toBe("/admin");
  });
});
