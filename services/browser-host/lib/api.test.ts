import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApi, HEALTHZ_PROBLEMS } from "./api.mjs";
import { sha256 } from "./config.mjs";
import { liveAssets } from "./live.mjs";
import { SILENT_LOG } from "./log.mjs";

const LIVE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "live");
const APP_ORIGIN = "http://localhost:3016";

const KEY = "the-app-key-0123456789abcdef0123456789";
const MARK = "VALUE_SENT_9f3a";

type Row = { id: string; status: "starting" | "running" | "ending" | "ended"; userMetadata: Record<string, string>; region: string };

/** A fake session table: what the API asks of lib/sessions.mjs, nothing more. */
function fakeTable() {
  const rows = new Map<string, Row>();
  let n = 0;
  const t = {
    next: "ok" as "ok" | 429 | 503,
    asks: [] as unknown[],
    drainingNow: false,
    rows,
    async create(ask: { userMetadata: Record<string, string>; region: string }) {
      t.asks.push(ask);
      if (t.next === 429) return { ok: false as const, status: 429 as const, error: "at_capacity" };
      if (t.next === 503) return { ok: false as const, status: 503 as const, error: "unavailable", why: "chrome_did_not_start" };
      n += 1;
      const row: Row = { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, status: "running", userMetadata: ask.userMetadata, region: ask.region };
      rows.set(row.id, row);
      return { ok: true as const, session: row };
    },
    get: (id: string) => rows.get(id),
    list: (status: "RUNNING" | "COMPLETED" | null) => [...rows.values()].filter((r) => !status || (status === "RUNNING") === (r.status === "running" || r.status === "starting")),
    json: (r: Row) => ({ id: r.id, status: r.status === "running" || r.status === "starting" ? "RUNNING" : "COMPLETED", userMetadata: r.userMetadata, region: r.region, keepAlive: false }),
    release(id: string) {
      const r = rows.get(id);
      if (!r) return "unknown" as const;
      if (r.status !== "running") return "ended" as const;
      r.status = "ended";
      return "released" as const;
    },
    connectUrl: (r: Row) => `ws://127.0.0.1:1/connect/${r.id}?t=token`,
    status: () => ({ max: 2, running: [...rows.values()].filter((r) => r.status === "running").length, starting: 0, held: 0 }),
    counts: () => ({ creates: n, startFailures: 0, ends: {} }),
    draining: () => t.drainingNow,
  };
  return t;
}

