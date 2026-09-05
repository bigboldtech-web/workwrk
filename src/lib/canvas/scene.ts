// WorkwrK Canvas — the scene model.
//
// Pure, dependency-free data + geometry for the first-party whiteboard. The
// renderer (canvas 2D) and the editor component consume this; nothing here
// touches the DOM, so it is unit-testable in isolation (mirrors the
// src/lib/sheet-engine pattern). The scene is what we persist to
// Whiteboard.scene, versioned so a reader can tell our format from the legacy
// Excalidraw blob (see import-excalidraw.ts).

export const SCENE_VERSION = 1 as const;

export type ElementType =
  | "rect"
  | "ellipse"
  | "diamond"
  | "roundRect"
  | "triangle"
  | "parallelogram"
  | "cylinder"
  | "cloud"
  | "line"
  | "arrow"
  | "freedraw"
  | "text"
  | "sticky"
  | "image"
  | "taskCard"
  | "canvasCard"
  | "frame";

/** Every element carries a world-space bounding box + shared style. */
export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string; // "transparent" for no fill
  strokeWidth: number;
  opacity: number; // 0..1
  /** Line style for the stroke. Absent = "solid" (back-compat). */
  dash?: DashStyle;
  /** Rotation in radians about the element centre. Absent/0 = upright. */
  angle?: number;
}

export type DashStyle = "solid" | "dashed" | "dotted";

/** Canvas line-dash pattern for a stroke style, scaled by stroke width.
 *  Solid = no dashes. Meant for ctx.setLineDash(). */
export function dashPattern(dash: DashStyle | undefined, strokeWidth: number): number[] {
  const w = Math.max(1, strokeWidth);
  if (dash === "dashed") return [w * 3 + 3, w * 2 + 2];
  if (dash === "dotted") return [0.1, w * 2 + 2]; // round cap + ~0 length = dots
  return [];
}

/** Box-geometry shapes (all hit-tested as their bounding box, except the
 *  ellipse which uses the radial test). */
export type ShapeType =
  | "rect" | "ellipse" | "diamond"
  | "roundRect" | "triangle" | "parallelogram" | "cylinder" | "cloud";

export interface ShapeElement extends BaseElement {
  type: ShapeType;
}

/** line / arrow / freedraw — geometry lives in `points` (absolute world).
 *  A line/arrow may also be a CONNECTOR: fromId/toId bind an endpoint to
 *  another element, and the endpoint is recomputed from that element's edge
 *  (reflowConnectors) so the connector follows when the element moves. */
export type ArrowType = "straight" | "elbow" | "curved";

export interface PathElement extends BaseElement {
  type: "line" | "arrow" | "freedraw";
  points: [number, number][];
  fromId?: string;
  toId?: string;
  /** line/arrow routing between endpoints (default straight). */
  arrowType?: ArrowType;
  /** Where a bound end attaches, as an offset from the shape centre normalized
   *  by its half-size (roughly -1..1 per axis). Captured when it binds so the
   *  connection stays on the SIDE/corner you drew to (not snapped to centre)
   *  and follows the shape on move/resize. Absent → auto-anchor toward centre. */
  fromFocus?: [number, number];
  toFocus?: [number, number];
}

/** Orthogonal (elbow) waypoints between two endpoints — an L or Z route. */
export function elbowPoints(a: [number, number], b: [number, number]): [number, number][] {
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
    const mx = (a[0] + b[0]) / 2;
    return [a, [mx, a[1]], [mx, b[1]], b];
  }
  const my = (a[1] + b[1]) / 2;
  return [a, [a[0], my], [b[0], my], b];
}

export type TextAlign = "left" | "center" | "right";

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  /** Horizontal alignment of the text. Absent = "left" (back-compat). */
  align?: TextAlign;
}

export interface StickyElement extends BaseElement {
  type: "sticky";
  text: string;
  fontSize: number;
  align?: TextAlign;
}

export interface ImageElement extends BaseElement {
  type: "image";
  /** Data URL (downscaled on insert to keep the scene a sane size). */
  src: string;
}

/** A live reference to a task (Item). Cached display is stored so the card
 *  renders without a fetch; opening the card navigates to the task. This is
 *  the first "work-graph" element — the canvas joins the work graph. */
export interface TaskCardElement extends BaseElement {
  type: "taskCard";
  itemId: string;
  title: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  meta: string; // small subtitle (due date / board / updated), captured at insert
  /** Open target — a task ("/item/:id"), doc ("/docs/:id"), etc. Falls back
   *  to "/item/:itemId" for legacy task cards. */
  href?: string;
}

/** A live reference to another Canvas, rendered as a thumbnail card that
 *  opens the target Canvas. The canvas-in-canvas node — a Canvas nests inside
 *  another Canvas the way a task/doc card does (Phase D of the primitive plan). */
export interface CanvasCardElement extends BaseElement {
  type: "canvasCard";
  whiteboardId: string;
  title: string;
}

