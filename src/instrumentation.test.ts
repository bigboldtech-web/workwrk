// The server's start hooks (src/instrumentation.ts): the browsers' boot
// recovery (browser host final review, contract M2) runs once, 15 seconds
// after the server starts, on a timer that never holds the process, and
// only in the Node runtime. Its module is loaded only when it runs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ recovered: 0, loaded: 0 }));

vi.mock("@/lib/staff-audit", () => ({ startOwedReplay: async () => undefined }));
vi.mock("@/lib/local-uploads", () => ({ moveLegacyUploads: async () => ({ moved: 0, left: 0 }) }));
vi.mock("@/lib/browser/sessions", () => {
  st.loaded += 1;
  return {
    recoverBrowsersAtBoot: async () => {
      st.recovered += 1;
      return null;
    },
  };
});

import { register } from "./instrumentation";

const runtime = process.env.NEXT_RUNTIME;

beforeEach(() => {
  vi.useFakeTimers();
  st.recovered = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (runtime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = runtime;
});

describe("register", () => {
  it("runs the browsers' boot recovery once, 15 seconds after the server starts, on an unref'd timer", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const timers: Array<{ ms: number | undefined; handle: { hasRef?: () => boolean } }> = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      const handle = real(fn, ms) as unknown as { hasRef?: () => boolean };
      timers.push({ ms, handle });
      return handle;
    }) as unknown as typeof setTimeout);
    await register();
    const recovery = timers.find((t) => t.ms === 15_000);
    expect(recovery).toBeDefined();
    // Never holds the server from exiting.
    expect(recovery?.handle.hasRef?.()).toBe(false);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(st.recovered).toBe(0);
    // Its module is loaded only then, never on the way to ready.
    expect(st.loaded).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(st.recovered).toBe(1));
    expect(st.loaded).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(st.recovered).toBe(1);
  });

  it("runs nothing in the edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(st.recovered).toBe(0);
  });
});
