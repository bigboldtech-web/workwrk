// The live view's input mapping (docs/plans/browser-host.md 4.2): every
// message type to its exact CDP command, Cmd on a Mac as Ctrl, Ctrl or Cmd
// with V never a key, and the clamping, stripping and dropping.

import { describe, expect, it } from "vitest";

import { keyMessage } from "../live/view.mjs";
import { charKeyMessages, clickMessages, createInputMapper, enterMessages, LIVE_METHODS, TEXT_MAX } from "./live-input.mjs";

const VP = { width: 1280, height: 800 };
const one = (m: ReturnType<typeof createInputMapper>, msg: Record<string, unknown>) => {
  const r = m.map(msg);
  if (!r.ok) throw new Error(`refused: ${r.why}`);
  expect(r.commands).toHaveLength(1);
  return r.commands[0];
};
const keyEv = (o: Partial<{ key: string; code: string; keyCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; repeat: boolean; location: number; isComposing: boolean }>) => ({
  key: "",
  code: "",
  keyCode: 0,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  location: 0,
  ...o,
});

describe("every message type gives the exact CDP command of 4.2", () => {
  it("mouse: a move with no button held, a press, a move while held, a release", () => {
    const m = createInputMapper(VP);
    expect(one(m, { t: "mouse", type: "move", x: 10, y: 20, button: "none", buttons: 0, clicks: 1, mods: 0 })).toEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseMoved", x: 10, y: 20, button: "none", buttons: 0, modifiers: 0 },
    });
    expect(one(m, { t: "mouse", type: "down", x: 11, y: 21, button: "left", buttons: 1, clicks: 2, mods: 8 })).toEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mousePressed", x: 11, y: 21, button: "left", buttons: 1, clickCount: 2, modifiers: 8 },
    });
    expect(one(m, { t: "mouse", type: "move", x: 30, y: 40, button: "none", buttons: 1, clicks: 1, mods: 0 }).params).toEqual({ type: "mouseMoved", x: 30, y: 40, button: "left", buttons: 1, modifiers: 0 });
    expect(one(m, { t: "mouse", type: "up", x: 31, y: 41, button: "left", buttons: 0, clicks: 2, mods: 0 })).toEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseReleased", x: 31, y: 41, button: "left", buttons: 0, clickCount: 2, modifiers: 0 },
    });
  });

  it("wheel", () => {
    expect(one(createInputMapper(VP), { t: "wheel", x: 100, y: 200, dx: -3, dy: 120, mods: 2 })).toEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: 100, y: 200, deltaX: -3, deltaY: 120, modifiers: 2 },
    });
  });

  it("a key down with text, one without, Enter with \\r, and a key up", () => {
    const m = createInputMapper(VP);
    expect(one(m, { t: "key", type: "down", key: "H", code: "KeyH", vk: 72, text: "H", mods: 8, repeat: false, location: 0 })).toEqual({
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "H", code: "KeyH", text: "H", unmodifiedText: "H", windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72, modifiers: 8, autoRepeat: false, location: 0 },
    });
    expect(one(m, { t: "key", type: "down", key: "ArrowLeft", code: "ArrowLeft", vk: 37, text: "", mods: 0, repeat: true, location: 0 })).toEqual({
      method: "Input.dispatchKeyEvent",
      params: { type: "rawKeyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37, modifiers: 0, autoRepeat: true, location: 0 },
    });
    expect(one(m, { t: "key", type: "down", key: "Enter", code: "Enter", vk: 13, text: "", mods: 0, repeat: false, location: 0 }).params).toMatchObject({ type: "keyDown", key: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
    expect(one(m, { t: "key", type: "up", key: "H", code: "KeyH", vk: 72, text: "", mods: 8, repeat: false, location: 0 })).toEqual({
      method: "Input.dispatchKeyEvent",
      params: { type: "keyUp", key: "H", code: "KeyH", windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72, modifiers: 8, location: 0 },
    });
  });

  it("text and ime", () => {
    const m = createInputMapper(VP);
    expect(one(m, { t: "text", text: "pasted words" })).toEqual({ method: "Input.insertText", params: { text: "pasted words" } });
    expect(one(m, { t: "ime", text: "日本", start: 1, end: 2 })).toEqual({ method: "Input.imeSetComposition", params: { text: "日本", selectionStart: 1, selectionEnd: 2 } });
    expect(one(m, { t: "ime", text: "" }).params).toEqual({ text: "", selectionStart: 0, selectionEnd: 0 });
  });

  it("every command any message makes is one of LIVE_METHODS", () => {
    expect(LIVE_METHODS).toEqual([
      "Page.startScreencast",
      "Page.stopScreencast",
      "Page.screencastFrameAck",
      "Page.bringToFront",
      "Input.dispatchMouseEvent",
      "Input.dispatchKeyEvent",
      "Input.insertText",
      "Input.imeSetComposition",
    ]);
    const m = createInputMapper(VP);
    const all = [
      ...clickMessages(5, 5),
      ...charKeyMessages("a"),
      ...enterMessages(),
      { t: "wheel", x: 1, y: 1, dx: 0, dy: 1 },
      { t: "text", text: "x" },
      { t: "ime", text: "y" },
      { t: "mouse", type: "down", x: 1, y: 1, button: "right" },
    ];
    const methods = all.flatMap((x) => {
      const r = m.map(x);
      return r.ok ? r.commands.map((c) => c.method) : [];
    });
    methods.push(...m.release().map((c) => c.method));
    expect(methods.length).toBeGreaterThan(10);
    for (const x of methods) expect(LIVE_METHODS).toContain(x);
  });
});

