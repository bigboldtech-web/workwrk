// Esc inside a ui/dialog (settings-cleanup Phase 3 review, follow-up): with a
// popover open inside the dialog (a DateField, TimeField, PickerSelect or any
// Picker list, each registered in the shell's layer stack), Esc closes that
// popover alone and the dialog keeps its form; with nothing open above it,
// Esc is the dialog's own, as before. A popover open BEHIND the dialog (the
// one it was opened from, final Settings review L5) is not above it: Esc
// closes the dialog and leaves that popover open.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
// Loaded inside each test, so on a tree without the rule each test fails on its own.
const load = () => import("./dialog-escape");

const esc = () => ({ preventDefault: vi.fn() });
const stack = (top: string | null, layerCount?: number) => ({ topLayerKind: top, closeTopLayer: vi.fn(), layerCount });

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

  it("a popover open behind the dialog (open when the dialog opened) is left open: Esc is the dialog's", async () => {
    const escape = await load();
    // The share popover is the one layer, and was open when its confirm opened.
    const e = esc();
    const layers = stack("popover", 1);
    const own = vi.fn();
    expect(escape.dialogEscape(e, layers, own, 1)).toBe("dialog");
    expect(layers.closeTopLayer).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledWith(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    // A picker opened inside that dialog since is above it: closed alone.
    const e2 = esc();
    const above = stack("popover", 2);
    expect(escape.dialogEscape(e2, above, vi.fn(), 1)).toBe("layer");
    expect(above.closeTopLayer).toHaveBeenCalledTimes(1);
    // Opened with nothing under it: every popover is its own.
    const e3 = esc();
    const inner = stack("popover", 1);
    expect(escape.dialogEscape(e3, inner, vi.fn(), 0)).toBe("layer");
    expect(inner.closeTopLayer).toHaveBeenCalledTimes(1);
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
    expect(src).toMatch(/\(\{ className, children, onEscapeKeyDown, onOpenAutoFocus, \.\.\.props \}, ref\) => \{\s+[\s\S]*?const layers = useLayerStack\(\);/);
    // After {...props}, so a caller's handler never replaces the layer check; it runs inside it instead.
    expect(src).toMatch(/\{\.\.\.props\}\s+onOpenAutoFocus=\{\(e\) => \{ below\.current = count; onOpenAutoFocus\?\.\(e\); \}\}\s+onEscapeKeyDown=\{\(e\) => \{ dialogEscape\(e, layers, onEscapeKeyDown, below\.current\); \}\}/);
  });

  it("counts the layers open when the dialog opened, lowered when one of them closes", () => {
    expect(src).toContain("const count = layers?.layerCount ?? 0;");
    expect(src).toMatch(/React\.useEffect\(\(\) => \{\s+if \(count < below\.current\) below\.current = count;\s+\}, \[count\]\);/);
  });
});
