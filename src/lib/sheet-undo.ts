// Pure command stack for sheet undo/redo (Tables Phase 4).
//
// Why a command stack and not grid snapshots: sheet mutations already know
// their inverses (the engine's setCell returns the overwritten literal, a
// bulk delete knows the rows it removed), so each user action records how
// to reverse itself instead of copying the whole grid. Plan 3a makes this
// the REQUIRED mitigation for unrecoverable bulk delete / paste-overwrite,
// which drives the failure semantics below: a command whose reversal fails
// is never silently dropped, because dropping it is data loss.
//
// Why undo()/redo() are async and serialized: reversing an action means
// re-issuing batched network writes. Two rapid Cmd+Z presses must apply
// strictly in order and never interleave, or the second would mutate a grid
// the first is still restoring.
//
// No React in here on purpose: the grid owns rendering, this module owns
// only ordering and failure semantics, which is what keeps it unit-testable.

export interface UndoCommand {
  /** Human-readable action name for toasts and menu items, e.g. "Delete 12 rows". */
  label: string;
  /**
   * Reverse the action. Must restore EXACTLY the prior state, and must
   * throw (not swallow) when it could not: the stack relies on the throw
   * to keep the command retryable instead of pretending the undo worked.
   */
  undo(): Promise<void>;
  /** Re-apply the action after an undo, with the same honesty contract. */
  redo(): Promise<void>;
}

export interface UndoStack {
  /**
   * Record an action that ALREADY ran. Executes nothing. Kills the redo
   * branch (history forked). If an undo/redo is in flight, or earlier
   * deferred pushes are still pending, the push is deferred so it lands
   * AFTER the in-flight operation finishes its stack mutation (including a
   * re-push after a failed undo): the new action happened chronologically
   * later, so its command must sit above the retryable one.
   */
  push(cmd: UndoCommand): void;
  /** Undo the newest command. false when there was nothing to undo. */
  undo(): Promise<boolean>;
  /** Redo the newest undone command. false when there was nothing to redo. */
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Label of the command the next undo/redo would run, null when none.
   * Once an operation begins executing, its command is already popped, so
   * the peek reflects what the NEXT call would act on.
   */
  peekUndoLabel(): string | null;
  peekRedoLabel(): string | null;
  /**
   * Drop all history. Effective immediately for canUndo/canRedo even while
   * an operation is in flight; the in-flight command body still finishes (a
   * promise cannot be cancelled) but its settle-time stack writes, and any
   * deferred pushes made before the clear, are discarded: the user chose to
   * wipe history, so nothing may resurrect into the emptied stacks. An
   * undo/redo that was queued but had NOT started executing when clear()
   * ran finds empty stacks and resolves false; its command never runs,
   * which is the safe reading of "the user wiped history first".
   */
  clear(): void;
  /** True while any undo()/redo() call has not yet settled. */
  busy(): boolean;
}

const DEFAULT_LIMIT = 100;

export function createUndoStack(opts?: { limit?: number }): UndoStack {
  // Clamp to at least 1: a limit of 0 would make push a silent no-op, which
  // callers would experience as unrecoverable actions, the exact failure
  // this stack exists to prevent.
  const limit = Math.max(1, Math.floor(opts?.limit ?? DEFAULT_LIMIT));

  const undoStack: UndoCommand[] = [];
  const redoStack: UndoCommand[] = [];

  // Serialization backbone: every undo/redo, and every push made while
  // something is pending, appends to this promise chain, so operations run
  // strictly one at a time in call order.
  let chain: Promise<unknown> = Promise.resolve();
  // Chain entries not yet settled (operations AND deferred pushes). A push
  // must defer whenever this is non-zero, not just while an op runs:
  // otherwise a synchronous push racing a still-draining deferred push
  // would land ahead of it and reorder history.
  let queued = 0;
  // Unsettled undo()/redo() calls only; busy() reports these, because a
  // deferred push is invisible bookkeeping, not user-visible work.
  let opsInFlight = 0;
  // clear() bumps the epoch. Work that started life in an older epoch must
  // not write into the freshly emptied stacks when it settles.
  let epoch = 0;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    queued += 1;
    // chain never rejects (see below), so a plain then() is safe here.
    const run = chain.then(task);
    // The caller of undo()/redo() sees the rejection; the internal chain
    // must swallow it, or one failed undo would poison every later op.
    chain = run.then(
      () => {
        queued -= 1;
      },
      () => {
        queued -= 1;
      }
    );
    return run;
  }

  function applyPush(cmd: UndoCommand): void {
    // A new action invalidates everything that was undone: you cannot redo
    // into a timeline that no longer exists.
    redoStack.length = 0;
    undoStack.push(cmd);
    if (undoStack.length > limit) undoStack.shift();
  }

  function push(cmd: UndoCommand): void {
    if (queued === 0) {
      applyPush(cmd);
      return;
    }
    // Deferred path: an async command body (or a user acting mid-undo)
    // produced a new action while the chain is draining. Landing it through
    // the chain keeps history chronological; see the UndoStack.push doc.
    const bornIn = epoch;
    void enqueue(async () => {
      // A clear() issued after this push wiped history on purpose;
      // resurrecting one command into the emptied stack would lie about
      // what is undoable.
      if (bornIn === epoch) applyPush(cmd);
    });
  }

  function runOp(from: UndoCommand[], to: UndoCommand[], mode: "undo" | "redo"): Promise<boolean> {
    opsInFlight += 1;
    const run = enqueue(async () => {
      // Pop at execution time, not call time: an earlier queued op or a
      // clear() may have emptied the stack since this call was made.
      const cmd = from.pop();
      if (!cmd) return false;
      const bornIn = epoch;
      try {
        await (mode === "undo" ? cmd.undo() : cmd.redo());
      } catch (err) {
        // The reversal failed mid-write, so the sheet state is unknown.
        // The only honest claim is "still pending": the command goes back
        // on top so the user can retry, and the error is rethrown so the
        // caller can toast + reload. Skipped only when clear() ran while
        // we were in flight, because the user discarded history.
        if (bornIn === epoch) from.push(cmd);
        throw err;
      }
      // Success moves the command to the opposite stack, unless a clear()
      // wiped history while the command body was awaiting. The data change
      // itself DID happen either way, hence true below.
      if (bornIn === epoch) to.push(cmd);
      return true;
    });
    // Attached before the caller can await run, so busy() is already false
    // when the caller's own continuation resumes.
    run.then(
      () => {
        opsInFlight -= 1;
      },
      () => {
        opsInFlight -= 1;
      }
    );
    return run;
  }

  return {
    push,
    undo: () => runOp(undoStack, redoStack, "undo"),
    redo: () => runOp(redoStack, undoStack, "redo"),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    peekUndoLabel: () => (undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null),
    peekRedoLabel: () => (redoStack.length > 0 ? redoStack[redoStack.length - 1].label : null),
    clear: () => {
      undoStack.length = 0;
      redoStack.length = 0;
      epoch += 1;
    },
    busy: () => opsInFlight > 0,
  };
}
