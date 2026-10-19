// @ts-check
// The live page's pure parts (docs/plans/browser-host.md 4.1 and 4.2): the
// token read from the fragment, a frame's bytes, what a close means, and a
// viewer's events turned into the protocol's messages. Served to the page as
// /live/assets/view.mjs and read by live/live.mjs; tested in node
// (lib/live-input.test.ts and live/page.test.ts).
//
//   - Cmd on a Mac viewer is sent as Ctrl, since the remote browser is Linux,
//     so Cmd+A selects all there.
//   - Ctrl or Cmd with V is never sent as a key: the paste event sends the
//     words instead.
//   - A key that types a character sends it as `text`; a key held during a
//     composition (isComposing, or keyCode 229) is left to the composition.
//
// No I/O.

export const MOD = Object.freeze({ alt: 1, ctrl: 2, meta: 4, shift: 8 });
export const PASTE_MAX = 10_000;
export const IME_MAX = 200;
export const LINE_PX = 40;
export const PAGE_PX = 800;
export const CLICK_MS = 500;
export const CLICK_PX = 4;
/** The reconnect waits after a close that is not final: five tries (4.2). */
export const RETRY_DELAYS = Object.freeze([500, 1000, 2000, 4000, 8000]);
/** The pointer buttons the page sends, by MouseEvent.button. */
export const BUTTON_NAMES = Object.freeze(/** @type {Record<number, string>} */ ({ 0: "left", 1: "middle", 2: "right" }));

const CODE = /^[A-Za-z0-9]{1,32}$/;
/** Keys that belong to a composition, never sent as keys. */
const COMPOSING = new Set(["Dead", "Process", "Unidentified"]);

/**
 * A table's own entry, never one off its prototype.
 * @template T
 * @param {Readonly<Record<string | number, T>>} table
 * @param {string | number} key
 * @returns {T | undefined}
 */
export const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/** @param {string} platform */
export const isMac = (platform) => /Mac|iPhone|iPad|iPod/.test(platform);

/**
 * @typedef {{ altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }} ModEvent
 * @typedef {ModEvent & { key: string, code: string, keyCode: number, repeat: boolean, location: number, isComposing?: boolean }} KeyEventLike
 */

/**
 * CDP's modifier bits for an event: Cmd on a Mac viewer is Ctrl.
 * @param {ModEvent} ev
 * @param {boolean} mac
 */
export function modsOf(ev, mac) {
  let m = 0;
  if (ev.altKey) m |= MOD.alt;
  if (ev.ctrlKey || (mac && ev.metaKey)) m |= MOD.ctrl;
  if (ev.metaKey && !mac) m |= MOD.meta;
  if (ev.shiftKey) m |= MOD.shift;
  return m;
}

/**
 * A key event as the protocol's key message, or null when it is not sent:
 * part of a composition, a dead key, or Ctrl or Cmd with V (the paste event
 * sends the words).
 * @param {"down" | "up"} type
 * @param {KeyEventLike} ev
 * @param {boolean} mac
 * @returns {Record<string, unknown> | null}
 */
export function keyMessage(type, ev, mac) {
  if (ev.isComposing || ev.keyCode === 229) return null;
  let key = typeof ev.key === "string" ? ev.key : "";
  let code = typeof ev.code === "string" ? ev.code : "";
  let vk = Number.isInteger(ev.keyCode) ? ev.keyCode & 255 : 0;
  if (!key || key.length > 32 || COMPOSING.has(key)) return null;
  let mods = modsOf(ev, mac);
  // Cmd itself, on a Mac viewer, is the remote's Ctrl.
  if (mac && key === "Meta") {
    key = "Control";
    code = code.replace("Meta", "Control");
    vk = 17;
  }
  const shortcut = (mods & (MOD.ctrl | MOD.meta)) !== 0;
  if (shortcut && (key === "v" || key === "V" || code === "KeyV")) return null;
  const single = [...key].length === 1;
  // AltGr (Ctrl and Alt on Windows) and Option on a Mac type characters.
  const altGr = !mac && ev.ctrlKey && ev.altKey && !ev.metaKey;
  const types = single && (!shortcut || altGr);
  if (types) mods &= MOD.shift;
  /** @type {Record<string, unknown>} */
  const msg = { t: "key", type, key, vk, text: types && type === "down" ? key : "", mods, repeat: ev.repeat === true, location: Number.isInteger(ev.location) ? ev.location & 3 : 0 };
  if (CODE.test(code)) msg.code = code;
  return msg;
}

