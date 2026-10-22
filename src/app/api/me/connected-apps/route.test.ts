// My settings, Calendar & connections, AI apps (docs/plans/mcp-server.md
// 6.2, 3.9, 5.3; step 4 tests "Connected apps: own live grants only;
// another's id 404; a stale grant hidden and revoked"). Fails on the code
// before step 4: none of the three routes existed.
//
//   GET    /api/me/connected-apps                the person's live grants
//   GET    /api/me/connected-apps/[id]/activity  "Show changes"
//   DELETE /api/me/connected-apps/[id]           Disconnect

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ userId: "u-max" as string | null, aiOff: new Set<string>() }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("next-auth", () => ({ getServerSession: async () => (st.userId ? { user: { id: st.userId } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("@/lib/oauth/oauth-test-db");
  return {
    resolveActingPerson: async (organizationId: string, userId: string) =>
      st.aiOff.has(organizationId) ? { ok: false, reason: "ai_off" } : { ok: true, person: actingAs(organizationId, userId) },
  };
});

import { CHALLENGE, CONF_ID, LOOPBACK, PUBLIC_ID, seed, seedConnection, seedWorld, testDb as db, useMcpEnv } from "@/lib/oauth/oauth-test-db";
import { grantConsent, revokeAllGrantsOf, signOutBump } from "@/lib/oauth/grants";
import { hashSecret } from "@/lib/oauth/tokens";
import { GET as list } from "./route";
import { DELETE as disconnect } from "./[id]/route";
import { GET as activity } from "./[id]/activity/route";
import { GET as security } from "../security-activity/route";

const saved = { ...process.env };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (path: string, method = "GET") => new Request(`https://app.workwrk.com${path}`, { method });
const grant = (id: string) => db.rows.oAuthGrant.find((g) => g.id === id)!;
const audits = (type: string) => (db.rows.activityLog ?? []).filter((a) => a.type === type);

async function apps(): Promise<Array<Record<string, unknown>>> {
  const r = await list();
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  return (await r.json()).apps;
}

function seedGrant(id: string, o: Record<string, unknown> = {}) {
  seed(db, "oAuthGrant", {
    id, clientId: CONF_ID, organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "claude.ai", redirectHost: "claude.ai",
    familyId: `fam-${id}`, tokenVersion: 3, authorizedAt: new Date(Date.now() - 3_600_000), endsBy: new Date(Date.now() + 86_400_000), ...o,
  });
}

function seedChange(id: string, grantId: string, o: Record<string, unknown> = {}) {
  seed(db, "activityLog", {
    id, type: "mcp.tool.create_task", actorId: "u-max", actingForId: "u-max", actorType: "mcp", actorLabel: "an app on this computer (MCP)",
    organizationId: "org-a", description: "Created a task through an AI app (MCP)", targetType: "item", targetId: `it-${id}`, severity: "info",
    metadata: { tool: "create_task", grantId, clientId: PUBLIC_ID, redirectHost: "localhost" }, createdAt: new Date(), ...o,
  });
}

type Op = (args: Record<string, unknown>) => Promise<unknown>;
const restores: Array<() => void> = [];

/**
 * Wraps one model method of the shared store until the test ends: `around`
 * gets each call's arguments and the real method, so a test can make
 * something happen in between a read and the write after it, the way a
 * request in another browser would.
 */
function wrap(model: string, op: string, around: (args: Record<string, unknown>, real: Op) => Promise<unknown>): void {
  const m = (db.prisma as unknown as Record<string, Record<string, Op>>)[model];
  const real = m[op];
  m[op] = (args) => around(args, real);
  restores.push(() => { m[op] = real; });
}

/** Once: `then` runs just before the check reads the account (grantStanding's read, the only one that selects passwordChangedAt). */
function beforeTheCheck(then: () => Promise<unknown>): void {
  let done = false;
  wrap("user", "findUnique", async (args, real) => {
    if (!done && (args.select as Record<string, unknown> | undefined)?.passwordChangedAt === true) {
      done = true;
      await then();
    }
    return real(args);
  });
}

/** Max reconnecting the loopback app in Acme from his session at tokenVersion 3 (the consent page's Allow). */
const reconnect = () =>
  grantConsent({
    userId: "u-max", organizationId: "org-a", clientId: PUBLIC_ID, redirectUri: LOOPBACK, codeChallenge: CHALLENGE, resource: "https://app.workwrk.com/api/mcp",
    scopes: ["mcp:read", "mcp:write"], appName: "an app on this computer", redirectHost: "localhost", sessionTokenVersion: 3, sessionMaxDays: 30,
  });

beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  st.userId = "u-max";
  st.aiOff.clear();
  // Max's live connection in Acme (gr-1, read and change, through the loopback client), with a token.
  seedConnection(db, hashSecret);
  seed(db, "user", { id: "u-mia", email: "mia@acme.test", firstName: "Mia", lastName: "Manager", organizationId: "org-a", tokenVersion: 0 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
});

describe("GET /api/me/connected-apps", () => {
  it("lists the person's own live grants only, in every workspace, each with its workspace, access and dates", async () => {
    seedGrant("gr-beta", { organizationId: "org-b", authorizedAt: new Date(Date.now() - 1000) });
    seedGrant("gr-mia", { userId: "u-mia", tokenVersion: 0 });
    seedGrant("gr-gone", { revokedAt: new Date(), revokedReason: "person" });
    const got = await apps();
    expect(got.map((a) => a.id)).toEqual(["gr-beta", "gr-1"]);
    expect(got[1]).toMatchObject({ app: "an app on this computer", workspace: { id: "org-a", name: "Acme" }, access: "write", lastUsedAt: null, changes: 0, blocked: null });
    expect(got[0]).toMatchObject({ app: "claude.ai", workspace: { id: "org-b", name: "Beta" }, access: "read" });
    expect(typeof got[1].connectedAt).toBe("string");
    // Nothing of the grant's machinery, never a hash, never another person.
    const text = JSON.stringify(got);
    for (const leak of ["fam-", "tokenVersion", "clientId", "redirectHost", "u-mia", "gr-mia", "gr-gone", hashSecret(`wkmcp_at_${"T".repeat(43)}`)]) expect(text).not.toContain(leak);
  });

  it("hides and revokes a grant that no longer stands: left behind by a bump, past its end, or where the switch went off", async () => {
    seedGrant("gr-stale", { tokenVersion: 2 });
    seedGrant("gr-old", { endsBy: new Date(Date.now() - 1000) });
    seedGrant("gr-off", { organizationId: "org-b" });
    db.rows.mcpPolicy.find((p) => p.organizationId === "org-b")!.enabled = false;
    seed(db, "oAuthToken", { id: "tok-stale", grantId: "gr-stale", kind: "access", familyId: "fam-gr-stale", scopes: ["mcp:read"], resource: "https://app.workwrk.com/api/mcp", expiresAt: new Date(Date.now() + 3_600_000) });
    expect((await apps()).map((a) => a.id)).toEqual(["gr-1"]);
    expect([grant("gr-stale").revokedReason, grant("gr-old").revokedReason, grant("gr-off").revokedReason]).toEqual(["sessions_ended", "expired", "admin_off"]);
    expect(db.rows.oAuthToken.find((t) => t.id === "tok-stale")!.revokedAt).toBeInstanceOf(Date);
    expect(audits("mcp.app.revoked").map((a) => a.targetId).sort()).toEqual(["gr-off", "gr-old", "gr-stale"]);
    // Read again: nothing more ended, nothing more written.
    expect((await apps()).map((a) => a.id)).toEqual(["gr-1"]);
    expect(audits("mcp.app.revoked")).toHaveLength(3);
  });

  // Review of step 4, M2: the list read every grant first, then judged each against the account read after it,
  // and revoked by id alone, so a log out in another browser (which carries the grant's tokenVersion along with the
  // account's) or a reconnect (which renews the grant) landing in between read as an ended connection and was
  // revoked as one. Each grant is now read just before its check, and a revocation lands only on the row as it
  // was judged. The first two fail on eb8a880b.
  it("revokes nothing when a log out in another browser lands between the grant's read and its check", async () => {
    beforeTheCheck(() => signOutBump("u-max"));
    expect((await apps()).map((a) => a.id)).toEqual(["gr-1"]);
    expect(grant("gr-1")).toMatchObject({ revokedAt: null, revokedReason: null, tokenVersion: 4 });
    expect(db.rows.oAuthToken.filter((t) => t.grantId === "gr-1").every((t) => t.revokedAt === null)).toBe(true);
    expect(audits("mcp.app.revoked")).toEqual([]);
  });

  it("revokes nothing when a reconnect renews the grant between its read and its check", async () => {
    // Left behind by a real bump (it holds 2, the account 3), and renewed by Allow while the list judges it.
    grant("gr-1").tokenVersion = 2;
    beforeTheCheck(reconnect);
    const got = await apps();
    expect(got.map((a) => a.id)).toEqual(["gr-1"]);
    expect(grant("gr-1")).toMatchObject({ revokedAt: null, tokenVersion: 3 });
    expect(grant("gr-1").familyId).not.toBe("fam-1");
    // Listed as renewed: its new consent time.
    expect(got[0].connectedAt).toBe((grant("gr-1").authorizedAt as Date).toISOString());
    expect(audits("mcp.app.revoked")).toEqual([]);
    expect(audits("mcp.app.connected")).toEqual([expect.objectContaining({ targetId: "gr-1", metadata: expect.objectContaining({ again: true }) })]);
  });

  it("still revokes a real tokenVersion gap as sessions_ended, even with a log out in between (a guard)", async () => {
    // The log out carries only grants at the account's version; this one was left behind before it.
    grant("gr-1").tokenVersion = 2;
    beforeTheCheck(() => signOutBump("u-max"));
    expect(await apps()).toEqual([]);
    expect(grant("gr-1")).toMatchObject({ revokedReason: "sessions_ended", tokenVersion: 2 });
    expect(audits("mcp.app.revoked")).toHaveLength(1);
  });

  it("keeps a grant AI off only blocks, saying so, and revokes nothing", async () => {
    st.aiOff.add("org-a");
    expect(await apps()).toEqual([expect.objectContaining({ id: "gr-1", blocked: "ai_off" })]);
    expect(grant("gr-1").revokedAt).toBeNull();
  });

  it("counts its changes from its own audit rows, and gives the address to connect to", async () => {
    seedChange("c1", "gr-1");
    seedChange("c2", "gr-1", { type: "mcp.tool.add_comment" });
    seedChange("c-other", "gr-x");
    seedChange("c-mia", "gr-1", { actorId: "u-mia" });
    seedChange("c-person", "gr-1", { actorType: "user" });
    const r = await list();
    const body = await r.json();
    expect(body.apps[0].changes).toBe(2);
    expect(body.address).toBe("https://app.workwrk.com/api/mcp");
    expect(body.docsUrl).toBeNull();
  });

  it("answers 401 without a session, and 404 while MCP_OFFERED is unset", async () => {
    st.userId = null;
    expect((await list()).status).toBe(401);
    delete process.env.MCP_OFFERED;
    st.userId = "u-max";
    expect((await list()).status).toBe(404);
    expect((await disconnect(req("/api/me/connected-apps/gr-1", "DELETE"), ctx("gr-1"))).status).toBe(404);
    expect((await activity(req("/api/me/connected-apps/gr-1/activity"), ctx("gr-1"))).status).toBe(404);
    expect(grant("gr-1").revokedAt).toBeNull();
  });
});

describe("DELETE /api/me/connected-apps/[id]", () => {
  it("disconnects the person's own app at once: the grant, its tokens, one audit row, and a line in their security activity", async () => {
    const r = await disconnect(req("/api/me/connected-apps/gr-1", "DELETE"), ctx("gr-1"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ disconnected: true });
    expect(grant("gr-1")).toMatchObject({ revokedReason: "person", revokedById: "u-max" });
    expect(db.rows.oAuthToken.filter((t) => t.grantId === "gr-1").every((t) => t.revokedAt instanceof Date)).toBe(true);
    expect(audits("mcp.app.revoked")).toEqual([expect.objectContaining({ actorId: "u-max", actingForId: "u-max", targetType: "oauth_grant", targetId: "gr-1", metadata: expect.objectContaining({ reason: "person" }) })]);
    expect(await apps()).toEqual([]);
    const events = (await (await security()).json()).events;
    expect(events.map((e: { description: string }) => e.description)).toContain("Disconnected an app on this computer (MCP)");
    // Again: already ended, so not found, and nothing more written.
    expect((await disconnect(req("/api/me/connected-apps/gr-1", "DELETE"), ctx("gr-1"))).status).toBe(404);
    expect(audits("mcp.app.revoked")).toHaveLength(1);
  });

  // Review of step 4, L1: Disconnect took no lock and revoked a grant it had read outside any transaction. It now
  // reads the grant again and revokes it with its tokens under the person's lock (73_050, consent's and the log
  // out's), in one transaction, and writes its one audit row (which the security activity lists) after the
  // commit. Fails on eb8a880b: no lock, no transaction.
  it("disconnects under the person's lock, the grant and its tokens in one transaction, and one audit row after it", async () => {
    const seen: string[] = [];
    for (const [model, op] of [["oAuthGrant", "updateMany"], ["oAuthToken", "updateMany"], ["activityLog", "create"]] as const) {
      wrap(model, op, async (args, real) => {
        seen.push(`${db.inTx}:${model}.${op}`);
        return real(args);
      });
    }
    db.raw.length = 0;
    expect((await disconnect(req("/api/me/connected-apps/gr-1", "DELETE"), ctx("gr-1"))).status).toBe(200);
    expect(db.raw).toEqual(["SELECT pg_advisory_xact_lock(?::int, hashtext(?)) [73050, u-max]"]);
    expect(seen).toEqual(["1:oAuthGrant.updateMany", "1:oAuthToken.updateMany", "0:activityLog.create"]);
    expect(audits("mcp.app.revoked")).toHaveLength(1);
    expect(grant("gr-1")).toMatchObject({ revokedReason: "person", revokedById: "u-max" });
  });

  // L1: a consent renewed the grant it found with an update by id alone, so a revocation landing between its read
  // and its write (one that takes no person lock: Log out everywhere's, a leaver's, a standing check's) left a
  // renewed but revoked row, told the person it was connected again, and its code could never be exchanged. Now
  // the renewal is a swap on revokedAt null, and a lost swap makes a new connection. Fails on eb8a880b.
  it("makes a new connection when the grant a reconnect found is revoked before it renews it, and says so once", async () => {
    let done = false;
    wrap("oAuthGrant", "findFirst", async (args, real) => {
      const found = await real(args);
      if (!done && found && (args.where as Record<string, unknown>).clientId === PUBLIC_ID) {
        done = true;
        await revokeAllGrantsOf("u-max", "sessions_ended", "u-max");
      }
      return found;
    });
    const r = await reconnect();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.again).toBe(false);
    expect(r.grantId).not.toBe("gr-1");
    // The ended one stays ended, as it was ended: never renewed.
    expect(grant("gr-1")).toMatchObject({ revokedReason: "sessions_ended", familyId: "fam-1" });
    expect(grant(r.grantId)).toMatchObject({ revokedAt: null, tokenVersion: 3, userId: "u-max", organizationId: "org-a" });
    expect(db.rows.oAuthAuthorizationCode.map((c) => c.grantId)).toEqual([r.grantId]);
    // One connected row and one notice, both for the connection that was made.
    expect(audits("mcp.app.connected")).toEqual([expect.objectContaining({ targetId: r.grantId, metadata: expect.objectContaining({ again: false }) })]);
    expect((db.rows.notification ?? []).filter((n) => n.type === "mcp_app")).toHaveLength(1);
    expect((await apps()).map((a) => a.id)).toEqual([r.grantId]);
  });

  it("in the other order, a Disconnect after a reconnect ends the renewed grant, and a reconnect after a Disconnect makes a new one (a guard)", async () => {
    const first = await reconnect();
    expect(first).toMatchObject({ ok: true, grantId: "gr-1", again: true });
    expect((await disconnect(req("/api/me/connected-apps/gr-1", "DELETE"), ctx("gr-1"))).status).toBe(200);
    expect(grant("gr-1")).toMatchObject({ revokedReason: "person" });
    const second = await reconnect();
    expect(second).toMatchObject({ ok: true, again: false });
    if (!second.ok) return;
    expect(second.grantId).not.toBe("gr-1");
    expect(grant("gr-1").revokedReason).toBe("person");
    expect(audits("mcp.app.revoked")).toHaveLength(1);
    expect((await apps()).map((a) => a.id)).toEqual([second.grantId]);
  });

  it("answers 404 for another person's id, changing nothing", async () => {
    seedGrant("gr-mia", { userId: "u-mia", tokenVersion: 0 });
    const r = await disconnect(req("/api/me/connected-apps/gr-mia", "DELETE"), ctx("gr-mia"));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe("not_found");
    expect(grant("gr-mia").revokedAt).toBeNull();
    expect((await disconnect(req("/api/me/connected-apps/nope", "DELETE"), ctx("nope"))).status).toBe(404);
    expect(audits("mcp.app.revoked")).toEqual([]);
  });
});

describe("GET /api/me/connected-apps/[id]/activity", () => {
  it("lists its own changes newest first, with a link to the task or doc, never another's", async () => {
    seedChange("c1", "gr-1", { createdAt: new Date(Date.now() - 2000) });
    seedChange("c2", "gr-1", { type: "mcp.tool.create_doc", description: "Created a doc through an AI app (MCP)", targetType: "doc", targetId: "doc-1", createdAt: new Date(Date.now() - 1000) });
    seedChange("c3", "gr-1", { type: "mcp.tool.give_kudos", description: "Gave kudos through an AI app (MCP)", targetType: "kudos", targetId: "k-1", createdAt: new Date() });
    seedChange("c-other", "gr-x");
    seedChange("c-mia", "gr-1", { actorId: "u-mia" });
    const r = await activity(req("/api/me/connected-apps/gr-1/activity"), ctx("gr-1"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.more).toBe(false);
    expect(body.changes.map((c: { id: string }) => c.id)).toEqual(["c3", "c2", "c1"]);
    expect(body.changes[0]).toMatchObject({ tool: "give_kudos", description: "Gave kudos through an AI app (MCP)", href: null });
    expect(body.changes[1]).toMatchObject({ tool: "create_doc", href: "/work/docs/doc-1" });
    expect(body.changes[2]).toMatchObject({ tool: "create_task", href: "/item/it-c1" });
  });

  it("answers 404 for another person's connection", async () => {
    seedGrant("gr-mia", { userId: "u-mia", tokenVersion: 0 });
    seedChange("c-mia", "gr-mia", { actorId: "u-mia" });
    expect((await activity(req("/api/me/connected-apps/gr-mia/activity"), ctx("gr-mia"))).status).toBe(404);
  });
});
