// @ts-check
// The host's HTTP API (docs/plans/browser-host.md 3.1 and 3.2): the
// Browserbase subset src/lib/browser/browserbase.ts already sends, answered
// in its shapes, plus /health and /healthz.
//
//   POST /v1/sessions                    create: 201, 400 { field }, 429 at_capacity (Retry-After: 30), 503 { why }
//   GET  /v1/sessions?status=RUNNING     list: RUNNING (starting and running), COMPLETED, or all; 400 for any other
//   GET  /v1/sessions/{id}/debug?mode=   the live view's address: watch unless mode=control; 400 another mode; 404
//   POST /v1/sessions/{id}               release: 200 COMPLETED, 409 already ended (an hour), 404, 400
//   GET  /health                         with the key: the numbers (3.2)
//   GET  /healthz                        no key: 503 for a problem that needs a person, else 200 ok or draining
//
// The live view's own routes (/live/{id}, its assets and its websocket) and
// the revoke route arrive in step 2: until then the debug answer is the
// address step 2 serves, and /live answers 404.
//
// Every /v1 request and /health carry X-BB-API-Key (auth.mjs keyOk). Error
// bodies hold codes only, never a value sent. No answer is a redirect, and
// none sets a cookie. Every answer is no-store.
//
// PROOF MODE's hooks (Decision 17): the stand-in's controls answer
// /__stand-in/* before anything else (no key, as before), and every API
// request is written to the stand-in's log in its old shapes, with its
// failure injection applied after the key, as the stand-in did.

import { apiLimits, clientAddress, keyOk } from "./auth.mjs";
import { SYSTEM_CLOCK } from "./sessions.mjs";

/** The problems /healthz answers 503 for (3.2): each needs a person. */
export const HEALTHZ_PROBLEMS = Object.freeze(["chrome_stale", "image_build_failing", "firewall_unchecked", "launcher_unreachable", "selftest_failed", "preflight", "drain_stuck"]);

const SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/;
const META_KEY = /^[A-Za-z0-9_]{1,40}$/;
const BODY_MAX = 64 * 1024;
const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

/**
 * @typedef {{
 *   entry?: (e: { method: string, path: string }) => Record<string, unknown>,
 *   rule?: (route: string) => { status: number, delayMs: number } | null,
 *   control?: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL) => Promise<void>,
 * }} ApiHooks
 */

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(text);
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} text
 */
function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(text);
}

/**
 * A request's body, at most BODY_MAX bytes: null when longer.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string | null>}
 */
function readBody(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (d) => {
      if (over) return;
      size += d.length;
      if (size > BODY_MAX) {
        over = true;
        resolve(null);
        return;
      }
      chunks.push(d);
    });
    req.on("end", () => !over && resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => !over && resolve(null));
  });
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * The create body's checks (3.2), in order: the first failing field, or the ask.
 * @param {unknown} body
 * @param {string} region
 * @returns {{ field: string } | { ask: import("./sessions.mjs").CreateAsk }}
 */
export function checkCreate(body, region) {
  if (!isObject(body)) return { field: "body" };
  if (body.projectId !== undefined && (typeof body.projectId !== "string" || body.projectId.length > 200)) return { field: "projectId" };
  if (body.region !== region) return { field: "region" };
  const t = body.timeout;
  if (typeof t !== "number" || !Number.isInteger(t) || t < 60 || t > 21_600) return { field: "timeout" };
  if (body.keepAlive !== undefined && body.keepAlive !== false) return { field: "keepAlive" };
  const bs = body.browserSettings;
  if (bs !== undefined && !isObject(bs)) return { field: "browserSettings" };
  const settings = isObject(bs) ? bs : {};
  // The host never records or logs: it says so rather than ignore the ask.
  if (settings.recordSession !== undefined && settings.recordSession !== false) return { field: "recordSession" };
  if (settings.logSession !== undefined && settings.logSession !== false) return { field: "logSession" };
  let viewport = { width: 1280, height: 800 };
  if (settings.viewport !== undefined) {
    const v = settings.viewport;
    if (!isObject(v)) return { field: "viewport" };
    const { width, height } = v;
    if (typeof width !== "number" || !Number.isInteger(width) || width < 320 || width > 1920) return { field: "viewport" };
    if (typeof height !== "number" || !Number.isInteger(height) || height < 240 || height > 1200) return { field: "viewport" };
    viewport = { width, height };
  }
  // blockAds is accepted and ignored: the host has no ad blocker.
  /** @type {Record<string, string>} */
  const userMetadata = {};
  if (body.userMetadata !== undefined) {
    const m = body.userMetadata;
    if (!isObject(m)) return { field: "userMetadata" };
    const entries = Object.entries(m);
    if (entries.length > 10) return { field: "userMetadata" };
    for (const [k, v] of entries) {
      if (!META_KEY.test(k) || typeof v !== "string" || v.length > 80) return { field: "userMetadata" };
      userMetadata[k] = v;
    }
  }
  return { ask: { projectId: typeof body.projectId === "string" ? body.projectId : "", region, timeoutSeconds: t, viewport, userMetadata } };
}

