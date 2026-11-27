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
// A read must also never put back what a change made here replaced, nor
// hold half of one. Every post, edit, delete and reaction calls `begin()` as
// it is sent and `end()` when it lands. A read is stale when a change started
// or landed during it, or is still out when it ends (a post saves the comment
// long before it answers, so a read can see the comment that the post is
// about to add a second time). A stale re-read is dropped: the rows already
// hold the change and the next read catches up. A stale first read, with
// nothing on screen yet, reads again.

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
  /** A post, edit, delete or reaction is sent. */
  begin(): void;
  /** It landed, either way. */
  end(): void;
  /** The rows on screen are now this task's. */
  shown(entityId: string): void;
}

export function createThreadReads(): ThreadReads {
  let seq = 0;
  let changes = 0;
  let inFlight = 0;
  let shownFor: string | null = null;
  return {
    start(entityId) {
      seq += 1;
      const first = shownFor !== entityId;
      // Another task's read: the rows on screen stop counting as anyone's,
      // so coming back to the first task is a first read again and its
      // skeleton is always taken down by its own read.
      if (first) shownFor = null;
      return { seq, changes, first };
    },
    finish(ticket) {
      if (ticket.seq !== seq) return "superseded";
      if (ticket.changes !== changes || inFlight > 0) return "stale";
      return "apply";
    },
    begin() {
      changes += 1;
      inFlight += 1;
    },
    end() {
      changes += 1;
      inFlight = Math.max(0, inFlight - 1);
    },
    shown(entityId) {
      shownFor = entityId;
    },
  };
}

/** A first read that keeps meeting changes still lands after this many. */
export const FIRST_READ_ATTEMPTS = 3;

export interface ThreadReadHooks<T> {
  /** A first read is under way: show the skeleton, clear an old error. */
  showSkeleton(): void;
  /** Put this result on screen and take the skeleton down. */
  apply(result: T): void;
  /** A first read failed: the error row with Retry, the skeleton down. */
  failFirst(): void;
}

/**
 * One read of the thread, with every rule above. A re-read that fails keeps
 * the comments on screen; the next one tries again.
 */
export async function readThread<T>(
  reads: ThreadReads,
  entityId: string,
  fetchOnce: () => Promise<T>,
  hooks: ThreadReadHooks<T>,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const ticket = reads.start(entityId);
    if (ticket.first) hooks.showSkeleton();
    let result: T;
    try {
      result = await fetchOnce();
    } catch {
      if (reads.finish(ticket) === "superseded") return;
      if (ticket.first) hooks.failFirst();
      return;
    }
    const verdict = reads.finish(ticket);
    if (verdict === "superseded") return;
    if (verdict === "stale") {
      if (!ticket.first) return;
      if (attempt < FIRST_READ_ATTEMPTS) continue;
    }
    hooks.apply(result);
    reads.shown(entityId);
    return;
  }
}

/** Add the comment the server just answered with; a read that already
 *  brought it in gets the server's copy in its place, never a second row. */
export function appendOnce<T extends { id: string }>(list: readonly T[], added: T): T[] {
  return list.some((u) => u.id === added.id) ? list.map((u) => (u.id === added.id ? added : u)) : [...list, added];
}
