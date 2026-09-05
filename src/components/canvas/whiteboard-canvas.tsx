"use client";

// WorkwrK Canvas — the first-party whiteboard editor (Phase 0/1).
//
// A dependency-free HTML5 Canvas 2D editor over the scene model in
// src/lib/canvas. Renders in world space via the canvas transform; selection
// chrome is drawn in screen space so handles stay a constant size at any zoom.
// The parent owns persistence — we just emit the scene on every committed edit
// (create / move / resize / style / delete / text), and the parent's autosave
// discipline (size-aware keepalive + ContentVersion) is untouched.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MousePointer2, Hand, Square, Circle, Diamond, Minus, ArrowRight,
  Pencil, Type as TypeIcon, StickyNote, ImagePlus, ListTodo, Search, Trash2, Undo2, Redo2, Plus, Minus as MinusIcon,
  Shapes, Triangle, Cloud, Database, RectangleHorizontal, Frame as FrameIcon,
  MoveRight, CornerDownRight, Spline,
} from "lucide-react";

const ARROW_TYPES: { type: ArrowType; Icon: typeof MoveRight; label: string }[] = [
  { type: "straight", Icon: MoveRight, label: "Straight" },
  { type: "elbow", Icon: CornerDownRight, label: "Elbow" },
  { type: "curved", Icon: Spline, label: "Curved" },
];

// Extra flowchart shapes behind the toolbar's "More shapes" flyout (ClickUp).
const SHAPE_FLYOUT: { tool: Tool; Icon: typeof Square; label: string }[] = [
  { tool: "roundRect", Icon: Square, label: "Rounded rectangle" },
  { tool: "triangle", Icon: Triangle, label: "Triangle" },
  { tool: "parallelogram", Icon: RectangleHorizontal, label: "Parallelogram" },
  { tool: "cylinder", Icon: Database, label: "Cylinder / database" },
  { tool: "cloud", Icon: Cloud, label: "Cloud" },
];
import {
  cloneScene, genId, hitTest, hitTopElement, normalizeBox, sceneBounds, syncPathBounds,
  elementInBox, reflowConnectors, frameChildren, elbowPoints,
  STROKE_COLORS, FILL_COLORS, STICKY_COLORS, DEFAULT_STROKE, DEFAULT_STROKE_WIDTH, DEFAULT_FONT_SIZE,
  type ArrowType, type CanvasElement, type CanvasScene, type FrameElement, type ImageElement, type PathElement, type ShapeElement, type TaskCardElement,
} from "@/lib/canvas/scene";

/** A task the picker can drop onto the canvas as a live card. Resolved by the
 *  host (which owns task data + status colors) and passed in via `loadTasks`. */
export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  meta: string;
}

/** Read a File → data URL, downscaling to `maxDim` so scenes stay a sane size. */
async function loadScaledImage(file: File, maxDim: number): Promise<{ src: string; w: number; h: number }> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("decode failed"));
    i.src = dataUrl;
  });
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (Math.max(nw, nh) <= maxDim) return { src: dataUrl, w: nw, h: nh };
  const scale = maxDim / Math.max(nw, nh);
  const w = Math.round(nw * scale), h = Math.round(nh * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d");
  if (!cx) return { src: dataUrl, w: nw, h: nh };
  cx.drawImage(img, 0, 0, w, h);
  const type = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
  return { src: c.toDataURL(type, 0.85), w, h };
}

type Tool =
  | "select" | "hand"
  | "rect" | "ellipse" | "diamond" | "roundRect" | "triangle" | "parallelogram" | "cylinder" | "cloud"
  | "line" | "arrow" | "freedraw" | "text" | "sticky" | "frame";

const SHAPE_TOOLS = new Set<Tool>(["rect", "ellipse", "diamond", "roundRect", "triangle", "parallelogram", "cylinder", "cloud"]);

// `key` = letter shortcut, `num` = number shortcut (Excalidraw-style, for fast
// flow-drawing). Both are shown as a hint on the tool and switch the tool.
const TOOLS: { tool: Tool; Icon: typeof Square; label: string; key?: string; num?: string }[] = [
  { tool: "select", Icon: MousePointer2, label: "Select", key: "V", num: "1" },
  { tool: "hand", Icon: Hand, label: "Pan", key: "H" },
  { tool: "rect", Icon: Square, label: "Rectangle", key: "R", num: "2" },
  { tool: "diamond", Icon: Diamond, label: "Diamond", key: "D", num: "3" },
  { tool: "ellipse", Icon: Circle, label: "Ellipse", key: "O", num: "4" },
  { tool: "arrow", Icon: ArrowRight, label: "Arrow", key: "A", num: "5" },
  { tool: "line", Icon: Minus, label: "Line", key: "L", num: "6" },
  { tool: "freedraw", Icon: Pencil, label: "Pen", key: "P", num: "7" },
  { tool: "text", Icon: TypeIcon, label: "Text", key: "T", num: "8" },
  { tool: "sticky", Icon: StickyNote, label: "Sticky note", key: "S", num: "9" },
];
const TOOL_BY_NUM: Record<string, Tool> = Object.fromEntries(
  TOOLS.filter((t) => t.num).map((t) => [t.num!, t.tool]),
);

const HANDLE = 8; // px, screen space
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;

type Box = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "draw"; id: string; startX: number; startY: number }
  | { kind: "path"; id: string }
  | { kind: "move"; ids: string[]; startX: number; startY: number; origs: Map<string, CanvasElement> }
  | { kind: "resize"; id: string; handle: number; orig: CanvasElement }
  | { kind: "endpoint"; id: string; end: 0 | 1 } // dragging a line/arrow endpoint
  | { kind: "marquee"; startX: number; startY: number; add: boolean; base: string[] }
  | null;

export interface WhiteboardCanvasProps {
  initialScene: CanvasScene;
  onChange: (scene: CanvasScene) => void;
  /** Fetch tasks for the "Task card" picker. Omit to hide the feature. */
  loadTasks?: () => Promise<TaskSummary[]>;
  /** Open a task (double-click a card). Omit to make cards non-navigable. */
  onOpenTask?: (itemId: string) => void;
}

