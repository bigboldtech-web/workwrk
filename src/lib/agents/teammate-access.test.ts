import { describe, expect, it } from "vitest";
import type { OrgRole } from "@/lib/access/types";
import {
  agentUsableWhere,
  canCreateTeammate,
  canManageAgent,
  canUseAgent,
  isReservedAgentSlug,
  RESERVED_AGENT_SLUGS,
  teammateSlug,
  type TeammateViewer,
} from "./teammate-access";

const viewer = (userId: string, orgRole: OrgRole, extra: Partial<TeammateViewer> = {}): TeammateViewer => ({
  userId,
  organizationId: "org1",
  orgRole,
  isAgent: false,
  ...extra,
});

const owner = viewer("u-owner", "OWNER");
const admin = viewer("u-admin", "ADMIN");
const max = viewer("u-max", "MEMBER");
const other = viewer("u-other", "MEMBER");
const guest = viewer("u-guest", "GUEST");
const agentAccount = viewer("u-bot", "ADMIN", { isAgent: true });

const maxPrivate = { organizationId: "org1", visibility: "PRIVATE", ownerId: "u-max" };
const workspace = { organizationId: "org1", visibility: "WORKSPACE", ownerId: null };

// The matrix: [viewer, can use, can manage].
type Row = [string, TeammateViewer, boolean, boolean];

describe("a PRIVATE teammate", () => {
  const rows: Row[] = [
    ["its owner", max, true, true],
    ["another member", other, false, false],
    ["an Admin", admin, false, false],
    ["the Owner", owner, false, false],
    ["a Guest", guest, false, false],
    ["an agent account", agentAccount, false, false],
  ];
  for (const [who, v, use, manage] of rows) {
    it(`${who}: use ${use}, manage ${manage}`, () => {
      expect(canUseAgent(maxPrivate, v)).toBe(use);
      expect(canManageAgent(maxPrivate, v)).toBe(manage);
    });
  }
  it("is nobody's when its owner is a Guest or an agent account now", () => {
    const owned = { ...maxPrivate, ownerId: "u-guest" };
    expect(canUseAgent(owned, guest)).toBe(false);
    expect(canUseAgent({ ...maxPrivate, ownerId: "u-bot" }, agentAccount)).toBe(false);
  });
});

describe("a WORKSPACE teammate", () => {
  const rows: Row[] = [
    ["a member", max, true, false],
    ["an Admin", admin, true, true],
    ["the Owner", owner, true, true],
    ["a Guest", guest, false, false],
    ["an agent account with an Admin role", agentAccount, false, false],
  ];
  for (const [who, v, use, manage] of rows) {
    it(`${who}: use ${use}, manage ${manage}`, () => {
      expect(canUseAgent(workspace, v)).toBe(use);
      expect(canManageAgent(workspace, v)).toBe(manage);
    });
  }
});

describe("what neither rule ever allows", () => {
  it("another workspace's teammate", () => {
    const elsewhere = viewer("u-max", "OWNER", { organizationId: "org2" });
    expect(canUseAgent(maxPrivate, elsewhere)).toBe(false);
    expect(canUseAgent(workspace, elsewhere)).toBe(false);
    expect(canManageAgent(workspace, elsewhere)).toBe(false);
  });
  it("a person who is gone or deactivated", () => {
    expect(canUseAgent(maxPrivate, viewer("u-max", "MEMBER", { deleted: true }))).toBe(false);
    expect(canUseAgent(workspace, viewer("u-max", "MEMBER", { status: "INACTIVE" }))).toBe(false);
    expect(canUseAgent(workspace, viewer("u-max", "MEMBER", { status: "ON_LEAVE" }))).toBe(true);
  });
  it("sharing a teammate whose visibility it does not know", () => {
    const odd = { organizationId: "org1", visibility: "TEAM", ownerId: "u-max" };
    expect(canUseAgent(odd, other)).toBe(false);
    expect(canUseAgent(odd, admin)).toBe(false);
    expect(canUseAgent(odd, max)).toBe(true);
    expect(canUseAgent({ ...odd, visibility: null, ownerId: null }, max)).toBe(false);
  });
});

describe("agentUsableWhere", () => {
  it("is the workspace's teammates and the person's own", () => {
    expect(agentUsableWhere("u-max")).toEqual({ OR: [{ visibility: "WORKSPACE" }, { ownerId: "u-max" }] });
  });
});

describe("canCreateTeammate", () => {
  it("lets any person make their own, and only the Owner and Admins share one", () => {
    expect(canCreateTeammate(max, "PRIVATE")).toBe("ok");
    expect(canCreateTeammate(max, "WORKSPACE")).toBe("needs_admin");
    expect(canCreateTeammate(admin, "WORKSPACE")).toBe("ok");
    expect(canCreateTeammate(owner, "WORKSPACE")).toBe("ok");
  });
  it("refuses a Guest and an agent account", () => {
    expect(canCreateTeammate(guest, "PRIVATE")).toBe("guest");
    expect(canCreateTeammate(agentAccount, "PRIVATE")).toBe("agent_account");
    expect(canCreateTeammate(agentAccount, "WORKSPACE")).toBe("agent_account");
  });
});

describe("slugs", () => {
  // The slug filter the run history accepts (run-query.ts parseRunQuery).
  const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

  it("reserves the static segments beside /api/agents/[slug]", () => {
    expect([...RESERVED_AGENT_SLUGS]).toEqual(["runs", "teammates", "actions", "memories", "routines"]);
    for (const s of RESERVED_AGENT_SLUGS) expect(isReservedAgentSlug(s)).toBe(true);
    expect(isReservedAgentSlug("priya-hr")).toBe(false);
  });
  it("gives a PRIVATE teammate t-<name>-<6 random>", () => {
    const a = teammateSlug("Weekly reporter", "PRIVATE");
    const b = teammateSlug("Weekly reporter", "PRIVATE");
    expect(a).toMatch(/^t-weekly-reporter-[a-z0-9]{6}$/);
    expect(a).not.toBe(b);
    expect(teammateSlug("Ассистент", "PRIVATE")).toMatch(/^t-teammate-[a-z0-9]{6}$/);
  });
  it("keeps a long name inside the slug rules", () => {
    const s = teammateSlug("A very long name for a teammate that goes on and on - and on and on and on", "PRIVATE");
    expect(s).toMatch(SLUG);
    expect(s).not.toMatch(/--/);
    expect(s.length).toBeLessThanOrEqual(49);
  });
  it("gives a WORKSPACE teammate its name, unless that slug is reserved or a catalog agent's", () => {
    expect(teammateSlug("Weekly reporter", "WORKSPACE")).toBe("weekly-reporter");
    expect(teammateSlug("Runs", "WORKSPACE")).toMatch(/^runs-[a-z0-9]{6}$/);
    expect(teammateSlug("Priya HR", "WORKSPACE")).toMatch(/^priya-hr-[a-z0-9]{6}$/);
    for (const name of ["Weekly reporter", "Runs", "Priya HR", "!!!"]) {
      const s = teammateSlug(name, "WORKSPACE");
      expect(s).toMatch(SLUG);
      expect(isReservedAgentSlug(s)).toBe(false);
    }
  });
});
