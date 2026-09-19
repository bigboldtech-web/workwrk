import { describe, expect, it } from "vitest";
import {
  ITEM_ACTION_FLOOR,
  allowsItemAction,
  decideItem,
  denialStatusFor,
  maxItemRole,
  minItemRole,
  type ItemSignals,
} from "./item-role";

const base: ItemSignals = {
  orgAdmin: false,
  guest: false,
  creator: false,
  assignee: false,
  listRole: "none",
  archived: false,
};

describe("decideItem — rule 11, the maximum of every source", () => {
  it("returns none when nothing grants anything (a task is never discoverable)", () => {
    expect(decideItem(base)).toEqual({ role: "none", via: "none", roleBeforeArchive: "none", archived: false });
  });

  it("rule 9: an assignee holding nothing on the List still gets EDIT", () => {
    const d = decideItem({ ...base, assignee: true });
    expect(d.role).toBe("EDIT");
    expect(d.via).toBe("assignee");
  });

  it("rule 5: the creator gets FULL", () => {
    const d = decideItem({ ...base, creator: true });
    expect(d.role).toBe("FULL");
    expect(d.via).toBe("creator");
  });

  it("rule 4: an org admin gets FULL", () => {
    const d = decideItem({ ...base, orgAdmin: true });
    expect(d.role).toBe("FULL");
    expect(d.via).toBe("org-admin");
  });

  it("rule 10: the List's role comes through with its viaObject", () => {
    expect(
      decideItem({ ...base, listRole: "COMMENT", list: { id: "l1", name: "Q4 leads" } }),
    ).toEqual({
      role: "COMMENT",
      via: "list",
      viaObject: { type: "list", id: "l1", name: "Q4 leads" },
      roleBeforeArchive: "COMMENT",
      archived: false,
    });
  });

  it("the highest source wins and names itself: List VIEW plus assignee is EDIT via assignee", () => {
    const d = decideItem({ ...base, listRole: "VIEW", assignee: true, list: { id: "l1", name: "L" } });
    expect(d.role).toBe("EDIT");
    expect(d.via).toBe("assignee");
  });

  it("a List FULL beats an assignee EDIT and keeps the List as the source", () => {
    const d = decideItem({ ...base, listRole: "FULL", assignee: true, list: { id: "l1", name: "L" } });
    expect(d.role).toBe("FULL");
    expect(d.via).toBe("list");
  });
});

describe("decideItem — rule 12, caps take the minimum", () => {
  it("a Guest is capped at EDIT even when the List gives FULL", () => {
    expect(decideItem({ ...base, guest: true, listRole: "FULL" }).role).toBe("EDIT");
  });

  it("an archived task drops to VIEW for a Can edit viewer", () => {
    expect(decideItem({ ...base, assignee: true, archived: true }).role).toBe("VIEW");
  });

  it("an archived task keeps FULL for Full access, so it can still be restored", () => {
    expect(decideItem({ ...base, orgAdmin: true, archived: true }).role).toBe("FULL");
  });

  it("a Guest on an archived task is VIEW, not EDIT", () => {
    expect(decideItem({ ...base, guest: true, listRole: "FULL", archived: true }).role).toBe("VIEW");
  });

  it("no role stays no role whatever the caps say", () => {
    expect(decideItem({ ...base, guest: true, archived: true }).role).toBe("none");
  });

  it("an archived task keeps the pre-cap role on the side, so Restore stays reachable", () => {
    const d = decideItem({ ...base, assignee: true, archived: true });
    expect(d.role).toBe("VIEW");
    expect(d.roleBeforeArchive).toBe("EDIT");
    expect(d.archived).toBe(true);
    expect(allowsItemAction(d, "restore", base)).toBe(true);
    // ...and nothing else on an archived task is writable at Can edit.
    expect(allowsItemAction(d, "edit", base)).toBe(false);
    expect(allowsItemAction(d, "archive", base)).toBe(false);
  });

  it("a Can view viewer cannot restore an archived task either", () => {
    const d = decideItem({ ...base, listRole: "VIEW", archived: true });
    expect(allowsItemAction(d, "restore", base)).toBe(false);
  });
});

describe("allowsItemAction", () => {
  const viewOnly = decideItem({ ...base, listRole: "VIEW" });
  const commenter = decideItem({ ...base, listRole: "COMMENT" });
  const editor = decideItem({ ...base, listRole: "EDIT" });
  const full = decideItem({ ...base, listRole: "FULL" });

  it("Can view reads and nothing else", () => {
    expect(allowsItemAction(viewOnly, "view", base)).toBe(true);
    expect(allowsItemAction(viewOnly, "comment", base)).toBe(false);
    expect(allowsItemAction(viewOnly, "edit", base)).toBe(false);
  });

  it("Can comment posts but does not edit", () => {
    expect(allowsItemAction(commenter, "comment", base)).toBe(true);
    expect(allowsItemAction(commenter, "edit", base)).toBe(false);
  });

  it("Can edit writes, archives, restores, duplicates and moves", () => {
    for (const a of ["edit", "archive", "restore", "duplicate", "move"] as const) {
      expect(allowsItemAction(editor, a, base)).toBe(true);
    }
  });

  it("delete: Full access always, creator with Can edit, nobody else", () => {
    expect(allowsItemAction(full, "delete", base)).toBe(true);
    expect(allowsItemAction(editor, "delete", base)).toBe(false);
    expect(allowsItemAction(editor, "delete", { ...base, creator: true })).toBe(true);
    expect(allowsItemAction(commenter, "delete", { ...base, creator: true })).toBe(false);
  });

  it("an Agent never deletes, however high its role", () => {
    expect(allowsItemAction(full, "delete", { ...base, agent: true })).toBe(false);
    expect(allowsItemAction(editor, "delete", { ...base, agent: true, creator: true })).toBe(false);
  });

  it("no role clears nothing", () => {
    const none = decideItem(base);
    expect(allowsItemAction(none, "view", base)).toBe(false);
  });
});

describe("denialStatusFor — reads never 403 about a task", () => {
  it("no role is 404 for every action, so a 403 can never confirm an id", () => {
    const none = decideItem(base);
    expect(denialStatusFor(none, "view")).toBe(404);
    expect(denialStatusFor(none, "edit")).toBe(404);
    expect(denialStatusFor(none, "delete")).toBe(404);
  });

  it("a refused read is 404 even when the viewer holds a role", () => {
    expect(denialStatusFor(decideItem({ ...base, listRole: "VIEW" }), "view")).toBe(404);
  });

  it("a refused write with a real role is 403 (the stale-tab case)", () => {
    const viewOnly = decideItem({ ...base, listRole: "VIEW" });
    expect(denialStatusFor(viewOnly, "edit")).toBe(403);
    expect(denialStatusFor(viewOnly, "comment")).toBe(403);
  });
});

describe("the ladder itself", () => {
  it("max and min agree with the rank order", () => {
    expect(maxItemRole("VIEW", "EDIT")).toBe("EDIT");
    expect(maxItemRole("FULL", "COMMENT")).toBe("FULL");
    expect(minItemRole("FULL", "COMMENT")).toBe("COMMENT");
    expect(minItemRole("none", "VIEW")).toBe("none");
  });

  it("every action declares a floor", () => {
    expect(Object.keys(ITEM_ACTION_FLOOR).sort()).toEqual(
      ["archive", "comment", "delete", "duplicate", "edit", "move", "restore", "view"],
    );
  });
});
