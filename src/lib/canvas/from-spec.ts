// from-spec — turn a semantic diagram spec (nodes + edges + groups) into a real
// Canvas scene, with an auto-layout. The AI (or a template) emits the spec; this
// module owns geometry + element mapping, so the model only reasons about the
// architecture, never pixels. Pure + dependency-free so it's unit-tested.

import {
  type CanvasScene,
  type CanvasElement,
  type ShapeElement,
  type ShapeType,
  type PathElement,
  type FrameElement,
  type HeadType,
  type TableElement,
  type TableField,
  emptyScene,
  genId,
  reflowConnectors,
  syncPathBounds,
  tableHeight,
} from "./scene";

export type NodeKind =
  | "service" | "component" | "database" | "cache" | "queue"
  | "external" | "cloud" | "actor" | "user" | "gateway" | "decision" | "note"
  // flowchart kinds
  | "start" | "end" | "process" | "io";

export interface NodeSpec {
  id: string; label: string; kind?: NodeKind; group?: string;
  /** For database/ER nodes — makes this an entity TABLE instead of a shape. */
  fields?: TableField[];
}
export interface EdgeSpec { from: string; to: string; label?: string }
export interface GroupSpec { id: string; label?: string }
export interface DiagramSpec {
  title?: string;
  nodes: NodeSpec[];
  edges?: EdgeSpec[];
  groups?: GroupSpec[];
}

const NODE_W = 190;
const NODE_H = 76;
const COL_GAP = 120;   // LR: horizontal gap between layers
const ROW_GAP = 40;    // LR: vertical gap between nodes in a layer
const TB_COL_GAP = 64; // TB: horizontal gap between sibling nodes
const TB_ROW_GAP = 68; // TB: vertical gap between layers (room for arrows/labels)
const MARGIN = 80;     // top/left margin + room for group frames

// kind → shape type + a soft fill so the diagram reads at a glance.
function styleFor(kind: NodeKind | undefined): { type: ShapeType; fill: string } {
  switch (kind) {
    case "database": return { type: "cylinder", fill: "#DBEAFE" };
    case "cache": return { type: "roundRect", fill: "#FEE2E2" };
    case "queue": return { type: "parallelogram", fill: "#DCFCE7" };
    case "external":
    case "cloud": return { type: "cloud", fill: "#EDE9FE" };
    case "actor":
    case "user": return { type: "ellipse", fill: "#E0F2FE" };
    case "gateway":
    case "decision": return { type: "diamond", fill: "#FEF3C7" };
    case "note": return { type: "rect", fill: "#FEF9C3" };
    // flowchart shapes
    case "start":
    case "end": return { type: "roundRect", fill: "#DCFCE7" };   // terminator pill
    case "process": return { type: "rect", fill: "#FFFFFF" };
    case "io": return { type: "parallelogram", fill: "#E0F2FE" };
    default: return { type: "roundRect", fill: "#FFFFFF" };
  }
}

/** One side of a "1:N" / "N:1" / "N:M" / "1:1" cardinality → an ER head.
 *  "1"/"one" → the "one" bar; "N"/"M"/"*"/"many" → the crow's foot. */
function sideHead(token: string | undefined): HeadType {
  const t = (token ?? "").trim().toLowerCase();
  if (/^(n|m|\*|many|\d{2,})$/.test(t) || t === "0..n" || t === "1..n") return "crowsfoot";
  return "bar";
}
function cardinalityHeads(label: string | undefined): { start: HeadType; end: HeadType } | null {
  if (!label) return null;
  const m = label.match(/^\s*([0-9nm*.]+)\s*(?::|-|to|→|—)\s*([0-9nm*.]+)\s*$/i);
  if (!m) return null;
  return { start: sideHead(m[1]), end: sideHead(m[2]) };
}

/** Longest-path layering: each node's layer = the longest chain of edges leading
 *  into it. Sources land in layer 0; cycles are tolerated (iteration is capped). */
function layerNodes(nodes: NodeSpec[], edges: EdgeSpec[]): Map<string, number> {
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const valid = edges.filter((e) => layer.has(e.from) && layer.has(e.to) && e.from !== e.to);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < nodes.length + 2) {
    changed = false;
    for (const e of valid) {
      const want = (layer.get(e.from) ?? 0) + 1;
      if (want > (layer.get(e.to) ?? 0)) { layer.set(e.to, want); changed = true; }
    }
  }
  return layer;
}

/** Build a laid-out Canvas scene from a semantic spec. `direction` "LR" (default)
 *  flows left-to-right (architecture); "TB" flows top-to-bottom (flowcharts). */
