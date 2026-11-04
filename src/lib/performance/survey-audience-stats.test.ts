// The "N of M answered, R% response rate" numbers on a survey's results
// header and the survey list. The audience is counted live but answers are
// kept, so a respondent who later left the audience (changed department,
// lost a tag, left the company) used to make "1 of 0 answered, 0% response
// rate". The database is mocked: the test reads what the helper asked for.
//
// Since docs/plans/workspace-status-2.md step 8 (E15) the audience is read
// in two halves (the people anchored here by their department, the people
// here through a live membership by theirs). Since its review (L2) the
// audience is COUNTED in each half (the survey list runs this per row), and
// only the respondents are read, by id, against the same two halves. The
// mock answers the counts and the respondent reads, and the test holds the
// shape of each.

import { beforeEach, describe, expect, it, vi } from "vitest";

/** The people anchored here in the department, and the people here through a membership placed in it. */
let anchored: string[];
let throughMembership: string[];
let responders: string[];
let reads: Array<{ model: string; op: string; where: Record<string, unknown> }>;
/** The ids a read narrows to (`id: { in }` on User, `userId: { in }` on a membership), or null for none. */
const among = (where: Record<string, unknown>, key: "id" | "userId") => ((where[key] as { in?: string[] } | undefined)?.in ?? null);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: async (args: { where: Record<string, unknown> }) => {
        reads.push({ model: "user", op: "count", where: args.where });
        return anchored.length;
      },
      findMany: async (args: { where: Record<string, unknown> }) => {
        reads.push({ model: "user", op: "findMany", where: args.where });
        const only = among(args.where, "id");
        return anchored.filter((id) => !only || only.includes(id)).map((id) => ({ id }));
      },
    },
    organizationMembership: {
      count: async (args: { where: Record<string, unknown> }) => {
        reads.push({ model: "organizationMembership", op: "count", where: args.where });
        return throughMembership.length;
      },
      findMany: async (args: { where: Record<string, unknown> }) => {
        reads.push({ model: "organizationMembership", op: "findMany", where: args.where });
        const only = among(args.where, "userId");
        return throughMembership.filter((id) => !only || only.includes(id)).map((userId) => ({ userId }));
      },
    },
    surveyResponse: { findMany: async () => responders.map((userId) => ({ userId })) },
  },
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/user-tags", () => ({ getUserTagIds: async () => [], resolveUserIdsByTags: async () => [] }));

import { surveyAudienceStats, surveyAudienceStatsFrom } from "./survey.server";

const survey = { id: "s-1", audienceType: "DEPARTMENTS", officeIds: [], departmentIds: ["d-gone"], userIds: [], tagIds: [] };

beforeEach(() => {
  anchored = [];
  throughMembership = [];
  responders = [];
  reads = [];
});

const ANCHORED_WHERE = { organizationId: "org-1", deletedAt: null, departmentId: { in: ["d-gone"] } };
const MEMBERSHIP_WHERE = { organizationId: "org-1", status: { not: "INACTIVE" }, removedAt: null, user: { organizationId: { not: "org-1" }, deletedAt: null, status: { not: "INACTIVE" } }, departmentId: { in: ["d-gone"] } };

/** The audience was counted once per half, by the survey's department, at its reach, and no person's row was read for it. */
function expectCountedPerHalf() {
  expect(reads.slice(0, 2)).toEqual([
    { model: "user", op: "count", where: ANCHORED_WHERE },
    { model: "organizationMembership", op: "count", where: MEMBERSHIP_WHERE },
  ]);
}

/** The respondents were read by id against the same two halves, and nothing else. */
function expectRespondentsRead(ids: string[]) {
  expect(reads.slice(2)).toEqual([
    { model: "user", op: "findMany", where: { ...ANCHORED_WHERE, id: { in: ids } } },
    { model: "organizationMembership", op: "findMany", where: { ...MEMBERSHIP_WHERE, userId: { in: ids } } },
  ]);
}

describe("surveyAudienceStatsFrom", () => {
  it("counts a respondent who left the audience as reached, so N never passes M", () => {
    expect(surveyAudienceStatsFrom({ currentAudience: 0, responses: 1, respondersStillInAudience: 0 })).toEqual({ audienceSize: 1, totalResponses: 1, responseRate: 100 });
    expect(surveyAudienceStatsFrom({ currentAudience: 23, responses: 18, respondersStillInAudience: 17 })).toEqual({ audienceSize: 24, totalResponses: 18, responseRate: 75 });
  });
  it("leaves an audience nobody left alone", () => {
    expect(surveyAudienceStatsFrom({ currentAudience: 36, responses: 1, respondersStillInAudience: 1 })).toEqual({ audienceSize: 36, totalResponses: 1, responseRate: 3 });
  });
  it("prints 0 of 0 and 0% only when nobody answered, and never a rate over 100", () => {
    expect(surveyAudienceStatsFrom({ currentAudience: 0, responses: 0, respondersStillInAudience: 0 })).toEqual({ audienceSize: 0, totalResponses: 0, responseRate: 0 });
    // A bad count from the caller (more still in than answered) is clamped.
    expect(surveyAudienceStatsFrom({ currentAudience: 2, responses: 3, respondersStillInAudience: 9 }).responseRate).toBeLessThanOrEqual(100);
  });
});

describe("surveyAudienceStats", () => {
  it("the deleted-department survey reads 1 of 1, 100%", async () => {
    responders = ["u-left"];
    expect(await surveyAudienceStats("org-1", survey)).toEqual({ audienceSize: 1, totalResponses: 1, responseRate: 100 });
    expectCountedPerHalf();
    expectRespondentsRead(["u-left"]);
  });
  it("checks only the respondents against the live audience", async () => {
    anchored = ["u-a1", "u-a2", "u-in"];
    throughMembership = ["u-m1", "u-m2"];
    responders = ["u-in", "u-left"];
    expect(await surveyAudienceStats("org-1", survey)).toEqual({ audienceSize: 6, totalResponses: 2, responseRate: 33 });
    expectCountedPerHalf();
    expectRespondentsRead(["u-in", "u-left"]);
  });
  it("counts a respondent here through a membership placed in the department as still in it", async () => {
    anchored = ["u-a1"];
    throughMembership = ["u-pat"];
    responders = ["u-pat"];
    expect(await surveyAudienceStats("org-1", survey)).toEqual({ audienceSize: 2, totalResponses: 1, responseRate: 50 });
    expectCountedPerHalf();
    expectRespondentsRead(["u-pat"]);
  });
  it("skips the respondent check when nobody answered", async () => {
    anchored = ["u-a1", "u-a2", "u-a3", "u-a4"];
    expect(await surveyAudienceStats("org-1", survey)).toEqual({ audienceSize: 4, totalResponses: 0, responseRate: 0 });
    expectCountedPerHalf();
    expect(reads).toHaveLength(2);
  });
});
