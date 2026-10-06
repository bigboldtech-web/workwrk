import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./catalog";
import { hueColor, hueForAgent, hueIndex, isTeammateHue, LEGACY_CATALOG_HUE, TEAMMATE_HUES } from "./hues";

describe("the teammate hues", () => {
  it("are the eight user hues, in the token ramp's order", () => {
    expect(TEAMMATE_HUES).toEqual(["sky", "teal", "moss", "sand", "clay", "rose", "slate", "stone"]);
    expect(TEAMMATE_HUES.map(hueIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(hueColor("sky")).toBe("var(--os-status-user-1)");
    expect(hueColor("stone")).toBe("var(--os-status-user-8)");
  });
  it("names only those eight", () => {
    for (const h of TEAMMATE_HUES) expect(isTeammateHue(h)).toBe(true);
    for (const v of ["violet", "blue", "", "Sky", null, 3]) expect(isTeammateHue(v)).toBe(false);
  });
  it("is the list the database CHECK allows", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../prisma/sql/2026-10-06-ai-teammates.sql", import.meta.url)), "utf8");
    const m = /"hue" IN \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    expect(m![1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...TEAMMATE_HUES]);
  });
});

describe("hueForAgent", () => {
  it("maps every hue the catalog uses", () => {
    for (const a of AGENT_CATALOG) expect(isTeammateHue(LEGACY_CATALOG_HUE[a.hue])).toBe(true);
    expect(LEGACY_CATALOG_HUE.violet).toBe("sky");
  });
  it("takes the agent's own hue first, then its catalog entry's, else none", () => {
    expect(hueForAgent({ hue: "clay", slug: "priya-hr" })).toBe("clay");
    expect(hueForAgent({ hue: null, slug: "priya-hr" })).toBe("sky");
    expect(hueForAgent({ hue: "violet", slug: "maya-support-lead" })).toBe("teal");
    expect(hueForAgent({ hue: null, slug: "custom-agent" })).toBeNull();
  });
  it("never reads a slug off Object.prototype", () => {
    expect(hueForAgent({ hue: null, slug: "constructor" })).toBeNull();
    expect(hueForAgent({ hue: undefined, slug: "__proto__" })).toBeNull();
  });
});
