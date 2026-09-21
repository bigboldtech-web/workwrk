// /policies (spec-process section 2): the pure half of the list page and
// its API. Views, the "views a viewer cannot hold" resolution (section 1,
// shape 2: the page renders All, strips the parameter and shows one notice
// line, never a 404), sorts, status words and colours. No imports, so the
// API route and the page share it and vitest proves it in node.

export type PolicyStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/** Pale StatusChip tints: Draft neutral, Published success, Archived neutral. */
export const POLICY_STATUS_COLOR: Record<PolicyStatus, string> = {
  DRAFT: "#6B7280",
  PUBLISHED: "#1F8F4E",
  ARCHIVED: "#6B7280",
};

export type PoliciesView = "all" | "needs-ack" | "published" | "drafts" | "archived";
export const POLICIES_VIEWS: readonly PoliciesView[] = ["all", "needs-ack", "published", "drafts", "archived"];
export const POLICIES_VIEW_LABEL: Record<PoliciesView, string> = {
  all: "All",
  "needs-ack": "Needs my acknowledgement",
  published: "Published",
  drafts: "Drafts",
  archived: "Archived",
};

/** The two views that show unpublished rows belong to FULL viewers only. */
export const FULL_ONLY_VIEWS: readonly PoliciesView[] = ["drafts", "archived"];

export function allowedPolicyViews(canManage: boolean): PoliciesView[] {
  return canManage ? [...POLICIES_VIEWS] : POLICIES_VIEWS.filter((v) => !FULL_ONLY_VIEWS.includes(v));
}

export const POLICY_VIEW_NOTICE = "Drafts and archived policies are for the People team and admins.";

/**
 * Shape 2 of the denial convention: a known view the viewer cannot hold
 * renders All with the parameter stripped and one notice; an unknown value
 * falls back to All silently (stripped, no notice).
 */
export function resolvePolicyView(raw: string | null | undefined, canManage: boolean): { view: PoliciesView; strip: boolean; notice: string | null } {
  if (!raw) return { view: "all", strip: false, notice: null };
  const known = POLICIES_VIEWS.includes(raw as PoliciesView) ? (raw as PoliciesView) : null;
  if (!known) return { view: "all", strip: true, notice: null };
  if (allowedPolicyViews(canManage).includes(known)) return { view: known, strip: false, notice: null };
  return { view: "all", strip: true, notice: POLICY_VIEW_NOTICE };
}

export type PoliciesSort = "updated" | "name" | "effective";
export const POLICIES_SORTS: ReadonlyArray<{ key: PoliciesSort; label: string }> = [
  { key: "updated", label: "Updated" },
  { key: "name", label: "Name" },
  { key: "effective", label: "Effective date" },
];
export function parsePoliciesSort(raw: string | null | undefined): PoliciesSort {
  return POLICIES_SORTS.some((s) => s.key === raw) ? (raw as PoliciesSort) : "updated";
}
export function defaultSortDir(sort: PoliciesSort): "asc" | "desc" {
  return sort === "name" ? "asc" : "desc";
}

export type PoliciesGroup = "category" | "none";
export function parsePoliciesGroup(raw: string | null | undefined): PoliciesGroup {
  return raw === "none" ? "none" : "category";
}

/** What the API's `where.status` becomes for a view, given who is asking. */
export function statusesForView(view: PoliciesView, canManage: boolean): PolicyStatus[] {
  switch (view) {
    case "published":
    case "needs-ack":
      return ["PUBLISHED"];
    case "drafts":
      return canManage ? ["DRAFT"] : ["PUBLISHED"];
    case "archived":
      return canManage ? ["ARCHIVED"] : ["PUBLISHED"];
    default:
      return canManage ? ["DRAFT", "PUBLISHED", "ARCHIVED"] : ["PUBLISHED"];
  }
}

export interface PolicyAckFacts {
  requiresAck: boolean;
  status: PolicyStatus;
  /** The viewer holds an assignment (open or completed). */
  assigned: boolean;
  /** The viewer's acknowledgement is at or beyond ackVersion. */
  acknowledged: boolean;
  /**
   * The policy names an audience (at least one assignment row exists). When
   * it does, only the named people owe an acknowledgement; when it does not,
   * everyone at the org does. Omitted = treated as everyone (older callers).
   */
  hasAudience?: boolean;
}

/** Whether the viewer is one of the people this policy is for. */
export function inPolicyAudience(f: Pick<PolicyAckFacts, "assigned" | "hasAudience">): boolean {
  return f.assigned || !f.hasAudience;
}

/**
 * The "My acknowledgement" column: two quad-steps (Assigned then
 * Acknowledged) when it is required of the viewer, or "Not required".
 */
export function myAckState(f: PolicyAckFacts): { required: false } | { required: true; done: 0 | 1 | 2 } {
  if (!f.requiresAck || f.status !== "PUBLISHED" || !inPolicyAudience(f)) return { required: false };
  if (f.acknowledged) return { required: true, done: 2 };
  if (f.assigned) return { required: true, done: 1 };
  return { required: true, done: 0 };
}

/**
 * The viewer still owes an acknowledgement. ONE definition for the Needs my
 * acknowledgement view, its pill count and the sidebar badge (boot
 * `counts.policiesToAck` computes the same facts), so the two numbers on
 * screen cannot disagree.
 */
export function needsMyAck(f: PolicyAckFacts): boolean {
  return f.requiresAck && f.status === "PUBLISHED" && inPolicyAudience(f) && !f.acknowledged;
}
