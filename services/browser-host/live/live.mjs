// @ts-check
// The live view's page (docs/plans/browser-host.md 4.1 and 4.2), inside the
// app's browser card frame: the screen of the teammate's browser and a status
// line, nothing else.
//
//   - The token is read from the address fragment (#t=), then removed from
//     the frame's own address with history.replaceState.
//   - It keeps nothing in the person's browser and reads nothing from it: no
//     cookie, no storage of any kind, no clipboard writes. It never runs
//     strings as code and never writes markup.
//   - Frames arrive over the websocket and are drawn on the canvas, the
//     newest only when the page is behind.
//   - Input listeners are registered only inside attachControl(), which runs
//     only after the host's hello says control. A watch view sends nothing
//     but its hello and its pings.
//   - After a close that is not final, it connects again with the same token
//     at 0.5, 1, 2, 4 and 8 seconds, five tries, while the token lasts.

import { LIVE_COPY } from "./copy.mjs";
import {
  BUTTON_NAMES,
  closeState,
  createClickCounter,
  decodeFrame,
  IME_MAX,
  isMac,
  keyMessage,
  modsOf,
  namedKeyMessages,
  PASTE_MAX,
  readToken,
  remotePoint,
  remoteScale,
  RETRY_DELAYS,
  tokenExp,
  wheelPixels,
} from "./view.mjs";

const PING_MS = 20_000;
const DRAG_PX = 8;

/**
 * Start the page in a window.
 * @param {Window & typeof globalThis} g
 */