export function WhiteboardCanvas({ initialScene, onChange, loadTasks, onOpenTask }: WhiteboardCanvasProps) {
  const [scene, setScene] = useState<CanvasScene>(initialScene);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [hoverBindId, setHoverBindId] = useState<string | null>(null); // shape a connector-in-progress will bind to
  const [stroke, setStroke] = useState(DEFAULT_STROKE);
  const [fillColor, setFillColor] = useState("transparent");
  const [strokeW, setStrokeW] = useState(DEFAULT_STROKE_WIDTH);
  const [arrowType, setArrowType] = useState<ArrowType>("straight");
  const [spaceDown, setSpaceDown] = useState(false); // hold-Space = temporary pan
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  const multiRef = useRef<{ id: string; downX: number; downY: number } | null>(null); // in-progress multi-point arrow
  const lastPtrRef = useRef({ sx: 0, sy: 0 }); // last pointer pos (screen), for drag-vs-click
  const clipboardRef = useRef<CanvasElement[]>([]);
  const selectOne = useCallback((id: string | null) => setSelectedIds(id ? new Set([id]) : new Set()), []);
  const fileRef = useRef<HTMLInputElement>(null);
  // Decoded <img> cache keyed by data URL; a load re-triggers draw via imgVersion.
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imgVersion, setImgVersion] = useState(0);
  const getImage = useCallback((src: string): HTMLImageElement | null => {
    const cache = imageCacheRef.current;
    const cached = cache.get(src);
    if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
    const img = new Image();
    img.onload = () => setImgVersion((v) => v + 1);
    img.src = src;
    cache.set(src, img);
    return null;
  }, []);
  const [shapesOpen, setShapesOpen] = useState(false); // "More shapes" flyout
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; onElement: boolean; hasClipboard: boolean } | null>(null);
  // Task-card picker (work-graph): drop a live task onto the canvas.
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [taskQuery, setTaskQuery] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const spaceRef = useRef(false);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const undoRef = useRef<CanvasScene[]>([]);
  const redoRef = useRef<CanvasScene[]>([]);
  // Mirror the undo/redo stack lengths into state so the toolbar buttons can
  // reflect availability without reading refs during render. `bump()` also
  // serves as the generic "re-render" nudge after a ref-only change.
  const [hist, setHist] = useState({ u: 0, r: 0 });
  const bump = useCallback(() => setHist({ u: undoRef.current.length, r: redoRef.current.length }), []);

  const vp = scene.viewport;
  const toWorld = useCallback((sx: number, sy: number) => ({
    x: (sx - vp.x) / vp.zoom,
    y: (sy - vp.y) / vp.zoom,
  }), [vp]);

  // ── history ────────────────────────────────────────────────────────────
  const commit = useCallback((next: CanvasScene, snapshot: CanvasScene) => {
    undoRef.current.push(snapshot);
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
    setScene(next);
    onChange(next);
    bump();
  }, [onChange, bump]);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(cloneScene(scene));
    setScene(prev);
    onChange(prev);
    setSelectedIds(new Set());
    setEditing(null);
    bump();
  }, [scene, onChange, bump]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(cloneScene(scene));
    setScene(next);
    onChange(next);
    bump();
  }, [scene, onChange, bump]);

  // ── rendering ────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--wb-bg") || "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // dot grid (screen space, subtle)
    const gap = 24 * vp.zoom;
    if (gap >= 10) {
      const ox = vp.x % gap, oy = vp.y % gap;
      ctx.fillStyle = "rgba(120,130,150,0.16)";
      for (let x = ox; x < w; x += gap) for (let y = oy; y < h; y += gap) ctx.fillRect(x, y, 1, 1);
    }

    // elements in world space
    ctx.setTransform(vp.zoom * dpr, 0, 0, vp.zoom * dpr, vp.x * dpr, vp.y * dpr);
    for (const el of scene.elements) drawElement(ctx, el, getImage);

    // selection chrome in screen space: an outline per selected element, and
    // resize handles only when exactly one is selected (group resize is later).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const selected = scene.elements.filter((e) => selectedIds.has(e.id));
    for (const el of selected) drawSelection(ctx, el, vp, selected.length === 1);
    if (marquee) drawMarquee(ctx, marquee, vp);
    // connector bind target: a blue ring around the shape the arrow will attach to
    if (hoverBindId) {
      const he = scene.elements.find((e) => e.id === hoverBindId);
      if (he) {
        ctx.save();
        ctx.strokeStyle = "#0073EA";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(he.x * vp.zoom + vp.x - 2, he.y * vp.zoom + vp.y - 2, he.w * vp.zoom + 4, he.h * vp.zoom + 4);
        ctx.restore();
      }
    }
  }, [scene, selectedIds, marquee, hoverBindId, vp, getImage]);

  // Redraw when the scene/viewport change, and when a pending image finishes
  // decoding (imgVersion bumps) so it replaces its placeholder.
  useLayoutEffect(() => { draw(); }, [draw, imgVersion]);

  // size to container (dpr-aware)
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // ── pointer interaction ────────────────────────────────────────────────
  const patchElement = useCallback((id: string, fn: (el: CanvasElement) => void) => {
    setScene((s) => ({
      ...s,
      elements: s.elements.map((el) => {
        if (el.id !== id) return el;
        const copy: CanvasElement = "points" in el
          ? { ...el, points: el.points.map((p) => [p[0], p[1]] as [number, number]) }
          : { ...el };
        fn(copy);
        return copy;
      }),
    }));
  }, []);

  // Finish the in-progress multi-point arrow (double-click / Enter / Escape /
  // press-drag): trim trailing floating/coincident points, bind the end to a
  // shape if it lands on one, or drop a stray zero-length arrow.
  const finishMultiArrow = useCallback(() => {
    const m = multiRef.current;
    if (!m) return;
    multiRef.current = null;
    setHoverBindId(null);
    setScene((s) => {
      const el = s.elements.find((x) => x.id === m.id);
      if (!el || !("points" in el)) return s;
      const points = el.points.map((p) => [p[0], p[1]] as [number, number]);
      while (points.length > 2 && dist(points[points.length - 1], points[points.length - 2]) < 4) points.pop();
      if (points.length < 2 || (points.length === 2 && dist(points[0], points[1]) < 4)) {
        selectOne(null);
        const next = { ...s, elements: s.elements.filter((x) => x.id !== m.id) };
        onChange(next);
        return next;
      }
      const end = points[points.length - 1];
      let toId: string | undefined;
      for (let i = s.elements.length - 1; i >= 0; i--) {
        const c = s.elements[i];
        if (c.id === m.id || c.id === (el as PathElement).fromId || !isBindable(c)) continue;
        if (hitTest(c, end[0], end[1], 6 / s.viewport.zoom)) { toId = c.id; break; }
      }
      let elements = s.elements.map((x) => {
        if (x.id !== m.id) return x;
        const c: PathElement = { ...(x as PathElement), points, toId };
        syncPathBounds(c);
        return c;
      });
      elements = reflowElements(elements);
      const next = { ...s, elements };
      onChange(next);
      return next;
    });
    bump();
  }, [onChange, bump, selectOne]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const world = toWorld(sx, sy);
    const panning = tool === "hand" || spaceRef.current || e.button === 1;

    if (panning) {
      dragRef.current = { kind: "pan", sx, sy, ox: vp.x, oy: vp.y };
      return;
    }

    if (tool === "select") {
      // Endpoint / resize handles — only when exactly one element is selected.
      if (selectedIds.size === 1) {
        const sel = scene.elements.find((el) => selectedIds.has(el.id));
        if (sel && (sel.type === "line" || sel.type === "arrow")) {
          const ep = hitEndpoint(sel, sx, sy, vp);
          if (ep !== -1) {
            dragRef.current = { kind: "endpoint", id: sel.id, end: ep };
            undoRef.current.push(cloneScene(scene));
            return;
          }
        } else if (sel) {
          const handle = hitHandle(sel, sx, sy, vp);
          if (handle >= 0) {
            dragRef.current = { kind: "resize", id: sel.id, handle, orig: cloneEl(sel) };
            undoRef.current.push(cloneScene(scene));
            return;
          }
        }
      }
      const hit = hitTopElement(scene, world.x, world.y, 8 / vp.zoom);
      if (hit) {
        if (e.shiftKey) {
          // shift-click toggles membership; never starts a drag
          const ids = new Set(selectedIds);
          if (ids.has(hit.id)) ids.delete(hit.id); else ids.add(hit.id);
          setSelectedIds(ids);
          return;
        }
        // click a member → move the whole group; click a non-member → select it
        const ids = selectedIds.has(hit.id) ? selectedIds : new Set([hit.id]);
        if (!selectedIds.has(hit.id)) setSelectedIds(ids);
        // Dragging a frame drags its contents too (children captured now).
        const moveIdSet = new Set(ids);
        for (const id of ids) {
          const el = scene.elements.find((e) => e.id === id);
          if (el && el.type === "frame") for (const c of frameChildren(scene.elements, el)) moveIdSet.add(c);
        }
        const moveIds = Array.from(moveIdSet);
        const origs = new Map(moveIds.map((id) => [id, cloneEl(scene.elements.find((el) => el.id === id)!)]));
        dragRef.current = { kind: "move", ids: moveIds, startX: world.x, startY: world.y, origs };
        undoRef.current.push(cloneScene(scene));
      } else {
        // empty space → marquee (shift keeps the existing selection as a base)
        dragRef.current = { kind: "marquee", startX: world.x, startY: world.y, add: e.shiftKey, base: e.shiftKey ? Array.from(selectedIds) : [] };
        if (!e.shiftKey) setSelectedIds(new Set());
        setMarquee({ x: world.x, y: world.y, w: 0, h: 0 });
      }
      return;
    }

    // creation tools
    const snapshot = cloneScene(scene);
    const id = genId();
    if (SHAPE_TOOLS.has(tool)) {
      const el: ShapeElement = { id, type: tool as ShapeElement["type"], x: world.x, y: world.y, w: 1, h: 1, stroke, fill: fillColor, strokeWidth: strokeW, opacity: 1 };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      selectOne(id);
      dragRef.current = { kind: "draw", id, startX: world.x, startY: world.y };
    } else if (tool === "line" || tool === "arrow") {
      if (!multiRef.current) {
        // Start a new arrow. Points = [start, floating-end]. It binds to a shape
        // it starts on (connector). Press-drag makes a quick 2-point arrow; a
        // click starts a MULTI-POINT arrow (click to add bends, dbl-click ends).
        const startHit = hitTopElement(scene, world.x, world.y, 8 / vp.zoom);
        const fromId = startHit && isBindable(startHit) ? startHit.id : undefined;
        const el: PathElement = { id, type: tool, x: world.x, y: world.y, w: 1, h: 1, stroke, fill: "transparent", strokeWidth: strokeW, opacity: 1, points: [[world.x, world.y], [world.x, world.y]], fromId, arrowType };
        undoRef.current.push(snapshot);
        setScene((s) => ({ ...s, elements: [...s.elements, el] }));
        selectOne(id);
        multiRef.current = { id, downX: sx, downY: sy };
        dragRef.current = { kind: "path", id };
      } else {
        // Continue: fix the floating end at this click + append a new floating.
        const mid = multiRef.current.id;
        patchElement(mid, (el) => { if ("points" in el) { el.points[el.points.length - 1] = [world.x, world.y]; el.points.push([world.x, world.y]); syncPathBounds(el as PathElement); } });
        multiRef.current = { id: mid, downX: sx, downY: sy };
        dragRef.current = null;
      }
    } else if (tool === "freedraw") {
      const el: PathElement = { id, type: "freedraw", x: world.x, y: world.y, w: 1, h: 1, stroke, fill: "transparent", strokeWidth: strokeW, opacity: 1, points: [[world.x, world.y]] };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      dragRef.current = { kind: "path", id };
    } else if (tool === "text") {
      const el: CanvasElement = { id, type: "text", x: world.x, y: world.y - DEFAULT_FONT_SIZE / 2, w: 160, h: DEFAULT_FONT_SIZE * 1.4, stroke, fill: "transparent", strokeWidth: 1, opacity: 1, text: "", fontSize: DEFAULT_FONT_SIZE };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      selectOne(id);
      setEditing({ id });
      setTool("select");
    } else if (tool === "sticky") {
      const el: CanvasElement = { id, type: "sticky", x: world.x, y: world.y, w: 180, h: 180, stroke: "transparent", fill: STICKY_COLORS[0], strokeWidth: 0, opacity: 1, text: "", fontSize: 16 };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      selectOne(id);
      setEditing({ id });
      setTool("select");
    } else if (tool === "frame") {
      const n = scene.elements.filter((e) => e.type === "frame").length + 1;
      const el: FrameElement = { id, type: "frame", x: world.x, y: world.y, w: 1, h: 1, stroke: "#94A3B8", fill: "transparent", strokeWidth: 1.5, opacity: 1, title: `Frame ${n}` };
      undoRef.current.push(snapshot);
      // Insert at the FRONT of the array = bottom of the z-order, so elements
      // dropped inside the frame always render on top of it.
      setScene((s) => ({ ...s, elements: [el, ...s.elements] }));
      selectOne(id);
      dragRef.current = { kind: "draw", id, startX: world.x, startY: world.y };
    }
  }, [editing, tool, scene, selectedIds, vp, stroke, fillColor, strokeW, arrowType, toWorld, selectOne, patchElement]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const mrect = canvas.getBoundingClientRect();
    const msx = e.clientX - mrect.left, msy = e.clientY - mrect.top;
    lastPtrRef.current = { sx: msx, sy: msy };
    // Multi-point arrow: the floating end tracks the cursor (even between clicks).
    if (multiRef.current) {
      const w = toWorld(msx, msy);
      patchElement(multiRef.current.id, (el) => { if ("points" in el) { el.points[el.points.length - 1] = [w.x, w.y]; syncPathBounds(el as PathElement); } });
      let hover: string | null = null;
      for (let i = scene.elements.length - 1; i >= 0; i--) { const c = scene.elements[i]; if (c.id === multiRef.current!.id || !isBindable(c)) continue; if (hitTest(c, w.x, w.y, 6 / vp.zoom)) { hover = c.id; break; } }
      setHoverBindId(hover);
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const sx = msx, sy = msy;
    const world = toWorld(sx, sy);

    if (drag.kind === "pan") {
      setScene((s) => ({ ...s, viewport: { ...s.viewport, x: drag.ox + (sx - drag.sx), y: drag.oy + (sy - drag.sy) } }));
    } else if (drag.kind === "draw") {
      patchElement(drag.id, (el) => { el.x = Math.min(drag.startX, world.x); el.y = Math.min(drag.startY, world.y); el.w = Math.max(1, Math.abs(world.x - drag.startX)); el.h = Math.max(1, Math.abs(world.y - drag.startY)); });
    } else if (drag.kind === "path") {
      patchElement(drag.id, (el) => {
        if (!("points" in el)) return;
        if (el.type === "freedraw") el.points.push([world.x, world.y]);
        else el.points[1] = [world.x, world.y];
        syncPathBounds(el as PathElement);
      });
      // connector hover: highlight the shape the end would bind to
      const drawn = scene.elements.find((x) => x.id === drag.id);
      if (drawn && (drawn.type === "line" || drawn.type === "arrow")) {
        let hover: string | null = null;
        for (let i = scene.elements.length - 1; i >= 0; i--) {
          const cand = scene.elements[i];
          if (cand.id === drag.id || !isBindable(cand)) continue;
          if (hitTest(cand, world.x, world.y, 6 / vp.zoom)) { hover = cand.id; break; }
        }
        setHoverBindId(hover);
      }
    } else if (drag.kind === "move") {
      const dx = world.x - drag.startX, dy = world.y - drag.startY;
      // Move every selected element from its captured origin (no drift), then
      // reflow so any connector bound to a moved element follows it live.
      setScene((s) => ({
        ...s,
        elements: reflowElements(s.elements.map((el) => {
          const o = drag.origs.get(el.id);
          if (!o) return el;
          const copy: CanvasElement = "points" in o
            ? { ...(el as PathElement), x: o.x + dx, y: o.y + dy, points: (o as PathElement).points.map((p) => [p[0] + dx, p[1] + dy] as [number, number]) }
            : { ...el, x: o.x + dx, y: o.y + dy };
          return copy;
        })),
      }));
    } else if (drag.kind === "resize") {
      setScene((s) => ({
        ...s,
        elements: reflowElements(s.elements.map((el) => {
          if (el.id !== drag.id) return el;
          const copy = cloneEl(el);
          applyResize(copy, drag.orig, drag.handle, world);
          return copy;
        })),
      }));
    } else if (drag.kind === "endpoint") {
      patchElement(drag.id, (el) => {
        if (!("points" in el)) return;
        el.points[drag.end === 0 ? 0 : el.points.length - 1] = [world.x, world.y];
        syncPathBounds(el as PathElement);
      });
      let hover: string | null = null;
      for (let i = scene.elements.length - 1; i >= 0; i--) { const c = scene.elements[i]; if (c.id === drag.id || !isBindable(c)) continue; if (hitTest(c, world.x, world.y, 6 / vp.zoom)) { hover = c.id; break; } }
      setHoverBindId(hover);
    } else if (drag.kind === "marquee") {
      const box = normalizeBox({ x: drag.startX, y: drag.startY, w: world.x - drag.startX, h: world.y - drag.startY });
      setMarquee(box);
      const base = new Set(drag.base);
      for (const el of scene.elements) if (elementInBox(el, box)) base.add(el.id);
      setSelectedIds(base);
    }
  }, [patchElement, toWorld, scene.elements, vp]);

  const onPointerUp = useCallback(() => {
    // In multi-point arrow mode: a press-DRAG ends the arrow (quick 2-point, or
    // the final segment); a plain CLICK keeps adding bends (dbl-click/Esc ends).
    if (multiRef.current) {
      dragRef.current = null;
      const moved = dist([lastPtrRef.current.sx, lastPtrRef.current.sy], [multiRef.current.downX, multiRef.current.downY]);
      if (moved > 5) finishMultiArrow();
      setHoverBindId(null);
      bump();
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.kind === "draw" || drag.kind === "path") {
      // discard an accidental zero-size click; else finalize + commit
      setScene((s) => {
        const el = s.elements.find((x) => x.id === drag.id);
        if (!el) return s;
        const tiny = "points" in el
          ? el.points.length < 2 && el.type !== "freedraw"
          : el.w < 3 && el.h < 3;
        let elements = s.elements;
        if (tiny) { elements = s.elements.filter((x) => x.id !== drag.id); selectOne(null); }
        else {
          // connector end-binding: a line/arrow that ends on an element binds to it
          let toId: string | undefined;
          if (el.type === "line" || el.type === "arrow") {
            const end = el.points[el.points.length - 1];
            for (let i = s.elements.length - 1; i >= 0; i--) {
              const cand = s.elements[i];
              if (cand.id === drag.id || cand.id === el.fromId || !isBindable(cand)) continue;
              if (hitTest(cand, end[0], end[1], 6 / s.viewport.zoom)) { toId = cand.id; break; }
            }
          }
          elements = s.elements.map((x) => {
            if (x.id !== drag.id) return x;
            if ("points" in x) {
              const c: PathElement = { ...(x as PathElement), points: x.points.map((p) => [p[0], p[1]] as [number, number]) };
              if ((c.type === "line" || c.type === "arrow") && toId) c.toId = toId;
              syncPathBounds(c);
              return c;
            }
            return { ...x, ...normalizeBox(x) };
          });
          elements = reflowElements(elements);
          // The drawing tool STAYS active (like Excalidraw with tool-lock) so
          // you can keep drawing shapes/lines/pen strokes without re-picking it.
        }
        const next = { ...s, elements };
        onChange(next);
        return next;
      });
    } else if (drag.kind === "move" || drag.kind === "resize") {
      setScene((s) => { onChange(s); return s; });
    } else if (drag.kind === "endpoint") {
      // Re-bind (or free) the dragged endpoint based on where it landed.
      setScene((s) => {
        const el = s.elements.find((x) => x.id === drag.id);
        if (!el || !("points" in el)) return s;
        const p = el.points[drag.end === 0 ? 0 : el.points.length - 1];
        let bindId: string | undefined;
        for (let k = s.elements.length - 1; k >= 0; k--) {
          const c = s.elements[k];
          if (c.id === drag.id || !isBindable(c)) continue;
          if (hitTest(c, p[0], p[1], 6 / s.viewport.zoom)) { bindId = c.id; break; }
        }
        let elements = s.elements.map((x) => {
          if (x.id !== drag.id) return x;
          const xp = x as PathElement;
          const c: PathElement = { ...xp, points: xp.points.map((pp) => [pp[0], pp[1]] as [number, number]) };
          if (drag.end === 0) c.fromId = bindId; else c.toId = bindId;
          syncPathBounds(c);
          return c;
        });
        elements = reflowElements(elements);
        const next = { ...s, elements };
        onChange(next);
        return next;
      });
    } else if (drag.kind === "marquee") {
      setMarquee(null); // selection was updated live in onPointerMove
    }
    setHoverBindId(null);
    // pan doesn't touch persisted elements — no onChange
    bump();
  }, [onChange, bump, selectOne, finishMultiArrow]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0015);
      setScene((s) => {
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.viewport.zoom * factor));
        const k = zoom / s.viewport.zoom;
        return { ...s, viewport: { zoom, x: sx - (sx - s.viewport.x) * k, y: sy - (sy - s.viewport.y) * k } };
      });
    } else {
      setScene((s) => ({ ...s, viewport: { ...s.viewport, x: s.viewport.x - e.deltaX, y: s.viewport.y - e.deltaY } }));
    }
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setScene((s) => {
      const { w, h } = sizeRef.current;
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.viewport.zoom * factor));
      const k = zoom / s.viewport.zoom;
      return { ...s, viewport: { zoom, x: w / 2 - (w / 2 - s.viewport.x) * k, y: h / 2 - (h / 2 - s.viewport.y) * k } };
    });
  }, []);

  const fitView = useCallback(() => {
    const b = sceneBounds(scene);
    const { w, h } = sizeRef.current;
    if (!b || w === 0) return;
    const zoom = Math.max(MIN_ZOOM, Math.min(1.5, Math.min(w / (b.w + 120), h / (b.h + 120))));
    setScene((s) => ({ ...s, viewport: { zoom, x: w / 2 - (b.x + b.w / 2) * zoom, y: h / 2 - (b.y + b.h / 2) * zoom } }));
  }, [scene]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.filter((el) => !selectedIds.has(el.id)) };
    setSelectedIds(new Set());
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const applyStroke = useCallback((color: string) => {
    setStroke(color);
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) => {
        if (!selectedIds.has(el.id)) return el;
        if (el.type === "sticky") return { ...el, fill: color };
        return { ...el, stroke: color };
      }),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const applyFill = useCallback((color: string) => {
    setFillColor(color);
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) =>
        selectedIds.has(el.id) && (el.type === "rect" || el.type === "ellipse" || el.type === "diamond")
          ? { ...el, fill: color } : el,
      ),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const applyWidth = useCallback((width: number) => {
    setStrokeW(width);
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) =>
        selectedIds.has(el.id) && el.type !== "text" && el.type !== "sticky" && el.type !== "image"
          ? { ...el, strokeWidth: width } : el,
      ),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const applyArrowType = useCallback((t: ArrowType) => {
    setArrowType(t);
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) =>
        selectedIds.has(el.id) && (el.type === "line" || el.type === "arrow") ? { ...el, arrowType: t } : el,
      ),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  // Duplicate the given elements with an offset + fresh ids; returns the copies.
  const pasteElements = useCallback((src: CanvasElement[], dx = 16, dy = 16) => {
    if (src.length === 0) return;
    const snapshot = cloneScene(scene);
    const copies: CanvasElement[] = src.map((el) => {
      const base = "points" in el
        ? { ...el, id: genId(), x: el.x + dx, y: el.y + dy, points: el.points.map((p) => [p[0] + dx, p[1] + dy] as [number, number]) }
        : { ...el, id: genId(), x: el.x + dx, y: el.y + dy };
      return base as CanvasElement;
    });
    const next = { ...scene, elements: [...scene.elements, ...copies] };
    setSelectedIds(new Set(copies.map((c) => c.id)));
    commit(next, snapshot);
  }, [scene, commit]);

  const duplicateSelected = useCallback(() => {
    pasteElements(scene.elements.filter((el) => selectedIds.has(el.id)));
  }, [scene.elements, selectedIds, pasteElements]);

  const copySelected = useCallback(() => {
    clipboardRef.current = scene.elements.filter((el) => selectedIds.has(el.id)).map((el) => cloneEl(el));
  }, [scene.elements, selectedIds]);

  const nudge = useCallback((dx: number, dy: number) => {
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) => {
        if (!selectedIds.has(el.id)) return el;
        return "points" in el
          ? { ...el, x: el.x + dx, y: el.y + dy, points: el.points.map((p) => [p[0] + dx, p[1] + dy] as [number, number]) }
          : { ...el, x: el.x + dx, y: el.y + dy };
      }),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const reorderZ = useCallback((toFront: boolean) => {
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const sel = scene.elements.filter((el) => selectedIds.has(el.id));
    const rest = scene.elements.filter((el) => !selectedIds.has(el.id));
    commit({ ...scene, elements: toFront ? [...rest, ...sel] : [...sel, ...rest] }, snapshot);
  }, [selectedIds, scene, commit]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const world = toWorld(sx, sy);
    const hit = hitTopElement(scene, world.x, world.y, 8 / vp.zoom);
    if (hit) { if (!selectedIds.has(hit.id)) selectOne(hit.id); }
    else selectOne(null);
    setShapesOpen(false);
    const cx = Math.min(sx, Math.max(0, rect.width - 190));
    setCtxMenu({ x: cx, y: sy, onElement: !!hit, hasClipboard: clipboardRef.current.length > 0 });
  }, [scene, vp, selectedIds, toWorld, selectOne]);

  // Insert an image centred on (wx,wy) world coords — downscaled, aspect kept,
  // capped to a sensible initial size.
  const addImageAt = useCallback(async (file: File, wx: number, wy: number) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const { src, w, h } = await loadScaledImage(file, 1600);
      const maxW = 480;
      const scale = w > maxW ? maxW / w : 1;
      const ew = Math.max(1, w * scale), eh = Math.max(1, h * scale);
      const id = genId();
      const el: ImageElement = { id, type: "image", x: wx - ew / 2, y: wy - eh / 2, w: ew, h: eh, stroke: "transparent", fill: "transparent", strokeWidth: 0, opacity: 1, src };
      setScene((s) => {
        const snapshot = cloneScene(s);
        undoRef.current.push(snapshot);
        if (undoRef.current.length > 100) undoRef.current.shift();
        redoRef.current = [];
        const next = { ...s, elements: [...s.elements, el] };
        onChange(next);
        return next;
      });
      setSelectedIds(new Set([id]));
      setTool("select");
      bump();
    } catch { /* unreadable image — ignore */ }
  }, [onChange, bump]);

  const centreWorld = useCallback(() => {
    const { w, h } = sizeRef.current;
    return toWorld(w / 2, h / 2);
  }, [toWorld]);

  const addTaskCard = useCallback((task: TaskSummary) => {
    const c = centreWorld();
    const w = 240, h = 92;
    const id = genId();
    const el: TaskCardElement = {
      id, type: "taskCard", x: c.x - w / 2, y: c.y - h / 2, w, h,
      stroke: "#E2E8F0", fill: "#FFFFFF", strokeWidth: 1, opacity: 1,
      itemId: task.id, title: task.title, status: task.status,
      statusLabel: task.statusLabel, statusColor: task.statusColor, meta: task.meta,
    };
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: [...scene.elements, el] };
    setSelectedIds(new Set([id]));
    setTaskPickerOpen(false);
    commit(next, snapshot);
  }, [scene, commit, centreWorld]);

  const openTaskPicker = useCallback(() => {
    setTaskPickerOpen(true);
    if (tasks === null && loadTasks) {
      void loadTasks().then((t) => setTasks(t)).catch(() => setTasks([]));
    }
  }, [tasks, loadTasks]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "TEXTAREA" || t.tagName === "INPUT";
      // Hold Space = temporary pan (returns to your tool on release). Not while typing.
      if (e.key === " " && !typing) { e.preventDefault(); spaceRef.current = true; setSpaceDown(true); return; }
      if (typing) return;
      // Enter / Escape finish an in-progress multi-point arrow.
      if ((e.key === "Enter" || e.key === "Escape") && multiRef.current) { e.preventDefault(); finishMultiArrow(); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSelectedIds(new Set(scene.elements.map((el) => el.id))); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); return; }
      if (mod && e.key.toLowerCase() === "c") { copySelected(); return; }
      // ⌘V is handled by the native paste listener below (so an OS-clipboard
      // image or our internal element copy both route through one place).
      if (e.key === "Delete" || e.key === "Backspace") { if (selectedIds.size > 0) { e.preventDefault(); deleteSelected(); } return; }
      if (e.key === "Escape") { setSelectedIds(new Set()); return; }
      if (e.key.startsWith("Arrow") && selectedIds.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") nudge(-step, 0);
        else if (e.key === "ArrowRight") nudge(step, 0);
        else if (e.key === "ArrowUp") nudge(0, -step);
        else if (e.key === "ArrowDown") nudge(0, step);
        return;
      }
      // Number keys pick a tool (Excalidraw-style speed for drawing flows).
      if (!mod && TOOL_BY_NUM[e.key]) { setTool(TOOL_BY_NUM[e.key]); return; }
      const match = TOOLS.find((x) => x.key?.toLowerCase() === e.key.toLowerCase());
      if (match) setTool(match.tool);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === " ") { spaceRef.current = false; setSpaceDown(false); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [undo, redo, deleteSelected, duplicateSelected, copySelected, nudge, selectedIds, scene.elements, finishMultiArrow]);

  // Native paste: an OS-clipboard image inserts an image; otherwise our
  // internal element copy (from ⌘C) is pasted. Ignored while editing text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = document.activeElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const items = e.clipboardData?.items;
      if (items) {
        for (const it of items) {
          if (it.type.startsWith("image/")) {
            const file = it.getAsFile();
            if (file) { e.preventDefault(); const p = centreWorld(); void addImageAt(file, p.x, p.y); }
            return;
          }
        }
      }
      if (clipboardRef.current.length > 0) { e.preventDefault(); pasteElements(clipboardRef.current); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageAt, pasteElements, centreWorld]);

  // text-edit commit
  const commitText = useCallback((value: string) => {
    if (!editing) return;
    const id = editing.id;
    setEditing(null);
    setScene((s) => {
      const el = s.elements.find((x) => x.id === id);
      if (!el) return s;
      // drop an empty text element (a click that typed nothing)
      if (el.type === "text" && value.trim() === "") {
        const next = { ...s, elements: s.elements.filter((x) => x.id !== id) };
        onChange(next);
        return next;
      }
      const next = { ...s, elements: s.elements.map((x) => {
        if (x.id !== id) return x;
        if (x.type === "text" || x.type === "sticky") return { ...x, text: value };
        if (x.type === "frame") return { ...x, title: value.trim() || "Frame" };
        return x;
      }) };
      onChange(next);
      return next;
    });
  }, [editing, onChange]);

  const editingEl = editing ? scene.elements.find((e) => e.id === editing.id) : null;
  const cursor = spaceDown || tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";

  return (
    <div ref={wrapRef} className="wbcanvas" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          if (multiRef.current) { finishMultiArrow(); return; }
          const rect = canvasRef.current!.getBoundingClientRect();
          const world = toWorld(e.clientX - rect.left, e.clientY - rect.top);
          const hit = hitTopElement(scene, world.x, world.y, 8 / vp.zoom);
          if (hit && (hit.type === "text" || hit.type === "sticky" || hit.type === "frame")) { selectOne(hit.id); setEditing({ id: hit.id }); }
          else if (hit && hit.type === "taskCard" && onOpenTask) onOpenTask(hit.itemId);
        }}
        onDragOver={(e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => {
          const file = e.dataTransfer?.files?.[0];
          if (file && file.type.startsWith("image/")) {
            e.preventDefault();
            const rect = canvasRef.current!.getBoundingClientRect();
            const p = toWorld(e.clientX - rect.left, e.clientY - rect.top);
            void addImageAt(file, p.x, p.y);
          }
        }}
        style={{ display: "block", touchAction: "none", cursor }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) { const p = centreWorld(); void addImageAt(file, p.x, p.y); }
          e.target.value = "";
        }}
      />

      {/* text / sticky editing overlay */}
      {editingEl && (editingEl.type === "text" || editingEl.type === "sticky") ? (
        <textarea
          autoFocus
          defaultValue={editingEl.text}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          style={{
            position: "absolute",
            left: editingEl.x * vp.zoom + vp.x,
            top: editingEl.y * vp.zoom + vp.y,
            width: Math.max(60, editingEl.w * vp.zoom),
            height: Math.max(28, editingEl.h * vp.zoom),
            fontSize: editingEl.fontSize * vp.zoom,
            lineHeight: 1.3,
            padding: editingEl.type === "sticky" ? 10 * vp.zoom : 0,
            border: "none", outline: "2px solid #0073EA", borderRadius: editingEl.type === "sticky" ? 6 : 3,
            background: editingEl.type === "sticky" ? editingEl.fill : "transparent",
            color: editingEl.type === "text" ? editingEl.stroke : "#1E293B",
            resize: "none", overflow: "hidden", fontFamily: "inherit",
          }}
        />
      ) : null}

      {/* frame title editing */}
      {editingEl && editingEl.type === "frame" ? (
        <input
          autoFocus
          defaultValue={editingEl.title}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
          style={{
            position: "absolute",
            left: editingEl.x * vp.zoom + vp.x,
            top: (editingEl.y - 24) * vp.zoom + vp.y,
            width: Math.max(90, editingEl.w * vp.zoom),
            fontSize: 13 * vp.zoom, fontWeight: 600,
            border: "none", outline: "2px solid #0073EA", borderRadius: 4, padding: "1px 4px",
            background: "#fff", color: "#475569", fontFamily: "inherit",
          }}
        />
      ) : null}

      {/* task-card picker */}
      {taskPickerOpen ? (
        <>
          <div style={{ position: "absolute", inset: 0, zIndex: 8 }} onClick={() => setTaskPickerOpen(false)} aria-hidden />
          <div style={taskPanelStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--os-line, #e5e7eb)" }}>
              <Search style={{ width: 14, height: 14, color: "var(--os-ink-3, #9aa3b2)" }} />
              <input
                autoFocus
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                placeholder="Search tasks to drop on the board…"
                style={{ flex: 1, border: "none", outline: "none", fontSize: 13.5, background: "transparent", color: "var(--os-ink, #1e293b)" }}
              />
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", padding: 6 }}>
              {tasks === null ? (
                <p style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>Loading tasks…</p>
              ) : (() => {
                const q = taskQuery.trim().toLowerCase();
                const list = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
                if (list.length === 0) return <p style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>{tasks.length === 0 ? "No tasks yet." : "No matches."}</p>;
                return list.slice(0, 100).map((t) => (
                  <button key={t.id} type="button" onClick={() => addTaskCard(t)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--os-surface-1, #f4f4f5)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: t.statusColor || "#94A3B8", flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--os-ink, #1e293b)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                    {t.meta ? <span style={{ fontSize: 12, color: "var(--os-ink-3, #9aa3b2)", flex: "none" }}>{t.meta}</span> : null}
                  </button>
                ));
              })()}
            </div>
          </div>
        </>
      ) : null}

      {/* right-click context menu */}
      {ctxMenu ? (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 19 }} onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} aria-hidden />
          <div style={{ position: "absolute", left: ctxMenu.x, top: ctxMenu.y, zIndex: 20, minWidth: 176, background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)", borderRadius: 10, boxShadow: "0 12px 36px rgba(20,34,60,.16)", padding: 5 }}>
            {ctxMenu.onElement ? (
              <>
                <CtxItem label="Duplicate" hint="⌘D" onClick={() => { duplicateSelected(); setCtxMenu(null); }} />
                <CtxItem label="Bring to front" onClick={() => { reorderZ(true); setCtxMenu(null); }} />
                <CtxItem label="Send to back" onClick={() => { reorderZ(false); setCtxMenu(null); }} />
                <div style={{ height: 1, background: "var(--os-line, #eee)", margin: "4px 6px" }} />
                <CtxItem label="Delete" hint="⌫" danger onClick={() => { deleteSelected(); setCtxMenu(null); }} />
              </>
            ) : (
              <>
                {ctxMenu.hasClipboard ? <CtxItem label="Paste" hint="⌘V" onClick={() => { pasteElements(clipboardRef.current); setCtxMenu(null); }} /> : null}
                <CtxItem label="Select all" hint="⌘A" onClick={() => { setSelectedIds(new Set(scene.elements.map((el) => el.id))); setCtxMenu(null); }} />
              </>
            )}
          </div>
        </>
      ) : null}

      {/* contextual style bar — shows when something is selected or a drawing
          tool is active (keeps the tools bar itself clean, ClickUp-style) */}
      {selectedIds.size > 0 || (tool !== "select" && tool !== "hand") ? (
        <div style={styleBarStyle}>
          {STROKE_COLORS.slice(0, 6).map((c) => (
            <button key={c} type="button" title="Stroke color" onClick={() => applyStroke(c)}
              style={{ width: 20, height: 20, borderRadius: 6, background: c, border: stroke === c ? "2px solid #0073EA" : "1px solid rgba(0,0,0,.15)", cursor: "pointer", padding: 0 }} />
          ))}
          <span style={{ width: 1, height: 20, background: "var(--os-line, #e5e7eb)", margin: "0 3px" }} />
          {FILL_COLORS.map((c) => (
            <button key={c} type="button" title={c === "transparent" ? "No fill" : "Fill color"} onClick={() => applyFill(c)}
              style={{
                width: 20, height: 20, borderRadius: 6, cursor: "pointer", padding: 0,
                background: c === "transparent" ? "linear-gradient(135deg, #fff 42%, #ef4444 44%, #ef4444 56%, #fff 58%)" : c,
                border: fillColor === c ? "2px solid #0073EA" : "1px solid rgba(0,0,0,.15)",
              }} />
          ))}
          <span style={{ width: 1, height: 20, background: "var(--os-line, #e5e7eb)", margin: "0 3px" }} />
          {[1, 2, 4].map((wdt) => (
            <button key={wdt} type="button" title={`${wdt === 1 ? "Thin" : wdt === 2 ? "Medium" : "Thick"} stroke`} onClick={() => applyWidth(wdt)}
              style={{ ...toolBtn(strokeW === wdt), width: 28, height: 28 }}>
              <span style={{ width: 15, height: wdt + 1, borderRadius: 4, background: strokeW === wdt ? "#fff" : "var(--os-ink-2, #52525b)" }} />
            </button>
          ))}
          {tool === "arrow" || tool === "line" || scene.elements.some((el) => selectedIds.has(el.id) && (el.type === "line" || el.type === "arrow")) ? (
            <>
              <span style={{ width: 1, height: 20, background: "var(--os-line, #e5e7eb)", margin: "0 3px" }} />
              {ARROW_TYPES.map(({ type: at, Icon, label }) => (
                <button key={at} type="button" title={`${label} arrow`} onClick={() => applyArrowType(at)} style={{ ...toolBtn(arrowType === at), width: 28, height: 28 }}>
                  <Icon style={{ width: 16, height: 16 }} />
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {/* toolbar */}
      <div className="wbcanvas__tools" style={toolbarStyle}>
        {TOOLS.map(({ tool: t, Icon, label, key, num }) => {
          const active = tool === t;
          const hint = num ?? key;
          return (
            <button key={t} type="button" title={`${label}${num ? ` (${num})` : key ? ` (${key})` : ""}`} onClick={() => setTool(t)}
              style={{ ...toolBtn(active), position: "relative" }}>
              <Icon style={{ width: 17, height: 17 }} />
              {hint ? (
                <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: 8, fontWeight: 700, lineHeight: 1, color: active ? "rgba(255,255,255,.85)" : "var(--os-ink-3, #9aa3b2)" }}>{hint}</span>
              ) : null}
            </button>
          );
        })}
        <div style={{ position: "relative" }}>
          <button type="button" title="More shapes" onClick={() => setShapesOpen((v) => !v)}
            style={toolBtn(shapesOpen || SHAPE_FLYOUT.some((s) => s.tool === tool))}>
            <Shapes style={{ width: 17, height: 17 }} />
          </button>
          {shapesOpen ? (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 0 }} onClick={() => setShapesOpen(false)} aria-hidden />
              <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 8, display: "flex", gap: 3, padding: 5, background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)", borderRadius: 10, boxShadow: "0 6px 24px rgba(20,34,60,.14)", zIndex: 1 }}>
                {SHAPE_FLYOUT.map(({ tool: t, Icon, label }) => (
                  <button key={t} type="button" title={label} onClick={() => { setTool(t); setShapesOpen(false); }} style={toolBtn(tool === t)}>
                    <Icon style={{ width: 17, height: 17 }} />
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <button type="button" title="Frame (labeled container)" onClick={() => setTool("frame")} style={toolBtn(tool === "frame")}>
          <FrameIcon style={{ width: 17, height: 17 }} />
        </button>
        <button type="button" title="Insert image (or paste / drop one)" onClick={() => fileRef.current?.click()} style={toolBtn(false)}>
          <ImagePlus style={{ width: 17, height: 17 }} />
        </button>
        {loadTasks ? (
          <button type="button" title="Insert task card" onClick={openTaskPicker} style={toolBtn(taskPickerOpen)}>
            <ListTodo style={{ width: 17, height: 17 }} />
          </button>
        ) : null}
        <span style={{ width: 1, height: 22, background: "var(--os-line, #e5e7eb)", margin: "0 2px" }} />
        <button type="button" title="Undo (⌘Z)" onClick={undo} disabled={hist.u === 0} style={toolBtn(false)}><Undo2 style={{ width: 16, height: 16 }} /></button>
        <button type="button" title="Redo (⌘⇧Z)" onClick={redo} disabled={hist.r === 0} style={toolBtn(false)}><Redo2 style={{ width: 16, height: 16 }} /></button>
        <button type="button" title="Delete (⌫)" onClick={deleteSelected} disabled={selectedIds.size === 0} style={toolBtn(false)}><Trash2 style={{ width: 16, height: 16 }} /></button>
      </div>

      {/* zoom */}
      <div className="wbcanvas__zoom" style={zoomStyle}>
        <button type="button" title="Zoom out" onClick={() => zoomBy(1 / 1.2)} style={zoomBtn}><MinusIcon style={{ width: 15, height: 15 }} /></button>
        <button type="button" title="Fit / reset" onClick={fitView} style={{ ...zoomBtn, width: 52, fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>{Math.round(vp.zoom * 100)}%</button>
        <button type="button" title="Zoom in" onClick={() => zoomBy(1.2)} style={zoomBtn}><Plus style={{ width: 15, height: 15 }} /></button>
      </div>
    </div>
  );
}

// ── drawing helpers ─────────────────────────────────────────────────────────
function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, getImage: (src: string) => HTMLImageElement | null) {
  ctx.save();
  ctx.globalAlpha = el.opacity;

  if (el.type === "image") {
    const img = getImage(el.src);
    if (img) {
      ctx.drawImage(img, el.x, el.y, el.w, el.h);
    } else {
      // placeholder while the data URL decodes
      ctx.fillStyle = "#EEF1F6";
      ctx.strokeStyle = "#CBD5E1";
      ctx.lineWidth = 1;
      ctx.fillRect(el.x, el.y, el.w, el.h);
      ctx.strokeRect(el.x, el.y, el.w, el.h);
    }
    ctx.restore();
    return;
  }

  if (el.type === "taskCard") {
    ctx.fillStyle = "#FFFFFF";
    roundRect(ctx, el.x, el.y, el.w, el.h, 10);
    ctx.fill();
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, el.x, el.y, el.w, el.h, 10);
    ctx.clip();
    ctx.fillStyle = el.statusColor || "#94A3B8";
    ctx.fillRect(el.x, el.y, 4, el.h);
    ctx.restore();
    const pad = 14;
    ctx.fillStyle = "#1E293B";
    ctx.textBaseline = "top";
    ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
    wrapText(ctx, el.title || "Untitled task", el.x + pad, el.y + 14, el.w - pad - 12, 18, 2);
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    const label = (el.statusLabel || el.status || "").toUpperCase();
    const lw = ctx.measureText(label).width;
    ctx.globalAlpha = el.opacity * 0.16;
    ctx.fillStyle = el.statusColor || "#94A3B8";
    roundRect(ctx, el.x + pad, el.y + el.h - 26, lw + 16, 17, 8);
    ctx.fill();
    ctx.globalAlpha = el.opacity;
    ctx.fillStyle = el.statusColor || "#64748B";
    ctx.fillText(label, el.x + pad + 8, el.y + el.h - 23);
    if (el.meta) {
      ctx.fillStyle = "#94A3B8";
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      const mw = ctx.measureText(el.meta).width;
      ctx.fillText(el.meta, el.x + el.w - pad - mw, el.y + el.h - 22);
    }
    ctx.restore();
    return;
  }

  if (el.type === "frame") {
    ctx.fillStyle = "rgba(148,163,184,0.06)";
    roundRect(ctx, el.x, el.y, el.w, el.h, 8);
    ctx.fill();
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#64748B";
    ctx.textBaseline = "bottom";
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(el.title || "Frame", el.x + 2, el.y - 6);
    ctx.restore();
    return;
  }
  ctx.strokeStyle = el.stroke;
  ctx.fillStyle = el.fill;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (el.type === "rect") {
    if (el.fill !== "transparent") ctx.fillRect(el.x, el.y, el.w, el.h);
    if (el.strokeWidth > 0) ctx.strokeRect(el.x, el.y, el.w, el.h);
  } else if (el.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.type === "diamond") {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx, el.y); ctx.lineTo(el.x + el.w, cy); ctx.lineTo(cx, el.y + el.h); ctx.lineTo(el.x, cy); ctx.closePath();
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.type === "roundRect") {
    roundRect(ctx, el.x, el.y, el.w, el.h, Math.min(16, el.w / 4, el.h / 4));
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.type === "triangle") {
    ctx.beginPath();
    ctx.moveTo(el.x + el.w / 2, el.y); ctx.lineTo(el.x + el.w, el.y + el.h); ctx.lineTo(el.x, el.y + el.h); ctx.closePath();
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.type === "parallelogram") {
    const off = Math.min(el.w * 0.25, el.h);
    ctx.beginPath();
    ctx.moveTo(el.x + off, el.y); ctx.lineTo(el.x + el.w, el.y); ctx.lineTo(el.x + el.w - off, el.y + el.h); ctx.lineTo(el.x, el.y + el.h); ctx.closePath();
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.type === "cylinder") {
    const ry = Math.max(3, Math.min(el.h * 0.14, el.w * 0.4));
    ctx.beginPath();
    ctx.moveTo(el.x, el.y + ry);
    ctx.lineTo(el.x, el.y + el.h - ry);
    ctx.bezierCurveTo(el.x, el.y + el.h, el.x + el.w, el.y + el.h, el.x + el.w, el.y + el.h - ry);
    ctx.lineTo(el.x + el.w, el.y + ry);
    ctx.closePath();
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(el.x + el.w / 2, el.y + ry, el.w / 2, ry, 0, 0, Math.PI * 2);
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.type === "cloud") {
    const { x, y, w, h } = el;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + h);
    ctx.bezierCurveTo(x, y + h, x, y + h * 0.55, x + w * 0.2, y + h * 0.48);
    ctx.bezierCurveTo(x + w * 0.16, y + h * 0.12, x + w * 0.52, y - h * 0.05, x + w * 0.62, y + h * 0.3);
    ctx.bezierCurveTo(x + w * 0.78, y + h * 0.02, x + w * 1.02, y + h * 0.22, x + w * 0.84, y + h * 0.52);
    ctx.bezierCurveTo(x + w * 1.02, y + h * 0.6, x + w * 0.98, y + h, x + w * 0.75, y + h);
    ctx.closePath();
    if (el.fill !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") {
    if (el.points.length > 0) {
      const head = strokeConnectorPath(ctx, el);
      ctx.stroke();
      if (el.type === "arrow" && head) drawArrowhead(ctx, head[0], head[1], el.strokeWidth);
    }
  } else if (el.type === "sticky") {
    ctx.fillStyle = el.fill;
    roundRect(ctx, el.x, el.y, el.w, el.h, 8);
    ctx.fill();
    ctx.fillStyle = "#1E293B";
    ctx.font = `${el.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    wrapText(ctx, el.text, el.x + 10, el.y + 10 + el.fontSize, el.w - 20, el.fontSize * 1.35);
  } else if (el.type === "text") {
    ctx.fillStyle = el.stroke;
    ctx.textBaseline = "top";
    ctx.font = `${el.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    wrapText(ctx, el.text, el.x, el.y, el.w, el.fontSize * 1.35);
  }
  ctx.restore();
}

/** Trace a line/arrow into ctx following its arrowType (straight / elbow /
 *  curved through all its points). Returns [penultimate, last] for the
 *  arrowhead direction, or null. Does NOT stroke — the caller does. */
function strokeConnectorPath(ctx: CanvasRenderingContext2D, el: PathElement): [[number, number], [number, number]] | null {
  const pts = el.points;
  const type: ArrowType = el.type === "freedraw" ? "straight" : (el.arrowType ?? "straight");
  ctx.beginPath();
  if (pts.length < 2) { if (pts.length === 1) ctx.moveTo(pts[0][0], pts[0][1]); return null; }

  if (type === "elbow") {
    const route: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) route.push(...elbowPoints(pts[i - 1], pts[i]).slice(1));
    ctx.moveTo(route[0][0], route[0][1]);
    for (let i = 1; i < route.length; i++) ctx.lineTo(route[i][0], route[i][1]);
    return [route[route.length - 2], route[route.length - 1]];
  }

  if (type === "curved" && pts.length >= 3) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i][0] + pts[i + 1][0]) / 2, yc = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
    }
    ctx.quadraticCurveTo(pts[pts.length - 2][0], pts[pts.length - 2][1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
    return [pts[pts.length - 2], pts[pts.length - 1]];
  }

  // straight (also curved with only 2 points)
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  return [pts[pts.length - 2], pts[pts.length - 1]];
}

function drawArrowhead(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], sw: number) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const len = 8 + sw * 2;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - len * Math.cos(angle - Math.PI / 6), to[1] - len * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - len * Math.cos(angle + Math.PI / 6), to[1] - len * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = Infinity) {
  if (!text) return;
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines && shown.length > 0) {
    // ellipsize the last visible line
    let last = shown[shown.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    shown[shown.length - 1] = `${last}…`;
  }
  for (const l of shown) { ctx.fillText(l, x, y); y += lineH; }
}

