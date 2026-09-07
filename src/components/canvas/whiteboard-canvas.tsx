"use client";

// WorkwrK Canvas — the first-party whiteboard editor (Phase 0/1).
//
// A dependency-free HTML5 Canvas 2D editor over the scene model in
// src/lib/canvas. Renders in world space via the canvas transform; selection
// chrome is drawn in screen space so handles stay a constant size at any zoom.
// The parent owns persistence — we just emit the scene on every committed edit
// (create / move / resize / style / delete / text), and the parent's autosave
// discipline (size-aware keepalive + ContentVersion) is untouched.

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, forwardRef } from "react";
import {
  MousePointer2, Hand, Square, Circle, Diamond, Minus, ArrowRight,
  Pencil, Type as TypeIcon, StickyNote, ImagePlus, ListTodo, Search, Trash2, Undo2, Redo2, Plus, Minus as MinusIcon,
  Shapes, Triangle, Cloud, Database, RectangleHorizontal, Frame as FrameIcon, Table as TableIcon,
  MoveRight, CornerDownRight, Spline, AlignLeft, AlignCenter, AlignRight, Zap,
  ChevronsUp, ChevronsDown, Copy as CopyIcon, Group as GroupIcon, Ungroup as UngroupIcon,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  FlipHorizontal2, FlipVertical2, Lock, Unlock, Link2, Download, ExternalLink,
} from "lucide-react";

const ARROW_TYPES: { type: ArrowType; Icon: typeof MoveRight; label: string }[] = [
  { type: "straight", Icon: MoveRight, label: "Straight" },
  { type: "elbow", Icon: CornerDownRight, label: "Elbow" },
  { type: "curved", Icon: Spline, label: "Curved" },
];

// Text sizes for the style panel (S / M / L), shown for text + sticky notes.
const FONT_SIZES: { label: string; size: number }[] = [
  { label: "S", size: 16 },
  { label: "M", size: 20 },
  { label: "L", size: 28 },
];

// Text alignment options for the style panel.
const TEXT_ALIGNS: { align: TextAlign; Icon: typeof AlignLeft; label: string }[] = [
  { align: "left", Icon: AlignLeft, label: "Left" },
  { align: "center", Icon: AlignCenter, label: "Center" },
  { align: "right", Icon: AlignRight, label: "Right" },
];

// Arrowhead options (glyph shown in the panel button).
const HEAD_OPTS: { type: HeadType; glyph: string; label: string }[] = [
  { type: "none", glyph: "—", label: "None" },
  { type: "arrow", glyph: "→", label: "Arrow" },
  { type: "triangle", glyph: "▶", label: "Triangle" },
  { type: "dot", glyph: "●", label: "Dot" },
  { type: "bar", glyph: "⊢", label: "One (ER)" },
  { type: "crowsfoot", glyph: "⋔", label: "Many (ER)" },
  { type: "crowsfoot-one", glyph: "⥻", label: "One-or-many (ER)" },
];

// Extra flowchart shapes behind the toolbar's "More shapes" flyout (ClickUp).
const SHAPE_FLYOUT: { tool: Tool; Icon: typeof Square; label: string }[] = [
  { tool: "roundRect", Icon: Square, label: "Rounded rectangle" },
  { tool: "triangle", Icon: Triangle, label: "Triangle" },
  { tool: "parallelogram", Icon: RectangleHorizontal, label: "Parallelogram" },
  { tool: "cylinder", Icon: Database, label: "Cylinder / database" },
  { tool: "cloud", Icon: Cloud, label: "Cloud" },
  { tool: "table", Icon: TableIcon, label: "Database table (ER)" },
];
import {
  cloneScene, genId, hitTest, hitTopElement, normalizeBox, sceneBounds, syncPathBounds,
  elementInBox, reflowConnectors, frameChildren, isCanvasScene, emptyScene, elementEdgePoint, pathMidpoint, withGroupMembers, boundsOfElements,
  STROKE_COLORS, FILL_COLORS, STICKY_COLORS, DEFAULT_STROKE, DEFAULT_STROKE_WIDTH, DEFAULT_FONT_SIZE,
  tableHeight,
  type ArrowType, type DashStyle, type TextAlign, type HeadType, type CanvasElement, type CanvasScene, type FrameElement, type ImageElement, type PathElement, type ShapeElement, type TableElement, type TableField,
} from "@/lib/canvas/scene";
import { drawElement, drawCanvasCard, strokeConnectorPath, wrapLines } from "@/lib/canvas/render";
import { isExcalidrawScene, importExcalidraw } from "@/lib/canvas/import-excalidraw";

/** A work-graph item the picker can drop onto the canvas as a live card
 *  (a task, doc, …). Resolved by the host (which owns the data + colors) and
 *  passed in via `loadEntities`. `href` is the open target; `kind` labels it. */
export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  meta: string;
  href: string;
  kind?: string;
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
  | "line" | "arrow" | "freedraw" | "text" | "sticky" | "frame" | "laser" | "table";

const SHAPE_TOOLS = new Set<Tool>(["rect", "ellipse", "diamond", "roundRect", "triangle", "parallelogram", "cylinder", "cloud"]);

// Offscreen 2D context used to measure a label's wrapped height so a shape can
// grow to fit its text (created lazily; never rendered).
let _measureCtx: CanvasRenderingContext2D | null = null;
function labelHeightFor(text: string, boxW: number, fontSize: number): number {
  if (!text.trim()) return 0;
  if (!_measureCtx && typeof document !== "undefined") _measureCtx = document.createElement("canvas").getContext("2d");
  if (!_measureCtx) return 0;
  _measureCtx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  const lines = wrapLines(_measureCtx, text, Math.max(4, boxW - 16));
  return lines.length * fontSize * 1.3 + 16; // + vertical padding
}
// Element types that can carry a centred text label (double-click to edit).
const SHAPE_LABEL_TYPES = new Set<string>(["rect", "ellipse", "diamond", "roundRect", "triangle", "parallelogram", "cylinder", "cloud"]);

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
  { tool: "laser", Icon: Zap, label: "Laser pointer", key: "K" },
];
const TOOL_BY_NUM: Record<string, Tool> = Object.fromEntries(
  TOOLS.filter((t) => t.num).map((t) => [t.num!, t.tool]),
);

const HANDLE = 8; // px, screen space
const ROT_OFFSET = 22; // px above the top edge — where the rotation handle sits
const BIND_TOL = 14; // px, screen — how close counts as "over a shape" for magnetic binding
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;

type Box = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "draw"; id: string; startX: number; startY: number }
  | { kind: "path"; id: string }
  | { kind: "move"; ids: string[]; startX: number; startY: number; origs: Map<string, CanvasElement> }
  | { kind: "resize"; id: string; handle: number; orig: CanvasElement }
  | { kind: "endpoint"; id: string; vi: number } // dragging a line/arrow vertex (0=start, last=end, middle=bend)
  | { kind: "rotate"; id: string } // rotating a box element about its centre
  | { kind: "groupResize"; handle: number; bounds: { x: number; y: number; w: number; h: number }; orig: Map<string, CanvasElement> }
  | { kind: "groupRotate"; cx: number; cy: number; start: number; orig: Map<string, CanvasElement> }
  | { kind: "marquee"; startX: number; startY: number; add: boolean; base: string[] }
  | null;

export interface WhiteboardCanvasProps {
  initialScene: CanvasScene;
  onChange: (scene: CanvasScene) => void;
  /** Fetch work-graph items (tasks, docs, …) for the card picker. Omit to hide. */
  loadEntities?: () => Promise<TaskSummary[]>;
  /** Open a card's target (double-click) — receives its href. Omit = non-navigable. */
  onOpenEntity?: (href: string) => void;
}

/** Imperative handle — lets the page drop an AI-generated diagram onto the board. */
export interface WhiteboardCanvasHandle {
  insertScene: (generated: CanvasScene) => void;
}

