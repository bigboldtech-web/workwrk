import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  apiFetchWithRetry,
  backoffDelayMs,
  defaultErrorFor,
  parseErrorBody,
  shouldRetry,
  SESSION_EXPIRED_ERROR,
  type ApiFail,
} from "./api-fetch";
import { isSessionExpired, resetSessionExpired } from "./session-expiry";

describe("parseErrorBody", () => {
  it("reads { error } from a JSON body", () => {
    expect(parseErrorBody(400, "application/json", '{"error":"Invalid body","issues":[1]}')).toEqual({
      error: "Invalid body",
      issues: [1],
    });
  });
  it("reads { message } when there is no error key", () => {
    expect(parseErrorBody(500, "application/json; charset=utf-8", '{"message":"boom"}').error).toBe("boom");
  });
  it("keeps a short plain-text body (the /api/realtime 401 shape)", () => {
    expect(parseErrorBody(401, "text/plain", "Unauthorized").error).toBe("Unauthorized");
  });
  it("falls back to a status message for HTML or empty bodies", () => {
    expect(parseErrorBody(500, "text/html", "<html>oops</html>").error).toBe(defaultErrorFor(500));
    expect(parseErrorBody(404, null, "").error).toBe("Not found");
    expect(parseErrorBody(401, "application/json", "{broken").error).toBe(SESSION_EXPIRED_ERROR);
  });
});

describe("retry policy", () => {
  const fail = (status: number, offline?: boolean): ApiFail => ({ ok: false, status, error: "x", offline });
  it("retries offline and 5xx only", () => {
    expect(shouldRetry(fail(0, true))).toBe(true);
    expect(shouldRetry(fail(503))).toBe(true);
    expect(shouldRetry(fail(500))).toBe(true);
    expect(shouldRetry(fail(401))).toBe(false);
    expect(shouldRetry(fail(400))).toBe(false);
    expect(shouldRetry(fail(404))).toBe(false);
  });
  it("never re-sends a write on its own, whatever the failure", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "post"]) {
      expect(shouldRetry(fail(0, true), method)).toBe(false);
      expect(shouldRetry(fail(503), method)).toBe(false);
    }
    expect(shouldRetry(fail(503), "GET")).toBe(true);
    expect(shouldRetry(fail(503), "head")).toBe(true);
    expect(shouldRetry(fail(503), undefined)).toBe(true);
  });
  it("re-sends a write only when the caller opted in (server-side de-duplication)", () => {
    expect(shouldRetry(fail(503), "POST", true)).toBe(true);
    expect(shouldRetry(fail(0, true), "PATCH", true)).toBe(true);
    expect(shouldRetry(fail(400), "POST", true)).toBe(false);
    expect(shouldRetry(fail(401), "POST", true)).toBe(false);
  });
  it("backs off exponentially with bounded jitter", () => {
    expect(backoffDelayMs(0, 600, () => 0)).toBe(600);
    expect(backoffDelayMs(1, 600, () => 0)).toBe(1200);
    expect(backoffDelayMs(2, 600, () => 1)).toBe(3000);
    expect(backoffDelayMs(10, 600, () => 0)).toBe(10_000);
  });
});

