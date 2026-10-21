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
import { CHALLENGE, LOOPBACK, ORIGIN, PUBLIC_ID, memberRow, seed, seedWorld, sessionOf, testDb as db, useMcpEnv } from "./oauth-test-db";
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

const allow = (f: Extract<ConsentView, { kind: "form" }>, o: Record<string, string> = {}) =>
  ({ request: f.request, csrf: f.csrf, action: "allow", workspace: f.selected, access: "write", ...o });

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
