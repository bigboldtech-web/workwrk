import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SILENT_LOG } from "./log.mjs";
import { createSessions, REMEMBER_MS, type CreateAsk } from "./sessions.mjs";
import { connectToken, newBootKey } from "./tokens.mjs";

type Gate = { open: () => void; promise: Promise<void> };
const gate = (): Gate => {
  let open = () => undefined as void;
  const promise = new Promise<void>((r) => (open = r));
  return { open, promise };
};

/** A fake launcher: each launch answers at once (or when its gate opens), and records its stop. */
function fakeLauncher() {
  const launched: Array<{ id: string; stop: ReturnType<typeof vi.fn>; exit: () => void }> = [];
  const l = {
    launched,
    gate: null as Gate | null,
    fail: false,
    async launch(ask: { id: string }) {
      if (l.gate) await l.gate.promise;
      if (l.fail) throw new Error("chrome_did_not_start");
      let exit = () => undefined as void;
      const exited = new Promise<string>((r) => (exit = () => r("exit")));
      const stop = vi.fn(async () => undefined);
      launched.push({ id: ask.id, stop, exit });
      return { browserWs: "ws://127.0.0.1:1/devtools/browser/b", devtoolsBase: "http://127.0.0.1:1", tabTargetId: "T1", stop, exited, stateEntry: { id: ask.id, pid: 4242, pgid: 4242, started: "Tue Oct 20 10:00:00 2026", profile: `/state/profiles/${ask.id}` } };
    },
    reap: vi.fn(async () => 1),
    /** What each sweep kept, read when it acted (after its gate, as after a ps listing). */
    kept: [] as string[][],
    sweepGate: null as Gate | null,
    events: [] as string[],
    sweep: vi.fn(async (keep: () => readonly string[]) => {
      if (l.sweepGate) await l.sweepGate.promise;
      l.kept.push([...keep()]);
      l.events.push("sweep");
      return 0;
    }),
  };
  return l;
}

function fakeState(prev: unknown = null, events?: string[]) {
  const writes: Array<{ sessions: Array<Record<string, unknown>> }> = [];
  return {
    writes,
    write: (s: unknown) => {
      writes.push(JSON.parse(JSON.stringify(s)));
      events?.push("state");
    },
    read: () => prev as never,
  };
}

const ASK: CreateAsk = { projectId: "stand-in", region: "us-east-1", timeoutSeconds: 600, viewport: { width: 1280, height: 800 }, userMetadata: { wk: "workwrk-tag", row: "row-secret-value" } };
const clock = { wall: () => Date.now(), mono: () => Date.now() };

