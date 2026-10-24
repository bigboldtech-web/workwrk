// The consent page and the decision (docs/plans/mcp-server.md 3.4, Decision
// 5, review H1, step 1 tests): a stale tokenVersion refused on both; the
// Origin and the Referer compared as origins ("app.workwrk.com.evil.example"
// refused); csrf, viewer and a used request; the form's charset; Allow sets
// tokenVersion and a new family; Deny.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown> },
  raw: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => st.raw }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }), headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/admin/company-detail", () => ({ ownerIdsFor: async () => [] }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("./oauth-test-db");
  return { resolveActingPerson: async (o: string, u: string) => ({ ok: true, person: actingAs(o, u) }) };
});

import { authorizeStep } from "./authorize";
import { consentStep, type ConsentView } from "./consent";
import { decide } from "./decision";
import { grantConsent } from "./grants";
import { CHALLENGE, CLAUDE_REDIRECT, CONF_ID, LOOPBACK, NO_REFRESH_ID, ORIGIN, POST_ID, PUBLIC_ID, memberRow, seed, seedWorld, sessionOf, testDb as db, useMcpEnv } from "./oauth-test-db";
import { consentSession } from "./session";
import { hashSecret } from "./tokens";

const saved = { ...process.env };
let n = 0;
beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  n += 1;
  st.session = sessionOf("u-max", "org-a", "max@acme.test", 3);
  st.raw = { authAt: Date.now() - 60_000 };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

async function pending(scope = "mcp:read mcp:write"): Promise<string> {
  const q = new URLSearchParams({ response_type: "code", client_id: PUBLIC_ID, redirect_uri: LOOPBACK, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "st-9", scope });
  const v = await authorizeStep(q, { ip: `192.0.2.${n % 250}`, signedIn: true });
  if (v.kind !== "redirect") throw new Error(v.kind);
  return new URL(v.to, ORIGIN).searchParams.get("request")!;
}

const view = (request: string | null, v: string | null = null) => consentStep({ requestToken: request, view: v, session: consentSession });

async function form(request: string): Promise<Extract<ConsentView, { kind: "form" }>> {
  const v = await view(request);
  if (v.kind !== "form") throw new Error(`expected the form, got ${JSON.stringify(v)}`);
  return v;
}

function post(fields: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN }, contentType = "application/x-www-form-urlencoded; charset=UTF-8") {
  return decide(new Request(`${ORIGIN}/oauth/decision`, { method: "POST", headers: { "content-type": contentType, ...headers }, body: new URLSearchParams(fields).toString() }));
}

// Allow as the page sends it once its guard is armed (allow-guard.ts; final review, security M1).
const allow = (f: Extract<ConsentView, { kind: "form" }>, o: Record<string, string> = {}) =>
  ({ request: f.request, csrf: f.csrf, action: "allow", workspace: f.selected, access: "write", armed: "1", ...o });
// The same Allow with no armed field: a click before the person saw the page, or a browser with no script.
const unarmed = (f: Extract<ConsentView, { kind: "form" }>): Record<string, string> =>
  ({ request: f.request, csrf: f.csrf, action: "allow", workspace: f.selected, access: "write" });

