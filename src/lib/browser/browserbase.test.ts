// The provider's API (src/lib/browser/browserbase.ts), fetch mocked: the
// create asks for a fresh browser with recording off, tagged with this
// deployment and limited to its minutes plus one; a create that times out is
// tried once and answers unknown_outcome; a release of a gone session is
// "already"; a live view from another origin is refused; and no log line
// holds the key or an address.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderSession, hostHealth, listRunningProviderSessions, liveViewUrl, PROVIDER_TIMEOUT_MS, releaseProviderSession, revokeLiveViews } from "./browserbase";
import type { BrowserConfig, BrowserReleaseConfig } from "./config";

const CFG: BrowserConfig = {
  provider: "browserbase",
  apiKey: "bb-secret-key",
  projectId: "proj-1",
  apiBase: "https://api.browserbase.com",
  region: "eu-central-1",
  deploymentTag: "workwrk-prod",
  maxAtOnce: 10,
  priceCentsPerHour: null,
  shotsDir: "/var/lib/workwrk/browser-shots",
  liveViewOrigins: ["https://www.browserbase.com"],
  standIn: false,
  testTimes: { sessionSeconds: null, idleSeconds: null, waitSeconds: null, takeOverSeconds: null },
};
const RELEASE: BrowserReleaseConfig = { provider: "browserbase", apiKey: "bb-secret-key", projectId: "proj-1", apiBase: "https://api.browserbase.com", deploymentTag: "workwrk-prod", standIn: false };

// Our own host (docs/plans/browser-host.md 9.2): in production, and on this machine as the stand-in.
const HOST: BrowserConfig = { ...CFG, provider: "workwrk", apiKey: "host-secret-key", projectId: "workwrk", apiBase: "https://browsers.workwrkbrowsers.com", liveViewOrigins: ["https://browsers.workwrkbrowsers.com"] };
const STAND_IN: BrowserConfig = { ...CFG, provider: "stand-in", apiKey: "stand-in", projectId: "stand-in", apiBase: "http://127.0.0.1:8789", liveViewOrigins: ["http://127.0.0.1:8789"], standIn: true };
const HOST_RELEASE: BrowserReleaseConfig = { provider: "workwrk", apiKey: "host-secret-key", projectId: "workwrk", apiBase: "https://browsers.workwrkbrowsers.com", deploymentTag: "workwrk-prod", standIn: false };
const STAND_IN_RELEASE: BrowserReleaseConfig = { provider: "stand-in", apiKey: "stand-in", projectId: "stand-in", apiBase: "http://127.0.0.1:8789", deploymentTag: "workwrk", standIn: true };

const calls: Array<{ url: string; init: RequestInit }> = [];
let answer: () => Promise<Response> = async () => new Response("{}", { status: 200 });
let errors: string[] = [];

beforeEach(() => {
  calls.length = 0;
  errors = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => async () => new Response(JSON.stringify(body), { status, headers });

describe("createProviderSession", () => {
  it("asks for a fresh browser with recording and logging off, keepAlive false, the tag and the minutes plus one", async () => {
    answer = json({ id: "bb-123", connectUrl: "wss://connect.browserbase.com?signingKey=sk-secret" });
    const out = await createProviderSession(CFG, { rowId: "row-1", timeoutSeconds: 15 * 60 + 60 });
    expect(out).toEqual({ ok: true, data: { providerSessionId: "bb-123", connectUrl: "wss://connect.browserbase.com?signingKey=sk-secret" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/sessions");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["X-BB-API-Key"]).toBe("bb-secret-key");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      projectId: "proj-1",
      region: "eu-central-1",
      timeout: 960,
      keepAlive: false,
      browserSettings: { viewport: { width: 1280, height: 800 }, recordSession: false, logSession: false, blockAds: true },
      userMetadata: { wk: "workwrk-prod", row: "row-1" },
    });
  });

  it("answers unknown_outcome after one fetch when the create times out, and never retries", async () => {
    answer = async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    expect(await createProviderSession(CFG, { rowId: "row-1", timeoutSeconds: 960 })).toEqual({ ok: false, failure: "unknown_outcome" });
    expect(calls).toHaveLength(1);
  });

  it("maps the provider's refusals, a 429 with its Retry-After", async () => {
    answer = json({ error: "busy" }, 429, { "retry-after": "7" });
    expect(await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 })).toEqual({ ok: false, failure: "rate_limited", retryAfter: 7 });
    answer = json({}, 401);
    expect(await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 })).toMatchObject({ ok: false, failure: "client" });
    answer = json({}, 503);
    expect(await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 })).toMatchObject({ ok: false, failure: "unavailable" });
    answer = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 })).toMatchObject({ ok: false, failure: "unavailable" });
  });

  it("refuses an answer with no session id or a connect address that is not a websocket one", async () => {
    answer = json({ id: "bb-1", connectUrl: "https://connect.browserbase.com" });
    expect(await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 })).toEqual({ ok: false, failure: "unknown_outcome" });
    answer = json({ connectUrl: "wss://connect.browserbase.com" });
    expect(await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 })).toEqual({ ok: false, failure: "unknown_outcome" });
  });
});

