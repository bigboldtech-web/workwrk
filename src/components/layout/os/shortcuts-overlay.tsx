"use client";

// ShortcutsOverlay (spec-shell section 2.17): the "?" overlay. It renders
// `shortcuts.visible()` and nothing else, grouped, with page-scoped chords
// under "On this page", so it can never advertise a chord that is not
// registered and working right now. Opened by "?" / ⌘/ and the avatar menu's
// "Keyboard shortcuts" row (all through openShortcutsOverlay()).

import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { detectPlatform, formatKeys, useShortcutList } from "@/lib/shortcuts";
import { SHORTCUTS_OVERLAY_EVENT } from "./shell-shortcuts";
import { useLayer } from "./shell-context";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { groupShortcuts } from "@/lib/shortcut-groups";


export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const list = useShortcutList();
  const [platform, setPlatform] = useState<"mac" | "other">("mac");

  useEffect(() => {
    setPlatform(detectPlatform());
    const onToggle = () => setOpen((v) => !v);
    window.addEventListener(SHORTCUTS_OVERLAY_EVENT, onToggle);
    return () => window.removeEventListener(SHORTCUTS_OVERLAY_EVENT, onToggle);
  }, []);

  // The LayerStack is the single Esc authority (spec-shell 1.5). Without this
  // the overlay closed on Radix's own document listener while contributing
  // nothing to layerCount, so anything that reads the stack (the splash's
  // "any key skips it" branch) saw no layer open above it.
  useLayer(open, { id: "shortcuts-overlay", kind: "modal", close: () => setOpen(false) });

  // ONE grouping for the overlay and My settings > Keyboard shortcuts
  // (src/lib/shortcut-groups.ts), so the two can never list different sets.
  // `open` is a dependency on purpose: `when()` is re-evaluated each time
  // the overlay opens, so it reflects the state at that moment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupShortcuts(list, { includePage: true }), [list, open]);
  const { openSettings } = useSettingsNav();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[150] bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="workwrk-os fixed inset-x-0 mx-auto top-1/2 z-[151] max-h-[85vh] w-[560px] max-w-[calc(100vw-32px)] -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-raised p-5 text-ink shadow-[var(--os-shadow-modal)] focus:outline-none"
        >
          <div className="flex items-center justify-between">
            <DialogPrimitive.Title className="text-lg font-semibold leading-tight">Keyboard shortcuts</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <section key={g.name}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">{g.name}</h3>
                <ul className="divide-y divide-line-soft">
                  {g.items.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-4 py-1.5 text-base">
                      <span className="min-w-0 truncate">{d.label}</span>
                      <kbd className="shrink-0 rounded-md border border-line-strong bg-active px-1.5 py-0.5 font-sans text-xs text-ink">
                        {formatKeys(d.keys, platform)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {groups.length === 0 ? <p className="text-base text-ink-2">No shortcuts are registered right now.</p> : null}
          </div>
          <div className="mt-4 border-t border-line-soft pt-3">
            <button
              type="button"
              onClick={() => { setOpen(false); void openSettings("/account/shortcuts"); }}
              className="text-sm font-medium text-brand-deep hover:underline"
            >
              Open as a page
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
