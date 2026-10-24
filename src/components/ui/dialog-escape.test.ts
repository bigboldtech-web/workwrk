// Esc inside a ui/dialog (settings-cleanup Phase 3 review, follow-up): with a
// popover open inside the dialog (a DateField, TimeField, PickerSelect or any
// Picker list, each registered in the shell's layer stack), Esc closes that
// popover alone and the dialog keeps its form; with nothing open above it,
// Esc is the dialog's own, as before.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
// Loaded inside each test, so on a tree without the rule each test fails on its own.
const load = () => import("./dialog-escape");

const esc = () => ({ preventDefault: vi.fn() });
const stack = (top: string | null) => ({ topLayerKind: top, closeTopLayer: vi.fn() });

describe("dialogEscape", () => {
  it("with a popover open above the dialog: closes the popover alone and keeps the dialog open", async () => {
    const escape = await load();
    const e = esc();
    const layers = stack("popover");
    const own = vi.fn();
    expect(escape.dialogEscape(e, layers, own)).toBe("layer");
    expect(layers.closeTopLayer).toHaveBeenCalledTimes(1);
    // Radix does not close a dialog whose Esc was prevented, and the shell's own Esc listener skips it.
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(own).not.toHaveBeenCalled();
  });

  it("with nothing open above it: the dialog's own Esc, its caller's handler first, nothing prevented here", async () => {
    const escape = await load();
    for (const top of [null, "dialog", "modal", "drawer"]) {
      const e = esc();
      const layers = stack(top);
      const own = vi.fn();
      expect(escape.dialogEscape(e, layers, own), String(top)).toBe("dialog");
      expect(own).toHaveBeenCalledWith(e);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(layers.closeTopLayer).not.toHaveBeenCalled();
    }
    // No caller handler and no layer stack (a dialog outside the product frame): Radix closes it.
    const e = esc();
    expect(escape.dialogEscape(e, null)).toBe("dialog");
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("lets a caller still refuse Esc (a busy dialog, the session dialog)", async () => {
    const escape = await load();
    const e = esc();
    escape.dialogEscape(e, stack(null), (ev) => ev.preventDefault());
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe("every ui/dialog DialogContent goes through it", () => {
  const src = readFileSync(join(process.cwd(), "src/components/ui/dialog.tsx"), "utf8");

  it("reads the layer stack and passes the caller's onEscapeKeyDown on, after the caller's other props", () => {
    expect(src).toContain('import { useLayerStack } from "@/components/layout/os/shell-context";');
    expect(src).toContain('import { dialogEscape } from "@/components/ui/dialog-escape";');
    expect(src).toMatch(/\(\{ className, children, onEscapeKeyDown, \.\.\.props \}, ref\) => \{\s+[\s\S]*?const layers = useLayerStack\(\);/);
    // After {...props}, so a caller's handler never replaces the layer check; it runs inside it instead.
    expect(src).toMatch(/\{\.\.\.props\}\s+onEscapeKeyDown=\{\(e\) => \{ dialogEscape\(e, layers, onEscapeKeyDown\); \}\}/);
  });
});
