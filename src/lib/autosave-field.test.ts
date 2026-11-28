import { describe, expect, it } from "vitest";
import {
  draftValue,
  initAutosave,
  onSaved,
  onSent,
  onServerValue,
  onTyped,
  retryDelayMs,
  savedDescriptionOf,
  shouldCommit,
} from "@/lib/autosave-field";

describe("autosave-field", () => {
  it("follows the server while the field is clean", () => {
    let s = initAutosave("old body");
    s = onServerValue(s, "somebody else's edit");
    expect(s.local).toBe("somebody else's edit");
    expect(s.dirty).toBe(false);
  });

  // THE BUG. A failed save re-reads the task, which hands the field the
  // server's OLD value. Before this rule the field had already marked itself
  // clean, so that old value overwrote the words the person had typed and they
  // were gone everywhere at once.
  it("KEEPS the typed words when a save fails and the old server value comes back", () => {
    let s = initAutosave("old body");
    s = onTyped(s, "old body plus the paragraph I just wrote");
    s = onSent(s, s.local);
    // The PATCH failed; use-task reloads and the server still says "old body".
    s = onServerValue(s, "old body");
    expect(s.local).toBe("old body plus the paragraph I just wrote");
    expect(s.dirty).toBe(true);
    expect(draftValue(s)).toBe("old body plus the paragraph I just wrote");
  });

  it("clears only once the SERVER echoes back what was sent", () => {
    let s = initAutosave("old body");
    s = onTyped(s, "new body");
    s = onSent(s, "new body");
    expect(s.dirty).toBe(true);
    expect(draftValue(s)).toBe("new body");
    s = onServerValue(s, "new body");
    expect(s.dirty).toBe(false);
    expect(s.sent).toBeNull();
    expect(s.local).toBe("new body");
    expect(draftValue(s)).toBe("");
  });

  it("does not let a stale realtime echo overwrite unconfirmed words", () => {
    let s = initAutosave("a");
    s = onTyped(s, "a and b");
    // A poll lands mid-edit carrying a value nobody here sent.
    s = onServerValue(s, "a and something a colleague wrote");
    expect(s.local).toBe("a and b");
    expect(s.dirty).toBe(true);
  });

  it("treats new typing as a new save rather than another attempt", () => {
    let s = initAutosave("");
    s = onTyped(s, "one");
    s = onSent(s, "one");
    s = onSent(s, "one");
    expect(s.attempt).toBe(2);
    s = onTyped(s, "one two");
    expect(s.attempt).toBe(0);
  });

  it("will not send a no-op", () => {
    const s = initAutosave("same");
    expect(shouldCommit(s, "same", "same")).toBe(false);
    expect(shouldCommit(onTyped(s, "same"), "same", "same")).toBe(false);
    expect(shouldCommit(onTyped(s, "other"), "other", "same")).toBe(true);
  });

  it("retries with a backoff and then stops rather than spinning", () => {
    expect(retryDelayMs(0)).toBe(2000);
    expect(retryDelayMs(1)).toBe(4000);
    expect(retryDelayMs(2)).toBe(8000);
    expect(retryDelayMs(3)).toBe(16_000);
    expect(retryDelayMs(4)).toBeNull();
  });

  it("an empty description is saved as empty and then reads as clean", () => {
    let s = initAutosave("had words");
    s = onTyped(s, "");
    s = onSent(s, "");
    expect(draftValue(s)).toBe("");
    s = onServerValue(s, "");
    expect(s.dirty).toBe(false);
    expect(s.local).toBe("");
  });
});

// Pen test 2026-11-28, V-33: the server merged this save with one somebody
// made meanwhile, and answered with the merged text.
describe("onSaved: the text the server saved", () => {
  it("takes a merged answer as saved when nothing was typed since", () => {
    let s = onTyped(initAutosave("Old"), "Old\nmine");
    s = onSent(s, "Old\nmine");
    s = onSaved(s, "Old\nmine", "Old\ntheirs\nmine");
    expect(s).toEqual({ local: "Old\ntheirs\nmine", synced: "Old\ntheirs\nmine", dirty: false, sent: null, attempt: 0 });
    // The render's reconcile then has nothing to change.
    expect(onServerValue(s, "Old\ntheirs\nmine")).toBe(s);
  });

  it("carries what was typed after the send onto the merged text, and stays dirty to save it", () => {
    let s = onTyped(initAutosave("Old"), "Old\nmine");
    s = onSent(s, "Old\nmine");
    s = onTyped(s, "Old\nmine\nmore");
    s = onSaved(s, "Old\nmine", "Old\ntheirs\nmine");
    expect(s.local).toBe("Old\ntheirs\nmine\nmore");
    expect(s).toMatchObject({ synced: "Old\ntheirs\nmine", dirty: true, sent: null });
  });

  it("ignores the answer to an older send", () => {
    let s = onSent(onTyped(initAutosave("a"), "ab"), "ab");
    s = onSent(onTyped(s, "abc"), "abc");
    expect(onSaved(s, "ab", "ab")).toBe(s);
  });

  it("reads the saved description from the write's answer, and nothing from an answer without it", () => {
    expect(savedDescriptionOf({ ok: true, payload: { item: { metadata: { description: "x" } } } })).toBe("x");
    expect(savedDescriptionOf({ ok: true, payload: { item: { metadata: { description: null } } } })).toBe("");
    expect(savedDescriptionOf({ ok: true, payload: { item: { metadata: {} } } })).toBeNull();
    expect(savedDescriptionOf({ ok: true, payload: {} })).toBeNull();
    expect(savedDescriptionOf({ ok: false, status: 409, payload: { item: { metadata: { description: "x" } } } })).toBeNull();
    expect(savedDescriptionOf(undefined)).toBeNull();
  });
});

describe("onSaved: nothing left to send (the step 5 review)", () => {
  it("is clean when what was typed since is already in the saved text", () => {
    let s = onSent(onTyped(initAutosave("a"), "a\nb"), "a\nb");
    s = onTyped(s, "a\nb\nc");
    s = onSaved(s, "a\nb", "a\nb\nc");
    expect(s).toEqual({ local: "a\nb\nc", synced: "a\nb\nc", dirty: false, sent: null, attempt: 0 });
  });
});