describe("a session a plain log out ended (2026-10-22)", () => {
  // A plain log out lists the session id and bumps nothing, so the
  // tokenVersion check alone would let a copy of the logged-out cookie
  // connect an app in the minutes before its next check.
  it("is stale at once on the page and at the decision", async () => {
    const token = await pending();
    const f = await form(token);
    st.raw = { authAt: Date.now() - 60_000, sid: "AAAAAAAAAAAAAAAAAAAAAA" };
    seed(db, "endedSession", { sid: "AAAAAAAAAAAAAAAAAAAAAA", userId: "u-max", endedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await view(token)).toMatchObject({ kind: "stale" });
    expect(await post(allow(f))).toMatchObject({ kind: "refuse", status: 403, view: "stale" });
    expect(db.rows.oAuthGrant ?? []).toEqual([]);
  });

  it("is stale when the list cannot be read, since a grant outlives the session", async () => {
    const token = await pending();
    st.raw = { authAt: Date.now() - 60_000, sid: "BBBBBBBBBBBBBBBBBBBBBB" };
    db.failing.add("endedSession");
    expect(await view(token)).toMatchObject({ kind: "stale" });
    db.failing.clear();
  });

  it("is still fine for a session nobody logged out", async () => {
    const token = await pending();
    st.raw = { authAt: Date.now() - 60_000, sid: "CCCCCCCCCCCCCCCCCCCCCC" };
    expect((await view(token)).kind).toBe("form");
  });

  // Review of the longer-sessions fix, L1 and L2: one helper for consent and
  // the privileged writes, where a list that is not there yet holds nobody,
  // since no log out can have been written to it (it falls back to the bump).
  it("is still fine when the list is not there yet (P2021)", async () => {
    const token = await pending();
    st.raw = { authAt: Date.now() - 60_000, sid: "DDDDDDDDDDDDDDDDDDDDDD" };
    const model = (db.prisma as unknown as { endedSession: { findUnique: (...a: unknown[]) => Promise<unknown> } }).endedSession;
    vi.spyOn(model, "findUnique").mockRejectedValue(Object.assign(new Error('relation "EndedSession" does not exist'), { code: "P2021" }));
    expect((await view(token)).kind).toBe("form");
  });
});

describe("a stale session (H1): refused on both the page and the decision", () => {
  it("shows the stale page, and the decision answers 403 stale without taking the request", async () => {
    const token = await pending();
    const f = await form(token);
    db.rows.user[0].tokenVersion = 4; // Sign out everywhere on another device, say
    expect(await view(token)).toMatchObject({ kind: "stale" });
    expect(await post(allow(f))).toMatchObject({ kind: "refuse", status: 403, view: "stale" });
    expect(db.rows.oAuthAuthorizationRequest).toHaveLength(1);
    expect(db.rows.oAuthGrant ?? []).toEqual([]);
  });

  it("treats a session with no tokenVersion, or one the revalidation ended, as stale", async () => {
    const token = await pending();
    st.session = sessionOf("u-max", "org-a", "max@acme.test");
    expect(await view(token)).toMatchObject({ kind: "stale" });
    st.session = sessionOf("u-max", "org-a", "max@acme.test", 3);
    st.raw = { authAt: Date.now(), revoked: true };
    expect(await view(token)).toMatchObject({ kind: "stale" });
  });
});

describe("the origin check", () => {
  it("refuses no Origin and no Referer, a foreign Origin, Origin null, and a look-alike Referer", async () => {
    const f = await form(await pending());
    for (const headers of [{}, { origin: "https://evil.example" }, { origin: "null" }, { referer: "https://app.workwrk.com.evil.example/" }, { origin: "https://app.workwrk.com.evil.example" }]) {
      expect(await post(allow(f), headers as Record<string, string>), JSON.stringify(headers)).toMatchObject({ kind: "refuse", status: 403 });
    }
    // Nothing was taken by any of them: the real one still works, by its Referer.
    expect(await post(allow(f), { referer: `${ORIGIN}/oauth/consent?request=${f.request}` })).toMatchObject({ kind: "redirect" });
  });
});

describe("the form", () => {
  it("refuses a wrong csrf, another viewer and a request already used", async () => {
    const f = await form(await pending());
    expect(await post(allow(f, { csrf: `wkmcp_rq_${"x".repeat(43)}` }))).toMatchObject({ kind: "refuse", status: 403, view: "refused" });
    // Mia, signed in on the same request, is not its viewer.
    seed(db, "user", memberRow({ id: "u-mia", email: "mia@acme.test", organizationId: "org-a", tokenVersion: 0 }));
    st.session = sessionOf("u-mia", "org-a", "mia@acme.test", 0);
    expect(await post(allow(f))).toMatchObject({ kind: "refuse", status: 403 });
    st.session = sessionOf("u-max", "org-a", "max@acme.test", 3);
    expect(await post(allow(f))).toMatchObject({ kind: "redirect" });
    expect(await post(allow(f))).toMatchObject({ kind: "refuse", status: 403 });
  });

  it("accepts the form with a charset, and refuses another media type", async () => {
    const f = await form(await pending());
    expect(await post(allow(f), { origin: ORIGIN }, "application/json")).toMatchObject({ kind: "refuse", status: 415 });
    expect(await post(allow(f), { origin: ORIGIN }, "application/x-www-form-urlencoded;charset=utf-8")).toMatchObject({ kind: "redirect" });
  });

  it("shows only the form most recently shown: an older csrf no longer decides", async () => {
    const token = await pending();
    const first = await form(token);
    const second = await form(token);
    expect(await post(allow(first))).toMatchObject({ kind: "refuse", status: 403 });
    expect(await post(allow(second))).toMatchObject({ kind: "redirect" });
  });
});

describe("Allow", () => {
  it("binds the grant to the account's tokenVersion and a new family, and answers code, state and iss", async () => {
    const f = await form(await pending());
    const out = await post(allow(f));
    expect(out.kind).toBe("redirect");
    if (out.kind !== "redirect") return;
    const to = new URL(out.to);
    expect(`${to.origin}${to.pathname}`).toBe(LOOPBACK);
    expect(to.searchParams.get("code")).toMatch(/^wkmcp_ac_[A-Za-z0-9_-]{43}$/);
    expect(to.searchParams.get("state")).toBe("st-9");
    expect(to.searchParams.get("iss")).toBe(ORIGIN);
    const g = db.rows.oAuthGrant[0];
    expect(g).toMatchObject({ userId: "u-max", organizationId: "org-a", clientId: PUBLIC_ID, tokenVersion: 3, scopes: ["mcp:read", "mcp:write"], appName: "an app on this computer", redirectHost: "localhost", revokedAt: null });
    const code = db.rows.oAuthAuthorizationCode[0];
    expect(code).toMatchObject({ id: hashSecret(to.searchParams.get("code")!), familyId: g.familyId, grantId: g.id, redirectUri: LOOPBACK });
    // The request is gone, the audit row and the notice written.
    expect(db.rows.oAuthAuthorizationRequest).toEqual([]);
    expect(db.rows.activityLog.filter((a) => a.type === "mcp.app.connected").map((a) => a.severity)).toEqual(["warning"]);
    expect(db.rows.notification.map((x) => x.title)).toEqual(["AI app connected"]);

    // Connecting again updates the same grant with a NEW family and ends the old family's tokens.
    seed(db, "oAuthToken", { id: "t-old", grantId: g.id, kind: "access", familyId: g.familyId, scopes: ["mcp:read"], resource: `${ORIGIN}/api/mcp`, expiresAt: new Date(Date.now() + 3600_000) });
    const oldFamily = g.familyId;
    const again = await post(allow(await form(await pending()), { access: "read" }));
    expect(again.kind).toBe("redirect");
    expect(db.rows.oAuthGrant).toHaveLength(1);
    expect(db.rows.oAuthGrant[0].familyId).not.toBe(oldFamily);
    expect(db.rows.oAuthGrant[0].scopes).toEqual(["mcp:read"]);
    expect(db.rows.oAuthToken.find((t) => t.id === "t-old")?.revokedAt).toBeInstanceOf(Date);
  });

  // Review of the longer-sessions fix, L4: the session default became 90
  // days, and a connection followed it. Decided: 30 days unless the workspace
  // stored a session lifetime, which it then follows, as before.
  it("lasts 30 days where the workspace stored no session lifetime, and the stored one where it did", async () => {
    expect((await post(allow(await form(await pending())))).kind).toBe("redirect");
    const g = db.rows.oAuthGrant[0];
    expect((g.endsBy as Date).getTime() - (g.authorizedAt as Date).getTime()).toBe(30 * 86_400_000);
    db.rows.organization[0].settings = { security: { sessionMaxDays: 60 } };
    expect((await post(allow(await form(await pending())))).kind).toBe("redirect");
    const again = db.rows.oAuthGrant[0];
    expect((again.endsBy as Date).getTime() - (again.authorizedAt as Date).getTime()).toBe(60 * 86_400_000);
  });

  it("gives write only when the app asked for it", async () => {
    const f = await form(await pending("mcp:read"));
    expect(f.writeAsked).toBe(false);
    expect((await post(allow(f, { access: "write" }))).kind).toBe("redirect");
    expect(db.rows.oAuthGrant[0].scopes).toEqual(["mcp:read"]);
  });

  it("sends access_denied to the app when the chosen workspace is no longer eligible", async () => {
    const f = await form(await pending());
    db.rows.mcpPolicy.find((p) => p.organizationId === "org-a")!.enabled = false;
    const out = await post(allow(f));
    expect(out.kind === "redirect" && new URL(out.to).searchParams.get("error")).toBe("access_denied");
    expect(db.rows.oAuthGrant ?? []).toEqual([]);
  });
});

describe("review of step 1", () => {
  it("sends a hold on the session's own workspace to its hold page at the decision too, leaving the request", async () => {
    const f = await form(await pending());
    db.rows.organization[0].settings = { security: { mfaRequired: "everyone" } };
    expect(await post(allow(f))).toEqual({ kind: "redirect", to: "/account/security?enrol=mfa" });
    expect(db.rows.oAuthAuthorizationRequest).toHaveLength(1);
    expect(db.rows.oAuthGrant ?? []).toEqual([]);
  });

  it("counts the cap per workspace: at 20 live grants only a workspace where this app is connected is offered", async () => {
    const token = await pending();
    const later = new Date(Date.now() + 86_400_000);
    for (let i = 0; i < 19; i++) {
      seed(db, "oAuthGrant", { id: `g-${i}`, clientId: `wkc_${String(i).padStart(32, "x")}`, organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "x", redirectHost: "x", familyId: `f-${i}`, tokenVersion: 3, authorizedAt: new Date(), endsBy: later });
    }
    // This app is already connected in Beta: the twentieth live grant.
    seed(db, "oAuthGrant", { id: "g-this", clientId: PUBLIC_ID, organizationId: "org-b", userId: "u-max", scopes: ["mcp:read"], appName: "x", redirectHost: "localhost", familyId: "f-this", tokenVersion: 3, authorizedAt: new Date(), endsBy: later });
    const f = await form(token);
    expect(f.workspaces.map((w) => w.id)).toEqual(["org-b"]);
    expect(f.selected).toBe("org-b");
    expect(f.unavailable).toBe(1);
    // Choosing Beta updates that grant in place; Acme would have been a twenty-first.
    const out = await post(allow(f, { workspace: "org-b" }));
    expect(out.kind === "redirect" && new URL(out.to).searchParams.get("code")).toBeTruthy();
    expect(db.rows.oAuthGrant).toHaveLength(20);
  });

  it("takes the request inside the consent, under the client's lock, and sends access_denied if the client is gone", async () => {
    const f = await form(await pending());
    db.raw.length = 0;
    expect((await post(allow(f))).kind).toBe("redirect");
    const locks = db.raw.filter((r) => r.includes("pg_advisory_xact_lock"));
    expect(locks.map((r) => r.split("[")[1]?.split(",")[0])).toEqual(["73050", "73051", "73052"]);

    // A client gone by the time the consent holds its lock (the sweep got there first): refused, never a throw, no grant.
    const g = await form(await pending());
    const row = db.rows.oAuthAuthorizationRequest.find((r) => r.csrfHash === hashSecret(g.csrf))!;
    db.rows.oAuthClient = db.rows.oAuthClient.filter((c) => c.id !== PUBLIC_ID);
    const before = db.rows.oAuthGrant.length;
    const r = await grantConsent({
      userId: "u-max", organizationId: "org-a", clientId: PUBLIC_ID, redirectUri: LOOPBACK, codeChallenge: CHALLENGE, resource: `${ORIGIN}/api/mcp`,
      scopes: ["mcp:read"], appName: "x", redirectHost: "localhost", sessionTokenVersion: 3, grantMaxDays: 30,
      take: { requestId: row.id as string, viewerId: "u-max", csrfHash: row.csrfHash as string },
    });
    expect(r).toEqual({ ok: false, reason: "unavailable" });
    expect(db.rows.oAuthGrant).toHaveLength(before);
    // And the decision, finding no client, refuses rather than throwing.
    expect(await post(allow(g))).toMatchObject({ kind: "refuse", status: 403 });
  });

  it("takes the request once even when Allow is sent twice at the same moment", async () => {
    const f = await form(await pending());
    const [a, b] = await Promise.all([post(allow(f)), post(allow(f))]);
    expect([a.kind, b.kind].sort()).toEqual(["redirect", "refuse"]);
    expect(db.rows.oAuthAuthorizationCode).toHaveLength(1);
  });
});

describe("Deny", () => {
  it("answers access_denied with state and iss, takes the request, and makes no grant", async () => {
    const f = await form(await pending());
    const out = await post({ ...allow(f), action: "deny" });
    expect(out.kind).toBe("redirect");
    if (out.kind !== "redirect") return;
    const to = new URL(out.to);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("st-9");
    expect(to.searchParams.get("iss")).toBe(ORIGIN);
    expect(to.searchParams.get("code")).toBeNull();
    expect(db.rows.oAuthGrant ?? []).toEqual([]);
    expect(db.rows.oAuthAuthorizationRequest).toEqual([]);
  });
});

describe("the consent page", () => {
  it("shows the label, where it goes, the workspaces and the access asked, bound to the viewer", async () => {
    const token = await pending();
    const f = await form(token);
    expect(f).toMatchObject({ label: "an app on this computer", email: "max@acme.test", target: "an app on this computer", selected: "org-a", writeAsked: true, unavailable: 0 });
    expect(f.workspaces.map((w) => w.name)).toEqual(["Acme", "Beta"]);
    const row = db.rows.oAuthAuthorizationRequest[0];
    expect(row.viewerId).toBe("u-max");
    expect(row.csrfHash).toBe(hashSecret(f.csrf));
  });

  it("sends a signed-out visitor to /login with the request, and names an expired request", async () => {
    const token = await pending();
    st.session = null;
    expect(await view(token)).toEqual({ kind: "redirect", to: `/login?callbackUrl=${encodeURIComponent(`/oauth/consent?request=${token}`)}` });
    db.rows.oAuthAuthorizationRequest[0].expiresAt = new Date(Date.now() - 1);
    expect(await view(token)).toEqual({ kind: "error", error: "expired" });
    expect(await view(null, "refused")).toEqual({ kind: "error", error: "refused" });
  });

  it("sends a held own workspace to the hold page", async () => {
    const token = await pending();
    db.rows.organization[0].settings = { security: { mfaRequired: "everyone" } };
    expect(await view(token)).toEqual({ kind: "redirect", to: "/account/security?enrol=mfa" });
  });

  it("names 20 live grants, and offers Cancel when no workspace can connect", async () => {
    const token = await pending();
    for (let i = 0; i < 20; i++) {
      seed(db, "oAuthGrant", { id: `g-${i}`, clientId: `wkc_${String(i).padStart(32, "x")}`, organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "x", redirectHost: "x", familyId: `f-${i}`, tokenVersion: 3, authorizedAt: new Date(), endsBy: new Date(Date.now() + 86_400_000) });
    }
    expect(await view(token)).toEqual({ kind: "error", error: "tooManyApps" });
    db.rows.oAuthGrant[0].tokenVersion = 2; // no longer live: not counted
    const v = await view(token);
    expect(v.kind).toBe("form");

    for (const p of db.rows.mcpPolicy) p.enabled = false;
    const none = await view(token);
    expect(none.kind).toBe("noWorkspace");
    if (none.kind === "noWorkspace") expect(new URL(none.cancelHref).searchParams.get("error")).toBe("access_denied");
  });
});

// Final review of the MCP server, security M1 (double-click hijacking): a
// click that lands on Allow before the person has seen the page, or a post
// with no script, carries no armed field. Fails on fcca4075: such an Allow
// made a grant and sent the app its code.
describe("an Allow the page's guard did not arm", () => {
  // People of their own: the decision allows 20 a minute per person, and this file's other suites spend Max's.
  const asNew = (id: string) => {
    seed(db, "user", memberRow({ id, email: `${id}@acme.test`, organizationId: "org-a", tokenVersion: 3 }));
    st.session = sessionOf(id, "org-a", `${id}@acme.test`, 3);
  };

  it("makes no grant and takes nothing: back to the consent page, the request still pending, and Deny still works", async () => {
    asNew("u-ivy");
    const f = await form(await pending());
    const bare = unarmed(f);
    for (const fields of [bare, { ...bare, armed: "0" }, { ...bare, armed: "" }]) {
      const out = await post(fields);
      expect(out, JSON.stringify(fields)).toEqual({ kind: "redirect", to: `/oauth/consent?request=${encodeURIComponent(f.request)}` });
    }
    expect(db.rows.oAuthGrant ?? []).toEqual([]);
    expect(db.rows.oAuthAuthorizationCode ?? []).toEqual([]);
    expect(db.rows.oAuthAuthorizationRequest).toHaveLength(1);
    // Twice is refused as a repeated field, like any other.
    const twice = new URLSearchParams({ ...bare, armed: "1" });
    twice.append("armed", "1");
    expect(await decide(new Request(`${ORIGIN}/oauth/decision`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN }, body: twice.toString() }))).toMatchObject({ kind: "refuse", status: 400 });
    // Deny needs no arming.
    const denied = await post({ ...bare, action: "deny" });
    expect(denied.kind === "redirect" && new URL(denied.to).searchParams.get("error")).toBe("access_denied");
  });

  it("is answered at once once armed, from the form shown again", async () => {
    asNew("u-jon");
    const token = await pending();
    const f = await form(token);
    const bare = unarmed(f);
    await post(bare);
    const again = await form(token);
    const out = await post(allow(again));
    expect(out.kind === "redirect" ? new URL(out.to).searchParams.get("code") : out).toMatch(/^wkmcp_ac_/);
  });
});

