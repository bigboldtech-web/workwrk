"use client";

// ShortcutsOverlay (spec-shell section 2.17): the "?" overlay. It renders
// `shortcuts.visible()` and nothing else, grouped, with page-scoped chords
// under "On this page", so it can never advertise a chord that is not
// registered and working right now. Opened by "?" / ⌘/ and the avatar menu's
// "Keyboard shortcuts" row (all through openShortcutsOverlay()).

import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { detectPlatform, formatKeys, useShortcutList, type ShortcutDef } from "@/lib/shortcuts";
import { SHORTCUTS_OVERLAY_EVENT } from "./shell-shortcuts";

const GROUP_ORDER = ["On this page", "General", "Navigate", "Create", "View"];

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

  const groups = useMemo(() => {
    const byGroup = new Map<string, ShortcutDef[]>();
    for (const d of list) {
      if (d.hidden) continue;
      if (d.when && !d.when()) continue;
      const g = d.scope === "page" ? "On this page" : d.group ?? "General";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(d);
    }
    const names = [...byGroup.keys()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return names.map((name) => ({ name, items: byGroup.get(name)! }));
    // `open` is a dependency on purpose: `when()` is re-evaluated each time
    // the overlay opens, so it reflects the state at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[150] bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="workwrk-os fixed left-1/2 top-1/2 z-[151] max-h-[85vh] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-[0_30px_80px_-15px_rgba(0,0,0,0.35)] focus:outline-none dark:border-zinc-700 dark:bg-[#14171D] dark:text-zinc-100"
        >
          <div className="flex items-center justify-between">
            <DialogPrimitive.Title className="text-[16px] font-semibold leading-tight">Keyboard shortcuts</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <section key={g.name}>
                <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{g.name}</h3>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {g.items.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-4 py-1.5 text-[14px]">
                      <span className="min-w-0 truncate">{d.label}</span>
                      <kbd className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-sans text-[12px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {formatKeys(d.keys, platform)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {groups.length === 0 ? <p className="text-[14px] text-zinc-500">No shortcuts are registered right now.</p> : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
