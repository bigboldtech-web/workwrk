// The step 6 review fixes (docs/plans/workspace-status-2.md, "Step 6, review
// fixes"): the writes behind the widened pickers give work, goals and notices
// to a seat this workspace ended neither by mistake nor by an old client.
// Run on the in-memory database (seat-test-db.ts), through the real routes.
//
// The case of step 6: Pat is anchored at her agency A and works at client B
// through a live membership; Dana is a Manager in B; Rita is anchored at A
// and B deactivated her; Rex is anchored at A and B removed him; Zed is
// anchored at A with no seat in B; Ron is anchored at B and was removed.

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  me: "dana",
  made: [] as Array<Record<string, unknown>>,
  goals: [] as Array<Record<string, unknown>>,
  goalNotices: [] as string[],
  emails: [] as string[],
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, "MANAGER", "b") }));
vi.mock("next-auth/next", () => ({ getServerSession: async () => legacyTestSession(st.me, "MANAGER", "b") }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession(st.me, "MANAGER", "b") }),
  getOrgId: () => "b",
  getUserId: () => st.me,
}));
vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "b", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/email", () => ({ sendEmail: async (a: { to: string }) => { st.emails.push(a.to); }, queueEmail: async () => undefined }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => undefined, calculatePerformanceScore: async () => undefined }));
vi.mock("@/lib/board", async (orig) => ({
  ...(await orig<typeof import("@/lib/board")>()),
  getOrCreatePersonalBoard: async (_org: string, userId: string) => ({ id: `personal-${userId}`, statuses: null }),
}));
vi.mock("@/lib/board-items", async (orig) => ({
  ...(await orig<typeof import("@/lib/board-items")>()),
  createBoardItem: async (input: Record<string, unknown>) => {
    st.made.push(input);
    return { id: `task-${st.made.length}`, boardId: input.boardId, title: input.title, status: "TO_DO", ownerId: input.ownerId, assigneeIds: input.assigneeIds, dueAt: null, priority: "NORMAL", createdAt: new Date() };
  },
}));
// The goal rules and the create path are their own suites; here a goal is
// made as asked, and the owner's notice is read.
vi.mock("@/lib/alignment-scope", async (orig) => ({
  ...(await orig<typeof import("@/lib/alignment-scope")>()),
  goalRightsActor: async () => ({ callerId: st.me, admin: true, peopleTeam: false, manager: true, agent: false, chain: null }),
  goalCreatorIds: async () => new Map(),
}));
vi.mock("@/lib/alignment", async (orig) => ({
  ...(await orig<typeof import("@/lib/alignment")>()),
  persistGoalRollupChain: async () => null,
  enrichKeyResults: async () => [],
}));
vi.mock("@/lib/goal-audience", async (orig) => ({
  ...(await orig<typeof import("@/lib/goal-audience")>()),
  canSeeGoal: async () => true,
  summarizeGoalAudiences: async () => new Map(),
}));
vi.mock("@/lib/goals/goal-periods.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/goals/goal-periods.server")>()),
  createGoal: async (a: { data: Record<string, unknown> }) => {
    st.goals.push(a.data);
    return { ok: true, okr: { id: "g-new", title: a.data.title, description: null, ownerId: a.data.ownerId ?? null, parentId: null } };
  },
  currentPeriodFor: async () => null,
}));
vi.mock("@/lib/goals/goal-notify", () => ({ notifyGoalAssigned: async (ownerId: string) => { st.goalNotices.push(ownerId); } }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { POST as addActionItem, PUT as editActionItem, PATCH as convertActionItem } from "@/app/api/meetings/[id]/action-items/route";
import { GET as getMeeting } from "@/app/api/meetings/[id]/route";
import { POST as v1Task } from "@/app/api/v1/tasks/route";
import { POST as ingest } from "@/app/api/integrations/ingest/route";
import { POST as saveNotes } from "@/app/api/notetaker/save/route";
import { POST as createOkr, PATCH as editOkr } from "@/app/api/okrs/route";
import { createPersonalTask } from "@/lib/work/personal-task";

const json = async (res: Response | undefined) => (await res!.json()) as Record<string, unknown>;
const body = (b: unknown, method = "POST") => new Request("https://app.test/x", { method, body: JSON.stringify(b), headers: { "content-type": "application/json" } }) as never;
const meetingParams = { params: Promise.resolve({ id: "m1" }) };

/** Each person's own last name, so a match by name names exactly one. */
const LAST: Record<string, string> = { dana: "Diaz", pat: "Park", rita: "Reyes", rex: "Ross", zed: "Zane", ron: "Ortiz" };
function person(id: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: LAST[id] ?? "Lee", organizationId,
    ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, departmentId: null, roleId: null, officeId: null,
    joinDate: new Date("2025-01-01"), createdAt: new Date("2025-01-01"), ...over,
  });
}
function seat(userId: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, createdAt: new Date("2026-06-01"), ...over });
}
const notified = () => (db.tables.notification ?? []).map((n) => n.userId);

