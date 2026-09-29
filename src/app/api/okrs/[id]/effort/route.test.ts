// Contract test for GET /api/okrs/[id]/effort's "Last moved".
//
// The goals list (GET /api/okrs) says a goal last moved at the newest of task
// activity and a target check-in. The goal page's Effort card read only task
// activity, so a goal moved by check-ins alone said "9h ago" on the list and
// "Never" on its own page. The route now returns lastMovedAt on the list's
// definition, and leaves lastActivityAt task-only (the assess route shares
// computeGoalEffort and must not start counting check-ins). The database and
// the effort math are mocked: the test reads what the route asked for and
// what it answered.

import { beforeEach, describe, expect, it, vi } from "vitest";

let activity: Date | null;
let checkIn: Date | null;
let aggregateWhere: unknown;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oKR: { findFirst: async () => ({ id: "g-1", organizationId: "org-1" }) },
    kRCheckIn: {
      aggregate: async (args: { where: unknown }) => {
        aggregateWhere = args.where;
        return { _max: { createdAt: checkIn } };
      },
    },
  },
}));
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-1" } } }),
  getOrgId: () => "org-1",
  jsonError: (message: string, status: number) => Response.json({ error: message }, { status }),
  jsonSuccess: (data: unknown) => Response.json(data),
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/goal-audience", () => ({ canSeeGoal: async () => true }));
vi.mock("@/lib/goal-effort", () => ({
  computeGoalEffort: async () => ({
    hasLinkedWork: true, linkedKras: 1, linkedBoards: 0, totalHours: 0, hoursThisMonth: 0,
    tasksDone: 0, tasksOpen: 0, lastActivityAt: activity, contributors: [],
  }),
}));

import { GET } from "./route";

async function get() {
  const res = await GET(new Request("http://x/api/okrs/g-1/effort") as never, { params: Promise.resolve({ id: "g-1" }) });
  return (await res.json()) as { lastActivityAt: string | null; lastCheckInAt: string | null; lastMovedAt: string | null };
}

const HOURS_AGO_9 = new Date("2026-09-27T20:04:27.565Z");
const DAYS_AGO_3 = new Date("2026-09-25T10:00:00.000Z");

beforeEach(() => {
  activity = null;
  checkIn = null;
  aggregateWhere = undefined;
});

describe("GET /api/okrs/[id]/effort Last moved", () => {
  it("a goal moved only by a check-in reads that check-in, not Never", async () => {
    checkIn = HOURS_AGO_9;
    const body = await get();
    expect(body.lastMovedAt).toBe(HOURS_AGO_9.toISOString());
    expect(body.lastCheckInAt).toBe(HOURS_AGO_9.toISOString());
    // Task activity stays task-only.
    expect(body.lastActivityAt).toBeNull();
  });

  it("takes the newer of task activity and a check-in, either way round", async () => {
    activity = HOURS_AGO_9; checkIn = DAYS_AGO_3;
    expect((await get()).lastMovedAt).toBe(HOURS_AGO_9.toISOString());
    activity = DAYS_AGO_3; checkIn = HOURS_AGO_9;
    expect((await get()).lastMovedAt).toBe(HOURS_AGO_9.toISOString());
  });

  it("a goal with neither says Never (null)", async () => {
    expect((await get()).lastMovedAt).toBeNull();
  });

  it("reads check-ins of this goal's targets only", async () => {
    await get();
    expect(aggregateWhere).toEqual({ keyResult: { okrId: "g-1" } });
  });
});
