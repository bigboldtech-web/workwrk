// The /everything URL contract's one fallback table.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/everything):
// "`view=team` is accepted and resolves to `view=list&group=assignee` (that is
// what the old Space "team" view showed). An unknown value falls back to
// `list` rather than erroring."
//
// `gantt` and `timeline` are REAL views here now. The spec first folded
// `gantt` into `list` on the grounds that a Gantt is a List view; the founder's
// review of that release named the personal, cross-List Gantt as a lost
// capability, and /my-work and /everything both draw it now through the List
// page's own renderer over the same Item rows (lib/my-work.ts toBoardRows).
//
// It lives here, pure and tested, because spec-spaces-lists section 0 sends
// five Space-wide and Folder-wide views to this page with a 308. If this table
// is wrong those five redirects land on nothing.

import type { WorkGroupKey } from "./my-work";

export type EverythingViewKey = "list" | "board" | "calendar" | "gantt" | "timeline";

export interface ResolvedEverythingView {
  view: EverythingViewKey;
  /** A group the view name implies, or null to leave the current one alone. */
  group: WorkGroupKey | null;
}

export function resolveEverythingView(raw: string | null | undefined): ResolvedEverythingView {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "board":
      return { view: "board", group: null };
    case "calendar":
      return { view: "calendar", group: null };
    case "team":
      return { view: "list", group: "assignee" };
    case "gantt":
      return { view: "gantt", group: null };
    case "timeline":
      return { view: "timeline", group: null };
    case "list":
    default:
      return { view: "list", group: null };
  }
}