export function specToScene(spec: DiagramSpec, opts?: { direction?: "LR" | "TB" }): CanvasScene {
  const scene = emptyScene();
  const nodes = spec.nodes ?? [];
  const edges = (spec.edges ?? []).filter((e) => e && e.from && e.to);
  if (nodes.length === 0) return scene;
  const dir = opts?.direction === "TB" ? "TB" : "LR";

  const layer = layerNodes(nodes, edges);
  const maxLayer = Math.max(0, ...[...layer.values()]);

  // Nodes grouped by layer; each layer laid out along the cross axis and
  // centred so the diagram stays balanced.
  const byLayer: NodeSpec[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) byLayer[layer.get(n.id) ?? 0].push(n);

  // A node is an ER TABLE when it declares fields.
  const isTable = (n: NodeSpec) => Array.isArray(n.fields) && n.fields.length > 0;
  const hOf = (n: NodeSpec) => (isTable(n) ? tableHeight(n.fields!.length) : NODE_H);

  const idMap = new Map<string, string>(); // spec id → element id
  const boxOf = new Map<string, { x: number; y: number; w: number; h: number }>();
  const elements: CanvasElement[] = [];

  const placeNode = (n: NodeSpec, x: number, y: number, h: number) => {
    const id = genId();
    idMap.set(n.id, id);
    boxOf.set(n.id, { x, y, w: NODE_W, h });
    if (isTable(n)) {
      elements.push({
        id, type: "table", x, y, w: NODE_W, h,
        stroke: "#334155", fill: "#FFFFFF", strokeWidth: 1.5, opacity: 1,
        name: n.label, fields: (n.fields ?? []).map((f) => ({ name: f.name, type: f.type, key: f.key })),
      } as TableElement);
    } else {
      const { type, fill } = styleFor(n.kind);
      elements.push({ id, type, x, y, w: NODE_W, h, stroke: "#1E293B", fill, strokeWidth: 2, opacity: 1, text: n.label, fontSize: 15, align: "center" } as ShapeElement);
    }
  };

  if (dir === "TB") {
    // Layers stack top-to-bottom; nodes within a layer spread horizontally.
    const rowTotalW = byLayer.map((row) => row.length * NODE_W + Math.max(0, row.length - 1) * TB_COL_GAP);
    const rowW = Math.max(1, ...rowTotalW);
    let y = MARGIN;
    byLayer.forEach((row, li) => {
      let cx = MARGIN + (rowW - rowTotalW[li]) / 2;
      const rowH = Math.max(NODE_H, ...row.map(hOf));
      for (const n of row) { placeNode(n, cx, y, hOf(n)); cx += NODE_W + TB_COL_GAP; }
      y += rowH + TB_ROW_GAP;
    });
  } else {
    // Layers march left-to-right; nodes within a layer stack vertically.
    const colTotalH = byLayer.map((col) => col.reduce((s, n) => s + hOf(n), 0) + Math.max(0, col.length - 1) * ROW_GAP);
    const colHeight = Math.max(1, ...colTotalH);
    byLayer.forEach((col, li) => {
      const x = MARGIN + li * (NODE_W + COL_GAP);
      let cy = MARGIN + (colHeight - colTotalH[li]) / 2;
      for (const n of col) { placeNode(n, x, cy, hOf(n)); cy += hOf(n) + ROW_GAP; }
    });
  }

  // Groups → frames, inserted at the FRONT (bottom z-order) so nodes sit on top.
  const frames: FrameElement[] = [];
  for (const g of spec.groups ?? []) {
    const members = nodes.filter((n) => n.group === g.id).map((n) => boxOf.get(n.id)).filter(Boolean) as { x: number; y: number; w: number; h: number }[];
    if (members.length === 0) continue;
    const minX = Math.min(...members.map((b) => b.x)) - 24;
    const minY = Math.min(...members.map((b) => b.y)) - 24;
    const maxX = Math.max(...members.map((b) => b.x + b.w)) + 24;
    const maxY = Math.max(...members.map((b) => b.y + b.h)) + 24;
    frames.push({
      id: genId(), type: "frame", x: minX, y: minY, w: maxX - minX, h: maxY - minY,
      stroke: "#94A3B8", fill: "transparent", strokeWidth: 1.5, opacity: 1,
      title: g.label ?? g.id,
    });
  }

  // Edges → arrows bound to both nodes (magnet); reflow snaps them to the edges.
  const tableIds = new Set(nodes.filter(isTable).map((n) => n.id));
  const arrows: PathElement[] = [];
  for (const e of edges) {
    const fromId = idMap.get(e.from), toId = idMap.get(e.to);
    if (!fromId || !toId || fromId === toId) continue;
    const a = boxOf.get(e.from)!, b = boxOf.get(e.to)!;
    const start: [number, number] = [a.x + a.w / 2, a.y + a.h / 2];
    const end: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
    // Between two ER tables, render the relationship with crow's-foot heads
    // read from the cardinality label ("1:N", "N:1", "N:M", "1:1"), not an arrow.
    const erHeads = tableIds.has(e.from) && tableIds.has(e.to) ? cardinalityHeads(e.label) : null;
    const arrow: PathElement = {
      id: genId(), type: "arrow", x: start[0], y: start[1], w: 1, h: 1,
      stroke: "#475569", fill: "transparent", strokeWidth: 2, opacity: 1,
      points: [start, end], fromId, toId, arrowType: "straight",
      ...(erHeads ? { startHead: erHeads.start, endHead: erHeads.end } : {}),
      ...(e.label ? { text: e.label, fontSize: 12 } : {}),
    };
    syncPathBounds(arrow);
    arrows.push(arrow);
  }

  const all: CanvasElement[] = [...frames, ...elements, ...arrows];
  reflowConnectors(all); // anchor every arrow to its shapes' edges
  scene.elements = all;
  return scene;
}