beforeEach(() => {
  db.reset();
  db.onQueryRaw = () => [];
  st.me = "dana";
  st.made = [];
  st.goals = [];
  st.goalNotices = [];
  st.emails = [];
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}` });
  person("dana", "b", { ...legacyLevelRow("MANAGER") });
  person("pat", "a");
  seat("pat", "b");
  person("rita", "a");
  seat("rita", "b", { status: "INACTIVE" });
  person("rex", "a");
  seat("rex", "b", { status: "INACTIVE", removedAt: new Date("2026-10-01") });
  person("zed", "a");
  person("ron", "b", { status: "INACTIVE", deletedAt: new Date("2026-09-01") });
  db.seed("meeting", { id: "m1", organizationId: "b", title: "Weekly sync", createdById: "dana", deletedAt: null });
  db.seed("meetingAttendee", { id: "ma1", meetingId: "m1", userId: "dana" });
  db.seed("meetingAttendee", { id: "ma2", meetingId: "m1", userId: "rita" });
});

describe("H1: a meeting's action items", () => {
  it("are given to Pat and tell her; never to Rita, deactivated here, or Zed, and nothing is written", async () => {
    expect((await addActionItem(body({ title: "Send the deck", assigneeId: "pat" }), meetingParams))!.status).toBe(201);
    expect(notified()).toEqual(["pat"]);
    for (const who of ["rita", "zed", "rex"]) {
      const res = await addActionItem(body({ title: "No", assigneeId: who }), meetingParams);
      expect(res!.status).toBe(400);
      expect((await json(res)).error).toBe("That person can't be given an action item in this workspace. Pick someone who works here.");
    }
    expect((db.tables.actionItem ?? []).map((a) => a.assigneeId)).toEqual(["pat"]);
    expect(notified()).toEqual(["pat"]);
    // The convenience task went to Pat's own list only.
    expect(st.made.map((t) => t.ownerId)).toEqual(["pat"]);
  });

  it("are moved to Pat, never to Rita; an item that already holds Rita keeps her on another edit", async () => {
    db.seed("actionItem", { id: "ai1", meetingId: "m1", title: "Old", assigneeId: "dana", status: "OPEN", deadline: null, itemId: null });
    db.seed("actionItem", { id: "ai2", meetingId: "m1", title: "Hers", assigneeId: "rita", status: "OPEN", deadline: null, itemId: null });
    expect((await editActionItem(body({ itemId: "ai1", assigneeId: "rita" }, "PUT"), meetingParams))!.status).toBe(400);
    expect(db.row("actionItem", "ai1").assigneeId).toBe("dana");
    expect((await editActionItem(body({ itemId: "ai1", assigneeId: "pat" }, "PUT"), meetingParams))!.status).toBe(200);
    expect(db.row("actionItem", "ai1").assigneeId).toBe("pat");
    expect((await editActionItem(body({ itemId: "ai2", assigneeId: "rita", title: "Hers, renamed" }, "PUT"), meetingParams))!.status).toBe(200);
  });

  it("the meeting page is told which attendees can still be given work here, so Rita is not offered", async () => {
    const res = await getMeeting(new Request("https://app.test/api/meetings/m1") as never, meetingParams);
    const attendees = (await json(res)).attendees as Array<{ userId: string; liveHere: boolean }>;
    expect(attendees.map((a) => [a.userId, a.liveHere])).toEqual([["dana", true], ["rita", false]]);
  });

  it("are turned into a task only for someone whose seat here is not removed, answered in words", async () => {
    db.seed("actionItem", { id: "ai3", meetingId: "m1", title: "His", assigneeId: "rex", status: "OPEN", deadline: null, itemId: null });
    const res = await convertActionItem(body({ itemId: "ai3" }, "PATCH"), meetingParams);
    expect(res!.status).toBe(400);
    expect((await json(res)).error).toBe("The person this action item is assigned to no longer works in this workspace. Assign it to someone else first.");
    expect(st.made).toEqual([]);
  });
});

describe("M1: work lands only on a seat here that is not removed", () => {
  it("createPersonalTask refuses Rex, removed here, and Zed; takes Pat, and anyone anchored here as before", async () => {
    const make = (assigneeId: string) => createPersonalTask({ organizationId: "b", assigneeId, title: "Follow up", dueAt: new Date(), actorId: null });
    await expect(make("rex")).rejects.toThrow("Assignee is not in this organization");
    await expect(make("zed")).rejects.toThrow("Assignee is not in this organization");
    await expect(make("pat")).resolves.toMatchObject({ id: "task-1" });
    // Someone anchored here keeps the rule they had (any state).
    await expect(make("ron")).resolves.toMatchObject({ id: "task-2" });
    expect(st.made.map((t) => t.ownerId)).toEqual(["pat", "ron"]);
  });

  it("POST /api/v1/tasks answers 404 for Rex and makes nothing; 201 for Pat", async () => {
    const res = await v1Task(body({ title: "Call back", assigneeId: "rex" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Assignee not in org" });
    expect((await v1Task(body({ title: "Call back", assigneeId: "pat" }))).status).toBe(201);
    expect(st.made.map((t) => t.ownerId)).toEqual(["pat"]);
  });

  it("the ingest's task.create answers 404 for Rex and makes nothing; 201 for Pat", async () => {
    db.seed("integration", { id: "i1", organizationId: "b", type: "CUSTOM_WEBHOOK", status: "ACTIVE", config: { ingestSecret: "s3cret" } });
    const send = (data: Record<string, unknown>) => {
      const raw = JSON.stringify({ action: "task.create", data });
      const sig = `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`;
      return ingest(new Request("https://app.test/api/integrations/ingest", { method: "POST", headers: { "x-workwrk-organization": "b", "x-workwrk-signature": sig }, body: raw }) as never);
    };
    expect((await send({ title: "Ticket", assigneeId: "rex" })).status).toBe(404);
    expect(st.made).toEqual([]);
    expect((await send({ title: "Ticket", assigneeId: "pat" })).status).toBe(201);
    expect(st.made.map((t) => t.ownerId)).toEqual(["pat"]);
  });

  it("the notetaker gives an action item to Pat; Rex and Ron, removed here, fall back to the person saving", async () => {
    const res = await saveNotes(body({
      title: "Kickoff",
      attendees: [{ name: "Pat Park", email: "pat@x.test" }, { name: "Rex Ross", email: "rex@x.test" }],
      actionItems: [
        { title: "Pat's", assigneeEmail: "pat@x.test" },
        { title: "Rex's", assigneeEmail: "rex@x.test" },
        { title: "Rex by name", assigneeName: "Rex Ross" },
        { title: "Ron's", assigneeEmail: "ron@x.test" },
      ],
    }));
    expect(res.status).toBe(200);
    const items = (db.tables.actionItem ?? []).map((a) => [a.title, a.assigneeId]);
    // Before: Rex (a seat B removed) and Ron (removed here) held the items,
    // and a task made from one on a List refused the next assignee edit.
    expect(items).toEqual([["Pat's", "pat"], ["Rex's", "dana"], ["Rex by name", "dana"], ["Ron's", "dana"]]);
    // Rex is not an attendee here either: his seat here is removed.
    expect((db.tables.meetingAttendee ?? []).filter((a) => a.meetingId !== "m1").map((a) => a.userId)).toEqual(["pat"]);
  });
});

describe("M2: a goal's owner", () => {
  it("is Pat, told and emailed; never Rita, Rex or Zed, and nobody is told", async () => {
    expect((await createOkr(body({ title: "Launch B", level: "INDIVIDUAL", ownerId: "pat" }) as never)).status).toBe(201);
    expect(st.goalNotices).toEqual(["pat"]);
    expect(st.emails).toEqual(["pat@x.test"]);
    for (const who of ["rita", "rex", "zed"]) {
      const res = await createOkr(body({ title: "No", level: "INDIVIDUAL", ownerId: who }) as never);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "Owner is not a member of this organization" });
    }
    expect(st.goals.map((g) => g.ownerId)).toEqual(["pat"]);
    expect(st.goalNotices).toEqual(["pat"]);
    expect(st.emails).toEqual(["pat@x.test"]);
  });

  it("is never moved to Rita by an edit", async () => {
    db.seed("oKR", { id: "g1", organizationId: "b", title: "Ours", level: "INDIVIDUAL", ownerId: "dana", parentId: null, status: "ON_TRACK", progress: 0 });
    const res = await editOkr(body({ id: "g1", ownerId: "rita" }, "PATCH") as never);
    expect(res.status).toBe(400);
    expect(db.row("oKR", "g1").ownerId).toBe("dana");
  });
});
