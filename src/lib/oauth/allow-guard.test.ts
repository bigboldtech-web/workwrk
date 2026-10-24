// The consent page's Allow guard (src/lib/oauth/allow-guard.ts; final review
// of the MCP server, security M1, double-click hijacking). Fails on
// fcca4075: there was no guard, and Allow was live the moment the page
// showed.

import { describe, expect, it } from "vitest";
import { ARM_AFTER_MS, allowGuard } from "./allow-guard";

function host(o: { focused?: boolean; visible?: boolean } = {}) {
  const h = {
    t: 1000,
    focused: o.focused ?? true,
    visible: o.visible ?? true,
    changes: [] as boolean[],
  };
  const guard = allowGuard({ now: () => h.t, focused: () => h.focused, visible: () => h.visible, setArmed: (a) => h.changes.push(a) });
  return { h, guard };
}

describe("the Allow guard", () => {
  it("starts disarmed, and an interaction within the first 600 ms of focus never arms it (the second click of a double click)", () => {
    const { h, guard } = host();
    guard.focus();
    expect(guard.armed).toBe(false);
    for (const dt of [0, 50, 120, ARM_AFTER_MS - 1]) {
      h.t = 1000 + dt;
      guard.interact();
      expect(guard.armed, String(dt)).toBe(false);
    }
    expect(h.changes).toEqual([]);
  });

  it("arms on the first pointer move or key press once the window has held focus and been visible for 600 ms", () => {
    const { h, guard } = host();
    guard.focus();
    h.t += ARM_AFTER_MS;
    // Time alone does not arm it: it waits for the person.
    expect(guard.armed).toBe(false);
    guard.interact();
    expect(guard.armed).toBe(true);
    expect(h.changes).toEqual([true]);
  });

  it("disarms on blur and on the page being hidden, and starts the wait again from the next focus", () => {
    const { h, guard } = host();
    guard.focus();
    h.t += ARM_AFTER_MS;
    guard.interact();
    expect(guard.armed).toBe(true);
    // A popup takes focus, then the window is brought forward again.
    h.focused = false;
    guard.blur();
    expect(guard.armed).toBe(false);
    h.t += 5000;
    h.focused = true;
    guard.focus();
    h.t += 100;
    guard.interact();
    expect(guard.armed).toBe(false);
    h.t += ARM_AFTER_MS;
    guard.interact();
    expect(guard.armed).toBe(true);
    // Hidden, then shown.
    h.visible = false;
    guard.visibility();
    expect(guard.armed).toBe(false);
    h.visible = true;
    guard.visibility();
    h.t += 10;
    guard.interact();
    expect(guard.armed).toBe(false);
    expect(h.changes).toEqual([true, false, true, false]);
  });

  it("never arms while the window is not focused or not visible, however long it waits", () => {
    for (const o of [{ focused: false }, { visible: false }]) {
      const { h, guard } = host(o);
      guard.focus();
      for (let i = 0; i < 5; i += 1) {
        h.t += ARM_AFTER_MS * 2;
        guard.interact();
      }
      expect(guard.armed, JSON.stringify(o)).toBe(false);
    }
  });

  it("counts the wait from the first interaction when it missed the window's focus", () => {
    const { h, guard } = host();
    // No focus() call: the page mounted while the window already had focus, and the event never came.
    guard.interact();
    expect(guard.armed).toBe(false);
    h.t += ARM_AFTER_MS;
    guard.interact();
    expect(guard.armed).toBe(true);
  });
});