describe("apiFetch", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => resetSessionExpired());
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetSessionExpired();
  });

  function respond(status: number, body: string, contentType = "application/json") {
    return new Response(body, { status, headers: { "content-type": contentType } });
  }

  it("returns ok with parsed JSON", async () => {
    globalThis.fetch = vi.fn(async () => respond(200, '{"a":1}')) as typeof fetch;
    const r = await apiFetch<{ a: number }>("/api/x");
    expect(r).toEqual({ ok: true, status: 200, data: { a: 1 } });
  });

  it("refuses an HTML page served at 200 from an /api/ path", async () => {
    // The dashboard catch-all renders its not-found PAGE at HTTP 200 for any
    // path it does not know, /api/** included. Reporting that as success let
    // a write to a missing route answer ok:true while nothing was written.
    globalThis.fetch = vi.fn(async () => respond(200, "<!DOCTYPE html><html lang=\"en\"></html>", "text/html")) as typeof fetch;
    const r = await apiFetch("/api/agreements/x/parties/y", { method: "DELETE" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(200);
  });

  it("catches the HTML page even when the content type is missing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("<html><body>nope</body></html>", { status: 200 })) as typeof fetch;
    const r = await apiFetch("/api/nope");
    expect(r.ok).toBe(false);
  });

  it("still returns a plain-text API body as data", async () => {
    globalThis.fetch = vi.fn(async () => respond(200, "pong", "text/plain")) as typeof fetch;
    const r = await apiFetch<string>("/api/ping");
    expect(r).toEqual({ ok: true, status: 200, data: "pong" });
  });

  it("leaves non-API URLs alone", async () => {
    globalThis.fetch = vi.fn(async () => respond(200, "<!DOCTYPE html><html></html>", "text/html")) as typeof fetch;
    const r = await apiFetch<string>("/share/doc/abc");
    expect(r.ok).toBe(true);
  });

  it("JSON-encodes the json option and sets the content type", async () => {
    const spy = vi.fn(async () => respond(200, "{}"));
    globalThis.fetch = spy as unknown as typeof fetch;
    await apiFetch("/api/x", { method: "PATCH", json: { home: { cards: [] } } });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"home":{"cards":[]}}');
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("returns a typed failure for a 4xx and keeps the route's message and issues", async () => {
    globalThis.fetch = vi.fn(async () => respond(400, '{"error":"Invalid body","issues":[{"path":["inbox"]}]}')) as typeof fetch;
    const r = await apiFetch("/api/x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toBe("Invalid body");
      expect(r.issues).toEqual([{ path: ["inbox"] }]);
    }
  });

  it("marks the session expired on a 401 (plain-text body included) and short-circuits afterwards", async () => {
    const spy = vi.fn(async () => respond(401, "Unauthorized", "text/plain"));
    globalThis.fetch = spy as unknown as typeof fetch;
    const first = await apiFetch("/api/realtime");
    expect(first.ok).toBe(false);
    expect(first.ok ? null : first.status).toBe(401);
    expect(isSessionExpired()).toBe(true);
    const second = await apiFetch("/api/inbox/count");
    expect(second.ok ? null : second.status).toBe(401);
    // the poller never hit the network again
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports a network failure as offline without throwing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const r = await apiFetch("/api/x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.offline).toBe(true);
      expect(r.status).toBe(0);
    }
  });
});

describe("apiFetchWithRetry", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => resetSessionExpired());
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetSessionExpired();
  });

  function flakyServer(failures: number) {
    let n = 0;
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      n++;
      return n <= failures
        ? new Response('{"error":"down"}', { status: 503, headers: { "content-type": "application/json" } })
        : new Response('{"ok":1}', { status: 200, headers: { "content-type": "application/json" } });
    });
    return { fetchImpl, bodies };
  }

  it("retries a read through a 503 then succeeds", async () => {
    const { fetchImpl } = flakyServer(2);
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const r = await apiFetchWithRetry("/api/x", {}, { sleep: async () => {} });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("sends a write ONCE on a 503 and hands the draft back for a user-driven Retry (no duplicate submit)", async () => {
    const { fetchImpl } = flakyServer(1);
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const draft = { text: "draft" };
    const r = await apiFetchWithRetry("/api/x", { method: "POST", json: draft }, { sleep: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.draft).toBe(draft);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends a write once when the connection drops, too", async () => {
    const spy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await apiFetchWithRetry("/api/x", { method: "PATCH", json: { a: 1 } }, { sleep: async () => {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offline).toBe(true);
    expect(r.attempts).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-sends a write, same bytes every time, only with retryWrites", async () => {
    const { fetchImpl, bodies } = flakyServer(2);
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const r = await apiFetchWithRetry("/api/x", { method: "POST", json: { text: "draft" } }, { sleep: async () => {}, retryWrites: true });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(new Set(bodies).size).toBe(1);
  });

  it("hands the draft back untouched on final failure and never retries a 400", async () => {
    const spy = vi.fn(async () => new Response('{"error":"bad"}', { status: 400, headers: { "content-type": "application/json" } }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const draft = { text: "keep me" };
    const r = await apiFetchWithRetry("/api/x", { method: "POST", json: draft }, { sleep: async () => {}, retryWrites: true });
    expect(r.ok).toBe(false);
    expect(r.draft).toBe(draft);
    expect(r.attempts).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
