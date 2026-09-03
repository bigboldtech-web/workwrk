// Convert a legacy Excalidraw scene into a WorkwrK Canvas scene.
//
// Existing whiteboards store an opaque Excalidraw blob ({ elements, appState,
// files }). On first open in the new engine we convert it once; the caller
// snapshots the original into ContentVersion first so it is always
// recoverable. Unknown element kinds (image, frame, embeddable, …) are
// dropped in v1 rather than guessed — nothing is corrupted, and the original
// scene survives in history.

import {
  emptyScene,
  genId,
  syncPathBounds,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_FONT_SIZE,
  type CanvasElement,
  type CanvasScene,
  type PathElement,
} from "./scene";

interface ExcalidrawElement {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  opacity?: number; // 0..100
  points?: [number, number][];
  text?: string;
  fontSize?: number;
  isDeleted?: boolean;
}

/** Heuristic: does this blob look like an Excalidraw scene (not ours)? */
export function isExcalidrawScene(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as { version?: unknown; elements?: unknown; appState?: unknown };
  if (s.version === 1) return false; // our format
  if (!Array.isArray(s.elements)) return false;
  if (s.appState && typeof s.appState === "object") return true;
  // No appState — sniff an element's excalidraw-style type.
  const first = (s.elements as ExcalidrawElement[]).find((e) => typeof e?.type === "string");
  return !!first && ["rectangle", "ellipse", "diamond", "arrow", "line", "freedraw", "text"].includes(first.type!);
}

const TYPE_MAP: Record<string, CanvasElement["type"]> = {
  rectangle: "rect",
  ellipse: "ellipse",
  diamond: "diamond",
  line: "line",
  arrow: "arrow",
  freedraw: "freedraw",
  text: "text",
};

function opacityOf(e: ExcalidrawElement): number {
  const o = typeof e.opacity === "number" ? e.opacity : 100;
  return Math.max(0, Math.min(1, o / 100));
}

/** Convert an Excalidraw scene blob → our CanvasScene. */
export function importExcalidraw(raw: unknown): CanvasScene {
  const scene = emptyScene();
  const src = (raw as { elements?: ExcalidrawElement[] })?.elements;
  if (!Array.isArray(src)) return scene;

  for (const e of src) {
    if (!e || e.isDeleted || typeof e.type !== "string") continue;
    const mapped = TYPE_MAP[e.type];
    if (!mapped) continue; // image / frame / embeddable — dropped in v1

    const x = e.x ?? 0;
    const y = e.y ?? 0;
    const w = Math.max(1, e.width ?? 1);
    const h = Math.max(1, e.height ?? 1);
    const base = {
      id: genId(),
      x,
      y,
      w,
      h,
      stroke: e.strokeColor || DEFAULT_STROKE,
      fill: e.backgroundColor && e.backgroundColor !== "transparent" ? e.backgroundColor : "transparent",
      strokeWidth: typeof e.strokeWidth === "number" ? e.strokeWidth : DEFAULT_STROKE_WIDTH,
      opacity: opacityOf(e),
    };

    if (mapped === "line" || mapped === "arrow" || mapped === "freedraw") {
      // Excalidraw points are relative to the element origin — make absolute.
      const rel = Array.isArray(e.points) && e.points.length > 0 ? e.points : [[0, 0], [w, h]];
      const points = rel.map(([px, py]) => [x + px, y + py] as [number, number]);
      const path: PathElement = { ...base, type: mapped, points };
      syncPathBounds(path);
      scene.elements.push(path);
    } else if (mapped === "text") {
      scene.elements.push({
        ...base,
        type: "text",
        text: typeof e.text === "string" ? e.text : "",
        fontSize: typeof e.fontSize === "number" ? e.fontSize : DEFAULT_FONT_SIZE,
      });
    } else {
      // Remaining kinds are the box shapes (rect / ellipse / diamond).
      scene.elements.push({ ...base, type: mapped as "rect" | "ellipse" | "diamond" });
    }
  }

  return scene;
}
