// The access engine itself, never a stand-in, decides what a person here
// through a membership may read, and the grant writer tells a person of a
// grant only while their seat here is live (docs/plans/workspace-status-2.md
// step 6, its review M3 and L3). Run on the in-memory database
// (seat-test-db.ts) with the real node world and evaluator.
//
// The case of step 6: Pat is anchored at her agency A and works at client B
// through a live membership; Dana is a Manager in B and owns B's Space
// "Client"; Rita is anchored at A and B deactivated her; Bea is anchored at B
// and is not in the Space.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession("dana", "MANAGER", "b") }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/notify-prefs", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify-prefs")>()),
  filterNotifyUsers: async (ids: string[]) => new Set(ids),
}));
// The caller's own gates on the doc (the writer may edit it); who the
// mentioned person is and what they may read is the real engine's answer.
vi.mock("@/lib/suites/auth", () => ({ resolveSuiteContext: async () => ({ userId: "dana", orgId: "b", ...legacyLevelRow("MANAGER") }) }));
vi.mock("@/lib/doc-access", () => ({ docAccessible: async () => true }));
vi.mock("@/lib/doc-sharing", async (orig) => ({ ...(await orig<typeof import("@/lib/doc-sharing")>()), requireDocRole: async () => true }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { setNodeGrant } from "@/lib/access/grants";
import { usersWhoCanRead } from "@/lib/access/node-access";
import type { NodeCtx } from "@/lib/access/node-rules";
import { POST as mentionInDoc } from "@/app/api/docs/[id]/mention/route";

const DANA: NodeCtx = { userId: "dana", organizationId: "b", orgAdmin: false, orgGuest: false, isAgent: false, denied: false };
const DOC = { id: "d1", organizationId: "b", title: "Spec", entityType: "SPACE", entityId: "sp1", parentId: null, createdById: "dana", createdAt: new Date("2026-10-01") };
const post = (userId: string) =>
  mentionInDoc(new Request("https://app.test/api/docs/d1/mention", { method: "POST", body: JSON.stringify({ userId }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: "d1" }) });

function person(id: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Lee", organizationId,
    ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, ...over,
  });
}

beforeEach(() => {
  db.reset();
  // The doc's chain (one row, a Space doc); every other raw read answers none.
  db.onQueryRaw = (sql) => (sql.includes("WITH RECURSIVE chain") && sql.includes('FROM "Doc"') ? [DOC] : []);
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, settings: {} });
  person("dana", "b", { ...legacyLevelRow("MANAGER") });
  person("pat", "a");
  db.seed("organizationMembership", { id: "m-pat", userId: "pat", organizationId: "b" });
  person("rita", "a");
  db.seed("organizationMembership", { id: "m-rita", userId: "rita", organizationId: "b", status: "INACTIVE" });
  person("bea", "b");
  db.seed("space", { id: "sp1", organizationId: "b", name: "Client", slug: "client", icon: null, color: null, visibility: "PRIVATE", ownerId: "dana", description: null, parentSpaceId: null, displayOrder: 0, archivedAt: null });
  db.seed("board", { id: "l1", organizationId: "b", spaceId: "sp1", folderId: null, name: "Launch", slug: "launch", icon: null, color: null, visibility: "WORKSPACE", ownerId: "dana", settings: {}, archivedAt: null });
  db.seed("doc", { ...DOC, archivedAt: null });
  db.seed("spaceMember", { id: "sm-dana", spaceId: "sp1", userId: "dana", role: "OWNER", createdAt: new Date("2026-01-01") });
  db.seed("spaceMember", { id: "sm-pat", spaceId: "sp1", userId: "pat", role: "MEMBER", createdAt: new Date("2026-06-01") });
  db.seed("spaceMember", { id: "sm-rita", spaceId: "sp1", userId: "rita", role: "MEMBER", createdAt: new Date("2026-06-01") });
});

describe("the real evaluator reads a membership person at their seat here (L3)", () => {
  it("lets Pat, a member of the Space, read its doc; never Rita (deactivated here) or Bea (not in it)", async () => {
    const readers = await usersWhoCanRead("b", { kind: "doc", id: "d1" }, { among: ["pat", "rita", "bea"] });
    expect([...readers.keys()]).toEqual(["pat"]);
  });

  it("so a mention tells Pat, and tells neither Rita nor Bea", async () => {
    expect(await (await post("pat"))!.json()).toEqual({ ok: true });
    expect(await (await post("rita"))!.json()).toEqual({ ok: true, skipped: "no_access" });
    expect(await (await post("bea"))!.json()).toEqual({ ok: true, skipped: "no_access" });
    expect((db.tables.notification ?? []).map((n) => n.userId)).toEqual(["pat"]);
  });
});

describe("the grant writer tells only a person who can work here (M3)", () => {
  it("shares the List with Pat and tells her; keeps Rita's grant for a reactivation and tells her nothing", async () => {
    await setNodeGrant(DANA, { kind: "list", id: "l1" }, { userId: "pat", memberRole: "MEMBER" }, "members-route");
    await setNodeGrant(DANA, { kind: "list", id: "l1" }, { userId: "rita", memberRole: "MEMBER" }, "members-route");
    expect((db.tables.boardMember ?? []).map((m) => m.userId)).toEqual(["pat", "rita"]);
    expect((db.tables.notification ?? []).map((n) => [n.userId, n.title])).toEqual([["pat", "Dana Lee shared Launch with you"]]);
  });
});
