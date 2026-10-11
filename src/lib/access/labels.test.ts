// The Agent tier is explained in one sentence (AGENT_TIER_BLURB), and every
// screen that explains it shows that sentence: the invite dialog's agent box,
// the Members drawer's Tier row and the Who can do what page. Before, the
// invite dialog called an Agent "a bot or service", the drawer called it
// frontline staff, and the matrix page called it an AI teammate: three
// stories for one tier, two of them untrue.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_TIER_BLURB } from "./labels";
import { RELATIONSHIP_RULES, WORKSPACE_ROLES } from "./permission-matrix";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const SURFACES = [
  "src/components/layout/os/invite-modal.tsx",
  "src/app/(dashboard)/settings/members/member-drawer.tsx",
  "src/lib/access/permission-matrix.ts",
];

describe("AGENT_TIER_BLURB", () => {
  it("says who the tier is for: a person on frontline work", () => {
    expect(AGENT_TIER_BLURB).toMatch(/frontline staff/);
    expect(AGENT_TIER_BLURB).toMatch(/works as a Member/);
  });

  it("never calls an Agent a bot, a service or an AI", () => {
    expect(AGENT_TIER_BLURB).not.toMatch(/\bbot\b|\bservice\b|\bAI\b|teammate|external/i);
  });

  it("names only caps the server enforces for every Agent", () => {
    // Enforced everywhere: item-role.ts (delete), space-create.ts and the
    // engine (create_space), checkManagerCandidate (manager).
    expect(AGENT_TIER_BLURB).toMatch(/can't delete tasks/);
    expect(AGENT_TIER_BLURB).toMatch(/create Spaces/);
    expect(AGENT_TIER_BLURB).toMatch(/be anyone's manager/);
    // Not enforced everywhere, so not promised: the Space, Folder and List
    // rules do not clamp an Agent to Can edit, inviting is the workspace's
    // matrix to give, and a person's own meetings and timesheet CSV stay open.
    expect(AGENT_TIER_BLURB).not.toMatch(/Full access|invite|never exports/i);
    expect(AGENT_TIER_BLURB).toMatch(/most exports/);
  });

  it("is plain copy: no em dash, en dash or double hyphen", () => {
    expect(AGENT_TIER_BLURB).not.toMatch(/\u2014|\u2013|-{2}/);
  });
});

describe("every screen that explains the Agent tier shows the one sentence", () => {
  for (const file of SURFACES) {
    it(`${file} uses AGENT_TIER_BLURB`, () => {
      expect(read(file)).toMatch(/AGENT_TIER_BLURB/);
    });

    it(`${file} carries none of the old stories`, () => {
      const src = read(file);
      expect(src).not.toMatch(/A bot or service that works as a Member/);
      expect(src).not.toMatch(/Agent is for frontline staff\./);
      expect(src).not.toMatch(/An AI teammate: works at the level/);
      expect(src).not.toMatch(/who: "An AI agent"/);
    });
  }

  it("the Who can do what page states the Agent row with it", () => {
    expect(WORKSPACE_ROLES.find((r) => r.role === "Agent")?.summary).toBe(AGENT_TIER_BLURB);
    expect(RELATIONSHIP_RULES.find((r) => r.key === "agent")?.who).toBe("Someone on the Agent tier");
  });
});
