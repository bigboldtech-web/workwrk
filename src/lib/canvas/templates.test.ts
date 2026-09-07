import { describe, expect, it } from "vitest";
import { CANVAS_TEMPLATES } from "./templates";

describe("canvas templates", () => {
  it("every template lays out into a non-empty scene; bound arrows resolve", () => {
    for (const t of CANVAS_TEMPLATES) {
      const scene = t.build();
      expect(scene.elements.length, t.id).toBeGreaterThan(0);
      const ids = new Set(scene.elements.map((e) => e.id));
      for (const el of scene.elements) {
        // sequence-diagram arrows are positioned, not bound — skip those
        if (el.type !== "arrow" || !el.fromId) continue;
        expect(ids.has(el.fromId), `${t.id} arrow.from`).toBe(true);
        expect(el.toId ? ids.has(el.toId) : true, `${t.id} arrow.to`).toBe(true);
      }
    }
  });

  it("the ER template produces real tables with crow's-foot cardinality", () => {
    const er = CANVAS_TEMPLATES.find((t) => t.id === "er-schema")!;
    const scene = er.build();
    const tables = scene.elements.filter((e) => e.type === "table");
    expect(tables.length).toBe(4);
    const rels = scene.elements.filter((e) => e.type === "arrow");
    expect(rels.length).toBe(3);
    // N:1 → many on the child side, one on the parent side
    expect(rels.every((r) => (r as { startHead?: string }).startHead === "crowsfoot")).toBe(true);
    expect(rels.every((r) => (r as { endHead?: string }).endHead === "bar")).toBe(true);
  });

  it("includes flowchart and sequence templates", () => {
    const flow = CANVAS_TEMPLATES.find((t) => t.id === "flowchart")!.build();
    const seq = CANVAS_TEMPLATES.find((t) => t.id === "sequence")!.build();
    // flowchart is bound + top-to-bottom
    expect(flow.elements.some((e) => e.type === "diamond")).toBe(true);
    // sequence has lifelines (lines) + roundRect participants
    expect(seq.elements.filter((e) => e.type === "line").length).toBeGreaterThan(0);
    expect(seq.elements.filter((e) => e.type === "roundRect").length).toBe(4);
  });
});
