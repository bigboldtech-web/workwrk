// Which read of a task's comments may replace the list on screen.
//
// The thread is read again every 30 s on the task page and on every realtime
// event about the task. Each read used to show the loading skeleton, which
// unmounted every comment: an edit in progress closed and lost its text, an
// open "@" list vanished before a name could be picked, and a click on a
// comment's menu landed on a row that was no longer there. Only the FIRST read
// of a task shows the skeleton now; a re-read swaps the rows in place, so a
// comment's edit box, its menu and its "@" list stay open through it.
//
// A read must also never put back what a change made here replaced. Every
// post, edit, delete and reaction calls `changed()` when it starts and again
// when it lands, so a read that overlapped one is stale: a re-read is dropped
// (the rows already hold the change and the next read catches up), and a
// first read, with nothing on screen yet, reads again.

export interface ThreadReadTicket {
  readonly seq: number;
  readonly changes: number;
  /** Nothing of this task is on screen yet: show the skeleton. */
  readonly first: boolean;
}

export type ThreadReadVerdict =
  /** Put the result on screen. */
  | "apply"
  /** A change made here overlapped the read. */
  | "stale"
  /** A newer read started after this one; it owns the list. */
  | "superseded";

export interface ThreadReads {
  start(entityId: string): ThreadReadTicket;
  finish(ticket: ThreadReadTicket): ThreadReadVerdict;
  /** A post, edit, delete or reaction started or landed. */
  changed(): void;
  /** The rows on screen are now this task's. */
  shown(entityId: string): void;
}

export function createThreadReads(): ThreadReads {
  let seq = 0;
  let changes = 0;
  let shownFor: string | null = null;
  return {
    start(entityId) {
      seq += 1;
      return { seq, changes, first: shownFor !== entityId };
    },
    finish(ticket) {
      if (ticket.seq !== seq) return "superseded";
      if (ticket.changes !== changes) return "stale";
      return "apply";
    },
    changed() {
      changes += 1;
    },
    shown(entityId) {
      shownFor = entityId;
    },
  };
}

/** A first read that keeps meeting changes still lands after this many. */
export const FIRST_READ_ATTEMPTS = 3;
