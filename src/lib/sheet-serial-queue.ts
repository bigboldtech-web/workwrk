// Serialized async job queue for the Tables page's row-VALUE persistence
// (Phase 5 gating work, docs/plans/tables.md "recalc perf" + the recorded
// command-order race). Two rapid commits to the same cell used to race
// their PATCHes: whichever response landed last won on the server, which
// could invert user action order (last-write-loses). Chaining every value
// write through one promise chain makes persistence order = call order.
//
// Deliberately tiny and generic: jobs are opaque async thunks, a failed
// job REJECTS ITS OWN CALLER but never poisons the chain (the next queued
// write still runs, in order — a lost PATCH must not strand every write
// after it). Reads, row creates and column ops are NOT meant to queue:
// only the caller decides what needs ordering, and over-queueing would
// add latency to paths that cannot conflict.

export interface SerialQueue {
  /** Enqueue `job` after everything queued so far. Resolves/rejects with
   *  the job's own outcome; rejections do not stop later jobs. */
  run<T>(job: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(job);
      // The chain swallows the outcome (both branches) so one failure
      // can't break ordering for later jobs; the caller still sees the
      // real rejection through `result`.
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
