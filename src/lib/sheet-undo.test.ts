import { describe, expect, it } from "vitest";
import { createUndoStack, type UndoCommand } from "./sheet-undo";

// Manually-resolved promise: the only honest way to PROVE serialization is
// to hold an op open and observe that the next one has not started.
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Deferred pushes land one microtask after the op that blocked them
// settles; a macrotask hop guarantees the whole chain has drained.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function logCmd(label: string, log: string[] = []): UndoCommand {
  return {
    label,
    undo: async () => {
      log.push(`undo:${label}`);
    },
    redo: async () => {
      log.push(`redo:${label}`);
    },
  };
}

describe("basic flow", () => {
  it("undo and redo on an empty stack return false", async () => {
    const stack = createUndoStack();
    await expect(stack.undo()).resolves.toBe(false);
    await expect(stack.redo()).resolves.toBe(false);
  });

  it("push records without executing; undo/redo round-trip the command", async () => {
    const log: string[] = [];
    const stack = createUndoStack();
    stack.push(logCmd("A", log));
    expect(log).toEqual([]); // push must execute nothing
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);

    await expect(stack.undo()).resolves.toBe(true);
    expect(log).toEqual(["undo:A"]);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);

    await expect(stack.redo()).resolves.toBe(true);
    expect(log).toEqual(["undo:A", "redo:A"]);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("undo beyond available history returns false, even when queued rapidly", async () => {
    const stack = createUndoStack();
    stack.push(logCmd("only"));
    const p1 = stack.undo();
    const p2 = stack.undo(); // queued behind p1, stack empty by its turn
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(false);
  });
});

describe("labels", () => {
  it("peek labels are null when the branches are empty", () => {
    const stack = createUndoStack();
    expect(stack.peekUndoLabel()).toBeNull();
    expect(stack.peekRedoLabel()).toBeNull();
  });

  it("peek labels track the tops of both stacks", async () => {
    const stack = createUndoStack();
    stack.push(logCmd("Paste 3x2"));
    stack.push(logCmd("Delete 12 rows"));
    expect(stack.peekUndoLabel()).toBe("Delete 12 rows");
    await stack.undo();
    expect(stack.peekUndoLabel()).toBe("Paste 3x2");
    expect(stack.peekRedoLabel()).toBe("Delete 12 rows");
  });
});

describe("redo branch clearing", () => {
  it("push after undo kills the redo branch", async () => {
    const log: string[] = [];
    const stack = createUndoStack();
    stack.push(logCmd("A", log));
    stack.push(logCmd("B", log));
    await stack.undo(); // B undone
    expect(stack.peekRedoLabel()).toBe("B");

    stack.push(logCmd("C", log));
    expect(stack.canRedo()).toBe(false);
    expect(stack.peekRedoLabel()).toBeNull();

    // Undo order is now C then A; B's timeline is gone.
    await stack.undo();
    await stack.undo();
    expect(log).toEqual(["undo:B", "undo:C", "undo:A"]);
  });
});

describe("limit", () => {
  it("evicts the oldest command past the limit", async () => {
    const log: string[] = [];
    const stack = createUndoStack({ limit: 3 });
    for (const l of ["a", "b", "c", "d"]) stack.push(logCmd(l, log));
    await expect(stack.undo()).resolves.toBe(true);
    await expect(stack.undo()).resolves.toBe(true);
    await expect(stack.undo()).resolves.toBe(true);
    await expect(stack.undo()).resolves.toBe(false); // "a" was evicted
    expect(log).toEqual(["undo:d", "undo:c", "undo:b"]);
  });

  it("defaults to 100", async () => {
    const stack = createUndoStack();
    for (let i = 0; i <= 100; i += 1) stack.push(logCmd(`c${i}`));
    let undone = 0;
    while (await stack.undo()) undone += 1;
    expect(undone).toBe(100); // c0 fell off the bottom
  });

  it("clamps a nonsense limit up to 1 instead of silently dropping everything", async () => {
    const stack = createUndoStack({ limit: 0 });
    stack.push(logCmd("a"));
    stack.push(logCmd("b"));
    expect(stack.peekUndoLabel()).toBe("b");
    await expect(stack.undo()).resolves.toBe(true);
    await expect(stack.undo()).resolves.toBe(false);
  });
});

