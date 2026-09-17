"use client";

// useDirtyGuard(isDirty) (settings-architecture.md section 8.5): a shared
// hook, not settings-specific. While dirty:
//   - `beforeunload` prompts (tab close, reload, external link)
//   - the form is registered in the dirty registry, so the settings shell's
//     Back / close / Esc and any other guarded navigation call
//     `confirmLeave()` and get the Save / Discard / Keep editing choice
// Pass `onSave` so "Save" from the confirm can run the form's own save; a
// failing save keeps the guard armed.

import { useEffect, useId } from "react";
import { registerDirty } from "@/lib/dirty-guard";

export function useDirtyGuard(isDirty: boolean, opts: { onSave?: () => Promise<boolean> | boolean; id?: string } = {}): void {
  const autoId = useId();
  const id = opts.id ?? autoId;
  const onSave = opts.onSave;

  useEffect(() => {
    if (!isDirty) return;
    const unregister = registerDirty(id, { onSave });
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome still needs returnValue set for the prompt to show.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty, id, onSave]);
}
