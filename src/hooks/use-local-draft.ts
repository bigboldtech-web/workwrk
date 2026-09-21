"use client";

// useLocalDraft (spec-docs-knowledge section 2, "Local draft"): every autosave
// payload is mirrored to localStorage under `workwrk:draft:<kind>:<id>` and
// cleared on a 200; on reopen with a draft NEWER than the server's updatedAt
// the restore strip renders: "You have unsaved changes from {time}.
// Restore · Discard". Ephemera, never a setting.
//
// It is an OBSERVER of the existing save path, not a replacement for it
// (design risk 13: never change retry or keepalive behaviour in the same
// edit as chrome). The editor calls:
//
//   const draft = useLocalDraft<Payload>("doc", id);
//   draft.write(payload)                       every time it queues a save
//   draft.clear()                              after a 200
//   draft.pending                              the draft found on mount, or null
//   draft.discard()                            the strip's Discard
//
// and renders <DraftRestoreStrip draft={draft} onRestore={...} />.
//
// The pure half (key shape, the newer-than-server rule, the JSON envelope)
// lives in src/lib/local-draft.ts so vitest proves it without a DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { draftKey, isDraftNewer, parseDraft, serializeDraft, type DraftEnvelope } from "@/lib/local-draft";

export interface LocalDraft<T> {
  /** The draft found on mount that is newer than the server row, else null. */
  pending: DraftEnvelope<T> | null;
  write: (payload: T) => void;
  clear: () => void;
  /** Drop the pending draft without restoring it. */
  discard: () => void;
  /** Mark the pending draft as consumed (after the caller restored it). */
  consume: () => void;
  key: string;
}

export function useLocalDraft<T>(
  kind: string,
  id: string | null | undefined,
  /** The server's updatedAt once known. The strip renders only when the draft is newer. */
  serverUpdatedAt: string | Date | null | undefined,
): LocalDraft<T> {
  const key = useMemo(() => draftKey(kind, id ?? ""), [kind, id]);
  const [pending, setPending] = useState<DraftEnvelope<T> | null>(null);
  const checkedRef = useRef(false);

  // One check per (key, serverUpdatedAt) pair, once the server row is known.
  useEffect(() => {
    checkedRef.current = false;
  }, [key]);
  useEffect(() => {
    if (!id || checkedRef.current || serverUpdatedAt === undefined || serverUpdatedAt === null) return;
    checkedRef.current = true;
    // A tick after the effect, not inside it: the read is synchronous and the
    // setState it can lead to would cascade a render from the effect body.
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      let raw: string | null = null;
      try { raw = window.localStorage.getItem(key); } catch { raw = null; }
      const env = parseDraft<T>(raw);
      if (env && isDraftNewer(env, serverUpdatedAt)) setPending(env);
      else if (env) {
        // Older than what the server has: the server won, drop the ballast.
        try { window.localStorage.removeItem(key); } catch { /* ignore */ }
      }
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [id, key, serverUpdatedAt]);

  const write = useCallback((payload: T) => {
    if (!id) return;
    try { window.localStorage.setItem(key, serializeDraft(payload)); } catch { /* quota or private mode: the server save still runs */ }
  }, [id, key]);

  const clear = useCallback(() => {
    if (!id) return;
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }, [id, key]);

  const discard = useCallback(() => {
    clear();
    setPending(null);
  }, [clear]);

  const consume = useCallback(() => setPending(null), []);

  return useMemo(() => ({ pending, write, clear, discard, consume, key }), [pending, write, clear, discard, consume, key]);
}