let launcher: ReturnType<typeof fakeLauncher>;
let state: ReturnType<typeof fakeState>;
let bootKey: Buffer;
let problems: string[];
function table(max = 3, extra: { connectSeconds?: number | null } = {}) {
  return createSessions({
    cfg: { mode: "process", max, proof: false, connectBase: "ws://127.0.0.1:8789", test: { connectSeconds: extra.connectSeconds ?? null } },
    launcher,
    state,
    log: SILENT_LOG,
    bootKey,
    clock,
    problems: () => problems,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  launcher = fakeLauncher();
  state = fakeState();
  bootKey = newBootKey();
  problems = [];
});
afterEach(() => vi.useRealTimers());

async function made(t: ReturnType<typeof table>, ask: CreateAsk = ASK) {
  const r = await t.create(ask);
  if (!r.ok) throw new Error(`not made: ${r.status}`);
  return r.session;
}

describe("the ends (6.1), each once", () => {
  it("timeout, at the create's own timeout", async () => {
    const t = table();
    const s = await made(t, { ...ASK, timeoutSeconds: 120 });
    t.claim(s.id, connectToken(bootKey, s.id));
    await vi.advanceTimersByTimeAsync(119_000);
    expect(s.status).toBe("running");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.endReason).toBe("timeout");
    expect(launcher.launched[0].stop).toHaveBeenCalledTimes(1);
    expect(t.counts().ends).toEqual({ timeout: 1 });
  });

  it("timeout never before the session's own end, when its timer fires a few milliseconds early by the clocks (host proof H5)", async () => {
    // The clocks read 3 ms short when the timer fires, as the event loop's own time can.
    let lag = 0;
    const lagging = { wall: () => Date.now() - lag, mono: () => Date.now() - lag };
    const t = createSessions({ cfg: { mode: "process", max: 3, proof: false, connectBase: "ws://127.0.0.1:8789" }, launcher, state, log: SILENT_LOG, bootKey, clock: lagging, problems: () => [] });
    const s = await made(t, { ...ASK, timeoutSeconds: 120 });
    t.claim(s.id, connectToken(bootKey, s.id));
    lag = 3;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.status).toBe("running");
    await vi.advanceTimersByTimeAsync(3);
    expect(s.endReason).toBe("timeout");
    expect(Date.parse(String(s.endedAt))).toBeGreaterThanOrEqual(Date.parse(String(s.expiresAt)));
  });

  it("timeout on the monotonic clock all the same when the wall clock is set back: held a second at most", async () => {
    let back = 0;
    const c = { wall: () => Date.now() - back, mono: () => Date.now() };
    const t = createSessions({ cfg: { mode: "process", max: 3, proof: false, connectBase: "ws://127.0.0.1:8789" }, launcher, state, log: SILENT_LOG, bootKey, clock: c, problems: () => [] });
    const s = await made(t, { ...ASK, timeoutSeconds: 120 });
    t.claim(s.id, connectToken(bootKey, s.id));
    back = 3_600_000;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.endReason).toBe("timeout");
  });

  it("never_connected at 60 seconds, and not once connected, nor for proof mode's orphans", async () => {
    const t = table();
    const lonely = await made(t);
    const used = await made(t);
    const orphan = await made(t, { ...ASK, exempt: true, keepAlive: true });
    expect(t.claim(used.id, connectToken(bootKey, used.id)).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(lonely.status).toBe("running");
    await vi.advanceTimersByTimeAsync(1);
    expect(lonely.endReason).toBe("never_connected");
    expect(used.status).toBe("running");
    expect(orphan.status).toBe("running");
  });

  it("never_connected follows the process mode test window", async () => {
    const t = table(3, { connectSeconds: 5 });
    const s = await made(t);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.endReason).toBe("never_connected");
  });

  it("last_client_left when the one client goes (keepAlive false)", async () => {
    const t = table();
    const s = await made(t);
    expect(t.claim(s.id, connectToken(bootKey, s.id)).ok).toBe(true);
    const close = vi.fn();
    t.attachClient(s.id, { close });
    t.clientGone(s.id);
    expect(s.endReason).toBe("last_client_left");
    t.clientGone(s.id);
    expect(t.counts().ends).toEqual({ last_client_left: 1 });
    expect(close).not.toHaveBeenCalled();
  });

  it("released, then 'ended' for a second release", async () => {
    const t = table();
    const s = await made(t);
    expect(t.release(s.id)).toBe("released");
    expect(t.release(s.id)).toBe("ended");
    expect(s.endReason).toBe("released");
    expect(launcher.launched[0].stop).toHaveBeenCalledTimes(1);
  });

  it("chrome_exited when Chrome exits, closing the client first", async () => {
    const t = table();
    const s = await made(t);
    t.claim(s.id, connectToken(bootKey, s.id));
    const close = vi.fn();
    t.attachClient(s.id, { close });
    launcher.launched[0].exit();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.endReason).toBe("chrome_exited");
    expect(close).toHaveBeenCalledTimes(1);
    expect(launcher.launched[0].stop).toHaveBeenCalledTimes(1);
  });

  it("ends once, whatever ends it after", async () => {
    const t = table();
    const s = await made(t);
    const seen = vi.fn();
    t.onEnd(seen);
    expect(t.end(s.id, "provider_ended")).toBe(true);
    expect(t.end(s.id, "timeout")).toBe(false);
    expect(t.release(s.id)).toBe("ended");
    launcher.launched[0].exit();
    await vi.advanceTimersByTimeAsync(130_000);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][1]).toBe("provider_ended");
    expect(t.counts().ends).toEqual({ provider_ended: 1 });
    expect(launcher.launched[0].stop).toHaveBeenCalledTimes(1);
    expect(s.status).toBe("ended");
  });
});

