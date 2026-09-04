import { describe, expect, it } from "vitest";

import {
  boundsOfElements,
  boundsOfPoints,
  cloneScene,
  elementInBox,
  emptyScene,
  hitTest,
  hitTopElement,
  isCanvasScene,
  normalizeBox,
  sceneBounds,
  syncPathBounds,
  type PathElement,
  type ShapeElement,
} from "./scene";
import { importExcalidraw, isExcalidrawScene } from "./import-excalidraw";

function rect(id: string, x: number, y: number, w: number, h: number): ShapeElement {
  return { id, type: "rect", x, y, w, h, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1 };
}

describe("scene geometry", () => {
  it("boundsOfPoints spans the extremes with a min size", () => {
    expect(boundsOfPoints([[0, 0], [10, 4]])).toEqual({ x: 0, y: 0, w: 10, h: 4 });
    // a single point (or a flat line) still yields a >=1 box, never 0
    expect(boundsOfPoints([[5, 5]])).toEqual({ x: 5, y: 5, w: 1, h: 1 });
  });

  it("normalizeBox flips a box drawn up/left into positive w/h", () => {
    expect(normalizeBox({ x: 10, y: 10, w: -6, h: -4 })).toEqual({ x: 4, y: 6, w: 6, h: 4 });
  });

  it("syncPathBounds recomputes the bbox from points", () => {
    const p: PathElement = { id: "p", type: "line", x: 0, y: 0, w: 1, h: 1, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1, points: [[2, 3], [12, 9]] };
    syncPathBounds(p);
    expect(p).toMatchObject({ x: 2, y: 3, w: 10, h: 6 });
  });

  it("hitTest: box contains inside, rejects far outside", () => {
    const r = rect("r", 0, 0, 100, 50);
    expect(hitTest(r, 50, 25)).toBe(true);
    expect(hitTest(r, 200, 25)).toBe(false);
  });

  it("hitTest: ellipse uses the radial test, not the bbox corners", () => {
    const e: ShapeElement = { ...rect("e", 0, 0, 100, 100), type: "ellipse" };
    expect(hitTest(e, 50, 50, 0)).toBe(true); // centre
    expect(hitTest(e, 2, 2, 0)).toBe(false); // corner is outside the ellipse
  });

  it("hitTest: a line hits near the segment within tolerance", () => {
    const l: PathElement = { id: "l", type: "line", x: 0, y: 0, w: 100, h: 0, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1, points: [[0, 0], [100, 0]] };
    expect(hitTest(l, 50, 3, 6)).toBe(true);
    expect(hitTest(l, 50, 40, 6)).toBe(false);
  });

  it("hitTopElement returns the last (top-most) overlapping element", () => {
    const scene = emptyScene();
    scene.elements.push(rect("under", 0, 0, 100, 100), rect("over", 0, 0, 100, 100));
    expect(hitTopElement(scene, 50, 50)?.id).toBe("over");
    expect(hitTopElement(scene, 500, 500)).toBeNull();
  });

  it("sceneBounds unions all elements; null when empty", () => {
    expect(sceneBounds(emptyScene())).toBeNull();
    const scene = emptyScene();
    scene.elements.push(rect("a", 0, 0, 10, 10), rect("b", 40, 20, 10, 10));
    expect(sceneBounds(scene)).toEqual({ x: 0, y: 0, w: 50, h: 30 });
  });

  it("elementInBox: marquee selects an overlapping element, skips a disjoint one", () => {
    const r = rect("r", 10, 10, 20, 20);
    expect(elementInBox(r, { x: 0, y: 0, w: 15, h: 15 })).toBe(true); // corner overlap
    expect(elementInBox(r, { x: 100, y: 100, w: 10, h: 10 })).toBe(false);
    // touching edges only (no overlap) is not a hit
    expect(elementInBox(r, { x: 30, y: 10, w: 5, h: 5 })).toBe(false);
  });

  it("boundsOfElements unions a group; null when empty", () => {
    expect(boundsOfElements([])).toBeNull();
    expect(boundsOfElements([rect("a", 0, 0, 10, 10), rect("b", 20, 5, 10, 30)])).toEqual({ x: 0, y: 0, w: 30, h: 35 });
  });

  it("cloneScene deep-copies element point arrays (no shared refs)", () => {
    const scene = emptyScene();
    const p: PathElement = { id: "p", type: "freedraw", x: 0, y: 0, w: 1, h: 1, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1, points: [[1, 1]] };
    scene.elements.push(p);
    const copy = cloneScene(scene);
    (copy.elements[0] as PathElement).points.push([9, 9]);
    expect((scene.elements[0] as PathElement).points).toHaveLength(1);
  });

  it("isCanvasScene only accepts our versioned shape", () => {
    expect(isCanvasScene(emptyScene())).toBe(true);
    expect(isCanvasScene({ elements: [] })).toBe(false); // no version = legacy
    expect(isCanvasScene(null)).toBe(false);
  });
});

describe("excalidraw import", () => {
  const legacy = {
    elements: [
      { type: "rectangle", x: 10, y: 20, width: 100, height: 40, strokeColor: "#111", backgroundColor: "#eee", opacity: 50 },
      { type: "arrow", x: 0, y: 0, width: 30, height: 40, points: [[0, 0], [30, 40]], strokeColor: "#0073EA" },
      { type: "text", x: 5, y: 5, width: 80, height: 24, text: "hi", fontSize: 18 },
      { type: "image", x: 0, y: 0, width: 10, height: 10 }, // unsupported → dropped
      { type: "rectangle", x: 0, y: 0, width: 5, height: 5, isDeleted: true }, // deleted → dropped
    ],
    appState: { viewBackgroundColor: "#fff" },
  };

  it("detects an excalidraw blob (has appState) and rejects our format", () => {
    expect(isExcalidrawScene(legacy)).toBe(true);
    expect(isExcalidrawScene(emptyScene())).toBe(false);
    expect(isExcalidrawScene({ elements: [{ type: "freedraw" }] })).toBe(true);
  });

  it("converts supported kinds, drops unsupported + deleted", () => {
    const scene = importExcalidraw(legacy);
    expect(scene.version).toBe(1);
    // rectangle + arrow + text kept; image + deleted-rect dropped
    expect(scene.elements.map((e) => e.type)).toEqual(["rect", "arrow", "text"]);
  });

  it("maps opacity 0..100 → 0..1 and keeps a real fill", () => {
    const r = importExcalidraw(legacy).elements[0];
    expect(r.opacity).toBeCloseTo(0.5);
    expect(r.fill).toBe("#eee");
  });

  it("makes arrow points absolute (element origin + relative point)", () => {
    const arrow = importExcalidraw({ elements: [{ type: "arrow", x: 100, y: 50, width: 20, height: 10, points: [[0, 0], [20, 10]] }] }).elements[0] as PathElement;
    expect(arrow.points).toEqual([[100, 50], [120, 60]]);
  });
});
