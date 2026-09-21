// autosave-guard.ts: the one rule that decides whether a pending autosave is
// allowed to reach the server.
//
// WHY THIS EXISTS, and it is a data-integrity fix, not a tidy-up.
// `useAutosave` flushes on unmount, and its flush effect's cleanup also runs
// whenever the `flush` callback's identity changes (it is keyed on `localKey`,
// which goes from undefined to a real key the moment the edited row loads).
// The flush itself compared only "current snapshot" against "last saved
// snapshot", and the last-saved baseline is null until the editor has
// hydrated. Null is not equal to anything, so that cleanup fired a real PATCH
// carrying the component's INITIAL state: an empty title, an empty
// description, empty content. On a slow first load, or under React's
// development double-invoke, that PATCH could land after the row was created
// and write blanks over content the person never touched.
//
// So the flush now asks this function first. Two conditions, both necessary:
//
//   enabled   the editor is in edit mode. A disabled autosave never writes,
//             including on the unmount of a page a person only read.
//   baseline  a clean baseline has been captured, which only happens after
//             the first snapshot taken while enabled, i.e. after hydration.
//             Until then there is nothing to diff against and any write would
//             be a guess.
//
// And one more: nothing to say. When the current snapshot equals the baseline
// the save is skipped, which is the original behaviour and stays here so the
// whole decision reads in one place.
//
// Pure: no React, no network. Every branch below is unit-tested.

export interface FlushDecision {
  /** Whether autosave is switched on (the editor is in edit mode). */
  enabled: boolean;
  /** The last successfully saved snapshot, serialized. Null until hydrated. */
  baseline: string | null;
  /** The snapshot that would be written, serialized. */
  current: string;
}

/**
 * Whether a pending autosave should reach the server.
 *
 * Returns false when autosave is off, when no baseline exists yet (the editor
 * has not hydrated, so the snapshot is the component's blank initial state)
 * and when nothing has changed since the last save.
 */
export function shouldFlush({ enabled, baseline, current }: FlushDecision): boolean {
  if (!enabled) return false;
  if (baseline === null) return false;
  return current !== baseline;
}
