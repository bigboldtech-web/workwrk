"use client";

// QuickToolsPanel — a small launcher that pops up (to the left of, and
// above, its rail button) with the user's quick tools that used to live in
// the top bar: Create task, Notepad, Record clip, etc. Each row launches the
// tool; the "Add" section lets the user pin more tools from the catalog. Pins
// persist via shell-context (toggleProfileToolPin → /api/preferences).

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, Pin } from "lucide-react";
import { useOsShell } from "./shell-context";
import { PROFILE_TOOLS, PROFILE_TOOL_MAP } from "./profile-tools";

export function QuickToolsPanel({
  open, onClose, anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { profileToolPins, toggleProfileToolPin } = useOsShell();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const pinned = profileToolPins.map((k) => PROFILE_TOOL_MAP[k]).filter((t): t is NonNullable<typeof t> => Boolean(t));
  const unpinned = PROFILE_TOOLS.filter((t) => !profileToolPins.includes(t.key));

  return (
    <div ref={ref} role="menu" aria-label="Quick tools"
      className="absolute bottom-0 right-full mr-1.5 z-[70] w-60 rounded-xl border border-zinc-200 bg-white p-1.5 text-zinc-900 shadow-2xl">
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Quick tools</div>
      {pinned.length === 0 ? (
        <div className="px-2 py-1.5 text-[12px] text-zinc-400">No tools yet — add some below.</div>
      ) : (
        <div className="space-y-0.5">
          {pinned.map((t) => (
            <div key={t.key} className="group flex items-center">
              <Link href={t.href ?? "#"} onClick={onClose}
                className="flex flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
                <t.Icon className="h-4 w-4 text-zinc-500" /> {t.label}
              </Link>
              <button type="button" title="Remove from quick tools" onClick={() => toggleProfileToolPin(t.key)}
                className="mr-1 rounded p-1 text-zinc-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100">
                <Pin className="h-3.5 w-3.5" fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
      )}

      {unpinned.length > 0 ? (
        <>
          <div className="mx-2 my-1.5 border-t border-zinc-100" />
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Add</div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {unpinned.map((t) => (
              <button key={t.key} type="button" onClick={() => toggleProfileToolPin(t.key)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-600 hover:bg-zinc-50">
                <t.Icon className="h-4 w-4 text-zinc-400" />
                <span className="flex-1">{t.label}</span>
                <Plus className="h-3.5 w-3.5 text-zinc-400" />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