describe("liveViewUrl", () => {
  it("answers the provider's own live view, and refuses one of another origin", async () => {
    answer = json({ debuggerFullscreenUrl: "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com/debug/x" });
    expect(await liveViewUrl(CFG, "bb-1", "watch")).toMatchObject({ ok: true });
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/sessions/bb-1/debug");
    answer = json({ debuggerFullscreenUrl: "https://evil.example.com/inspector.html" });
    expect(await liveViewUrl(CFG, "bb-1", "watch")).toEqual({ ok: false, failure: "refused" });
    expect(await liveViewUrl(CFG, "../other", "watch")).toEqual({ ok: false, failure: "not_found" });
  });
});

describe("releaseProviderSession", () => {
  it("asks for REQUEST_RELEASE, and reads 404 and 409 as already ended", async () => {
    answer = json({}, 200);
    expect(await releaseProviderSession(RELEASE, "bb-1")).toBe("released");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ projectId: "proj-1", status: "REQUEST_RELEASE" });
    answer = json({}, 404);
    expect(await releaseProviderSession(RELEASE, "bb-1")).toBe("already");
    answer = json({}, 409);
    expect(await releaseProviderSession(RELEASE, "bb-1")).toBe("already");
    answer = json({}, 500);
    expect(await releaseProviderSession(RELEASE, "bb-1")).toBe("failed");
  });
});

describe("listRunningProviderSessions", () => {
  it("reads each running session's tag and row, and leaves the rest", async () => {
    answer = json([
      { id: "a", status: "RUNNING", userMetadata: { wk: "workwrk-prod", row: "row-a" } },
      { id: "b", status: "RUNNING" },
      { id: "c", status: "COMPLETED", userMetadata: { wk: "workwrk-prod", row: "row-c" } },
      { id: "../x", status: "RUNNING" },
    ]);
    expect(await listRunningProviderSessions(RELEASE)).toEqual({
      ok: true,
      data: [
        { providerSessionId: "a", tag: "workwrk-prod", rowId: "row-a" },
        { providerSessionId: "b", tag: null, rowId: null },
      ],
    });
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/sessions?status=RUNNING");
  });
});

describe("a request its caller stops waiting on (follow-up to review round 1 of Phase 4)", () => {
  /** A provider that never answers: the request ends only when its signal aborts, as fetch's does. */
  function neverAnswers() {
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }));
  }
  const signalOf = (i: number) => calls[i].init.signal as AbortSignal;

  it("aborts a release at the caller's timeoutMs, and reads it failed for the sweep to try again", async () => {
    neverAnswers();
    const started = Date.now();
    expect(await releaseProviderSession(RELEASE, "bb-1", { timeoutMs: 40 })).toBe("failed");
    expect(Date.now() - started).toBeLessThan(2_000);
    // Before: the request ran on to its own 10 seconds after the sweep stopped waiting.
    expect(signalOf(0).aborted).toBe(true);
    expect((signalOf(0).reason as Error).name).toBe("TimeoutError");
    expect(errors).toEqual(["[browser] provider release unavailable -"]);
  });

  it("aborts the list at the caller's timeoutMs, and reads it unavailable", async () => {
    neverAnswers();
    expect(await listRunningProviderSessions(RELEASE, { timeoutMs: 40 })).toEqual({ ok: false, failure: "unavailable" });
    expect(signalOf(0).aborted).toBe(true);
  });

  it("never waits past its own 10 seconds, whatever the caller asks, and a create cut short still answers unknown_outcome", async () => {
    vi.useFakeTimers();
    try {
      neverAnswers();
      const releasing = releaseProviderSession(RELEASE, "bb-1", { timeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS - 1);
      expect(signalOf(0).aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await releasing).toBe("failed");
      // No wait given, or none that means anything: its own 10 seconds.
      for (const o of [undefined, { timeoutMs: 0 }, { timeoutMs: Number.NaN }]) {
        const listing = listRunningProviderSessions(RELEASE, o);
        await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS - 1);
        expect(signalOf(calls.length - 1).aborted, JSON.stringify(o)).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await listing).toEqual({ ok: false, failure: "unavailable" });
      }
      const creating = createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 });
      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
      expect(await creating).toEqual({ ok: false, failure: "unknown_outcome" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the logs", () => {
  it("never hold the key, a connect address or a live view address", async () => {
    answer = json({}, 500);
    await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 });
    await releaseProviderSession(RELEASE, "bb-1");
    answer = json({ debuggerFullscreenUrl: "https://evil.example.com/x?token=live-secret" });
    await liveViewUrl(CFG, "bb-1", "control");
    answer = json({}, 500);
    await revokeLiveViews(HOST_RELEASE, "pv-1");
    await hostHealth(HOST_RELEASE);
    answer = json({ id: "bb-1", connectUrl: "https://connect.browserbase.com?signingKey=sk-secret" });
    await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 });
    expect(errors.length).toBeGreaterThan(0);
    for (const line of errors) {
      expect(line).toMatch(/^\[browser\] provider \w+ \w+ (\d+|-)$/);
      expect(line).not.toContain("bb-secret-key");
      expect(line).not.toContain("host-secret-key");
      expect(line).not.toContain("sk-secret");
      expect(line).not.toContain("live-secret");
    }
  });
});

