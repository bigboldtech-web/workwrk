import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "@/lib/permissions";
import { inviteLevelOptionText } from "./invite-modal";

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
