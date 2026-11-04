// Two rules of a person's record (docs/plans/workspace-status-2.md, the final
// review): Working on is listed for the people who read this workspace's
// profile of someone here through a membership too (product M1), and the
// sentence that their name, sign-in address, phone, photo and birthday are
// shared with another workspace goes only to a viewer who could edit
// something of theirs here (product L2).

import { describe, expect, it } from "vitest";
import { sharedIdentityShown, workingOnShown } from "./person-record";

const person = (access: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "pat",
  deletedAt: null as string | null,
  access: { relation: "chain", peopleData: true, editable: [] as string[], ...access },
  ...extra,
});

describe("Working on (product M1)", () => {
  it("lists the open work of someone here through a membership for their manager here, as for anyone", () => {
    // Pat works in B from A's account: B holds no people data of hers, but Dana reads B's profile of her.
    expect(workingOnShown(person({ relation: "chain", peopleData: false, profileData: true }))).toBe(true);
    // Lee, anchored here: as before.
    expect(workingOnShown(person({ relation: "chain", peopleData: true, profileData: true }))).toBe(true);
    // A server from before step 5 sends no profileData: peopleData decides.
    expect(workingOnShown(person({ relation: "chain", peopleData: true }))).toBe(true);
  });

  it("never for someone who reads nothing of them, on your own record, or for someone removed", () => {
    expect(workingOnShown(person({ relation: "none", peopleData: false, profileData: false }))).toBe(false);
    expect(workingOnShown(person({ relation: "self", peopleData: true, profileData: true }))).toBe(false);
    expect(workingOnShown(person({ relation: "chain", peopleData: false, profileData: true }, { deletedAt: "2026-10-01T00:00:00.000Z" }))).toBe(false);
  });
});

describe("the shared-identity sentence (product L2)", () => {
  it("goes to a viewer who could edit something of theirs here", () => {
    expect(sharedIdentityShown(person({ relation: "chain", editable: ["roleId", "managerId"] }, { profileHere: false }))).toBe(true);
  });

  it("never to a colleague who can change nothing, to the person, or for someone anchored here", () => {
    // Before: every viewer but the person read it, telling each colleague that Pat works elsewhere.
    expect(sharedIdentityShown(person({ relation: "none", editable: [] }, { profileHere: false }))).toBe(false);
    expect(sharedIdentityShown(person({ relation: "chain-view", editable: [] }, { profileHere: false }))).toBe(false);
    expect(sharedIdentityShown(person({ relation: "self", editable: ["firstName"] }, { profileHere: false }))).toBe(false);
    expect(sharedIdentityShown(person({ relation: "chain", editable: ["roleId"] }, { profileHere: true }))).toBe(false);
    expect(sharedIdentityShown(person({ relation: "chain", editable: ["roleId"] }))).toBe(false);
  });
});