describe("the keys a viewer's page sends (live/view.mjs keyMessage) as they arrive", () => {
  it("Cmd+A from a Mac viewer arrives as Ctrl+A, and Cmd itself as Control", () => {
    const m = createInputMapper(VP);
    const cmd = keyMessage("down", keyEv({ key: "Meta", code: "MetaLeft", keyCode: 91, metaKey: true }), true)!;
    expect(one(m, cmd).params).toMatchObject({ type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 });
    const a = keyMessage("down", keyEv({ key: "a", code: "KeyA", keyCode: 65, metaKey: true }), true)!;
    expect(a).toMatchObject({ key: "a", code: "KeyA", mods: 2, text: "" });
    expect(one(m, a).params).toEqual({ type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2, autoRepeat: false, location: 0 });
    // Elsewhere, Meta stays Meta and Ctrl is Ctrl.
    expect(keyMessage("down", keyEv({ key: "a", code: "KeyA", keyCode: 65, metaKey: true }), false)).toMatchObject({ mods: 4, text: "" });
    expect(keyMessage("down", keyEv({ key: "a", code: "KeyA", keyCode: 65, ctrlKey: true }), false)).toMatchObject({ mods: 2, text: "" });
    // A plain key types its character, with Shift kept.
    expect(keyMessage("down", keyEv({ key: "A", code: "KeyA", keyCode: 65, shiftKey: true }), true)).toMatchObject({ mods: 8, text: "A" });
  });

  it("Ctrl or Cmd with V is never a key: the page leaves it to its paste, and the host refuses one anyway", () => {
    expect(keyMessage("down", keyEv({ key: "v", code: "KeyV", keyCode: 86, ctrlKey: true }), false)).toBeNull();
    expect(keyMessage("down", keyEv({ key: "v", code: "KeyV", keyCode: 86, metaKey: true }), true)).toBeNull();
    expect(keyMessage("up", keyEv({ key: "V", code: "KeyV", keyCode: 86, ctrlKey: true, shiftKey: true }), false)).toBeNull();
    const m = createInputMapper(VP);
    for (const mods of [2, 4, 10]) {
      for (const type of ["down", "up"]) expect(m.map({ t: "key", type, key: "v", code: "KeyV", vk: 86, text: "", mods })).toMatchObject({ ok: false, why: "paste_key" });
    }
    expect(m.map({ t: "key", type: "down", key: "x", code: "KeyV", vk: 86, text: "", mods: 2 })).toMatchObject({ ok: false, why: "paste_key" });
    expect(m.map({ t: "key", type: "down", key: "v", code: "KeyV", vk: 86, text: "v", mods: 0 })).toMatchObject({ ok: true });
  });

  it("a key in a composition is left to it", () => {
    expect(keyMessage("down", keyEv({ key: "a", keyCode: 229 }), false)).toBeNull();
    expect(keyMessage("down", keyEv({ key: "a", isComposing: true }), false)).toBeNull();
    expect(keyMessage("down", keyEv({ key: "Dead", code: "KeyE", altKey: true }), true)).toBeNull();
  });
});

