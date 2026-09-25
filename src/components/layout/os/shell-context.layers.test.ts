import { describe, expect, it } from "vitest";
import { hasBlockingLayer, type LayerKind } from "./shell-context";

// The page's blue primary gives way while a modal, drawer or dialog is open
// (design-system principle 1). The walk found it coming back when a Picker
// inside the Schedule report dialog registered a popover on top: the check
// read only the top layer. These pin the whole-stack reading.
const stack = (...kinds: LayerKind[]) => kinds.map((kind) => ({ kind }));

describe("hasBlockingLayer", () => {
  it("is false for an empty stack", () => {
    expect(hasBlockingLayer([])).toBe(false);
  });

  it("is true while a modal, drawer or dialog is the top layer", () => {
    expect(hasBlockingLayer(stack("modal"))).toBe(true);
    expect(hasBlockingLayer(stack("drawer"))).toBe(true);
    expect(hasBlockingLayer(stack("dialog"))).toBe(true);
  });

  it("stays true when a popover opens over the dialog (a picker inside it)", () => {
    expect(hasBlockingLayer(stack("dialog", "popover"))).toBe(true);
    expect(hasBlockingLayer(stack("drawer", "popover", "popover"))).toBe(true);
    expect(hasBlockingLayer(stack("modal", "palette"))).toBe(true);
  });

  it("is false for layers that carry no primary of their own", () => {
    expect(hasBlockingLayer(stack("popover"))).toBe(false);
    expect(hasBlockingLayer(stack("palette", "popover"))).toBe(false);
    expect(hasBlockingLayer(stack("panel", "splash"))).toBe(false);
  });
});
