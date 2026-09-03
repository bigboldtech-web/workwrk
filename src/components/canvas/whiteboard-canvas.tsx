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
  Pencil, Type as TypeIcon, StickyNote, Trash2, Undo2, Redo2, Plus, Minus as MinusIcon,
} from "lucide-react";
import {
  cloneScene, genId, hitTopElement, normalizeBox, sceneBounds, syncPathBounds,
  STROKE_COLORS, STICKY_COLORS, DEFAULT_STROKE, DEFAULT_STROKE_WIDTH, DEFAULT_FONT_SIZE,
  type CanvasElement, type CanvasScene, type PathElement, type ShapeElement,
} from "@/lib/canvas/scene";

type Tool = "select" | "hand" | "rect" | "ellipse" | "diamond" | "line" | "arrow" | "freedraw" | "text" | "sticky";

const TOOLS: { tool: Tool; Icon: typeof Square; label: string; key?: string }[] = [
  { tool: "select", Icon: MousePointer2, label: "Select", key: "V" },
  { tool: "hand", Icon: Hand, label: "Pan", key: "H" },
  { tool: "rect", Icon: Square, label: "Rectangle", key: "R" },
  { tool: "ellipse", Icon: Circle, label: "Ellipse", key: "O" },
  { tool: "diamond", Icon: Diamond, label: "Diamond", key: "D" },
  { tool: "line", Icon: Minus, label: "Line", key: "L" },
  { tool: "arrow", Icon: ArrowRight, label: "Arrow", key: "A" },
  { tool: "freedraw", Icon: Pencil, label: "Pen", key: "P" },
  { tool: "text", Icon: TypeIcon, label: "Text", key: "T" },
  { tool: "sticky", Icon: StickyNote, label: "Sticky note", key: "S" },
];

const HANDLE = 8; // px, screen space
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;

type Drag =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "draw"; id: string; startX: number; startY: number }
  | { kind: "path"; id: string }
  | { kind: "move"; id: string; startX: number; startY: number; orig: CanvasElement }
  | { kind: "resize"; id: string; handle: number; orig: CanvasElement }
  | null;

export interface WhiteboardCanvasProps {
  initialScene: CanvasScene;
  onChange: (scene: CanvasScene) => void;
}

