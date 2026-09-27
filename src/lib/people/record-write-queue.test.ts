import { describe, expect, it } from "vitest";
import { createRecordWriteQueue, retryDelayMs, type SendOutcome, type WriteBody } from "./record-write-queue";

function harness(outcomes: SendOutcome[]) {
  const sent: Array<{ method: string; url: string; body: WriteBody }> = [];
  const timers: Array<() => void> = [];
  const q = createRecordWriteQueue({
    send: async (method, url, body) => {
      sent.push({ method, url, body });
      return outcomes.shift() ?? { ok: true };
    },
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  return { q, sent, timers };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("record write queue", () => {
  it("sends once and resolves on success", async () => {
    const { q, sent } = harness([{ ok: true }]);
    const r = await q.write("PATCH", "/api/users/a", { phone: "1" });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(q.size()).toBe(0);
  });

  it("keeps an offline write, says it is retrying, and lands it on the retry", async () => {
    const { q, sent, timers } = harness([{ ok: false, transient: true, error: "You're offline" }, { ok: true }]);
    let retrying = "";
    const p = q.write("PATCH", "/api/users/a", { phone: "555" }, { onRetrying: (e) => { retrying = e; } });
    await tick();
    expect(retrying).toBe("You're offline");
    expect(q.size()).toBe(1);
    expect(q.waiting()).toEqual([{ method: "PATCH", url: "/api/users/a", body: { phone: "555" } }]);
    timers.shift()!();
    const r = await p;
    expect(r.ok).toBe(true);
    expect(sent.map((s) => s.body)).toEqual([{ phone: "555" }, { phone: "555" }]);
    expect(q.size()).toBe(0);
  });

  it("drops a refusal and reports it once", async () => {
    const { q, timers } = harness([{ ok: false, transient: false, error: "You can't change: status", status: 403 }]);
    const r = await q.write("PATCH", "/api/users/a", { status: "INACTIVE" });
    expect(r).toMatchObject({ ok: false, error: "You can't change: status", status: 403 });
    expect(timers).toHaveLength(0);
    expect(q.size()).toBe(0);
  });

  it("merges waiting PATCH bodies with the later value winning", async () => {
    const { q, sent, timers } = harness([{ ok: false, transient: true, error: "offline" }, { ok: true }]);
    void q.write("PATCH", "/api/users/a", { phone: "1" });
    await tick();
    void q.write("PATCH", "/api/users/a", { phone: "2", firstName: "A" });
    await tick();
    timers.shift()!();
    await tick();
    expect(sent[sent.length - 1].body).toEqual({ phone: "2", firstName: "A" });
  });

  it("lets a PUT replace the whole waiting body", async () => {
    const { q, sent, timers } = harness([{ ok: false, transient: true, error: "offline" }, { ok: true }]);
    void q.write("PUT", "/api/users/a/dotted-lines", { managerIds: ["x", "y"] });
    await tick();
    void q.write("PUT", "/api/users/a/dotted-lines", { managerIds: ["x"] });
    await tick();
    timers.shift()!();
    await tick();
    expect(sent[sent.length - 1].body).toEqual({ managerIds: ["x"] });
  });

  it("retries at once when the browser comes back online", async () => {
    const { q, sent } = harness([{ ok: false, transient: true, error: "offline" }, { ok: true }]);
    const p = q.write("PATCH", "/api/departments/d", { name: "Ops" });
    await tick();
    q.retryAll();
    expect((await p).ok).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("backs off and caps the delay", () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(20)).toBe(30_000);
  });
});