describe("the checks on every message", () => {
  it("clamps coordinates to the viewport, deltas to 10,000, modifiers to 0 to 15 and clicks to 1 to 3", () => {
    const m = createInputMapper(VP);
    expect(one(m, { t: "mouse", type: "move", x: -50, y: 99_999, mods: 99 }).params).toMatchObject({ x: 0, y: 799, modifiers: 15 });
    expect(one(m, { t: "mouse", type: "down", x: 5000, y: -1, button: "left", clicks: 9, mods: -3 }).params).toMatchObject({ x: 1279, y: 0, clickCount: 3, modifiers: 0 });
    expect(one(m, { t: "wheel", x: 1, y: 1, dx: -1e9, dy: 1e9 }).params).toMatchObject({ deltaX: -10_000, deltaY: 10_000, modifiers: 0 });
    expect(one(m, { t: "key", type: "down", key: "a", code: "KeyA", vk: 999, text: "a", mods: 3.7, location: 9 }).params).toMatchObject({ windowsVirtualKeyCode: 0, modifiers: 3, location: 0 });
  });

  it("strips control characters from text, but a line break and a tab", () => {
    const m = createInputMapper(VP);
    expect(one(m, { t: "text", text: "a\u0000b\u0007c\td\ne\rf\u001bg\u007fh" }).params).toEqual({ text: "abc\td\nefgh" });
    expect(one(m, { t: "key", type: "down", key: "x", code: "KeyX", vk: 88, text: "\u0001x" }).params).toMatchObject({ text: "x" });
    expect(one(m, { t: "ime", text: "\u0002ab" }).params).toMatchObject({ text: "ab", selectionStart: 2, selectionEnd: 2 });
    expect(m.map({ t: "text", text: "\u0000\u0001" })).toMatchObject({ ok: false, why: "bad_value" });
  });

  it("drops unknown types, counts unknown fields, and refuses bad values", () => {
    const m = createInputMapper(VP);
    expect(m.map({ t: "evaluate", expression: "1" })).toMatchObject({ ok: false, why: "unknown_type" });
    expect(m.map({ t: "hello", token: "x" })).toMatchObject({ ok: false, why: "unknown_type" });
    const extra = m.map({ t: "text", text: "a", method: "Runtime.evaluate", params: {} });
    expect(extra).toMatchObject({ ok: true, droppedFields: 2 });
    if (extra.ok) expect(extra.commands).toEqual([{ method: "Input.insertText", params: { text: "a" } }]);
    for (const bad of [
      { t: "mouse", type: "move", x: Number.NaN, y: 1 },
      { t: "mouse", type: "move", x: "1", y: 1 },
      { t: "mouse", type: "down", x: 1, y: 1, button: "back" },
      { t: "mouse", type: "hover", x: 1, y: 1 },
      { t: "wheel", x: 1, y: 1, dx: Infinity, dy: 0 },
      { t: "key", type: "down", key: "", code: "KeyA" },
      { t: "key", type: "down", key: "x".repeat(33) },
      { t: "key", type: "press", key: "a" },
      { t: "key", type: "down", key: "a", text: "123456789" },
      { t: "text", text: 42 },
      { t: "ime", text: null },
    ]) {
      expect({ bad, r: m.map(bad) }).toMatchObject({ bad, r: { ok: false } });
    }
    // A code that is not one is sent as none.
    expect(one(m, { t: "key", type: "down", key: "@", code: "Quote;rm", vk: 0, text: "@" }).params).toMatchObject({ code: "", text: "@" });
  });

  it("refuses text over 10,000 characters, and an IME text over 200", () => {
    const m = createInputMapper(VP);
    expect(m.map({ t: "text", text: "x".repeat(TEXT_MAX) })).toMatchObject({ ok: true, chars: TEXT_MAX });
    expect(m.map({ t: "text", text: "x".repeat(TEXT_MAX + 1) })).toMatchObject({ ok: false, why: "too_long" });
    expect(m.map({ t: "ime", text: "x".repeat(201) })).toMatchObject({ ok: false, why: "too_long" });
  });

  it("a release of a button never pressed is not sent", () => {
    expect(createInputMapper(VP).map({ t: "mouse", type: "up", x: 1, y: 1, button: "left" })).toMatchObject({ ok: false, why: "not_held" });
  });
});

