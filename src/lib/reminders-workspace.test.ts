// Which workspace a personal reminder's email goes under
// (src/lib/reminders.ts personalReminderWorkspace): the first live one the
// person is in, so a closed workspace drops it only when all of theirs are.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => {} }));

import { personalReminderWorkspace } from "./reminders";

const person = (anchor: [string, string], members: Array<[string, string]>) => ({
  organizationId: anchor[0],
  organization: { status: anchor[1] },
  organizationMemberships: members.map(([organizationId, status]) => ({ organizationId, organization: { status } })),
});

describe("personalReminderWorkspace", () => {
  it("uses the anchor while it is live", () => {
    expect(personalReminderWorkspace(person(["A", "ACTIVE"], [["B", "ACTIVE"]]), "B")).toBe("A");
  });

  it("uses the workspace it was made in when the anchor is closed and the person is still there", () => {
    expect(personalReminderWorkspace(person(["A", "SUSPENDED"], [["C", "ACTIVE"], ["B", "TRIAL"]]), "B")).toBe("B");
  });

  it("uses any other live workspace when the one it was made in is gone", () => {
    expect(personalReminderWorkspace(person(["A", "CANCELLED"], [["C", "ACTIVE"]]), "B")).toBe("C");
  });

  it("falls back to the anchor (and the gate) when every workspace is closed", () => {
    expect(personalReminderWorkspace(person(["A", "CANCELLED"], [["C", "SUSPENDED"]]), null)).toBe("A");
  });
});
