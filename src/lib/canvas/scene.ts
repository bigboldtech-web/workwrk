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
  | "line"
  | "arrow"
  | "freedraw"
  | "text"
  | "sticky";

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
}

export interface ShapeElement extends BaseElement {
  type: "rect" | "ellipse" | "diamond";
}

/** line / arrow / freedraw — geometry lives in `points` (absolute world). */
export interface PathElement extends BaseElement {
  type: "line" | "arrow" | "freedraw";
  points: [number, number][];
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
}

export interface StickyElement extends BaseElement {
  type: "sticky";
  text: string;
  fontSize: number;
}

export type CanvasElement = ShapeElement | PathElement | TextElement | StickyElement;

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
  return wx >= x - tol && wx <= x + w + tol && wy >= y - tol && wy <= y + h + tol;
}

/** Top-most element (last in z-order) hit by a world point, or null. */
export function hitTopElement(scene: CanvasScene, wx: number, wy: number, tol = 6): CanvasElement | null {
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    if (hitTest(scene.elements[i], wx, wy, tol)) return scene.elements[i];
  }
  return null;
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
