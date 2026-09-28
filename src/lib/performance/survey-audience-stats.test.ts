// The "N of M answered, R% response rate" numbers on a survey's results
// header and the survey list. The audience is counted live but answers are
// kept, so a respondent who later left the audience (changed department,
// lost a tag, left the company) used to make "1 of 0 answered, 0% response
// rate". The database is mocked: the test reads what the helper asked for.

import { beforeEach, describe, expect, it, vi } from "vitest";

let audienceCount: number;
let responders: string[];
let stillIn: string[];
let userCountCalls: unknown[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: async (args: { where: { AND?: [unknown, { id: { in: string[] } }] } }) => {
        userCountCalls.push(args.where);
        if (args.where.AND) return args.where.AND[1].id.in.filter((id) => stillIn.includes(id)).length;
        return audienceCount;
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
  audienceCount = 0;
  responders = [];
  stillIn = [];
  userCountCalls = [];
});

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
  });
  it("checks only the respondents against the live audience", async () => {
    audienceCount = 5;
    responders = ["u-in", "u-left"];
    stillIn = ["u-in"];
    expect(await surveyAudienceStats("org-1", survey)).toEqual({ audienceSize: 6, totalResponses: 2, responseRate: 33 });
    expect(userCountCalls).toHaveLength(2);
  });
  it("skips the respondent check when nobody answered", async () => {
    audienceCount = 4;
    expect(await surveyAudienceStats("org-1", survey)).toEqual({ audienceSize: 4, totalResponses: 0, responseRate: 0 });
    expect(userCountCalls).toHaveLength(1);
  });
});
