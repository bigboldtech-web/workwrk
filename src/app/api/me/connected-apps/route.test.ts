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

import { CONF_ID, PUBLIC_ID, seed, seedConnection, seedWorld, testDb as db, useMcpEnv } from "@/lib/oauth/oauth-test-db";
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