/** A labeled container. Rendered behind other elements; moving it moves the
 *  elements whose centre sits inside it (frameChildren). */
export interface FrameElement extends BaseElement {
  type: "frame";
  title: string;
}

export type CanvasElement =
  | ShapeElement | PathElement | TextElement | StickyElement | ImageElement | TaskCardElement | CanvasCardElement | FrameElement;

export interface Viewport {
  x: number; // pan offset in screen px
  y: number;
  zoom: number;
}

export interface CanvasScene {
  version: typeof SCENE_VERSION;
  viewport: Viewport;
  elements: CanvasElement[];
}

// ── palette ────────────────────────────────────────────────────────────────
// Brand-aligned defaults (no purple; blue is the primary accent).
export const STROKE_COLORS = ["#1E293B", "#0073EA", "#12A150", "#E11D48", "#F59E0B", "#7C3AED", "#0EA5E9"];
export const FILL_COLORS = ["transparent", "#DBEAFE", "#DCFCE7", "#FEE2E2", "#FEF3C7", "#EDE9FE", "#E0F2FE"];
export const STICKY_COLORS = ["#FEF3C7", "#DBEAFE", "#DCFCE7", "#FCE7F3", "#E0E7FF"];

export const DEFAULT_STROKE = STROKE_COLORS[0];
export const DEFAULT_STROKE_WIDTH = 2;
export const DEFAULT_FONT_SIZE = 20;

