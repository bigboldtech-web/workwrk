// POST /api/users/[id]/mfa-reset: the way back in for someone who lost their
// authenticator (launch audit, 2026-10-31). Owners and Admins only, an Admin
// never over an Admin or Owner, never the caller's own, only accounts
// anchored in this workspace, and the reset ends every session and AI app
// of the account, is logged and tells the person.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Target = ReturnType<typeof legacyLevelRow> & { id: string; email: string; firstName: string; lastName: string; mfaEnabled: boolean; organizationId: string; deletedAt: Date | null };

const st = vi.hoisted(() => ({
  session: { user: { id: "admin1", organizationId: "o1", name: "Ada Admin" } } as null | { user: Record<string, unknown> },
  fresh: { ok: true, level: "COMPANY_ADMIN", admin: true, owner: false } as Record<string, unknown>,
  users: [] as Target[],
  memberships: [] as Array<{ userId: string; organizationId: string }>,
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  revoked: [] as string[][],
  audits: [] as Array<Record<string, unknown>>,
  emails: [] as Array<Record<string, unknown>>,
  limited: false,
}));

vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/workspace-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/workspace-admin")>()),
  freshWorkspaceActor: async () => st.fresh,
  freshActorRefusal: (f: { status: number; error: string }) => Response.json({ error: f.error }, { status: f.status }),
}));
vi.mock("@/lib/oauth/grants", () => ({ revokeLeftBehind: async (o: { userIds: string[] }) => { st.revoked.push(o.userIds); return 0; } }));
vi.mock("@/lib/rate-limit-memory", () => ({
  rateLimit: () => (st.limited ? { ok: false, retryAfter: 600 } : { ok: true }),
  ipFromRequest: () => "10.0.0.1",
}));
vi.mock("@/lib/email", () => ({ sendEmail: async (p: Record<string, unknown>) => { st.emails.push(p); } }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: (e: Record<string, unknown>) => { st.audits.push(e); } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async (a: { where: { id: string; organizationId: string; deletedAt: null } }) =>
        st.users.find((u) => u.id === a.where.id && u.organizationId === a.where.organizationId && !u.deletedAt) ?? null,
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => { st.updates.push({ id: a.where.id, data: a.data }); return {}; },
    },
    organizationMembership: {
      findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
        st.memberships.find((m) => m.userId === a.where.userId_organizationId.userId && m.organizationId === a.where.userId_organizationId.organizationId) ? { id: "m" } : null,
    },
  },
}));

import { POST } from "./route";

const reset = (id: string, body: unknown = { confirm: "RESET" }) =>
  POST(new Request(`http://x/api/users/${id}/mfa-reset`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

const person = (over: Partial<Target> = {}, level = "EMPLOYEE"): Target => ({
  id: "u1", email: "max@co.test", firstName: "Max", lastName: "Low", ...legacyLevelRow(level), mfaEnabled: true, organizationId: "o1", deletedAt: null, ...over,
});

beforeEach(() => {
  st.session = { user: { id: "admin1", organizationId: "o1", name: "Ada Admin" } };
  st.fresh = { ok: true, level: "COMPANY_ADMIN", admin: true, owner: false };
  st.users = [person()];
  st.memberships = [];
  st.updates = [];
  st.revoked = [];
  st.audits = [];
  st.emails = [];
  st.limited = false;
});

describe("who may reset", () => {
  it("refuses a signed-out caller, a Member, a stale actor and the caller's own", async () => {
    st.session = null;
    expect((await reset("u1")).status).toBe(401);
    st.session = { user: { id: "admin1", organizationId: "o1" } };
    st.fresh = { ok: true, level: "MANAGER", admin: false, owner: false };
    expect((await reset("u1")).status).toBe(403);
    st.fresh = { ok: false, status: 403, error: "Your access changed a moment ago." };
    expect((await reset("u1")).status).toBe(403);
    st.fresh = { ok: true, level: "COMPANY_ADMIN", admin: true, owner: false };
    st.users = [person({ id: "admin1" }, "COMPANY_ADMIN")];
    expect((await reset("admin1")).status).toBe(400);
    expect(st.updates).toEqual([]);
  });

  it("lets an Admin reset a Member but not another Admin or an Owner; an Owner may", async () => {
    st.users = [person({ id: "a2" }, "COMPANY_ADMIN"), person({ id: "own" }, "SUPER_ADMIN")];
    expect((await reset("a2")).status).toBe(403);
    expect((await reset("own")).status).toBe(403);
    expect(st.updates).toEqual([]);
    st.fresh = { ok: true, level: "SUPER_ADMIN", admin: true, owner: true };
    expect((await reset("a2")).status).toBe(200);
    expect((await reset("own")).status).toBe(200);
  });

  it("asks to type RESET, and slows a burst", async () => {
    expect((await reset("u1", {})).status).toBe(400);
    st.limited = true;
    expect((await reset("u1")).status).toBe(429);
    expect(st.updates).toEqual([]);
  });
});

describe("whose", () => {
  it("never touches an account anchored in another workspace, even a member here", async () => {
    st.users = [person({ organizationId: "o2" })];
    st.memberships = [{ userId: "u1", organizationId: "o1" }];
    const r = await reset("u1");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/workspace they signed up in/);
    st.memberships = [];
    expect((await reset("u1")).status).toBe(404);
    expect(st.updates).toEqual([]);
  });

  it("says so when it is already off, and does nothing", async () => {
    st.users = [person({ mfaEnabled: false })];
    expect((await reset("u1")).status).toBe(400);
    expect(st.updates).toEqual([]);
  });
});

describe("what a reset does", () => {
  it("turns it off, ends every session and AI app, logs it and tells the person", async () => {
    expect((await reset("u1")).status).toBe(200);
    expect(st.updates).toEqual([{ id: "u1", data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], tokenVersion: { increment: 1 } } }]);
    expect(st.revoked).toEqual([["u1"]]);
    expect(st.audits).toEqual([expect.objectContaining({ type: "mfa_reset_by_admin", actorId: "admin1", targetId: "u1", organizationId: "o1", severity: "critical" })]);
    expect(st.emails).toHaveLength(1);
    expect(st.emails[0]).toMatchObject({ to: "max@co.test", template: "mfa-reset" });
    // A security notice has no category, so no preference can mute it.
    expect(st.emails[0].category).toBeUndefined();
    expect(String(st.emails[0].html)).toContain("Ada Admin");
  });

  it("escapes the admin's name in the email", async () => {
    st.session = { user: { id: "admin1", organizationId: "o1", name: "<b>Ada</b>" } };
    await reset("u1");
    expect(String(st.emails[0].html)).not.toContain("<b>Ada</b>");
  });
});
