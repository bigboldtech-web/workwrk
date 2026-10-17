// "Delete every skill" (src/app/api/teammate-browser/policy/delete-skills,
// docs/plans/ai-teammates-phase5.md Decisions 14 and 25, step 3): Owners and
// Admins only, read fresh; confirmed; recordings stopped first; every skill
// of the workspace deleted in batches of 1,000, their routines with them,
// and nothing of another workspace; one audit row with the count; and
// nothing about any skill answered or written.

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false } as { userId: string; organizationId: string; orgRole: string; isAgent: boolean },
  fresh: { ok: true, level: "SUPER_ADMIN", admin: true, owner: true } as unknown,
  order: [] as string[],
  stopped: [] as Array<{ org: string; keep: unknown }>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: st.viewer.userId, organizationId: st.viewer.organizationId } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: vi.fn(async () => st.fresh) }));
vi.mock("@/lib/app-gate", () => ({
  requireManageApps: vi.fn(async () =>
    st.viewer.orgRole === "OWNER" || st.viewer.orgRole === "ADMIN" ? { viewer: st.viewer } : { error: NextResponse.json({ error: "no_access", page: "apps" }, { status: 403 }) },
  ),
  requireApp: vi.fn(async () => ({ viewer: st.viewer })),
}));
vi.mock("@/lib/agents/actions", () => ({ writeEventLine: async () => null, actionHref: (s: string, id: string) => `/agents?chat=${s}&action=${id}` }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/agents/acting", () => ({ actorLabelFor: (a: { name: string }, p: { name: string }) => `${a.name} for ${p.name}`, resolveActingPerson: async () => ({ ok: true }) }));
vi.mock("@/lib/browser/browserbase", () => ({
  releaseProviderSession: async () => "released",
  createProviderSession: async () => ({ ok: false, failure: "unavailable" }),
  listRunningProviderSessions: async () => ({ ok: true, data: [] }),
  liveViewUrl: async () => ({ ok: false, failure: "unavailable" }),
}));
vi.mock("@/lib/browser/cdp-driver", () => ({ attachBrowser: async () => Promise.reject(new Error("no browser in this test")) }));
// The recordings' stop is the recorder's own (proven in recorder.test.ts): here, that it runs first, with what it is told.
vi.mock("@/lib/skills/recorder", async (orig) => {
  const real = await orig<typeof import("@/lib/skills/recorder")>();
  return {
    ...real,
    stopRecordingsOf: vi.fn(async (org: string, _reason: string, o?: { keep?: boolean }) => {
      const { bdb } = await import("@/lib/browser/browser-test-db");
      st.order.push(`stop with ${bdb.t.skills.length} skills`);
      st.stopped.push({ org, keep: o?.keep });
      return 1;
    }),
  };
});

import { bdb, resetBrowserDb, seedOrg, seedRoutine, seedSession, seedSkill, seedUser } from "@/lib/browser/browser-test-db";
import { POST } from "./route";

const req = (body: Record<string, unknown>) =>
  new Request("https://app.test/api/teammate-browser/policy/delete-skills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  resetBrowserDb();
  st.viewer = { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false };
  st.fresh = { ok: true, level: "SUPER_ADMIN", admin: true, owner: true };
  st.order = [];
  st.stopped = [];
  seedOrg();
  seedUser();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Delete every skill", () => {
  it("answers a Member and a Manager with the Apps page's own refusal, and a demoted Admin read fresh, deleting nothing", async () => {
    seedSkill({ status: "ready", name: "Kept" });
    for (const orgRole of ["MEMBER", "MANAGER"]) {
      st.viewer = { ...st.viewer, userId: "u-max", orgRole };
      expect((await POST(req({ organizationId: "org1", confirm: "delete" }))).status).toBe(403);
    }
    st.viewer = { ...st.viewer, userId: "u-ada", orgRole: "ADMIN" };
    st.fresh = { ok: true, level: "EMPLOYEE", admin: false, owner: false };
    expect((await POST(req({ organizationId: "org1", confirm: "delete" }))).status).toBe(403);
    expect(bdb.t.skills).toHaveLength(1);
    expect(st.stopped).toEqual([]);
    expect(bdb.t.activity).toEqual([]);
  });

  it("needs the confirm and the workspace the page showed", async () => {
    seedSkill({ status: "ready", name: "Kept" });
    let res = await POST(req({ organizationId: "org1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "confirm_needed", error: "Confirm to delete every skill." });
    res = await POST(req({ organizationId: "org2", confirm: "delete" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "workspace_changed" });
    expect(bdb.t.skills).toHaveLength(1);
  });

  it("stops recordings first, deleting what they recorded, then deletes in batches of 1,000, their routines with them, and nothing of another workspace", async () => {
    for (let i = 0; i < 2300; i++) seedSkill({ status: i % 3 === 0 ? "ready" : "draft", name: `Skill ${i}`, userId: i % 2 === 0 ? "u-max" : "u-lee" });
    const elsewhere = seedSkill({ organizationId: "org2", status: "ready", name: "Another workspace's" });
    const first = bdb.t.skills[0];
    seedRoutine({ skillId: first.id });
    seedRoutine({ skillId: elsewhere.id, organizationId: "org2" });
    const session = seedSession({ skillId: first.id, skillVersion: 1 });
    const res = await POST(req({ organizationId: "org1", confirm: "delete" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The count only: nothing about any skill.
    expect(await res.json()).toEqual({ deleted: 2300 });
    expect(st.order).toEqual(["stop with 2301 skills"]);
    expect(st.stopped).toEqual([{ org: "org1", keep: false }]);
    expect(bdb.events.filter((e) => e.op.startsWith("skills.deleteBatch")).map((e) => e.op)).toEqual(["skills.deleteBatch:1000", "skills.deleteBatch:1000", "skills.deleteBatch:300", "skills.deleteBatch:0"]);
    expect(bdb.raw.filter((r) => r.startsWith('DELETE FROM "TeammateSkill"')).every((r) => r.includes('WHERE "organizationId" = ? LIMIT ?'))).toBe(true);
    expect(bdb.t.skills.map((s) => s.id)).toEqual([elsewhere.id]);
    expect(bdb.t.routines.map((r) => r.skillId)).toEqual([elsewhere.id]);
    expect(session.skillId).toBeNull();
    // One audit row, the workspace's own, with the count.
    expect(bdb.t.activity).toHaveLength(1);
    expect(bdb.t.activity[0]).toMatchObject({
      type: "teammate_browser.skills_deleted_all",
      actorId: "u-olivia",
      organizationId: "org1",
      description: "Deleted every skill in the workspace: 2300 skills",
      metadata: { count: 2300, finished: true },
    });
    expect(JSON.stringify(bdb.t.activity)).not.toContain("Skill 1");
  });
});
