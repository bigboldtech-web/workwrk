// @ts-check
// The stand-in's test controls, answered in proof mode only (docs/plans/
// browser-host.md Decision 17 and 12.1), moved from scripts/browser-stand-in.mjs
// with the same answers. POST unless said, and no key, as before:
//
//   /__stand-in/reset                           every browser ended, the log and rules cleared
//   /__stand-in/fail?route=&status=&times=&delayMs=
//                                               the next `times` requests to create, debug,
//                                               release or list wait `delayMs`, then answer
//                                               `status` (none: answered as usual)
//   /__stand-in/kill?session=                   the provider ends a session itself (provider_ended)
//   /__stand-in/type?session=&selector=&text=&enter=1&keys=1
//                                               the person typing in the live view: a trusted
//                                               click at the field's centre first, as a person
//                                               would (Phase 5 step 2: the recorder counts typing
//                                               only in a field the person's own pointer or key
//                                               marked), then the words; keys=1 types each
//                                               character as its own key (at most 600), one
//                                               input event a key (review of Phase 5 step 2)
//   /__stand-in/click?session=&selector=        the person's trusted click at an element's
//                                               centre (Phase 5 step 2)
//   /__stand-in/choose?session=&selector=&index=
//                                               the person choosing in a native list: a trusted
//                                               click on it, then the option's words typed as
//                                               keys, the list's own type-ahead (Phase 5 step 2:
//                                               ArrowDown and Enter, the spec's, choose nothing
//                                               in chrome-headless-shell 154 on macOS, where the
//                                               arrows only open the list, and the Enter sends
//                                               the form)
//   /__stand-in/back?session=                   the person's Back button in the live view, the
//                                               same way (review of Phase 4 step 2)
//   /__stand-in/page?session=&fn=insertTwin|changeCart|renameSubmit|jumpy|fakeEvents|actsAtOnce
//                                               a fixture page's own script, by those names only
//                                               (review of Phase 4 step 3; Phase 5 steps 2 and 4)
//   /__stand-in/start-orphan?tag=               a tagged session no row knows (never ended for
//                                               want of a connection)
//   GET /__stand-in/sessions                    the sessions, running or not
//   GET /__stand-in/log?since=<seq>             what was asked, API and fixtures, in order
//
// THEIR OWN CONNECTION TO THE TAB, opened only in proof mode, at the first
// control that needs it, and closed when the session ends: the points come
// from Runtime.evaluate and Back uses the page's history, as the stand-in's
// did. The person's clicks and keys are built by the live view's own mapper
// (lib/live-input.mjs), as a control viewer's messages, so they are the same
// trusted CDP Input a control viewer's would be; only the connection they go
// on is this one. The live view's connection never gains Runtime or the
// history calls (LIVE_METHODS).

import crypto from "node:crypto";

import WebSocket from "ws";

import { charKeyMessages, clickMessages, createInputMapper, enterMessages, TEXT_MAX } from "../lib/live-input.mjs";

/** The fixture pages' own scripts a control may run, by name only (review of Phase 4 step 3; Phase 5 step 2). */
export const PAGE_FUNCTIONS = new Set(["insertTwin", "changeCart", "renameSubmit", "jumpy", "fakeEvents", "actsAtOnce"]);

/**
 * @typedef {{ send: (method: string, params?: Record<string, unknown>) => Promise<any>, close: () => void }} OwnPage
 */

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * A small CDP client of the controls' own.
 * @param {string} wsUrl
 * @returns {Promise<OwnPage>}
 */
function cdpTo(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, followRedirects: false });
    let id = 0;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
    const pending = new Map();
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const p = /** @type {{ resolve: (v: any) => void, reject: (e: Error) => void }} */ (pending.get(msg.id));
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(String(msg.error.message)));
        else p.resolve(msg.result);
      }
    });
    ws.on("close", () => {
      for (const p of pending.values()) p.reject(new Error("the page's connection closed"));
      pending.clear();
    });
    ws.on("open", () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            if (ws.readyState !== WebSocket.OPEN) return rej(new Error("the page's connection closed"));
            id += 1;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          }),
        close: () => ws.close(),
      }),
    );
    ws.on("error", reject);
  });
}

/**
 * An element's centre in the window, scrolled into view, or null when there is none.
 * @param {OwnPage} page
 * @param {string} selector
 * @returns {Promise<{ x: number, y: number } | null>}
 */
async function centreOf(page, selector) {
  const out = await page.send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    returnByValue: true,
  });
  const v = out.result?.value;
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
}

/**
 * The person's input on the controls' own connection: each message mapped by
 * lib/live-input.mjs exactly as a control viewer's would be, then sent.
 * @param {OwnPage} page
 * @param {import("../lib/live-input.mjs").InputMapper} mapper
 * @param {Array<Record<string, unknown>>} messages
 */