function drawSelection(ctx: CanvasRenderingContext2D, el: CanvasElement, vp: { x: number; y: number; zoom: number }, withHandles: boolean) {
  ctx.save();
  ctx.strokeStyle = "#0073EA";
  ctx.setLineDash([]);

  // Lines / arrows / pen: highlight the STROKE itself (never a rectangle box),
  // with square handles at the two endpoints of a line/arrow.
  if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") {
    const pts = el.points;
    if (pts.length > 0) {
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.lineWidth = el.strokeWidth * vp.zoom + 4;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * vp.zoom + vp.x, pts[0][1] * vp.zoom + vp.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * vp.zoom + vp.x, pts[i][1] * vp.zoom + vp.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (el.type !== "freedraw" && pts.length >= 2) {
      ctx.fillStyle = "#fff";
      ctx.lineWidth = 1.5;
      for (const p of [pts[0], pts[pts.length - 1]]) {
        const sx = p[0] * vp.zoom + vp.x, sy = p[1] * vp.zoom + vp.y;
        ctx.fillRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
        ctx.strokeRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
      }
    }
    ctx.restore();
    return;
  }

  // Shapes / text / sticky / image / task cards: bounding box + corner handles.
  const x = el.x * vp.zoom + vp.x, y = el.y * vp.zoom + vp.y, w = el.w * vp.zoom, h = el.h * vp.zoom;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  if (withHandles) {
    ctx.fillStyle = "#fff";
    for (const [hx, hy] of handlePositions(x, y, w, h)) {
      ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    }
  }
  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, vp: { x: number; y: number; zoom: number }) {
  const x = box.x * vp.zoom + vp.x, y = box.y * vp.zoom + vp.y, w = box.w * vp.zoom, h = box.h * vp.zoom;
  ctx.save();
  ctx.fillStyle = "rgba(0,115,234,0.08)";
  ctx.strokeStyle = "#0073EA";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function handlePositions(x: number, y: number, w: number, h: number): [number, number][] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; // corners: 0 TL, 1 TR, 2 BR, 3 BL
}