let table = fakeTable();
let problems: string[] = [];
let liveAsks: string[] = [];
let revokes: string[] = [];
let server: http.Server;
let base = "";
const answers: Array<{ status: number; headers: Headers; text: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // A fresh API a test, through the module-level handle.
    void current.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let current: ReturnType<typeof createApi>;
beforeEach(() => {
  table = fakeTable();
  problems = [];
  liveAsks = [];
  revokes = [];
  current = createApi({
    cfg: { mode: "process", region: "us-east-1", keyHashes: [sha256(KEY)], publicUrl: "http://127.0.0.1:8789", publicOrigin: "http://127.0.0.1:8789", appOrigin: APP_ORIGIN },
    sessions: table as never,
    log: SILENT_LOG,
    problems: () => problems,
    liveUrl: (s, mode) => {
      liveAsks.push(mode);
      return `http://127.0.0.1:8789/live/${s.id}`;
    },
    live: {
      assets: liveAssets(),
      revoke: (id) => {
        revokes.push(id);
        const r = table.rows.get(id);
        return r && r.status === "running" ? 2 : null;
      },
    },
  });
});

async function call(method: string, path: string, o: { body?: unknown; key?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.key !== null) headers["x-bb-api-key"] = o.key ?? KEY;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${base}${path}`, { method, headers, body: o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body), redirect: "manual" });
  const text = await r.text();
  answers.push({ status: r.status, headers: r.headers, text });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: r.status, headers: r.headers, text, json };
}

/** The app's create body (src/lib/browser/browserbase.ts createProviderSession). */
const appBody = (over: Record<string, unknown> = {}) => ({
  projectId: "stand-in",
  region: "us-east-1",
  timeout: 960,
  keepAlive: false,
  browserSettings: { viewport: { width: 1280, height: 800 }, recordSession: false, logSession: false, blockAds: true },
  userMetadata: { wk: "workwrk", row: "cm1row0000000000000000000" },
  ...over,
});

describe("POST /v1/sessions", () => {
  it("answers 201 with the session JSON and its connect address for the app's own body", async () => {
    const r = await call("POST", "/v1/sessions", { body: appBody() });
    expect(r.status).toBe(201);
    expect(r.json.id).toMatch(/^[A-Za-z0-9_-]{1,200}$/);
    expect(String(r.json.connectUrl)).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/connect\//);
    expect(r.json.status).toBe("RUNNING");
    expect(r.json.userMetadata).toEqual({ wk: "workwrk", row: "cm1row0000000000000000000" });
    expect(table.asks[0]).toMatchObject({ timeoutSeconds: 960, viewport: { width: 1280, height: 800 }, region: "us-east-1" });
  });

  it("answers 400 with the field for each check", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ region: "eu-central-1" }, "region"],
      [{ timeout: 30 }, "timeout"],
      [{ timeout: 21_601 }, "timeout"],
      [{ timeout: 90.5 }, "timeout"],
      [{ timeout: "300" }, "timeout"],
      [{ keepAlive: true }, "keepAlive"],
      [{ browserSettings: { recordSession: true } }, "recordSession"],
      [{ browserSettings: { logSession: true } }, "logSession"],
      [{ browserSettings: { viewport: { width: 300, height: 800 } } }, "viewport"],
      [{ browserSettings: { viewport: { width: 1280, height: 1300 } } }, "viewport"],
      [{ userMetadata: { "bad key": "x" } }, "userMetadata"],
      [{ userMetadata: { wk: "x".repeat(81) } }, "userMetadata"],
      [{ userMetadata: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"])) }, "userMetadata"],
      [{ userMetadata: { wk: 5 } }, "userMetadata"],
      [{ projectId: "p".repeat(201) }, "projectId"],
    ];
    for (const [over, field] of cases) {
      const r = await call("POST", "/v1/sessions", { body: appBody(over) });
      expect({ status: r.status, json: r.json }).toEqual({ status: 400, json: { error: "bad_request", field } });
    }
    expect((await call("POST", "/v1/sessions", { body: "not json" })).json).toEqual({ error: "bad_request", field: "body" });
    expect((await call("POST", "/v1/sessions", { body: "x".repeat(70_000) })).json).toEqual({ error: "bad_request", field: "body" });
    expect(table.asks).toHaveLength(0);
  });

  it("accepts blockAds and an absent viewport, recordSession and logSession", async () => {
    const r = await call("POST", "/v1/sessions", { body: { region: "us-east-1", timeout: 60 } });
    expect(r.status).toBe(201);
    expect(table.asks[0]).toMatchObject({ viewport: { width: 1280, height: 800 }, projectId: "" });
  });

  it("answers 401 without a key or with a wrong one", async () => {
    expect((await call("POST", "/v1/sessions", { body: appBody(), key: null })).status).toBe(401);
    const wrong = await call("POST", "/v1/sessions", { body: appBody(), key: "stand-in" });
    expect(wrong.status).toBe(401);
    expect(wrong.json).toEqual({ error: "unauthorized" });
    expect(table.asks).toHaveLength(0);
  });

  it("answers 429 at capacity with Retry-After: 30, counted in /health", async () => {
    table.next = 429;
    const r = await call("POST", "/v1/sessions", { body: appBody() });
    expect(r.status).toBe(429);
    expect(r.json).toEqual({ error: "at_capacity" });
    expect(r.headers.get("retry-after")).toBe("30");
    const h = await call("GET", "/health");
    expect((h.json.counts as Record<string, number>).capacityRefusals1h).toBe(1);
    expect((h.json.counts as Record<string, number>).capacityRefusals24h).toBe(1);
  });

  it("answers 503 with the reason when Chrome does not start", async () => {
    table.next = 503;
    const r = await call("POST", "/v1/sessions", { body: appBody() });
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: "unavailable", why: "chrome_did_not_start" });
  });
});

describe("GET /v1/sessions/{id}/debug", () => {
  it("defaults to watch, asks control only when told, and refuses another mode", async () => {
    const made = await call("POST", "/v1/sessions", { body: appBody() });
    const id = String(made.json.id);
    const watch = await call("GET", `/v1/sessions/${id}/debug`);
    expect(watch.status).toBe(200);
    expect(watch.json).toEqual({ debuggerFullscreenUrl: `http://127.0.0.1:8789/live/${id}`, debuggerUrl: `http://127.0.0.1:8789/live/${id}`, wsUrl: null, pages: [] });
    expect((await call("GET", `/v1/sessions/${id}/debug?mode=control`)).status).toBe(200);
    expect((await call("GET", `/v1/sessions/${id}/debug?mode=watch`)).status).toBe(200);
    expect(liveAsks).toEqual(["watch", "control", "watch"]);
    const bad = await call("GET", `/v1/sessions/${id}/debug?mode=${MARK}`);
    expect(bad.status).toBe(400);
    expect(liveAsks).toHaveLength(3);
  });

  it("answers 404 for an unknown or ended session", async () => {
    expect((await call("GET", "/v1/sessions/nope/debug")).status).toBe(404);
    const made = await call("POST", "/v1/sessions", { body: appBody() });
    table.rows.get(String(made.json.id))!.status = "ended";
    expect((await call("GET", `/v1/sessions/${made.json.id}/debug`)).status).toBe(404);
  });
});

