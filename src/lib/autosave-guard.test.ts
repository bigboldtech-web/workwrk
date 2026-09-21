import { describe, expect, it } from "vitest";
import { shouldFlush } from "./autosave-guard";

describe("shouldFlush", () => {
  it("saves a real edit", () => {
    expect(shouldFlush({ enabled: true, baseline: '{"title":"A"}', current: '{"title":"AB"}' })).toBe(true);
  });

  it("skips when nothing changed since the last save", () => {
    expect(shouldFlush({ enabled: true, baseline: '{"title":"A"}', current: '{"title":"A"}' })).toBe(false);
  });

  it("never writes before the editor has hydrated (no baseline)", () => {
    // The exact shape of the bug: the component's blank initial state, with
    // no baseline yet, on the unmount-style flush.
    expect(shouldFlush({ enabled: true, baseline: null, current: '{"title":"","description":"","content":null}' })).toBe(false);
  });

  it("never writes while autosave is off, even with a baseline and a change", () => {
    expect(shouldFlush({ enabled: false, baseline: '{"title":"A"}', current: '{"title":"B"}' })).toBe(false);
  });

  it("never writes while autosave is off and unhydrated", () => {
    expect(shouldFlush({ enabled: false, baseline: null, current: "{}" })).toBe(false);
  });

  it("treats an empty serialization as a value, not as a missing baseline", () => {
    expect(shouldFlush({ enabled: true, baseline: "", current: "" })).toBe(false);
    expect(shouldFlush({ enabled: true, baseline: "", current: "x" })).toBe(true);
  });
});
