// planGrant and planRemove: every refusal and every plan the Manage access
// dialog can meet, pinned (grant-plan.ts).

import { describe, expect, it } from "vitest";
import { maxGrantFor, planGrant, planRemove, storedRoleFor, type GrantPlanInput } from "./grant-plan";
import type { AccessNodeKind, PanelRole } from "./access-panel";

const base = (over: Partial<GrantPlanInput> = {}): GrantPlanInput => ({
  kind: "folder",
  current: null,
  requested: "EDIT",
  actorMax: "FULL",
  targetActive: true,
  targetInOrg: true,
  ...over,
});

describe("roles per kind", () => {
  it("offers Can comment on a doc and a List only, and Can edit assigned tasks on a List only", () => {
    for (const kind of ["space", "folder", "table", "canvas", "form"] as AccessNodeKind[]) {
      const actorMax = kind === "space" ? "OWNER" : "FULL";
      expect(planGrant(base({ kind, requested: "COMMENT", actorMax })).error, kind).toBe("invalid_role");
      expect(planGrant(base({ kind, requested: "ASSIGNED", actorMax })).error, kind).toBe("invalid_role");
    }
    expect(planGrant(base({ kind: "doc", requested: "COMMENT", actorMax: "EDIT" })).error).toBeUndefined();
    expect(planGrant(base({ kind: "doc", requested: "ASSIGNED", actorMax: "FULL" })).error).toBe("invalid_role");
    // Founder decision 3: the List ladder's two rungs below Can edit.
    expect(planGrant(base({ kind: "list", requested: "COMMENT", actorMax: "FULL" })).error).toBeUndefined();
    expect(planGrant(base({ kind: "list", requested: "ASSIGNED", actorMax: "FULL" })).error).toBeUndefined();
  });

  it("refuses Can view on a table", () => {
    expect(planGrant(base({ kind: "table", requested: "VIEW" })).error).toBe("invalid_role");
    expect(planGrant(base({ kind: "table", requested: "EDIT" })).error).toBeUndefined();
  });

  it("offers the Owner rung on a Space only", () => {
    expect(planGrant(base({ kind: "space", requested: "OWNER", actorMax: "OWNER" })).writeRole).toBe("OWNER");
    for (const kind of ["folder", "list", "doc", "table", "canvas", "form"] as AccessNodeKind[]) {
      expect(planGrant(base({ kind, requested: "OWNER", actorMax: "FULL" })).error, kind).toBe("invalid_role");
    }
  });
});

describe("stored roles", () => {
  it("Full access writes ADMIN and Owner writes OWNER", () => {
    expect(planGrant(base({ kind: "space", requested: "FULL", actorMax: "OWNER" })).writeRole).toBe("ADMIN");
    expect(planGrant(base({ kind: "space", requested: "OWNER", actorMax: "OWNER" })).writeRole).toBe("OWNER");
    expect(planGrant(base({ kind: "folder", requested: "FULL" })).writeRole).toBe("ADMIN");
    expect(planGrant(base({ kind: "list", requested: "EDIT" })).writeRole).toBe("MEMBER");
    expect(planGrant(base({ kind: "canvas", requested: "VIEW" })).writeRole).toBe("GUEST");
    expect(planGrant(base({ kind: "doc", requested: "COMMENT", actorMax: "FULL" })).writeRole).toBe("COMMENT");
  });

  it("Full access keeps an existing OWNER row on a Folder or a List", () => {
    expect(planGrant(base({ kind: "folder", current: "EDIT", currentRow: "OWNER", requested: "FULL" })).writeRole).toBe("OWNER");
    expect(storedRoleFor("list", "FULL", "OWNER")).toBe("OWNER");
    expect(storedRoleFor("space", "FULL", "OWNER")).toBe("ADMIN");
  });
});

describe("refusals", () => {
  it("above_own_role when a Can edit sharer asks for Full access or changes a Full listing on a doc", () => {
    expect(planGrant(base({ kind: "doc", requested: "FULL", actorMax: "EDIT" })).error).toBe("above_own_role");
    expect(planGrant(base({ kind: "doc", current: "FULL", requested: "EDIT", actorMax: "EDIT" })).error).toBe("above_own_role");
    expect(planRemove({ kind: "doc", current: "FULL", actorMax: "EDIT" }).error).toBe("above_own_role");
  });

  it("owner_fixed for a doc, table, canvas or form creator", () => {
    for (const kind of ["doc", "table", "canvas", "form"] as AccessNodeKind[]) {
      expect(planGrant(base({ kind, requested: "EDIT", isObjectOwner: true })).error, kind).toBe("owner_fixed");
      expect(planRemove({ kind, current: null, actorMax: "FULL", isObjectOwner: true }).error, kind).toBe("owner_fixed");
    }
  });

  it("private_note for a note chain", () => {
    expect(planGrant(base({ kind: "doc", notepad: true })).error).toBe("private_note");
    expect(planRemove({ kind: "doc", current: "EDIT", actorMax: "FULL", notepad: true }).error).toBe("private_note");
  });

  it("not_in_org on add and on change, never on remove", () => {
    expect(planGrant(base({ targetInOrg: false })).error).toBe("not_in_org");
    expect(planGrant(base({ current: "VIEW", targetInOrg: false })).error).toBe("not_in_org");
    expect(planRemove({ kind: "folder", current: "VIEW", actorMax: "FULL" }).error).toBeUndefined();
  });

  it("forbidden when the actor cannot manage the node", () => {
    expect(planGrant(base({ actorMax: null })).error).toBe("forbidden");
    expect(planRemove({ kind: "folder", current: "VIEW", actorMax: null }).error).toBe("forbidden");
  });

  it("conflict when expected differs from current", () => {
    expect(planGrant(base({ current: "VIEW", expected: "EDIT", requested: "FULL" })).error).toBe("conflict");
    expect(planGrant(base({ current: "VIEW", expected: null })).error).toBe("conflict");
    expect(planGrant(base({ current: null, expected: null })).error).toBeUndefined();
    expect(planGrant(base({ current: "VIEW", expected: "VIEW" })).error).toBeUndefined();
    expect(planRemove({ kind: "folder", current: "EDIT", expected: "VIEW", actorMax: "FULL" }).error).toBe("conflict");
  });
});

