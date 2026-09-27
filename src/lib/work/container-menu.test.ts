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

function accessRow(entries: ContainerMenuEntry[]) {
  const row = entries.find((r) => r.kind === "row" && r.action === "manage-access");
  return row && row.kind === "row" ? row : null;
}

const KINDS = ["space", "folder", "list"] as const;
const ROLES = ["view", "comment", "edit", "full"] as const;

describe("containerMenuRows", () => {
  it("gives a Full access holder every row on each kind", () => {
    const space = actions(containerMenuRows({ kind: "space", role: "full" }));
    expect(space).toEqual([
      "favorite", "pin-top", "new", "rename", "copy-link", "color", "manage-access", "features",
      "templates", "automations", "mute", "hide", "move", "duplicate", "archive", "delete",
    ]);

    const folder = actions(containerMenuRows({ kind: "folder", role: "full" }));
    expect(folder).toEqual([
      "favorite", "pin-top", "new", "rename", "copy-link", "color", "manage-access", "about",
      "templates", "automations", "move", "duplicate", "archive", "delete",
    ]);

    const list = actions(containerMenuRows({ kind: "list", role: "full" }));
    expect(list).toEqual([
      "favorite", "pin-top", "rename", "copy-link", "color", "manage-access", "statuses", "fields",
      "default-type", "default-values", "row-colors", "about", "templates", "automations", "mute",
      "move", "duplicate", "archive", "delete",
    ]);
  });

  // Phase 5b, List comfort: the List's own settings sit with the other List
  // settings, right after Default task type, and only for Full access.
  it("puts Default values and Conditional colors right after Default task type on a Full access List", () => {
    const rows = containerMenuRows({ kind: "list", role: "full" });
    const a = actions(rows);
    const at = a.indexOf("default-type");
    expect(a.slice(at, at + 3)).toEqual(["default-type", "default-values", "row-colors"]);
    const label = (action: string) => rows.find((r) => r.kind === "row" && r.action === action);
    expect(label("default-values")).toMatchObject({ label: "Default values" });
    expect(label("row-colors")).toMatchObject({ label: "Conditional colors" });
  });

  it("never gives Default values or Conditional colors below Full access, nor to a Space or a Folder", () => {
    for (const role of ["edit", "comment", "view"] as const) {
      const a = actions(containerMenuRows({ kind: "list", role }));
      expect(a).not.toContain("default-values");
      expect(a).not.toContain("row-colors");
    }
    for (const kind of ["space", "folder"] as const) {
      const a = actions(containerMenuRows({ kind, role: "full" }));
      expect(a).not.toContain("default-values");
      expect(a).not.toContain("row-colors");
    }
  });

  // The default used to be "full", and three of the five hosts passed nothing,
  // so a Can view member was offered Rename / Move / Duplicate / Archive /
  // Delete on containers whose API answers 403.
  it("defaults to the reader's menu when a host passes no role", () => {
    for (const kind of KINDS) {
      expect(actions(containerMenuRows({ kind }))).toEqual(
        actions(containerMenuRows({ kind, role: "view" })),
      );
    }
    expect(actions(containerMenuRows({ kind: "space" }))).not.toContain("delete");
  });

  // The Work tree passes the server's per-row role, and the server answers
  // null for a row it did not decide (an older server, a path container).
  it("gives the reader's menu for a null role", () => {
    for (const kind of KINDS) {
      expect(containerMenuRows({ kind, role: null })).toEqual(containerMenuRows({ kind, role: "view" }));
    }
  });

  it("never offers a List a New submenu (a List has no children)", () => {
    expect(actions(containerMenuRows({ kind: "list", role: "full" }))).not.toContain("new");
  });

  it("hides management rows from Can edit and reads the access row as Who has access", () => {
    const rows = containerMenuRows({ kind: "list", role: "edit" });
    const a = actions(rows);
    expect(a).toContain("favorite");
    expect(a).toContain("copy-link");
    expect(a).toContain("about");
    expect(a).toContain("automations");
    expect(a).not.toContain("rename");
    expect(a).not.toContain("delete");
    expect(a).not.toContain("statuses");
    expect(accessRow(rows)?.label).toBe("Who has access");
  });

  it("reads Manage access for Full access and Who has access for every other role", () => {
    for (const kind of KINDS) {
      for (const role of ROLES) {
        const label = accessRow(containerMenuRows({ kind, role }))?.label;
        expect(label, `${kind} ${role}`).toBe(role === "full" ? "Manage access" : "Who has access");
      }
    }
  });

  // Toggle 4 is gone from this menu: no host passed it, and a person grant
  // needs Full access on the node, so a Can edit holder offered "Manage
  // access" would meet a dialog whose every control answers 403.
  it("ignores editorsCanShare: Can edit still reads Who has access", () => {
    for (const kind of KINDS) {
      const rows = containerMenuRows({ kind, role: "edit", editorsCanShare: true });
      expect(accessRow(rows)?.label).toBe("Who has access");
      expect(rows).toEqual(containerMenuRows({ kind, role: "edit" }));
    }
  });

  it("puts the access row where Share sat: after Copy link and Color, before the kind's own rows", () => {
    const full = actions(containerMenuRows({ kind: "folder", role: "full" }));
    expect(full.indexOf("manage-access")).toBe(full.indexOf("color") + 1);
    expect(full.indexOf("manage-access")).toBeLessThan(full.indexOf("about"));
    const view = actions(containerMenuRows({ kind: "space", role: "view" }));
    expect(view.indexOf("manage-access")).toBe(view.indexOf("copy-link") + 1);
  });

  it("leaves a Can view holder Copy link, Who has access, Favorite and Pin to top only", () => {
    const a = actions(containerMenuRows({ kind: "folder", role: "view" }));
    expect(a).toEqual(["favorite", "pin-top", "copy-link", "manage-access", "about"]);
  });

  it("drops Delete when the org toggle is off, and Delete and the access row for Agents", () => {
    expect(actions(containerMenuRows({ kind: "space", role: "full", canDelete: false }))).not.toContain("delete");
    for (const kind of KINDS) {
      for (const role of ROLES) {
        const agent = actions(containerMenuRows({ kind, role, isAgent: true }));
        expect(agent).not.toContain("delete");
        expect(agent).not.toContain("manage-access");
      }
    }
    // Archive stays: an Agent may still tidy, it just cannot destroy or share.
    expect(actions(containerMenuRows({ kind: "space", role: "full", isAgent: true }))).toContain("archive");
  });

  // A container reached only on the path to something shared (decision A3):
  // the viewer holds no role on it, so its menu is the one thing every
  // reader of its name may do, whatever role a host thought it had.
  it("gives a path container exactly Copy link, at every kind and role", () => {
    for (const kind of KINDS) {
      for (const role of [...ROLES, null, undefined]) {
        for (const isAgent of [false, true]) {
          const rows = containerMenuRows({ kind, role, isAgent, pathOnly: true, isFavorite: true, isTopPinned: true });
          expect(actions(rows), `${kind} ${role}`).toEqual(["copy-link"]);
          expect(rows.some((r) => r.kind === "row" && r.destructive)).toBe(false);
          expect(rows.some((r) => r.kind === "separator")).toBe(false);
        }
      }
    }
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
    for (const kind of KINDS) {
      for (const role of ROLES) {
        for (const pathOnly of [false, true]) {
          const rows = containerMenuRows({ kind, role, pathOnly });
          expect(rows[0]?.kind).toBe("row");
          expect(rows[rows.length - 1]?.kind).toBe("row");
          for (let i = 1; i < rows.length; i += 1) {
            if (rows[i].kind === "separator") expect(rows[i - 1].kind).toBe("row");
          }
        }
      }
    }
  });

  it("never writes a double hyphen or an em dash in a label", () => {
    for (const kind of KINDS) {
      for (const role of ROLES) {
        for (const e of containerMenuRows({ kind, role, isFavorite: true, isTopPinned: true })) {
          if (e.kind === "row") expect(e.label).not.toMatch(/-{2}|\u2014|\u2013/);
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
