// The acknowledgement ledger (spec-process section 2 `/policies/[id]/compliance`):
// the pure half of GET /api/policies/[id]/ledger?view=&q=&departmentId=&version=&page=.
// Views, the search rule, the pagination and the StatRow figures, so the
// route and the page cannot disagree on what "Pending" means.

import type { AckStatus } from "./policy-evidence";

export type LedgerView = "all" | "acked" | "pending" | "overdue" | "reack";
export const LEDGER_VIEWS: readonly LedgerView[] = ["all", "acked", "pending", "overdue", "reack"];
export const LEDGER_VIEW_LABEL: Record<LedgerView, string> = {
  all: "All",
  acked: "Acknowledged",
  pending: "Pending",
  overdue: "Overdue",
  reack: "Needs re-acknowledgement",
};
export function parseLedgerView(raw: string | null | undefined): LedgerView {
  return LEDGER_VIEWS.includes(raw as LedgerView) ? (raw as LedgerView) : "all";
}

export const LEDGER_STATUS_LABEL: Record<AckStatus, string> = {
  acked: "Acknowledged",
  pending: "Pending",
  overdue: "Overdue",
  "out-of-date": "Re-acknowledge",
};
/** Acknowledged success, Pending neutral, Overdue danger, Re-acknowledge warning. */
export const LEDGER_STATUS_COLOR: Record<AckStatus, string> = {
  acked: "#1F8F4E",
  pending: "#6B7280",
  overdue: "#B42318",
  "out-of-date": "#B45309",
};

export type LedgerSort = "name" | "acknowledgedAt" | "due";
export const LEDGER_SORTS: ReadonlyArray<{ key: LedgerSort; label: string }> = [
  { key: "name", label: "Name" },
  { key: "acknowledgedAt", label: "Acknowledged at" },
  { key: "due", label: "Due" },
];
export function parseLedgerSort(raw: string | null | undefined): LedgerSort | null {
  return LEDGER_SORTS.some((s) => s.key === raw) ? (raw as LedgerSort) : null;
}

export interface LedgerRowLike {
  name: string;
  email: string | null;
  department: string;
  status: AckStatus;
  versionAcked: number | null;
  acknowledgedAt: string | null;
  dueDate: string | null;
}

export interface LedgerQuery {
  view?: LedgerView;
  q?: string | null;
  /** A department NAME (the ledger carries names, not ids). */
  department?: string | null;
  version?: number | null;
  sort?: LedgerSort | null;
  dir?: "asc" | "desc";
}

export function matchesLedgerRow<T extends LedgerRowLike>(row: T, query: LedgerQuery): boolean {
  const view = query.view ?? "all";
  if (view === "acked" && row.status !== "acked") return false;
  if (view === "pending" && row.status !== "pending") return false;
  if (view === "overdue" && row.status !== "overdue") return false;
  if (view === "reack" && row.status !== "out-of-date") return false;
  if (query.department && row.department !== query.department) return false;
  if (typeof query.version === "number" && row.versionAcked !== query.version) return false;
  const q = (query.q ?? "").trim().toLowerCase();
  if (q) {
    const hay = `${row.name} ${row.email ?? ""} ${row.department}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function sortLedgerRows<T extends LedgerRowLike>(rows: T[], sort: LedgerSort | null, dir: "asc" | "desc" = "asc"): T[] {
  if (!sort) return rows;
  const mul = dir === "desc" ? -1 : 1;
  const time = (v: string | null) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => {
    if (sort === "name") return mul * a.name.localeCompare(b.name);
    if (sort === "acknowledgedAt") return mul * (time(a.acknowledgedAt) - time(b.acknowledgedAt));
    return mul * (time(a.dueDate) - time(b.dueDate));
  });
}

export function filterLedgerRows<T extends LedgerRowLike>(rows: T[], query: LedgerQuery): T[] {
  return sortLedgerRows(rows.filter((r) => matchesLedgerRow(r, query)), query.sort ?? null, query.dir ?? "asc");
}

export const LEDGER_PAGE_SIZE = 40;

export function paginate<T>(rows: T[], page: number, pageSize: number = LEDGER_PAGE_SIZE): { items: T[]; page: number; pageSize: number; total: number; totalPages: number; from: number; to: number } {
  const size = Math.max(1, Math.min(200, Math.floor(pageSize) || LEDGER_PAGE_SIZE));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.max(1, Math.min(totalPages, Math.floor(page) || 1));
  const start = (p - 1) * size;
  const items = rows.slice(start, start + size);
  return { items, page: p, pageSize: size, total, totalPages, from: total === 0 ? 0 : start + 1, to: start + items.length };
}

/** The four StatRow figures of the ledger header. */
export function ledgerStats(summary: { total: number; acked: number; overdue: number; outOfDate: number; pending: number; rate: number }) {
  return [
    { label: "Acknowledged", value: `${summary.acked} of ${summary.total}`, sub: `${summary.rate}%` },
    { label: "Pending", value: String(summary.pending) },
    { label: "Overdue", value: String(summary.overdue), sub: summary.overdue > 0 ? "overdue" : "nothing overdue", dot: summary.overdue > 0 ? ("danger" as const) : undefined },
    { label: "Needs re-acknowledgement", value: String(summary.outOfDate) },
  ];
}
