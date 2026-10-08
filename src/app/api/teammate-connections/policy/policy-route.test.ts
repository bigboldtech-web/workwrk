// The workspace switch for Google in AI teammates and Disconnect everyone
// (docs/plans/ai-teammates-phase3.md step 2, Decisions 1, 2 and 21): Owners
// and Admins only, a product turned on only when this WorkwrK offers it, the
// answer naming what was turned off, and a disconnect of everyone that leaves
// one admin audit row and, per person, one audit row and one Inbox row,
// written 500 at a time.

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-admin", organizationId: "org1", orgRole: "ADMIN", isAgent: false } as { userId: string; organizationId: string; orgRole: string; isAgent: boolean },
  cfg: null as unknown,
  /** The actor as the database has them now (freshWorkspaceActor). */
  fresh: { ok: true, level: "COMPANY_ADMIN", admin: true, owner: false } as unknown,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));
vi.mock("@/lib/connectors/google/config", () => ({
  googleConfig: () => st.cfg,
  googleRevokeConfig: () => ({ revokeUrl: "https://g.test/revoke", standIn: true }),
  googleRedirectUri: () => "https://app.test/cb",
}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: st.viewer.userId, organizationId: st.viewer.organizationId } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: vi.fn(async () => st.fresh) }));
vi.mock("@/lib/app-gate", () => ({
  requireManageApps: vi.fn(async () =>
    st.viewer.orgRole === "OWNER" || st.viewer.orgRole === "ADMIN" ? { viewer: st.viewer } : { error: NextResponse.json({ error: "no_access", page: "apps" }, { status: 403 }) },
  ),
  isOwnerOrAdmin: (v: { orgRole: string }) => v.orgRole === "OWNER" || v.orgRole === "ADMIN",
}));

import { connectorDb, cdb, resetConnectorDb, seedConnection } from "@/lib/connectors/connector-test-db";
import { POST as DISCONNECT_ALL } from "./disconnect-all/route";
import { GET, PUT } from "./route";

const CFG = {
  clientId: "agent-client",
  clientSecret: "agent-secret",
  authUrl: "https://g.test/o/oauth2/v2/auth",
  tokenUrl: "https://g.test/token",
  revokeUrl: "https://g.test/revoke",
  gmailBase: "https://g.test/gmail/v1",
  calendarBase: "https://g.test/calendar/v3",
  products: ["calendar"],
  standIn: true,
};