export const WhiteboardCanvas = forwardRef<WhiteboardCanvasHandle, WhiteboardCanvasProps>(function WhiteboardCanvas(
  { initialScene, onChange, loadEntities, onOpenEntity },
  ref,
) {
  const [scene, setScene] = useState<CanvasScene>(initialScene);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [hoverBindId, setHoverBindId] = useState<string | null>(null); // shape a connector-in-progress will bind to
  const [hoverDot, setHoverDot] = useState<{ x: number; y: number } | null>(null); // screen-space connection dot on a shape edge
  const [stroke, setStroke] = useState(DEFAULT_STROKE);
  const [fillColor, setFillColor] = useState("transparent");
  const [strokeW, setStrokeW] = useState(DEFAULT_STROKE_WIDTH);
  const [arrowType, setArrowType] = useState<ArrowType>("straight");
  const [dash, setDash] = useState<DashStyle>("solid");
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [align, setAlign] = useState<TextAlign>("left");
  const [spaceDown, setSpaceDown] = useState(false); // hold-Space = temporary pan
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  // Reliable focus for the edit overlay: focus (+ size) the active field whenever
  // editing begins — autoFocus alone is flaky when the field mounts on a click.
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.select();
    // grow a shape/label textarea to fit its current content
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);
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
  // Linked Canvas scenes for canvas-in-canvas thumbnails; a fetch re-triggers draw.
  const linkedSceneCacheRef = useRef<Map<string, CanvasScene | null>>(new Map());
  const [linkedVersion, setLinkedVersion] = useState(0);
  const getLinkedScene = useCallback((id: string): CanvasScene | null => {
    const cache = linkedSceneCacheRef.current;
    if (cache.has(id)) return cache.get(id) ?? null;
    cache.set(id, null); // mark in-flight so we fetch each id once
    fetch(`/api/whiteboards/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d) => {
        const raw = d?.whiteboard?.scene;
        cache.set(id, isCanvasScene(raw) ? raw : isExcalidrawScene(raw) ? importExcalidraw(raw) : emptyScene());
        setLinkedVersion((v) => v + 1);
      })
      .catch(() => { /* leave null — the card shows a placeholder */ });
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
  const laserRef = useRef<{ x: number; y: number; t: number }[]>([]); // fading presenter trail (screen px)
  const laserCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag>(null);
  const multiRef = useRef<{ id: string; downX: number; downY: number } | null>(null); // in-progress multi-point arrow
  const lastPtrRef = useRef({ sx: 0, sy: 0 }); // last pointer pos (screen), for drag-vs-click
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
    for (const el of scene.elements) {
      if (el.type === "canvasCard") drawCanvasCard(ctx, el, getLinkedScene(el.whiteboardId), getImage);
      else drawElement(ctx, el, getImage, editing?.id === el.id);
    }

    // selection chrome in screen space: an outline per selected element, and
    // resize handles only when exactly one is selected (group resize is later).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const selected = scene.elements.filter((e) => selectedIds.has(e.id));
    for (const el of selected) drawSelection(ctx, el, vp, selected.length === 1 && !el.locked);
    // Multi-selection: a group bounding box with corner + rotation handles that
    // resize / rotate everything together.
    if (selected.length >= 2) {
      const gb = boundsOfElements(selected);
      if (gb) {
        const x = gb.x * vp.zoom + vp.x, y = gb.y * vp.zoom + vp.y, gw = gb.w * vp.zoom, gh = gb.h * vp.zoom;
        ctx.save();
        ctx.strokeStyle = "#0073EA"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.strokeRect(x - 1, y - 1, gw + 2, gh + 2);
        ctx.fillStyle = "#fff";
        for (const [hx, hy] of handlePositions(x, y, gw, gh)) {
          ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
        }
        const rx = x + gw / 2, ry = y - ROT_OFFSET;
        ctx.beginPath(); ctx.moveTo(x + gw / 2, y); ctx.lineTo(rx, ry); ctx.stroke();
        ctx.beginPath(); ctx.arc(rx, ry, HANDLE / 2 + 1, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
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
    // connection dot: where the arrow will attach on the hovered shape's edge
    if (hoverDot) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(hoverDot.x, hoverDot.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#0073EA";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }, [scene, selectedIds, marquee, hoverBindId, hoverDot, vp, getImage, getLinkedScene, editing]);

  // Redraw when the scene/viewport change, and when a pending image finishes
  // decoding (imgVersion bumps) so it replaces its placeholder.
  useLayoutEffect(() => { draw(); }, [draw, imgVersion, linkedVersion]);

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

  // Finish the in-progress multi-point arrow (edge-click / double-click / Enter /
  // Escape / press-drag): trim trailing floating/coincident points, bind the end
  // to a shape if it lands on one, or drop a stray zero-length arrow. Points are
  // preserved so the arrow renders per its arrowType (elbow / curved).
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
        if (hitTest(c, end[0], end[1], BIND_TOL / s.viewport.zoom)) { toId = c.id; break; }
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

  // Place the connection dot on shape `shapeId`'s edge, toward world (tx,ty).
  const updateHoverDot = useCallback((shapeId: string | null, tx: number, ty: number) => {
    if (!shapeId) { setHoverDot(null); return; }
    const shape = scene.elements.find((e) => e.id === shapeId);
    if (!shape) { setHoverDot(null); return; }
    const [ex, ey] = elementEdgePoint(shape, { x: tx, y: ty });
    setHoverDot({ x: ex * vp.zoom + vp.x, y: ey * vp.zoom + vp.y });
  }, [scene.elements, vp]);

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
        if (sel && !sel.locked && (sel.type === "line" || sel.type === "arrow")) {
          const vi = hitVertex(sel, sx, sy, vp);
          if (vi !== -1) {
            dragRef.current = { kind: "endpoint", id: sel.id, vi };
            undoRef.current.push(cloneScene(scene));
            return;
          }
          // Click ON the line (between vertices) → insert a bend there and drag it.
          const segIdx = hitSegment(sel, sx, sy, vp);
          if (segIdx !== -1) {
            undoRef.current.push(cloneScene(scene));
            patchElement(sel.id, (el) => { if ("points" in el) { el.points.splice(segIdx, 0, [world.x, world.y]); syncPathBounds(el as PathElement); } });
            dragRef.current = { kind: "endpoint", id: sel.id, vi: segIdx };
            return;
          }
        } else if (sel && !sel.locked) {
          if (hitRotateHandle(sel, sx, sy, vp)) {
            dragRef.current = { kind: "rotate", id: sel.id };
            undoRef.current.push(cloneScene(scene));
            return;
          }
          const handle = hitHandle(sel, sx, sy, vp);
          if (handle >= 0) {
            dragRef.current = { kind: "resize", id: sel.id, handle, orig: cloneEl(sel) };
            undoRef.current.push(cloneScene(scene));
            return;
          }
        }
      } else if (selectedIds.size >= 2) {
        // Group box handles: resize / rotate the whole selection.
        const selEls2 = scene.elements.filter((el) => selectedIds.has(el.id));
        const gb = boundsOfElements(selEls2);
        if (gb && !selEls2.some((el) => el.locked)) {
          const gx = gb.x * vp.zoom + vp.x, gy = gb.y * vp.zoom + vp.y, gw = gb.w * vp.zoom, gh = gb.h * vp.zoom;
          const rrx = gx + gw / 2, rry = gy - ROT_OFFSET;
          const origMap = new Map(selEls2.map((el) => [el.id, cloneEl(el)]));
          if (Math.hypot(sx - rrx, sy - rry) <= HANDLE) {
            const cx = gb.x + gb.w / 2, cy = gb.y + gb.h / 2;
            dragRef.current = { kind: "groupRotate", cx, cy, start: Math.atan2(world.y - cy, world.x - cx), orig: origMap };
            undoRef.current.push(cloneScene(scene));
            return;
          }
          const corners = handlePositions(gx, gy, gw, gh);
          for (let i = 0; i < corners.length; i++) {
            if (Math.hypot(sx - corners[i][0], sy - corners[i][1]) <= HANDLE) {
              dragRef.current = { kind: "groupResize", handle: i, bounds: gb, orig: origMap };
              undoRef.current.push(cloneScene(scene));
              return;
            }
          }
        }
      }
      const hit = hitTopElement(scene, world.x, world.y, 8 / vp.zoom);
      if (hit && hit.locked) {
        // clicking a locked element selects it (so you can Unlock in the panel)
        // but never starts a move/resize.
        setSelectedIds(new Set([hit.id]));
        return;
      }
      if (hit) {
        if (e.shiftKey) {
          // shift-click toggles membership; never starts a drag
          const ids = new Set(selectedIds);
          if (ids.has(hit.id)) ids.delete(hit.id); else ids.add(hit.id);
          setSelectedIds(withGroupMembers(scene.elements, ids));
          return;
        }
        // click a member → move the whole group; click a non-member → select it
        // (+ its group-mates, so a grouped element selects the whole group).
        const ids = selectedIds.has(hit.id) ? selectedIds : withGroupMembers(scene.elements, new Set([hit.id]));
        if (!selectedIds.has(hit.id)) setSelectedIds(ids);
        // Dragging a frame drags its contents too (children captured now).
        const moveIdSet = new Set(ids);
        for (const id of ids) {
          const el = scene.elements.find((e) => e.id === id);
          if (el && el.type === "frame") for (const c of frameChildren(scene.elements, el)) moveIdSet.add(c);
        }
        const moveIds = Array.from(moveIdSet);
        if (e.altKey) {
          // Alt/Option-drag = duplicate: drop fresh copies and drag THOSE, leaving
          // the originals in place. Remap ids so copied groups + connectors stay
          // internally wired (and don't point back at the originals).
          const idMap = new Map<string, string>();
          for (const id of moveIds) idMap.set(id, genId());
          const groupMap = new Map<string, string>();
          const remapGroup = (g: string | undefined) => { if (!g) return undefined; if (!groupMap.has(g)) groupMap.set(g, genId()); return groupMap.get(g); };
          const copies = moveIds.map((id) => {
            const base = cloneEl(scene.elements.find((e) => e.id === id)!);
            if ("points" in base) {
              return { ...base, id: idMap.get(id)!, groupId: remapGroup(base.groupId),
                fromId: base.fromId && idMap.has(base.fromId) ? idMap.get(base.fromId) : undefined,
                toId: base.toId && idMap.has(base.toId) ? idMap.get(base.toId) : undefined };
            }
            return { ...base, id: idMap.get(id)!, groupId: remapGroup(base.groupId) };
          });
          const newIds = copies.map((c) => c.id);
          undoRef.current.push(cloneScene(scene));
          setScene((s) => ({ ...s, elements: [...s.elements, ...copies] }));
          setSelectedIds(new Set(newIds));
          dragRef.current = { kind: "move", ids: newIds, startX: world.x, startY: world.y, origs: new Map(copies.map((c) => [c.id, cloneEl(c)])) };
          return;
        }
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
      const el: ShapeElement = { id, type: tool as ShapeElement["type"], x: world.x, y: world.y, w: 1, h: 1, stroke, fill: fillColor, strokeWidth: strokeW, opacity: 1, ...(dash !== "solid" ? { dash } : {}) };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      selectOne(id);
      dragRef.current = { kind: "draw", id, startX: world.x, startY: world.y };
    } else if (tool === "line" || tool === "arrow") {
      if (!multiRef.current) {
        // Click (or press) to START the arrow. If it starts on/near a shape,
        // bind to it AND snap the start onto that shape's edge (magnetic start).
        const startHit = hitTopElement(scene, world.x, world.y, BIND_TOL / vp.zoom);
        const bindStart = startHit && isBindable(startHit) ? startHit : null;
        const fromId = bindStart?.id;
        const startPt: [number, number] = bindStart ? elementEdgePoint(bindStart, world) : [world.x, world.y];
        const el: PathElement = { id, type: tool, x: startPt[0], y: startPt[1], w: 1, h: 1, stroke, fill: "transparent", strokeWidth: strokeW, opacity: 1, points: [startPt, [world.x, world.y]], fromId, arrowType, ...(dash !== "solid" ? { dash } : {}) };
        undoRef.current.push(snapshot);
        setScene((s) => ({ ...s, elements: [...s.elements, el] }));
        selectOne(id);
        multiRef.current = { id, downX: sx, downY: sy };
        dragRef.current = { kind: "path", id };
      } else {
        // ONLY straight arrows are multi-point (click adds a joint). Elbow and
        // curved arrows just connect start→end and auto-route, so their second
        // click always FINISHES (2-point). For straight arrows: an empty click
        // adds a joint; a click on a shape / on the last point finishes; so do
        // double-click / Enter / Escape. A press-drag finishes on release.
        const mid = multiRef.current.id;
        const el = scene.elements.find((x) => x.id === mid);
        if (!el || !("points" in el)) { multiRef.current = null; dragRef.current = null; }
        else {
          const isStraight = (el as PathElement).arrowType !== "elbow" && (el as PathElement).arrowType !== "curved";
          const pts = el.points;
          const lastFixed = pts[pts.length - 2]; // the floating end is pts[last]
          const lsx = lastFixed[0] * vp.zoom + vp.x, lsy = lastFixed[1] * vp.zoom + vp.y;
          const onLast = Math.hypot(sx - lsx, sy - lsy) <= HANDLE * 1.6;
          // Find the shape UNDER the cursor, looking past the arrow being drawn
          // (it's on top, so hitTopElement would return the arrow itself).
          let endHit: CanvasElement | null = null;
          for (let i = scene.elements.length - 1; i >= 0; i--) {
            const c = scene.elements[i];
            if (c.id === mid || !isBindable(c)) continue;
            if (hitTest(c, world.x, world.y, BIND_TOL / vp.zoom)) { endHit = c; break; }
          }
          const onShape = !!endHit && endHit.id !== (el as PathElement).fromId;
          patchElement(mid, (x) => { if ("points" in x) { x.points[x.points.length - 1] = [world.x, world.y]; syncPathBounds(x as PathElement); } });
          if (!isStraight || onShape || onLast) {
            // elbow/curved always finish; straight finishes on a shape or the last point
            if (onLast) patchElement(mid, (x) => { if ("points" in x && x.points.length > 2) { x.points.pop(); syncPathBounds(x as PathElement); } });
            finishMultiArrow();
          } else {
            patchElement(mid, (x) => { if ("points" in x) { x.points.push([world.x, world.y]); syncPathBounds(x as PathElement); } });
            multiRef.current = { id: mid, downX: sx, downY: sy };
          }
          dragRef.current = null;
        }
      }
    } else if (tool === "freedraw") {
      const el: PathElement = { id, type: "freedraw", x: world.x, y: world.y, w: 1, h: 1, stroke, fill: "transparent", strokeWidth: strokeW, opacity: 1, points: [[world.x, world.y]], ...(dash !== "solid" ? { dash } : {}) };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      dragRef.current = { kind: "path", id };
    } else if (tool === "text") {
      const el: CanvasElement = { id, type: "text", x: world.x, y: world.y - fontSize / 2, w: 160, h: fontSize * 1.4, stroke, fill: "transparent", strokeWidth: 1, opacity: 1, text: "", fontSize, ...(align !== "left" ? { align } : {}) };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      selectOne(id);
      setEditing({ id });
      setTool("select");
    } else if (tool === "sticky") {
      const el: CanvasElement = { id, type: "sticky", x: world.x, y: world.y, w: 180, h: 180, stroke: "transparent", fill: STICKY_COLORS[0], strokeWidth: 0, opacity: 1, text: "", fontSize: 16, ...(align !== "left" ? { align } : {}) };
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
    } else if (tool === "table") {
      const fields: TableField[] = [{ name: "id", type: "uuid", key: "pk" }, { name: "name", type: "text" }, { name: "created_at", type: "timestamp" }];
      const el: TableElement = { id, type: "table", x: world.x, y: world.y, w: 200, h: tableHeight(fields.length), stroke: "#334155", fill: "#FFFFFF", strokeWidth: 1.5, opacity: 1, name: "Table", fields };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      selectOne(id);
      setEditing({ id }); // open the field editor immediately
      setTool("select");
    }
  }, [editing, tool, scene, selectedIds, vp, stroke, fillColor, strokeW, arrowType, dash, fontSize, align, toWorld, selectOne, patchElement, finishMultiArrow]);

  // Laser pointer: a fading red presenter trail on an overlay canvas (not saved).
  useEffect(() => {
    const clear = () => { const c = laserCanvasRef.current; const ctx = c?.getContext("2d"); if (c && ctx) ctx.clearRect(0, 0, c.width, c.height); };
    if (tool !== "laser") { laserRef.current = []; clear(); return; }
    let raf = 0;
    const loop = () => {
      const c = laserCanvasRef.current, wrap = wrapRef.current;
      if (c && wrap) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = wrap.clientWidth, h = wrap.clientHeight;
        if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = `${w}px`; c.style.height = `${h}px`; }
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          const now = performance.now();
          const pts = laserRef.current.filter((p) => now - p.t < 650);
          laserRef.current = pts;
          ctx.lineCap = "round"; ctx.lineJoin = "round";
          for (let i = 1; i < pts.length; i++) {
            const age = (now - pts[i].t) / 650;
            ctx.strokeStyle = `rgba(239,68,68,${1 - age})`;
            ctx.lineWidth = 5 * (1 - age) + 1;
            ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
          }
          if (pts.length) { const head = pts[pts.length - 1]; ctx.fillStyle = "rgba(239,68,68,0.95)"; ctx.beginPath(); ctx.arc(head.x, head.y, 4.5, 0, Math.PI * 2); ctx.fill(); }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tool]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const mrect = canvas.getBoundingClientRect();
    const msx = e.clientX - mrect.left, msy = e.clientY - mrect.top;
    lastPtrRef.current = { sx: msx, sy: msy };
    if (tool === "laser") { laserRef.current.push({ x: msx, y: msy, t: performance.now() }); return; }
    // Multi-point arrow: the floating end tracks the cursor (even between clicks).
    if (multiRef.current) {
      const w = toWorld(msx, msy);
      patchElement(multiRef.current.id, (el) => { if ("points" in el) { el.points[el.points.length - 1] = [w.x, w.y]; syncPathBounds(el as PathElement); } });
      let hover: string | null = null;
      for (let i = scene.elements.length - 1; i >= 0; i--) { const c = scene.elements[i]; if (c.id === multiRef.current!.id || !isBindable(c)) continue; if (hitTest(c, w.x, w.y, BIND_TOL / vp.zoom)) { hover = c.id; break; } }
      setHoverBindId(hover);
      updateHoverDot(hover, w.x, w.y);
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      // Arrow/line tool idle-hover: show the connection dot on a shape under the
      // cursor, so you can see where the arrow will attach (Excalidraw).
      if (tool === "arrow" || tool === "line") {
        const w = toWorld(msx, msy);
        const shape = hitTopElement(scene, w.x, w.y, BIND_TOL / vp.zoom);
        updateHoverDot(shape && isBindable(shape) ? shape.id : null, w.x, w.y);
      } else if (hoverDot) {
        setHoverDot(null);
      }
      return;
    }
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
          if (hitTest(cand, world.x, world.y, BIND_TOL / vp.zoom)) { hover = cand.id; break; }
        }
        setHoverBindId(hover);
        updateHoverDot(hover, world.x, world.y);
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
    } else if (drag.kind === "rotate") {
      const shift = e.shiftKey;
      patchElement(drag.id, (el) => {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        // Handle sits above centre; +PI/2 makes "cursor straight up" = 0 rad.
        let a = Math.atan2(world.y - cy, world.x - cx) + Math.PI / 2;
        if (shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); // snap to 15°
        el.angle = a;
      });
    } else if (drag.kind === "groupResize") {
      const { bounds, handle, orig } = drag;
      const fx = handle === 0 || handle === 3 ? bounds.x + bounds.w : bounds.x; // opposite (fixed) corner x
      const fy = handle === 0 || handle === 1 ? bounds.y + bounds.h : bounds.y; // opposite (fixed) corner y
      const sxS = Math.max(4, Math.abs(world.x - fx)) / bounds.w;
      const syS = Math.max(4, Math.abs(world.y - fy)) / bounds.h;
      setScene((s) => ({ ...s, elements: reflowElements(s.elements.map((el) => {
        const o = orig.get(el.id);
        if (!o) return el;
        const sp = (px: number, py: number): [number, number] => [fx + (px - fx) * sxS, fy + (py - fy) * syS];
        if ("points" in o) {
          const points = (o as PathElement).points.map((p) => sp(p[0], p[1]));
          const c: PathElement = { ...(el as PathElement), points }; syncPathBounds(c); return c;
        }
        const [nx, ny] = sp(o.x, o.y);
        const fs = (o as { fontSize?: number }).fontSize;
        return { ...el, x: nx, y: ny, w: o.w * sxS, h: o.h * syS, ...(fs ? { fontSize: Math.max(6, fs * syS) } : {}) } as CanvasElement;
      })) }));
    } else if (drag.kind === "groupRotate") {
      const { cx, cy, start, orig } = drag;
      let delta = Math.atan2(world.y - cy, world.x - cx) - start;
      if (e.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      const cos = Math.cos(delta), sin = Math.sin(delta);
      const rot = (px: number, py: number): [number, number] => [cx + (px - cx) * cos - (py - cy) * sin, cy + (px - cx) * sin + (py - cy) * cos];
      setScene((s) => ({ ...s, elements: reflowElements(s.elements.map((el) => {
        const o = orig.get(el.id);
        if (!o) return el;
        if ("points" in o) {
          // lines/arrows rotate by rotating their points (no angle → no double-rotate)
          const points = (o as PathElement).points.map((p) => rot(p[0], p[1]));
          const c: PathElement = { ...(el as PathElement), points }; syncPathBounds(c); return c;
        }
        const [ncx, ncy] = rot(o.x + o.w / 2, o.y + o.h / 2);
        return { ...el, x: ncx - o.w / 2, y: ncy - o.h / 2, angle: (o.angle ?? 0) + delta };
      })) }));
    } else if (drag.kind === "endpoint") {
      patchElement(drag.id, (el) => {
        if (!("points" in el)) return;
        const idx = drag.vi >= el.points.length ? el.points.length - 1 : drag.vi;
        el.points[idx] = [world.x, world.y];
        syncPathBounds(el as PathElement);
      });
      // Only the two ENDS bind to shapes; a middle bend never highlights a target.
      const el = scene.elements.find((x) => x.id === drag.id);
      const isEnd = el && "points" in el && (drag.vi === 0 || drag.vi === el.points.length - 1);
      let hover: string | null = null;
      if (isEnd) for (let i = scene.elements.length - 1; i >= 0; i--) { const c = scene.elements[i]; if (c.id === drag.id || !isBindable(c)) continue; if (hitTest(c, world.x, world.y, BIND_TOL / vp.zoom)) { hover = c.id; break; } }
      setHoverBindId(hover);
    } else if (drag.kind === "marquee") {
      const box = normalizeBox({ x: drag.startX, y: drag.startY, w: world.x - drag.startX, h: world.y - drag.startY });
      setMarquee(box);
      const base = new Set(drag.base);
      for (const el of scene.elements) if (elementInBox(el, box)) base.add(el.id);
      setSelectedIds(withGroupMembers(scene.elements, base)); // grab whole groups
    }
  }, [patchElement, toWorld, scene, vp, tool, hoverDot, updateHoverDot]);

  const onPointerUp = useCallback(() => {
    // In multi-point arrow mode: a press-DRAG ends the arrow (quick 2-point or
    // the final segment); a plain CLICK drops a bend and keeps going (an
    // edge-click / double-click / Enter / Escape ends it).
    if (multiRef.current) {
      dragRef.current = null;
      const moved = dist([lastPtrRef.current.sx, lastPtrRef.current.sy], [multiRef.current.downX, multiRef.current.downY]);
      if (moved > 5) finishMultiArrow();
      setHoverBindId(null);
      setHoverDot(null);
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
              if (hitTest(cand, end[0], end[1], BIND_TOL / s.viewport.zoom)) { toId = cand.id; break; }
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
    } else if (drag.kind === "move" || drag.kind === "resize" || drag.kind === "rotate" || drag.kind === "groupResize" || drag.kind === "groupRotate") {
      setScene((s) => { onChange(s); return s; });
    } else if (drag.kind === "endpoint") {
      // Re-bind (or free) a dragged END based on where it landed; a middle bend
      // just moves (never binds).
      setScene((s) => {
        const el = s.elements.find((x) => x.id === drag.id);
        if (!el || !("points" in el)) return s;
        const isStart = drag.vi === 0;
        const isEnd = drag.vi === el.points.length - 1;
        const p = el.points[Math.min(drag.vi, el.points.length - 1)];
        let bindId: string | undefined;
        if (isStart || isEnd) for (let k = s.elements.length - 1; k >= 0; k--) {
          const c = s.elements[k];
          if (c.id === drag.id || !isBindable(c)) continue;
          if (hitTest(c, p[0], p[1], BIND_TOL / s.viewport.zoom)) { bindId = c.id; break; }
        }
        let elements = s.elements.map((x) => {
          if (x.id !== drag.id) return x;
          const xp = x as PathElement;
          const c: PathElement = { ...xp, points: xp.points.map((pp) => [pp[0], pp[1]] as [number, number]) };
          // Re-dragging an end re-binds it → clear its focus so reflow re-captures
          // the new attachment side/corner (and drop the focus if it went free).
          if (isStart) { c.fromId = bindId; c.fromFocus = undefined; }
          else if (isEnd) { c.toId = bindId; c.toFocus = undefined; }
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
    setHoverDot(null);
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

  const applyHead = useCallback((which: "start" | "end", type: HeadType) => {
    if (selectedIds.size === 0) return;
    const key = which === "start" ? "startHead" : "endHead";
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.map((el) => (selectedIds.has(el.id) && (el.type === "line" || el.type === "arrow") ? { ...el, [key]: type } : el)) };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const applyDash = useCallback((d: DashStyle) => {
    setDash(d);
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) =>
        selectedIds.has(el.id) && el.type !== "text" && el.type !== "sticky" && el.type !== "image" && el.type !== "taskCard" && el.type !== "canvasCard" && el.type !== "frame"
          ? { ...el, dash: d } : el,
      ),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const applyFontSize = useCallback((size: number) => {
    setFontSize(size);
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) => {
        if (!selectedIds.has(el.id) || (el.type !== "text" && el.type !== "sticky" && !SHAPE_LABEL_TYPES.has(el.type))) return el;
        // keep a text element's box height in step with its new line height
        return el.type === "text" ? { ...el, fontSize: size, h: size * 1.4 } : { ...el, fontSize: size };
      }),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const applyAlign = useCallback((a: TextAlign) => {
    setAlign(a);
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) =>
        selectedIds.has(el.id) && (el.type === "text" || el.type === "sticky" || SHAPE_LABEL_TYPES.has(el.type)) ? { ...el, align: a } : el,
      ),
    };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  // Opacity is a live-drag slider: update the scene as it moves (no history),
  // then commit ONCE on release against the snapshot taken when the drag began.
  const opacitySnapRef = useRef<CanvasScene | null>(null);
  const setOpacityLive = useCallback((o: number) => {
    setScene((s) => ({ ...s, elements: s.elements.map((el) => (selectedIds.has(el.id) ? { ...el, opacity: o } : el)) }));
  }, [selectedIds]);
  const commitOpacity = useCallback(() => {
    const snap = opacitySnapRef.current;
    opacitySnapRef.current = null;
    if (!snap) return;
    setScene((s) => {
      undoRef.current.push(snap);
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = [];
      onChange(s);
      return s;
    });
    bump();
  }, [onChange, bump]);

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

  // Move a single element by (dx,dy), carrying its points if it's a path.
  const shifted = (el: CanvasElement, dx: number, dy: number): CanvasElement =>
    "points" in el
      ? { ...el, x: el.x + dx, y: el.y + dy, points: el.points.map((p) => [p[0] + dx, p[1] + dy] as [number, number]) }
      : { ...el, x: el.x + dx, y: el.y + dy };

  const alignSelected = useCallback((mode: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => {
    if (selectedIds.size < 2) return;
    const sel = scene.elements.filter((el) => selectedIds.has(el.id));
    const b = boundsOfElements(sel);
    if (!b) return;
    const snapshot = cloneScene(scene);
    const move = (el: CanvasElement): CanvasElement => {
      let dx = 0, dy = 0;
      if (mode === "left") dx = b.x - el.x;
      else if (mode === "centerX") dx = (b.x + b.w / 2) - (el.x + el.w / 2);
      else if (mode === "right") dx = (b.x + b.w) - (el.x + el.w);
      else if (mode === "top") dy = b.y - el.y;
      else if (mode === "centerY") dy = (b.y + b.h / 2) - (el.y + el.h / 2);
      else dy = (b.y + b.h) - (el.y + el.h);
      return shifted(el, dx, dy);
    };
    const next = { ...scene, elements: reflowElements(scene.elements.map((el) => (selectedIds.has(el.id) ? move(el) : el))) };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const distributeSelected = useCallback((axis: "x" | "y") => {
    if (selectedIds.size < 3) return;
    const sel = scene.elements.filter((el) => selectedIds.has(el.id));
    const startOf = (el: CanvasElement) => (axis === "x" ? el.x : el.y);
    const sizeOf = (el: CanvasElement) => (axis === "x" ? el.w : el.h);
    const sorted = [...sel].sort((a, b) => startOf(a) - startOf(b));
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = (startOf(last) + sizeOf(last)) - startOf(first);
    const used = sorted.reduce((s, e) => s + sizeOf(e), 0);
    const gap = (span - used) / (sorted.length - 1); // even gaps between edges
    const moves = new Map<string, number>();
    let cursor = startOf(first) + sizeOf(first) + gap;
    for (let i = 1; i < sorted.length - 1; i++) {
      moves.set(sorted[i].id, cursor - startOf(sorted[i]));
      cursor += sizeOf(sorted[i]) + gap;
    }
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: reflowElements(scene.elements.map((el) => {
      const d = moves.get(el.id);
      if (d === undefined) return el;
      return shifted(el, axis === "x" ? d : 0, axis === "y" ? d : 0);
    })) };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const flipSelected = useCallback((axis: "x" | "y") => {
    if (selectedIds.size === 0) return;
    const sel = scene.elements.filter((el) => selectedIds.has(el.id));
    const b = boundsOfElements(sel);
    if (!b) return;
    const c = axis === "x" ? b.x + b.w / 2 : b.y + b.h / 2; // mirror line (selection centre)
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: reflowElements(scene.elements.map((el) => {
      if (!selectedIds.has(el.id)) return el;
      if ("points" in el) {
        // truly mirror a line/arrow by mirroring its points about the centre
        const points = el.points.map((p) => (axis === "x" ? [2 * c - p[0], p[1]] : [p[0], 2 * c - p[1]]) as [number, number]);
        const moved: PathElement = { ...el, points };
        syncPathBounds(moved);
        return moved;
      }
      // box: mirror its position about the centre + toggle the flip flag so its
      // content mirrors too (asymmetric shapes actually flip).
      return axis === "x"
        ? { ...el, x: 2 * c - (el.x + el.w), flipX: !el.flipX }
        : { ...el, y: 2 * c - (el.y + el.h), flipY: !el.flipY };
    })) };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const groupSelected = useCallback(() => {
    if (selectedIds.size < 2) return;
    const gid = genId();
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.map((el) => (selectedIds.has(el.id) ? { ...el, groupId: gid } : el)) };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const ungroupSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    let changed = false;
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.map((el) => {
      if (selectedIds.has(el.id) && el.groupId) { changed = true; return { ...el, groupId: undefined }; }
      return el;
    }) };
    if (changed) commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const toggleLock = useCallback((locked: boolean) => {
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.map((el) => (selectedIds.has(el.id) ? { ...el, locked } : el)) };
    commit(next, snapshot);
    if (locked) setSelectedIds(new Set()); // locked → drop the selection (Excalidraw)
  }, [selectedIds, scene, commit]);

  const setLink = useCallback(() => {
    if (selectedIds.size === 0) return;
    const cur = scene.elements.find((el) => selectedIds.has(el.id))?.link ?? "";
    const url = window.prompt("Link URL (leave empty to remove):", cur);
    if (url === null) return; // cancelled
    const link = url.trim() || undefined;
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.map((el) => (selectedIds.has(el.id) ? { ...el, link } : el)) };
    commit(next, snapshot);
  }, [selectedIds, scene, commit]);

  const exportPng = useCallback(() => {
    const b = sceneBounds(scene);
    if (!b) return;
    const pad = 24, scale = 2;
    const off = document.createElement("canvas");
    off.width = Math.ceil((b.w + pad * 2) * scale);
    off.height = Math.ceil((b.h + pad * 2) * scale);
    const ctx = off.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, b.w + pad * 2, b.h + pad * 2);
    ctx.translate(pad - b.x, pad - b.y);
    for (const el of scene.elements) {
      if (el.type === "canvasCard") drawCanvasCard(ctx, el, getLinkedScene(el.whiteboardId), getImage);
      else drawElement(ctx, el, getImage);
    }
    off.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "canvas.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }, [scene, getImage, getLinkedScene]);

  const applyEdges = useCallback((edges: "sharp" | "round") => {
    if (selectedIds.size === 0) return;
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.map((el) => (selectedIds.has(el.id) && el.type === "rect" ? { ...el, edges } : el)) };
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
    const id = genId();
    // A Canvas drops as a live thumbnail card (canvas-in-canvas); everything
    // else drops as a task/doc card.
    const el: CanvasElement = task.kind === "canvas"
      ? {
          id, type: "canvasCard", x: c.x - 130, y: c.y - 90, w: 260, h: 180,
          stroke: "#E2E8F0", fill: "#FFFFFF", strokeWidth: 1, opacity: 1,
          whiteboardId: task.id, title: task.title,
        }
      : {
          id, type: "taskCard", x: c.x - 120, y: c.y - 46, w: 240, h: 92,
          stroke: "#E2E8F0", fill: "#FFFFFF", strokeWidth: 1, opacity: 1,
          itemId: task.id, title: task.title, status: task.status,
          statusLabel: task.statusLabel, statusColor: task.statusColor, meta: task.meta, href: task.href,
        };
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: [...scene.elements, el] };
    setSelectedIds(new Set([id]));
    setTaskPickerOpen(false);
    commit(next, snapshot);
  }, [scene, commit, centreWorld]);

  const openTaskPicker = useCallback(() => {
    setTaskPickerOpen(true);
    if (tasks === null && loadEntities) {
      void loadEntities().then((t) => setTasks(t)).catch(() => setTasks([]));
    }
  }, [tasks, loadEntities]);

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
      if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
      if (mod && e.key.toLowerCase() === "c") { copySelected(); return; }
      // ⌘V is handled by the native paste listener below (so an OS-clipboard
      // image or our internal element copy both route through one place).
      if (e.key === "Delete" || e.key === "Backspace") { if (selectedIds.size > 0) { e.preventDefault(); deleteSelected(); } return; }
      if (e.key === "Escape") { setSelectedIds(new Set()); return; }
      // Enter edits the selected shape/text/sticky's label (Excalidraw).
      if (e.key === "Enter" && selectedIds.size === 1) {
        const one = scene.elements.find((el) => selectedIds.has(el.id));
        if (one && (one.type === "text" || one.type === "sticky" || one.type === "frame" || one.type === "line" || one.type === "arrow" || one.type === "table" || SHAPE_LABEL_TYPES.has(one.type))) {
          e.preventDefault(); setEditing({ id: one.id }); return;
        }
      }
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
  }, [undo, redo, deleteSelected, duplicateSelected, copySelected, nudge, selectedIds, scene.elements, finishMultiArrow, groupSelected, ungroupSelected]);

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
      let grewShape = false;
      let elements = s.elements.map((x) => {
        if (x.id !== id) return x;
        if (x.type === "text" || x.type === "sticky") return { ...x, text: value };
        if (x.type === "line" || x.type === "arrow") return { ...x, text: value }; // connector label
        if (x.type === "table") { const { name, fields } = parseTableText(value); return { ...x, name, fields, h: tableHeight(fields.length) }; }
        if (x.type === "frame") return { ...x, title: value.trim() || "Frame" };
        if (SHAPE_LABEL_TYPES.has(x.type)) {
          // Grow the shape (keeping its centre) so the label always fits inside.
          const sh = x as ShapeElement;
          const needed = labelHeightFor(value, sh.w, sh.fontSize ?? 16);
          if (needed > sh.h) {
            grewShape = true;
            const cy = sh.y + sh.h / 2;
            return { ...sh, text: value, h: needed, y: cy - needed / 2 };
          }
          return { ...sh, text: value }; // shape label (kept even if empty)
        }
        return x;
      });
      if (grewShape) elements = reflowElements(elements); // bound connectors follow the resized shape
      const next = { ...s, elements };
      onChange(next);
      return next;
    });
  }, [editing, onChange]);

  const editingEl = editing ? scene.elements.find((e) => e.id === editing.id) : null;
  const cursor = spaceDown || tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";

  // Contextual style PANEL: a fixed, vertical, labeled panel pinned to the
  // top-left (Excalidraw-style) that opens when something is selected or a
  // drawing tool is active. Sections show based on what's selected / the tool.
  const styleToolActive = tool !== "select" && tool !== "hand";
  const showStyleBar = (selectedIds.size > 0 || styleToolActive) && !marquee && !editing;
  const selEls = scene.elements.filter((e) => selectedIds.has(e.id));
  const someSel = (pred: (el: CanvasElement) => boolean) => selEls.some(pred);
  const isShapeTool = SHAPE_TOOLS.has(tool);
  // Which sections are relevant right now.
  const secStroke = isShapeTool || tool === "line" || tool === "arrow" || tool === "freedraw"
    || someSel((el) => el.type !== "image" && el.type !== "taskCard" && el.type !== "canvasCard");
  const secFill = isShapeTool || tool === "sticky" || someSel((el) => el.type === "sticky" || (el.type !== "line" && el.type !== "arrow" && el.type !== "freedraw" && el.type !== "text" && el.type !== "image" && el.type !== "taskCard" && el.type !== "canvasCard" && el.type !== "frame"));
  const secWidth = isShapeTool || tool === "line" || tool === "arrow" || tool === "freedraw"
    || someSel((el) => el.type !== "text" && el.type !== "sticky" && el.type !== "image" && el.type !== "taskCard" && el.type !== "canvasCard");
  const secDash = secWidth && !someSel((el) => el.type === "frame"); // frames stay solid
  const secArrow = tool === "line" || tool === "arrow" || someSel((el) => el.type === "line" || el.type === "arrow");
  const secText = tool === "text" || tool === "sticky" || someSel((el) => el.type === "text" || el.type === "sticky" || SHAPE_LABEL_TYPES.has(el.type));
  const hasSelection = selectedIds.size > 0;
  const selOpacity = selEls.length > 0 ? selEls[0].opacity : 1;
  const canGroup = selectedIds.size >= 2;
  const canUngroup = selEls.some((el) => !!el.groupId);
  const isLocked = selEls.some((el) => el.locked);
  const hasRect = isShapeTool ? tool === "rect" : someSel((el) => el.type === "rect");
  const soleSel = selEls.length === 1 ? selEls[0] : null; // for the open-link affordance
  const selArrow = selEls.find((el) => el.type === "line" || el.type === "arrow") as PathElement | undefined;
  const endHeadVal: HeadType = selArrow?.endHead ?? (selArrow?.type === "arrow" ? "arrow" : "none");
  const startHeadVal: HeadType = selArrow?.startHead ?? "none";

  // Drop an AI-generated diagram onto the board: replace an empty board, else
  // place it to the right of what's there, select it, and fit the view.
  useImperativeHandle(ref, () => ({
    insertScene: (generated: CanvasScene) => {
      const snapshot = cloneScene(scene);
      let incoming = generated.elements;
      if (scene.elements.length > 0) {
        const b = boundsOfElements(scene.elements);
        const gb = boundsOfElements(incoming);
        if (b && gb) {
          const dx = (b.x + b.w + 140) - gb.x;
          const dy = b.y - gb.y;
          incoming = incoming.map((el) => shifted(el, dx, dy));
        }
      }
      const next = { ...scene, elements: [...scene.elements, ...incoming] };
      commit(next, snapshot);
      setSelectedIds(new Set(incoming.map((el) => el.id)));
      requestAnimationFrame(() => fitView());
    },
  }), [scene, commit, fitView]);

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
          if (hit && (hit.type === "text" || hit.type === "sticky" || hit.type === "frame" || hit.type === "line" || hit.type === "arrow" || hit.type === "table" || SHAPE_LABEL_TYPES.has(hit.type))) { selectOne(hit.id); setEditing({ id: hit.id }); }
          else if (hit && hit.type === "taskCard" && onOpenEntity) onOpenEntity(hit.href ?? `/item/${hit.itemId}`);
          else if (hit && hit.type === "canvasCard" && onOpenEntity) onOpenEntity(`/canvas/${hit.whiteboardId}`);
          else if (!hit) {
            // double-click blank canvas → new text element, ready to type (Excalidraw)
            const nid = genId();
            const snap = cloneScene(scene);
            const tel: CanvasElement = { id: nid, type: "text", x: world.x, y: world.y - fontSize / 2, w: 160, h: fontSize * 1.4, stroke, fill: "transparent", strokeWidth: 1, opacity: 1, text: "", fontSize, ...(align !== "left" ? { align } : {}) };
            commit({ ...scene, elements: [...scene.elements, tel] }, snap);
            selectOne(nid);
            setEditing({ id: nid });
          }
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
      {/* laser-pointer overlay (presenter trail) — never intercepts pointers */}
      <canvas ref={laserCanvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }} />
      {/* open-link affordance for a single linked element */}
      {soleSel && soleSel.link && !editing ? (
        <a href={soleSel.link} target="_blank" rel="noreferrer"
          style={{
            position: "absolute", zIndex: 7,
            left: (soleSel.x + soleSel.w) * vp.zoom + vp.x - 8,
            top: soleSel.y * vp.zoom + vp.y - 14,
            display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
            background: "#0073EA", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600,
            textDecoration: "none", boxShadow: "0 3px 10px rgba(20,34,60,.2)", whiteSpace: "nowrap",
          }}>
          <ExternalLink style={{ width: 12, height: 12 }} /> Open
        </a>
      ) : null}
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
          ref={editRef}
          defaultValue={editingEl.text}
          onBlur={(e) => commitText(e.target.value)}
          onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          style={{
            position: "absolute",
            left: editingEl.x * vp.zoom + vp.x,
            top: editingEl.y * vp.zoom + vp.y,
            width: Math.max(60, editingEl.w * vp.zoom),
            height: Math.max(28, editingEl.h * vp.zoom),
            fontSize: editingEl.fontSize * vp.zoom,
            lineHeight: 1.3,
            textAlign: editingEl.align ?? "left",
            padding: editingEl.type === "sticky" ? 10 * vp.zoom : 0,
            border: "none", outline: "2px solid #0073EA", borderRadius: editingEl.type === "sticky" ? 6 : 3,
            background: editingEl.type === "sticky" ? editingEl.fill : "transparent",
            color: editingEl.type === "text" ? editingEl.stroke : "#1E293B",
            resize: "none", overflow: "hidden", fontFamily: "inherit",
          }}
        />
      ) : null}

      {/* shape label editing — a vertically-centred, auto-growing textarea that
          sits over the shape (cursor starts at the centre and grows both ways) */}
      {editingEl && SHAPE_LABEL_TYPES.has(editingEl.type) ? (
        <div style={{
          position: "absolute",
          left: editingEl.x * vp.zoom + vp.x,
          top: editingEl.y * vp.zoom + vp.y,
          width: editingEl.w * vp.zoom,
          height: editingEl.h * vp.zoom,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <textarea
            ref={editRef}
            defaultValue={(editingEl as ShapeElement).text ?? ""}
            onBlur={(e) => commitText(e.target.value)}
            onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
            rows={1}
            style={{
              width: Math.max(20, (editingEl.w - 12) * vp.zoom),
              maxHeight: (editingEl.h - 4) * vp.zoom,
              fontSize: ((editingEl as ShapeElement).fontSize ?? 16) * vp.zoom,
              lineHeight: 1.3,
              textAlign: (editingEl as ShapeElement).align ?? "center",
              padding: 0, margin: 0, border: "none", outline: "none",
              background: "transparent", color: "#1E293B",
              resize: "none", overflow: "hidden", fontFamily: "inherit",
              pointerEvents: "auto",
            }}
          />
        </div>
      ) : null}

      {/* connector label editing — a small centred textarea at the line midpoint */}
      {editingEl && (editingEl.type === "line" || editingEl.type === "arrow") ? (() => {
        const [mx, my] = pathMidpoint((editingEl as PathElement).points);
        const fs = ((editingEl as PathElement).fontSize ?? 14) * vp.zoom;
        return (
          <textarea
            ref={editRef}
            defaultValue={(editingEl as PathElement).text ?? ""}
            onBlur={(e) => commitText(e.target.value)}
            onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
            rows={1}
            style={{
              position: "absolute",
              left: mx * vp.zoom + vp.x - 70,
              top: my * vp.zoom + vp.y - fs,
              width: 140,
              fontSize: fs, lineHeight: 1.3, textAlign: "center",
              padding: "2px 4px", border: "none", outline: "2px solid #0073EA", borderRadius: 4,
              background: "#fff", color: "#1E293B",
              resize: "none", overflow: "hidden", fontFamily: "inherit",
            }}
          />
        );
      })() : null}

      {/* table editing — line 1 = name, then "field: type" (trailing * = PK, ^ = FK) */}
      {editingEl && editingEl.type === "table" ? (
        <textarea
          ref={editRef}
          defaultValue={tableToText(editingEl as TableElement)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          spellCheck={false}
          style={{
            position: "absolute",
            left: editingEl.x * vp.zoom + vp.x,
            top: editingEl.y * vp.zoom + vp.y,
            width: Math.max(160, editingEl.w * vp.zoom),
            height: Math.max(80, editingEl.h * vp.zoom),
            fontSize: 12.5 * vp.zoom, lineHeight: 1.5,
            padding: "6px 8px", border: "none", outline: "2px solid #0073EA", borderRadius: 8,
            background: "#fff", color: "#1E293B",
            resize: "none", overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
                placeholder="Search tasks, docs, canvases & SOPs to drop on the board…"
                style={{ flex: 1, border: "none", outline: "none", fontSize: 13.5, background: "transparent", color: "var(--os-ink, #1e293b)" }}
              />
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", padding: 6 }}>
              {tasks === null ? (
                <p style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>Loading tasks…</p>
              ) : (() => {
                const q = taskQuery.trim().toLowerCase();
                const list = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
                if (list.length === 0) return <p style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>{tasks.length === 0 ? "Nothing to drop yet." : "No matches."}</p>;
                return list.slice(0, 100).map((t) => (
                  <button key={`${t.kind ?? "task"}:${t.id}`} type="button" onClick={() => addTaskCard(t)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--os-surface-1, #f4f4f5)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: t.statusColor || "#94A3B8", flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--os-ink, #1e293b)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                    {t.kind === "doc" ? <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", color: "#3B82F6", background: "rgba(59,130,246,0.12)", borderRadius: 5, padding: "1px 5px", flex: "none" }}>DOC</span> : null}
                    {t.kind === "canvas" ? <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", color: "#7C3AED", background: "rgba(124,58,237,0.12)", borderRadius: 5, padding: "1px 5px", flex: "none" }}>CANVAS</span> : null}
                    {t.kind === "sop" ? <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", color: "#D97706", background: "rgba(245,158,11,0.14)", borderRadius: 5, padding: "1px 5px", flex: "none" }}>SOP</span> : null}
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

      {/* contextual style bar — fixed compact panel at the top-left
          (Excalidraw-style), opens on selection or an active drawing tool */}
      {showStyleBar ? (
        <div style={styleBarStyleTopLeft}>
          {secStroke ? (
            <PanelSection label="Stroke">
              {STROKE_COLORS.slice(0, 5).map((c) => (
                <button key={c} type="button" title="Stroke color" onClick={() => applyStroke(c)}
                  style={{ ...swatchStyle, background: c, outline: stroke === c ? "2px solid #6965db" : "none", outlineOffset: 1 }} />
              ))}
            </PanelSection>
          ) : null}
          {secFill ? (
            <PanelSection label="Background">
              {FILL_COLORS.slice(0, 5).map((c) => (
                <button key={c} type="button" title={c === "transparent" ? "No fill" : "Background color"} onClick={() => applyFill(c)}
                  style={{ ...swatchStyle, background: c === "transparent" ? "conic-gradient(#eee 0 25%, #fff 0 50%, #eee 0 75%, #fff 0) 0 / 10px 10px" : c, outline: fillColor === c ? "2px solid #6965db" : "none", outlineOffset: 1 }} />
              ))}
            </PanelSection>
          ) : null}
          {secWidth ? (
            <PanelSection label="Stroke width">
              {[1, 2, 4].map((wdt) => (
                <button key={wdt} type="button" title={`${wdt === 1 ? "Thin" : wdt === 2 ? "Bold" : "Extra bold"}`} onClick={() => applyWidth(wdt)} style={panelBtn(strokeW === wdt)}>
                  <span style={{ width: 15, height: wdt + 1, borderRadius: 4, background: strokeW === wdt ? "#111827" : "var(--os-ink-2, #52525b)" }} />
                </button>
              ))}
            </PanelSection>
          ) : null}
          {secDash ? (
            <PanelSection label="Stroke style">
              {(["solid", "dashed", "dotted"] as DashStyle[]).map((d) => (
                <button key={d} type="button" title={`${d[0].toUpperCase()}${d.slice(1)}`} onClick={() => applyDash(d)} style={panelBtn(dash === d)}>
                  <span style={{ width: 16, height: 0, borderTopWidth: 2, borderTopStyle: d, borderTopColor: dash === d ? "#111827" : "var(--os-ink-2, #52525b)" }} />
                </button>
              ))}
            </PanelSection>
          ) : null}
          {hasRect ? (
            <PanelSection label="Edges">
              <button type="button" title="Sharp corners" onClick={() => applyEdges("sharp")} style={panelBtn(someSel((el) => el.type === "rect" && el.edges !== "round"))}>
                <span style={{ width: 15, height: 12, border: "2px solid currentColor", borderRadius: 0 }} />
              </button>
              <button type="button" title="Round corners" onClick={() => applyEdges("round")} style={panelBtn(someSel((el) => el.type === "rect" && el.edges === "round"))}>
                <span style={{ width: 15, height: 12, border: "2px solid currentColor", borderRadius: 5 }} />
              </button>
            </PanelSection>
          ) : null}
          {secArrow ? (
            <PanelSection label="Arrow type">
              {ARROW_TYPES.map(({ type: at, Icon, label }) => (
                <button key={at} type="button" title={`${label}`} onClick={() => applyArrowType(at)} style={panelBtn(arrowType === at)}>
                  <Icon style={{ width: 16, height: 16 }} />
                </button>
              ))}
            </PanelSection>
          ) : null}
          {secArrow && selArrow ? (
            <>
              <PanelSection label="Arrowhead (end)">
                {HEAD_OPTS.map(({ type, glyph, label }) => (
                  <button key={type} type="button" title={`End: ${label}`} onClick={() => applyHead("end", type)}
                    style={{ ...panelBtn(endHeadVal === type), fontSize: 15, fontWeight: 700 }}>{glyph}</button>
                ))}
              </PanelSection>
              <PanelSection label="Arrowhead (start)">
                {HEAD_OPTS.map(({ type, glyph, label }) => (
                  <button key={type} type="button" title={`Start: ${label}`} onClick={() => applyHead("start", type)}
                    style={{ ...panelBtn(startHeadVal === type), fontSize: 15, fontWeight: 700, transform: type === "arrow" || type === "triangle" ? "scaleX(-1)" : undefined }}>{glyph}</button>
                ))}
              </PanelSection>
            </>
          ) : null}
          {secText ? (
            <PanelSection label="Font size">
              {FONT_SIZES.map(({ label, size }) => (
                <button key={label} type="button" title={`${label === "S" ? "Small" : label === "M" ? "Medium" : "Large"}`} onClick={() => applyFontSize(size)}
                  style={{ ...panelBtn(fontSize === size), fontWeight: 700, fontSize: label === "S" ? 11 : label === "M" ? 13 : 15 }}>
                  {label}
                </button>
              ))}
            </PanelSection>
          ) : null}
          {secText ? (
            <PanelSection label="Text align">
              {TEXT_ALIGNS.map(({ align: a, Icon, label }) => (
                <button key={a} type="button" title={`Align ${label}`} onClick={() => applyAlign(a)} style={panelBtn(align === a)}>
                  <Icon style={{ width: 16, height: 16 }} />
                </button>
              ))}
            </PanelSection>
          ) : null}
          {canGroup ? (
            <PanelSection label="Align">
              <button type="button" title="Align left" onClick={() => alignSelected("left")} style={panelBtn(false)}><AlignStartVertical style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Align centre (H)" onClick={() => alignSelected("centerX")} style={panelBtn(false)}><AlignCenterVertical style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Align right" onClick={() => alignSelected("right")} style={panelBtn(false)}><AlignEndVertical style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Align top" onClick={() => alignSelected("top")} style={panelBtn(false)}><AlignStartHorizontal style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Align middle (V)" onClick={() => alignSelected("centerY")} style={panelBtn(false)}><AlignCenterHorizontal style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Align bottom" onClick={() => alignSelected("bottom")} style={panelBtn(false)}><AlignEndHorizontal style={{ width: 15, height: 15 }} /></button>
              {selectedIds.size >= 3 ? <button type="button" title="Distribute horizontally" onClick={() => distributeSelected("x")} style={panelBtn(false)}><AlignHorizontalDistributeCenter style={{ width: 15, height: 15 }} /></button> : null}
              {selectedIds.size >= 3 ? <button type="button" title="Distribute vertically" onClick={() => distributeSelected("y")} style={panelBtn(false)}><AlignVerticalDistributeCenter style={{ width: 15, height: 15 }} /></button> : null}
            </PanelSection>
          ) : null}
          {hasSelection ? (
            <PanelSection label="Opacity">
              <input
                type="range" min={10} max={100} step={10} value={Math.round(selOpacity * 100)}
                onPointerDown={() => { opacitySnapRef.current = cloneScene(scene); }}
                onChange={(e) => setOpacityLive(Number(e.target.value) / 100)}
                onPointerUp={commitOpacity}
                onKeyUp={commitOpacity}
                style={{ width: "100%", accentColor: "#6965db", cursor: "pointer" }}
              />
            </PanelSection>
          ) : null}
          {hasSelection ? (
            <PanelSection label="Layers">
              <button type="button" title="Send to back" onClick={() => reorderZ(false)} style={panelBtn(false)}><ChevronsDown style={{ width: 16, height: 16 }} /></button>
              <button type="button" title="Bring to front" onClick={() => reorderZ(true)} style={panelBtn(false)}><ChevronsUp style={{ width: 16, height: 16 }} /></button>
            </PanelSection>
          ) : null}
          {hasSelection ? (
            <PanelSection label="Actions">
              <button type="button" title="Duplicate (⌘D)" onClick={() => duplicateSelected()} style={panelBtn(false)}><CopyIcon style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Flip horizontal" onClick={() => flipSelected("x")} style={panelBtn(false)}><FlipHorizontal2 style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Flip vertical" onClick={() => flipSelected("y")} style={panelBtn(false)}><FlipVertical2 style={{ width: 15, height: 15 }} /></button>
              {canGroup ? <button type="button" title="Group (⌘G)" onClick={() => groupSelected()} style={panelBtn(false)}><GroupIcon style={{ width: 15, height: 15 }} /></button> : null}
              {canUngroup ? <button type="button" title="Ungroup (⌘⇧G)" onClick={() => ungroupSelected()} style={panelBtn(false)}><UngroupIcon style={{ width: 15, height: 15 }} /></button> : null}
              {isLocked
                ? <button type="button" title="Unlock" onClick={() => toggleLock(false)} style={panelBtn(true)}><Unlock style={{ width: 15, height: 15 }} /></button>
                : <button type="button" title="Lock" onClick={() => toggleLock(true)} style={panelBtn(false)}><Lock style={{ width: 15, height: 15 }} /></button>}
              <button type="button" title={selEls.some((el) => el.link) ? "Edit link" : "Add link"} onClick={() => setLink()} style={panelBtn(selEls.some((el) => !!el.link))}><Link2 style={{ width: 15, height: 15 }} /></button>
              <button type="button" title="Delete (⌫)" onClick={() => deleteSelected()} style={panelBtn(false)}><Trash2 style={{ width: 15, height: 15 }} /></button>
            </PanelSection>
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
        {loadEntities ? (
          <button type="button" title="Insert a task, doc, canvas or SOP card" onClick={openTaskPicker} style={toolBtn(taskPickerOpen)}>
            <ListTodo style={{ width: 17, height: 17 }} />
          </button>
        ) : null}
        <span style={{ width: 1, height: 22, background: "var(--os-line, #e5e7eb)", margin: "0 2px" }} />
        <button type="button" title="Undo (⌘Z)" onClick={undo} disabled={hist.u === 0} style={toolBtn(false)}><Undo2 style={{ width: 16, height: 16 }} /></button>
        <button type="button" title="Redo (⌘⇧Z)" onClick={redo} disabled={hist.r === 0} style={toolBtn(false)}><Redo2 style={{ width: 16, height: 16 }} /></button>
        <button type="button" title="Delete (⌫)" onClick={deleteSelected} disabled={selectedIds.size === 0} style={toolBtn(false)}><Trash2 style={{ width: 16, height: 16 }} /></button>
        <span style={{ width: 1, height: 22, background: "var(--os-line, #e5e7eb)", margin: "0 2px" }} />
        <button type="button" title="Export as PNG" onClick={exportPng} style={toolBtn(false)}><Download style={{ width: 16, height: 16 }} /></button>
      </div>

      {/* zoom */}
      <div className="wbcanvas__zoom" style={zoomStyle}>
        <button type="button" title="Zoom out" onClick={() => zoomBy(1 / 1.2)} style={zoomBtn}><MinusIcon style={{ width: 15, height: 15 }} /></button>
        <button type="button" title="Fit / reset" onClick={fitView} style={{ ...zoomBtn, width: 52, fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>{Math.round(vp.zoom * 100)}%</button>
        <button type="button" title="Zoom in" onClick={() => zoomBy(1.2)} style={zoomBtn}><Plus style={{ width: 15, height: 15 }} /></button>
      </div>
    </div>
  );
});

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
      // Trace the SAME routed path the arrow actually renders (straight / elbow /
      // curved), in screen space — so the highlight hugs the curve, not a
      // straight chord. The transform is affine + uniform, so routing is
      // preserved when we pre-map the points to screen coordinates.
      const screenEl: PathElement = { ...el, points: pts.map((p) => [p[0] * vp.zoom + vp.x, p[1] * vp.zoom + vp.y] as [number, number]) };
      strokeConnectorPath(ctx, screenEl);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (el.type !== "freedraw" && pts.length >= 2 && !el.locked) {
      // Midpoint "grab to curve/bend" dots (Excalidraw's centre handles): a
      // small hollow circle at each segment midpoint. Clicking one inserts a
      // bend there (via hitSegment) and drags it.
      ctx.lineWidth = 1.2;
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2 * vp.zoom + vp.x;
        const my = (pts[i][1] + pts[i + 1][1]) / 2 * vp.zoom + vp.y;
        ctx.beginPath();
        ctx.arc(mx, my, HANDLE / 2 - 0.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill();
        ctx.strokeStyle = "#0073EA"; ctx.stroke();
      }
      // Editable vertices: a white square at each point (endpoints + every bend).
      ctx.strokeStyle = "#0073EA";
      ctx.fillStyle = "#fff";
      ctx.lineWidth = 1.5;
      for (const p of pts) {
        const sx = p[0] * vp.zoom + vp.x, sy = p[1] * vp.zoom + vp.y;
        ctx.fillRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
        ctx.strokeRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
      }
    }
    ctx.restore();
    return;
  }

  // Shapes / text / sticky / image / task cards: bounding box + corner handles,
  // rotated about the element centre when it has an angle.
  const angle = el.angle ?? 0;
  const cx = (el.x + el.w / 2) * vp.zoom + vp.x, cy = (el.y + el.h / 2) * vp.zoom + vp.y;
  const x = el.x * vp.zoom + vp.x, y = el.y * vp.zoom + vp.y, w = el.w * vp.zoom, h = el.h * vp.zoom;
  const corners = handlePositions(x, y, w, h).map(([hx, hy]) => rotatePt(hx, hy, cx, cy, angle));
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.stroke();
  if (withHandles) {
    ctx.fillStyle = "#fff";
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    }
    // rotation handle: a circle above the top edge, along the box's up vector.
    if (el.type !== "frame") {
      const [rx, ry] = rotateHandlePos(el, vp);
      const topMid = rotatePt(x + w / 2, y, cx, cy, angle);
      ctx.beginPath(); ctx.moveTo(topMid[0], topMid[1]); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.beginPath(); ctx.arc(rx, ry, HANDLE / 2 + 1, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

// Rotate screen point (px,py) about screen centre (cx,cy) by `angle` radians.
function rotatePt(px: number, py: number, cx: number, cy: number, angle: number): [number, number] {
  if (!angle) return [px, py];
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

// Screen position of an element's rotation handle (above its top-edge centre).
function rotateHandlePos(el: CanvasElement, vp: { x: number; y: number; zoom: number }): [number, number] {
  const angle = el.angle ?? 0;
  const cx = (el.x + el.w / 2) * vp.zoom + vp.x, cy = (el.y + el.h / 2) * vp.zoom + vp.y;
  const x = el.x * vp.zoom + vp.x, y = el.y * vp.zoom + vp.y, w = el.w * vp.zoom;
  const topMid = rotatePt(x + w / 2, y, cx, cy, angle);
  return [topMid[0] + Math.sin(angle) * ROT_OFFSET, topMid[1] - Math.cos(angle) * ROT_OFFSET];
}

// True when the cursor is over an element's rotation handle.
function hitRotateHandle(el: CanvasElement, sx: number, sy: number, vp: { x: number; y: number; zoom: number }): boolean {
  if (el.type === "line" || el.type === "arrow" || el.type === "freedraw" || el.type === "frame") return false;
  const [rx, ry] = rotateHandlePos(el, vp);
  return Math.hypot(sx - rx, sy - ry) <= HANDLE;
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
// Returns the index of the line/arrow vertex under the cursor (0 = start,
// last = end, middle = a bend), or -1. Every vertex is draggable.
function hitVertex(el: CanvasElement, sx: number, sy: number, vp: { x: number; y: number; zoom: number }): number {
  if (el.type !== "line" && el.type !== "arrow") return -1;
  const pts = el.points;
  if (pts.length < 2) return -1;
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i][0] * vp.zoom + vp.x, py = pts[i][1] * vp.zoom + vp.y;
    if (Math.abs(sx - px) <= HANDLE && Math.abs(sy - py) <= HANDLE) return i;
  }
  return -1;
}

// If the cursor is on a line/arrow's segment (away from its vertices), returns
// the index at which to INSERT a new bend point; else -1. Tests the raw point
// polyline (exact for straight arrows — the common "break a straight arrow" case).
function hitSegment(el: CanvasElement, sx: number, sy: number, vp: { x: number; y: number; zoom: number }): number {
  if (el.type !== "line" && el.type !== "arrow") return -1;
  const pts = el.points;
  const tol = 6 + el.strokeWidth * vp.zoom / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0] * vp.zoom + vp.x, ay = pts[i][1] * vp.zoom + vp.y;
    const bx = pts[i + 1][0] * vp.zoom + vp.x, by = pts[i + 1][1] * vp.zoom + vp.y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / len2));
    const px = ax + t * dx, py = ay + t * dy;
    // Only mid-segment (not hugging a vertex — those are drags via hitVertex).
    if (t > 0.12 && t < 0.88 && Math.hypot(sx - px, sy - py) <= tol) return i + 1;
  }
  return -1;
}

function hitHandle(el: CanvasElement, sx: number, sy: number, vp: { x: number; y: number; zoom: number }): number {
  if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") return -1;
  const angle = el.angle ?? 0;
  const cx = (el.x + el.w / 2) * vp.zoom + vp.x, cy = (el.y + el.h / 2) * vp.zoom + vp.y;
  const x = el.x * vp.zoom + vp.x, y = el.y * vp.zoom + vp.y, w = el.w * vp.zoom, h = el.h * vp.zoom;
  const hs = handlePositions(x, y, w, h).map(([hx, hy]) => rotatePt(hx, hy, cx, cy, angle));
  for (let i = 0; i < hs.length; i++) {
    if (Math.hypot(sx - hs[i][0], sy - hs[i][1]) <= HANDLE) return i;
  }
  return -1;
}

function applyResize(el: CanvasElement, orig: CanvasElement, handle: number, world: { x: number; y: number }) {
  const angle = orig.angle ?? 0;
  if (!angle) {
    let left = orig.x, top = orig.y, right = orig.x + orig.w, bottom = orig.y + orig.h;
    if (handle === 0) { left = world.x; top = world.y; }
    else if (handle === 1) { right = world.x; top = world.y; }
    else if (handle === 2) { right = world.x; bottom = world.y; }
    else if (handle === 3) { left = world.x; bottom = world.y; }
    const box = normalizeBox({ x: left, y: top, w: right - left, h: bottom - top });
    el.x = box.x; el.y = box.y; el.w = box.w; el.h = box.h;
    return;
  }
  // Rotated: resize in the element's LOCAL frame so the opposite corner stays
  // fixed in world space. Map the cursor into local coords (centred), edit the
  // grabbed corner, then map the new local centre back to world.
  const cx = orig.x + orig.w / 2, cy = orig.y + orig.h / 2;
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const dx = world.x - cx, dy = world.y - cy;
  const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
  const hw = orig.w / 2, hh = orig.h / 2;
  let left = -hw, top = -hh, right = hw, bottom = hh;
  if (handle === 0) { left = lx; top = ly; }
  else if (handle === 1) { right = lx; top = ly; }
  else if (handle === 2) { right = lx; bottom = ly; }
  else if (handle === 3) { left = lx; bottom = ly; }
  const nw = Math.max(1, Math.abs(right - left)), nh = Math.max(1, Math.abs(bottom - top));
  const lcx = (left + right) / 2, lcy = (top + bottom) / 2;
  const cosF = Math.cos(angle), sinF = Math.sin(angle);
  const ncx = cx + (lcx * cosF - lcy * sinF), ncy = cy + (lcx * sinF + lcy * cosF);
  el.x = ncx - nw / 2; el.y = ncy - nh / 2; el.w = nw; el.h = nh;
}

function cloneEl(el: CanvasElement): CanvasElement {
  return "points" in el ? { ...el, points: el.points.map((p) => [p[0], p[1]] as [number, number]) } : { ...el };
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// A table edits as plain text: line 1 = table name, then one field per line as
// "name: type", with a trailing "*" = primary key, "^" = foreign key.
function tableToText(el: TableElement): string {
  return [el.name, ...el.fields.map((f) => `${f.name}${f.type ? `: ${f.type}` : ""}${f.key === "pk" ? " *" : f.key === "fk" ? " ^" : ""}`)].join("\n");
}
function parseTableText(text: string): { name: string; fields: TableField[] } {
  const lines = text.split("\n");
  const name = (lines[0] ?? "").trim() || "Table";
  const fields: TableField[] = [];
  for (const raw of lines.slice(1)) {
    let line = raw.trim();
    if (!line) continue;
    let key: "pk" | "fk" | undefined;
    if (line.endsWith("*")) { key = "pk"; line = line.slice(0, -1).trim(); }
    else if (line.endsWith("^")) { key = "fk"; line = line.slice(0, -1).trim(); }
    const ci = line.indexOf(":");
    const fname = (ci >= 0 ? line.slice(0, ci) : line).trim();
    const ftype = ci >= 0 ? line.slice(ci + 1).trim() : "";
    if (fname) fields.push({ name: fname, ...(ftype ? { type: ftype } : {}), ...(key ? { key } : {}) });
  }
  return { name, fields };
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
// Contextual style panel: a fixed, VERTICAL, labeled panel pinned to the
// top-left (Excalidraw-style) — a stack of titled sections.
const styleBarStyleTopLeft: React.CSSProperties = {
  position: "absolute", top: 12, left: 12,
  display: "flex", flexDirection: "column", gap: 10, padding: "12px 12px 14px",
  background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)",
  borderRadius: 12, boxShadow: "0 8px 30px rgba(20,34,60,.14)", zIndex: 6,
  width: 208, maxHeight: "calc(100% - 24px)", overflowY: "auto",
};
const swatchStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(0,0,0,.12)", cursor: "pointer", padding: 0,
};
// A labeled panel section: a small uppercase title over a row of controls.
function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--os-ink-3, #9aa3b2)", letterSpacing: ".01em" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}
// A square panel control button (active = tinted).
function panelBtn(active: boolean): React.CSSProperties {
  return {
    width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, cursor: "pointer",
    border: "none", background: active ? "#ecebfb" : "var(--os-surface-1, #f4f4f5)",
    color: active ? "#4b45c6" : "var(--os-ink-2, #52525b)",
  };
}
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
