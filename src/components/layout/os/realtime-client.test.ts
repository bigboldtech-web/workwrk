// RealtimeClient's reconnect (2026-10-22, review of the longer-sessions fix,
// L5). EventSource closes for good on a non-200 answer, and the client probes
// a cheap endpoint to tell why: a 401 the session route confirmed (the
// session is marked expired) keeps it closed, and anything else, a 401 from
// a person still signed in included, reconnects with backoff.
//
// The suite runs in node with no DOM: React's useEffect is stood in for (run
// at once, its cleanup kept), and EventSource by a fake that records each
// stream the client opens.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", () => ({
  useEffect: (fn: () => void | (() => void)) => {
    const c = fn();
    if (typeof c === "function") h.cleanups.push(c);
  },
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated" }) }));

const st = vi.hoisted(() => ({ expired: false, probe: { ok: false, status: 401, error: "x" } as { ok: boolean; status: number; error?: string } }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => st.probe }));
vi.mock("@/lib/session-expiry", () => ({ isSessionExpired: () => st.expired, SESSION_EXPIRED_EVENT: "workwrk:session-expired" }));

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.opened.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  /** The server answered with a non-200: the browser gives up on the stream. */
  refuse() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

import { RealtimeClient } from "./realtime-client";

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.opened = [];
  st.expired = false;
  st.probe = { ok: false, status: 401, error: "x" };
  h.cleanups = [];
});
afterEach(() => {
  for (const c of h.cleanups) c();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RealtimeClient", () => {
  it("reconnects after a 401 the session route did not confirm: the person is still signed in", async () => {
    RealtimeClient();
    expect(FakeEventSource.opened).toHaveLength(1);
    FakeEventSource.opened[0].refuse();
    await flush();
    await vi.advanceTimersByTimeAsync(1_300);
    expect(FakeEventSource.opened).toHaveLength(2);
    expect(FakeEventSource.opened[1].url).toBe("/api/realtime");
  });

  it("reconnects after a server hiccup, waiting longer each time", async () => {
    st.probe = { ok: false, status: 502 };
    RealtimeClient();
    FakeEventSource.opened[0].refuse();
    await flush();
    await vi.advanceTimersByTimeAsync(1_300);
    expect(FakeEventSource.opened).toHaveLength(2);
    FakeEventSource.opened[1].refuse();
    await flush();
    await vi.advanceTimersByTimeAsync(1_300);
    expect(FakeEventSource.opened).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_400);
    expect(FakeEventSource.opened).toHaveLength(3);
  });

  it("stays closed after a log out the session route confirmed", async () => {
    RealtimeClient();
    st.expired = true;
    FakeEventSource.opened[0].refuse();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.opened).toHaveLength(1);
  });
});
