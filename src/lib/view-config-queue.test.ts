import { describe, expect, it } from "vitest";
import { afterFailure, createViewConfigQueue, mergeViewPatch, type SendResult, type ViewPatch } from "./view-config-queue";

/** A send whose every call waits until the test answers it. */
function controlledSend() {
  const calls: Array<{ patch: ViewPatch; answer: (r: SendResult) => void }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send = (patch: ViewPatch) =>
    new Promise<SendResult>((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({
        patch,
        answer: (r) => {
          inFlight -= 1;
          resolve(r);
        },
      });
    });
  return { send, calls, maxInFlight: () => maxInFlight };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("mergeViewPatch / afterFailure", () => {
  it("lets a later value of a key win", () => {
    expect(mergeViewPatch({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });
  it("keeps a failed patch's keys under anything newer", () => {
    expect(afterFailure({ b: 9 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 9 });
  });
});

describe("createViewConfigQueue", () => {
  it("sends two quick patches of one key in order, the last carrying the latest value", async () => {
    const s = controlledSend();
    const q = createViewConfigQueue(s.send);
    q.enqueue({ rowHeight: "compact" });
    q.enqueue({ rowHeight: "tall" });
    await tick();
    expect(s.calls.map((c) => c.patch)).toEqual([{ rowHeight: "compact" }]);
    s.calls[0].answer({ ok: true });
    await tick();
    expect(s.calls.map((c) => c.patch)).toEqual([{ rowHeight: "compact" }, { rowHeight: "tall" }]);
    s.calls[1].answer({ ok: true });
    expect(await q.flush()).toBe(true);
  });

  it("keeps one request in flight at a time", async () => {
    const s = controlledSend();
    const q = createViewConfigQueue(s.send);
    for (let i = 0; i < 5; i += 1) q.enqueue({ [`k${i}`]: i });
    await tick();
    expect(s.calls).toHaveLength(1);
    s.calls[0].answer({ ok: true });
    await tick();
    s.calls[1].answer({ ok: true });
    await tick();
    expect(s.maxInFlight()).toBe(1);
  });

  it("sends a patch made while one is in flight after it, every key merged", async () => {
    const s = controlledSend();
    const q = createViewConfigQueue(s.send);
    q.enqueue({ filters: { rules: [] } });
    await tick();
    q.enqueue({ groupBy: "status" });
    q.enqueue({ colWidths: { name: 300 } });
    s.calls[0].answer({ ok: true });
    await tick();
    expect(s.calls[1].patch).toEqual({ groupBy: "status", colWidths: { name: 300 } });
  });

  it("keeps a failed patch's keys dirty and re-sends them with the next patch, under any newer value", async () => {
    const s = controlledSend();
    const states: string[] = [];
    const q = createViewConfigQueue(s.send);
    q.subscribe((st) => states.push(st.status));
    q.enqueue({ pinnedColumns: ["due"], rowHeight: "tall" });
    await tick();
    s.calls[0].answer({ ok: false, message: "Those view settings aren't valid." });
    await tick();
    expect(q.state().status).toBe("error");
    expect(q.state().message).toBe("Those view settings aren't valid.");
    // Nothing is retried on its own: the next save carries it.
    expect(s.calls).toHaveLength(1);
    q.enqueue({ rowHeight: "compact" });
    await tick();
    expect(s.calls[1].patch).toEqual({ pinnedColumns: ["due"], rowHeight: "compact" });
    s.calls[1].answer({ ok: true });
    await tick();
    expect(q.state().status).toBe("idle");
    expect(states).toContain("error");
  });

  it("clears only the keys a success carried", async () => {
    const s = controlledSend();
    const q = createViewConfigQueue(s.send);
    q.enqueue({ a: 1 });
    await tick();
    q.enqueue({ b: 2 });
    s.calls[0].answer({ ok: true });
    await tick();
    expect(s.calls[1].patch).toEqual({ b: 2 });
    expect(q.pending()).toEqual({});
  });

  it("re-sends what failed on flush, the toast's Try again", async () => {
    const s = controlledSend();
    const q = createViewConfigQueue(s.send);
    q.enqueue({ sortCol: { key: "due", dir: "asc" } });
    await tick();
    s.calls[0].answer({ ok: false, message: "Couldn't save the view settings." });
    await tick();
    const done = q.flush();
    await tick();
    expect(s.calls[1].patch).toEqual({ sortCol: { key: "due", dir: "asc" } });
    s.calls[1].answer({ ok: true });
    expect(await done).toBe(true);
  });

  it("reports a thrown send as a failure and keeps the keys", async () => {
    const q = createViewConfigQueue(() => Promise.reject(new Error("offline")));
    q.enqueue({ a: 1 });
    expect(await q.flush()).toBe(false);
    expect(q.pending()).toEqual({ a: 1 });
    expect(q.state().retryable).toBe(true);
  });

  it("says a refusal once and never re-sends its keys with a later save", async () => {
    const s = controlledSend();
    const q = createViewConfigQueue(s.send);
    q.enqueue({ groupDirection: "desc" });
    await tick();
    s.calls[0].answer({ ok: false, message: "You can read this List but not change its views.", retryable: false });
    await tick();
    expect(q.state()).toEqual({ status: "error", message: "You can read this List but not change its views.", retryable: false });
    expect(q.pending()).toEqual({});
    q.enqueue({ groupBy: "priority" });
    await tick();
    expect(s.calls[1].patch).toEqual({ groupBy: "priority" });
  });

  it("lets go of a failed key when a page reads the view fresh, never mid-flight", async () => {
    const s = controlledSend();
    const q = createViewConfigQueue(s.send);
    q.enqueue({ colWidths: { title: 300 } });
    await tick();
    s.calls[0].answer({ ok: false, message: "Couldn't save the view settings." });
    await tick();
    expect(q.pending()).toEqual({ colWidths: { title: 300 } });
    q.discardFailed();
    expect(q.pending()).toEqual({});
    expect(q.state().status).toBe("idle");
    // The next save carries only its own key, so a colleague's newer widths stand.
    q.enqueue({ sortCol: { key: "due", dir: "asc" } });
    await tick();
    expect(s.calls[1].patch).toEqual({ sortCol: { key: "due", dir: "asc" } });
    // A save on its way is never dropped.
    q.discardFailed();
    s.calls[1].answer({ ok: true });
    await tick();
    expect(q.state().status).toBe("idle");
    expect(s.calls).toHaveLength(2);
  });
});
