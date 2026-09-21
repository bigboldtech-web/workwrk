import { describe, it, expect } from "vitest";
import {
  containerMenuRows,
  containerPath,
  containerNoun,
  collapseSeparators,
  roleAtLeast,
  type ContainerMenuEntry,
} from "./container-menu";

function actions(entries: ContainerMenuEntry[]): string[] {
  return entries.filter((e) => e.kind === "row").map((e) => (e as { action: string }).action);
}

describe("containerMenuRows", () => {
  it("gives a Full access holder every row on each kind", () => {
    const space = actions(containerMenuRows({ kind: "space", role: "full" }));
    expect(space).toEqual([
      "favorite", "pin-top", "new", "rename", "copy-link", "color", "share", "features",
      "templates", "automations", "mute", "hide", "move", "duplicate", "archive", "delete",
    ]);

    const folder = actions(containerMenuRows({ kind: "folder", role: "full" }));
    expect(folder).toEqual([
      "favorite", "pin-top", "new", "rename", "copy-link", "color", "share", "about",
      "templates", "automations", "move", "duplicate", "archive", "delete",
    ]);

    const list = actions(containerMenuRows({ kind: "list", role: "full" }));
    expect(list).toEqual([
      "favorite", "pin-top", "rename", "copy-link", "color", "share", "statuses", "fields",
      "default-type", "about", "templates", "automations", "mute",
      "move", "duplicate", "archive", "delete",
    ]);
  });

  // The default used to be "full", and three of the five hosts passed nothing,
  // so a Can view member was offered Rename / Move / Duplicate / Archive /
  // Delete on containers whose API answers 403.
  it("defaults to the reader's menu when a host passes no role", () => {
    for (const kind of ["space", "folder", "list"] as const) {
      expect(actions(containerMenuRows({ kind }))).toEqual(
        actions(containerMenuRows({ kind, role: "view" })),
      );
    }
    expect(actions(containerMenuRows({ kind: "space" }))).not.toContain("delete");
  });

  it("never offers a List a New submenu (a List has no children)", () => {
    expect(actions(containerMenuRows({ kind: "list", role: "full" }))).not.toContain("new");
  });

  it("hides management rows from Can edit and reads Share as Who has access", () => {
    const rows = containerMenuRows({ kind: "list", role: "edit" });
    const a = actions(rows);
    expect(a).toContain("favorite");
    expect(a).toContain("copy-link");
    expect(a).toContain("about");
    expect(a).toContain("automations");
    expect(a).not.toContain("rename");
    expect(a).not.toContain("delete");
    expect(a).not.toContain("statuses");
    const share = rows.find((r) => r.kind === "row" && r.action === "share");
    expect(share && share.kind === "row" && share.label).toBe("Who has access");
  });

  it("reads Share as Share for a Can edit holder when toggle 4 is on", () => {
    const rows = containerMenuRows({ kind: "space", role: "edit", editorsCanShare: true });
    const share = rows.find((r) => r.kind === "row" && r.action === "share");
    expect(share && share.kind === "row" && share.label).toBe("Share");
  });

  it("leaves a Can view holder Copy link, Who has access, Favorite and Pin to top only", () => {
    const a = actions(containerMenuRows({ kind: "folder", role: "view" }));
    expect(a).toEqual(["favorite", "pin-top", "copy-link", "share", "about"]);
  });

  it("drops Delete when the org toggle is off and for Agents", () => {
    expect(actions(containerMenuRows({ kind: "space", role: "full", canDelete: false }))).not.toContain("delete");
    const agent = actions(containerMenuRows({ kind: "space", role: "full", isAgent: true }));
    expect(agent).not.toContain("delete");
    expect(agent).not.toContain("share");
    // Archive stays: an Agent may still tidy, it just cannot destroy or share.
    expect(agent).toContain("archive");
  });

  it("marks only Delete destructive, and puts it last", () => {
    const rows = containerMenuRows({ kind: "list", role: "full" });
    const destructive = rows.filter((r) => r.kind === "row" && r.destructive);
    expect(destructive).toHaveLength(1);
    const last = rows[rows.length - 1];
    expect(last.kind === "row" && last.action).toBe("delete");
  });

  it("flips the favorite label", () => {
    const on = containerMenuRows({ kind: "space", role: "full", isFavorite: true })[0];
    expect(on.kind === "row" && on.label).toBe("Remove from favorites");
    const off = containerMenuRows({ kind: "space", role: "full" })[0];
    expect(off.kind === "row" && off.label).toBe("Add to favorites");
  });

  it("never emits a leading, trailing or doubled separator at any role", () => {
    for (const kind of ["space", "folder", "list"] as const) {
      for (const role of ["view", "comment", "edit", "full"] as const) {
        const rows = containerMenuRows({ kind, role });
        expect(rows[0]?.kind).toBe("row");
        expect(rows[rows.length - 1]?.kind).toBe("row");
        for (let i = 1; i < rows.length; i += 1) {
          if (rows[i].kind === "separator") expect(rows[i - 1].kind).toBe("row");
        }
      }
    }
  });
});

describe("collapseSeparators", () => {
  it("removes the empty rules a hidden block leaves behind", () => {
    const out = collapseSeparators([
      { kind: "separator" },
      { kind: "separator" },
      { kind: "row", action: "favorite", label: "Add to favorites" },
      { kind: "separator" },
      { kind: "separator" },
      { kind: "row", action: "copy-link", label: "Copy link" },
      { kind: "separator" },
    ]);
    expect(out.map((e) => e.kind)).toEqual(["row", "separator", "row"]);
  });
});

describe("containerPath", () => {
  it("copies a List link on the slug route, not the id (audit High #1)", () => {
    expect(containerPath({ kind: "list", id: "b1", slug: "design-tasks" })).toBe("/boards/design-tasks");
  });
  it("copies a Space link on its slug", () => {
    expect(containerPath({ kind: "space", id: "s1", slug: "design" })).toBe("/spaces/design");
  });
  it("copies a Folder link on its id, which is its route", () => {
    expect(containerPath({ kind: "folder", id: "f1" })).toBe("/folders/f1");
  });
  it("returns null rather than a broken link when a slug is missing", () => {
    expect(containerPath({ kind: "list", id: "b1" })).toBeNull();
    expect(containerPath({ kind: "space", id: "s1", slug: null })).toBeNull();
  });
});

describe("roleAtLeast / containerNoun", () => {
  it("orders the four object roles", () => {
    expect(roleAtLeast("full", "edit")).toBe(true);
    expect(roleAtLeast("edit", "full")).toBe(false);
    expect(roleAtLeast("comment", "view")).toBe(true);
    expect(roleAtLeast("view", "comment")).toBe(false);
  });
  it("never says board", () => {
    expect(containerNoun("list")).toBe("List");
    expect(containerNoun("space")).toBe("Space");
    expect(containerNoun("folder")).toBe("Folder");
  });
});

describe("Pin to top", () => {
  it("reads Pin to top until pinned, then Unpin from top", () => {
    const rows = (isTopPinned: boolean) =>
      containerMenuRows({ kind: "list", role: "view", isTopPinned }).find((e) => e.kind === "row" && e.action === "pin-top");
    expect((rows(false) as { label: string }).label).toBe("Pin to top");
    expect((rows(true) as { label: string }).label).toBe("Unpin from top");
  });
});