/**
 * A soft keyboard's Backspace or Enter (its beforeinput), as a press and a release.
 * @param {"Backspace" | "Enter"} key
 */
export function namedKeyMessages(key) {
  const vk = key === "Enter" ? 13 : 8;
  const base = { t: "key", key, code: key, vk, text: "", mods: 0, repeat: false, location: 0 };
  return [
    { ...base, type: "down" },
    { ...base, type: "up" },
  ];
}

/**
 * A wheel's deltas in pixels: a line is 40 px, a page 800 px.
 * @param {number} deltaMode
 * @param {number} dx
 * @param {number} dy
 */
export function wheelPixels(deltaMode, dx, dy) {
  const k = deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1;
  return { dx: dx * k, dy: dy * k };
}

/**
 * The remote pixels one of the frame's pixels on screen stands for, with the
 * picture letterboxed to the frame's own shape inside the canvas.
 * @param {{ width: number, height: number }} rect
 * @param {{ w: number, h: number }} frame
 */
export function remoteScale(rect, frame) {
  const s = Math.min(rect.width / frame.w, rect.height / frame.h);
  return s > 0 && Number.isFinite(s) ? 1 / s : 1;
}

/**
 * A point on the canvas as a point in the remote viewport: x = (clientX -
 * left) times w over width, with the picture letterboxed to the frame's shape.
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ w: number, h: number }} frame
 */
export function remotePoint(clientX, clientY, rect, frame) {
  const k = remoteScale(rect, frame);
  const ox = rect.left + (rect.width - frame.w / k) / 2;
  const oy = rect.top + (rect.height - frame.h / k) / 2;
  const clamp = (/** @type {number} */ v, /** @type {number} */ hi) => Math.min(hi, Math.max(0, v));
  return { x: clamp((clientX - ox) * k, frame.w - 1), y: clamp((clientY - oy) * k, frame.h - 1) };
}

/**
 * Double and triple clicks: presses of one button within 500 ms and 4 px of the last count up, to 3.
 */
export function createClickCounter() {
  let last = { x: 0, y: 0, button: "", t: -Infinity, n: 0 };
  return {
    /**
     * @param {number} x
     * @param {number} y
     * @param {string} button
     * @param {number} t
     */
    press(x, y, button, t) {
      const near = button === last.button && t - last.t <= CLICK_MS && Math.hypot(x - last.x, y - last.y) <= CLICK_PX;
      last = { x, y, button, t, n: near ? Math.min(3, last.n + 1) : 1 };
      return last.n;
    },
    /** The count of the last press, for its release. */
    last: () => Math.max(1, last.n),
  };
}

/**
 * The token in the frame's address fragment (#t=<token>), or null.
 * @param {string} hash
 */
export function readToken(hash) {
  const m = /^#t=([A-Za-z0-9_.-]{1,1024})$/.exec(hash);
  return m ? m[1] : null;
}

/**
 * When a token expires (its payload's e, unix seconds), or null when it cannot be read.
 * @param {string} token
 */
export function tokenExp(token) {
  try {
    const b64 = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const body = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return Number.isSafeInteger(body?.e) ? body.e : null;
  } catch {
    return null;
  }
}

/**
 * A binary frame: 0x01, a 4 byte big-endian header length, the header JSON
 * ({ w, h, sx, sy, seq }), then the JPEG. Null when it is not one.
 * @param {Uint8Array} bytes
 * @returns {{ header: { w: number, h: number, sx: number, sy: number, seq: number }, jpeg: Uint8Array } | null}
 */
export function decodeFrame(bytes) {
  if (bytes.length < 7 || bytes[0] !== 0x01) return null;
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
  if (len < 2 || 5 + len >= bytes.length) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(5, 5 + len)));
    if (!(header?.w > 0 && header?.h > 0)) return null;
    return { header, jpeg: bytes.subarray(5 + len) };
  } catch {
    return null;
  }
}

/**
 * What a close means for the page (4.2): the words it shows, and whether it tries again.
 * @param {number} code
 * @param {string} reason
 * @returns {{ state: "refused" | "expired" | "revoked" | "ended" | "reconnecting" | null, retry: boolean }}
 */
export function closeState(code, reason) {
  if (code === 4400 || code === 4403 || code === 4409) return { state: "refused", retry: false };
  if (code === 4401) return { state: reason === "expired" ? "expired" : reason === "revoked" ? "revoked" : "refused", retry: false };
  if (code === 4404) return { state: "ended", retry: false };
  // Replaced by a newer socket on the same token: that page is gone or is this one's successor.
  if (code === 4408) return { state: null, retry: false };
  return { state: "reconnecting", retry: true };
}
