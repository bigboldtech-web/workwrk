// GET /oauth/authorize (docs/plans/mcp-server.md 3.4, review M1, step 1
// tests): the order of its checks; no error redirects by itself (appError
// renders a "Back to" link instead); the login callback; the pending cap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));

import { safeCallbackUrl } from "@/lib/nav/safe-callback";
import { authorizeStep } from "./authorize";
import { sweepOAuth } from "./sweep";
import { CHALLENGE, CLAUDE_REDIRECT, CONF_ID, LOOPBACK, PUBLIC_ID, seedWorld, testDb as db, useMcpEnv } from "./oauth-test-db";
import { hashSecret } from "./tokens";

const saved = { ...process.env };
let ipSeq = 0;
let ip = "";
beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  ip = `198.51.100.${++ipSeq}`;
});
afterEach(() => {
  process.env = { ...saved };
});

const good = (o: Record<string, string | null> = {}) => {
  const q = new URLSearchParams();
  const all: Record<string, string | null> = {
    response_type: "code", client_id: PUBLIC_ID, redirect_uri: LOOPBACK, code_challenge: CHALLENGE, code_challenge_method: "S256",
    state: "st-1", scope: "mcp:read mcp:write", resource: "https://app.workwrk.com/api/mcp", ...o,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null) q.set(k, v);
  return q;
};
const step = (q: URLSearchParams, signedIn = true) => authorizeStep(q, { ip, signedIn });

describe("the order of the checks", () => {
  it("names an unknown, malformed or disabled client first, whatever else is wrong, with no link", async () => {
    expect(await step(good({ client_id: "wkc_nope", redirect_uri: "https://evil.example/cb", code_challenge: null }))).toEqual({ kind: "error", error: "unknownApp" });
    expect(await step(good({ client_id: `wkc_${"z".repeat(32)}` }))).toEqual({ kind: "error", error: "unknownApp" });
    db.rows.oAuthClient.find((c) => c.id === PUBLIC_ID)!.disabledAt = new Date();
    expect(await step(good())).toEqual({ kind: "error", error: "unknownApp" });
  });

  it("then an unregistered redirect, whatever else is wrong, with no link", async () => {
    expect(await step(good({ redirect_uri: "https://evil.example/cb", response_type: "token" }))).toEqual({ kind: "error", error: "badRedirect" });
    expect(await step(good({ client_id: CONF_ID, redirect_uri: `${CLAUDE_REDIRECT}/` }))).toEqual({ kind: "error", error: "badRedirect" });
  });

  it("renders every other error with a Back link carrying error, error_description, state and iss, never a redirect", async () => {
    const cases: Array<[Record<string, string | null>, string]> = [
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ code_challenge: null }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge_method: null }, "invalid_request"],
      [{ state: "s".repeat(4097) }, "invalid_request"],
      [{ resource: "https://evil.example/api/mcp" }, "invalid_target"],
    ];
    for (const [o, error] of cases) {
      const v = await step(good(o));
      expect(v.kind, error).toBe("appError");
      if (v.kind !== "appError") continue;
      expect(v.label).toBe("an app on this computer");
      const back = new URL(v.backHref);
      expect(`${back.origin}${back.pathname}`).toBe(LOOPBACK);
      expect(back.searchParams.get("error")).toBe(error);
      expect(back.searchParams.get("error_description")).toBeTruthy();
      expect(back.searchParams.get("iss")).toBe("https://app.workwrk.com");
      expect(back.searchParams.get("state")).toBe(o.state ? null : "st-1");
    }
    // Nothing was stored for any of them.
    expect(db.rows.oAuthAuthorizationRequest ?? []).toEqual([]);
  });

  it("refuses a parameter sent twice", async () => {
    const q = good();
    q.append("code_challenge", CHALLENGE);
    expect((await step(q)).kind).toBe("appError");
  });
});