describe("serialization", () => {
  it("two rapid undos run strictly in order and never interleave", async () => {
    const log: string[] = [];
    const dA = deferred();
    const dB = deferred();
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        log.push("start:A");
        await dA.promise;
        log.push("end:A");
      },
      redo: async () => {},
    });
    stack.push({
      label: "B",
      undo: async () => {
        log.push("start:B");
        await dB.promise;
        log.push("end:B");
      },
      redo: async () => {},
    });

    const p1 = stack.undo(); // pops B
    const p2 = stack.undo(); // must wait for B to settle
    await flush();
    expect(log).toEqual(["start:B"]); // A has NOT started
    expect(stack.busy()).toBe(true);

    dB.resolve();
    await flush();
    expect(log).toEqual(["start:B", "end:B", "start:A"]);

    dA.resolve();
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
    expect(log).toEqual(["start:B", "end:B", "start:A", "end:A"]);
    expect(stack.busy()).toBe(false);
    // Redo order reverses undo order: A (undone last) redoes first.
    expect(stack.peekRedoLabel()).toBe("A");
  });

  it("a redo queued behind an in-flight undo waits for it", async () => {
    const log: string[] = [];
    const dUndo = deferred();
    const stack = createUndoStack();
    stack.push(logCmd("early", log));
    stack.push({
      label: "late",
      undo: async () => {
        log.push("start:undo:late");
        await dUndo.promise;
        log.push("end:undo:late");
      },
      redo: async () => {
        log.push("redo:late");
      },
    });

    const p1 = stack.undo();
    const p2 = stack.redo(); // redoes "late" only after its undo finishes
    await flush();
    expect(log).toEqual(["start:undo:late"]);

    dUndo.resolve();
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
    expect(log).toEqual(["start:undo:late", "end:undo:late", "redo:late"]);
    expect(stack.peekUndoLabel()).toBe("late");
  });
});

describe("failure: re-push and retry", () => {
  it("a failing undo stays on top of the undo stack and can be retried", async () => {
    let attempts = 0;
    const stack = createUndoStack();
    stack.push({
      label: "risky",
      undo: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network down");
      },
      redo: async () => {},
    });

    await expect(stack.undo()).rejects.toThrow("network down");
    // State unknown: the command must remain undoable, never dropped.
    expect(stack.canUndo()).toBe(true);
    expect(stack.peekUndoLabel()).toBe("risky");
    expect(stack.canRedo()).toBe(false);
    expect(stack.busy()).toBe(false);

    await expect(stack.undo()).resolves.toBe(true);
    expect(stack.canUndo()).toBe(false);
    expect(stack.peekRedoLabel()).toBe("risky");
  });

  it("a failing redo stays on top of the redo stack and can be retried", async () => {
    let attempts = 0;
    const stack = createUndoStack();
    stack.push({
      label: "risky",
      undo: async () => {},
      redo: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("500");
      },
    });
    await stack.undo();

    await expect(stack.redo()).rejects.toThrow("500");
    expect(stack.canRedo()).toBe(true);
    expect(stack.peekRedoLabel()).toBe("risky");
    expect(stack.canUndo()).toBe(false);

    await expect(stack.redo()).resolves.toBe(true);
    expect(stack.peekUndoLabel()).toBe("risky");
  });

  it("a failure does not poison later operations", async () => {
    const log: string[] = [];
    const stack = createUndoStack();
    stack.push({
      label: "bad",
      undo: async () => {
        throw new Error("always fails");
      },
      redo: async () => {},
    });
    stack.push(logCmd("good", log));

    await expect(stack.undo()).resolves.toBe(true); // "good"
    await expect(stack.undo()).rejects.toThrow("always fails");
    // The chain keeps serving: redo of "good" still works after the failure.
    await expect(stack.redo()).resolves.toBe(true);
    expect(log).toEqual(["undo:good", "redo:good"]);
    expect(stack.peekUndoLabel()).toBe("good");
    // And "bad" is still there underneath, awaiting another retry.
    await expect(stack.undo()).resolves.toBe(true);
    expect(stack.peekUndoLabel()).toBe("bad");
  });
});

