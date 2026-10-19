// @ts-check
// The live view's input mapping (docs/plans/browser-host.md 4.2, Decision 6):
// a viewer's message to the CDP Input command the remote page receives, so
// the page sees trusted events, as the recorder needs.
//
//   mouse move          Input.dispatchMouseEvent mouseMoved, with the held button or "none"
//   mouse down / up     mousePressed / mouseReleased, with button, buttons, clickCount, modifiers
//   wheel               Input.dispatchMouseEvent mouseWheel, with deltaX and deltaY
//   key down, text      Input.dispatchKeyEvent keyDown with text and unmodifiedText (Enter carries "\r")
//   key down, no text   the same as rawKeyDown, with no text
//   key up              keyUp
//   text                Input.insertText (a paste, a committed IME text, a soft keyboard's words)
//   ime                 Input.imeSetComposition
//
// THE CHECKS on every message: coordinates are clamped to the viewport,
// deltas to plus or minus 10,000 and modifiers to 0 to 15; control
// characters are stripped from text, but a line break and a tab; unknown
// types and fields are dropped, and counted. Ctrl or Cmd with V is never a
// key (the page's paste event sends the words instead). Text over 10,000
// characters is refused.
//
// THE HELD STATE: each mapper remembers the buttons and keys its viewer
// pressed and never released, so the host can release them when the viewer
// leaves (release()), by any close.
//
// LIVE_METHODS, the only commands the live view's own connection to the tab
// may send. The proof controls (proof/controls.mjs, proof mode only) build
// their pointer and key input here too, as a viewer's messages, and send the
// commands on a connection of their own.
//
// Pure: no I/O, no clock.

/** The commands the live view's connection may send (Decision 6). */
export const LIVE_METHODS = Object.freeze([
  "Page.startScreencast",
  "Page.stopScreencast",
  "Page.screencastFrameAck",
  "Page.bringToFront",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Input.imeSetComposition",
]);

/** The messages that are input: a watch view sending any of them is closed 4403. */
export const INPUT_TYPES = Object.freeze(["mouse", "wheel", "key", "text", "ime"]);

export const TEXT_MAX = 10_000;
export const IME_MAX = 200;
export const KEY_TEXT_MAX = 8;
export const KEY_MAX = 32;
export const DELTA_MAX = 10_000;

/** CDP's modifier bits. */
export const MOD = Object.freeze({ alt: 1, ctrl: 2, meta: 4, shift: 8 });

/** The fields each message type may carry; any other is dropped and counted. */
const FIELDS = /** @type {Record<string, ReadonlySet<string>>} */ ({
  mouse: new Set(["t", "type", "x", "y", "button", "buttons", "clicks", "mods"]),
  wheel: new Set(["t", "x", "y", "dx", "dy", "mods"]),
  key: new Set(["t", "type", "key", "code", "vk", "text", "mods", "repeat", "location"]),
  text: new Set(["t", "text"]),
  ime: new Set(["t", "text", "start", "end"]),
});

const BUTTON_BITS = /** @type {Record<string, number>} */ ({ left: 1, right: 2, middle: 4 });
const BUTTON_ORDER = ["left", "middle", "right"];
const CODE = /^[A-Za-z0-9]{1,32}$/;
// Control characters, but a tab (09) and a line break (0A).
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * @typedef {{ method: string, params: Record<string, unknown> }} Command
 * @typedef {{ width: number, height: number }} Viewport
 * @typedef {"unknown_type" | "bad_value" | "too_long" | "paste_key" | "not_held"} MapWhy
 * @typedef {{ ok: true, kind: string, droppable: boolean, commands: Command[], chars: number, droppedFields: number }
 *   | { ok: false, why: MapWhy, droppedFields: number }} MapResult
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** @param {unknown} v @returns {v is number} */
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Modifiers clamped to 0 to 15; anything but a number is none. @param {unknown} v */
const modsOf = (v) => (finite(v) ? clamp(Math.trunc(v), 0, 15) : 0);

/**
 * Text with its control characters stripped, but a line break and a tab.
 * @param {string} s
 */
export function stripControls(s) {
  return s.replace(CONTROL, "");
}

/**
 * A viewer's one message as JSON, or null when it is not an object with a type.
 * @param {unknown} raw text the viewer sent
 * @returns {Record<string, unknown> | null}
 */