/** Which endpoint of a line/arrow is under (sx,sy) — 0 (start), 1 (end), or -1. */
function hitEndpoint(el: CanvasElement, sx: number, sy: number, vp: { x: number; y: number; zoom: number }): 0 | 1 | -1 {
  if (el.type !== "line" && el.type !== "arrow") return -1;
  const pts = el.points;
  if (pts.length < 2) return -1;
  for (const [end, p] of [[0, pts[0]], [1, pts[pts.length - 1]]] as [0 | 1, [number, number]][]) {
    const px = p[0] * vp.zoom + vp.x, py = p[1] * vp.zoom + vp.y;
    if (Math.abs(sx - px) <= HANDLE && Math.abs(sy - py) <= HANDLE) return end;
  }
  return -1;
}

function hitHandle(el: CanvasElement, sx: number, sy: number, vp: { x: number; y: number; zoom: number }): number {
  if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") return -1;
  const x = el.x * vp.zoom + vp.x, y = el.y * vp.zoom + vp.y, w = el.w * vp.zoom, h = el.h * vp.zoom;
  const hs = handlePositions(x, y, w, h);
  for (let i = 0; i < hs.length; i++) {
    if (Math.abs(sx - hs[i][0]) <= HANDLE && Math.abs(sy - hs[i][1]) <= HANDLE) return i;
  }
  return -1;
}