async function personInput(page, mapper, messages) {
  for (const m of messages) {
    const out = mapper.map(m);
    if (!out.ok) throw new Error(`the live view refuses this input (${out.why})`);
    for (const c of out.commands) await page.send(c.method, c.params);
  }
}

/**
 * A trusted click at a point, as the person's own pointer: a move, a press and a release.
 * @param {OwnPage} page
 * @param {import("../lib/live-input.mjs").InputMapper} mapper
 * @param {number} x
 * @param {number} y
 */
const clickAt = (page, mapper, x, y) => personInput(page, mapper, clickMessages(x, y));

/**
 * One character as a key the person pressed (a key down with its text, then up).
 * @param {OwnPage} page
 * @param {import("../lib/live-input.mjs").InputMapper} mapper
 * @param {string} ch
 */
const typeKey = (page, mapper, ch) => personInput(page, mapper, charKeyMessages(ch));

/**
 * @param {OwnPage} page
 * @param {import("../lib/live-input.mjs").InputMapper} mapper
 */
const pressEnter = (page, mapper) => personInput(page, mapper, enterMessages());

/**
 * The controls.
 * @param {{
 *   cfg: { region: string },
 *   sessions: import("../lib/sessions.mjs").Sessions,
 *   log: import("./log.mjs").ProofLog,
 *   fixtures: { reset: () => void },
 * }} o
 */
