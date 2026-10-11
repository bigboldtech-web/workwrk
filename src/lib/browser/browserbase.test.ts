// The provider's API (src/lib/browser/browserbase.ts), fetch mocked: the
// create asks for a fresh browser with recording off, tagged with this
// deployment and limited to its minutes plus one; a create that times out is
// tried once and answers unknown_outcome; a release of a gone session is
// "already"; a live view from another origin is refused; and no log line
// holds the key or an address.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderSession, listRunningProviderSessions, liveViewUrl, releaseProviderSession } from "./browserbase";
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
  testTimes: { sessionSeconds: null, idleSeconds: null, waitSeconds: null },
};
const RELEASE: BrowserReleaseConfig = { provider: "browserbase", apiKey: "bb-secret-key", projectId: "proj-1", apiBase: "https://api.browserbase.com", deploymentTag: "workwrk-prod", standIn: false };

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
    expect(await liveViewUrl(CFG, "bb-1")).toMatchObject({ ok: true });
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/sessions/bb-1/debug");
    answer = json({ debuggerFullscreenUrl: "https://evil.example.com/inspector.html" });
    expect(await liveViewUrl(CFG, "bb-1")).toEqual({ ok: false, failure: "refused" });
    expect(await liveViewUrl(CFG, "../other")).toEqual({ ok: false, failure: "not_found" });
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

describe("the logs", () => {
  it("never hold the key, a connect address or a live view address", async () => {
    answer = json({}, 500);
    await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 });
    await releaseProviderSession(RELEASE, "bb-1");
    answer = json({ debuggerFullscreenUrl: "https://evil.example.com/x?token=live-secret" });
    await liveViewUrl(CFG, "bb-1");
    answer = json({ id: "bb-1", connectUrl: "https://connect.browserbase.com?signingKey=sk-secret" });
    await createProviderSession(CFG, { rowId: "r", timeoutSeconds: 960 });
    expect(errors.length).toBeGreaterThan(0);
    for (const line of errors) {
      expect(line).toMatch(/^\[browser\] provider \w+ \w+ (\d+|-)$/);
      expect(line).not.toContain("bb-secret-key");
      expect(line).not.toContain("sk-secret");
      expect(line).not.toContain("live-secret");
    }
  });
});