describe("the max (6.2)", () => {
  it("counts starting sessions and held slots", async () => {
    const t = table(3);
    await made(t);
    launcher.gate = gate();
    const starting = t.create(ASK);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.status()).toEqual({ max: 3, running: 1, starting: 1, held: 0 });
    const release = t.holdSlot("selftest");
    expect(release).toBeTypeOf("function");
    expect(t.status().held).toBe(1);
    expect(await t.create(ASK)).toEqual({ ok: false, status: 429, error: "at_capacity" });
    expect(t.holdSlot("image_build")).toBeNull();
    release?.();
    launcher.gate.open();
    expect((await starting).ok).toBe(true);
    expect((await t.create(ASK)).ok).toBe(true);
    expect(await t.create(ASK)).toEqual({ ok: false, status: 429, error: "at_capacity" });
  });

  it("refuses creates 503 while draining, and for a problem that needs a person", async () => {
    const t = table();
    t.drain();
    expect(await t.create(ASK)).toEqual({ ok: false, status: 503, error: "unavailable", why: "draining" });
    t.undrain();
    problems = ["firewall_unchecked"];
    expect(await t.create(ASK)).toEqual({ ok: false, status: 503, error: "unavailable", why: "firewall_unchecked" });
    problems = ["image_build_failing"];
    expect((await t.create(ASK)).ok).toBe(true);
  });

  it("a launch that fails answers 503 chrome_did_not_start and leaves no record", async () => {
    const t = table();
    launcher.fail = true;
    expect(await t.create(ASK)).toEqual({ ok: false, status: 503, error: "unavailable", why: "chrome_did_not_start" });
    expect(t.all()).toHaveLength(0);
    expect(t.status().starting).toBe(0);
  });
});

describe("the ended record", () => {
  it("answers 409 for an hour, then 404", async () => {
    const t = table();
    const s = await made(t);
    t.release(s.id);
    await vi.advanceTimersByTimeAsync(REMEMBER_MS - 60_000);
    await t.tick();
    expect(t.release(s.id)).toBe("ended");
    expect(t.list("COMPLETED").map((x) => x.id)).toEqual([s.id]);
    await vi.advanceTimersByTimeAsync(60_000);
    await t.tick();
    expect(t.release(s.id)).toBe("unknown");
    expect(t.list(null)).toHaveLength(0);
  });

  it("keeps its metadata and times for the list", async () => {
    const t = table();
    const s = await made(t);
    t.end(s.id, "released");
    const j = t.json(s);
    expect(j).toMatchObject({ id: s.id, status: "COMPLETED", userMetadata: ASK.userMetadata, keepAlive: false, proxyBytes: 0, contextId: null, region: "us-east-1" });
    expect(typeof j.endedAt).toBe("string");
  });
});

describe("the connect claim", () => {
  it("401 a wrong token, 404 unknown, 409 once connected, during and after", async () => {
    const t = table();
    const s = await made(t);
    const tok = connectToken(bootKey, s.id);
    expect(t.claim("00000000-0000-4000-8000-000000000000", tok)).toEqual({ ok: false, status: 404 });
    expect(t.claim(s.id, "wrong")).toEqual({ ok: false, status: 401 });
    expect(t.claim(s.id, tok).ok).toBe(true);
    expect(t.claim(s.id, tok)).toEqual({ ok: false, status: 409 });
    t.clientGone(s.id);
    expect(t.claim(s.id, tok)).toEqual({ ok: false, status: 409 });
    expect(t.claim(s.id, "wrong")).toEqual({ ok: false, status: 401 });
  });

  it("404 for a session that ended without a client", async () => {
    const t = table();
    const s = await made(t);
    t.release(s.id);
    expect(t.claim(s.id, connectToken(bootKey, s.id))).toEqual({ ok: false, status: 404 });
  });
});