function applyResize(el: CanvasElement, orig: CanvasElement, handle: number, world: { x: number; y: number }) {
  let left = orig.x, top = orig.y, right = orig.x + orig.w, bottom = orig.y + orig.h;
  if (handle === 0) { left = world.x; top = world.y; }
  else if (handle === 1) { right = world.x; top = world.y; }
  else if (handle === 2) { right = world.x; bottom = world.y; }
  else if (handle === 3) { left = world.x; bottom = world.y; }
  const box = normalizeBox({ x: left, y: top, w: right - left, h: bottom - top });
  el.x = box.x; el.y = box.y; el.w = box.w; el.h = box.h;
}

function cloneEl(el: CanvasElement): CanvasElement {
  return "points" in el ? { ...el, points: el.points.map((p) => [p[0], p[1]] as [number, number]) } : { ...el };
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function CtxItem({ label, hint, danger, onClick }: { label: string; hint?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, width: "100%",
        padding: "7px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer",
        textAlign: "left", fontSize: 13.5, color: danger ? "#dc2626" : "var(--os-ink, #1e293b)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "rgba(220,38,38,0.08)" : "var(--os-surface-1, #f4f4f5)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span>{label}</span>
      {hint ? <span style={{ fontSize: 12, color: "var(--os-ink-3, #9aa3b2)" }}>{hint}</span> : null}
    </button>
  );
}

/** A connector can bind to any element that isn't a line/arrow/pen or a frame. */
function isBindable(el: CanvasElement): boolean {
  return el.type !== "line" && el.type !== "arrow" && el.type !== "freedraw" && el.type !== "frame";
}

/** Clone the bound connectors in `elements` (so reflow never mutates React
 *  state), recompute their endpoints, and return the new array. */
function reflowElements(elements: CanvasElement[]): CanvasElement[] {
  const cloned = elements.map((el) =>
    (el.type === "line" || el.type === "arrow") && (el.fromId || el.toId)
      ? { ...el, points: el.points.map((p) => [p[0], p[1]] as [number, number]) }
      : el,
  );
  reflowConnectors(cloned);
  return cloned;
}

// ── inline styles (kept local; the page owns the surrounding chrome) ─────────
// ClickUp puts the whiteboard toolbar at the bottom-centre.
const toolbarStyle: React.CSSProperties = {
  position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
  display: "flex", alignItems: "center", gap: 3, padding: 5,
  background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)",
  borderRadius: 12, boxShadow: "0 6px 24px rgba(20,34,60,.12)", zIndex: 5, flexWrap: "wrap", maxWidth: "calc(100vw - 24px)",
};
// Contextual style bar, floating just above the bottom tools bar.
const styleBarStyle: React.CSSProperties = {
  position: "absolute", bottom: 68, left: "50%", transform: "translateX(-50%)",
  display: "flex", alignItems: "center", gap: 3, padding: "5px 7px",
  background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)",
  borderRadius: 10, boxShadow: "0 6px 24px rgba(20,34,60,.12)", zIndex: 6,
  flexWrap: "wrap", maxWidth: "calc(100vw - 24px)",
};
const taskPanelStyle: React.CSSProperties = {
  position: "absolute", bottom: 116, left: "50%", transform: "translateX(-50%)", zIndex: 9,
  width: "min(420px, calc(100vw - 24px))",
  background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)",
  borderRadius: 12, boxShadow: "0 12px 36px rgba(20,34,60,.16)", overflow: "hidden",
};
const zoomStyle: React.CSSProperties = {
  position: "absolute", bottom: 16, left: 16, display: "flex", alignItems: "center", gap: 2, padding: 4,
  background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)", borderRadius: 10,
  boxShadow: "0 4px 16px rgba(20,34,60,.10)", zIndex: 5,
};
const zoomBtn: React.CSSProperties = {
  height: 28, minWidth: 28, display: "grid", placeItems: "center", border: "none", background: "transparent",
  borderRadius: 7, cursor: "pointer", color: "var(--os-ink-2, #52525b)", fontWeight: 600,
};
function toolBtn(active: boolean): React.CSSProperties {
  return {
    width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, cursor: "pointer",
    border: "none", background: active ? "#0073EA" : "transparent", color: active ? "#fff" : "var(--os-ink-2, #52525b)",
  };
}