export function parseMessage(raw) {
  if (typeof raw !== "string" || raw.length > 64 * 1024) return null;
  try {
    const v = JSON.parse(raw);
    return isObject(v) && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Whether a message is input (a watch view sending one is closed).
 * @param {Record<string, unknown>} msg
 */
export const isInput = (msg) => INPUT_TYPES.includes(String(msg.t));

/**
 * A viewer's mapper: its messages to CDP commands, with what it holds.
 * @param {Viewport} viewport the session's own, which never changes (Decision 6)
 */
export function createInputMapper(viewport) {
  const maxX = Math.max(0, viewport.width - 1);
  const maxY = Math.max(0, viewport.height - 1);
  /** The buttons pressed and not released, in press order. */
  /** @type {Set<string>} */
  const buttons = new Set();
  /** The keys pressed and not released, by code (or key when there is none). */
  /** @type {Map<string, { key: string, code: string, vk: number, location: number }>} */
  const keys = new Map();
  let lastX = 0;
  let lastY = 0;

  const heldMask = () => {
    let m = 0;
    for (const b of buttons) m |= BUTTON_BITS[b] ?? 0;
    return m;
  };
  const heldButton = () => BUTTON_ORDER.find((b) => buttons.has(b)) ?? "none";

  /** @param {Record<string, unknown>} msg @param {string} type */
  const extra = (msg, type) => {
    const allowed = FIELDS[type];
    let n = 0;
    for (const k of Object.keys(msg)) if (!allowed.has(k)) n += 1;
    return n;
  };

  /**
   * @param {Record<string, unknown>} msg
   * @returns {{ x: number, y: number } | null}
   */
  const point = (msg) => {
    if (!finite(msg.x) || !finite(msg.y)) return null;
    return { x: clamp(msg.x, 0, maxX), y: clamp(msg.y, 0, maxY) };
  };

  /**
   * One message.
   * @param {Record<string, unknown>} msg
   * @returns {MapResult}
   */
  function map(msg) {
    const type = String(msg.t);
    if (!FIELDS[type]) return { ok: false, why: "unknown_type", droppedFields: 0 };
    const droppedFields = extra(msg, type);
    /** @param {MapWhy} why @returns {MapResult} */
    const no = (why) => ({ ok: false, why, droppedFields });
    /** @param {Command[]} commands @param {boolean} droppable @param {number} [chars] @returns {MapResult} */
    const yes = (commands, droppable, chars = 0) => ({ ok: true, kind: type, droppable, commands, chars, droppedFields });

    if (type === "mouse") {
      const at = point(msg);
      if (!at) return no("bad_value");
      const modifiers = modsOf(msg.mods);
      const what = msg.type;
      if (what === "move") {
        lastX = at.x;
        lastY = at.y;
        return yes([{ method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: at.x, y: at.y, button: heldButton(), buttons: heldMask(), modifiers } }], true);
      }
      if (what !== "down" && what !== "up") return no("bad_value");
      const button = typeof msg.button === "string" && BUTTON_BITS[msg.button] ? msg.button : null;
      if (!button) return no("bad_value");
      const clickCount = finite(msg.clicks) ? clamp(Math.trunc(msg.clicks), 1, 3) : 1;
      lastX = at.x;
      lastY = at.y;
      if (what === "down") {
        buttons.add(button);
        return yes([{ method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: at.x, y: at.y, button, buttons: heldMask(), clickCount, modifiers } }], false);
      }
      // A release of a button this viewer never pressed is not sent: the remote page holds no such press of ours.
      if (!buttons.has(button)) return no("not_held");
      buttons.delete(button);
      return yes([{ method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: at.x, y: at.y, button, buttons: heldMask(), clickCount, modifiers } }], false);
    }

    if (type === "wheel") {
      const at = point(msg);
      if (!at || !finite(msg.dx) || !finite(msg.dy)) return no("bad_value");
      lastX = at.x;
      lastY = at.y;
      const params = { type: "mouseWheel", x: at.x, y: at.y, deltaX: clamp(msg.dx, -DELTA_MAX, DELTA_MAX), deltaY: clamp(msg.dy, -DELTA_MAX, DELTA_MAX), modifiers: modsOf(msg.mods) };
      return yes([{ method: "Input.dispatchMouseEvent", params }], true);
    }

    if (type === "key") {
      const what = msg.type;
      if (what !== "down" && what !== "up") return no("bad_value");
      const key = msg.key;
      if (typeof key !== "string" || key.length < 1 || key.length > KEY_MAX) return no("bad_value");
      const code = typeof msg.code === "string" && CODE.test(msg.code) ? msg.code : "";
      const vk = finite(msg.vk) && Number.isInteger(msg.vk) && msg.vk >= 0 && msg.vk <= 255 ? msg.vk : 0;
      const modifiers = modsOf(msg.mods);
      const location = finite(msg.location) && Number.isInteger(msg.location) && msg.location >= 0 && msg.location <= 3 ? msg.location : 0;
      // Ctrl or Cmd with V is never a key: the page's paste event sends the words.
      if ((modifiers & (MOD.ctrl | MOD.meta)) !== 0 && (key === "v" || key === "V" || code === "KeyV")) return no("paste_key");
      const id = code || key;
      if (what === "up") {
        keys.delete(id);
        return yes([{ method: "Input.dispatchKeyEvent", params: { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, location } }], false);
      }
      const textRaw = typeof msg.text === "string" ? msg.text : "";
      if (textRaw.length > KEY_TEXT_MAX) return no("bad_value");
      const text = key === "Enter" ? "\r" : stripControls(textRaw);
      keys.set(id, { key, code, vk, location });
      const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, autoRepeat: msg.repeat === true, location };
      const params = text ? { type: "keyDown", ...base, text, unmodifiedText: text } : { type: "rawKeyDown", ...base };
      return yes([{ method: "Input.dispatchKeyEvent", params }], false);
    }

    if (type === "text") {
      if (typeof msg.text !== "string" || msg.text.length < 1) return no("bad_value");
      if (msg.text.length > TEXT_MAX) return no("too_long");
      const text = stripControls(msg.text);
      if (!text) return no("bad_value");
      return yes([{ method: "Input.insertText", params: { text } }], false, msg.text.length);
    }

    // ime
    if (typeof msg.text !== "string" || msg.text.length > IME_MAX) return no(typeof msg.text === "string" ? "too_long" : "bad_value");
    const text = stripControls(msg.text);
    const pos = (/** @type {unknown} */ v) => (finite(v) ? clamp(Math.trunc(v), 0, text.length) : text.length);
    return yes([{ method: "Input.imeSetComposition", params: { text, selectionStart: pos(msg.start), selectionEnd: pos(msg.end) } }], false, msg.text.length);
  }

  /**
   * What the viewer holds, released on its behalf: a mouseReleased at the last
   * position for each button it pressed and never released, then a keyUp for
   * each key. The held state is cleared.
   * @returns {Command[]}
   */
  function release() {
    /** @type {Command[]} */
    const out = [];
    for (const button of [...buttons]) {
      buttons.delete(button);
      out.push({ method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: lastX, y: lastY, button, buttons: heldMask(), clickCount: 1, modifiers: 0 } });
    }
    for (const k of keys.values()) {
      out.push({ method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: 0, location: k.location } });
    }
    keys.clear();
    return out;
  }

  return { map, release, held: () => ({ buttons: [...buttons], keys: [...keys.keys()] }) };
}

