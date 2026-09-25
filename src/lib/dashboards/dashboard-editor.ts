// The dashboard editor's pure core: what the canvas holds, what a save sends,
// where a new card goes, how a moved card is saved, and how an editor's
// unsaved changes are merged onto a version someone else saved.
//
// The client (src/components/dashboards/use-dashboard.ts and save-queue.ts,
// and the Space Overview) keeps three things per dashboard:
//
//   base       what the server last confirmed (its updatedAt, name and cards
//              exactly as this editor was sent them)
//   local      what is on screen
//   removedIds cards removed since the last confirmed save
//
// A save is ONE PATCH of the whole card list at base's version. A card the
// editor cannot read travels as { id, kind: "passthrough" } and becomes the
// stored card on the server (widgets.ts resolvePassthrough), a partly readable
// card is sent as the part the editor sees and the server appends the rest
// (restoreHiddenParts), and a card that is no longer in the list must be named
// in removedWidgetIds or the server refuses the save (checkWidgetRemovals).
//
// Pure: imports only widgets.ts.

import {
  GRID_COLS,
  type EditorWidget,
  type WidgetInput,
  type WidgetLayout,
} from "./widgets";

export interface DashboardSnapshot {
  name: string;
  widgets: EditorWidget[];
}

const MAX_H = 60;
const MAX_Y = 10000;

// ── Canonical comparison ─────────────────────────────────────────────

/** JSON with object keys sorted, so two equal values always compare equal. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function without<T extends object>(o: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v;
  return out;
}

/**
 * The part of a card that decides its DATA: everything but its id, title
 * and place. A save refetches a card's numbers only when this changed, and
 * the editor's preview result is reused only when it matches.
 */
export function dataKey(w: EditorWidget | WidgetInput): string {
  return stableStringify(without(w, ["id", "title", "layout", "partial"]));
}

/** The same key for a write input, which is what the editor previews. */
export function previewKey(input: WidgetInput): string {
  return dataKey(input);
}

// ── Layout ───────────────────────────────────────────────────────────

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

export function clampLayout(l: WidgetLayout): WidgetLayout {
  const w = clampInt(l.w, 1, GRID_COLS);
  return {
    x: clampInt(l.x, 0, GRID_COLS - w),
    y: clampInt(l.y, 0, MAX_Y),
    w,
    h: clampInt(l.h, 1, MAX_H),
  };
}

