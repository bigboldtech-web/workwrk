// The KPI reviews page's device drafts: what a manager typed and has not
// saved, kept in localStorage under workwrk:kpi-review-draft:{person}:{period}
// (the key the old /kra-kpi/review page used, so nothing typed there is
// lost). Pure apart from the storage handed in, so the rules are testable.
//
// Browser Back cannot be stopped in the App Router, so a manager who typed a
// number and pressed Back leaves the page without the in-app question. The
// numbers stay here, and the page finds them again on return
// (`storedDraftsFor`) instead of opening whoever is first in the list.

export type KpiDraft = { actual?: string; notes?: string };
export type KpiDraftMap = Record<string, KpiDraft>;

export const KPI_DRAFT_NS = "workwrk:kpi-review-draft";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function store(s?: Store | null): Store | null {
  if (s) return s;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function kpiDraftKey(userId: string, period: string): string {
  return `${KPI_DRAFT_NS}:${userId}:${period}`;
}

/** True when a row holds something a save would send: a number or a note. */
export function draftRowHasContent(d: KpiDraft | undefined): boolean {
  if (!d) return false;
  const actual = (d.actual ?? "").trim();
  return (actual !== "" && Number.isFinite(Number(actual))) || (d.notes ?? "").trim() !== "";
}

export function draftHasContent(d: KpiDraftMap): boolean {
  return Object.values(d).some(draftRowHasContent);
}

export function loadKpiDraft(userId: string, period: string, s?: Store | null): KpiDraftMap {
  try {
    const raw = store(s)?.getItem(kpiDraftKey(userId, period));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as KpiDraftMap) : {};
  } catch {
    return {};
  }
}

export function persistKpiDraft(userId: string, period: string, d: KpiDraftMap, s?: Store | null): void {
  try {
    const st = store(s);
    if (!st) return;
    if (Object.keys(d).length === 0) st.removeItem(kpiDraftKey(userId, period));
    else st.setItem(kpiDraftKey(userId, period), JSON.stringify(d));
  } catch {
    /* private mode: the page still works, only the mirror is off */
  }
}

/**
 * Every stored draft with something in it, for the people this page lists
 * (`allowed`, the viewer's own reach, so a draft about anyone else is never
 * named) and the months that still take numbers (`periodOk`). Newest month
 * first, then in the order `allowed` gives, so the result is stable.
 */
export function storedDraftsFor(
  allowed: readonly string[],
  periodOk: (period: string) => boolean,
  s?: Store | null,
  /** Whether a stored draft can still be saved at all (the page knows the
   *  person's rows); one that cannot is never named or opened first. */
  isLive?: (userId: string, period: string, draft: KpiDraftMap) => boolean,
): Array<{ userId: string; period: string }> {
  const st = store(s);
  if (!st) return [];
  const order = new Map(allowed.map((id, i) => [id, i]));
  const out: Array<{ userId: string; period: string }> = [];
  try {
    for (let i = 0; i < st.length; i++) {
      const key = st.key(i);
      if (!key || !key.startsWith(`${KPI_DRAFT_NS}:`)) continue;
      const rest = key.slice(KPI_DRAFT_NS.length + 1);
      const cut = rest.lastIndexOf(":");
      if (cut <= 0) continue;
      const userId = rest.slice(0, cut);
      const period = rest.slice(cut + 1);
      if (!order.has(userId) || !periodOk(period)) continue;
      const draft = loadKpiDraft(userId, period, st);
      if (!draftHasContent(draft)) continue;
      if (isLive && !isLive(userId, period, draft)) continue;
      out.push({ userId, period });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.period.localeCompare(a.period) || (order.get(a.userId)! - order.get(b.userId)!));
}

/** What a draft holds: a number to record, a note, or both. */
export function draftKinds(d: KpiDraftMap): { number: boolean; note: boolean } {
  let number = false;
  let note = false;
  for (const row of Object.values(d)) {
    const actual = (row.actual ?? "").trim();
    if (actual !== "" && Number.isFinite(Number(actual))) number = true;
    if ((row.notes ?? "").trim() !== "") note = true;
  }
  return { number, note };
}

/**
 * Whether a person's stored draft can still save, from that month's counts
 * alone (the summary row, before their rows are loaded). A number needs a
 * KPI that is neither submitted nor approved; a note also fits a submitted
 * one. A manager whose report submitted or had everything approved since
 * they typed is not told about numbers that can never be saved.
 */
export function draftLiveForCounts(d: KpiDraftMap, c: { total: number; submitted: number; approved: number }): boolean {
  const k = draftKinds(d);
  const canNumber = c.total - c.submitted - c.approved > 0;
  const canNote = canNumber || c.submitted > 0;
  return (k.number && canNumber) || (k.note && canNote);
}

export type DraftRowFit = "number" | "note" | "none";

/**
 * The part of a draft that can still save, once the person's rows are
 * known: a row that takes a number keeps all of it, a submitted row keeps
 * only its note, and a row that takes nothing (approved, or a KPI no longer
 * assigned) is dropped. Returns the same object when nothing changes, so a
 * caller can skip the write.
 */
export function pruneKpiDraft(d: KpiDraftMap, fit: (kpiId: string) => DraftRowFit): KpiDraftMap {
  let changed = false;
  const out: KpiDraftMap = {};
  for (const [kpiId, row] of Object.entries(d)) {
    const f = fit(kpiId);
    if (f === "number") { out[kpiId] = row; continue; }
    if (f === "note" && (row.notes ?? "").trim() !== "") {
      if (row.actual !== undefined && row.actual !== "") changed = true;
      out[kpiId] = { notes: row.notes };
      continue;
    }
    changed = true;
  }
  return changed ? out : d;
}
