import { describe, expect, it } from "vitest";
import { autosaveDisplay } from "./autosave-display";

describe("autosaveDisplay", () => {
  it("saving: the brand dot and a word", () => {
    const d = autosaveDisplay("saving");
    expect(d).toMatchObject({ dot: "brand", text: "Saving…", danger: false, retry: false, blank: false });
  });

  it("saved: the success dot and a word, until it fades", () => {
    expect(autosaveDisplay("saved")).toMatchObject({ dot: "success", text: "Saved" });
    // After the 2s fade the indicator is blank, not a stale "Saved".
    expect(autosaveDisplay("saved", { savedVisible: false })).toMatchObject({ blank: true, text: null, dot: null });
  });

  it("dirty: a word, no dot", () => {
    expect(autosaveDisplay("dirty")).toMatchObject({ dot: null, text: "Unsaved changes", danger: false });
  });

  it("error while still retrying: says so in words, not only in red", () => {
    const d = autosaveDisplay("error");
    expect(d.dot).toBe("danger");
    expect(d.danger).toBe(true);
    expect(d.text).toBe("Not saved, retrying");
    expect(d.retry).toBe(false);
  });

  it("error with the retry budget gone: 'Not saved' plus a Retry the person can press", () => {
    // The contract: a failed save is visible AND retryable. If this ever
    // returns retry:false with no automatic attempt left, the save is silent.
    const d = autosaveDisplay("error", { hasRetry: true });
    expect(d).toMatchObject({ dot: "danger", text: "Not saved", danger: true, retry: true });
  });

  it("idle: nothing at all unless the caller supplies a word", () => {
    expect(autosaveDisplay("idle")).toMatchObject({ dot: null, text: null });
    expect(autosaveDisplay("idle", { labels: { idle: "Auto-saves as you type" } }).text).toBe("Auto-saves as you type");
  });

  it("honours caller labels for every state that has one", () => {
    const labels = { saving: "Writing", saved: "Stored", error: "Stuck", dirty: "Edited" };
    expect(autosaveDisplay("saving", { labels }).text).toBe("Writing");
    expect(autosaveDisplay("saved", { labels }).text).toBe("Stored");
    expect(autosaveDisplay("error", { labels }).text).toBe("Stuck");
    expect(autosaveDisplay("dirty", { labels }).text).toBe("Edited");
  });

  it("an error never renders without a word", () => {
    for (const hasRetry of [true, false]) {
      const d = autosaveDisplay("error", { hasRetry });
      expect(d.text).toBeTruthy();
    }
  });
});
