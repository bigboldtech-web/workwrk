import { describe, expect, it } from "vitest";
import { mayDeleteGoal, mayEditGoal, type GoalRightsActor, type GoalRightsTarget } from "./goal-rights";

// Every kind of person the goals rules touch, as the server builds them.
// "me" manages "report"; "peer" and "stranger" sit outside that chain.
const base: GoalRightsActor = { callerId: "me", admin: false, peopleTeam: false, manager: false, agent: false, chain: null };
const PEOPLE: Record<string, GoalRightsActor> = {
  admin: { ...base, admin: true, manager: true },
  // HR-level People team with no reports: the chain loads, and holds only them.
  peopleTeam: { ...base, peopleTeam: true, manager: true, chain: new Set(["me"]) },
  // A People team member who also manages "report" (HR is a manager tier).
  peopleTeamManager: { ...base, peopleTeam: true, manager: true, chain: new Set(["me", "report"]) },
  // On the configured People team list at the Member level: no manager tier.
  peopleTeamMember: { ...base, peopleTeam: true },
  manager: { ...base, manager: true, chain: new Set(["me", "report"]) },
  managerNoReports: { ...base, manager: true, chain: new Set(["me"]) },
  // A plain Member with a report on the org chart: a report is not an edit grant.
  memberWithReport: { ...base, chain: new Set(["me", "report"]) },
  employee: { ...base },
  agent: { ...base, agent: true },
};

const goal = (level: string, ownerId: string | null, creatorId: string | null = null): GoalRightsTarget => ({ level, ownerId, creatorId });
const GOALS: Record<string, GoalRightsTarget> = {
  companyUnowned: goal("COMPANY", null),
  companyByPeer: goal("COMPANY", "peer"),
  companyOwnedByReport: goal("COMPANY", "report"),
  companyOwnedByMe: goal("COMPANY", "me"),
  companyCreatedByMe: goal("COMPANY", "stranger", "me"),
  companyUnownedCreatedByMe: goal("COMPANY", null, "me"),
  teamOfReport: goal("DEPARTMENT", "report"),
  individualOfReport: goal("INDIVIDUAL", "report"),
  individualOfPeer: goal("INDIVIDUAL", "peer"),
  individualMine: goal("INDIVIDUAL", "me"),
  individualCreatedByMe: goal("INDIVIDUAL", "stranger", "me"),
  teamUnowned: goal("DEPARTMENT", null),
  teamUnownedCreatedByMe: goal("DEPARTMENT", null, "me"),
};

// [person, goal, may edit, may delete]
const TABLE: Array<[keyof typeof PEOPLE, keyof typeof GOALS, boolean, boolean]> = [
  // Owner/Admin: everything.
  ["admin", "companyUnowned", true, true],
  ["admin", "companyByPeer", true, true],
  ["admin", "individualOfPeer", true, true],
  ["admin", "teamUnowned", true, true],
  // People team: edits everything, deletes only what it owns, created or manages.
  ["peopleTeam", "companyUnowned", true, false],
  ["peopleTeam", "companyByPeer", true, false],
  ["peopleTeam", "individualOfPeer", true, false],
  ["peopleTeam", "teamUnowned", true, false],
  ["peopleTeam", "companyOwnedByMe", true, true],
  ["peopleTeam", "teamUnownedCreatedByMe", true, true],
  ["peopleTeam", "individualOfReport", true, false],
  // ...and, as a manager, deletes their own report's Team and Individual goals.
  ["peopleTeamManager", "individualOfReport", true, true],
  ["peopleTeamManager", "teamOfReport", true, true],
  ["peopleTeamManager", "individualOfPeer", true, false],
  ["peopleTeamManager", "companyOwnedByReport", true, false],
  ["peopleTeamManager", "companyUnowned", true, false],
  // A listed People team member edits every goal, deletes only their own.
  ["peopleTeamMember", "companyUnowned", true, false],
  ["peopleTeamMember", "individualOfReport", true, false],
  ["peopleTeamMember", "individualMine", true, true],
  // A plain manager: never a Company goal they do not own.
  ["manager", "companyUnowned", false, false],
  ["manager", "companyByPeer", false, false],
  ["manager", "companyOwnedByReport", false, false],
  ["manager", "companyCreatedByMe", false, false],
  ["manager", "companyUnownedCreatedByMe", false, false],
  ["manager", "companyOwnedByMe", true, true],
  // ...their report's Team and Individual goals, yes; a peer's, no.
  ["manager", "teamOfReport", true, true],
  ["manager", "individualOfReport", true, true],
  ["manager", "individualOfPeer", false, false],
  ["manager", "individualMine", true, true],
  ["manager", "individualCreatedByMe", true, true],
  // ...and an unowned goal only when they created it (was: every manager).
  ["manager", "teamUnowned", false, false],
  ["manager", "teamUnownedCreatedByMe", true, true],
  ["managerNoReports", "individualOfReport", false, false],
  ["managerNoReports", "teamUnowned", false, false],
  // A Member with a report on the chart, no manager tier: own and created only.
  ["memberWithReport", "individualOfReport", false, false],
  ["memberWithReport", "individualMine", true, true],
  ["memberWithReport", "companyUnowned", false, false],
  // An employee with no reports.
  ["employee", "individualMine", true, true],
  ["employee", "individualOfPeer", false, false],
  ["employee", "companyUnowned", false, false],
  ["employee", "companyOwnedByMe", true, true],
  ["employee", "individualCreatedByMe", true, true],
  ["employee", "teamUnowned", false, false],
  // An Agent edits what a Member may, and never deletes a goal.
  ["agent", "individualMine", true, false],
  ["agent", "individualOfPeer", false, false],
];

describe("goal edit and delete rights (spec-goals section 1 Access)", () => {
  it.each(TABLE)("%s on %s: edit %s, delete %s", (person, g, edit, del) => {
    expect(mayEditGoal(PEOPLE[person], GOALS[g])).toBe(edit);
    expect(mayDeleteGoal(PEOPLE[person], GOALS[g])).toBe(del);
  });

  it("never lets delete reach wider than edit", () => {
    for (const p of Object.values(PEOPLE)) {
      for (const g of Object.values(GOALS)) {
        if (mayDeleteGoal(p, g)) expect(mayEditGoal(p, g)).toBe(true);
      }
    }
  });

  it("reads the chain only for the manager tier", () => {
    const chainOnly = { ...base, chain: new Set(["me", "report"]) };
    expect(mayEditGoal(chainOnly, GOALS.individualOfReport)).toBe(false);
    expect(mayEditGoal({ ...chainOnly, manager: true }, GOALS.individualOfReport)).toBe(true);
  });
});
