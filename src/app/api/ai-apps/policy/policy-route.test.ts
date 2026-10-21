// The AI apps switch and its allow list (docs/plans/mcp-server.md 6.3, 3.9,
// step 2 tests "the policy route: the gates, workspace_changed, off
// revokes, on refused while AI is off, list changes"). Fails on the code
// before step 2: there was no /api/ai-apps/policy.

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-olivia", organizationId: "org-a", orgRole: "OWNER" } as { userId: string; organizationId: string; orgRole: string },
  fresh: { ok: true, admin: true, owner: true } as unknown,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/oauth/oauth-test-db")).testDb.prisma }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: st.viewer.userId, organizationId: st.viewer.organizationId } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: vi.fn(async () => st.fresh) }));
vi.mock("@/lib/app-gate", () => ({
  requireManageApps: vi.fn(async () =>
    st.viewer.orgRole === "OWNER" || st.viewer.orgRole === "ADMIN" ? { viewer: st.viewer } : { error: NextResponse.json({ error: "no_access", page: "apps" }, { status: 403 }) },
  ),
}));

import { seed, seedWorld, testDb as db, useMcpEnv } from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import { GET, PUT } from "./route";

const saved = { ...process.env };
const put = (body: Record<string, unknown>, org: string | null = "org-a") =>
  PUT(new Request("https://app.workwrk.com/api/ai-apps/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(org ? { organizationId: org } : {}), ...body }) }));
const policy = (org = "org-a") => db.rows.mcpPolicy.find((p) => p.organizationId === org);
const grant = (id: string) => db.rows.oAuthGrant.find((g) => g.id === id)!;
const changes = () => (db.rows.activityLog ?? []).filter((a) => a.type === "apps.mcp_changed");

function seedGrant(id: string, o: Record<string, unknown> = {}) {
  seed(db, "oAuthGrant", {
    id, clientId: "wkc_x", organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "an app on this computer", redirectHost: "localhost",
    familyId: `fam-${id}`, tokenVersion: 3, authorizedAt: new Date(Date.now() - 60_000), endsBy: new Date(Date.now() + 86_400_000), ...o,
  });
}

beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  st.viewer = { userId: "u-olivia", organizationId: "org-a", orgRole: "OWNER" };
  st.fresh = { ok: true, admin: true, owner: true };
  seed(db, "user", { id: "u-mia", email: "mia@acme.test", organizationId: "org-a", tokenVersion: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("the gates", () => {
  it("is a 404 while MCP_OFFERED is unset", async () => {
    delete process.env.MCP_OFFERED;
    expect((await GET()).status).toBe(404);
    expect((await put({ enabled: false })).status).toBe(404);
  });

  it("answers a Member with the Apps page's own refusal, and changes nothing", async () => {
    st.viewer = { ...st.viewer, userId: "u-max", orgRole: "MEMBER" };
    expect((await GET()).status).toBe(403);
    expect((await put({ enabled: false })).status).toBe(403);
    expect(policy()?.enabled).toBe(true);
  });

  it("refuses an Admin the database no longer holds as one", async () => {
    st.fresh = { ok: false, status: 403, error: "Your access changed a moment ago.", code: "stale_session" };
    const r = await put({ enabled: false });
    expect([r.status, (await r.json()).code]).toEqual([403, "stale_session"]);
    st.fresh = { ok: true, admin: false, owner: false };
    expect((await put({ enabled: false })).status).toBe(403);
    expect(policy()?.enabled).toBe(true);
  });

  it("answers another workspace, or none named, with workspace_changed, and a body with both or neither switch 400", async () => {
    for (const org of ["org-b", null]) {
      const r = await put({ enabled: false }, org);
      expect([r.status, (await r.json()).code]).toEqual([409, "workspace_changed"]);
    }
    expect((await put({ enabled: false, allowedApps: [] })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ enabled: false, extra: 1 })).status).toBe(400);
    expect(policy()?.enabled).toBe(true);
    expect(changes()).toEqual([]);
  });
});

describe("the switch", () => {
  it("shows the switch, the list and the live counts only", async () => {
    seedGrant("g1");
    seedGrant("g2", { userId: "u-mia", tokenVersion: 0 });
    seedGrant("g3", { tokenVersion: 2 }); // left behind by a bump: not live
    seedGrant("g4", { revokedAt: new Date(), revokedReason: "person" });
    const body = await (await GET()).json();
    expect(body).toMatchObject({ enabled: true, allowedApps: [], allowedAppsMax: 50, aiOff: false, workspaceOpen: true, connections: 2, people: 2, today: { calls: 0, changes: 0 } });
    expect(JSON.stringify(body)).not.toContain("u-max");
  });

  it("turning off disconnects every AI app in the workspace at once, under the policy lock alone, with one audit row", async () => {
    seedGrant("g1");
    seedGrant("g2", { userId: "u-mia", tokenVersion: 0 });
    seedGrant("g-b", { organizationId: "org-b" });
    db.raw.length = 0;
    const r = await put({ enabled: false });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: false, revoked: 2, connections: 0 });
    expect([grant("g1").revokedReason, grant("g2").revokedReason, grant("g1").revokedById]).toEqual(["admin_off", "admin_off", "u-olivia"]);
    expect(grant("g-b").revokedAt).toBeNull();
    expect(db.raw).toContain("SELECT pg_advisory_xact_lock(?::int, hashtext(?)) [73051, org-a]");
    expect(db.raw.some((s) => s.includes("lock_shared"))).toBe(false);
    expect(changes()).toEqual([
      expect.objectContaining({ actorId: "u-olivia", description: "Turned off AI apps (MCP)", oldValue: { enabled: true, allowedApps: [] }, newValue: { enabled: false, allowedApps: [] }, metadata: { revoked: 2 }, severity: "info" }),
    ]);
    expect((db.rows.activityLog ?? []).filter((a) => a.type === "mcp.app.revoked")).toHaveLength(2);
  });

  it("turning on is refused while AI features are off or the workspace is closed, and otherwise audits a warning", async () => {
    policy()!.enabled = false;
    const org = db.rows.organization.find((o) => o.id === "org-a")!;
    org.settings = { data: { aiEnabled: false } };
    const off = await put({ enabled: true });
    expect([off.status, (await off.json()).code]).toEqual([409, "ai_off"]);
    org.settings = {};
    org.status = "SUSPENDED";
    const closed = await put({ enabled: true });
    expect([closed.status, (await closed.json()).code]).toEqual([409, "workspace_closed"]);
    expect(policy()!.enabled).toBe(false);
    org.status = "TRIAL";
    const on = await put({ enabled: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ enabled: true, revoked: 0 });
    expect(changes()).toEqual([expect.objectContaining({ description: "Turned on AI apps (MCP)", severity: "warning" })]);
  });

  it("makes the row when there is none, and writes no audit row for a change that changes nothing", async () => {
    db.rows.mcpPolicy = db.rows.mcpPolicy.filter((p) => p.organizationId !== "org-a");
    expect((await put({ enabled: false })).status).toBe(200);
    expect(policy()).toMatchObject({ enabled: false, allowedApps: [], updatedById: "u-olivia" });
    expect(changes()).toEqual([]);
  });
});