describe("push during an in-flight op", () => {
  it("lands after the op's stack mutation and kills the fresh redo branch", async () => {
    const d = deferred();
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        await d.promise;
      },
      redo: async () => {},
    });

    const p = stack.undo();
    stack.push(logCmd("X")); // user acts while the undo is mid-flight
    // X is deferred: the visible top is still A (its pop happens when the
    // op task starts, one microtask later), never X.
    expect(stack.peekUndoLabel()).toBe("A");
    await flush();
    // Now A's undo is genuinely in flight (popped, blocked on d) and X has
    // still not landed.
    expect(stack.canUndo()).toBe(false);

    d.resolve();
    await expect(p).resolves.toBe(true);
    await flush();
    // A reached the redo stack first, then X landed and, like any new
    // action, invalidated the redo branch.
    expect(stack.peekUndoLabel()).toBe("X");
    expect(stack.canRedo()).toBe(false);
  });

  it("lands ABOVE a command re-pushed by a failed undo", async () => {
    const d = deferred();
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        await d.promise;
        throw new Error("boom");
      },
      redo: async () => {},
    });

    const p = stack.undo();
    stack.push(logCmd("X"));
    d.resolve();
    await expect(p).rejects.toThrow("boom");
    await flush();
    // Chronological order: retry X first, then the failed A underneath.
    expect(stack.peekUndoLabel()).toBe("X");
    await expect(stack.undo()).resolves.toBe(true);
    expect(stack.peekUndoLabel()).toBe("A");
  });

  it("multiple deferred pushes keep their relative order", async () => {
    const d = deferred();
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        await d.promise;
      },
      redo: async () => {},
    });

    const p = stack.undo();
    stack.push(logCmd("X"));
    stack.push(logCmd("Y"));
    d.resolve();
    await p;
    // Z arrives after the op settled but before X/Y drained; it must still
    // land after them, or history would reorder.
    stack.push(logCmd("Z"));
    await flush();

    expect(stack.peekUndoLabel()).toBe("Z");
    await stack.undo();
    expect(stack.peekUndoLabel()).toBe("Y");
    await stack.undo();
    expect(stack.peekUndoLabel()).toBe("X");
  });
});

describe("clear", () => {
  it("empties both branches", async () => {
    const stack = createUndoStack();
    stack.push(logCmd("A"));
    stack.push(logCmd("B"));
    await stack.undo();
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    await expect(stack.undo()).resolves.toBe(false);
    await expect(stack.redo()).resolves.toBe(false);
  });

  it("takes effect immediately while an op is in flight; the op still finishes", async () => {
    const d = deferred();
    let finished = false;
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        await d.promise;
        finished = true;
      },
      redo: async () => {},
    });

    const p = stack.undo();
    await flush(); // let the op begin executing before the clear arrives
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.busy()).toBe(true); // in-flight op is not cancelled

    d.resolve();
    // The data change happened, so the op reports true...
    await expect(p).resolves.toBe(true);
    expect(finished).toBe(true);
    // ...but nothing resurrects into the cleared stacks.
    expect(stack.canRedo()).toBe(false);
    expect(stack.busy()).toBe(false);
  });

  it("suppresses the re-push of a failed in-flight undo", async () => {
    const d = deferred();
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        await d.promise;
        throw new Error("boom");
      },
      redo: async () => {},
    });

    const p = stack.undo();
    await flush(); // op is mid-execution when the clear lands
    stack.clear();
    d.resolve();
    await expect(p).rejects.toThrow("boom"); // still honest with the caller
    expect(stack.canUndo()).toBe(false); // but cleared history stays cleared
  });

  it("an op queued but not yet started when clear() runs resolves false and never executes", async () => {
    let ran = false;
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        ran = true;
      },
      redo: async () => {},
    });

    const p = stack.undo(); // task starts on a microtask...
    stack.clear(); // ...and the user wipes history before it does
    await expect(p).resolves.toBe(false);
    expect(ran).toBe(false); // safe reading: nothing left to undo, do nothing
  });

  it("drops pushes that were deferred behind the in-flight op", async () => {
    const d = deferred();
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        await d.promise;
      },
      redo: async () => {},
    });

    const p = stack.undo();
    stack.push(logCmd("X")); // deferred behind the undo
    stack.clear(); // user wipes history before X ever lands
    d.resolve();
    await p;
    await flush();
    expect(stack.canUndo()).toBe(false);
    expect(stack.peekUndoLabel()).toBeNull();
  });
});

describe("busy", () => {
  it("is true from the call until the op settles, including queued ops", async () => {
    const d = deferred();
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        await d.promise;
      },
      redo: async () => {},
    });
    stack.push(logCmd("B"));

    expect(stack.busy()).toBe(false);
    const p1 = stack.undo(); // B, instant
    expect(stack.busy()).toBe(true); // true synchronously at call time
    await p1;

    const p2 = stack.undo(); // A, held open
    const p3 = stack.redo(); // queued behind A
    await flush();
    expect(stack.busy()).toBe(true);
    d.resolve();
    await Promise.all([p2, p3]);
    expect(stack.busy()).toBe(false);
  });

  it("is false again after a rejected op settles", async () => {
    const stack = createUndoStack();
    stack.push({
      label: "A",
      undo: async () => {
        throw new Error("boom");
      },
      redo: async () => {},
    });
    await expect(stack.undo()).rejects.toThrow("boom");
    expect(stack.busy()).toBe(false);
  });
});
