"use client";

// useTaskDraft(itemId), one task's unsaved words, kept across a session lapse.
//
// spec-task-detail section 3: "wraps the shell's useDraftOnExpiry for one
// task: collects the dirty { title, description, comment } into
// localStorage['workwrk:draft:task:<itemId>'] on workwrk:session-expired,
// reads it back on mount, and exposes { pending, restore(), discard() } for
// the Restore strip."
//
// Why it exists at all: the shell expires a session after about twelve hours,
// and a comment somebody spent five minutes writing must not be what pays for
// that. The strip NEVER auto-applies, a restore that silently overwrote a
// value a colleague saved in the meantime would be a worse bug than the one
// it fixes, so the words come back only when the person says so.
//
// The key is namespaced per task, so two open tasks never collide, and the
// same key serves all three hosts: a comment started in the Inbox pane comes
// back when the task is opened in the drawer.

import { useCallback, useEffect, useState } from "react";
import { useDraftOnExpiry } from "./use-draft-on-expiry";

export interface TaskDraft {
  title?: string;
  description?: string;
  comment?: string;
}

export interface UseTaskDraft {
  /** A draft from an earlier session, or null. Drives the Restore strip. */
  pending: TaskDraft | null;
  /** When it was written, for "You have unsaved changes from {relative}". */
  savedAt: string | null;
  /** Hand the fields back to the caller and clear the key. */
  restore: () => TaskDraft | null;
  /** Throw it away. */
  discard: () => void;
  /** Called after a successful save of every dirty field. */
  clear: () => void;
  /**
   * Write whatever is dirty right now. The hosts call this when the task
   * unmounts (Esc, the drawer's X, a click on the list, browser Back), which
   * is how most words are actually lost; the session-expiry event is the rarer
   * case. Writes nothing while everything is clean.
   */
  flush: () => boolean;
}

export function useTaskDraft({
  itemId,
  getDraft,
  baseVersion,
}: {
  itemId: string | null | undefined;
  /** The dirty fields right now, or null while everything is clean. */
  getDraft: () => TaskDraft | null;
  /** The item's `updatedAt`, so a stale draft can be recognised later. */
  baseVersion?: string | Date | null;
}): UseTaskDraft {
  const draft = useDraftOnExpiry<TaskDraft>({
    kind: "task",
    id: itemId,
    getDraft: () => {
      const d = getDraft();
      if (!d) return null;
      // An object with no words in it is not a draft.
      const any = [d.title, d.description, d.comment].some((v) => typeof v === "string" && v.trim().length > 0);
      return any ? d : null;
    },
    getBaseVersion: () => baseVersion ?? null,
    // Safe to opt in because `getDraft` above returns null while clean, which
    // is the condition useDraftOnExpiry names: a tab closed on a clean task
    // leaves nothing behind.
    flushOnPageHide: true,
  });

  const [pending, setPending] = useState<TaskDraft | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Read once per task. Reading again on every render would resurrect a draft
  // the person just discarded.
  useEffect(() => {
    if (!itemId) {
      setPending(null);
      setSavedAt(null);
      return;
    }
    const stored = draft.read();
    setPending(stored?.value ?? null);
    setSavedAt(stored?.savedAt ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const clear = useCallback(() => {
    draft.clear();
    setPending(null);
    setSavedAt(null);
  }, [draft]);

  const restore = useCallback((): TaskDraft | null => {
    const value = pending;
    clear();
    return value;
  }, [pending, clear]);

  return { pending, savedAt, restore, discard: clear, clear, flush: draft.flush };
}