describe("the state file (6.4)", () => {
  it("is written at each start and end, naming the process only: no token, no metadata", async () => {
    const t = table();
    const s = await made(t);
    expect(state.writes.at(-1)?.sessions).toEqual([{ id: s.id, pid: 4242, pgid: 4242, started: "Tue Oct 20 10:00:00 2026", profile: `/state/profiles/${s.id}` }]);
    const before = state.writes.length;
    t.release(s.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.writes.length).toBeGreaterThan(before);
    expect(state.writes.at(-1)?.sessions).toEqual([]);
    const all = JSON.stringify(state.writes);
    expect(all).not.toContain(connectToken(bootKey, s.id));
    expect(all).not.toContain("row-secret-value");
    expect(all).not.toContain("workwrk-tag");
  });

  it("at start: what the last run named is reaped, then every stray, then an empty state", async () => {
    const prev = { v: 1, boot: "b", mode: "process", sessions: [{ id: "old", pid: 99, pgid: 99, started: "x", profile: "/state/profiles/old" }] };
    state = fakeState(prev);
    const t = table();
    expect(await t.recover()).toBe(1);
    expect(launcher.reap).toHaveBeenCalledWith(prev.sessions);
    expect(launcher.kept).toEqual([[]]);
    expect(state.writes.at(-1)?.sessions).toEqual([]);
  });

  it("with no state file (a reboot, or a stop and start, which clear the runtime folder it lives in), still sweeps everything of ours", async () => {
    state = fakeState(null);
    const t = table();
    await t.recover();
    expect(launcher.reap).not.toHaveBeenCalled();
    // The sweep with nothing kept: every labelled container and network goes, whatever the state file knew.
    expect(launcher.kept).toEqual([[]]);
    expect(state.writes.at(-1)?.sessions).toEqual([]);
  });

  it("the minute's sweep keeps what a live session owns", async () => {
    const t = table();
    const a = await made(t);
    const b = await made(t);
    t.release(b.id);
    await vi.advanceTimersByTimeAsync(0);
    await t.tick();
    expect(launcher.kept.at(-1)).toEqual([a.id]);
  });

  it("the sweep reads what it keeps when it acts: a create that lands during its listing is kept (MEDIUM 1)", async () => {
    const t = table();
    const a = await made(t);
    launcher.sweepGate = gate();
    const ticking = t.tick();
    await vi.advanceTimersByTimeAsync(0);
    // While the sweep waits on its process listing: one create answers, one is still launching.
    const b = await made(t);
    launcher.gate = gate();
    const c = t.create(ASK);
    await vi.advanceTimersByTimeAsync(0);
    const starting = t.all().find((s) => s.status === "starting");
    launcher.sweepGate.open();
    await ticking;
    expect(new Set(launcher.kept.at(-1))).toEqual(new Set([a.id, b.id, starting!.id]));
    launcher.gate.open();
    expect((await c).ok).toBe(true);
  });

  it("a launch in flight stays kept after proof mode's reset forgets it", async () => {
    const t = table();
    launcher.gate = gate();
    const c = t.create(ASK);
    await vi.advanceTimersByTimeAsync(0);
    const id = t.all()[0].id;
    t.reset();
    await t.tick();
    expect(launcher.kept.at(-1)).toEqual([id]);
    launcher.gate.open();
    await c;
    await vi.advanceTimersByTimeAsync(0);
    await t.tick();
    expect(launcher.kept.at(-1)).toEqual([]);
  });
});

