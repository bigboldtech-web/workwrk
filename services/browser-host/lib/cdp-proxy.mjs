// @ts-check
// The connect address (docs/plans/browser-host.md 6.3, Decision 8):
// WebSocket /connect/{id}?t=<token>, relayed byte for byte to the session's
// Chrome.
//
//   - THE UPGRADE checks the session and the token before anything is
//     upgraded: 404 unknown or not running, 401 a wrong token, 409 once a
//     client has connected (during and after: the token works once, and the
//     session ends with its one client). A refusal is an HTTP status, then
//     the socket is destroyed; a target that is not a path is 400. The token
//     is spent only once the websocket handshake has succeeded, so a
//     malformed handshake never uses it up; of two that pass at once, the
//     first to finish wins and the other is closed 4409.
//   - THE RELAY passes messages both ways, unchanged and in order (text
//     stays text, binary stays binary), with no compression and a 64 MB cap
//     each way (above the app's 32 MB). The client's messages wait until the
//     upstream opens, as the stand-in's did. Nothing is read, parsed or kept.
//   - BACKPRESSURE (final security review, L1): once more than BUFFER_HIGH
//     waits to go out on one side (its socket's bufferedAmount, or the
//     client's messages waiting for the upstream to open), the other side is
//     no longer read until what waits is down to BUFFER_LOW. So a reader
//     that falls behind slows its writer down through TCP, and the host never
//     holds an unbounded backlog of a session's messages in its memory.
//   - KEEPALIVE: a ping to the client every 30 seconds (the app's ws answers
//     by itself); a client with no pong for 120 seconds, on the monotonic
//     clock, is gone, and the session ends last_client_left.
//   - Either side closing or failing closes the other and ends the session.
//
// It logs codes only: never the id, the token or an address.

import WebSocket, { WebSocketServer } from "ws";

import { requestUrl } from "./api.mjs";

export const MAX_PAYLOAD = 64 * 1024 * 1024;
/** One side is read no more once this much waits to go out on the other (see the header). */
export const BUFFER_HIGH = 8 * 1024 * 1024;
/** And read again once what waits is down to this. */
export const BUFFER_LOW = 1024 * 1024;
export const PING_MS = 30_000;
export const DEAD_MS = 120_000;

const REASONS = /** @type {Record<number, string>} */ ({ 400: "Bad Request", 401: "Unauthorized", 404: "Not Found", 409: "Conflict" });

/**
 * Refuse an upgrade with a status, then destroy the socket.
 * @param {import("node:stream").Duplex} socket
 * @param {number} status
 */
