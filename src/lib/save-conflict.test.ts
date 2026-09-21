import { describe, expect, it } from "vitest";
import { canSend, noConflict, onConflict, onDismissConflict } from "./save-conflict";

describe("save conflict", () => {
  it("sends while no conflict has been seen", () => {
    expect(canSend(noConflict)).toBe(true);
  });

  it("stops sending the moment a 409 arrives", () => {
    // The whole point: the editor must not re-send its buffer over the
    // version that beat it. Holding is what makes the ConflictStrip's promise
    // ("your changes are kept as a draft") true rather than a eulogy.
    expect(canSend(onConflict())).toBe(false);
  });

  it("resumes when the person dismisses the strip", () => {
    const held = onConflict();
    expect(canSend(held)).toBe(false);
    expect(canSend(onDismissConflict())).toBe(true);
  });

  it("stays held across repeated conflicts", () => {
    let s = onConflict();
    s = onConflict();
    expect(canSend(s)).toBe(false);
  });

  it("never mutates the state it is given", () => {
    const start = noConflict;
    onConflict();
    expect(start.held).toBe(false);
    expect(canSend(start)).toBe(true);
  });
});
