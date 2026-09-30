import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHORTCUT_REFERENCE } from "./shortcut-reference";
import { SHORTCUTS, parseKeys } from "./shortcuts";

const ROOT = join(__dirname, "..", "..");

describe("the keyboard shortcuts reference", () => {
  it("keeps the spec's scope order", () => {
    expect(SHORTCUT_REFERENCE.map((s) => s.name)).toEqual(["Lists and boards", "Inbox", "Docs", "Tables", "Talk", "Settings"]);
  });

  it("names only chords whose listener still exists in the file it names", () => {
    for (const scope of SHORTCUT_REFERENCE) {
      for (const row of scope.rows) {
        const text = readFileSync(join(ROOT, row.source), "utf8");
        const proof = row.proof ?? `"${row.id}"`;
        expect(text.includes(proof), `${scope.name}: ${row.label} (${row.id}) has no listener in ${row.source}`).toBe(true);
      }
    }
  });

  it("lists every Settings scope chord the spec names", () => {
    const settings = SHORTCUT_REFERENCE.find((s) => s.key === "settings")!;
    expect(settings.rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Find a setting", "Save changes", "Switch tab"]));
    expect(settings.rows.find((r) => r.label === "Save changes")!.note).toBe("On pages with unsaved changes");
    expect(settings.rows.find((r) => r.label === "Switch tab")!.note).toBe("While the tabs are focused");
  });

  it("never advertises a browser-reserved chord", () => {
    const reserved = ["mod+t", "mod+shift+n", "mod+w", "mod+n", "mod+p"];
    for (const scope of SHORTCUT_REFERENCE) {
      for (const row of scope.rows) {
        for (const k of row.keys) {
          expect(reserved).not.toContain(k);
          expect(() => parseKeys(k)).not.toThrow();
        }
      }
    }
    // Anywhere is the canon, which carries the same rule.
    for (const s of SHORTCUTS) expect(reserved).not.toContain(s.keys);
  });
});
