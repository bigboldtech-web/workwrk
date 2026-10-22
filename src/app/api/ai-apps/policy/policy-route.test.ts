// The AI apps switch and its allow list (docs/plans/mcp-server.md 6.3, 3.9,
// step 2 tests "the policy route: the gates, workspace_changed, off
// revokes, on refused while AI is off, list changes", and the step 2
// review's lows: GET re-reads the actor, the revocations run on the policy
// lock's own transaction with their audit rows after the commit, and a
// request for what already is writes and revokes nothing).
//
// The store is wrapped so the test sees, for every write, whether it went
// through the transaction's client or the app's, and whether a transaction
// was open.

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-olivia", organizationId: "org-a", orgRole: "OWNER" } as { userId: string; organizationId: string; orgRole: string },
  fresh: { ok: true, admin: true, owner: true } as unknown,
  /** "via:open:model.op" for every write: via is tx or app, open whether a transaction was running. */
  writes: [] as string[],
}));

vi.mock("@/lib/prisma", async () => {
  const { testDb } = await import("@/lib/oauth/oauth-test-db");
  const base = testDb.prisma as Record<string, unknown>;
  let open = 0;
  const WRITES = new Set(["create", "update", "updateMany", "upsert", "deleteMany"]);
  const wrap = (via: "tx" | "app"): Record<string, unknown> =>
    new Proxy({}, {
      get: (_t, key: string) => {
        if (key === "$transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) =>
            (base.$transaction as (f: (tx: unknown) => Promise<unknown>) => Promise<unknown>)(async () => {
              open += 1;
              try {
                return await fn(wrap("tx"));
              } finally {
                open -= 1;
              }
            });
        }
        const m = base[key];
        if (!m || typeof m !== "object") return m;
        return new Proxy(m as Record<string, unknown>, {
          get: (model, op: string) => {
            const f = model[op];
            if (typeof f !== "function") return f;
            return (...a: unknown[]) => {
              if (WRITES.has(op)) st.writes.push(`${via}:${open}:${key}.${op}`);
              return (f as (...x: unknown[]) => unknown)(...a);
            };
          },
        });
      },
    });
  return { prisma: wrap("app") };
});
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
  st.writes = [];
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

  it("refuses an Admin the database no longer holds as one, reading as well as changing", async () => {
    st.fresh = { ok: false, status: 403, error: "Your access changed a moment ago.", code: "stale_session" };
    const r = await put({ enabled: false });
    expect([r.status, (await r.json()).code]).toEqual([403, "stale_session"]);
    const g = await GET();
    expect([g.status, (await g.json()).code]).toEqual([403, "stale_session"]);
    st.fresh = { ok: true, admin: false, owner: false };
    expect((await put({ enabled: false })).status).toBe(403);
    expect((await GET()).status).toBe(403);
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

  it("names the workspace it was read in, for the section to send back with every change (step 4)", async () => {
    // Before step 4 neither answer named it, so the section had nothing to send but the session's guess.
    expect((await (await GET()).json()).organizationId).toBe("org-a");
    expect((await (await put({ enabled: false })).json()).organizationId).toBe("org-a");
    expect((await (await put({ allowedApps: ["claude.ai"] })).json()).organizationId).toBe("org-a");
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
    // Every grant and token write went through the lock's own transaction; the audit rows followed its commit.
    const revokes = st.writes.filter((w) => /oAuth(Grant|Token)\./.test(w));
    expect(revokes.length).toBeGreaterThan(0);
    expect(revokes.every((w) => w.startsWith("tx:1:"))).toBe(true);
    expect(st.writes.filter((w) => w.includes("activityLog.")).every((w) => w.startsWith("app:0:"))).toBe(true);
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

  it("writes nothing, revokes nothing and audits nothing for a request for what already is", async () => {
    seedGrant("g1");
    const before = { ...policy()! };
    st.writes = [];
    const again = await put({ enabled: true });
    expect(await again.json()).toMatchObject({ enabled: true, revoked: 0 });
    expect(await (await put({ allowedApps: [] })).json()).toMatchObject({ allowedApps: [], revoked: 0 });
    expect(policy()).toEqual(before);
    expect(grant("g1").revokedAt).toBeNull();
    expect(st.writes).toEqual([]);
    expect(changes()).toEqual([]);
    // Off with no row is off already: still nothing written.
    db.rows.mcpPolicy = db.rows.mcpPolicy.filter((p) => p.organizationId !== "org-a");
    expect((await put({ enabled: false })).status).toBe(200);
    expect(policy()).toBeUndefined();
    expect(st.writes).toEqual([]);
  });

  it("makes the row when there is none and the switch goes on", async () => {
    db.rows.mcpPolicy = db.rows.mcpPolicy.filter((p) => p.organizationId !== "org-a");
    expect(await (await put({ enabled: true })).json()).toMatchObject({ enabled: true, revoked: 0 });
    expect(policy()).toMatchObject({ enabled: true, allowedApps: [], updatedById: "u-olivia" });
    expect(changes()).toHaveLength(1);
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
