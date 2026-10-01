"use client";

// SaveBar (spec-settings-workspace section 3, settings-architecture 8.5):
// the 56px sticky bar at the foot of a Save-bar page's content column.
// Renders ONLY when the form is dirty: "Unsaved changes" at the left,
// [Discard] ghost and [Save changes] primary at the right. The Save button
// is that tab's one blue button, so a Save-bar tab passes no toolbar
// primary. Disabled while saving, with the four-dot pending glyph in place
// of nothing (the label stays, so the button never jumps width).
//
// The bar also arms the dirty guard (useDirtyGuard), so the shell's Back to
// app, Esc, sidebar rows, crumbs and in-page tab switches ask "Save your
// changes?" with Save / Discard / Keep editing, and Save runs `onSave`. A
// save that fails keeps the form dirty and the guard armed.

import { useCallback, useEffect } from "react";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
  /** Resolve true when every write succeeded; false keeps the form dirty. */
  onSave: () => Promise<boolean> | boolean;
  /** Distinguishes two Save-bar sections on one page (Scoring). */
  guardId?: string;
  saveLabel?: string;
  className?: string;
}

export function SaveBar({ dirty, saving, onDiscard, onSave, guardId, saveLabel = "Save changes", className }: SaveBarProps) {
  const save = useCallback(() => Promise.resolve(onSave()).catch(() => false), [onSave]);
  useDirtyGuard(dirty, { onSave: save, id: guardId });
  // Cmd+S saves while the bar is showing, on every Save bar page (the
  // Settings scope of My settings > Keyboard shortcuts lists it with "on
  // pages with unsaved changes"). Registered only while dirty, so the ?
  // overlay names it exactly while it works. A second bar on the same page
  // (guardId) answers it too but is not listed twice.
  useShortcut(
    {
      id: guardId ? `settings.save.${guardId}` : "settings.save",
      keys: "mod+s",
      label: "Save changes",
      scope: "page",
      group: "Settings",
      inInputs: true,
      hidden: Boolean(guardId),
      when: () => dirty && !saving,
      run: (e) => { e.preventDefault(); void save(); },
    },
    dirty,
  );
  // A Save-bar page never autosaves, so the offline strip must not promise
  // that changes save on reconnect (offline-strip.tsx reads this marker).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.saveMode = "explicit";
    return () => { delete root.dataset.saveMode; };
  }, []);
  if (!dirty) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className={cn(
        "sticky bottom-0 z-10 mt-6 flex h-[56px] items-center gap-3 border-t border-line bg-raised px-4",
        className,
      )}
    >
      <span className="flex-1 text-sm text-ink-2">Unsaved changes</span>
      <button
        type="button"
        onClick={onDiscard}
        disabled={saving}
        className="inline-flex h-9 items-center rounded-lg px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        Discard
      </button>
      <button
        type="button"
        onClick={() => { void save(); }}
        disabled={saving}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {saving ? (
          <span className="os-pending" role="status" aria-label="Saving">
            <i /><i /><i /><i />
          </span>
        ) : null}
        {saveLabel}
      </button>
    </div>
  );
}
