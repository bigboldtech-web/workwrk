import { describe, expect, it } from "vitest";
import { createRecordWriteQueue, refusalIsAbout, retryDelayMs, type SendOutcome, type WriteBody } from "./record-write-queue";

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

// Docs-found fixes batch 8, from the batch 7 review: bodies for one person
// merge while a request is in flight, so a job title and a Reports to can ride
// one PATCH, and the Reports to question (409 manager_elsewhere) refused the
// job title too, which Edit details then dropped under the Reports to sentence.
describe("refusalIsAbout", () => {
  it("tells a refusal about another field apart, so that field's waiter sends its own change again", async () => {
    const refusal = { error: "Max Chen reports to someone in another workspace...", code: "manager_elsewhere", field: "managerId" };
    expect(refusalIsAbout(refusal, { roleId: "r1" })).toBe(false);
    expect(refusalIsAbout(refusal, { managerId: "sam" })).toBe(true);
    expect(refusalIsAbout({ error: "x", fields: ["status"] }, { status: "INACTIVE" })).toBe(true);
    expect(refusalIsAbout({ error: "x", fields: ["orgRole"] }, { departmentId: "d1" })).toBe(false);
    // Nothing names a field: nothing tells it apart, so it is this waiter's.
    expect(refusalIsAbout({ error: "Nothing to change" }, { roleId: "r1" })).toBe(true);
    expect(refusalIsAbout(undefined, { roleId: "r1" })).toBe(true);
  });

  it("with the queue: two merged fields, one refused for the other, and the resend lands alone", async () => {
    const sent: WriteBody[] = [];
    let release: (() => void) | null = null;
    const q = createRecordWriteQueue({
      send: async (_m, _u, body) => {
        sent.push(body);
        if (sent.length === 1) await new Promise<void>((r) => { release = r; });
        if ("managerId" in body) return { ok: false, transient: false, status: 409, error: "asked", data: { code: "manager_elsewhere", field: "managerId" } } as SendOutcome;
        return { ok: true, data: {} };
      },
    });
    const first = q.write("PATCH", "/api/users/u1", { phone: "1" });
    const title = q.write("PATCH", "/api/users/u1", { roleId: "r1" });
    const manager = q.write("PATCH", "/api/users/u1", { managerId: "sam" });
    (release as unknown as () => void)();
    await first;
    const [t, m] = await Promise.all([title, manager]);
    expect(sent[1]).toEqual({ roleId: "r1", managerId: "sam" });
    // Both waiters hear the one refusal; it names the Reports to only.
    if (t.ok || m.ok) throw new Error("both were refused together");
    expect(refusalIsAbout(t.data, { roleId: "r1" })).toBe(false);
    expect(refusalIsAbout(m.data, { managerId: "sam" })).toBe(true);
    // What Edit details does for the job title: send it again, alone.
    expect(await q.write("PATCH", "/api/users/u1", { roleId: "r1" })).toEqual({ ok: true, data: {} });
    expect(sent.at(-1)).toEqual({ roleId: "r1" });
  });
});
