// The Logs query vocabulary (spec-ai-automation /automation/logs, "URL
// parameters, the complete list"): the six status views, the window
// (?days= or an exact ?from= ?to=, which wins), alert level, record type,
// sort and a keyset cursor. Pure: it returns the Prisma `where` / `orderBy`
// pieces as plain objects, so the API route and the tests agree.

export const LOG_VIEWS = ["all", "succeeded", "failed", "partial", "skipped", "running"] as const;
export type LogView = (typeof LOG_VIEWS)[number];

export const LOG_VIEW_STATUS: Record<LogView, string | null> = {
  all: null,
  succeeded: "SUCCESS",
  failed: "FAILED",
  partial: "PARTIAL",
  skipped: "SKIPPED",
  running: "RUNNING",
};

export const LOG_VIEW_LABEL: Record<LogView, string> = {
  all: "All",
  succeeded: "Succeeded",
  failed: "Failed",
  partial: "Partly done",
  skipped: "Skipped",
  running: "Running",
};

const RUN_STATUSES = ["RUNNING", "SUCCESS", "FAILED", "PARTIAL", "SKIPPED"] as const;
export const WINDOW_DAYS = [7, 30, 90] as const;
export const LOG_PAGE_SIZES = [25, 50, 100] as const;
export const RECORD_TYPES = ["task", "kpi", "kudos", "schedule"] as const;
export const RECORD_LABEL: Record<string, string> = { task: "Tasks", kpi: "KPI readings", kudos: "Kudos", schedule: "Scheduled runs" };

/** A status word from any caller: a view name ("failed") or the stored enum ("FAILED"), comma separated. */
export function parseRunStatuses(raw: string | null | undefined): { statuses: string[]; invalid: string | null } {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const lower = part.toLowerCase() as LogView;
    const viaView = (LOG_VIEWS as readonly string[]).includes(lower) ? LOG_VIEW_STATUS[lower] : null;
    const upper = part.toUpperCase();
    const status = viaView ?? ((RUN_STATUSES as readonly string[]).includes(upper) ? upper : null);
    if (lower === "all") continue;
    if (!status) return { statuses: [], invalid: part };
    if (!out.includes(status)) out.push(status);
  }
  return { statuses: out, invalid: null };
}

/** The view pill a status list lights ("All" for none or several). */
export function viewForStatuses(statuses: string[]): LogView {
  if (statuses.length !== 1) return "all";
  const hit = (Object.entries(LOG_VIEW_STATUS) as Array<[LogView, string | null]>).find(([, s]) => s === statuses[0]);
  return hit ? hit[0] : "all";
}

export function parseDays(raw: string | null | undefined): number | null {
  const n = Number.parseInt(raw ?? "", 10);
  return (WINDOW_DAYS as readonly number[]).includes(n) ? n : null;
}

function parseDate(raw: string | null | undefined, endOfDay: boolean): Date | null | "invalid" {
  if (!raw) return null;
  // A bare date from a date input reads as the whole of that day.
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const d = new Date(bare ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export interface RunQuery {
  workflowId: string | null;
  statuses: string[];
  severities: string[];
  recordTypes: string[];
  from: Date | null;
  to: Date | null;
  sort: "newest" | "oldest";
  take: number;
  cursor: string | null;
}

export type RunQueryResult = { ok: true; query: RunQuery } | { ok: false; error: string };

export function parseRunQuery(sp: URLSearchParams, now: Date = new Date()): RunQueryResult {
  const st = parseRunStatuses(sp.get("status"));
  if (st.invalid) return { ok: false, error: `Invalid status: ${st.invalid}` };

  const severities: string[] = [];
  for (const s of (sp.get("severity") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    if (!["CRITICAL", "MAJOR", "MINOR"].includes(s)) return { ok: false, error: `Invalid severity: ${s}` };
    if (!severities.includes(s)) severities.push(s);
  }

  const recordTypes: string[] = [];
  for (const r of (sp.get("record") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (!(RECORD_TYPES as readonly string[]).includes(r)) return { ok: false, error: `Invalid record type: ${r}` };
    if (!recordTypes.includes(r)) recordTypes.push(r);
  }

  const fromRaw = parseDate(sp.get("from"), false);
  if (fromRaw === "invalid") return { ok: false, error: "Invalid from date" };
  const toRaw = parseDate(sp.get("to"), true);
  if (toRaw === "invalid") return { ok: false, error: "Invalid to date" };
  let from = fromRaw;
  let to = toRaw;
  // An exact range supersedes ?days= when both are present.
  if (!from && !to) {
    const days = parseDays(sp.get("days"));
    if (days) from = new Date(now.getTime() - days * 86_400_000);
  }
  if (from && to && from.getTime() > to.getTime()) return { ok: false, error: "from must be before to" };

  const takeRaw = Number.parseInt(sp.get("take") ?? "", 10);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 50;
  const cursor = sp.get("cursor")?.trim() || null;

  return {
    ok: true,
    query: {
      workflowId: sp.get("workflowId")?.trim() || null,
      statuses: st.statuses,
      severities,
      recordTypes,
      from,
      to,
      sort: sp.get("sort") === "oldest" ? "oldest" : "newest",
      take,
      cursor: cursor && cursor.length <= 64 ? cursor : null,
    },
  };
}

/** The `where` for AutomationRun, always inside the viewer's workspace. */
export function runWhere(orgId: string, q: RunQuery): Record<string, unknown> {
  return {
    organizationId: orgId,
    ...(q.workflowId ? { workflowId: q.workflowId } : {}),
    ...(q.statuses.length ? { status: { in: q.statuses } } : {}),
    ...(q.severities.length ? { severity: { in: q.severities } } : {}),
    ...(q.recordTypes.length ? { recordType: { in: q.recordTypes } } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
  };
}

/** Keyset order: createdAt then id, so a page never repeats or skips a row. */
export function runOrderBy(q: RunQuery): Array<Record<string, "asc" | "desc">> {
  const dir = q.sort === "oldest" ? "asc" : "desc";
  return [{ createdAt: dir }, { id: dir }];
}

/** The record a run happened to, as a link people can follow. */
export function recordHref(recordType: string | null, recordId: string | null): string | null {
  if (!recordType || !recordId) return null;
  if (recordType === "task") return `/item/${encodeURIComponent(recordId)}`;
  if (recordType === "kudos") return "/kudos";
  if (recordType === "kpi") return "/kra-kpi";
  return null;
}
