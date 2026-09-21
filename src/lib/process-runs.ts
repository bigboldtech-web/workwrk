// Run history (spec-process section 2 `/process-runs`): the three views, the
// rule for which of them a viewer may hold, the stripped-view notice line
// (section 1 "Views a viewer cannot hold", shape 2) and the run status words.
// Pure so vitest proves the notice rule.

export type RunsView = "mine" | "team" | "all";
export type RunStatus = "ACTIVE" | "COMPLETED" | "OVERDUE" | "CANCELLED";
export type RunsSort = "started" | "due" | "progress" | "sop";

export const RUNS_VIEWS: readonly RunsView[] = ["mine", "team", "all"];
export const RUNS_VIEW_LABEL: Record<RunsView, string> = { mine: "My runs", team: "Team runs", all: "All runs" };
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};
/** StatusChip colours: Active warning, Overdue danger, Completed success, Cancelled neutral. */
export const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  ACTIVE: "#B45309",
  OVERDUE: "#B42318",
  COMPLETED: "#1F8F4E",
  CANCELLED: "#6B7280",
};
export const RUNS_SORTS: ReadonlyArray<{ key: RunsSort; label: string }> = [
  { key: "started", label: "Started" },
  { key: "due", label: "Due" },
  { key: "progress", label: "Progress" },
  { key: "sop", label: "SOP" },
];

export interface RunsViewer {
  hasReports: boolean;
  peopleTeam: boolean;
  orgRole: string;
}

/** Owner, Admin and the People team hold every view; anyone with reports holds Team; everyone holds Mine. */
export function allowedRunsViews(v: RunsViewer): RunsView[] {
  const out: RunsView[] = ["mine"];
  const orgWide = v.peopleTeam || v.orgRole === "OWNER" || v.orgRole === "ADMIN";
  if (v.hasReports || orgWide) out.push("team");
  if (orgWide) out.push("all");
  return out;
}

export function isRunsView(v: unknown): v is RunsView {
  return v === "mine" || v === "team" || v === "all" || v === "own";
}

/**
 * Resolve a pasted `?view=`: unknown values fall back silently; a known value
 * the viewer cannot hold falls back to My runs with the one notice line.
 * "own" is the API's older word for "mine" and is accepted as an alias.
 */
export function resolveRunsView(raw: string | null | undefined, viewer: RunsViewer): { view: RunsView; notice: string | null; strip: boolean } {
  const requested: RunsView | null = raw === "own" ? "mine" : raw === "mine" || raw === "team" || raw === "all" ? raw : null;
  if (!requested) return { view: "mine", notice: null, strip: !!raw };
  const allowed = allowedRunsViews(viewer);
  if (allowed.includes(requested)) return { view: requested, notice: null, strip: false };
  return {
    view: "mine",
    notice: requested === "team" ? "Team runs is for people who have reports." : "All runs is for the People team and admins.",
    strip: true,
  };
}

/** The "4 active · 1 overdue · 27 completed" line. */
export function runsSummaryLine(counts: Partial<Record<RunStatus, number>>): string {
  const parts: string[] = [];
  parts.push(`${counts.ACTIVE ?? 0} active`);
  parts.push(`${counts.OVERDUE ?? 0} overdue`);
  parts.push(`${counts.COMPLETED ?? 0} completed`);
  return parts.join(" · ");
}

export function parseRunsSort(raw: string | null | undefined): RunsSort {
  return RUNS_SORTS.some((s) => s.key === raw) ? (raw as RunsSort) : "started";
}

export function isRunStatus(v: unknown): v is RunStatus {
  return v === "ACTIVE" || v === "COMPLETED" || v === "OVERDUE" || v === "CANCELLED";
}

/** A run past its due date and not finished reads as Overdue whatever the stored status says. */
export function effectiveRunStatus(status: string, dueDate: string | Date | null | undefined, now: Date = new Date()): RunStatus {
  if (status === "COMPLETED" || status === "CANCELLED") return status;
  if (dueDate) {
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) return "OVERDUE";
  }
  return status === "OVERDUE" ? "OVERDUE" : "ACTIVE";
}