describe("the last Full holder of a Space", () => {
  const space = (over: Partial<GrantPlanInput> = {}) => base({ kind: "space", actorMax: "OWNER", ...over });

  it("refuses lowering or removing the last active OWNER or ADMIN row", () => {
    expect(planGrant(space({ current: "FULL", currentRow: "ADMIN", requested: "EDIT", spaceFullOthers: 0 })).error).toBe("last_full");
    expect(planGrant(space({ current: "OWNER", currentRow: "OWNER", requested: "VIEW", spaceFullOthers: 0 })).error).toBe("last_full");
    expect(planRemove({ kind: "space", current: "OWNER", currentRow: "OWNER", actorMax: "OWNER", spaceFullOthers: 0, targetActive: true }).error).toBe("last_full");
  });

  it("allows it when another active Full row exists, when the target has left, and OWNER to Full access", () => {
    expect(planGrant(space({ current: "FULL", currentRow: "ADMIN", requested: "EDIT", spaceFullOthers: 1 })).error).toBeUndefined();
    expect(planGrant(space({ current: "FULL", currentRow: "ADMIN", requested: "EDIT", spaceFullOthers: 0, targetActive: false })).error).toBeUndefined();
    expect(planGrant(space({ current: "OWNER", currentRow: "OWNER", requested: "FULL", spaceFullOthers: 0 })).error).toBeUndefined();
    expect(planRemove({ kind: "space", current: "FULL", currentRow: "ADMIN", actorMax: "OWNER", spaceFullOthers: 0, targetActive: false }).error).toBeUndefined();
  });

  it("never fires for an add or a raise, even on a Space with no Full row", () => {
    expect(planGrant(space({ current: null, requested: "VIEW", spaceFullOthers: 0 })).error).toBeUndefined();
    expect(planGrant(space({ current: "VIEW", currentRow: "GUEST", requested: "EDIT", spaceFullOthers: 0 })).error).toBeUndefined();
  });
});

describe("no-ops and notifications", () => {
  it("mode raise is noChange when the current role is at or above the requested one", () => {
    expect(planGrant(base({ current: "FULL", requested: "EDIT", mode: "raise" })).noChange).toBe(true);
    expect(planGrant(base({ current: "EDIT", requested: "EDIT", mode: "raise" })).noChange).toBe(true);
    expect(planGrant(base({ current: "VIEW", requested: "EDIT", mode: "raise" })).noChange).toBe(false);
    expect(planGrant(base({ current: "FULL", requested: "EDIT" })).noChange).toBe(false);
  });

  it("setting the same role is noChange", () => {
    expect(planGrant(base({ current: "EDIT", requested: "EDIT" }))).toMatchObject({ noChange: true, notify: "none" });
  });

  it("removing a missing row is noChange with previousRole null", () => {
    expect(planRemove({ kind: "folder", current: null, actorMax: "FULL" })).toEqual({ store: "FolderMember", previousRole: null, noChange: true });
    expect(planRemove({ kind: "folder", current: null, expected: "COMMENT", actorMax: "FULL" }).noChange).toBe(true);
  });

  it("notifies shared on an add, upgraded on a raise, and nothing on a downgrade, a no-op or a self change", () => {
    expect(planGrant(base({ current: null })).notify).toBe("shared");
    expect(planGrant(base({ current: "VIEW", requested: "EDIT" })).notify).toBe("upgraded");
    expect(planGrant(base({ current: "FULL", requested: "VIEW" })).notify).toBe("none");
    expect(planGrant(base({ current: "EDIT", requested: "EDIT" })).notify).toBe("none");
    expect(planGrant(base({ current: null, self: true })).notify).toBe("none");
    expect(planRemove({ kind: "folder", current: "EDIT", actorMax: "FULL" }).noChange).toBe(false);
  });
});

describe("maxGrantFor", () => {
  it("is null below the manage bar", () => {
    expect(maxGrantFor("folder", "EDIT")).toBeNull();
    expect(maxGrantFor("doc", "COMMENT")).toBeNull();
  });
  it("gives the Owner rung to any Full holder of a Space, and the highest offered role elsewhere", () => {
    expect(maxGrantFor("space", "FULL")).toBe("OWNER");
    expect(maxGrantFor("doc", "EDIT")).toBe("EDIT");
    expect(maxGrantFor("doc", "FULL")).toBe("FULL");
    expect(maxGrantFor("table", "OWNER" as PanelRole)).toBe("FULL");
  });
});
