// A person's weekly check-in and timesheet in each workspace
// (docs/plans/workspace-status-2.md, the final review, security M1;
// prisma/sql/2026-11-04-week-rows-per-workspace.sql). Run on the in-memory
// database (seat-test-db.ts), through the real routes and the real queue.
//
// The case. Pat is anchored at her agency A, where she reports to Max, and
// works for client B through a membership, where Dana leads her. Before,
// one row per account and week held whichever workspace wrote it first:
// Pat's B check-in and B hours landed on her A rows, Max read and decided
// them in A, and Dana's B queue never held Pat's week.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ me: "pat", level: "EMPLOYEE", org: "a" }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, st.org) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => ({ userId: st.me, organizationId: st.org, orgRole: "MEMBER", isAgent: false }) }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession(st.me, st.level, st.org) }),
  getOrgId: () => st.org,
  getUserId: () => st.me,
}));
// The report tree is the walks' own (tested there); no read here needs it.
vi.mock("@/lib/reporting-line", () => ({ getEffectiveReportTree: async (id: string) => [id], isInReportTree: async () => false }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET as myWeekGet, POST as myWeekPost } from "@/app/api/me/weekly-review/route";
import { PATCH as myWeekPatch } from "@/app/api/me/weekly-review/[id]/route";
import { POST as entryPost } from "@/app/api/time-entries/route";
import { GET as sheetGet } from "@/app/api/timesheets/[id]/route";
import { GET as sheetsGet } from "@/app/api/timesheets/route";
import { listReviewsForManager, weekStartFor } from "@/lib/weekly-review";
import { readWeeklyReview } from "@/lib/people/weekly-queue.server";

type Json = Record<string, unknown>;
const req = (url: string, init?: { method: string; body?: unknown }) =>
  new NextRequest(`https://app.test${url}`, init ? { method: init.method, ...(init.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) } : undefined);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (me: string, org: string, level = "EMPLOYEE") => {
  st.me = me;
  st.org = org;
  st.level = level;
};
const body = async (res: Response) => (await res.json()) as Json;
const data = async (res: Response) => (await res.json()) as Json;

function person(id: string, organizationId: string, level: string, managerId: string | null) {
  return db.seed("user", { id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId, ...legacyLevelRow(level), managerId, avatar: null, roleId: null, presenceStatus: null, presenceUntil: null });
}

const WEEK = weekStartFor();
const today = new Date();

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id.toUpperCase()}`, status: "ACTIVE", settings: {} });
  person("ari", "a", "SUPER_ADMIN", null);
  person("max", "a", "MANAGER", "ari");
  person("pat", "a", "EMPLOYEE", "max");
  person("bo", "b", "SUPER_ADMIN", null);
  person("dana", "b", "MANAGER", "bo");
  // Pat works in B through a membership, under Dana there (E1).
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b", role: "EMPLOYEE", managerId: "dana", createdAt: new Date("2026-06-01") });
  // A KPI of each workspace, each on a KRA of its own.
  db.seed("kRA", { id: "kra-a", organizationId: "a", name: "A delivery" });
  db.seed("kRA", { id: "kra-b", organizationId: "b", name: "B delivery" });
  db.seed("kPI", { id: "kpi-a", organizationId: "a", kraId: "kra-a", name: "A tickets", targetValue: 10, unit: null, direction: null, lowerIsBetter: false });
  db.seed("kPI", { id: "kpi-b", organizationId: "b", kraId: "kra-b", name: "B launches", targetValue: 2, unit: null, direction: null, lowerIsBetter: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the weekly check-in: one row per person, workspace and week", () => {
  it("Pat's A week and B week are two rows, each stamped with that workspace's manager", async () => {
    as("pat", "a");
    const a = (await body(await myWeekPost())).review as Json;
    as("pat", "b");
    const b = (await body(await myWeekPost())).review as Json;
    // Before: B's first save answered A's row, stamped with Max.
    expect(b.id).not.toBe(a.id);
    expect(a).toMatchObject({ organizationId: "a", userId: "pat", managerId: "max" });
    expect(b).toMatchObject({ organizationId: "b", userId: "pat", managerId: "dana" });
    expect((db.tables.weeklyReview ?? []).filter((r) => r.userId === "pat")).toHaveLength(2);
    // A second save in either workspace answers that workspace's row.
    expect(((await body(await myWeekPost())).review as Json).id).toBe(b.id);
    as("pat", "a");
    expect(((await body(await myWeekPost())).review as Json).id).toBe(a.id);
  });

  it("a write from B never reaches the A row, and each page reads its own workspace's row", async () => {
    as("pat", "a");
    const a = (await body(await myWeekPost())).review as Json;
    expect((await myWeekPatch(req(`/api/me/weekly-review/${a.id}`, { method: "PATCH", body: { highlights: "A launch done" } }), params(a.id as string))).status).toBe(200);
    as("pat", "b");
    const b = (await body(await myWeekPost())).review as Json;
    // Before: 200, and "the client's merger closes Friday" was saved onto A's row and went to Max.
    const wrong = await myWeekPatch(req(`/api/me/weekly-review/${a.id}`, { method: "PATCH", body: { blockers: "the client's merger closes Friday" } }), params(a.id as string));
    expect(wrong.status).toBe(404);
    expect(db.row("weeklyReview", a.id as string).blockers).toBeNull();
    expect((await myWeekPatch(req(`/api/me/weekly-review/${b.id}`, { method: "PATCH", body: { blockers: "the client's merger closes Friday", action: "submit" } }), params(b.id as string))).status).toBe(200);
    // Each GET reads its own workspace's row.
    expect(((await body(await myWeekGet(req("/api/me/weekly-review")))).review as Json).id).toBe(b.id);
    as("pat", "a");
    const mine = (await body(await myWeekGet(req("/api/me/weekly-review")))).review as Json;
    expect(mine).toMatchObject({ id: a.id, highlights: "A launch done", blockers: null });
    const history = (await body(await myWeekGet(req("/api/me/weekly-review?history=1")))).reviews as Json[];
    expect(history.map((r) => r.id)).toEqual([a.id]);
  });

  it("Max's A queue holds only Pat's A week, and Dana's B queue holds her B week", async () => {
    as("pat", "a");
    const a = (await body(await myWeekPost())).review as Json;
    await myWeekPatch(req(`/api/me/weekly-review/${a.id}`, { method: "PATCH", body: { highlights: "A work", action: "submit" } }), params(a.id as string));
    as("pat", "b");
    const b = (await body(await myWeekPost())).review as Json;
    await myWeekPatch(req(`/api/me/weekly-review/${b.id}`, { method: "PATCH", body: { highlights: "B work", action: "submit" } }), params(b.id as string));
    const maxQueue = await listReviewsForManager("max", "a", { status: "SUBMITTED" });
    const danaQueue = await listReviewsForManager("dana", "b", { status: "SUBMITTED" });
    expect(maxQueue.map((r) => r.id)).toEqual([a.id]);
    expect(maxQueue[0]).toMatchObject({ highlights: "A work", managerId: "max" });
    expect(danaQueue.map((r) => r.id)).toEqual([b.id]);
    expect(danaQueue[0]).toMatchObject({ highlights: "B work", managerId: "dana" });
  });

  it("an A row written before the rows were per workspace shows Max only A's KPI snapshots, and a save keeps B's on the row unseen", async () => {
    // Pat's B KPI value and its note were saved onto her A row before the deploy.
    db.seed("weeklyReview", {
      id: "wr-old", organizationId: "a", userId: "pat", periodStart: WEEK, status: "SUBMITTED", managerId: "max", managerStatus: "PENDING",
      kpiSnapshots: [{ kpiId: "kpi-a", value: 8, note: "on track" }, { kpiId: "kpi-b", value: 1, note: "client launch slipped" }],
      kraProgress: [{ kraId: "kra-a", progressPct: 80 }, { kraId: "kra-b", progressPct: 20, note: "client roadmap" }],
    });
    const drawer = await readWeeklyReview({ userId: "max", organizationId: "a", peopleTeamOrAdmin: false, isAgent: false, hasReports: true, tree: new Set(["pat"]) }, "wr-old");
    // Before: kpi-b showed as "A removed KPI" with its value and note, and kra-b's progress with its note.
    expect(drawer?.body?.kpis.map((k) => [k.kpiId, k.name, k.note])).toEqual([["kpi-a", "A tickets", "on track"]]);
    expect(drawer?.body?.kras.map((k) => k.kraId)).toEqual(["kra-a"]);
    const queue = await listReviewsForManager("max", "a", { status: "SUBMITTED" });
    expect(queue[0].kpiSnapshots).toEqual([{ kpiId: "kpi-a", value: 8, note: "on track" }]);
    // Pat reopens and saves her A values in A: B's stay on the row, never shown in A.
    as("pat", "a");
    db.row("weeklyReview", "wr-old").status = "DRAFT";
    const saved = await myWeekPatch(req("/api/me/weekly-review/wr-old", { method: "PATCH", body: { kpiSnapshots: [{ kpiId: "kpi-a", value: 9 }], kraProgress: [{ kraId: "kra-a", progressPct: 90 }] } }), params("wr-old"));
    expect(saved.status).toBe(200);
    expect(((await body(saved)).review as Json).kpiSnapshots).toEqual([{ kpiId: "kpi-a", value: 9 }]);
    expect(db.row("weeklyReview", "wr-old").kpiSnapshots).toEqual([{ kpiId: "kpi-a", value: 9 }, { kpiId: "kpi-b", value: 1, note: "client launch slipped" }]);
    expect(db.row("weeklyReview", "wr-old").kraProgress).toEqual([{ kraId: "kra-a", progressPct: 90 }, { kraId: "kra-b", progressPct: 20, note: "client roadmap" }]);
  });
});

describe("the timesheet: one per person, workspace and week", () => {
  it("Pat's B hours go on her B timesheet, approved by Dana, and Max reads only A's", async () => {
    as("pat", "a");
    const aEntry = await data(await entryPost(req("/api/time-entries", { method: "POST", body: { day: today.toISOString(), hours: 2, description: "A sprint" } })));
    as("pat", "b");
    const bEntry = await data(await entryPost(req("/api/time-entries", { method: "POST", body: { day: today.toISOString(), hours: 3, description: "Client B migration" } })));
    // Before: the B entry was written onto A's timesheet, Max its approver.
    expect(bEntry.timesheetId).not.toBe(aEntry.timesheetId);
    const sheets = (db.tables.timesheet ?? []).filter((t) => t.userId === "pat");
    expect(sheets.map((t) => [t.organizationId, t.approverId]).sort()).toEqual([["a", "max"], ["b", "dana"]]);
    // Max, A's approver, reads A's sheet with A's entry only; B's sheet is not his to find.
    as("max", "a", "MANAGER");
    const maxView = await data(await sheetGet(req(`/api/timesheets/${aEntry.timesheetId}`), params(aEntry.timesheetId as string)));
    expect((maxView.entries as Json[]).map((e) => e.description)).toEqual(["A sprint"]);
    expect((await sheetGet(req(`/api/timesheets/${bEntry.timesheetId}`), params(bEntry.timesheetId as string))).status).toBe(404);
    // Dana, B's approver, reads B's.
    as("dana", "b", "MANAGER");
    const danaView = await data(await sheetGet(req(`/api/timesheets/${bEntry.timesheetId}`), params(bEntry.timesheetId as string)));
    expect((danaView.entries as Json[]).map((e) => e.description)).toEqual(["Client B migration"]);
  });

  it("an A timesheet holding a B entry from before shows A's entries and totals only", async () => {
    db.seed("timesheet", { id: "ts-old", organizationId: "a", userId: "pat", weekStartDate: WEEK, approverId: "max", status: "SUBMITTED" });
    db.seed("timeEntry", { id: "e-a", organizationId: "a", timesheetId: "ts-old", userId: "pat", day: WEEK, hours: 2, description: "A sprint" });
    db.seed("timeEntry", { id: "e-b", organizationId: "b", timesheetId: "ts-old", userId: "pat", day: WEEK, hours: 5, description: "Client B migration" });
    as("max", "a", "MANAGER");
    const view = await data(await sheetGet(req("/api/timesheets/ts-old"), params("ts-old")));
    // Before: both entries, B's task title and hours read and decided in A.
    expect((view.entries as Json[]).map((e) => e.id)).toEqual(["e-a"]);
    as("pat", "a");
    const mine = (await sheetsGet(req("/api/timesheets?scope=mine")).then((r) => r.json())) as Json[];
    expect(mine.map((t) => [t.id, t.totalMinutes, (t._count as Json).entries])).toEqual([["ts-old", 120, 1]]);
    // The B entry is still there, with its own workspace: nothing is deleted.
    expect(db.row("timeEntry", "e-b")).toMatchObject({ organizationId: "b", timesheetId: "ts-old" });
  });
});