function overlaps(a: WidgetLayout, b: WidgetLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Where a new card of `size` goes: the first free spot scanning the grid top
 * to bottom, left to right, so a small card fills the gap beside a row's
 * last card, and otherwise the bottom.
 */
export function placeNewWidget(existing: readonly WidgetLayout[], size: { w: number; h: number }): WidgetLayout {
  const w = clampInt(size.w, 1, GRID_COLS);
  const h = clampInt(size.h, 1, MAX_H);
  const bottom = existing.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  for (let y = 0; y < bottom; y += 1) {
    for (let x = 0; x + w <= GRID_COLS; x += 1) {
      const spot = { x, y, w, h };
      if (!existing.some((l) => overlaps(spot, l))) return spot;
    }
  }
  return { x: 0, y: Math.min(bottom, MAX_Y), w, h };
}

/** A grid's items as card layouts, clamped to the 12-column model. */
export function layoutsFromGrid(grid: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>): Record<string, WidgetLayout> {
  const out: Record<string, WidgetLayout> = {};
  for (const it of grid) {
    if (![it.x, it.y, it.w, it.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    out[it.i] = clampLayout({ x: it.x, y: it.y, w: it.w, h: it.h });
  }
  return out;
}

/** The card ids whose layout in `next` differs from `stored` (or is new). */
export function diffLayouts(stored: Readonly<Record<string, WidgetLayout>>, next: Readonly<Record<string, WidgetLayout>>): string[] {
  const out: string[] = [];
  for (const [id, l] of Object.entries(next)) {
    const s = stored[id];
    if (!s || s.x !== l.x || s.y !== l.y || s.w !== l.w || s.h !== l.h) out.push(id);
  }
  return out;
}

/** The stored layout of every card that has one. */
export function layoutsOf(widgets: readonly EditorWidget[]): Record<string, WidgetLayout> {
  const out: Record<string, WidgetLayout> = {};
  for (const w of widgets) if (w.layout) out[w.id] = w.layout;
  return out;
}

/**
 * The cards with new layouts. A hidden or passthrough card is never moved:
 * it is saved as the stored value, so a layout change to it would show on
 * screen and silently revert on the next load.
 */
export function applyLayouts(widgets: readonly EditorWidget[], layouts: Readonly<Record<string, WidgetLayout>>): EditorWidget[] {
  return widgets.map((w) => {
    if (w.kind === "hidden" || w.kind === "passthrough") return w;
    const l = layouts[w.id];
    return l ? { ...w, layout: { ...l } } : w;
  });
}

/** Top to bottom, left to right; cards with no layout keep their order at the end. */
export function stackOrder(widgets: readonly EditorWidget[]): EditorWidget[] {
  return widgets
    .map((w, index) => ({ w, index }))
    .sort((a, b) => {
      const la = a.w.layout;
      const lb = b.w.layout;
      if (!la && !lb) return a.index - b.index;
      if (!la) return 1;
      if (!lb) return -1;
      return la.y - lb.y || la.x - lb.x || a.index - b.index;
    })
    .map((x) => x.w);
}

/**
 * react-grid-layout items for the cards. On 12 columns every card sits where
 * it is stored; an editor may move a card, never a hidden or passthrough one
 * (their items are static for everyone), and a viewer moves nothing. On a
 * narrower breakpoint (the Space Overview's xs and xxs) the cards are derived
 * as a full-width stack in stackOrder, static, and never saved.
 */
export function widgetGridItems(
  widgets: readonly EditorWidget[],
  o: { canEdit: boolean; cols: number; prefix?: string },
): Array<{ i: string; x: number; y: number; w: number; h: number; static: boolean }> {
  const prefix = o.prefix ?? "";
  if (o.cols < GRID_COLS) {
    let y = 0;
    return stackOrder(widgets).map((w) => {
      const h = w.layout?.h ?? 4;
      const item = { i: `${prefix}${w.id}`, x: 0, y, w: Math.max(1, o.cols), h, static: true };
      y += h;
      return item;
    });
  }
  const placed: WidgetLayout[] = widgets.filter((w) => w.layout).map((w) => w.layout as WidgetLayout);
  return widgets.map((w) => {
    let l = w.layout;
    if (!l) {
      l = placeNewWidget(placed, { w: 4, h: 4 });
      placed.push(l);
    }
    const locked = w.kind === "hidden" || w.kind === "passthrough";
    return { i: `${prefix}${w.id}`, x: l.x, y: l.y, w: l.w, h: l.h, static: !o.canEdit || locked };
  });
}

/** Every breakpoint's items minus the widget ones, so no card id enters a per-person preference. */
export function withoutWidgetItems<T extends { i: string }>(layouts: Readonly<Record<string, T[]>>, prefix = "w:"): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [bp, items] of Object.entries(layouts)) {
    out[bp] = Array.isArray(items) ? items.filter((it) => !String(it.i).startsWith(prefix)) : items;
  }
  return out;
}

// ── The save body ────────────────────────────────────────────────────

/** Local cards as the write shape. */
export function toWidgetInputs(widgets: readonly EditorWidget[]): WidgetInput[] {
  return widgets.map((w): WidgetInput => {
    if (w.kind === "hidden" || w.kind === "passthrough") return { id: w.id, kind: "passthrough" };
    const layout = clampLayout(w.layout);
    if (w.kind === "notes") return { id: w.id, kind: "notes", title: w.title, text: w.text, layout };
    const source = w.source.kind === "lists" ? { kind: "lists" as const, listIds: [...w.source.listIds] } : { ...w.source };
    const filter = { connector: w.filter.connector, rules: w.filter.rules.map((r) => ({ field: r.field, operator: r.operator, value: r.value })), hideDone: w.filter.hideDone };
    if (w.kind === "stat") return { id: w.id, kind: "stat", title: w.title, source, filter, metric: { ...w.metric }, scope: w.scope, layout };
    if (w.kind === "chart") {
      const groupBy = typeof w.groupBy === "object" ? { field: w.groupBy.field } : w.groupBy;
      return { id: w.id, kind: "chart", title: w.title, source, filter, groupBy, display: w.display, layout };
    }
    return { id: w.id, kind: "list", title: w.title, source, filter, sort: w.sort, limit: w.limit, layout };
  });
}

export function buildDashboardPatch(i: {
  expectedUpdatedAt: string;
  widgets: readonly EditorWidget[];
  removedIds: readonly string[];
  name?: string;
}): { expectedUpdatedAt: string; widgets: WidgetInput[]; removedWidgetIds: string[]; name?: string } {
  const kept = new Set(i.widgets.map((w) => w.id));
  const removedWidgetIds = Array.from(new Set(i.removedIds)).filter((id) => !kept.has(id));
  return {
    expectedUpdatedAt: i.expectedUpdatedAt,
    widgets: toWidgetInputs(i.widgets),
    removedWidgetIds,
    ...(i.name !== undefined ? { name: i.name } : {}),
  };
}

// ── Local edits ──────────────────────────────────────────────────────

/**
 * A card taken off the canvas. It is named as removed only when the server
 * has it (baseIds); a card added and removed before any save never existed.
 */
export function removeWidgetLocal(
  state: { widgets: readonly EditorWidget[]; removedIds: readonly string[]; baseIds: ReadonlySet<string> },
  id: string,
): { widgets: EditorWidget[]; removedIds: string[] } {
  const widgets = state.widgets.filter((w) => w.id !== id);
  const removedIds = state.baseIds.has(id) && !state.removedIds.includes(id) ? [...state.removedIds, id] : [...state.removedIds];
  return { widgets, removedIds };
}

/** Undo of a removal: the same card back where it was, and no longer named as removed. */
export function readdWidgetLocal(
  state: { widgets: readonly EditorWidget[]; removedIds: readonly string[] },
  card: EditorWidget,
  index: number,
): { widgets: EditorWidget[]; removedIds: string[] } {
  const widgets = state.widgets.filter((w) => w.id !== card.id);
  widgets.splice(Math.max(0, Math.min(index, widgets.length)), 0, card);
  return { widgets, removedIds: state.removedIds.filter((id) => id !== card.id) };
}

/**
 * The server said the save left cards out without naming them (a card added
 * in another tab after this one's base, at the same version): put those back
 * from the stored list, where the stored list has them, and send again.
 */
export function mergeMissingWidgets(local: readonly EditorWidget[], stored: readonly EditorWidget[], missingIds: readonly string[]): EditorWidget[] {
  const have = new Set(local.map((w) => w.id));
  const want = new Set(missingIds);
  return [...local, ...stored.filter((w) => want.has(w.id) && !have.has(w.id))];
}

// ── Three-way rebase ─────────────────────────────────────────────────

function mergeCard(b: EditorWidget, l: EditorWidget, v: EditorWidget): EditorWidget {
  if (l.kind === "hidden" || l.kind === "passthrough" || v.kind === "hidden" || v.kind === "passthrough" || b.kind === "hidden" || b.kind === "passthrough") {
    return v;
  }
  const titleMine = l.title !== b.title;
  const layoutMine = !same(l.layout, b.layout);
  const bodyMine = dataKey(l) !== dataKey(b) || l.kind !== b.kind;
  const start: EditorWidget = bodyMine ? l : v;
  return {
    ...start,
    title: titleMine ? l.title : v.title,
    layout: layoutMine ? { ...l.layout } : { ...v.layout },
  } as EditorWidget;
}

/**
 * My unsaved changes (`local` since `base`) applied onto the version someone
 * else saved (`live`), card by card and part by part (title, place, the rest):
 *
 *   - a part I changed takes my value; a part I did not change takes theirs
 *   - a card I added stays; a card they added stays
 *   - a card they deleted stays deleted, unless I changed it since my base
 *   - a card I deleted stays deleted, unless they changed it since my base
 *     (deleting their fresh edit would overwrite it silently)
 *   - a card I cannot read is always theirs
 *
 * removedIds names every live card the result leaves out, so the save at
 * live's version is accepted and nothing of theirs is dropped by omission.
 */
export function rebaseDashboard(
  base: DashboardSnapshot,
  local: DashboardSnapshot,
  live: DashboardSnapshot,
): { name: string; widgets: EditorWidget[]; removedIds: string[] } {
  const baseById = new Map(base.widgets.map((w) => [w.id, w] as const));
  const liveById = new Map(live.widgets.map((w) => [w.id, w] as const));
  const localIds = new Set(local.widgets.map((w) => w.id));
  const out: EditorWidget[] = [];
  const outIds = new Set<string>();
  const push = (w: EditorWidget) => {
    if (outIds.has(w.id)) return;
    outIds.add(w.id);
    out.push(w);
  };

  for (const l of local.widgets) {
    const b = baseById.get(l.id);
    const v = liveById.get(l.id);
    if (!b) {
      push(l);
      continue;
    }
    if (l.kind === "hidden" || l.kind === "passthrough") {
      if (v) push(v);
      continue;
    }
    const mine = !same(l, b);
    if (!v) {
      if (mine) push(l);
      continue;
    }
    push(mine ? mergeCard(b, l, v) : v);
  }
  for (const v of live.widgets) {
    if (outIds.has(v.id) || localIds.has(v.id)) continue;
    const b = baseById.get(v.id);
    if (!b) {
      push(v);
      continue;
    }
    // I removed it. It stays removed unless they changed it since my base.
    if (!same(v, b)) push(v);
  }
  const removedIds = live.widgets.map((w) => w.id).filter((id) => !outIds.has(id));
  return { name: local.name !== base.name ? local.name : live.name, widgets: out, removedIds };
}

// ── Save outcomes ────────────────────────────────────────────────────

export type SaveOutcome = "ok" | "conflict" | "widget_missing" | "invalid" | "forbidden" | "gone" | "unauthorized" | "retry";

/**
 * What a save's answer means for the queue. 0 is "the request never reached
 * a server" (offline); it and every 5xx, 408 and 429 are retried with
 * backoff, everything else stops and says why.
 */
export function classifySaveResponse(status: number, body: unknown): SaveOutcome {
  if (status >= 200 && status < 300) return "ok";
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (status === 409) return error === "widget_missing" ? "widget_missing" : "conflict";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "gone";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "retry";
  return "invalid";
}