describe("a good request", () => {
  it("is stored for 10 minutes, as a hash, with the resource and the scopes as asked", async () => {
    const v = await step(good({ scope: "mcp:read" }));
    expect(v.kind).toBe("redirect");
    if (v.kind !== "redirect") return;
    const token = new URL(v.to, "https://app.workwrk.com").searchParams.get("request")!;
    expect(token).toMatch(/^wkmcp_rq_[A-Za-z0-9_-]{43}$/);
    const row = db.rows.oAuthAuthorizationRequest[0];
    expect(row).toMatchObject({ id: hashSecret(token), clientId: PUBLIC_ID, redirectUri: LOOPBACK, scopes: ["mcp:read"], state: "st-1", codeChallenge: CHALLENGE, resource: "https://app.workwrk.com/api/mcp" });
    expect((row.expiresAt as Date).getTime() - (row.createdAt as Date).getTime()).toBe(10 * 60 * 1000);
  });

  it("goes to /login with a short consent callback that safeCallbackUrl keeps, when signed out", async () => {
    const v = await step(good(), false);
    expect(v.kind).toBe("redirect");
    if (v.kind !== "redirect") return;
    const login = new URL(v.to, "https://app.workwrk.com");
    expect(login.pathname).toBe("/login");
    const callback = login.searchParams.get("callbackUrl")!;
    expect(callback).toMatch(/^\/oauth\/consent\?request=wkmcp_rq_[A-Za-z0-9_-]{43}$/);
    expect(callback.length).toBeLessThan(100);
    expect(safeCallbackUrl(callback)).toBe(callback);
  });

  it("goes straight to the consent page when signed in", async () => {
    const v = await step(good(), true);
    expect(v.kind === "redirect" && v.to.startsWith("/oauth/consent?request=wkmcp_rq_")).toBe(true);
  });
});

describe("the pending cap", () => {
  it("is 300 an address per 10 minutes, and another address is not held by it", async () => {
    for (let i = 0; i < 300; i++) expect((await step(good())).kind).toBe("redirect");
    expect(await step(good())).toEqual({ kind: "error", error: "tooMany" });
    expect(db.rows.oAuthAuthorizationRequest).toHaveLength(300);
    ip = "203.0.113.250";
    expect((await step(good())).kind).toBe("redirect");
  });
});

// Final review of the MCP server, contract H1: the sweep deleted a client with
// no grant 24 hours after it registered, so an app that keeps its client id
// (ChatGPT, Claude Code, VS Code) and whose first try ended at Deny, or at
// "No workspace can connect AI apps", met "This app is not known to WorkwrK"
// from the next night on, with no way out. Fails on fcca4075: an authorize
// stamped nothing, and the sweep deleted the client.
describe("an authorize keeps its client", () => {
  const client = () => db.rows.oAuthClient.find((c) => c.id === PUBLIC_ID)!;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it("stamps lastUsedAt at most once an hour, and only for a request it stored", async () => {
    const t0 = new Date("2026-10-21T09:00:00Z");
    expect(client().lastUsedAt).toBeNull();
    expect((await authorizeStep(good({ redirect_uri: "https://evil.example/cb" }), { ip, signedIn: true, now: t0 })).kind).toBe("error");
    expect((await authorizeStep(good({ response_type: "token" }), { ip, signedIn: true, now: t0 })).kind).toBe("appError");
    expect(client().lastUsedAt).toBeNull();
    expect((await authorizeStep(good(), { ip, signedIn: true, now: t0 })).kind).toBe("redirect");
    expect(client().lastUsedAt).toEqual(t0);
    await authorizeStep(good(), { ip, signedIn: true, now: new Date(t0.getTime() + HOUR - 1) });
    expect(client().lastUsedAt).toEqual(t0);
    const later = new Date(t0.getTime() + HOUR);
    await authorizeStep(good(), { ip, signedIn: true, now: later });
    expect(client().lastUsedAt).toEqual(later);
  });

  it("so the sweep keeps a client authorized but never granted for 30 days after its last authorize, then deletes it", async () => {
    const born = new Date("2026-10-01T09:00:00Z");
    client().createdAt = born;
    db.rows.oAuthClient.find((c) => c.id === CONF_ID)!.createdAt = born;
    const tried = new Date(born.getTime() + 3600_000);
    expect((await authorizeStep(good(), { ip, signedIn: true, now: tried })).kind).toBe("redirect");
    // Two days on (the request long expired and swept): still there, so the app's next try reaches the consent page.
    await sweepOAuth(new Date(tried.getTime() + 2 * DAY));
    expect(db.rows.oAuthClient.some((c) => c.id === PUBLIC_ID)).toBe(true);
    expect((await authorizeStep(good(), { ip, signedIn: true, now: new Date(tried.getTime() + 2 * DAY) })).kind).toBe("redirect");
    // Thirty days after that last authorize, with no grant: gone, as the sweep's rule says.
    await sweepOAuth(new Date(tried.getTime() + 2 * DAY + 30 * DAY + 2 * HOUR));
    expect(db.rows.oAuthClient.some((c) => c.id === PUBLIC_ID)).toBe(false);
    // And a client never authorized at all still goes 24 hours after it registered.
    expect(db.rows.oAuthClient.some((c) => c.id === CONF_ID)).toBe(false);
  });
});