/**
 * The API handler.
 * @param {{
 *   cfg: { mode: string, region: string, keyHashes: Buffer[], publicUrl: string, version?: string },
 *   sessions: Pick<import("./sessions.mjs").Sessions, "create" | "get" | "list" | "json" | "release" | "connectUrl" | "status" | "counts" | "draining">,
 *   log: import("./log.mjs").Log,
 *   problems?: () => string[],
 *   liveUrl?: (s: import("./sessions.mjs").Session, mode: "watch" | "control") => string,
 *   versions?: () => Record<string, string | null>,
 *   counts?: () => Record<string, number>,
 *   clock?: import("./sessions.mjs").Clock,
 *   hooks?: ApiHooks,
 * }} o
 */
export function createApi(o) {
  const { cfg, sessions, log } = o;
  const clock = o.clock ?? SYSTEM_CLOCK;
  const problems = o.problems ?? (() => []);
  const hooks = o.hooks ?? {};
  // Step 2 mints the live token here; until then, the address it will serve.
  const liveUrl = o.liveUrl ?? ((s) => `${cfg.publicUrl}/live/${s.id}`);
  const limits = apiLimits(() => clock.mono());
  /** When each capacity refusal was, for /health (6.2). */
  /** @type {number[]} */
  let refusals = [];
  const tally = { authFailures: 0, rateLimited: 0, capacityRefusals: 0 };

  const capacity = () => {
    const now = clock.mono();
    refusals = refusals.filter((t) => now - t < DAY_MS);
    return { capacityRefusals1h: refusals.filter((t) => now - t < HOUR_MS).length, capacityRefusals24h: refusals.length };
  };

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handle(req, res) {
    const started = clock.mono();
    const url = new URL(req.url ?? "/", "http://host.invalid");
    const p = url.pathname;
    if (hooks.control && p.startsWith("/__stand-in/")) return hooks.control(req, res, url);

    const method = req.method ?? "GET";
    const releaseMatch = /^\/v1\/sessions\/([^/]+)$/.exec(p);
    const debugMatch = /^\/v1\/sessions\/([^/]+)\/debug$/.exec(p);
    const route =
      method === "POST" && p === "/v1/sessions"
        ? "create"
        : method === "GET" && p === "/v1/sessions"
          ? "list"
          : method === "GET" && debugMatch
            ? "debug"
            : method === "POST" && releaseMatch
              ? "release"
              : method === "GET" && p === "/health"
                ? "health"
                : method === "GET" && p === "/healthz"
                  ? "healthz"
                  : p.startsWith("/live/")
                    ? "live"
                    : "unknown";
    const entry = hooks.entry?.({ method, path: p }) ?? null;

    /**
     * @param {number} status
     * @param {unknown} body
     * @param {Record<string, string>} [headers]
     */
    const answer = (status, body, headers) => {
      if (entry) entry.status = status;
      sendJson(res, status, body, headers);
      log.event("api", route, status, { ms: clock.mono() - started });
    };

    const addr = clientAddress(req);
    const blockedFor = limits.authFailures.blocked(addr);
    if (blockedFor > 0) {
      tally.rateLimited += 1;
      return answer(429, { error: "rate_limited" }, { "retry-after": String(blockedFor) });
    }

    if (route === "healthz") {
      if (entry) entry.route = route;
      const now = problems();
      const failing = now.filter((x) => HEALTHZ_PROBLEMS.includes(x));
      const status = failing.length > 0 ? 503 : 200;
      if (entry) entry.status = status;
      sendText(res, status, failing.length > 0 ? "unavailable" : sessions.draining() ? "draining" : "ok");
      log.event("api", route, status, { ms: clock.mono() - started });
      return;
    }

    const needsKey = p.startsWith("/v1/") || p === "/health";
    if (!needsKey) {
      if (entry) entry.route = route;
      return answer(404, { error: "not_found" });
    }
    if (!keyOk(req.headers["x-bb-api-key"], cfg.keyHashes)) {
      tally.authFailures += 1;
      limits.authFailures.hit(addr);
      return answer(401, { error: "unauthorized" });
    }
    const wait = limits.requests.hit("all") || (route === "create" ? limits.creates.hit("all") : 0);
    if (wait > 0) {
      tally.rateLimited += 1;
      return answer(429, { error: "rate_limited" }, { "retry-after": String(wait) });
    }

    /** @type {unknown} */
    let body = {};
    let bodyBad = false;
    if (method === "POST") {
      const raw = await readBody(req);
      if (raw === null) bodyBad = true;
      else {
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          bodyBad = true;
        }
      }
    }
    if (entry) entry.route = route;
    // Proof mode's failure injection, where the stand-in applied it.
    const rule = hooks.rule?.(route) ?? null;
    if (rule && entry) {
      entry.injected = { status: rule.status, delayMs: rule.delayMs };
      if (rule.delayMs > 0) await new Promise((r) => setTimeout(r, rule.delayMs));
      if (rule.status) return answer(rule.status, { error: "injected" }, rule.status === 429 ? { "retry-after": "7" } : {});
    }

    if (route === "create") {
      const b = isObject(body) ? body : {};
      const settings = isObject(b.browserSettings) ? b.browserSettings : {};
      const meta = isObject(b.userMetadata) ? b.userMetadata : {};
      if (entry) {
        // What the app asked for, never the key: the proofs check recording is off and the tag is there.
        Object.assign(entry, {
          recordSession: settings.recordSession,
          logSession: settings.logSession,
          keepAlive: b.keepAlive,
          timeout: b.timeout,
          region: b.region,
          tag: meta.wk ?? null,
          row: meta.row ?? null,
        });
      }
      const checked = bodyBad ? { field: "body" } : checkCreate(body, cfg.region);
      if ("field" in checked) return answer(400, { error: "bad_request", field: checked.field });
      const made = await sessions.create(checked.ask);
      if (!made.ok) {
        if (made.status === 429) {
          refusals.push(clock.mono());
          tally.capacityRefusals += 1;
          return answer(429, { error: "at_capacity" }, { "retry-after": "30" });
        }
        return answer(503, { error: "unavailable", why: made.why ?? "unavailable" });
      }
      if (entry) entry.session = made.session.id;
      return answer(201, { ...sessions.json(made.session), connectUrl: sessions.connectUrl(made.session) });
    }

    if (route === "list") {
      const want = url.searchParams.get("status");
      if (want !== null && want !== "RUNNING" && want !== "COMPLETED") return answer(400, { error: "bad_request", field: "status" });
      return answer(200, sessions.list(/** @type {"RUNNING" | "COMPLETED" | null} */ (want)).map((s) => sessions.json(s)));
    }

    if (route === "debug" && debugMatch) {
      const modeRaw = url.searchParams.get("mode");
      if (modeRaw !== null && modeRaw !== "watch" && modeRaw !== "control") return answer(400, { error: "bad_request", field: "mode" });
      // No mode means watch, so a client that forgets is safe.
      const mode = modeRaw === "control" ? "control" : "watch";
      const id = idOf(debugMatch[1]);
      const s = id ? sessions.get(id) : undefined;
      if (!s || s.status !== "running") return answer(404, { error: "not_found" });
      const live = liveUrl(s, mode);
      return answer(200, { debuggerFullscreenUrl: live, debuggerUrl: live, wsUrl: null, pages: [] });
    }

    if (route === "release" && releaseMatch) {
      const id = idOf(releaseMatch[1]);
      const s = id ? sessions.get(id) : undefined;
      if (!s || !id) return answer(404, { error: "not_found" });
      if (bodyBad || !isObject(body) || body.status !== "REQUEST_RELEASE") return answer(400, { error: "bad_request", field: "status" });
      const out = sessions.release(id);
      if (out === "unknown") return answer(404, { error: "not_found" });
      if (out === "ended") return answer(409, { error: "already_ended" });
      return answer(200, sessions.json(s));
    }

    if (route === "health") {
      const st = sessions.status();
      const now = problems();
      return answer(200, {
        ok: now.length === 0,
        mode: cfg.mode,
        version: cfg.version ?? "dev",
        // The boot self-test's Chrome and the image's age arrive with container mode (step 3).
        chrome: null,
        chromeMajor: null,
        imageBuiltAt: null,
        imageAgeDays: null,
        versions: o.versions?.() ?? {},
        max: st.max,
        running: st.running,
        starting: st.starting,
        held: st.held,
        region: cfg.region,
        draining: sessions.draining(),
        firewallCheckedAt: null,
        counts: { ...sessions.counts(), ...capacity(), authFailures: tally.authFailures, rateLimited: tally.rateLimited, ...(o.counts?.() ?? {}) },
        problems: now,
      });
    }

    return answer(404, { error: "not_found" });
  }

  return {
    /**
     * @param {import("node:http").IncomingMessage} req
     * @param {import("node:http").ServerResponse} res
     */
    handle: (req, res) =>
      handle(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: "host_error" });
        else res.destroy();
        log.event("api", "error");
      }),
    capacity,
  };
}

/**
 * A path's session id, or null when it is not one.
 * @param {string | undefined} raw
 */
function idOf(raw) {
  try {
    const id = decodeURIComponent(raw ?? "");
    return SESSION_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}
