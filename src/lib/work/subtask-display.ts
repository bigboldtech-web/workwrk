// How a Board view shows subtasks, per person.
//
// Founder report 2026-11-27: "sub task not visible on top of board". The
// Board drew a card's "N subtasks" as plain text and offered no Subtasks
// control at the top, so the only way to see a subtask was to open its
// parent. The Board now has the List view's "Subtasks" control:
//
//   collapsed (default)  each card shows its count; clicking it opens that
//                        card's subtasks in place
//   expanded             every card shows its subtasks in place
//   separate             each subtask is a card of its own in the column of
//                        its own status, under its parent's name
//
// It is a way of looking, not a change to the view, so it is each person's
// own: UserPreference.home.work.viewOverrides[viewId].subtasks, next to their
// own filter (personal-filters.ts). The boot payload is read once per page
// load, so what this tab wrote is kept here too.
//
// Pure apart from that cache: no React, no fetch.

export type SubtaskDisplay = "collapsed" | "expanded" | "separate";

export const SUBTASK_DISPLAYS: readonly SubtaskDisplay[] = ["collapsed", "expanded", "separate"];

const writtenHere = new Map<string, SubtaskDisplay>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export function isSubtaskDisplay(v: unknown): v is SubtaskDisplay {
  return typeof v === "string" && (SUBTASK_DISPLAYS as readonly string[]).includes(v);
}

/** This person's choice for a view; collapsed when they have made none. */
export function subtaskDisplayFor(prefs: unknown, viewId: string | null): SubtaskDisplay {
  if (!viewId) return "collapsed";
  const here = writtenHere.get(viewId);
  if (here) return here;
  const home = isRecord(prefs) ? prefs.home : undefined;
  const work = isRecord(home) ? home.work : undefined;
  const overrides = isRecord(work) ? work.viewOverrides : undefined;
  const mine = isRecord(overrides) ? overrides[viewId] : undefined;
  const raw = isRecord(mine) ? mine.subtasks : undefined;
  return isSubtaskDisplay(raw) ? raw : "collapsed";
}

/** Remember what this tab saved, so a later read in it agrees. */
export function rememberSubtaskDisplay(viewId: string, display: SubtaskDisplay): void {
  writtenHere.set(viewId, display);
}

/** The PATCH /api/preferences body for one view's choice. */
export function subtaskDisplayPatch(viewId: string, display: SubtaskDisplay) {
  return { home: { work: { viewOverrides: { [viewId]: { subtasks: display } } } } };
}

/**
 * Is this card's subtask list open? `flipped` holds the cards whose count was
 * clicked since the display was last picked: open under "collapsed", closed
 * under "expanded". Under "separate" the subtasks are cards of their own, so
 * a card opens its list only when its count is clicked.
 */
export function cardSubtasksOpen(display: SubtaskDisplay, flipped: ReadonlySet<string>, cardId: string): boolean {
  return (display === "expanded") !== flipped.has(cardId);
}

/** For tests: forget what this tab wrote. */
export function forgetSubtaskDisplays(): void {
  writtenHere.clear();
}
