// The consent page's Allow, armed only by a person who is looking at it
// (final review of the MCP server, security M1: double-click hijacking).
//
// THE ATTACK. Framing rules do not stop it (DoubleClickjacking, December
// 2024): a page asks for a double click; on the first press it opens or
// brings forward the consent page for its own app, already showing, with
// the workspace and Read and change chosen; the second click lands on Allow
// before the person has seen the page. The app then holds 30 days of read
// and write as them.
//
// THE GUARD. Allow starts disabled, and is armed only once the window has
// held focus and been visible for ARM_AFTER_MS, and then the person moves
// the pointer or presses a key. Losing focus, or the page being hidden,
// disarms it and starts the wait again. An interaction is counted only
// after the wait, so the second click of a double click, or a move made
// while the page was brought forward, never arms it. Deny is never guarded.
//
// WITH NO SCRIPT. Allow is drawn disabled, so it cannot be pressed, and the
// decision refuses an Allow posted without the field this guard adds
// (ARMED_FIELD), sending the person back to the consent page with the
// request still pending (decision.ts). Chosen over a second confirm step,
// which a third click could hijack the same way.
//
// Pure: the consent page's client form (src/app/(auth)/oauth/guarded-allow.tsx)
// and the tests share it.

/** How long the window must have held focus and been visible before an interaction arms Allow. */
export const ARM_AFTER_MS = 600;

/** The form field the armed Allow carries, and its value; the decision refuses an Allow without it. */
export const ARMED_FIELD = "armed";
export const ARMED_VALUE = "1";

export interface AllowGuardHost {
  /** A monotonic clock, in milliseconds. */
  now(): number;
  /** document.hasFocus() */
  focused(): boolean;
  /** document.visibilityState === "visible" */
  visible(): boolean;
  /** Called whenever the guard arms or disarms. */
  setArmed(armed: boolean): void;
}

export interface AllowGuard {
  /** On mount, and on the window's focus. */
  focus(): void;
  /** On the window's blur. */
  blur(): void;
  /** On visibilitychange. */
  visibility(): void;
  /** On pointermove and keydown. */
  interact(): void;
  readonly armed: boolean;
}

export function allowGuard(host: AllowGuardHost): AllowGuard {
  /** When the window last became focused and visible, or null while it is not. */
  let since: number | null = null;
  let armed = false;
  const set = (v: boolean) => {
    if (armed === v) return;
    armed = v;
    host.setArmed(v);
  };
  const disarm = () => {
    since = null;
    set(false);
  };
  const looking = () => host.focused() && host.visible();
  const begin = () => {
    if (!looking()) return disarm();
    if (since === null) since = host.now();
  };
  return {
    focus: begin,
    blur: disarm,
    visibility: () => (host.visible() ? begin() : disarm()),
    interact: () => {
      if (!looking()) return disarm();
      if (since === null) {
        since = host.now();
        return;
      }
      if (host.now() - since >= ARM_AFTER_MS) set(true);
    },
    get armed() {
      return armed;
    },
  };
}
