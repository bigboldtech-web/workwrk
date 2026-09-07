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
  | "external" | "cloud" | "actor" | "user" | "gateway" | "decision" | "note";

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
const COL_GAP = 120;   // horizontal gap between layers
const ROW_GAP = 40;    // vertical gap between nodes in a layer
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
    default: return { type: "roundRect", fill: "#FFFFFF" };
  }
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

/** Build a laid-out Canvas scene from a semantic spec. */
export function specToScene(spec: DiagramSpec): CanvasScene {
  const scene = emptyScene();
  const nodes = spec.nodes ?? [];
  const edges = (spec.edges ?? []).filter((e) => e && e.from && e.to);
  if (nodes.length === 0) return scene;

  const layer = layerNodes(nodes, edges);
  const maxLayer = Math.max(0, ...[...layer.values()]);

  // Column-major placement: nodes grouped by layer, stacked vertically. Each
  // column is vertically centred so the diagram looks balanced.
  const byLayer: NodeSpec[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) byLayer[layer.get(n.id) ?? 0].push(n);

  // A node is an ER TABLE when it declares fields.
  const isTable = (n: NodeSpec) => Array.isArray(n.fields) && n.fields.length > 0;
  const hOf = (n: NodeSpec) => (isTable(n) ? tableHeight(n.fields!.length) : NODE_H);
  const colTotalH = byLayer.map((col) => col.reduce((s, n) => s + hOf(n), 0) + Math.max(0, col.length - 1) * ROW_GAP);
  const colHeight = Math.max(1, ...colTotalH);

  const idMap = new Map<string, string>(); // spec id → element id
  const boxOf = new Map<string, { x: number; y: number; w: number; h: number }>();
  const elements: CanvasElement[] = [];

  byLayer.forEach((col, li) => {
    const x = MARGIN + li * (NODE_W + COL_GAP);
    let cy = MARGIN + (colHeight - colTotalH[li]) / 2;
    for (const n of col) {
      const h = hOf(n);
      const id = genId();
      idMap.set(n.id, id);
      boxOf.set(n.id, { x, y: cy, w: NODE_W, h });
      if (isTable(n)) {
        const table: TableElement = {
          id, type: "table", x, y: cy, w: NODE_W, h,
          stroke: "#334155", fill: "#FFFFFF", strokeWidth: 1.5, opacity: 1,
          name: n.label, fields: (n.fields ?? []).map((f) => ({ name: f.name, type: f.type, key: f.key })),
        };
        elements.push(table);
      } else {
        const { type, fill } = styleFor(n.kind);
        elements.push({ id, type, x, y: cy, w: NODE_W, h, stroke: "#1E293B", fill, strokeWidth: 2, opacity: 1, text: n.label, fontSize: 15, align: "center" } as ShapeElement);
      }
      cy += h + ROW_GAP;
    }
  });

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
  const arrows: PathElement[] = [];
  for (const e of edges) {
    const fromId = idMap.get(e.from), toId = idMap.get(e.to);
    if (!fromId || !toId || fromId === toId) continue;
    const a = boxOf.get(e.from)!, b = boxOf.get(e.to)!;
    const start: [number, number] = [a.x + a.w / 2, a.y + a.h / 2];
    const end: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
    const arrow: PathElement = {
      id: genId(), type: "arrow", x: start[0], y: start[1], w: 1, h: 1,
      stroke: "#475569", fill: "transparent", strokeWidth: 2, opacity: 1,
      points: [start, end], fromId, toId, arrowType: "straight",
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
