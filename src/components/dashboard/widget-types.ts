// Dashboard widget model — the shape stored in Dashboard.widgets (an
// existing JSON column; no migration). The column is `unknown[]` to the
// server, so parseWidgets validates defensively: malformed entries drop,
// numbers clamp, and the canvas never crashes on stale/foreign JSON.

export type WidgetType = "task-list" | "stat" | "notes" | "battery" | "chart";

export type WidgetSource =
  | { kind: "all" }
  | { kind: "board"; boardId: string; boardName?: string };

export type StatScope = "open" | "total" | "completed" | "overdue";
export type ChartBy = "status" | "assignee" | "priority";
export type ChartKind = "pie" | "bar";

export interface DashWidget {
  id: string;
  type: WidgetType;
  title: string;
  config: {
    source?: WidgetSource;
    statScope?: StatScope;
    chartBy?: ChartBy;
    chartKind?: ChartKind;
    noteText?: string;
  };
  layout: { x: number; y: number; w: number; h: number };
}

export const WIDGET_LIMIT = 30;
export const GRID_COLS = 12;

const WIDGET_TYPES = new Set<string>(["task-list", "stat", "notes", "battery", "chart"]);
const STAT_SCOPES = new Set<string>(["open", "total", "completed", "overdue"]);
const CHART_BYS = new Set<string>(["status", "assignee", "priority"]);
const CHART_KINDS = new Set<string>(["pie", "bar"]);

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

function parseSource(raw: unknown): WidgetSource | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  if (s.kind === "all") return { kind: "all" };
  if (s.kind === "board" && typeof s.boardId === "string" && s.boardId) {
    return {
      kind: "board",
      boardId: s.boardId,
      ...(typeof s.boardName === "string" && s.boardName ? { boardName: s.boardName } : {}),
    };
  }
  return undefined;
}

function parseWidget(raw: unknown): DashWidget | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || !w.id) return null;
  if (typeof w.type !== "string" || !WIDGET_TYPES.has(w.type)) return null;

  const cfg = (w.config && typeof w.config === "object" ? w.config : {}) as Record<string, unknown>;
  const lay = (w.layout && typeof w.layout === "object" ? w.layout : {}) as Record<string, unknown>;

  return {
    id: w.id,
    type: w.type as WidgetType,
    title: typeof w.title === "string" && w.title.trim() ? w.title.slice(0, 120) : "Card",
    config: {
      ...(parseSource(cfg.source) ? { source: parseSource(cfg.source) } : {}),
      ...(typeof cfg.statScope === "string" && STAT_SCOPES.has(cfg.statScope)
        ? { statScope: cfg.statScope as StatScope } : {}),
      ...(typeof cfg.chartBy === "string" && CHART_BYS.has(cfg.chartBy)
        ? { chartBy: cfg.chartBy as ChartBy } : {}),
      ...(typeof cfg.chartKind === "string" && CHART_KINDS.has(cfg.chartKind)
        ? { chartKind: cfg.chartKind as ChartKind } : {}),
      ...(typeof cfg.noteText === "string" ? { noteText: cfg.noteText.slice(0, 20000) } : {}),
    },
    layout: {
      x: clampInt(lay.x, 0, GRID_COLS - 1, 0),
      y: clampInt(lay.y, 0, 10000, 0),
      w: clampInt(lay.w, 1, GRID_COLS, 4),
      h: clampInt(lay.h, 2, 60, 4),
    },
  };
}

/** Dashboard.widgets (unknown JSON) → validated widget list. Malformed
 *  entries and duplicate ids drop silently; never throws. */
export function parseWidgets(raw: unknown): DashWidget[] {
  if (!Array.isArray(raw)) return [];
  const out: DashWidget[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const w = parseWidget(entry);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
    if (out.length >= WIDGET_LIMIT) break;
  }
  return out;
}

/** DashWidget[] → the plain JSON persisted via PATCH. Strips anything
 *  beyond the known keys so foreign props never round-trip into the DB. */
export function serializeWidgets(widgets: DashWidget[]): unknown[] {
  return widgets.slice(0, WIDGET_LIMIT).map((w) => ({
    id: w.id,
    type: w.type,
    title: w.title,
    config: {
      ...(w.config.source ? { source: w.config.source } : {}),
      ...(w.config.statScope ? { statScope: w.config.statScope } : {}),
      ...(w.config.chartBy ? { chartBy: w.config.chartBy } : {}),
      ...(w.config.chartKind ? { chartKind: w.config.chartKind } : {}),
      ...(w.config.noteText !== undefined ? { noteText: w.config.noteText } : {}),
    },
    layout: { x: w.layout.x, y: w.layout.y, w: w.layout.w, h: w.layout.h },
  }));
}

/** Default size + title per widget type for a freshly added card. */
const WIDGET_DEFAULTS: Record<WidgetType, { title: string; w: number; h: number }> = {
  "task-list": { title: "Task List",          w: 6, h: 6 },
  stat:        { title: "Calculation",        w: 3, h: 3 },
  notes:       { title: "Notes",              w: 4, h: 5 },
  battery:     { title: "Workload by Status", w: 4, h: 5 },
  chart:       { title: "Chart",              w: 6, h: 6 },
};

/** Gallery tiles can preset a title/config (e.g. "Tasks by Assignee" =
 *  a chart widget pre-grouped by assignee). */
export interface WidgetPreset {
  title?: string;
  config?: Partial<DashWidget["config"]>;
}

/** New widget with sane defaults, placed at grid-bottom row `y`. */
export function createWidget(type: WidgetType, y: number, preset?: WidgetPreset): DashWidget {
  const d = WIDGET_DEFAULTS[type];
  return {
    id: `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    title: preset?.title ?? d.title,
    config: { source: { kind: "all" }, ...(preset?.config ?? {}) },
    layout: { x: 0, y, w: d.w, h: d.h },
  };
}
