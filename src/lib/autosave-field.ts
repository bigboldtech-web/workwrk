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
// Pure module: no React, no clock; its one import (the text merge) is pure too.
//
// TWO PEOPLE AT ONCE (pen test 2026-11-28, V-33). A save carries the server
// text it was typed over; when somebody saved in between, the server merges
// the two and answers with the merged text, which is not what was sent. The
// field then takes the merged text as saved (onSaved), or, when the person
// kept typing meanwhile, carries what they typed since onto it.

import { mergeText } from "./text-merge";

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

/**
 * The server answered a save of `sent` with the text it stored, `saved`: the
 * same when nobody else wrote, a merge when somebody did. Untouched since the
 * send, the field takes `saved` and is clean; typed on since, it keeps what
 * was typed, carried onto `saved`, and saves that next. An answer to an older
 * send (a newer one is out) changes nothing.
 */
export function onSaved(state: AutosaveState, sent: string, saved: string): AutosaveState {
  if (state.sent !== sent) return state;
  if (state.local === sent) return { local: saved, synced: saved, dirty: false, sent: null, attempt: 0 };
  const carried = mergeText(sent, state.local, saved);
  // Nothing typed since is missing from the saved text: clean, or the field
  // would sit dirty with nothing to send and stop following the server.
  if (carried === saved) return { local: saved, synced: saved, dirty: false, sent: null, attempt: 0 };
  return { local: carried, synced: saved, dirty: true, sent: null, attempt: 0 };
}

/** The description a task write's answer says is stored, or null when the answer carries none. */
export function savedDescriptionOf(answer: unknown): string | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as { ok?: unknown; payload?: { item?: { metadata?: unknown } } };
  if (a.ok !== true) return null;
  const metadata = a.payload?.item?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const d = (metadata as { description?: unknown }).description;
  // A key the answer leaves out says nothing (a lean row must never empty the box).
  return typeof d === "string" ? d : d === null ? "" : null;
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

/**
 * ONE DESCRIPTION SAVE AT A TIME (the final review of pen test 2026-11-28).
 *
 * A save carries the text it was typed over (its base), and the server merges
 * when the stored text has moved past that base (V-33). Two saves of the SAME
 * person in flight at once (an autosave still out when they press Esc, or a
 * retry) both carried the old base, so the server took the first as somebody
 * else's and stored the edited line twice. The queue sends one save at a time:
 * a commit while one is out waits, and goes when the answer comes, typed over
 * the text the server answered with, with what was typed since carried onto
 * it (mergeText), even after the field has unmounted.
 *
 * `send` resolves with the text the server stored, or null when the save did
 * not land (the base then stays, and the next commit tries again).
 */
export interface SaveQueue {
  /** Send `text` now, or once the save in flight has answered. */
  commit(text: string): void;
  /** A server value arrived while nothing is out or waiting: it is the new base. */
  follow(serverText: string): void;
  readonly base: string;
  readonly busy: boolean;
}

export function createSaveQueue(initialBase: string, send: (text: string, base: string) => Promise<string | null>): SaveQueue {
  let base = initialBase;
  let inFlight = false;
  let waiting: string | null = null;
  const go = (text: string) => {
    if (text === base) return;
    inFlight = true;
    void send(text, base)
      .catch(() => null)
      .then((saved) => {
        inFlight = false;
        if (saved !== null) {
          base = saved;
          if (waiting !== null) waiting = mergeText(text, waiting, saved);
        }
        if (waiting !== null) {
          const next = waiting;
          waiting = null;
          go(next);
        }
      });
  };
  return {
    commit(text) {
      if (inFlight) {
        waiting = text;
        return;
      }
      go(text);
    },
    follow(serverText) {
      if (!inFlight && waiting === null) base = serverText;
    },
    get base() {
      return base;
    },
    get busy() {
      return inFlight || waiting !== null;
    },
  };
}
