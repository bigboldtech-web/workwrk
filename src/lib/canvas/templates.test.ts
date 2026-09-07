import { describe, expect, it } from "vitest";
import { CANVAS_TEMPLATES } from "./templates";
import { specToScene } from "./from-spec";

describe("canvas templates", () => {
  it("every template lays out into a non-empty, bound scene", () => {
    for (const t of CANVAS_TEMPLATES) {
      const scene = specToScene(t.spec);
      expect(scene.elements.length, t.id).toBeGreaterThan(0);
      // every arrow resolves to real elements
      const ids = new Set(scene.elements.map((e) => e.id));
      for (const el of scene.elements) {
        if (el.type !== "arrow") continue;
        expect(el.fromId && ids.has(el.fromId), `${t.id} arrow.from`).toBe(true);
        expect(el.toId && ids.has(el.toId), `${t.id} arrow.to`).toBe(true);
      }
    }
  });

  it("the ER template produces real tables with crow's-foot cardinality", () => {
    const er = CANVAS_TEMPLATES.find((t) => t.id === "er-schema")!;
    const scene = specToScene(er.spec);
    const tables = scene.elements.filter((e) => e.type === "table");
    expect(tables.length).toBe(4);
    const rels = scene.elements.filter((e) => e.type === "arrow");
    expect(rels.length).toBe(3);
    // N:1 → many on the child side, one on the parent side
    expect(rels.every((r) => (r as { startHead?: string }).startHead === "crowsfoot")).toBe(true);
    expect(rels.every((r) => (r as { endHead?: string }).endHead === "bar")).toBe(true);
  });
});
