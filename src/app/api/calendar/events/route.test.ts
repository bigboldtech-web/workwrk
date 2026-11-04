// GET /api/calendar/events?calendar=team: a manager's view of their reports'
// tasks.
//
// The team read sent every task a report owned or was assigned, with its
// title and its /item link, whatever List it sat in: a PRIVATE List, another
// team's Space. Teams > Workload only ever showed Lists the viewer can read.
// Now a task in a List the manager cannot open is not sent at all. Tried
// against the in-memory store with the access resolver mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "@/lib/item-test-db";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("next-auth", async () => {
  const { legacyTestSession } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => legacyTestSession("u-mgr", "MANAGER", "org-1") };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/item-test-db")).itemTestPrisma }));
// The viewer's tree (reporting-line.ts's walk), set per test.
const team = vi.hoisted(() => ({ tree: ["u-mgr", "u-rep"] }));
vi.mock("@/lib/reporting-line", () => ({ getEffectiveReportTree: async () => team.tree }));
vi.mock("@/lib/access/manager-lines", () => ({ managesNobody: async () => false }));
// Who reports to the viewer here (the Team pill, workspace-status-2 step 2), and what it was asked.
const pill = vi.hoisted(() => ({ reports: [] as unknown[], asked: [] as unknown[][] }));
const U_REP_HERE = { id: "u-rep", managerId: "u-mgr", kind: "anchor", level: "EMPLOYEE", deactivated: false };
vi.mock("@/lib/access/acting-workspace", () => ({
  inWorkspaceWhere: () => ({}),
  reportsHereOf: async (...args: unknown[]) => { pill.asked.push(args.slice(0, 2)); return pill.reports; },
}));
vi.mock("@/lib/assignee-lift", () => ({ liftWithheldListIds: async () => new Set() }));
const readable = new Set<string>();
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromSession: async () => ({}),
  nodeRoleMap: async (_ctx: unknown, _kind: string, ids: string[]) => new Map(ids.map((id) => [id, readable.has(id) ? "VIEW" : "none"])),
}));

import { GET } from "./route";

let db: ItemTestDb;
function task(id: string, boardId: string, ownerId: string, metadata: unknown = null) {
  db.items.push({
    id, title: `Title of ${id}`, organizationId: "org-1", boardId, status: "TO_DO", archivedAt: null, itemType: "TASK",
    ownerId, assigneeIds: [], startAt: null, dueAt: new Date("2026-09-16T00:00:00Z"), metadata,
  });
}

beforeEach(() => {
  team.tree = ["u-mgr", "u-rep"];
  pill.reports = [U_REP_HERE];
  pill.asked = [];
  readable.clear();
  db = installItemTestDb(itemTestDb());
  db.prisma.user = { findFirst: async () => ({ id: "u-rep" }), findMany: async () => [] };
  db.prisma.userDottedLine = { findFirst: async () => null };
  db.prisma.timeEntry = { findMany: async () => [] };
});

async function events(calendar: "team" | "my") {
  const res = await GET(new Request(`http://x/api/calendar/events?calendar=${calendar}&kinds=task,external&from=2026-09-14T00:00:00Z&to=2026-09-21T00:00:00Z`));
  const body = (await res.json()) as { events: Array<{ id: string; title: string; url: string | null; busyOnly?: boolean }>; calendar: string };
  expect(body.calendar).toBe(calendar);
  return body.events;
}

describe("the team calendar's tasks", () => {
  it("sends a report's task only from a List the manager can open", async () => {
    readable.add("b-shared");
    task("t-shared", "b-shared", "u-rep");
    task("t-private", "b-private", "u-rep");
    const got = await events("team");
    expect(got.map((e) => e.id)).toEqual(["item:t-shared"]);
    expect(JSON.stringify(got)).not.toContain("t-private");
  });

  it("keeps the manager's own task wherever it sits", async () => {
    task("t-mine", "b-private", "u-mgr");
    expect((await events("team")).map((e) => e.id)).toEqual(["item:t-mine"]);
  });

  it("shows a report's synced Google block in an unreadable List as Busy, with no title or link", async () => {
    task("t-gcal", "b-private", "u-rep", { legacyTask: { externalSource: "GCAL", externalId: "g-1" } });
    const [e] = await events("team");
    expect(e).toMatchObject({ id: "item:t-gcal", title: "Busy", url: null, busyOnly: true });
  });

  it("does not narrow My calendar", async () => {
    task("t-mine", "b-private", "u-mgr");
    expect((await events("my")).map((e) => e.id)).toEqual(["item:t-mine"]);
  });
});

