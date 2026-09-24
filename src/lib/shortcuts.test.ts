import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHORTCUTS,
  ShortcutRegistry,
  chordEquals,
  eventChord,
  formatKeys,
  hubShortcutHint,
  parseKeys,
  shortcutHint,
  type ShortcutDef,
} from "./shortcuts";

type KeyInit = { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; defaultPrevented?: boolean };

function keyEvent(init: KeyInit): KeyboardEvent {
  let prevented = init.defaultPrevented ?? false;
  const e = {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    target: null,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
  };
  return e as unknown as KeyboardEvent;
}

function def(id: string, keys: string, run: () => void, extra: Partial<ShortcutDef> = {}): ShortcutDef {
  return { id, keys, label: id, scope: "global", run, ...extra };
}

describe("parse and match", () => {
  it("parses modifiers and sequences", () => {
    expect(parseKeys("mod+shift+k")).toEqual([{ mod: true, shift: true, alt: false, key: "k" }]);
    expect(parseKeys("g 1")).toEqual([
      { mod: false, shift: false, alt: false, key: "g" },
      { mod: false, shift: false, alt: false, key: "1" },
    ]);
    expect(parseKeys("mod+\\")[0].key).toBe("\\");
    expect(parseKeys("esc")[0].key).toBe("escape");
  });
  it("matches ctrl as mod and ignores shift for punctuation keys", () => {
    const k = parseKeys("mod+k")[0];
    expect(chordEquals(k, eventChord(keyEvent({ key: "k", ctrlKey: true })))).toBe(true);
    expect(chordEquals(k, eventChord(keyEvent({ key: "K", metaKey: true, shiftKey: true })))).toBe(false);
    const q = parseKeys("?")[0];
    expect(chordEquals(q, eventChord(keyEvent({ key: "?", shiftKey: true })))).toBe(true);
  });
});

describe("formatKeys", () => {
  it("prints the platform glyphs the spec mandates", () => {
    expect(formatKeys("mod+shift+k", "mac")).toBe("⌘⇧K");
    expect(formatKeys("mod+shift+k", "other")).toBe("Ctrl+Shift+K");
    expect(formatKeys("g 1", "mac")).toBe("G 1");
    expect(formatKeys("mod+\\", "mac")).toBe("⌘\\");
    expect(formatKeys("escape", "other")).toBe("Esc");
    expect(formatKeys("?", "mac")).toBe("?");
  });
});

describe("the canon", () => {
  it("never advertises a browser-reserved chord", () => {
    const reserved = ["mod+t", "mod+shift+n", "mod+w", "mod+n", "mod+b", ...Array.from({ length: 9 }, (_, i) => `mod+${i + 1}`)];
    for (const s of SHORTCUTS) expect(reserved).not.toContain(s.keys);
  });
  it("has unique ids and keys", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    expect(new Set(SHORTCUTS.map((s) => s.keys)).size).toBe(SHORTCUTS.length);
  });
  it("feeds tooltips from the same table", () => {
    expect(shortcutHint("create-task")).toBe("⌘⇧K");
    expect(hubShortcutHint(0)).toBe("G 1");
    expect(hubShortcutHint(7)).toBe("G 8");
    expect(hubShortcutHint(8)).toBeUndefined();
    expect(shortcutHint("nope")).toBe("");
  });
});

describe("ShortcutRegistry.dispatch", () => {
  let reg: ShortcutRegistry;
  beforeEach(() => {
    reg = new ShortcutRegistry();
  });

  it("runs a single chord and consumes the event", () => {
    const run = vi.fn();
    reg.register(def("search", "mod+k", run, { inInputs: true }));
    const e = keyEvent({ key: "k", metaKey: true });
    expect(reg.dispatch(e)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("does not run in inputs unless the shortcut allows it", () => {
    const run = vi.fn();
    reg.register(def("create-task", "mod+shift+k", run));
    expect(reg.dispatch(keyEvent({ key: "K", metaKey: true, shiftKey: true }), { typing: true })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(reg.dispatch(keyEvent({ key: "K", metaKey: true, shiftKey: true }), { typing: false })).toBe(true);
  });

  it("lists an ownedByPage chord but never dispatches it (the page runs it itself)", () => {
    const run = vi.fn();
    reg.register(def("sheet-bold", "mod+b", run, { scope: "page", ownedByPage: true }));
    const e = keyEvent({ key: "b", metaKey: true });
    expect(reg.dispatch(e, { typing: false })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    expect(reg.visible().map((d) => d.id)).toContain("sheet-bold");
  });

  it("never arms a prefix for an ownedByPage sequence", () => {
    reg.register(def("sheet-seq", "g t", vi.fn(), { scope: "page", ownedByPage: true }));
    expect(reg.dispatch(keyEvent({ key: "g" }), { now: 1000, typing: false })).toBe(false);
  });

  it("ignores events another handler already consumed", () => {
    const run = vi.fn();
    reg.register(def("close", "escape", run, { inInputs: true }));
    expect(reg.dispatch(keyEvent({ key: "Escape", defaultPrevented: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs g-then-digit inside the 1.5s window and not after", () => {
    const run = vi.fn();
    reg.register(def("hub-2", "g 2", run));
    expect(reg.dispatch(keyEvent({ key: "g" }), { now: 1000 })).toBe(true);
    expect(reg.dispatch(keyEvent({ key: "2" }), { now: 1000 + 1400 })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(reg.dispatch(keyEvent({ key: "g" }), { now: 5000 })).toBe(true);
    expect(reg.dispatch(keyEvent({ key: "2" }), { now: 5000 + 1600 })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never arms the prefix while typing and drops it on a non-matching second key", () => {
    const run = vi.fn();
    reg.register(def("go-inbox", "g i", run));
    expect(reg.dispatch(keyEvent({ key: "g" }), { typing: true, now: 0 })).toBe(false);
    expect(reg.dispatch(keyEvent({ key: "i" }), { typing: true, now: 10 })).toBe(false);
    expect(reg.dispatch(keyEvent({ key: "g" }), { now: 100 })).toBe(true);
    expect(reg.dispatch(keyEvent({ key: "x" }), { now: 200 })).toBe(false);
    expect(reg.dispatch(keyEvent({ key: "i" }), { now: 300 })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("prefers a page-scoped binding over a global one and honours when()", () => {
    const global = vi.fn();
    const page = vi.fn();
    reg.register(def("global-esc", "escape", global, { inInputs: true }));
    reg.register(def("page-esc", "escape", page, { scope: "page", inInputs: true }));
    reg.dispatch(keyEvent({ key: "Escape" }));
    expect(page).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
    reg.clear();
    const gated = vi.fn();
    reg.register(def("gated", "mod+j", gated, { when: () => false }));
    expect(reg.dispatch(keyEvent({ key: "j", metaKey: true }))).toBe(false);
    expect(reg.visible().map((d) => d.id)).toEqual([]);
  });

  it("unregisters cleanly and lists page scope first", () => {
    const off = reg.register(def("a", "mod+a", () => {}));
    reg.register(def("b", "mod+b", () => {}, { scope: "page" }));
    expect(reg.list().map((d) => d.id)).toEqual(["b", "a"]);
    off();
    expect(reg.list().map((d) => d.id)).toEqual(["b"]);
  });
});