function refuse(socket, status) {
  try {
    socket.write(`HTTP/1.1 ${status} ${REASONS[status] ?? "Refused"}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
  } catch {
    /* gone */
  }
  socket.destroy();
}

/**
 * @typedef {{
 *   refused?: (path: string, status: number) => void,
 *   connected?: (id: string) => void,
 *   disconnected?: (id: string) => void,
 * }} ProxyHooks
 */

/**
 * The /connect upgrade handler.
 * @param {{
 *   sessions: Pick<import("./sessions.mjs").Sessions, "claim" | "attachClient" | "clientGone" | "end">,
 *   log: import("./log.mjs").Log,
 *   pingMs?: number,
 *   deadMs?: number,
 *   now?: () => number,
 *   hooks?: ProxyHooks,
 * }} o
 */
export function createCdpProxy(o) {
  const { sessions, log } = o;
  const pingMs = o.pingMs ?? PING_MS;
  const deadMs = o.deadMs ?? DEAD_MS;
  // The monotonic clock (Risk 17): a change of the wall clock never frees or keeps a client.
  const now = o.now ?? (() => performance.now());
  const hooks = o.hooks ?? {};
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_PAYLOAD });
  const tally = { refused: 0, connected: 0, paused: 0 };

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:stream").Duplex} socket
   * @param {Buffer} head
   * @returns {boolean} whether this was a /connect upgrade
   */
  function upgrade(req, socket, head) {
    const url = requestUrl(req.url);
    if (!url) {
      tally.refused += 1;
      log.event("connect", "refused", 400);
      refuse(socket, 400);
      return true;
    }
    if (!url.pathname.startsWith("/connect/")) return false;
    const m = /^\/connect\/([A-Za-z0-9_-]{1,200})$/.exec(url.pathname);
    const token = url.searchParams.get("t");
    // Checked here, spent only once the handshake has succeeded.
    const check = m ? sessions.claim(m[1], token, false) : /** @type {const} */ ({ ok: false, status: 404 });
    const status = !check.ok ? check.status : check.session.launched ? 0 : 404;
    if (status) {
      tally.refused += 1;
      log.event("connect", "refused", status);
      hooks.refused?.(url.pathname, status);
      refuse(socket, status);
      return true;
    }
    const id = /** @type {RegExpExecArray} */ (m)[1];
    wss.handleUpgrade(req, socket, head, (client) => {
      const spent = sessions.claim(id, token);
      const launched = spent.ok ? spent.session.launched : null;
      if (!spent.ok || !launched) {
        // Another connect finished first, or the session ended during the handshake.
        const code = spent.ok ? 404 : spent.status;
        tally.refused += 1;
        log.event("connect", "refused", code);
        hooks.refused?.(url.pathname, code);
        client.close(4000 + code);
        return;
      }
      relay(id, launched.browserWs, client);
    });
    return true;
  }

  /**
   * @param {string} id
   * @param {string} browserWs
   * @param {WebSocket} client
   */
  function relay(id, browserWs, client) {
    tally.connected += 1;
    log.event("connect", "ok");
    hooks.connected?.(id);
    let closed = false;
    /** @type {Array<[WebSocket.RawData, boolean]>} */
    const waiting = [];
    const upstream = new WebSocket(browserWs, { perMessageDeflate: false, maxPayload: MAX_PAYLOAD, followRedirects: false });
    let lastPong = now();
    const timer = setInterval(() => {
      if (now() - lastPong > deadMs) {
        log.event("connect", "client_silent");
        try {
          client.terminate();
        } catch {
          /* gone */
        }
        close("silent");
        return;
      }
      try {
        client.ping();
      } catch {
        /* closing */
      }
    }, pingMs);
    timer.unref?.();

    /** @param {string} why */
    const close = (why) => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      try {
        client.close();
      } catch {
        /* gone */
      }
      try {
        if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        else upstream.close();
      } catch {
        /* gone */
      }
      hooks.disconnected?.(id);
      if (why === "upstream") sessions.end(id, "chrome_exited");
      else sessions.clientGone(id);
    };

    // The session ending (any reason) closes this client.
    sessions.attachClient(id, { close: () => close("ended") });

    let waitingBytes = 0;
    /**
     * One message on to `to`, with backpressure on `from` (see the header).
     * @param {WebSocket} from
     * @param {WebSocket} to
     * @param {WebSocket.RawData} data
     * @param {boolean} binary
     */
    const forward = (from, to, data, binary) => {
      to.send(data, { binary }, () => {
        // Flushed: the reader caught up enough, so its writer is read again.
        if (!closed && from.isPaused && to.bufferedAmount <= BUFFER_LOW) from.resume();
      });
      if (to.bufferedAmount > BUFFER_HIGH && !from.isPaused) {
        tally.paused += 1;
        from.pause();
      }
    };

    client.on("pong", () => (lastPong = now()));
    client.on("message", (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) forward(client, upstream, data, binary);
      else if (upstream.readyState === WebSocket.CONNECTING) {
        waiting.push([data, binary]);
        waitingBytes += Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : data instanceof ArrayBuffer ? data.byteLength : data.length;
        if (waitingBytes > BUFFER_HIGH && !client.isPaused) {
          tally.paused += 1;
          client.pause();
        }
      }
    });
    upstream.on("open", () => {
      for (const [data, binary] of waiting.splice(0)) forward(client, upstream, data, binary);
      waitingBytes = 0;
      if (client.isPaused && upstream.bufferedAmount <= BUFFER_LOW) client.resume();
    });
    upstream.on("message", (data, binary) => {
      if (client.readyState === WebSocket.OPEN) forward(upstream, client, data, binary);
    });
    client.on("close", () => close("client"));
    client.on("error", () => close("client"));
    upstream.on("close", () => close("upstream"));
    upstream.on("error", () => close("upstream"));
  }

  return { upgrade, tally: () => ({ ...tally }), close: () => wss.close() };
}