describe("the Team pill (docs/plans/workspace-status-2.md step 2)", () => {
  const pillFor = async () => {
    const res = await GET(new Request("http://x/api/calendar/events?calendar=my&kinds=task&from=2026-09-14T00:00:00Z&to=2026-09-21T00:00:00Z"));
    return ((await res.json()) as { hasTeam: boolean }).hasTeam;
  };

  it("asks who reports to the viewer in this workspace, by the lines here", async () => {
    // Nobody reports to the viewer here. Before: the pill read every
    // account's line (prisma.user.findFirst by managerId, which this store
    // answers with u-rep), so a report in another workspace gave a Team pill here.
    pill.reports = [];
    expect(await pillFor()).toBe(false);
    expect(pill.asked).toContainEqual(["org-1", ["u-mgr"]]);
    pill.reports = [U_REP_HERE];
    expect(await pillFor()).toBe(true);
  });
});

describe("the Team calendar's People (docs/plans/workspace-status-2.md step 9, the live proof's L46)", () => {
  // Each person as Postgres answers the reads: by id, and by workspace when
  // the read names one. Pat's account is anchored in org-2 (A); she works in
  // org-1 (B) through a membership, as a report of the viewer there. Rex's
  // membership in org-1 was removed.
  const since = new Date("2025-01-01");
  const person = (id: string, firstName: string, organizationId: string) => ({
    id, firstName, lastName: "Ng", email: `${id}@x.test`, avatar: null, organizationId, ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE",
    deletedAt: null, departmentId: null, roleId: null, officeId: null, joinDate: since, createdAt: since,
  });
  const people = [person("u-mgr", "Dana", "org-1"), person("u-rep", "Lee", "org-1"), person("u-pat", "Pat", "org-2"), person("u-rex", "Rex", "org-2")];
  const seat = (userId: string, removedAt: Date | null) => ({
    userId, organizationId: "org-1", role: "EMPLOYEE", status: "ACTIVE", removedAt, departmentId: null, roleId: null, officeId: null, joinDate: null, createdAt: since, isPrimary: false,
  });
  const seats = [seat("u-pat", null), seat("u-rex", new Date("2026-10-01"))];
  type Where = { id?: { in?: string[] }; userId?: { in?: string[] }; organizationId?: string };

  beforeEach(() => {
    team.tree = ["u-mgr", "u-rep", "u-pat", "u-rex"];
    db.prisma.user = {
      findFirst: async () => ({ id: "u-rep" }),
      findMany: async (args?: Record<string, unknown>) => {
        const where = args?.where as Where | undefined;
        return people.filter((p) => (where?.id?.in ?? []).includes(p.id) && (where?.organizationId === undefined || p.organizationId === where.organizationId));
      },
    };
    db.prisma.organizationMembership = {
      findMany: async (args?: Record<string, unknown>) => {
        const where = args?.where as Where | undefined;
        return seats.filter((m) => m.organizationId === where?.organizationId && (where?.userId?.in ?? []).includes(m.userId));
      },
    };
  });

  it("gives a report here through a membership a row, and never someone whose seat here was removed", async () => {
    // Before: the rows were read as `{ id: { in }, organizationId: orgId }`,
    // the people anchored here only, so Dana's Team calendar in B had no row
    // for Pat (her account is A's) though the tree held her.
    const res = await GET(new Request("http://x/api/calendar/events?calendar=team&kinds=task&from=2026-09-14T00:00:00Z&to=2026-09-21T00:00:00Z"));
    const body = (await res.json()) as { calendar: string; people: Array<{ id: string; name: string }> };
    expect(body.calendar).toBe("team");
    expect(body.people.map((p) => p.id)).toEqual(["u-mgr", "u-rep", "u-pat"]);
    expect(body.people.find((p) => p.id === "u-pat")?.name).toBe("Pat Ng");
  });
});
