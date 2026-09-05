import { describe, expect, it } from "vitest";

import {
  boundsOfElements,
  boundsOfPoints,
  cloneScene,
  dashPattern,
  elbowPoints,
  elementEdgePoint,
  elementInBox,
  emptyScene,
  frameChildren,
  hitTest,
  hitTopElement,
  isCanvasScene,
  normalizeBox,
  rectEdgePoint,
  reflowConnectors,
  sceneBounds,
  syncPathBounds,
  type CanvasElement,
  type FrameElement,
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

  it("hitTest respects rotation (tests in the element's local frame)", () => {
    // a wide, short rect rotated 90° occupies a TALL footprint on screen.
    const base: ShapeElement = { id: "r", type: "rect", x: 0, y: 0, w: 100, h: 20, stroke: "#000", fill: "#eee", strokeWidth: 1, opacity: 1 };
    const below: [number, number] = [50, 60]; // straight below the centre (50,10)
    expect(hitTest(base, below[0], below[1])).toBe(false);          // upright: outside
    expect(hitTest({ ...base, angle: Math.PI / 2 }, below[0], below[1])).toBe(true); // rotated: inside
  });

  it("dashPattern: solid = no dashes, dashed/dotted scale with width", () => {
    expect(dashPattern("solid", 2)).toEqual([]);
    expect(dashPattern(undefined, 2)).toEqual([]); // absent = solid
    expect(dashPattern("dashed", 2)[0]).toBeGreaterThan(0);
    const dotted = dashPattern("dotted", 2);
    expect(dotted[0]).toBeLessThan(1);   // near-zero segment → a dot with round caps
    expect(dotted[1]).toBeGreaterThan(0); // real gap between dots
  });

  it("a canvasCard is a normal box: hit-tests, bounds, and clones like any element", () => {
    const scene = emptyScene();
    const card: CanvasElement = {
      id: "cc", type: "canvasCard", x: 10, y: 20, w: 260, h: 180,
      stroke: "#E2E8F0", fill: "#FFFFFF", strokeWidth: 1, opacity: 1,
      whiteboardId: "wb_1", title: "Roadmap",
    };
    scene.elements.push(card);
    expect(hitTest(card, 100, 100)).toBe(true);      // inside the box
    expect(hitTest(card, 400, 100)).toBe(false);     // outside
    expect(sceneBounds(scene)).toMatchObject({ x: 10, y: 20, w: 260, h: 180 });
    const copy = cloneScene(scene);
    expect(copy.elements[0]).not.toBe(card);         // deep copy
    expect(copy.elements[0]).toMatchObject({ type: "canvasCard", whiteboardId: "wb_1" });
  });
});

describe("elbow routing", () => {
  it("routes H-V-H via the mid-x when the span is wider than tall", () => {
    expect(elbowPoints([0, 0], [100, 40])).toEqual([[0, 0], [50, 0], [50, 40], [100, 40]]);
  });
  it("routes V-H-V via the mid-y when taller than wide", () => {
    expect(elbowPoints([0, 0], [40, 100])).toEqual([[0, 0], [0, 50], [40, 50], [40, 100]]);
  });
});

describe("frames", () => {
  const frame: FrameElement = { id: "f", type: "frame", x: 0, y: 0, w: 200, h: 200, stroke: "#94A3B8", fill: "transparent", strokeWidth: 1, opacity: 1, title: "Frame 1" };
  it("frameChildren returns elements whose centre is inside, skips others + the frame + nested frames", () => {
    const inside = rect("in", 20, 20, 40, 40); // centre (40,40) inside
    const outside = rect("out", 300, 300, 40, 40); // far away
    const nested: FrameElement = { ...frame, id: "f2", x: 10, y: 10, w: 50, h: 50 };
    const ids = frameChildren([frame, inside, outside, nested], frame);
    expect(ids).toEqual(["in"]); // "out" excluded, frame + nested frame skipped
  });
  it("frameChildren excludes an element whose centre is just outside even if it overlaps the edge", () => {
    const straddle = rect("s", 180, 90, 60, 20); // centre x=210 > 200 → out
    expect(frameChildren([frame, straddle], frame)).toEqual([]);
  });
});