describe("a session ended while it starts", () => {
  it("has its Chrome stopped once the launch answers (a reset or a shutdown)", async () => {
    const t = table();
    launcher.gate = gate();
    const p = t.create(ASK);
    await vi.advanceTimersByTimeAsync(0);
    t.reset();
    launcher.gate.open();
    expect(await p).toEqual({ ok: false, status: 503, error: "unavailable", why: "draining" });
    expect(launcher.launched[0].stop).toHaveBeenCalledTimes(1);
    expect(t.all()).toHaveLength(0);
  });
});

describe("a shutdown (MEDIUM 2)", () => {
  it("waits for a launch in flight, stops its Chrome, sweeps what is left, then writes the state", async () => {
    state = fakeState(null, launcher.events);
    const t = table();
    const live = await made(t);
    launcher.gate = gate();
    const c = t.create(ASK);
    await vi.advanceTimersByTimeAsync(0);
    launcher.events.length = 0;
    let done = false;
    const down = t.shutdown().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3_000);
    // The launch has not answered: the shutdown is still waiting for it.
    expect(done).toBe(false);
    expect(launcher.launched[0].stop).toHaveBeenCalledTimes(1);
    expect(launcher.launched[0].id).toBe(live.id);
    launcher.gate.open();
    expect(await c).toEqual({ ok: false, status: 503, error: "unavailable", why: "draining" });
    await down;
    expect(launcher.launched[1].stop).toHaveBeenCalledTimes(1);
    expect(launcher.kept.at(-1)).toEqual([]);
    expect(launcher.events.slice(-2)).toEqual(["sweep", "state"]);
    expect(state.writes.at(-1)?.sessions).toEqual([]);
  });

  it("refuses a create once it has begun", async () => {
    const t = table();
    const down = t.shutdown();
    expect(await t.create(ASK)).toEqual({ ok: false, status: 503, error: "unavailable", why: "draining" });
    await down;
  });
});

describe("the clocks start at the create (6.1)", () => {
  it("never_connected counts from the create, not from the launch's answer", async () => {
    const t = table(3, { connectSeconds: 5 });
    launcher.gate = gate();
    const c = t.create(ASK);
    await vi.advanceTimersByTimeAsync(3_000);
    launcher.gate.open();
    const r = await c;
    if (!r.ok) throw new Error("not made");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(r.session.endReason).toBe("never_connected");
  });

  it("the timeout counts from the create too, and expiresAt says so", async () => {
    const t = table();
    launcher.gate = gate();
    const c = t.create({ ...ASK, timeoutSeconds: 120 });
    await vi.advanceTimersByTimeAsync(4_000);
    launcher.gate.open();
    const r = await c;
    if (!r.ok) throw new Error("not made");
    t.claim(r.session.id, connectToken(bootKey, r.session.id));
    expect(Date.parse(String(t.json(r.session).expiresAt)) - Date.parse(r.session.createdAt)).toBe(120_000);
    await vi.advanceTimersByTimeAsync(116_000);
    expect(r.session.endReason).toBe("timeout");
  });

  it("a launch slower than its window answers 503 and its Chrome is stopped", async () => {
    const t = table(3, { connectSeconds: 5 });
    launcher.gate = gate();
    const c = t.create(ASK);
    await vi.advanceTimersByTimeAsync(6_000);
    launcher.gate.open();
    expect(await c).toEqual({ ok: false, status: 503, error: "unavailable", why: "chrome_did_not_start" });
    expect(launcher.launched[0].stop).toHaveBeenCalledTimes(1);
  });
});

describe("the claim without spending (the proxy's check before the handshake)", () => {
  it("checks the token and the flag, and leaves the token unspent", async () => {
    const t = table();
    const s = await made(t);
    const tok = connectToken(bootKey, s.id);
    expect(t.claim(s.id, "wrong", false)).toEqual({ ok: false, status: 401 });
    expect(t.claim(s.id, tok, false).ok).toBe(true);
    expect(t.claim(s.id, tok, false).ok).toBe(true);
    expect(s.connected).toBe(false);
    expect(t.claim(s.id, tok).ok).toBe(true);
    expect(t.claim(s.id, tok, false)).toEqual({ ok: false, status: 409 });
  });
});
