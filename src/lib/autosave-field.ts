// The autosave state machine behind the task description.
//
// WHY IT IS A MODULE AND NOT TWELVE LINES IN THE COMPONENT. The bug it exists
// for destroyed user content, and the project's first rule is that a change to
// a write path is covered by a test that proves the old data survives. The
// component cannot be tested here (vitest runs in node, there is no DOM), so
// the rule lives out here where it can be.
//
// WHAT WENT WRONG. The description field called onSave(value) and then, in the
// same tick, marked itself clean and deleted its localStorage draft - before
// the PATCH had answered. When the PATCH failed, use-task's patch() set
// saveStatus "error" and re-read the task, which brought back the server's OLD
// description; the field was already "clean", so its render-phase sync
// happily overwrote the person's words with it. The text was then gone from
// the box, gone from the draft store and never in the database, while the
// indicator said "Not saved, retrying" and nothing retried.
//
// THE RULE. A save is finished when the SERVER's value comes back equal to
// what was sent, and not one moment earlier. Until then the field stays dirty,
// keeps its words, keeps its draft, and the server's value is not allowed to
// replace them. The only thing that ever overwrites local text is a server
// value arriving while nothing is unconfirmed.
//
// Pure module: no imports, no React, no clock.

export interface AutosaveState {
  /** What the person can see in the box. */
  local: string;
  /** The server value this state was last reconciled against. */
  synced: string;
  /** True while `local` holds words the server has not confirmed. */
  dirty: boolean;
  /** The exact string handed to the server, until it is confirmed. */
  sent: string | null;
  /** Save attempts made for the current `local`. Reset by new typing. */
  attempt: number;
}

export function initAutosave(stored: string): AutosaveState {
  return { local: stored, synced: stored, dirty: false, sent: null, attempt: 0 };
}

/** A keystroke. New words are a new save, not another try at the last one. */
export function onTyped(state: AutosaveState, value: string): AutosaveState {
  return { ...state, local: value, dirty: true, attempt: 0 };
}

/** The field handed `value` to the server. Nothing is cleared. */
export function onSent(state: AutosaveState, value: string): AutosaveState {
  return { ...state, sent: value, attempt: state.attempt + 1 };
}

/**
 * A server value arrived (first load, a realtime refresh, a poll, or the
 * re-read that follows a failed save).
 *
 * Three cases, in this order:
 *   1. it equals what we sent  → the save landed; the field is clean;
 *   2. nothing is unconfirmed  → follow the server, which is how another
 *                                person's edit reaches this tab;
 *   3. otherwise               → KEEP THE LOCAL WORDS. This is the clause the
 *                                whole module is for.
 */
export function onServerValue(state: AutosaveState, stored: string): AutosaveState {
  if (state.sent !== null && state.sent === stored) {
    return { local: stored, synced: stored, dirty: false, sent: null, attempt: 0 };
  }
  if (!state.dirty && state.synced !== stored) {
    return { ...state, local: stored, synced: stored };
  }
  return state;
}

/** Is there anything worth sending? A no-op save is not a save. */
export function shouldCommit(state: AutosaveState, value: string, stored: string): boolean {
  return state.dirty && value !== stored;
}

/**
 * How long to wait before the next attempt, or null when the field should
 * stop trying.
 *
 * Bounded on purpose: retrying a 403 forever is a busy loop, not a recovery.
 * When it stops, the words are still in the box and still in the draft store,
 * which is a state the person can act on.
 */
export function retryDelayMs(attempt: number, maxAttempts = 4, baseMs = 2000): number | null {
  if (attempt >= maxAttempts) return null;
  if (attempt <= 0) return baseMs;
  return Math.min(30_000, baseMs * 2 ** attempt);
}

/**
 * What belongs in the localStorage draft right now.
 *
 * An empty string means "delete the key": a clean field has no draft, and
 * pinning a stored "" would make the box blank itself (the `draft ?? local`
 * trap the hosts already guard against).
 */
export function draftValue(state: AutosaveState): string {
  return state.dirty ? state.local : "";
}