describe("release and the list", () => {
  it("release answers 200, then 409, 404 for an unknown id and 400 for another status", async () => {
    const made = await call("POST", "/v1/sessions", { body: appBody() });
    const id = String(made.json.id);
    expect((await call("POST", `/v1/sessions/${id}`, { body: { projectId: "stand-in", status: MARK } })).status).toBe(400);
    const first = await call("POST", `/v1/sessions/${id}`, { body: { projectId: "stand-in", status: "REQUEST_RELEASE" } });
    expect(first.status).toBe(200);
    expect(first.json.status).toBe("COMPLETED");
    expect((await call("POST", `/v1/sessions/${id}`, { body: { status: "REQUEST_RELEASE" } })).status).toBe(409);
    expect((await call("POST", "/v1/sessions/00000000-0000-4000-8000-999999999999", { body: { status: "REQUEST_RELEASE" } })).status).toBe(404);
  });

  it("the list filters RUNNING and COMPLETED, shows all without a filter, and refuses another", async () => {
    const a = await call("POST", "/v1/sessions", { body: appBody() });
    await call("POST", "/v1/sessions", { body: appBody() });
    await call("POST", `/v1/sessions/${a.json.id}`, { body: { status: "REQUEST_RELEASE" } });
    const running = await call("GET", "/v1/sessions?status=RUNNING");
    expect(running.status).toBe(200);
    expect((JSON.parse(running.text) as Array<{ status: string }>).map((s) => s.status)).toEqual(["RUNNING"]);
    expect((JSON.parse((await call("GET", "/v1/sessions?status=COMPLETED")).text) as unknown[]).length).toBe(1);
    expect((JSON.parse((await call("GET", "/v1/sessions")).text) as unknown[]).length).toBe(2);
    expect((await call("GET", `/v1/sessions?status=${MARK}`)).status).toBe(400);
    expect((await call("GET", "/v1/sessions?status=RUNNING", { key: null })).status).toBe(401);
  });
});