describe("connectors", () => {
  it("rectEdgePoint lands on the box boundary toward the target", () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }; // centre (50,50)
    // target straight to the right → exits the right edge at x=100, y=50
    expect(rectEdgePoint(box, { x: 500, y: 50 })).toEqual([100, 50]);
    // straight up → top edge
    expect(rectEdgePoint(box, { x: 50, y: -500 })).toEqual([50, 0]);
  });

  it("elementEdgePoint lands on the real border: ellipse circumference, diamond edge", () => {
    const circle: ShapeElement = { id: "e", type: "ellipse", x: 0, y: 0, w: 100, h: 100, stroke: "#000", fill: "transparent", strokeWidth: 1, opacity: 1 };
    // straight to the right from centre (50,50) → circle radius 50 → (100,50)
    expect(elementEdgePoint(circle, { x: 500, y: 50 })).toEqual([100, 50]);
    // 45° toward (150,150): on the circle, not the box corner (100,100)
    const [px, py] = elementEdgePoint(circle, { x: 150, y: 150 });
    expect(Math.hypot(px - 50, py - 50)).toBeCloseTo(50, 5); // exactly on the circumference
    const diamond: ShapeElement = { ...circle, id: "d", type: "diamond" };
    // toward (150,150): diamond edge |x/50|+|y/50|=1 → 45° hits (75,75)
    const [dx, dy] = elementEdgePoint(diamond, { x: 150, y: 150 });
    expect(dx).toBeCloseTo(75, 5);
    expect(dy).toBeCloseTo(75, 5);
  });

  it("reflowConnectors keeps middle bends when a multi-point connector binds", () => {
    const a: ShapeElement = { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 100, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1 };
    const b: ShapeElement = { id: "b", type: "rect", x: 300, y: 0, w: 100, h: 100, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1 };
    const conn: PathElement = { id: "c", type: "arrow", x: 0, y: 0, w: 1, h: 1, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1, points: [[9, 9], [200, -50], [309, 9]], fromId: "a", toId: "b" };
    reflowConnectors([a, b, conn]);
    expect(conn.points.length).toBe(3);           // the bend is NOT flattened away
    expect(conn.points[1]).toEqual([200, -50]);    // middle bend untouched
    expect(conn.points[0][0]).toBe(100);           // start re-anchored to a's right edge
    expect(conn.points[2][0]).toBe(300);           // end re-anchored to b's left edge
  });

  it("reflowConnectors anchors a bound connector to both shapes' edges", () => {
    const a: ShapeElement = { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 100, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1 };
    const b: ShapeElement = { id: "b", type: "rect", x: 300, y: 0, w: 100, h: 100, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1 };
    const conn: PathElement = { id: "c", type: "arrow", x: 0, y: 0, w: 1, h: 1, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1, points: [[9, 9], [9, 9]], fromId: "a", toId: "b" };
    const els: CanvasElement[] = [a, b, conn];
    reflowConnectors(els);
    // a centre (50,50) → toward b centre (350,50): exits a's right edge (100,50)
    expect(conn.points[0]).toEqual([100, 50]);
    // b centre (350,50) → toward a: exits b's left edge (300,50)
    expect(conn.points[1]).toEqual([300, 50]);
  });

  it("reflowConnectors keeps a free (unbound) endpoint as-is", () => {
    const a: ShapeElement = { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 100, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1 };
    const conn: PathElement = { id: "c", type: "line", x: 0, y: 0, w: 1, h: 1, stroke: "#000", fill: "transparent", strokeWidth: 2, opacity: 1, points: [[10, 10], [400, 400]], fromId: "a" };
    reflowConnectors([a, conn]);
    expect(conn.points[1]).toEqual([400, 400]); // free end untouched
    expect(conn.points[0][0]).toBeGreaterThan(0); // bound end moved to a's edge
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
