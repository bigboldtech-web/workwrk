import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "@/lib/permissions";
import {
  inviteLevelChoices,
  inviteLevelInChoices,
  inviteLevelOptionText,
  inviteViewerLevel,
} from "./invite-modal";

// The Access level picker in the invite dialog shows one line per level.
// Visible copy never carries an em dash, even though the shared catalog
// still writes a few descriptions with one.
describe("inviteLevelOptionText", () => {
  it("joins the label and description with a colon", () => {
    expect(
      inviteLevelOptionText({ label: "Employee", description: "Standard employees" }),
    ).toBe("Employee: Standard employees");
  });

  it("turns a dash inside a description into a comma", () => {
    expect(
      inviteLevelOptionText({
        label: "Company Admin",
        description: "Org owner — full access (cannot be modified)",
      }),
    ).toBe("Company Admin: Org owner, full access (cannot be modified)");
  });

  it("never renders an em dash, en dash or double hyphen for any real level", () => {
    for (const l of ACCESS_LEVELS) {
      expect(inviteLevelOptionText(l)).not.toMatch(/—|–|-{2}/);
    }
  });
});

// The picker offers only what POST /api/invitations would accept from the
// viewer (resolveInviteLevel), so nobody picks a level that is refused after
// Send, and Company Admin reads as Admin, never as the Owner.
describe("inviteLevelChoices", () => {
  const values = (level: string | null) => inviteLevelChoices(level).map((c) => c.value);

  it("offers a Manager only Manager, Team Lead and Employee", () => {
    expect(values("MANAGER")).toEqual(["MANAGER", "TEAM_LEAD", "EMPLOYEE"]);
  });

  it("offers an Admin every invitable level, Company Admin worded as Admin", () => {
    const choices = inviteLevelChoices("COMPANY_ADMIN");
    expect(choices.map((c) => c.value)).toEqual([
      "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR", "MANAGER", "TEAM_LEAD", "EMPLOYEE",
    ]);
    expect(choices[0].text).toBe("Admin: Full access to the workspace");
    for (const c of choices) expect(c.text).not.toMatch(/Org owner|cannot be modified|—|–|-{2}/);
  });

  it("offers HR every level but Admin", () => {
    expect(values("HR")).not.toContain("COMPANY_ADMIN");
    expect(values("HR")).toContain("HR");
  });

  it("offers an unknown or loading viewer only Employee", () => {
    expect(values(null)).toEqual(["EMPLOYEE"]);
  });

  it("never offers Super Admin or Agent as a rung", () => {
    expect(values("COMPANY_ADMIN")).not.toContain("SUPER_ADMIN");
    expect(values("COMPANY_ADMIN")).not.toContain("AGENT");
  });
});

describe("inviteLevelInChoices", () => {
  const manager = inviteLevelChoices("MANAGER");

  it("keeps a level that is on offer", () => {
    expect(inviteLevelInChoices("TEAM_LEAD", manager)).toBe("TEAM_LEAD");
  });

  it("falls back to Employee when the wanted level is not on offer", () => {
    expect(inviteLevelInChoices("COMPANY_ADMIN", manager)).toBe("EMPLOYEE");
    expect(inviteLevelInChoices("VP", manager)).toBe("EMPLOYEE");
  });
});

describe("inviteViewerLevel", () => {
  it("trusts boot for an Admin", () => {
    expect(inviteViewerLevel("MANAGER", true)).toBe("COMPANY_ADMIN");
  });

  it("does not trust a stale Admin session when boot says otherwise", () => {
    expect(inviteViewerLevel("COMPANY_ADMIN", false)).toBeNull();
  });

  it("uses the session level for everyone else", () => {
    expect(inviteViewerLevel("MANAGER", false)).toBe("MANAGER");
    expect(inviteViewerLevel(undefined, false)).toBeNull();
  });
});