describe("/health and /healthz", () => {
  it("/health needs the key", async () => {
    expect((await call("GET", "/health", { key: null })).status).toBe(401);
    const h = await call("GET", "/health");
    expect(h.status).toBe(200);
    expect(h.json).toMatchObject({ ok: true, mode: "process", max: 2, running: 0, region: "us-east-1", draining: false, problems: [] });
  });

  it("/health reports the boot self-test's Chrome, the image's age, every version and the firewall's last check", async () => {
    const health = {
      chrome: "154.0.7499.40",
      chromeMajor: 154,
      imageBuiltAt: "2026-10-20T04:16:00.000Z",
      imageAgeDays: 1,
      firewallCheckedAt: "2026-10-21T09:55:00.000Z",
    };
    const versions = { node: "24.11.0", kernel: "6.8.0-86-generic", docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3", caddy: "v2.10.2" };
    const api = createApi({
      cfg: { mode: "container", region: "eu-central-1", keyHashes: [sha256(KEY)], publicUrl: "https://browsers.example.test", version: "4002b24d" },
      sessions: table as never,
      log: SILENT_LOG,
      problems: () => ["image_build_failing"],
      health: () => health,
      versions: () => versions,
    });
    const saved = current;
    current = api;
    try {
      const h = await call("GET", "/health");
      expect(h.json).toMatchObject({ ok: false, mode: "container", version: "4002b24d", ...health, versions, region: "eu-central-1", problems: ["image_build_failing"] });
    } finally {
      current = saved;
    }
  });

  it("/healthz needs no key and answers 503 for each problem that needs a person", async () => {
    expect((await call("GET", "/healthz", { key: null })).text).toBe("ok");
    for (const p of HEALTHZ_PROBLEMS) {
      problems = [p];
      const r = await call("GET", "/healthz", { key: null });
      expect({ p, status: r.status, text: r.text }).toEqual({ p, status: 503, text: "unavailable" });
    }
    expect(HEALTHZ_PROBLEMS).toEqual(["chrome_stale", "image_build_failing", "firewall_unchecked", "launcher_unreachable", "selftest_failed", "preflight", "drain_stuck"]);
  });

  it("/healthz answers 200 draining while draining, and 200 when full", async () => {
    table.drainingNow = true;
    expect(await call("GET", "/healthz", { key: null })).toMatchObject({ status: 200, text: "draining" });
    table.drainingNow = false;
    await call("POST", "/v1/sessions", { body: appBody() });
    await call("POST", "/v1/sessions", { body: appBody() });
    table.next = 429;
    expect((await call("POST", "/v1/sessions", { body: appBody() })).status).toBe(429);
    expect(await call("GET", "/healthz", { key: null })).toMatchObject({ status: 200, text: "ok" });
  });
});

describe("auth failures", () => {
  it("ten from one address answer 429 on every route for ten minutes, while another address goes on", async () => {
    const from = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 10; i += 1) expect((await call("GET", "/health", { key: "wrong", headers: from })).status).toBe(401);
    const blocked = await call("GET", "/health", { headers: from });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(590);
    expect((await call("GET", "/healthz", { key: null, headers: from })).status).toBe(429);
    expect((await call("POST", "/v1/sessions", { body: appBody(), headers: from })).status).toBe(429);
    expect((await call("GET", "/health", { headers: { "x-forwarded-for": "198.51.100.4" } })).status).toBe(200);
  });
});

describe("every answer", () => {
  it("sets no cookie, is never a redirect, is no-store, and no error body holds a value sent", async () => {
    // A spread of requests, each carrying the marker where a value could be echoed.
    await call("POST", "/v1/sessions", { body: appBody({ region: MARK }) });
    await call("POST", "/v1/sessions", { body: appBody({ userMetadata: { wk: MARK.repeat(10) } }) });
    await call("POST", "/v1/sessions", { body: `{"${MARK}":` });
    await call("GET", `/v1/sessions/${MARK}/debug`);
    await call("POST", `/v1/sessions/${MARK}`, { body: { status: MARK } });
    await call("GET", `/v1/sessions?status=${MARK}`);
    await call("GET", `/${MARK}`, { key: null });
    await call("GET", "/health", { key: MARK });
    for (const a of answers) {
      expect(a.headers.get("set-cookie")).toBeNull();
      expect(a.status < 300 || a.status >= 400).toBe(true);
      expect(a.headers.get("cache-control")).toBe("no-store");
      if (a.status >= 400) expect(a.text).not.toContain(MARK);
    }
    expect(answers.length).toBeGreaterThan(40);
  });
});