// docs/plans/browser-host.md 9.2 and step 4: the three things only our host is
// asked, and Browserbase never.
describe("our own host's additions", () => {
  it("asks the debug call for ?mode=control and ?mode=watch of workwrk and the stand-in, and no query of Browserbase", async () => {
    answer = json({ debuggerFullscreenUrl: "https://browsers.workwrkbrowsers.com/live/pv-1#t=abc" });
    expect(await liveViewUrl(HOST, "pv-1", "control")).toEqual({ ok: true, data: "https://browsers.workwrkbrowsers.com/live/pv-1#t=abc" });
    expect(await liveViewUrl(HOST, "pv-1", "watch")).toMatchObject({ ok: true });
    answer = json({ debuggerFullscreenUrl: "http://127.0.0.1:8789/live/pv-1#t=abc" });
    expect(await liveViewUrl(STAND_IN, "pv-1", "control")).toMatchObject({ ok: true });
    expect(await liveViewUrl(STAND_IN, "pv-1", "watch")).toMatchObject({ ok: true });
    answer = json({ debuggerFullscreenUrl: "https://www.browserbase.com/devtools-fullscreen/inspector.html" });
    expect(await liveViewUrl(CFG, "bb-1", "control")).toMatchObject({ ok: true });
    expect(await liveViewUrl(CFG, "bb-1", "watch")).toMatchObject({ ok: true });
    // Before: no query was ever sent, so our host answered every view as watch.
    expect(calls.map((c) => c.url)).toEqual([
      "https://browsers.workwrkbrowsers.com/v1/sessions/pv-1/debug?mode=control",
      "https://browsers.workwrkbrowsers.com/v1/sessions/pv-1/debug?mode=watch",
      "http://127.0.0.1:8789/v1/sessions/pv-1/debug?mode=control",
      "http://127.0.0.1:8789/v1/sessions/pv-1/debug?mode=watch",
      "https://api.browserbase.com/v1/sessions/bb-1/debug",
      "https://api.browserbase.com/v1/sessions/bb-1/debug",
    ]);
    for (const c of calls) expect(c.init.method).toBe("GET");
  });

  it("revokes the control views of ours by POST, reads 404 as already and any other failure as failed, and sends Browserbase nothing", async () => {
    answer = json({ revoked: 1 });
    expect(await revokeLiveViews(HOST_RELEASE, "pv-1", { timeoutMs: 4000 })).toBe("revoked");
    expect(calls[0].url).toBe("https://browsers.workwrkbrowsers.com/v1/sessions/pv-1/live-views/revoke");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({});
    expect((calls[0].init.headers as Record<string, string>)["X-BB-API-Key"]).toBe("host-secret-key");
    expect(calls[0].init.redirect).toBe("error");
    expect(await revokeLiveViews(STAND_IN_RELEASE, "pv-1")).toBe("revoked");
    expect(calls[1].url).toBe("http://127.0.0.1:8789/v1/sessions/pv-1/live-views/revoke");
    answer = json({ error: "not_found" }, 404);
    expect(await revokeLiveViews(HOST_RELEASE, "pv-1")).toBe("already");
    answer = json({}, 503);
    expect(await revokeLiveViews(HOST_RELEASE, "pv-1")).toBe("failed");
    answer = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await revokeLiveViews(HOST_RELEASE, "pv-1")).toBe("failed");
    expect(await revokeLiveViews(HOST_RELEASE, "../x")).toBe("already");
    const before = calls.length;
    expect(await revokeLiveViews(RELEASE, "bb-1")).toBe("none");
    expect(calls.length).toBe(before);
  });

  it("reads our host's health defensively, codes only, and sends Browserbase nothing", async () => {
    answer = json({ ok: true, mode: "container", max: 4, counts: { capacityRefusals1h: 0, capacityRefusals24h: 3 }, problems: [] });
    expect(await hostHealth(HOST_RELEASE, { timeoutMs: 4000 })).toEqual({ ok: true, data: { ok: true, problems: [], capacityRefusals24h: 3, max: 4 } });
    expect(calls[0].url).toBe("https://browsers.workwrkbrowsers.com/health");
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>)["X-BB-API-Key"]).toBe("host-secret-key");
    // A problem that is not a code is read as one unreadable code, never its words; ok is true only when said so.
    answer = json({ ok: "yes", max: -1, counts: { capacityRefusals24h: "many" }, problems: ["chrome_stale", "Your key is sk-123", 7, "chrome_stale"] });
    expect(await hostHealth(STAND_IN_RELEASE)).toEqual({ ok: true, data: { ok: false, problems: ["chrome_stale", "unreadable"], capacityRefusals24h: 0, max: 0 } });
    answer = json({ ok: true, problems: "firewall_unchecked" });
    expect(await hostHealth(HOST_RELEASE)).toMatchObject({ ok: true, data: { problems: ["unreadable"] } });
    answer = json([1, 2]);
    expect(await hostHealth(HOST_RELEASE)).toEqual({ ok: false, failure: "unavailable" });
    answer = json({ error: "unauthorized" }, 401);
    expect(await hostHealth(HOST_RELEASE)).toEqual({ ok: false, failure: "client" });
    const before = calls.length;
    expect(await hostHealth(RELEASE)).toEqual({ ok: false, failure: "not_found" });
    expect(calls.length).toBe(before);
  });

  it("refuses a workwrk connect address on another host as unknown_outcome, and takes one on the API's own", async () => {
    answer = json({ id: "pv-1", connectUrl: "wss://browsers.workwrkbrowsers.com/connect/pv-1?t=connect-secret" });
    expect(await createProviderSession(HOST, { rowId: "r", timeoutSeconds: 960 })).toMatchObject({ ok: true, data: { providerSessionId: "pv-1" } });
    for (const elsewhere of [
      "wss://evil.example.com/connect/pv-1?t=x",
      "wss://browsers.workwrkbrowsers.com:8443/connect/pv-1?t=x",
      "wss://other.workwrkbrowsers.com/connect/pv-1?t=x",
      "ws://browsers.workwrkbrowsers.com/connect/pv-1?t=x",
    ]) {
      answer = json({ id: "pv-1", connectUrl: elsewhere });
      // Before: any wss address was taken, wherever it pointed.
      expect(await createProviderSession(HOST, { rowId: "r", timeoutSeconds: 960 }), elsewhere).toEqual({ ok: false, failure: "unknown_outcome" });
    }
    // The stand-in, our host in proof mode, on this machine's own port.
    answer = json({ id: "pv-2", connectUrl: "ws://127.0.0.1:8789/connect/pv-2?t=x" });
    expect(await createProviderSession(STAND_IN, { rowId: "r", timeoutSeconds: 960 })).toMatchObject({ ok: true });
    answer = json({ id: "pv-2", connectUrl: "ws://127.0.0.1:9222/devtools/browser/x" });
    expect(await createProviderSession(STAND_IN, { rowId: "r", timeoutSeconds: 960 })).toEqual({ ok: false, failure: "unknown_outcome" });
    // Browserbase's connect host is its own, never its API's.
    answer = json({ id: "bb-1", connectUrl: "wss://connect.browserbase.com?signingKey=sk" });
    expect(await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 })).toMatchObject({ ok: true });
    for (const line of errors) expect(line).not.toContain("connect-secret");
  });
});
