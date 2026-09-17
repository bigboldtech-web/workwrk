"use client";

// useDraftOnExpiry: the shell's half of the data-integrity rule for editors
// (spec-shell.md section 1.10 rule 3). When the session lapses mid-edit the
// editor's in-memory draft is flushed to localStorage["workwrk:draft:{kind}:{id}"]
// BEFORE anything navigates to /login. The restore UI ("Restore unsaved
// changes") is each editor's own; this hook only guarantees the bytes exist,
// together with the server version they were taken from, so the restore UI
// can tell whether the document has moved on since (another device, a
// collaborator) and ask before overwriting it.
//
//   const draft = useDraftOnExpiry({
//     kind: "doc",
//     id: doc.id,
//     getDraft: () => (editor.isDirty ? editor.snapshot() : null),
//     getBaseVersion: () => doc.updatedAt,
//   });
//   // on mount:
//   //   const saved = draft.read();
//   //   if (saved) offerRestore(saved.value, { stale: isDraftStale(saved, doc.updatedAt) });
//   // after a successful save or an explicit discard: draft.clear();

import { useCallback, useEffect, useRef } from "react";
import {
  SESSION_EXPIRED_EVENT,
  clearDraft,
  readDraft,
  saveDraft,
  type DraftBaseVersion,
  type StoredDraft,
} from "@/lib/session-expiry";

export interface DraftOnExpiryOptions<T> {
  kind: string;
  id: string | null | undefined;
  /** Return the current draft, or null/undefined when there is nothing worth keeping (a clean editor). */
  getDraft: () => T | null | undefined;
  /**
   * The server version of the document the draft is taken from (`updatedAt`,
   * a revision, an etag). Stored with the draft so the restore UI can detect
   * a newer server version. Strongly recommended; without it the restore
   * UI cannot tell a fresh draft from a stale one.
   */
  getBaseVersion?: () => DraftBaseVersion | Date | null | undefined;
  /**
   * Also flush on `pagehide` (tab close, reload, navigation away). OFF by
   * default: the rule is expiry-driven, and an editor that opts in must make
   * `getDraft` return null while clean, or every navigation leaves a draft
   * behind and stale drafts become the common case.
   */
  flushOnPageHide?: boolean;
}

export interface DraftOnExpiry<T> {
  /** Write the draft now (also what the event triggers). Returns false when nothing was saved. */
  flush: () => boolean;
  /** The draft left behind by an earlier session, if any. */
  read: () => StoredDraft<T> | null;
  clear: () => void;
}

function versionOf(v: DraftBaseVersion | Date | null | undefined): DraftBaseVersion | null | undefined {
  return v instanceof Date ? v.toISOString() : v;
}

export function useDraftOnExpiry<T>(opts: DraftOnExpiryOptions<T>): DraftOnExpiry<T> {
  const { kind, id, flushOnPageHide = false } = opts;
  // The latest callbacks, read only from event handlers (never in render).
  const getDraftRef = useRef(opts.getDraft);
  const getBaseVersionRef = useRef(opts.getBaseVersion);
  useEffect(() => {
    getDraftRef.current = opts.getDraft;
    getBaseVersionRef.current = opts.getBaseVersion;
  });

  const flush = useCallback((): boolean => {
    if (!id) return false;
    const value = getDraftRef.current();
    if (value === null || value === undefined) return false;
    const baseVersion = versionOf(getBaseVersionRef.current?.());
    return saveDraft(kind, id, value, baseVersion === undefined ? {} : { baseVersion });
  }, [kind, id]);

  const read = useCallback((): StoredDraft<T> | null => (id ? readDraft<T>(kind, id) : null), [kind, id]);
  const clear = useCallback(() => {
    if (id) clearDraft(kind, id);
  }, [kind, id]);

  useEffect(() => {
    if (!id) return;
    const onExpired = () => {
      flush();
    };
    const onPageHide = () => {
      flush();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    if (flushOnPageHide) window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      if (flushOnPageHide) window.removeEventListener("pagehide", onPageHide);
    };
  }, [id, flush, flushOnPageHide]);

  return { flush, read, clear };
}
