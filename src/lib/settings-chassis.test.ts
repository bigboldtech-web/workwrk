import { describe, expect, it } from "vitest";
import { pickSettingsTab, tagRowFromApi } from "./settings-tabs";
import { canSaveSection, sectionAfterLoad } from "@/hooks/use-settings-section";
import { groupShortcuts } from "./shortcut-groups";
import type { ShortcutDef } from "./shortcuts";

describe("pickSettingsTab", () => {
  const tabs = [{ key: "types" }, { key: "tags" }];
  it("answers the requested tab when the page has it, else the first", () => {
    expect(pickSettingsTab(tabs, "tags")).toBe("tags");
    expect(pickSettingsTab(tabs, "nope")).toBe("types");
    expect(pickSettingsTab(tabs, null)).toBe("types");
    expect(pickSettingsTab([], "tags")).toBeNull();
  });
});

describe("the fetch-failure rule (settings-architecture 8.6)", () => {
  it("a failed read is an error with no data, never a blank form", () => {
    expect(sectionAfterLoad({ ok: false, error: "HTTP 500" })).toEqual({ status: "error", data: null, error: "HTTP 500" });
    expect(sectionAfterLoad({ ok: false, error: "" }).error).toBe("Couldn't load settings");
    expect(sectionAfterLoad({ ok: true, data: { name: "Acme" } })).toEqual({ status: "ready", data: { name: "Acme" }, error: null });
  });
  it("only a loaded section may save", () => {
    expect(canSaveSection({ status: "ready" })).toBe(true);
    expect(canSaveSection({ status: "error" })).toBe(false);
    expect(canSaveSection({ status: "loading" })).toBe(false);
  });
});

describe("tagRowFromApi", () => {
  it("reads the API's real shape (type, _count.assignments)", () => {
    expect(tagRowFromApi({ id: "t", name: "Q3", type: "PROJECT", color: null, description: null, archived: false, _count: { assignments: 4 } })).toEqual({
      id: "t", name: "Q3", type: "PROJECT", color: null, description: null, archived: false, assignmentCount: 4,
    });
    expect(tagRowFromApi({ id: "u", name: "x", type: "CUSTOM", color: "#fff", description: "d", archived: true }).assignmentCount).toBe(0);
  });
});

describe("groupShortcuts (the ? overlay and My settings > Keyboard shortcuts)", () => {
  const def = (id: string, extra: Partial<ShortcutDef> = {}): ShortcutDef => ({ id, keys: "g x", label: id, scope: "global", run: () => {}, ...extra });
  it("groups in the canon order, drops hidden and false-when rows, and skips page scope unless asked", () => {
    const list = [
      def("new", { group: "Create" }),
      def("search", { group: "General" }),
      def("go", { group: "Navigate" }),
      def("alias", { group: "General", hidden: true }),
      def("off", { group: "General", when: () => false }),
      def("page-only", { scope: "page" }),
      def("search", { group: "General" }),
    ];
    expect(groupShortcuts(list).map((g) => [g.name, g.items.map((i) => i.id)])).toEqual([
      ["General", ["search"]],
      ["Navigate", ["go"]],
      ["Create", ["new"]],
    ]);
    expect(groupShortcuts(list, { includePage: true }).at(-1)).toMatchObject({ name: "On this page" });
  });
});
