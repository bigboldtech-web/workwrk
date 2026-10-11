// The Apps page's "N people lose access" preview (app-floor-impact.server.ts)
// and the Agent tier (docs-found fixes batch 3). The preview counted anyone
// named as a manager, solid or dotted, as having reports, so an Agent with
// lines stored before rule 6 kept the manager floor there while the engine's
// viewer (reportTree, empty for an Agent) took it away. Both say the same now.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: async () => [
        { id: "mona", firstName: "Mona", lastName: "M", email: null, accessLevel: "MANAGER", managerId: null },
        { id: "sam", firstName: "Sam", lastName: "A", email: null, accessLevel: "AGENT", managerId: "mona" },
        { id: "ida", firstName: "Ida", lastName: "I", email: null, accessLevel: "EMPLOYEE", managerId: "sam" },
        { id: "dee", firstName: "Dee", lastName: "D", email: null, accessLevel: "EMPLOYEE", managerId: null },
      ],
    },
    userDottedLine: { findMany: async () => [{ managerId: "sam" }] },
  },
}));
vi.mock("./facts", () => ({ loadOrgFacts: async () => ({ peopleTeamIds: [] }) }));
vi.mock("./flags", () => ({ accessV2Tables: () => false }));

import { loadImpactPeople } from "./app-floor-impact.server";

describe("loadImpactPeople", () => {
  it("never counts an Agent as having reports, and still counts the manager above them", async () => {
    const people = new Map((await loadImpactPeople("org")).map((p) => [p.id, p.hasReports]));
    expect(people.get("sam")).toBe(false);
    expect(people.get("mona")).toBe(true);
    expect(people.get("ida")).toBe(false);
  });
});
