// Console-local layout state per staff member (spec-admin-backoffice section
// 1 "Console preferences" and section 3 item 3). Stored on
// PlatformAdmin.consolePrefs, read by GET /api/admin/me and written by
// PATCH /api/admin/me/console. Pure: the route validates and merges through
// these functions, and vitest proves them in the node environment.
//
// What lives here, and only this: the sidebar collapsed state, the company
// drawer width, the column choices of two tables, and the last five
// companies this staff member opened. Theme and density are PRODUCT
// preferences (My settings > Preferences > Appearance) and are never copied
// into this column. Nothing here is ever read from or written to
// localStorage.

export const DRAWER_WIDTH_MIN = 480;
export const DRAWER_WIDTH_MAX = 720;
export const DRAWER_WIDTH_DEFAULT = 520;
/** Search's RECENT section holds five; the oldest drops off. */
export const MAX_RECENTS = 5;
/** A table has at most a few dozen columns; anything longer is not ours. */
const MAX_COLUMNS = 40;
const COLUMN_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/;
/** A company id as the console carries it; never free text. */
const COMPANY_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export interface ConsolePrefs {
  sidebar: { collapsed: boolean };
  companies: { drawerWidth: number; columns: string[] | null };
  audit: { columns: string[] | null };
  /** Company ids, newest first, at most MAX_RECENTS. */
  recent: string[];
}

/** `null` columns = "all on" (the default the table itself owns). */
export const DEFAULT_CONSOLE_PREFS: ConsolePrefs = {
  sidebar: { collapsed: false },
  companies: { drawerWidth: DRAWER_WIDTH_DEFAULT, columns: null },
  audit: { columns: null },
  recent: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function clampDrawerWidth(n: number): number {
  if (!Number.isFinite(n)) return DRAWER_WIDTH_DEFAULT;
  return Math.round(Math.min(DRAWER_WIDTH_MAX, Math.max(DRAWER_WIDTH_MIN, n)));
}

function cleanColumns(v: unknown): string[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const k of v) {
    if (typeof k === "string" && COLUMN_KEY_RE.test(k) && !out.includes(k)) out.push(k);
    if (out.length >= MAX_COLUMNS) break;
  }
  return out;
}

function cleanRecent(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const id of v) {
    if (typeof id === "string" && COMPANY_ID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_RECENTS) break;
  }
  return out;
}

/**
 * Read the stored JSON (anything, including null or a hand-edited value)
 * into a complete ConsolePrefs. Unknown keys and wrong types fall back to
 * the defaults; a stored value never throws.
 */
export function readConsolePrefs(raw: unknown): ConsolePrefs {
  const r = isRecord(raw) ? raw : {};
  const sidebar = isRecord(r.sidebar) ? r.sidebar : {};
  const companies = isRecord(r.companies) ? r.companies : {};
  const audit = isRecord(r.audit) ? r.audit : {};
  return {
    sidebar: { collapsed: sidebar.collapsed === true },
    companies: {
      drawerWidth: typeof companies.drawerWidth === "number" ? clampDrawerWidth(companies.drawerWidth) : DRAWER_WIDTH_DEFAULT,
      columns: cleanColumns(companies.columns) ?? null,
    },
    audit: { columns: cleanColumns(audit.columns) ?? null },
    recent: cleanRecent(r.recent) ?? [],
  };
}

/** A validated partial write: only the keys the request named. */
export interface ConsolePrefsPatch {
  sidebar?: { collapsed?: boolean };
  companies?: { drawerWidth?: number; columns?: string[] | null };
  audit?: { columns?: string[] | null };
  recent?: string[];
  /** Put one company at the front of `recent` (the company page's open). */
  openedCompany?: string;
}

export type PatchResult = { ok: true; patch: ConsolePrefsPatch } | { ok: false; error: string };

/**
 * Validate a PATCH body. Refuses (400) anything that is not one of the named
 * keys with the right type, so a typo is an error rather than a silent no-op,
 * and clamps the drawer width into 480 to 720.
 */
export function validateConsolePatch(body: unknown): PatchResult {
  if (!isRecord(body)) return { ok: false, error: "Send a JSON object" };
  const allowed = new Set(["sidebar", "companies", "audit", "recent", "openedCompany"]);
  for (const k of Object.keys(body)) if (!allowed.has(k)) return { ok: false, error: `Unknown setting: ${k}` };
  const patch: ConsolePrefsPatch = {};

  if (body.sidebar !== undefined) {
    if (!isRecord(body.sidebar) || typeof body.sidebar.collapsed !== "boolean") {
      return { ok: false, error: "sidebar.collapsed must be true or false" };
    }
    patch.sidebar = { collapsed: body.sidebar.collapsed };
  }
  if (body.companies !== undefined) {
    if (!isRecord(body.companies)) return { ok: false, error: "companies must be an object" };
    const c: NonNullable<ConsolePrefsPatch["companies"]> = {};
    if (body.companies.drawerWidth !== undefined) {
      if (typeof body.companies.drawerWidth !== "number" || !Number.isFinite(body.companies.drawerWidth)) {
        return { ok: false, error: "companies.drawerWidth must be a number" };
      }
      c.drawerWidth = clampDrawerWidth(body.companies.drawerWidth);
    }
    if (body.companies.columns !== undefined) {
      const cols = cleanColumns(body.companies.columns);
      if (cols === undefined) return { ok: false, error: "companies.columns must be a list of column keys or null" };
      c.columns = cols;
    }
    patch.companies = c;
  }
  if (body.audit !== undefined) {
    if (!isRecord(body.audit)) return { ok: false, error: "audit must be an object" };
    const cols = cleanColumns(body.audit.columns);
    if (cols === undefined) return { ok: false, error: "audit.columns must be a list of column keys or null" };
    patch.audit = { columns: cols };
  }
  if (body.recent !== undefined) {
    const rec = cleanRecent(body.recent);
    if (rec === undefined) return { ok: false, error: "recent must be a list of company ids" };
    patch.recent = rec;
  }
  if (body.openedCompany !== undefined) {
    if (typeof body.openedCompany !== "string" || !COMPANY_ID_RE.test(body.openedCompany)) {
      return { ok: false, error: "openedCompany must be a company id" };
    }
    patch.openedCompany = body.openedCompany;
  }
  return { ok: true, patch };
}

/** Put `id` first, drop its older copy, keep at most MAX_RECENTS. */
export function pushRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENTS);
}

/** Apply a validated patch to the current prefs. Pure; returns a new object. */
export function mergeConsolePrefs(current: ConsolePrefs, patch: ConsolePrefsPatch): ConsolePrefs {
  const next: ConsolePrefs = {
    sidebar: { ...current.sidebar, ...(patch.sidebar ?? {}) },
    companies: { ...current.companies, ...(patch.companies ?? {}) },
    audit: { ...current.audit, ...(patch.audit ?? {}) },
    recent: patch.recent ? [...patch.recent] : [...current.recent],
  };
  if (patch.openedCompany) next.recent = pushRecent(next.recent, patch.openedCompany);
  return next;
}