describe("the allowed apps", () => {
  it("stores the entries in their stored form, and disconnects only the apps the list leaves out", async () => {
    seedGrant("g-local");
    seedGrant("g-claude", { redirectHost: "claude.ai", userId: "u-mia", tokenVersion: 0 });
    const r = await put({ allowedApps: ["https://claude.ai/connect", "claude.ai", "  ", "*.cursor.sh"] });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ allowedApps: ["claude.ai", "*.cursor.sh"], revoked: 1 });
    expect(grant("g-local").revokedReason).toBe("app_not_allowed");
    expect(grant("g-claude").revokedAt).toBeNull();
    expect(changes()).toEqual([expect.objectContaining({ description: "Changed the allowed AI apps (MCP)", newValue: { enabled: true, allowedApps: ["claude.ai", "*.cursor.sh"] }, metadata: { revoked: 1 } })]);
    // An empty list allows every app again.
    expect(await (await put({ allowedApps: [] })).json()).toMatchObject({ allowedApps: [], revoked: 0 });
  });

  it("refuses an entry that names no app, and more than 50, changing nothing", async () => {
    const bad = await put({ allowedApps: ["claude.ai", "*.com"] });
    expect([bad.status, (await bad.json()).code]).toEqual([400, "invalid_app"]);
    const many = await put({ allowedApps: Array.from({ length: 51 }, (_, i) => `app${i}.example.com`) });
    expect([many.status, (await many.json()).code]).toEqual([400, "too_many_apps"]);
    expect(policy()!.allowedApps).toEqual([]);
  });
});