const json = (method: string, body: unknown) =>
  new Request("https://app.test/api/teammate-connections/policy", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "9".repeat(64);
  resetConnectorDb();
  st.viewer = { userId: "u-admin", organizationId: "org1", orgRole: "ADMIN", isAgent: false };
  st.cfg = CFG;
  st.fresh = { ok: true, level: "COMPANY_ADMIN", admin: true, owner: false };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const STALE = { ok: false, status: 403, error: "Your access changed a moment ago. Reload the page and sign in again if asked.", code: "stale_session" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the policy", () => {
  it("answers a Member with the Apps page's own refusal, and writes nothing", async () => {
    st.viewer = { ...st.viewer, userId: "u-max", orgRole: "MEMBER" };
    expect((await GET()).status).toBe(403);
    const res = await PUT(json("PUT", { calendar: true }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "no_access" });
    expect(cdb.policy.get("org1")).toBeUndefined();
  });

  it("refuses to turn on a product this WorkwrK does not offer", async () => {
    const res = await PUT(json("PUT", { gmail: true }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_offered" });
    expect(cdb.policy.get("org1")).toBeUndefined();
  });

  it("turns a product on with a warning audit row, and off answering turnedOff", async () => {
    let res = await PUT(json("PUT", { calendar: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ on: { gmail: false, calendar: true }, offered: { gmail: false, calendar: true }, turnedOff: [] });
    const onRow = cdb.activity.find((a) => a.type === "teammate_connectors.changed");
    expect(onRow).toMatchObject({ actorId: "u-admin", organizationId: "org1", severity: "warning", description: "Turned on Google Calendar for AI teammates", oldValue: { on: false }, newValue: { on: true } });

    res = await PUT(json("PUT", { calendar: false }));
    expect(await res.json()).toMatchObject({ on: { calendar: false }, turnedOff: ["calendar"] });
    expect(cdb.activity.filter((a) => a.type === "teammate_connectors.changed").map((a) => a.description)).toEqual([
      "Turned on Google Calendar for AI teammates",
      "Turned off Google Calendar for AI teammates",
    ]);
  });

  // Review of step 2: the session's role is checked only every five minutes,
  // so an Admin demoted a moment ago could still turn Gmail on.
  it("refuses an Admin the database no longer holds as one, and writes nothing", async () => {
    st.fresh = STALE;
    const res = await PUT(json("PUT", { calendar: true }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "stale_session" });
    expect(cdb.policy.get("org1")).toBeUndefined();
    expect(cdb.activity).toEqual([]);
    // GET reads counts only and keeps the gate alone.
    expect((await GET()).status).toBe(200);
  });

  it("turns a product off even when this WorkwrK no longer offers Google", async () => {
    cdb.policy.set("org1", ["calendar"]);
    st.cfg = null;
    const res = await PUT(json("PUT", { calendar: false }));
    expect(res.status).toBe(200);
    expect(cdb.policy.get("org1")).toEqual([]);
  });

  it("counts people, never names them", async () => {
    seedConnection({ organizationId: "org1", userId: "u-1", accountSub: "s1", accountEmail: "one@mail.test", products: ["calendar"] });
    seedConnection({ organizationId: "org1", userId: "u-2", accountSub: "s2", status: "needs_reconnect" });
    const body = await (await GET()).json();
    expect(body.counts).toEqual({ connected: 2, gmail: 1, calendar: 2, needsReconnect: 1 });
    expect(JSON.stringify(body)).not.toContain("one@mail.test");
    expect(JSON.stringify(body)).not.toContain("u-1");
  });
});

describe("disconnect everyone", () => {
  it("refuses an Admin demoted or removed a moment ago, and ends nothing", async () => {
    seedConnection({ organizationId: "org1", userId: "u-1", accountSub: "s1" });
    st.fresh = STALE;
    const res = await DISCONNECT_ALL(json("POST", { confirm: "disconnect" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "stale_session" });
    expect(cdb.connections).toHaveLength(1);
    expect(cdb.notifications).toEqual([]);
  });

  it("needs the confirm word", async () => {
    seedConnection({ organizationId: "org1", userId: "u-1", accountSub: "s1" });
    const res = await DISCONNECT_ALL(json("POST", { confirm: "yes" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "confirm_needed" });
    expect(cdb.connections).toHaveLength(1);
  });

  it("writes one admin audit row and, per person, one audit row and one Inbox row, 500 at a time (1,201 people)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const auditSizes: number[] = [];
    const noticeSizes: number[] = [];
    const audit = connectorDb.activityLog.createMany;
    const notice = connectorDb.notification.createMany;
    vi.spyOn(connectorDb.activityLog, "createMany").mockImplementation(async (a: { data: Array<Record<string, unknown>> }) => {
      auditSizes.push(a.data.length);
      return audit(a);
    });
    vi.spyOn(connectorDb.notification, "createMany").mockImplementation(async (a: { data: Array<Record<string, unknown>> }) => {
      noticeSizes.push(a.data.length);
      return notice(a);
    });
    for (let i = 0; i < 1201; i++) seedConnection({ organizationId: "org1", userId: `u-${i}`, accountSub: `sub-${i}` });
    seedConnection({ organizationId: "org2", userId: "u-elsewhere", accountSub: "sub-elsewhere" });

    const res = await DISCONNECT_ALL(json("POST", { confirm: "disconnect" }));
    expect(await res.json()).toEqual({ disconnected: 1201 });
    expect(cdb.connections.map((c) => c.organizationId)).toEqual(["org2"]);

    const admin = cdb.activity.filter((a) => a.type === "teammate_connectors.disconnected_all");
    expect(admin).toHaveLength(1);
    expect(admin[0]).toMatchObject({ actorId: "u-admin", severity: "warning", metadata: { provider: "google", count: 1201 } });
    const people = cdb.activity.filter((a) => a.type === "teammate_connection.disconnected");
    expect(people).toHaveLength(1201);
    expect(new Set(people.map((p) => p.targetId)).size).toBe(1201);
    expect(people.every((p) => p.actorId === "u-admin" && (p.metadata as { reason: string }).reason === "admin_all")).toBe(true);
    const notices = cdb.notifications.filter((n) => n.type === "agent_connection");
    expect(notices).toHaveLength(1201);
    expect(notices[0]).toMatchObject({ message: "An Owner or Admin disconnected Google from AI teammates in Acme.", link: "/account/connections?ws=org1#ai-google" });
    expect(Math.max(...auditSizes)).toBeLessThanOrEqual(500);
    expect(Math.max(...noticeSizes)).toBeLessThanOrEqual(500);
    expect(auditSizes.reduce((a, b) => a + b, 0)).toBe(1201);
  });
});
