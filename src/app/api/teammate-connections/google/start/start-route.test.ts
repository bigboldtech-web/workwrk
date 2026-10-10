// GET /api/teammate-connections/google/start (docs/plans/ai-teammates-phase3.md
// step 2): every refusal is a redirect back to the card with its own code;
// the consent address asks for PKCE (S256), the products granted before and
// only the products asked; the state is stored only as its hash; the cookie
// is HttpOnly, Lax and scoped to the two OAuth routes; and a request on
// another host is moved to the app host first.

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  cfg: null as unknown,
  gate: null as unknown,
  acting: null as unknown,
  limited: false,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));
vi.mock("@/lib/connectors/google/config", () => ({
  googleConfig: () => st.cfg,
  googleRevokeConfig: () => ({ revokeUrl: "https://oauth2.google.test/revoke", standIn: false }),
  googleRedirectUri: () => "https://app.workwrk.test/api/teammate-connections/google/callback",
}));
vi.mock("@/lib/app-gate", () => ({ requireApp: vi.fn(async () => st.gate) }));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: vi.fn(async () => st.acting) }));
vi.mock("@/lib/rate-limit-memory", () => ({ rateLimit: () => ({ ok: !st.limited, retryAfter: st.limited ? 60 : 0 }) }));

import { requireApp } from "@/lib/app-gate";
import { stateCookieOptions } from "@/lib/connectors/connect-redirects";
import { cdb, resetConnectorDb, seedConnection } from "@/lib/connectors/connector-test-db";
import { GET } from "./route";

const CFG = {
  clientId: "agent-client",
  clientSecret: "agent-secret",
  authUrl: "https://accounts.google.test/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.google.test/token",
  revokeUrl: "https://oauth2.google.test/revoke",
  gmailBase: "https://gmail.google.test/gmail/v1",
  calendarBase: "https://www.google.test/calendar/v3",
  products: ["gmail", "calendar"],
  standIn: false,
};

const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };

function start(query = "?products=calendar&ws=org1", host = "app.workwrk.test") {
  return GET(new NextRequest(`https://${host}/api/teammate-connections/google/start${query}`, { headers: { host } }));
}

function errorOf(res: Response): string | null {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).searchParams.get("ai_error") : null;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.workwrk.test");
  process.env.SECRETS_ENCRYPTION_KEY = "c".repeat(64);
  resetConnectorDb();
  cdb.policy.set("org1", ["gmail", "calendar"]);
  st.cfg = CFG;
  st.gate = { viewer: MAX };
  st.acting = { ok: true, person: { ...MAX, name: "Max Chen", firstName: "Max", email: "max@x.test", timezone: "UTC" } };
  st.limited = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the refusals", () => {
  it("redirects each to the card with its own code, and stores nothing", async () => {
    st.cfg = null;
    expect(errorOf(await start())).toBe("not_configured");
    st.cfg = CFG;

    st.gate = { error: NextResponse.json({ error: "app_off" }, { status: 403 }) };
    expect(errorOf(await start())).toBe("person_cannot");
    st.gate = { viewer: MAX };

    // A Guest, an agent account, AI off or gone: resolveActingPerson refuses.
    st.acting = { ok: false, reason: "guest" };
    expect(errorOf(await start())).toBe("person_cannot");
    st.acting = { ok: true, person: { ...MAX } };

    st.limited = true;
    expect(errorOf(await start())).toBe("rate_limited");
    st.limited = false;

    cdb.policy.set("org1", []);
    expect(errorOf(await start())).toBe("workspace_off");
    cdb.policy.set("org1", ["calendar"]);
    expect(errorOf(await start("?products=gmail&ws=org1"))).toBe("bad_products");
    expect(errorOf(await start("?products=nonsense&ws=org1"))).toBe("bad_products");

    expect(cdb.states).toEqual([]);
  });

  it("sends a signed-out person to sign in, then back to the card", async () => {
    st.gate = { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await start();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.workwrk.test/login?callbackUrl=/account/connections");
  });

  // Review round 2 of Phase 3: Reconnect on a card showing one workspace,
  // with the session switched to another in another tab, connected the
  // other one with the first one's products.
  it("connects nothing for a workspace other than the one the card showed, or a link that names none", async () => {
    for (const query of ["?products=calendar&ws=org2", "?products=calendar", "?products=calendar&ws="]) {
      const res = await start(query);
      expect(res.headers.get("location")).toBe("https://app.workwrk.test/account/connections?ai_error=workspace_changed#ai-google");
    }
    expect(cdb.states).toEqual([]);
    expect(cdb.lookups).toEqual([]);
    // The card's own workspace still connects.
    expect(new URL((await start("?products=calendar&ws=org1")).headers.get("location") ?? "").origin).toBe("https://accounts.google.test");
  });

  it("lands every refusal on the app host's card, at the Google card", async () => {
    st.cfg = null;
    expect((await start()).headers.get("location")).toBe("https://app.workwrk.test/account/connections?ai_error=not_configured#ai-google");
  });
});