/** @typedef {ReturnType<typeof createInputMapper>} InputMapper */

// ── The proof controls' input, as a viewer's messages (proof/controls.mjs) ──

/**
 * A trusted click at a point, as the person's own pointer: a move, a press and a release of the left button.
 * @param {number} x
 * @param {number} y
 * @returns {Array<Record<string, unknown>>}
 */
export function clickMessages(x, y) {
  return [
    { t: "mouse", type: "move", x, y, button: "none", buttons: 0, clicks: 1, mods: 0 },
    { t: "mouse", type: "down", x, y, button: "left", buttons: 1, clicks: 1, mods: 0 },
    { t: "mouse", type: "up", x, y, button: "left", buttons: 0, clicks: 1, mods: 0 },
  ];
}

/**
 * One character as a key the person pressed: a key down with its text, then up.
 * @param {string} ch
 * @returns {Array<Record<string, unknown>>}
 */
export function charKeyMessages(ch) {
  const upper = ch.toUpperCase();
  const letter = /^[A-Z]$/.test(upper);
  const digit = /^[0-9]$/.test(ch);
  const code = letter ? `Key${upper}` : digit ? `Digit${ch}` : ch === " " ? "Space" : undefined;
  const vk = letter || digit ? upper.charCodeAt(0) : ch === " " ? 32 : 0;
  const base = { t: "key", key: ch, ...(code ? { code } : {}), vk, mods: 0, repeat: false, location: 0 };
  return [
    { ...base, type: "down", text: ch },
    { ...base, type: "up", text: "" },
  ];
}

/**
 * Enter, as the person pressed it.
 * @returns {Array<Record<string, unknown>>}
 */
export function enterMessages() {
  const base = { t: "key", key: "Enter", code: "Enter", vk: 13, text: "", mods: 0, repeat: false, location: 0 };
  return [
    { ...base, type: "down" },
    { ...base, type: "up" },
  ];
}