export function createControls(o) {
  const { sessions, log, fixtures } = o;
  /** @type {Array<{ route: string, status: number, times: number, delayMs: number }>} */
  let rules = [];
  /** The controls' own connection to each session's tab. */
  /** @type {Map<string, Promise<OwnPage>>} */
  const own = new Map();

  // A session's end closes its connection, and the log says why (the stand-in's entry).
  sessions.onEnd((s, why) => {
    const p = own.get(s.id);
    own.delete(s.id);
    p?.then((c) => c.close()).catch(() => undefined);
    log.record({ kind: "provider", route: "session.ended", session: s.id, why });
  });

  /**
   * The session's tab, through Chrome's own target list: the launch tab, or the one page left.
   * @param {import("../lib/sessions.mjs").Session} s
   * @returns {Promise<OwnPage>}
   */
  function ownPage(s) {
    const have = own.get(s.id);
    if (have) return have;
    const l = s.launched;
    if (!l) return Promise.reject(new Error("no page"));
    const p = (async () => {
      const list = await (await fetch(`${l.devtoolsBase}/json/list`)).json();
      const pages = Array.isArray(list) ? list.filter((t) => t && t.type === "page") : [];
      const page = pages.find((t) => t.id === l.tabTargetId) ?? pages[0];
      if (!page) throw new Error("no page");
      const c = await cdpTo(String(page.webSocketDebuggerUrl));
      if (s.status !== "running") {
        c.close();
        throw new Error("no page");
      }
      return c;
    })();
    own.set(s.id, p);
    p.catch(() => own.get(s.id) === p && own.delete(s.id));
    return p;
  }

  /** @param {string} route */
  function ruleFor(route) {
    const r = rules.find((x) => x.route === route && x.times > 0);
    if (!r) return null;
    r.times -= 1;
    return r;
  }

  /** @param {string | null} id */
  const runningSession = (id) => {
    const s = sessions.get(id || "");
    return s && s.status === "running" ? s : null;
  };

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   */
  async function control(req, res, url) {
    const what = url.pathname.slice("/__stand-in/".length);
    const q = url.searchParams;
    if (what === "log") {
      const since = Number(q.get("since") || 0);
      return send(res, 200, log.since(since));
    }
    if (what === "sessions") return send(res, 200, sessions.all().map((s) => ({ ...sessions.json(s), clients: s.client ? 1 : 0 })));
    log.record({ kind: "control", route: `control.${what}`, ...(q.get("session") ? { session: q.get("session") } : {}) });
    if (what === "reset") {
      sessions.reset();
      rules = [];
      log.clear();
      fixtures.reset();
      return send(res, 200, { ok: true });
    }
    if (what === "fail") {
      const r = { route: q.get("route") || "create", status: Number(q.get("status") || 0), times: Number(q.get("times") || 1), delayMs: Math.max(0, Number(q.get("delayMs") || 0)) };
      rules.push(r);
      return send(res, 200, { ok: true, rule: r });
    }
    if (what === "kill") {
      const s = sessions.get(q.get("session") || "");
      if (!s) return send(res, 404, { error: "no such session" });
      return send(res, 200, { ended: sessions.end(s.id, "provider_ended") });
    }
    if (what === "type") {
      const s = runningSession(q.get("session"));
      if (!s) return send(res, 404, { error: "no such session" });
      try {
        const page = await ownPage(s);
        // The person clicks into the field first, as a person would (Phase 5
        // step 2), then types: never the words in this log.
        const at = await centreOf(page, q.get("selector") || "");
        if (!at) return send(res, 404, { error: "no such field" });
        const text = q.get("text") || "";
        if (q.get("keys") === "1" && text.length > 600) return send(res, 400, { error: "too long to type key by key" });
        if (text.length > TEXT_MAX) return send(res, 400, { error: "too long to type" });
        const mapper = createInputMapper(s.viewport);
        await clickAt(page, mapper, at.x, at.y);
        // keys=1: each character its own key (review of Phase 5 step 2: one
        // input event a key), else the words at once, as a paste in the live view.
        if (q.get("keys") === "1") for (const ch of text) await typeKey(page, mapper, ch);
        else if (text) await personInput(page, mapper, [{ t: "text", text }]);
        if (q.get("enter") === "1") await pressEnter(page, mapper);
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 503, { error: String(err instanceof Error ? err.message : err) });
      }
    }
    if (what === "click") {
      const s = runningSession(q.get("session"));
      if (!s) return send(res, 404, { error: "no such session" });
      try {
        const page = await ownPage(s);
        const at = await centreOf(page, q.get("selector") || "");
        if (!at) return send(res, 404, { error: "no such element" });
        await clickAt(page, createInputMapper(s.viewport), at.x, at.y);
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 503, { error: String(err instanceof Error ? err.message : err) });
      }
    }
    if (what === "choose") {
      // A native list: a trusted click on it, then the option's words typed as
      // the person's own keys, which the list's type-ahead chooses by (see the
      // header). Never which option in this log.
      const s = runningSession(q.get("session"));
      if (!s) return send(res, 404, { error: "no such session" });
      const index = Number(q.get("index") || 0);
      if (!Number.isInteger(index) || index < 0 || index > 500) return send(res, 400, { error: "bad index" });
      try {
        const page = await ownPage(s);
        const at = await centreOf(page, q.get("selector") || "");
        if (!at) return send(res, 404, { error: "no such list" });
        const read = await page.send("Runtime.evaluate", {
          expression: `(() => { const el = document.querySelector(${JSON.stringify(q.get("selector") || "")}); if (!el || el.tagName !== "SELECT") return null; const o = el.options[${index}]; return o ? (o.label || o.text) : null; })()`,
          returnByValue: true,
        });
        const words = typeof read.result?.value === "string" ? read.result.value.slice(0, 40) : null;
        if (words === null) return send(res, 404, { error: "no such option" });
        const mapper = createInputMapper(s.viewport);
        await clickAt(page, mapper, at.x, at.y);
        for (const ch of words) await typeKey(page, mapper, ch);
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 503, { error: String(err instanceof Error ? err.message : err) });
      }
    }
    if (what === "page") {
      // A fixture page's own script, by name only (review of Phase 4 step 3): a
      // new twin row inserted, or the cart changed and the page loaded again,
      // as a site does it itself while a card waits.
      const fn = q.get("fn") || "";
      if (!PAGE_FUNCTIONS.has(fn)) return send(res, 400, { error: "no such page function" });
      const s = runningSession(q.get("session"));
      if (!s) return send(res, 404, { error: "no such session" });
      try {
        const page = await ownPage(s);
        const ran = await page.send("Runtime.evaluate", { expression: `(() => { const f = window[${JSON.stringify(fn)}]; if (typeof f !== "function") return false; f(); return true; })()`, returnByValue: true });
        if (!ran.result?.value) return send(res, 404, { error: "the page has no such function" });
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 503, { error: String(err instanceof Error ? err.message : err) });
      }
    }
    if (what === "back") {
      // The person's Back button in the live view, through the controls' own CDP connection.
      const s = runningSession(q.get("session"));
      if (!s) return send(res, 404, { error: "no such session" });
      try {
        const page = await ownPage(s);
        const history = await page.send("Page.getNavigationHistory");
        const entry = history.entries?.[history.currentIndex - 1];
        if (!entry) return send(res, 404, { error: "nothing to go back to" });
        await page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 503, { error: String(err instanceof Error ? err.message : err) });
      }
    }
    if (what === "start-orphan") {
      const made = await sessions.create({
        projectId: "stand-in",
        region: o.cfg.region,
        timeoutSeconds: 600,
        viewport: { width: 1280, height: 800 },
        userMetadata: { wk: q.get("tag") || "workwrk", row: `orphan-${crypto.randomUUID()}` },
        keepAlive: true,
        exempt: true,
      });
      if (!made.ok) return send(res, 503, { error: made.why ?? made.error });
      return send(res, 200, { id: made.session.id });
    }
    return send(res, 404, { error: "no such control" });
  }

  return {
    /**
     * @param {import("node:http").IncomingMessage} req
     * @param {import("node:http").ServerResponse} res
     * @param {URL} url
     */
    handle: (req, res, url) =>
      control(req, res, url).catch(() => {
        if (!res.headersSent) send(res, 500, { error: "stand-in error" });
      }),
    ruleFor,
  };
}