export function start(g) {
  const doc = g.document;
  const canvas = /** @type {HTMLCanvasElement} */ (doc.getElementById("screen"));
  const keys = /** @type {HTMLTextAreaElement} */ (doc.getElementById("keys"));
  const status = /** @type {HTMLElement} */ (doc.getElementById("status"));
  const ctx = canvas.getContext("2d");

  // The token leaves the frame's address at once.
  const token = readToken(g.location.hash);
  g.history.replaceState(null, "", g.location.pathname);

  const mac = isMac(String(g.navigator.platform || g.navigator.userAgent || ""));
  const wsUrl = `${g.location.origin.replace(/^http/, "ws")}${g.location.pathname}/ws`;
  let exp = token ? tokenExp(token) : null;
  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {"watch" | "control" | null} */
  let mode = null;
  let tries = 0;
  let frame = { w: 1280, h: 800 };
  /** @type {import("./copy.mjs").LiveState | null} */
  let state = null;
  let controlOn = false;

  /** @param {import("./copy.mjs").LiveState | null} next */
  const show = (next) => {
    state = next;
    status.textContent = next ? LIVE_COPY[next] : "";
    status.hidden = !next;
  };
  /** A control message, sent only on an open control socket. @param {Record<string, unknown>} m */
  const send = (m) => {
    if (ws && ws.readyState === 1 && mode === "control") ws.send(JSON.stringify(m));
  };

  if (!token) return show("refused");
  show("connecting");

  /** @type {{ header: { w: number, h: number }, jpeg: Uint8Array } | null} */
  let waiting = null;
  let drawing = false;
  const draw = () => {
    const f = waiting;
    waiting = null;
    if (!f) return;
    drawing = true;
    g.createImageBitmap(new Blob([f.jpeg.slice()], { type: "image/jpeg" }))
      .then((bmp) => {
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
        }
        ctx?.drawImage(bmp, 0, 0);
        bmp.close();
        frame = { w: f.header.w, h: f.header.h };
        if (ws && (state === "connecting" || state === "reconnecting")) show(null);
      })
      .catch(() => undefined)
      .finally(() => {
        drawing = false;
        if (waiting) draw();
      });
  };

  /** @param {string} text */
  const onText = (text) => {
    /** @type {any} */
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (m?.t === "hello" && (m.mode === "watch" || m.mode === "control")) {
      tries = 0;
      mode = m.mode;
      if (Number.isSafeInteger(m.exp)) exp = m.exp;
      if (m.width > 0 && m.height > 0) frame = { w: m.width, h: m.height };
      if (mode === "control") attachControl();
    } else if (m?.t === "ended") {
      show("ended");
    }
  };

  /** @param {number} code @param {string} reason */
  const onClose = (code, reason) => {
    const c = closeState(code, reason);
    if (!c.retry) return show(c.state);
    if (tries < RETRY_DELAYS.length && (exp === null || Date.now() < exp * 1000)) {
      show("reconnecting");
      g.setTimeout(connect, RETRY_DELAYS[tries]);
      tries += 1;
      return;
    }
    show("expired");
  };

  function connect() {
    const sock = new g.WebSocket(wsUrl);
    sock.binaryType = "arraybuffer";
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ t: "hello", token }));
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      if (typeof e.data === "string") return onText(e.data);
      const f = decodeFrame(new Uint8Array(e.data));
      if (!f) return;
      waiting = f;
      if (!drawing) draw();
    };
    sock.onclose = (e) => {
      if (ws !== sock) return;
      ws = null;
      onClose(e.code, e.reason);
    };
  }

  g.setInterval(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "ping" }));
  }, PING_MS);

  /** The person's input, registered only once the host has said control. */
  function attachControl() {
    if (controlOn) return;
    controlOn = true;
    const clicks = createClickCounter();
    /** @type {Record<string, unknown> | null} */
    let move = null;
    /** @type {{ t: "wheel", x: number, y: number, dx: number, dy: number, mods: number } | null} */
    let wheel = null;
    let raf = 0;
    /** @type {{ id: number, x: number, y: number, lastX: number, lastY: number, moved: boolean, many: boolean } | null} */
    let touch = null;
    /** @param {{ clientX: number, clientY: number }} e */
    const point = (e) => remotePoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), frame);
    // Moves and wheels are coalesced to one each an animation frame.
    const flush = () => {
      raf = 0;
      if (move) send(move);
      if (wheel) send(wheel);
      move = null;
      wheel = null;
    };
    const later = () => {
      if (!raf) raf = g.requestAnimationFrame(flush);
    };
    const now = () => {
      if (raf) g.cancelAnimationFrame(raf);
      flush();
    };
    const focusKeys = () => keys.focus({ preventScroll: true });

    canvas.addEventListener("pointerdown", (e) => {
      // A tap or a click focuses the keys, so a phone's keyboard opens.
      focusKeys();
      e.preventDefault();
      if (e.pointerType === "touch") {
        if (touch) touch.many = true;
        else touch = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, many: false };
        return;
      }
      const button = BUTTON_NAMES[e.button];
      if (!button) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      const p = point(e);
      now();
      send({ t: "mouse", type: "down", x: p.x, y: p.y, button, buttons: e.buttons & 7, clicks: clicks.press(e.clientX, e.clientY, button, e.timeStamp), mods: modsOf(e, mac) });
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") {
        // A one finger drag scrolls: wheel deltas, the other way round.
        if (!touch || touch.many || e.pointerId !== touch.id) return;
        const dx = e.clientX - touch.lastX;
        const dy = e.clientY - touch.lastY;
        touch.lastX = e.clientX;
        touch.lastY = e.clientY;
        if (!touch.moved && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > DRAG_PX) touch.moved = true;
        if (!touch.moved) return;
        const k = remoteScale(canvas.getBoundingClientRect(), frame);
        const p = point(e);
        wheel = { t: "wheel", x: p.x, y: p.y, dx: (wheel?.dx ?? 0) - dx * k, dy: (wheel?.dy ?? 0) - dy * k, mods: 0 };
        later();
        return;
      }
      const p = point(e);
      move = { t: "mouse", type: "move", x: p.x, y: p.y, button: "none", buttons: e.buttons & 7, clicks: 1, mods: modsOf(e, mac) };
      later();
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch") {
        const t = touch;
        if (!t || e.pointerId !== t.id) return;
        touch = null;
        if (t.many || t.moved) return;
        // A tap: a move, a press and a release.
        const p = point(e);
        now();
        send({ t: "mouse", type: "move", x: p.x, y: p.y, button: "none", buttons: 0, clicks: 1, mods: 0 });
        send({ t: "mouse", type: "down", x: p.x, y: p.y, button: "left", buttons: 1, clicks: 1, mods: 0 });
        send({ t: "mouse", type: "up", x: p.x, y: p.y, button: "left", buttons: 0, clicks: 1, mods: 0 });
        return;
      }
      const button = BUTTON_NAMES[e.button];
      if (!button) return;
      const p = point(e);
      now();
      send({ t: "mouse", type: "up", x: p.x, y: p.y, button, buttons: e.buttons & 7, clicks: clicks.last(), mods: modsOf(e, mac) });
    });
    canvas.addEventListener("pointercancel", (e) => {
      if (touch && e.pointerId === touch.id) touch = null;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const d = wheelPixels(e.deltaMode, e.deltaX, e.deltaY);
        const p = point(e);
        wheel = { t: "wheel", x: p.x, y: p.y, dx: (wheel?.dx ?? 0) + d.dx, dy: (wheel?.dy ?? 0) + d.dy, mods: modsOf(e, mac) };
        later();
      },
      { passive: false },
    );

    g.addEventListener("focus", focusKeys);
    keys.addEventListener("keydown", (e) => {
      const m = keyMessage("down", e, mac);
      // Composition, a dead key, and Ctrl or Cmd with V are left to the text area (its paste sends the words).
      if (!m) return;
      e.preventDefault();
      send(m);
    });
    keys.addEventListener("keyup", (e) => {
      const m = keyMessage("up", e, mac);
      if (!m) return;
      e.preventDefault();
      send(m);
    });
    keys.addEventListener("beforeinput", (e) => {
      // A soft keyboard's Backspace and Enter arrive here, not as keys.
      if (e.isComposing) return;
      const named = e.inputType === "deleteContentBackward" ? "Backspace" : e.inputType === "insertLineBreak" || e.inputType === "insertParagraph" ? "Enter" : null;
      if (!named) return;
      e.preventDefault();
      for (const m of namedKeyMessages(named)) send(m);
    });
    keys.addEventListener("input", (e) => {
      const ie = /** @type {InputEvent} */ (e);
      if (ie.isComposing) return;
      // A soft keyboard's words.
      if (ie.inputType === "insertText" && ie.data) send({ t: "text", text: ie.data.slice(0, PASTE_MAX) });
      keys.value = "";
    });
    keys.addEventListener("compositionupdate", (e) => {
      const text = (e.data || "").slice(0, IME_MAX);
      send({ t: "ime", text, start: text.length, end: text.length });
    });
    keys.addEventListener("compositionend", (e) => {
      const text = e.data || "";
      if (text) send({ t: "text", text: text.slice(0, PASTE_MAX) });
      else send({ t: "ime", text: "", start: 0, end: 0 });
      g.setTimeout(() => void (keys.value = ""), 0);
    });
    keys.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData("text/plain") || "").slice(0, PASTE_MAX);
      if (text) send({ t: "text", text });
    });
  }

  connect();
}

if (typeof window !== "undefined" && typeof document !== "undefined" && document.getElementById("screen")) start(window);