// Final review of the MCP server, contract L5: claude.ai registers a new
// client on every connection, so each reconnect stacked a grant beside the
// old one: Connected apps listed the app twice, and each counted toward the
// cap of 20. Fails on fcca4075: the older grant stayed live.
describe("connecting the same https app again through a new client", () => {
  const consent = (clientId: string, o: { redirectUri?: string; redirectHost?: string; organizationId?: string; appName?: string } = {}) =>
    grantConsent({
      userId: "u-max", organizationId: o.organizationId ?? "org-a", clientId, redirectUri: o.redirectUri ?? CLAUDE_REDIRECT, codeChallenge: CHALLENGE, resource: `${ORIGIN}/api/mcp`,
      scopes: ["mcp:read", "mcp:write"], appName: o.appName ?? "Claude", redirectHost: o.redirectHost ?? "claude.ai", sessionTokenVersion: 3, grantMaxDays: 30,
    });
  const live = () => (db.rows.oAuthGrant ?? []).filter((g) => g.revokedAt === null);

  it("ends the older grant in that workspace, as the person's own, so one row stays per app", async () => {
    const first = await consent(CONF_ID);
    const second = await consent(POST_ID);
    if (!first.ok || !second.ok) throw new Error("no grant");
    expect(second).toMatchObject({ again: true, replaced: 1 });
    expect(live().map((g) => g.id)).toEqual([second.grantId]);
    expect(db.rows.oAuthGrant.find((g) => g.id === first.grantId)).toMatchObject({ revokedReason: "person", revokedById: "u-max" });
    // Its tokens end with it, and its audit row names the grant that took its place.
    const row = db.rows.activityLog.find((a) => a.type === "mcp.app.revoked" && a.targetId === first.grantId)!;
    expect(row).toMatchObject({ actorId: "u-max", actingForId: "u-max" });
    expect(row.metadata).toMatchObject({ reason: "person", replacedBy: second.grantId, redirectHost: "claude.ai" });
  });

  it("never for loopback or an app scheme, which different apps share, nor across workspaces", async () => {
    await consent(PUBLIC_ID, { redirectUri: LOOPBACK, redirectHost: "localhost", appName: "an app on this computer" });
    await consent(NO_REFRESH_ID, { redirectUri: LOOPBACK, redirectHost: "localhost", appName: "Once" });
    expect(live()).toHaveLength(2);
    await consent(CONF_ID, { redirectHost: "cursor:", appName: "Cursor" });
    await consent(POST_ID, { redirectHost: "cursor:", appName: "Cursor" });
    expect(live()).toHaveLength(4);
    const b = await consent(CONF_ID, { organizationId: "org-b" });
    expect(b).toMatchObject({ ok: true, replaced: 0 });
    expect(live()).toHaveLength(5);
  });

  it("does not count the grant it replaces toward the cap of 20", async () => {
    const later = new Date(Date.now() + 86_400_000);
    for (let i = 0; i < 19; i++) {
      seed(db, "oAuthGrant", { id: `g-${i}`, clientId: `wkc_${String(i).padStart(32, "x")}`, organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "x", redirectHost: `h${i}.example`, familyId: `f-${i}`, tokenVersion: 3, authorizedAt: new Date(), endsBy: later });
    }
    const first = await consent(CONF_ID);
    expect(live()).toHaveLength(20);
    const second = await consent(POST_ID);
    expect(second).toMatchObject({ ok: true, replaced: 1 });
    expect(live()).toHaveLength(20);
    if (first.ok) expect(db.rows.oAuthGrant.find((g) => g.id === first.grantId)?.revokedReason).toBe("person");
  });
});
