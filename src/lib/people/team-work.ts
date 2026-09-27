// My team (spec-teams-people /team): the pure half of GET
// /api/team/members-work and GET /api/team/attention, so the counting rule,
// the sort and the attention sentences are unit tested and the page, the
// queue card and the sidebar badge read one definition.
//
// COUNTING. An item counts for EVERY person on it: its owner (the primary
// assignee) and each of its assigneeIds, once per person. Open, done and
// overdue come from the item's OWN List status set (the caller passes the
// done test per List), never a name regex: a List whose "Shipped" status is
// its done state counts it as done, and one whose "Done?" is a question
// stays open. Overdue is an open item whose due date has passed. Done this
// week is a done item last changed since the week began (Item has no
// completedAt, so the last change is the nearest honest signal).
//
// Pure: no imports. Client safe.

/** One aggregated SQL row: items of one person, on one List, in one status. */
export interface WorkGroupRow {
  personId: string;
  boardId: string;
  status: string | null;
  /** Items in the group. */
  n: number;
  /** Of those, with a due date before now. */
  overdue: number;
  /** Of those, changed since the start of the week. */
  recent: number;
}

export interface PersonWork {
  open: number;
  done: number;
  doneThisWeek: number;
  overdue: number;
}

export const NO_WORK: Readonly<PersonWork> = { open: 0, done: 0, doneThisWeek: 0, overdue: 0 };

export function aggregateWork(
  rows: readonly WorkGroupRow[],
  isDone: (boardId: string, status: string | null) => boolean,
): Map<string, PersonWork> {
  const out = new Map<string, PersonWork>();
  for (const r of rows) {
    let w = out.get(r.personId);
    if (!w) { w = { ...NO_WORK }; out.set(r.personId, w); }
    if (isDone(r.boardId, r.status)) {
      w.done += r.n;
      w.doneThisWeek += r.recent;
    } else {
      w.open += r.n;
      w.overdue += r.overdue;
    }
  }
  return out;
}

export type TeamSort = "name" | "open" | "overdue" | "active";
export const TEAM_SORTS: readonly TeamSort[] = ["name", "open", "overdue", "active"];

export function parseTeamSort(v: string | null | undefined): TeamSort {
  return v === "open" || v === "overdue" || v === "active" ? v : "name";
}

export interface SortablePerson {
  id: string;
  name: string;
  work: PersonWork;
  /** Epoch ms of the person's last activity, or null. */
  lastActive: number | null;
}

/**
 * The four sorts. Ties always fall back to the name and then the id, so a
 * page boundary never moves between two requests and nobody is shown twice
 * or skipped when the viewer pages through.
 */
export function sortTeam<T extends SortablePerson>(people: readonly T[], sort: TeamSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const list = [...people];
  list.sort((a, b) => {
    if (sort === "open") return b.work.open - a.work.open || byName(a, b);
    if (sort === "overdue") return b.work.overdue - a.work.overdue || b.work.open - a.work.open || byName(a, b);
    if (sort === "active") {
      const la = a.lastActive ?? -1;
      const lb = b.lastActive ?? -1;
      return lb - la || byName(a, b);
    }
    return byName(a, b);
  });
  return list;
}

export interface AttentionCounts {
  weeklyReviews: number;
  kpiRecords: number;
  noKras: number;
}

export interface AttentionRow {
  key: "weekly" | "kpi" | "nokras";
  count: number;
  /** The words after the bold count. */
  sentence: string;
  href: string;
}

/**
 * The Needs your attention card's rows, zero rows dropped. An empty result
 * means the card is not rendered at all (the absence is the message).
 * `chainWide` is true when the weekly count covers more than direct
 * reports, so the link opens the queue on its chain scope and the number
 * the viewer clicked is the number they land on.
 */
export function attentionRows(c: AttentionCounts, opts: { chainWide?: boolean } = {}): AttentionRow[] {
  const rows: AttentionRow[] = [];
  if (c.weeklyReviews > 0) {
    rows.push({
      key: "weekly",
      count: c.weeklyReviews,
      sentence: `${c.weeklyReviews === 1 ? "weekly review" : "weekly reviews"} awaiting your approval`,
      href: opts.chainWide ? "/team/reviews?scope=chain" : "/team/reviews",
    });
  }
  if (c.kpiRecords > 0) {
    rows.push({
      key: "kpi",
      count: c.kpiRecords,
      sentence: `${c.kpiRecords === 1 ? "KPI record" : "KPI records"} to sign off`,
      href: "/team/kpi-reviews",
    });
  }
  if (c.noKras > 0) {
    rows.push({
      key: "nokras",
      count: c.noKras,
      sentence: `${c.noKras === 1 ? "person has" : "people have"} no KRAs yet`,
      href: "/team?view=needs-attention&noKras=1",
    });
  }
  return rows;
}

/** Monday 00:00 local of the week holding `d` (the week My team counts in). */
export function weekStartLocal(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
