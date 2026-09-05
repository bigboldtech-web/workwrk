// Canvas rendering — the pure element painter shared by the interactive
// editor (whiteboard-canvas.tsx) and read-only previews (Doc embeds,
// canvas-in-canvas thumbnails). Extracted verbatim from the editor so a
// scene draws identically wherever it appears.

import {
  type CanvasElement,
  type CanvasCardElement,
  type CanvasScene,
  type PathElement,
  type ArrowType,
  elbowPoints,
  sceneBounds,
} from "./scene";

export function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, getImage: (src: string) => HTMLImageElement | null) {
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
export function strokeConnectorPath(ctx: CanvasRenderingContext2D, el: PathElement): [[number, number], [number, number]] | null {
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

export function drawArrowhead(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], sw: number) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const len = 8 + sw * 2;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - len * Math.cos(angle - Math.PI / 6), to[1] - len * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - len * Math.cos(angle + Math.PI / 6), to[1] - len * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = Infinity) {
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

// ───────── Read-only preview (Doc embed / canvas-in-canvas thumbnail) ─────────

export interface RenderSceneOptions {
  /** CSS pixel size of the target box. */
  width: number;
  height: number;
  /** devicePixelRatio; caller must have sized the backing store to width*dpr × height*dpr. */
  dpr?: number;
  /** Inner padding (CSS px) so content doesn't touch the edges. */
  padding?: number;
  /** Fill behind the scene. Transparent if omitted. */
  background?: string;
  /** Cap the fit scale so a tiny scene isn't blown up absurdly. */
  maxScale?: number;
  /** Optional image resolver; unresolved images draw a placeholder. */
  getImage?: (src: string) => HTMLImageElement | null;
}

/**
 * Paint an entire scene, fit-to-contain, into the current 2D context. Used
 * for non-interactive previews. Resets the transform itself; the caller only
 * needs to have sized the canvas backing store to (width*dpr, height*dpr).
 */
export function renderScene(ctx: CanvasRenderingContext2D, scene: CanvasScene, opts: RenderSceneOptions): void {
  const { width, height, dpr = 1, padding = 12, background, maxScale = 1.5 } = opts;
  const getImage = opts.getImage ?? (() => null);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  const b = sceneBounds(scene);
  if (!b || b.w <= 0 || b.h <= 0) return;

  const availW = Math.max(1, width - padding * 2);
  const availH = Math.max(1, height - padding * 2);
  const scale = Math.min(availW / b.w, availH / b.h, maxScale);
  // Centre the scaled content in the box.
  const tx = (width - b.w * scale) / 2 - b.x * scale;
  const ty = (height - b.h * scale) / 2 - b.y * scale;

  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, tx * dpr, ty * dpr);
  for (const el of scene.elements) drawElement(ctx, el, getImage);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Paint a canvas-in-canvas card: a titled frame with a live thumbnail of the
 * linked Canvas (or a placeholder while it loads / when empty). Drawn by the
 * editor's world-space loop; the caller resolves `linked` from its own cache.
 */
export function drawCanvasCard(
  ctx: CanvasRenderingContext2D,
  el: CanvasCardElement,
  linked: CanvasScene | null,
  getImage: (src: string) => HTMLImageElement | null,
): void {
  const headH = 28;
  ctx.save();
  ctx.globalAlpha = el.opacity;

  // Card body + border.
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, el.x, el.y, el.w, el.h, 10);
  ctx.fill();
  ctx.strokeStyle = "#E2E8F0";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Thumbnail area (below the header).
  const inner = { x: el.x + 1, y: el.y + headH, w: el.w - 2, h: el.h - headH - 1 };
  ctx.save();
  roundRect(ctx, el.x, el.y, el.w, el.h, 10);
  ctx.clip();
  ctx.fillStyle = "#F8FAFC";
  ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  if (linked && linked.elements.length > 0) {
    renderSceneInto(ctx, linked, inner, { padding: 10, getImage });
  } else {
    ctx.fillStyle = "#CBD5E1";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(linked ? "Empty canvas" : "Loading canvas…", inner.x + inner.w / 2, inner.y + inner.h / 2);
    ctx.textAlign = "left";
  }
  ctx.restore();

  // Header: a small canvas glyph + the title, on a faint bar.
  ctx.fillStyle = "#F1F5F9";
  ctx.beginPath();
  ctx.rect(el.x + 1, el.y + 1, el.w - 2, headH - 1);
  ctx.fill();
  ctx.strokeStyle = "#94A3B8";
  ctx.lineWidth = 1.4;
  roundRect(ctx, el.x + 9, el.y + 9, 11, 10, 2);
  ctx.stroke();
  ctx.fillStyle = "#334155";
  ctx.textBaseline = "middle";
  ctx.font = "600 12.5px ui-sans-serif, system-ui, sans-serif";
  wrapText(ctx, el.title || "Canvas", el.x + 28, el.y + headH / 2 + 1, el.w - 40, 16, 1);

  ctx.restore();
}

/**
 * Draw a scene fit-to-contain inside `rect` (in the CURRENT user-space units),
 * composing on top of whatever transform is already active — used to paint a
 * canvas-in-canvas thumbnail inside the live editor's world-space draw loop.
 * Clips to the rect and never touches setTransform, so the caller's transform
 * is preserved. Nested canvasCard elements inside `scene` draw nothing (no
 * recursion) since drawElement doesn't paint them.
 */
export function renderSceneInto(
  ctx: CanvasRenderingContext2D,
  scene: CanvasScene,
  rect: { x: number; y: number; w: number; h: number },
  opts: { padding?: number; getImage?: (src: string) => HTMLImageElement | null } = {},
): void {
  const padding = opts.padding ?? 8;
  const getImage = opts.getImage ?? (() => null);
  const b = sceneBounds(scene);
  if (!b || b.w <= 0 || b.h <= 0) return;

  const availW = Math.max(1, rect.w - padding * 2);
  const availH = Math.max(1, rect.h - padding * 2);
  const scale = Math.min(availW / b.w, availH / b.h, 1);
  const tx = rect.x + (rect.w - b.w * scale) / 2 - b.x * scale;
  const ty = rect.y + (rect.h - b.h * scale) / 2 - b.y * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(tx, ty);
  ctx.scale(scale, scale);
  for (const el of scene.elements) drawElement(ctx, el, getImage);
  ctx.restore();
}
