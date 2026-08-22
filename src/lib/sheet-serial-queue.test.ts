import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./sheet-serial-queue";

/** A promise the test can settle from outside — stands in for a fetch. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createSerialQueue", () => {
  it("runs jobs strictly in call order, one at a time", async () => {
    const q = createSerialQueue();
    const order: string[] = [];
    const first = deferred<void>();
    const p1 = q.run(async () => { order.push("1 start"); await first.promise; order.push("1 end"); });
    const p2 = q.run(async () => { order.push("2 start"); order.push("2 end"); });
    await tick();
    // Job 2 must not start while job 1 is still in flight — this is the
    // whole point: a second PATCH can't overtake the first on the wire.
    expect(order).toEqual(["1 start"]);
    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["1 start", "1 end", "2 start", "2 end"]);
  });

  it("returns each job's own resolved value", async () => {
    const q = createSerialQueue();
    const a = q.run(async () => "a");
    const b = q.run(async () => 2);
    expect(await a).toBe("a");
    expect(await b).toBe(2);
  });

  it("rejects the failing job's caller but keeps the chain alive and ordered", async () => {
    const q = createSerialQueue();
    const order: string[] = [];
    const boom = q.run(async () => { order.push("boom"); throw new Error("HTTP 500"); });
    const after = q.run(async () => { order.push("after"); return "ok"; });
    await expect(boom).rejects.toThrow("HTTP 500");
    // The write AFTER a failed one still runs (and after it, not before).
    expect(await after).toBe("ok");
    expect(order).toEqual(["boom", "after"]);
  });

  it("preserves order across a mix of failures and successes", async () => {
    const q = createSerialQueue();
    const order: number[] = [];
    const jobs = [1, 2, 3, 4].map((n) =>
      q.run(async () => {
        order.push(n);
        if (n % 2 === 0) throw new Error(`fail ${n}`);
        return n;
      }).catch((e: Error) => e.message),
    );
    expect(await Promise.all(jobs)).toEqual([1, "fail 2", 3, "fail 4"]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("a job enqueued from INSIDE a running job runs after it (no deadlock when not awaited)", async () => {
    const q = createSerialQueue();
    const order: string[] = [];
    let innerDone: Promise<void> | null = null;
    await q.run(async () => {
      order.push("outer start");
      // Fire-and-forget nested enqueue — the pattern persistCellRewrites
      // uses from inside a queued batch. Awaiting it here would deadlock,
      // which is why the page never does.
      innerDone = q.run(async () => { order.push("inner"); });
      order.push("outer end");
    });
    await innerDone!;
    expect(order).toEqual(["outer start", "outer end", "inner"]);
  });
});