let idCounter = 0;
/** Stable-ish id: time + counter + random, no external dep. */
export function genId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `el_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyScene(): CanvasScene {
  return { version: SCENE_VERSION, viewport: { x: 0, y: 0, zoom: 1 }, elements: [] };
}

/** A scene is "ours" when it declares our version and carries an array. */
export function isCanvasScene(raw: unknown): raw is CanvasScene {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as CanvasScene).version === SCENE_VERSION &&
    Array.isArray((raw as CanvasScene).elements)
  );
}

/** Deep-ish clone for the undo stack (elements are flat objects + point arrays). */
export function cloneScene(scene: CanvasScene): CanvasScene {
  return {
    version: SCENE_VERSION,
    viewport: { ...scene.viewport },
    elements: scene.elements.map((el) =>
      "points" in el ? { ...el, points: el.points.map((p) => [p[0], p[1]] as [number, number]) } : { ...el },
    ),
  };
}

/** Bounding box of a set of world points, with a small min size. */
export function boundsOfPoints(points: [number, number][]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** Recompute + write the cached bbox of a path element from its points. */
export function syncPathBounds(el: PathElement): void {
  const b = boundsOfPoints(el.points);
  el.x = b.x;
  el.y = b.y;
  el.w = b.w;
  el.h = b.h;
}

/** Normalize a possibly-negative box (drawn up/left) to positive w/h. */
export function normalizeBox(box: { x: number; y: number; w: number; h: number }): {
  x: number; y: number; w: number; h: number;
} {
  let { x, y, w, h } = box;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Is world point (wx,wy) on/in element `el`? `tol` is a world-space slop for
 * thin shapes (scaled by the caller to stay constant on screen at any zoom).
 */
export function hitTest(el: CanvasElement, wx: number, wy: number, tol = 6): boolean {
  // For a rotated box element, test in its LOCAL frame: inverse-rotate the
  // point around the element's centre, then run the axis-aligned tests below.
  if (el.angle && el.type !== "line" && el.type !== "arrow" && el.type !== "freedraw") {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const cos = Math.cos(-el.angle), sin = Math.sin(-el.angle);
    const dx = wx - cx, dy = wy - cy;
    wx = cx + dx * cos - dy * sin;
    wy = cy + dx * sin + dy * cos;
  }
  if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") {
    const pts = el.points;
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(wx, wy, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) return true;
    }
    return pts.length === 1 && Math.hypot(wx - pts[0][0], wy - pts[0][1]) <= tol;
  }
  // Box-based hit for rect/diamond/text/sticky; ellipse uses the radial test.
  const { x, y, w, h } = el;
  if (el.type === "ellipse") {
    const rx = w / 2, ry = h / 2;
    if (rx === 0 || ry === 0) return false;
    const nx = (wx - (x + rx)) / rx, ny = (wy - (y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  // A frame is hit only on its BORDER or its title strip (above the top edge),
  // never its empty interior — so you can still marquee-select inside it.
  if (el.type === "frame") {
    const onSide = (Math.abs(wx - x) <= tol || Math.abs(wx - (x + w)) <= tol) && wy >= y - tol && wy <= y + h + tol;
    const onCap = (Math.abs(wy - y) <= tol || Math.abs(wy - (y + h)) <= tol) && wx >= x - tol && wx <= x + w + tol;
    const inTitle = wx >= x && wx <= x + w && wy >= y - 26 && wy <= y;
    return onSide || onCap || inTitle;
  }
  return wx >= x - tol && wx <= x + w + tol && wy >= y - tol && wy <= y + h + tol;
}

/** Top-most element (last in z-order) hit by a world point, or null. */
export function hitTopElement(scene: CanvasScene, wx: number, wy: number, tol = 6): CanvasElement | null {
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    if (hitTest(scene.elements[i], wx, wy, tol)) return scene.elements[i];
  }
  return null;
}

/** The point on a box's boundary in the direction of `target` (from its
 *  centre). Used to anchor a connector to the edge of the element it binds. */
export function rectEdgePoint(
  box: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number },
): [number, number] {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = target.x - cx, dy = target.y - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = box.w / 2 || 0.5, hh = box.h / 2 || 0.5;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return [cx + dx * scale, cy + dy * scale];
}

/** The point on an ELEMENT's actual visible border in the direction of
 *  `target` — an ellipse's circumference, a diamond's edge, otherwise the
 *  bounding box. So a connector touches a circle/diamond cleanly, not the box. */
export function elementEdgePoint(el: CanvasElement, target: { x: number; y: number }): [number, number] {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const dx = target.x - cx, dy = target.y - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = el.w / 2 || 0.5, hh = el.h / 2 || 0.5;
  if (el.type === "ellipse") {
    // intersect the ray with the ellipse (dx/hw)² + (dy/hh)² = 1
    const t = 1 / Math.hypot(dx / hw, dy / hh);
    return [cx + dx * t, cy + dy * t];
  }
  if (el.type === "diamond") {
    // rhombus |x/hw| + |y/hh| = 1
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return [cx + dx * t, cy + dy * t];
  }
  return rectEdgePoint(el, target);
}

/** A point's "focus" on a shape: its offset from the shape centre, normalized
 *  by the shape's half-size (roughly -1..1 per axis). Records WHICH side/corner
 *  a connector attaches to, so it survives moves/resizes. */
export function focusOf(el: CanvasElement, point: [number, number]): [number, number] {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const hw = el.w / 2 || 0.5, hh = el.h / 2 || 0.5;
  return [(point[0] - cx) / hw, (point[1] - cy) / hh];
}

/** Recompute every bound connector's endpoints from its bound elements' edges,
 *  so connectors follow when the shapes they link move/resize. Mutates the
 *  connector elements in the array in place (clone them first if they are
 *  React state). */
export function reflowConnectors(elements: CanvasElement[]): void {
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const el of elements) {
    if (el.type !== "line" && el.type !== "arrow") continue;
    if (!el.fromId && !el.toId) continue;
    const from = el.fromId ? byId.get(el.fromId) : undefined;
    const to = el.toId ? byId.get(el.toId) : undefined;
    const pts = el.points;
    if (pts.length < 2) continue;
    const last = pts.length - 1;
    // Re-anchor ONLY the two ends to their bound shapes' edges — KEEP every
    // middle bend. Each end stays on the SIDE/corner you attached it to: the
    // first time we reflow a bound end we capture its "focus" (its direction
    // from the shape centre, normalized by half-size); after that the end holds
    // that focus, so it follows the shape without snapping to the centre line.
    if (from) {
      let foc = el.fromFocus;
      if (!foc) { foc = focusOf(from, pts[0]); el.fromFocus = foc; }
      const target = { x: from.x + from.w / 2 + foc[0] * (from.w / 2 || 0.5), y: from.y + from.h / 2 + foc[1] * (from.h / 2 || 0.5) };
      pts[0] = elementEdgePoint(from, target);
    }
    if (to) {
      let foc = el.toFocus;
      if (!foc) { foc = focusOf(to, pts[last]); el.toFocus = foc; }
      const target = { x: to.x + to.w / 2 + foc[0] * (to.w / 2 || 0.5), y: to.y + to.h / 2 + foc[1] * (to.h / 2 || 0.5) };
      pts[last] = elementEdgePoint(to, target);
    }
    syncPathBounds(el);
  }
}

/** Ids of the non-frame elements whose CENTRE sits inside a frame — the set
 *  that moves with the frame when it's dragged. */
export function frameChildren(elements: CanvasElement[], frame: FrameElement): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    if (el.id === frame.id || el.type === "frame") continue;
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    if (cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h) ids.push(el.id);
  }
  return ids;
}

/** Does an element's bounding box overlap a world-space box (marquee select)? */
export function elementInBox(el: CanvasElement, box: { x: number; y: number; w: number; h: number }): boolean {
  return el.x < box.x + box.w && el.x + el.w > box.x && el.y < box.y + box.h && el.y + el.h > box.y;
}

/** Union bounds of a specific set of elements (group selection box); null when empty. */
export function boundsOfElements(els: CanvasElement[]): { x: number; y: number; w: number; h: number } | null {
  if (els.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** Union bounds of all elements (for zoom-to-fit); null when empty. */
export function sceneBounds(scene: CanvasScene): { x: number; y: number; w: number; h: number } | null {
  if (scene.elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of scene.elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}