describe("the redirect to Google", () => {
  it("asks with S256, the products granted before, consent, and only the products asked", async () => {
    const res = await start("?products=calendar&ws=org1");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location") ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(CFG.authUrl);
    const q = url.searchParams;
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("include_granted_scopes")).toBe("true");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("client_id")).toBe("agent-client");
    expect(q.get("redirect_uri")).toBe("https://app.workwrk.test/api/teammate-connections/google/callback");
    const scopes = (q.get("scope") ?? "").split(" ");
    expect(scopes.sort()).toEqual(["email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy", "openid"].sort());
    expect(scopes.some((s) => s.includes("gmail"))).toBe(false);
    expect(res.headers.get("location")).not.toContain("agent-secret");
  });

  it("keeps what a reconnect already had, and hints the account it had", async () => {
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: "sub-max", products: ["gmail"], accountEmail: "max@mail.test" });
    const q = new URL((await start("?products=calendar&ws=org1")).headers.get("location") ?? "").searchParams;
    expect((q.get("scope") ?? "").split(" ")).toEqual(expect.arrayContaining(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events"]));
    expect(q.get("login_hint")).toBe("max@mail.test");
    expect(cdb.states[0].products).toEqual(["gmail", "calendar"]);
  });

  it("stores only the state's sha256, bound to the person and the workspace, with the verifier sealed", async () => {
    const res = await start();
    const state = new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThan(40);
    expect(cdb.states).toHaveLength(1);
    const row = cdb.states[0];
    expect(row.id).toBe(createHash("sha256").update(state).digest("hex"));
    expect(row).toMatchObject({ organizationId: "org1", userId: "u-max", provider: "google", products: ["calendar"] });
    expect(JSON.stringify(row)).not.toContain(state);
    expect(row.verifierSealed).toMatchObject({ v: 1 });
    const ttl = (row.expiresAt as Date).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("sets the state cookie HttpOnly, Lax, ten minutes, on the OAuth routes' path only", async () => {
    const res = await start();
    const state = new URL(res.headers.get("location") ?? "").searchParams.get("state");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`wk_tc_state=${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/api/teammate-connections/google");
    expect(cookie).toContain("Max-Age=600");
    // Secure wherever it is served for real.
    vi.stubEnv("NODE_ENV", "production");
    expect(stateCookieOptions(600)).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/api/teammate-connections/google", maxAge: 600 });
  });
});

describe("the host", () => {
  it("moves a request on another host to the app host first, before anything is read", async () => {
    const res = await start("?products=calendar&ws=org1", "workwrk.test");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.workwrk.test/api/teammate-connections/google/start?products=calendar&ws=org1&hop=1");
    expect(requireApp).not.toHaveBeenCalled();
    expect(cdb.states).toEqual([]);
  });

  it("moves it once at most, so a proxy that rewrites the host can never loop it", async () => {
    const res = await start("?products=calendar&ws=org1&hop=1", "127.0.0.1:3000");
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location") ?? "").origin).toBe("https://accounts.google.test");
  });
});