describe("what a viewer holds", () => {
  it("is released on its behalf: each button at the last position, then each key", () => {
    const m = createInputMapper(VP);
    m.map({ t: "mouse", type: "down", x: 100, y: 200, button: "left", clicks: 1 });
    m.map({ t: "mouse", type: "move", x: 140, y: 260 });
    m.map({ t: "key", type: "down", key: "Shift", code: "ShiftLeft", vk: 16, location: 1 });
    m.map({ t: "key", type: "down", key: "a", code: "KeyA", vk: 65, text: "a" });
    m.map({ t: "key", type: "up", key: "a", code: "KeyA", vk: 65 });
    expect(m.held()).toEqual({ buttons: ["left"], keys: ["ShiftLeft"] });
    expect(m.release()).toEqual([
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: 140, y: 260, button: "left", buttons: 0, clickCount: 1, modifiers: 0 } },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 0, location: 1 } },
    ]);
    expect(m.held()).toEqual({ buttons: [], keys: [] });
    expect(m.release()).toEqual([]);
  });
});

describe("the proof controls' input (proof/controls.mjs)", () => {
  it("a click and a character are the commands a control viewer's would be", () => {
    const m = createInputMapper(VP);
    const cmds = [...clickMessages(320, 240), ...charKeyMessages("M"), ...charKeyMessages("@"), ...enterMessages()].flatMap((x) => {
      const r = m.map(x);
      if (!r.ok) throw new Error(r.why);
      return r.commands.map((c) => c.params);
    });
    expect(cmds).toEqual([
      { type: "mouseMoved", x: 320, y: 240, button: "none", buttons: 0, modifiers: 0 },
      { type: "mousePressed", x: 320, y: 240, button: "left", buttons: 1, clickCount: 1, modifiers: 0 },
      { type: "mouseReleased", x: 320, y: 240, button: "left", buttons: 0, clickCount: 1, modifiers: 0 },
      { type: "keyDown", key: "M", code: "KeyM", text: "M", unmodifiedText: "M", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77, modifiers: 0, autoRepeat: false, location: 0 },
      { type: "keyUp", key: "M", code: "KeyM", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77, modifiers: 0, location: 0 },
      { type: "keyDown", key: "@", code: "", text: "@", unmodifiedText: "@", windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers: 0, autoRepeat: false, location: 0 },
      { type: "keyUp", key: "@", code: "", windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers: 0, location: 0 },
      { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0, autoRepeat: false, location: 0 },
      { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0, location: 0 },
    ]);
  });
});
