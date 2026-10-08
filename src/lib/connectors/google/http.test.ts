// One call to Gmail or Google Calendar (docs/plans/ai-teammates-phase3.md
// step 2): the token kept fresh, a write never sent twice, a revoked grant
// marked once, WorkwrK's own credentials never blamed on the person, and logs
// that hold no token and no body.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("../connector-test-db")).connectorDb }));

import { cdb, resetConnectorDb, seedConnection } from "../connector-test-db";
import type { LiveConnection } from "../connections";
import { openToken, sealToken } from "../seal";
import type { GoogleConfig } from "./config";
import { googleCall } from "./http";

const CFG: GoogleConfig = {
  clientId: "cid",
  clientSecret: "client-secret-value",
  authUrl: "https://g.test/o/oauth2/v2/auth",
  tokenUrl: "https://g.test/token",
  revokeUrl: "https://g.test/revoke",
  gmailBase: "https://g.test/gmail/v1",
  calendarBase: "https://g.test/calendar/v3",
  products: ["gmail", "calendar"],
  standIn: true,
};

const GMAIL = "https://g.test/gmail/v1/users/me/messages?q=invoice";

type Reply = { status: number; json?: unknown } | "timeout";

/** fetch answered in order; each call recorded with its URL, method and headers. */
function fetchQueue(replies: Reply[]) {
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: headers.get("authorization") });
    const r = replies.shift();
    if (!r) throw new Error("no reply queued");
    if (r === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

function connection(o: { expiresInMs?: number } = {}): LiveConnection {
  const row = seedConnection({
    organizationId: "org1",
    userId: "u-max",
    accountSub: "sub-max",
    refreshTokenSealed: sealToken("refresh-token-value"),
    accessTokenSealed: sealToken("access-token-value"),
    accessTokenExpiresAt: new Date(Date.now() + (o.expiresInMs ?? 3_600_000)),
  });
  return {
    id: String(row.id),
    organizationId: "org1",
    userId: "u-max",
    provider: "google",
    status: "active",
    products: ["gmail", "calendar"],
    accountSub: "sub-max",
    accountEmail: "max@mail.test",
    tokenVersion: 1,
    accessTokenSealed: row.accessTokenSealed,
    accessTokenExpiresAt: row.accessTokenExpiresAt as Date,
    refreshTokenSealed: row.refreshTokenSealed,
    lastUsedAt: null,
  };
}

let logs: string[] = [];

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "b".repeat(64);
  resetConnectorDb();
  logs = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("googleCall", () => {
  it("refreshes once on a 401 and sends the request once more, with the new token", async () => {
    const { calls } = fetchQueue([{ status: 401 }, { status: 200, json: { access_token: "fresh-access-token", expires_in: 3600 } }, { status: 200, json: { messages: [] } }]);
    const conn = connection();
    const r = await googleCall<{ messages: unknown[] }>(conn, CFG, { method: "GET", url: GMAIL, write: false });
    expect(r).toEqual({ ok: true, data: { messages: [] }, etag: null });
    expect(calls.map((c) => c.url)).toEqual([GMAIL, CFG.tokenUrl, GMAIL]);
    expect(calls[0].auth).toBe("Bearer access-token-value");
    expect(calls[2].auth).toBe("Bearer fresh-access-token");
    // Stored by the swap on the tokenVersion it read.
    expect(openToken(cdb.connections[0].accessTokenSealed)).toBe("fresh-access-token");
  });

  it("answers unknown_outcome for a write that timed out, after one fetch and no retry", async () => {
    const { fn } = fetchQueue(["timeout", { status: 200, json: {} }]);
    const r = await googleCall(connection(), CFG, { method: "POST", url: "https://g.test/gmail/v1/users/me/messages/send", body: { raw: "x" }, write: true });
    expect(r).toEqual({ ok: false, failure: "unknown_outcome" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("answers unknown_outcome, not try again, for a write met with a 5xx", async () => {
    const { fn } = fetchQueue([{ status: 503 }]);
    const r = await googleCall(connection(), CFG, { method: "POST", url: "https://g.test/gmail/v1/users/me/messages/send", body: { raw: "x" }, write: true });
    expect(r).toEqual({ ok: false, failure: "unknown_outcome" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("tries a read that timed out once more", async () => {
    const { fn } = fetchQueue(["timeout", { status: 200, json: { ok: 1 } }]);
    const r = await googleCall(connection(), CFG, { method: "GET", url: GMAIL, write: false });
    expect(r).toMatchObject({ ok: true, data: { ok: 1 } });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("marks the connection needs_reconnect on invalid_grant, once, and calls nothing else", async () => {
    const { calls } = fetchQueue([{ status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
    const conn = connection({ expiresInMs: 10_000 });
    const r = await googleCall(conn, CFG, { method: "GET", url: GMAIL, write: false });
    expect(r).toEqual({ ok: false, failure: "needs_reconnect" });
    expect(calls.map((c) => c.url)).toEqual([CFG.tokenUrl]);
    expect(cdb.connections[0]).toMatchObject({ status: "needs_reconnect", statusReason: "revoked" });
    expect(cdb.notifications).toHaveLength(1);
    expect(cdb.activity.filter((a) => a.type === "teammate_connection.needs_reconnect")).toHaveLength(1);
  });

  it("marks nothing on invalid_client: WorkwrK's own credentials are never the person's fault", async () => {
    fetchQueue([{ status: 401, json: { error: "invalid_client" } }]);
    const r = await googleCall(connection({ expiresInMs: 10_000 }), CFG, { method: "GET", url: GMAIL, write: false });
    expect(r).toEqual({ ok: false, failure: "client" });
    expect(cdb.connections[0].status).toBe("active");
    expect(cdb.notifications).toHaveLength(0);
  });

  it("marks nothing when Google's token endpoint is down", async () => {
    fetchQueue([{ status: 503 }]);
    const r = await googleCall(connection({ expiresInMs: 10_000 }), CFG, { method: "GET", url: GMAIL, write: false });
    expect(r).toEqual({ ok: false, failure: "unavailable" });
    expect(cdb.connections[0].status).toBe("active");
  });

  it("answers changed for a 412 on an event changed since", async () => {
    const { calls } = fetchQueue([{ status: 412, json: { error: { code: 412, message: "Precondition Failed" } } }]);
    const r = await googleCall(connection(), CFG, { method: "PATCH", url: "https://g.test/calendar/v3/calendars/primary/events/e1", body: { summary: "x" }, ifMatch: '"etag-1"', write: true });
    expect(r).toEqual({ ok: false, failure: "changed" });
    expect(calls).toHaveLength(1);
  });

  it("maps a 429 to rate_limited with Google's wait, and a missing scope to needs_reconnect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 429 } }), { status: 429, headers: { "retry-after": "17", "content-type": "application/json" } })),
    );
    expect(await googleCall(connection(), CFG, { method: "GET", url: GMAIL, write: false })).toEqual({ ok: false, failure: "rate_limited", retryAfter: 17 });
    resetConnectorDb();
    fetchQueue([{ status: 403, json: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } } }]);
    expect(await googleCall(connection(), CFG, { method: "GET", url: GMAIL, write: false })).toEqual({ ok: false, failure: "scope_missing" });
    expect(cdb.connections[0]).toMatchObject({ status: "needs_reconnect", statusReason: "scopes_missing" });
  });

  it("logs the failure kind and the status only: no token, no body, no address", async () => {
    fetchQueue([{ status: 403, json: { error: { code: 403, message: "secret-body-text max@mail.test", errors: [{ reason: "forbidden" }] } } }]);
    await googleCall(connection(), CFG, { method: "GET", url: GMAIL, write: false });
    fetchQueue([{ status: 400, json: { error: "invalid_grant", error_description: "secret-body-text" } }]);
    resetConnectorDb();
    await googleCall(connection({ expiresInMs: 1000 }), CFG, { method: "GET", url: GMAIL, write: false });
    fetchQueue(["timeout"]);
    await googleCall(connection(), CFG, { method: "POST", url: GMAIL, body: { raw: "secret-body-text" }, write: true });
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).toMatch(/^\[connectors\] google [a-z_]+ [a-z0-9_]+$/);
      for (const secret of ["access-token-value", "refresh-token-value", "client-secret-value", "secret-body-text", "max@mail.test", "invoice"]) expect(line).not.toContain(secret);
    }
  });
});
