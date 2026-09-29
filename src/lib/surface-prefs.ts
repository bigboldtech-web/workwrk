// Per-viewer view state for list surfaces outside Work (settings-architecture
// 9.2 shape, spec-ai-automation 1.7): UserPreference.home.work.surface[key]
// holds { columns, sortKey, viewOptions }. The status view, the filters and
// the page are URL state and never stored here, so a shared link carries them.
//
// Keys written by the AI hub: "sidekick.allChats", "agents.runs" (and the
// automation lists write "automation.workflows" and "automation.logs").

export interface SurfaceState {
  columns?: string[];
  sortKey?: string;
  viewOptions?: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** The stored state for one surface, tolerating any shape (or none). */
export function readSurface(prefs: unknown, key: string): SurfaceState {
  const home = isRecord(prefs) ? prefs.home : undefined;
  const work = isRecord(home) ? home.work : undefined;
  const surface = isRecord(work) ? work.surface : undefined;
  const raw = isRecord(surface) ? surface[key] : undefined;
  if (!isRecord(raw)) return {};
  const out: SurfaceState = {};
  if (Array.isArray(raw.columns)) out.columns = raw.columns.filter((c): c is string => typeof c === "string");
  if (typeof raw.sortKey === "string") out.sortKey = raw.sortKey;
  if (isRecord(raw.viewOptions)) out.viewOptions = raw.viewOptions;
  return out;
}

/** The PATCH /api/preferences body that merges `next` into one surface. */
export function surfacePatch(key: string, next: SurfaceState): { home: { work: { surface: Record<string, SurfaceState> } } } {
  return { home: { work: { surface: { [key]: next } } } };
}

/** A stored choice when it is one of the allowed values, else the default. */
export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