describe("the live view's page (4.1)", () => {
  const CSP = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src ws://127.0.0.1:8789; frame-ancestors ${APP_ORIGIN}; base-uri 'none'; form-action 'none'`;

  it("/live/<id> answers the shell with the headers of 4.1, no key needed", async () => {
    const r = await call("GET", "/live/6f1c2a7e-6d0b-4a39-9a51-0d5c3a1e9b11", { key: null });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("content-security-policy")).toBe(CSP);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.text).toBe(fs.readFileSync(path.join(LIVE_DIR, "page.html"), "utf8"));
  });

  it("answers the same bytes for any id of the id's shape, and 404 for anything else", async () => {
    const a = await call("GET", "/live/6f1c2a7e-6d0b-4a39-9a51-0d5c3a1e9b11", { key: null });
    for (const id of ["00000000-0000-4000-8000-000000000000", "no-such-session", "x", "A".repeat(200)]) {
      const r = await call("GET", `/live/${id}?x=1`, { key: null });
      expect({ id, status: r.status, same: r.text === a.text, csp: r.headers.get("content-security-policy") }).toEqual({ id, status: 200, same: true, csp: CSP });
    }
    for (const p of ["/live/", "/live/a.b", `/live/${"A".repeat(201)}`, "/live/x/y", "/live/x/ws"]) expect({ p, status: (await call("GET", p, { key: null })).status }).toEqual({ p, status: 404 });
    expect((await call("POST", "/live/x", { key: null, body: {} })).status).toBe(404);
  });

  it("serves every asset with the headers of 4.1 (no-store and Cross-Origin-Resource-Policy included), and nothing else from there", async () => {
    const want: Array<[string, string, string]> = [
      ["live.mjs", "text/javascript; charset=utf-8", "live.mjs"],
      ["view.mjs", "text/javascript; charset=utf-8", "view.mjs"],
      ["copy.mjs", "text/javascript; charset=utf-8", "copy.mjs"],
      ["live.css", "text/css; charset=utf-8", "live.css"],
    ];
    for (const [name, type, file] of want) {
      const r = await call("GET", `/live/assets/${name}`, { key: null });
      expect({
        name,
        status: r.status,
        type: r.headers.get("content-type"),
        store: r.headers.get("cache-control"),
        corp: r.headers.get("cross-origin-resource-policy"),
        sniff: r.headers.get("x-content-type-options"),
        referrer: r.headers.get("referrer-policy"),
        cookie: r.headers.get("set-cookie"),
        same: r.text === fs.readFileSync(path.join(LIVE_DIR, file), "utf8"),
      }).toEqual({ name, status: 200, type, store: "no-store", corp: "same-origin", sniff: "nosniff", referrer: "no-referrer", cookie: null, same: true });
    }
    for (const p of ["/live/assets/page.html", "/live/assets/live-input.mjs", "/live/assets/../lib/tokens.mjs", "/live/assets/%2e%2e%2fapi.mjs", "/live/assets/nope.mjs", "/live/assets/live.test.ts"]) {
      const r = await call("GET", p, { key: null });
      expect({ p, status: r.status, cookie: r.headers.get("set-cookie") }).toEqual({ p, status: 404, cookie: null });
    }
  });
});

describe("POST /v1/sessions/{id}/live-views/revoke", () => {
  it("needs the key, answers { revoked } for a running session and 404 for an unknown or ended one", async () => {
    const made = await call("POST", "/v1/sessions", { body: appBody() });
    const id = String(made.json.id);
    expect((await call("POST", `/v1/sessions/${id}/live-views/revoke`, { body: {}, key: null })).status).toBe(401);
    expect(revokes).toEqual([]);
    const r = await call("POST", `/v1/sessions/${id}/live-views/revoke`, { body: {} });
    expect({ status: r.status, json: r.json }).toEqual({ status: 200, json: { revoked: 2 } });
    expect(revokes).toEqual([id]);
    expect((await call("POST", "/v1/sessions/00000000-0000-4000-8000-999999999999/live-views/revoke", { body: {} })).status).toBe(404);
    table.rows.get(id)!.status = "ended";
    expect((await call("POST", `/v1/sessions/${id}/live-views/revoke`, { body: {} })).status).toBe(404);
    expect((await call("GET", `/v1/sessions/${id}/live-views/revoke`)).status).toBe(404);
  });
});

describe("close (the host stopping)", () => {
  it("clears the timers of its three limits, so no address is held past the host", () => {
    const set = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    try {
      const api = createApi({
        cfg: { mode: "process", region: "us-east-1", keyHashes: [sha256(KEY)], publicUrl: "http://127.0.0.1:8789", publicOrigin: "http://127.0.0.1:8789", appOrigin: APP_ORIGIN },
        sessions: fakeTable() as never,
        log: SILENT_LOG,
      });
      const handles = set.mock.results.map((r) => r.value);
      expect(handles).toHaveLength(3);
      api.close();
      for (const h of handles) expect(clear).toHaveBeenCalledWith(h);
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });
});
