// The Workflows list's query vocabulary (spec-ai-automation
// /automation/workflows): the five status views, the four sorts, the filter
// set, and offset paging with a real total. Pure, so the API route and the
// tests agree. The list is per workspace and small (tens to hundreds of
// automations), so it is filtered and sorted in memory after one bounded
// read, which is what lets "Success rate" and "Where it runs" sort and
// filter at all (neither is a column).

import { readScope, type AutomationScope } from "./definition";

export const WORKFLOW_VIEWS = ["all", "active", "drafts", "paused", "errors"] as const;
export type WorkflowView = (typeof WORKFLOW_VIEWS)[number];

export const VIEW_STATUS: Record<WorkflowView, string | null> = {
  all: null,
  active: "ACTIVE",
  drafts: "DRAFT",
  paused: "INACTIVE",
  errors: "ERROR",
};

export const VIEW_LABEL: Record<WorkflowView, string> = {
  all: "All",
  active: "Active",
  drafts: "Drafts",
  paused: "Paused",
  errors: "Errors",
};

export const WORKFLOW_SORTS = ["updated", "name", "lastRun", "success"] as const;
export type WorkflowSort = (typeof WORKFLOW_SORTS)[number];

export const SORT_LABEL: Record<WorkflowSort, string> = {
  updated: "Last updated",
  name: "Name",
  lastRun: "Last run",
  success: "Success rate",
};

export const ALERT_LEVELS = ["CRITICAL", "MAJOR", "MINOR"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];
export const ALERT_LABEL: Record<AlertLevel, string> = { CRITICAL: "Critical", MAJOR: "Major", MINOR: "Minor" };

/** The status words and pale chip tones for a workflow (not a run). */
export const WORKFLOW_STATUS_VIEW: Record<string, { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  ACTIVE: { label: "Active", tone: "success" },
  DRAFT: { label: "Draft", tone: "neutral" },
  INACTIVE: { label: "Paused", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export function parseView(raw: string | null | undefined): WorkflowView {
  return (WORKFLOW_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as WorkflowView) : "all";
}

export function parseSort(raw: string | null | undefined): WorkflowSort {
  return (WORKFLOW_SORTS as readonly string[]).includes(raw ?? "") ? (raw as WorkflowSort) : "updated";
}

export interface ListRow {
  id: string;
  name: string;
  status: string;
  severity: string;
  triggerEvent: string | null;
  createdById: string | null;
  updatedAt: string | Date;
  lastRunAt: string | Date | null;
  successRate: number | null;
  definition: unknown;
}

export interface ListFilters {
  view: WorkflowView;
  showArchived: boolean;
  q?: string | null;
  createdBy?: string[];
  triggers?: string[];
  severities?: string[];
  /** "everywhere" or place ids (a List, Folder or Space), any of which matches. */
  where?: string[];
  /** The container a Space, Folder or List "..." menu arrived with. */
  container?: { kind: "list" | "folder" | "space"; id: string; listIds?: string[]; folderIds?: string[] } | null;
}

/** Does this workflow's scope touch the container (or anything inside it)? */
export function scopeTouches(scope: AutomationScope, c: NonNullable<ListFilters["container"]>): boolean {
  if (c.kind === "list") return scope.listIds.includes(c.id);
  if (c.kind === "folder") {
    return scope.folderIds.includes(c.id) || (c.listIds ?? []).some((id) => scope.listIds.includes(id));
  }
  return (
    scope.spaceIds.includes(c.id) ||
    (c.folderIds ?? []).some((id) => scope.folderIds.includes(id)) ||
    (c.listIds ?? []).some((id) => scope.listIds.includes(id))
  );
}

export function filterWorkflows<T extends ListRow>(rows: T[], f: ListFilters): T[] {
  const status = VIEW_STATUS[f.view];
  const q = f.q?.trim().toLowerCase() ?? "";
  return rows.filter((w) => {
    if (status) {
      if (w.status !== status) return false;
    } else if (!f.showArchived && w.status === "ARCHIVED") {
      return false;
    }
    if (q && !w.name.toLowerCase().includes(q)) return false;
    if (f.createdBy?.length && !(w.createdById && f.createdBy.includes(w.createdById))) return false;
    if (f.triggers?.length && !(w.triggerEvent && f.triggers.includes(w.triggerEvent))) return false;
    if (f.severities?.length && !f.severities.includes(w.severity)) return false;
    const scope = readScope(w.definition);
    if (f.where?.length) {
      const everywhere = scope.listIds.length + scope.folderIds.length + scope.spaceIds.length === 0;
      const hit = f.where.some((id) =>
        id === "everywhere"
          ? everywhere
          : scope.listIds.includes(id) || scope.folderIds.includes(id) || scope.spaceIds.includes(id),
      );
      if (!hit) return false;
    }
    if (f.container && !scopeTouches(scope, f.container)) return false;
    return true;
  });
}

function time(v: string | Date | null): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Sorts a copy. Ties break on name, then id, so paging is stable. */
export function sortWorkflows<T extends ListRow>(rows: T[], sort: WorkflowSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case "name":
        return byName(a, b);
      case "lastRun":
        return time(b.lastRunAt) - time(a.lastRunAt) || byName(a, b);
      case "success": {
        // A workflow with no runs has no rate: it sorts after every real rate.
        const ra = a.successRate ?? -1;
        const rb = b.successRate ?? -1;
        return rb - ra || byName(a, b);
      }
      default:
        return time(b.updatedAt) - time(a.updatedAt) || byName(a, b);
    }
  });
  return out;
}

export const MAX_TAKE = 100;
export const DEFAULT_TAKE = 40;

export function parseTake(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_TAKE) : DEFAULT_TAKE;
}

/** Offset cursor: the index of the first row of the page. Junk reads as 0. */
export function parseOffsetCursor(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function pageOf<T>(rows: T[], offset: number, take: number): { page: T[]; total: number; nextCursor: string | null; offset: number } {
  // A cursor past the end (rows archived since the link was made) lands on
  // the last real page instead of an empty one.
  const safe = offset < rows.length ? offset : rows.length === 0 ? 0 : Math.floor((rows.length - 1) / take) * take;
  const page = rows.slice(safe, safe + take);
  const next = safe + take < rows.length ? String(safe + take) : null;
  return { page, total: rows.length, nextCursor: next, offset: safe };
}
