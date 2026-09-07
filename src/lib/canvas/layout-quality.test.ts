// Layout-quality guard: the auto-layout must never overlap two nodes, for any
// of the diagram types, including stressful shapes the AI can realistically
// emit (wide fan-outs, deep chains, decision-heavy flows, big schemas, long
// sequences). A regression here is what makes a generated diagram unreadable.

import { describe, expect, it } from "vitest";
import { specToScene, type DiagramSpec } from "./from-spec";
import { sequenceToScene, type SequenceSpec } from "./sequence";
import { CANVAS_TEMPLATES } from "./templates";
import type { CanvasElement, CanvasScene } from "./scene";

const NODE_TYPES = new Set(["rect", "roundRect", "diamond", "parallelogram", "cylinder", "cloud", "ellipse", "table"]);
const overlap = (a: CanvasElement, b: CanvasElement) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function collisionsIn(scene: CanvasScene, minW = 12): string[] {
  const nodes = scene.elements.filter((e) => NODE_TYPES.has(e.type) && e.w > minW);
  const nm = (e: CanvasElement) => (e as { text?: string; name?: string }).text ?? (e as { name?: string }).name ?? e.type;
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (overlap(nodes[i], nodes[j])) out.push(`${nm(nodes[i])} × ${nm(nodes[j])}`);
  return out;
}

describe("layout quality", () => {
  for (const t of CANVAS_TEMPLATES) {
    it(`template ${t.id}: no node overlaps`, () => {
      const c = collisionsIn(t.build());
      expect(c, c.join("; ")).toHaveLength(0);
    });
  }

  it("wide fan-out (1 → 10) does not overlap", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "root", label: "Gateway", kind: "gateway" }, ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: `Service ${i}`, kind: "service" as const }))],
      edges: Array.from({ length: 10 }, (_, i) => ({ from: "root", to: `s${i}` })),
    };
    const c = collisionsIn(specToScene(spec));
    expect(c, c.join("; ")).toHaveLength(0);
  });

  it("deep + branchy flowchart (TB) does not overlap", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "start", label: "Start", kind: "start" },
        { id: "d1", label: "A?", kind: "decision" }, { id: "p1", label: "Do A", kind: "process" },
        { id: "d2", label: "B?", kind: "decision" }, { id: "p2", label: "Do B", kind: "process" },
        { id: "d3", label: "C?", kind: "decision" }, { id: "p3", label: "Do C", kind: "process" },
        { id: "err", label: "Error", kind: "end" }, { id: "end", label: "Done", kind: "end" },
      ],
      edges: [
        { from: "start", to: "d1" },
        { from: "d1", to: "p1", label: "yes" }, { from: "d1", to: "err", label: "no" },
        { from: "p1", to: "d2" }, { from: "d2", to: "p2", label: "yes" }, { from: "d2", to: "err", label: "no" },
        { from: "p2", to: "d3" }, { from: "d3", to: "p3", label: "yes" }, { from: "d3", to: "err", label: "no" },
        { from: "p3", to: "end" },
      ],
    };
    const c = collisionsIn(specToScene(spec, { direction: "TB" }));
    expect(c, c.join("; ")).toHaveLength(0);
  });

  it("big ER schema (7 tables) does not overlap", () => {
    const tables = ["users", "orgs", "orders", "order_items", "products", "payments", "shipments"];
    const spec: DiagramSpec = {
      nodes: tables.map((t) => ({ id: t, label: t, fields: [{ name: "id", type: "uuid", key: "pk" as const }, { name: "ref", type: "uuid", key: "fk" as const }, { name: "created_at", type: "timestamp" }] })),
      edges: [
        { from: "orders", to: "users", label: "N:1" }, { from: "orders", to: "orgs", label: "N:1" },
        { from: "order_items", to: "orders", label: "N:1" }, { from: "order_items", to: "products", label: "N:1" },
        { from: "payments", to: "orders", label: "N:1" }, { from: "shipments", to: "orders", label: "N:1" },
      ],
    };
    const c = collisionsIn(specToScene(spec));
    expect(c, c.join("; ")).toHaveLength(0);
  });

  it("long sequence: participant boxes don't overlap and activation bars don't stack on a lifeline", () => {
    const spec: SequenceSpec = {
      participants: ["Client", "API", "Auth", "DB", "Cache"],
      messages: [
        { from: "Client", to: "API", label: "req" }, { from: "API", to: "Cache", label: "get" }, { from: "Cache", to: "API", label: "miss", dashed: true },
        { from: "API", to: "Auth", label: "verify" }, { from: "Auth", to: "DB", label: "lookup" }, { from: "DB", to: "Auth", label: "row", dashed: true },
        { from: "Auth", to: "API", label: "ok", dashed: true }, { from: "API", to: "DB", label: "load" }, { from: "DB", to: "API", label: "data", dashed: true },
        { from: "API", to: "Client", label: "200", dashed: true },
      ],
    };
    const scene = sequenceToScene(spec);
    // participant boxes (roundRect) don't overlap
    const boxes = scene.elements.filter((e) => e.type === "roundRect");
    const boxCollisions: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) boxCollisions.push("box×box");
    expect(boxCollisions).toHaveLength(0);
    // activation bars on the SAME lifeline must not overlap each other
    const bars = scene.elements.filter((e) => e.type === "rect");
    const byX = new Map<number, CanvasElement[]>();
    for (const b of bars) { const k = Math.round(b.x); (byX.get(k) ?? byX.set(k, []).get(k)!).push(b); }
    for (const [, group] of byX)
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++)
        expect(overlap(group[i], group[j]), "activation bars overlap on a lifeline").toBe(false);
  });
});
