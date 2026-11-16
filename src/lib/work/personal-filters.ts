// Each person's own filter on a shared List view.
//
// Founder report 2026-11-10: a filter one person set was saved on the view,
// so it hid a List's tasks from the whole team, and the team read them as
// gone. A view's own config.filters is now the filter everyone starts from,
// changed only by "Save for everyone"; what a person picks after that is
// theirs, in UserPreference.home.work.viewOverrides[viewId].filters, the
// per-viewer override of a shared view the preferences schema already names.
// null there means "the view's own filter".
//
// The boot payload is read once per page load and never refreshed, so what
// this tab wrote is kept here as well: a List opened again without a reload
// would otherwise show the filter from before.
//
// Pure apart from that cache: no React, no fetch.

const writtenHere = new Map<string, unknown>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** This person's own filter for a view, or null when they use the view's. */
export function personalFiltersRaw(prefs: unknown, viewId: string): Record<string, unknown> | null {
  const raw = writtenHere.has(viewId)
    ? writtenHere.get(viewId)
    : (() => {
        const home = isRecord(prefs) ? prefs.home : undefined;
        const work = isRecord(home) ? home.work : undefined;
        const overrides = isRecord(work) ? work.viewOverrides : undefined;
        const mine = isRecord(overrides) ? overrides[viewId] : undefined;
        return isRecord(mine) ? mine.filters : undefined;
      })();
  return isRecord(raw) ? raw : null;
}

/** Remember what this tab saved, so a later read in it agrees. */
export function rememberPersonalFilters(viewId: string, raw: Record<string, unknown> | null): void {
  writtenHere.set(viewId, raw);
}

/** The PATCH /api/preferences body that sets, or with null clears, one view's own filter. */
export function personalFiltersPatch(viewId: string, raw: Record<string, unknown> | null) {
  return { home: { work: { viewOverrides: { [viewId]: { filters: raw } } } } };
}

/** For tests: forget what this tab wrote. */
export function forgetPersonalFilters(): void {
  writtenHere.clear();
}