export function WhiteboardCanvas({ initialScene, onChange }: WhiteboardCanvasProps) {
  const [scene, setScene] = useState<CanvasScene>(initialScene);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stroke, setStroke] = useState(DEFAULT_STROKE);
  const [editing, setEditing] = useState<{ id: string } | null>(null);

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
    setSelectedId(null);
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
    for (const el of scene.elements) drawElement(ctx, el);

    // selection chrome in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sel = scene.elements.find((e) => e.id === selectedId);
    if (sel) drawSelection(ctx, sel, vp);
  }, [scene, selectedId, vp]);

  useLayoutEffect(() => { draw(); }, [draw]);

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
      const sel = scene.elements.find((el) => el.id === selectedId);
      if (sel) {
        const handle = hitHandle(sel, sx, sy, vp);
        if (handle >= 0) {
          dragRef.current = { kind: "resize", id: sel.id, handle, orig: cloneEl(sel) };
          undoRef.current.push(cloneScene(scene));
          return;
        }
      }
      const hit = hitTopElement(scene, world.x, world.y, 8 / vp.zoom);
      if (hit) {
        setSelectedId(hit.id);
        dragRef.current = { kind: "move", id: hit.id, startX: world.x, startY: world.y, orig: cloneEl(hit) };
        undoRef.current.push(cloneScene(scene));
      } else {
        setSelectedId(null);
      }
      return;
    }

    // creation tools
    const snapshot = cloneScene(scene);
    const id = genId();
    if (tool === "rect" || tool === "ellipse" || tool === "diamond") {
      const el: ShapeElement = { id, type: tool, x: world.x, y: world.y, w: 1, h: 1, stroke, fill: "transparent", strokeWidth: DEFAULT_STROKE_WIDTH, opacity: 1 };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedId(id);
      dragRef.current = { kind: "draw", id, startX: world.x, startY: world.y };
    } else if (tool === "line" || tool === "arrow") {
      const el: PathElement = { id, type: tool, x: world.x, y: world.y, w: 1, h: 1, stroke, fill: "transparent", strokeWidth: DEFAULT_STROKE_WIDTH, opacity: 1, points: [[world.x, world.y], [world.x, world.y]] };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedId(id);
      dragRef.current = { kind: "path", id };
    } else if (tool === "freedraw") {
      const el: PathElement = { id, type: "freedraw", x: world.x, y: world.y, w: 1, h: 1, stroke, fill: "transparent", strokeWidth: DEFAULT_STROKE_WIDTH, opacity: 1, points: [[world.x, world.y]] };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      dragRef.current = { kind: "path", id };
    } else if (tool === "text") {
      const el: CanvasElement = { id, type: "text", x: world.x, y: world.y - DEFAULT_FONT_SIZE / 2, w: 160, h: DEFAULT_FONT_SIZE * 1.4, stroke, fill: "transparent", strokeWidth: 1, opacity: 1, text: "", fontSize: DEFAULT_FONT_SIZE };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedId(id);
      setEditing({ id });
      setTool("select");
    } else if (tool === "sticky") {
      const el: CanvasElement = { id, type: "sticky", x: world.x, y: world.y, w: 180, h: 180, stroke: "transparent", fill: STICKY_COLORS[0], strokeWidth: 0, opacity: 1, text: "", fontSize: 16 };
      undoRef.current.push(snapshot);
      setScene((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedId(id);
      setEditing({ id });
      setTool("select");
    }
  }, [editing, tool, scene, selectedId, vp, stroke, toWorld]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
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
    } else if (drag.kind === "move") {
      const dx = world.x - drag.startX, dy = world.y - drag.startY;
      patchElement(drag.id, (el) => {
        const o = drag.orig;
        el.x = o.x + dx; el.y = o.y + dy;
        if ("points" in el && "points" in o) el.points = o.points.map((p) => [p[0] + dx, p[1] + dy]);
      });
    } else if (drag.kind === "resize") {
      patchElement(drag.id, (el) => applyResize(el, drag.orig, drag.handle, world));
    }
  }, [patchElement, toWorld]);

  const onPointerUp = useCallback(() => {
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
        if (tiny) { elements = s.elements.filter((x) => x.id !== drag.id); setSelectedId(null); }
        else {
          elements = s.elements.map((x) => {
            if (x.id !== drag.id) return x;
            if ("points" in x) { const c = { ...x, points: x.points.map((p) => [p[0], p[1]] as [number, number]) }; syncPathBounds(c); return c; }
            return { ...x, ...normalizeBox(x) };
          });
          setTool("select");
        }
        const next = { ...s, elements };
        onChange(next);
        return next;
      });
    } else if (drag.kind === "move" || drag.kind === "resize") {
      setScene((s) => { onChange(s); return s; });
    }
    // pan doesn't touch persisted elements — no onChange
    bump();
  }, [onChange, bump]);

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
    if (!selectedId) return;
    const snapshot = cloneScene(scene);
    const next = { ...scene, elements: scene.elements.filter((el) => el.id !== selectedId) };
    setSelectedId(null);
    commit(next, snapshot);
  }, [selectedId, scene, commit]);

  const applyStroke = useCallback((color: string) => {
    setStroke(color);
    if (!selectedId) return;
    const snapshot = cloneScene(scene);
    const next = {
      ...scene,
      elements: scene.elements.map((el) => {
        if (el.id !== selectedId) return el;
        if (el.type === "sticky") return { ...el, fill: color };
        return { ...el, stroke: color };
      }),
    };
    commit(next, snapshot);
  }, [selectedId, scene, commit]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") { spaceRef.current = true; return; }
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { if (selectedId) { e.preventDefault(); deleteSelected(); } return; }
      const match = TOOLS.find((x) => x.key?.toLowerCase() === e.key.toLowerCase());
      if (match) setTool(match.tool);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === " ") spaceRef.current = false; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [undo, redo, deleteSelected, selectedId]);

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
      const next = { ...s, elements: s.elements.map((x) => (x.id === id && (x.type === "text" || x.type === "sticky") ? { ...x, text: value } : x)) };
      onChange(next);
      return next;
    });
  }, [editing, onChange]);

  const editingEl = editing ? scene.elements.find((e) => e.id === editing.id) : null;
  const cursor = tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";

  return (
    <div ref={wrapRef} className="wbcanvas" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          const rect = canvasRef.current!.getBoundingClientRect();
          const world = toWorld(e.clientX - rect.left, e.clientY - rect.top);
          const hit = hitTopElement(scene, world.x, world.y, 8 / vp.zoom);
          if (hit && (hit.type === "text" || hit.type === "sticky")) { setSelectedId(hit.id); setEditing({ id: hit.id }); }
        }}
        style={{ display: "block", touchAction: "none", cursor }}
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

      {/* toolbar */}
      <div className="wbcanvas__tools" style={toolbarStyle}>
        {TOOLS.map(({ tool: t, Icon, label, key }) => (
          <button key={t} type="button" title={`${label}${key ? ` (${key})` : ""}`} onClick={() => setTool(t)}
            style={toolBtn(tool === t)}>
            <Icon style={{ width: 17, height: 17 }} />
          </button>
        ))}
        <span style={{ width: 1, height: 22, background: "var(--os-line, #e5e7eb)", margin: "0 2px" }} />
        {STROKE_COLORS.slice(0, 6).map((c) => (
          <button key={c} type="button" title="Color" onClick={() => applyStroke(c)}
            style={{ width: 20, height: 20, borderRadius: 6, background: c, border: stroke === c ? "2px solid #0073EA" : "1px solid rgba(0,0,0,.15)", cursor: "pointer", padding: 0 }} />
        ))}
        <span style={{ width: 1, height: 22, background: "var(--os-line, #e5e7eb)", margin: "0 2px" }} />
        <button type="button" title="Undo (⌘Z)" onClick={undo} disabled={hist.u === 0} style={toolBtn(false)}><Undo2 style={{ width: 16, height: 16 }} /></button>
        <button type="button" title="Redo (⌘⇧Z)" onClick={redo} disabled={hist.r === 0} style={toolBtn(false)}><Redo2 style={{ width: 16, height: 16 }} /></button>
        <button type="button" title="Delete (⌫)" onClick={deleteSelected} disabled={!selectedId} style={toolBtn(false)}><Trash2 style={{ width: 16, height: 16 }} /></button>
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
function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement) {
  ctx.save();
  ctx.globalAlpha = el.opacity;
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
  } else if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") {
    const pts = el.points;
    if (pts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      if (el.type === "arrow" && pts.length >= 2) drawArrowhead(ctx, pts[pts.length - 2], pts[pts.length - 1], el.strokeWidth);
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number) {
  if (!text) return;
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = word; }
      else line = test;
    }
    ctx.fillText(line, x, y);
    y += lineH;
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, el: CanvasElement, vp: { x: number; y: number; zoom: number }) {
  const x = el.x * vp.zoom + vp.x, y = el.y * vp.zoom + vp.y, w = el.w * vp.zoom, h = el.h * vp.zoom;
  ctx.save();
  ctx.strokeStyle = "#0073EA";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  if (el.type !== "line" && el.type !== "arrow" && el.type !== "freedraw") {
    ctx.fillStyle = "#fff";
    for (const [hx, hy] of handlePositions(x, y, w, h)) {
      ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    }
  }
  ctx.restore();
}

function handlePositions(x: number, y: number, w: number, h: number): [number, number][] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; // corners: 0 TL, 1 TR, 2 BR, 3 BL
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

// ── inline styles (kept local; the page owns the surrounding chrome) ─────────
const toolbarStyle: React.CSSProperties = {
  position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
  display: "flex", alignItems: "center", gap: 3, padding: 5,
  background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)",
  borderRadius: 12, boxShadow: "0 6px 24px rgba(20,34,60,.12)", zIndex: 5, flexWrap: "wrap", maxWidth: "calc(100vw - 24px)",
};
const zoomStyle: React.CSSProperties = {
  position: "absolute", bottom: 16, right: 16, display: "flex", alignItems: "center", gap: 2, padding: 4,
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
