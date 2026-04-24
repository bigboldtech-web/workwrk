"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface UseAutosaveOptions<T> {
  /**
   * Serializable snapshot of the current editable state. The hook watches
   * this for changes (via JSON.stringify) so the caller doesn't need to
   * memoize — any change triggers a debounced save.
   */
  snapshot: T;
  /** Async persistence callback. Called with the latest snapshot at flush time. */
  save: (snapshot: T) => Promise<void>;
  /**
   * When false, autosave is fully disabled: the timer stops, the baseline
   * clears, and status returns to "idle". Flip to true once the user is
   * in edit mode so we don't save during the initial hydration.
   */
  enabled: boolean;
  /** Debounce window in ms. Default 1500. */
  delay?: number;
  /**
   * localStorage key for a best-effort backup written on every change.
   * Cleared after a successful server save. Skip (undefined) to disable
   * local backup for this instance.
   */
  localKey?: string;
}

/**
 * Controlled autosave with a localStorage backup and a beforeunload guard.
 *
 * Design notes:
 * - We coalesce rapid changes with a single trailing timer rather than a
 *   leading one — a user pausing for 1.5s means "good stopping point"
 *   and is the right moment to round-trip to the server.
 * - Snapshots are serialized once per render and compared to the last
 *   saved serialized form. No work happens when nothing changed.
 * - A ref holds the latest `save` callback so we don't churn the debounce
 *   timer when the caller re-creates closures each render.
 * - On unmount we attempt a final flush. That's best-effort — for hard
 *   browser close the beforeunload prompt is the real safety net.
 */
export function useAutosave<T>({
  snapshot,
  save,
  enabled,
  delay = 1500,
  localKey,
}: UseAutosaveOptions<T>) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const retryRef = useRef(false);

  const saveRef = useRef(save);
  saveRef.current = save;

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Last snapshot we successfully persisted, stored as its serialized form.
  // Null = no baseline yet (freshly enabled, or not enabled).
  const baselineRef = useRef<string | null>(null);

  const serialized = safeSerialize(snapshot);

  const flush = useCallback(async () => {
    const currentSerialized = safeSerialize(snapshotRef.current);
    if (currentSerialized === baselineRef.current) return;
    if (inFlightRef.current) {
      // Another flush is in flight; mark that we need to redo it
      // afterwards with whatever is current at that time.
      retryRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setStatus("saving");
    try {
      await saveRef.current(snapshotRef.current);
      baselineRef.current = currentSerialized;
      setStatus("saved");
      setLastSavedAt(new Date());
      if (localKey && typeof window !== "undefined") {
        try { window.localStorage.removeItem(localKey); } catch { /* ignore */ }
      }
    } catch {
      setStatus("error");
    } finally {
      inFlightRef.current = false;
      if (retryRef.current) {
        retryRef.current = false;
        // Retry with latest state
        setTimeout(() => { flush(); }, 0);
      }
    }
  }, [localKey]);

  // Reset baseline whenever enabled toggles. Flipping off also cancels any
  // pending timer — no autosave leaks out of edit mode.
  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      baselineRef.current = null;
      setStatus("idle");
    }
  }, [enabled]);

  // Schedule debounced save on snapshot changes.
  useEffect(() => {
    if (!enabled) return;

    // First real snapshot while enabled — treat as the clean baseline so
    // we don't re-save what we just finished hydrating.
    if (baselineRef.current === null) {
      baselineRef.current = serialized;
      return;
    }

    if (serialized === baselineRef.current) return;

    setStatus("dirty");

    if (localKey && typeof window !== "undefined") {
      try {
        // Wrap with a timestamp so callers can compare against the
        // server's updatedAt when deciding whether to offer a restore.
        window.localStorage.setItem(localKey, JSON.stringify({ at: Date.now(), data: snapshot }));
      } catch { /* quota / private mode */ }
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { flush(); }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [serialized, enabled, delay, flush, localKey]);

  // beforeunload guard — fires only while something is genuinely unsaved.
  useEffect(() => {
    const pending = status === "dirty" || status === "saving";
    if (!pending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  // Final flush on unmount (best-effort for SPA navigation).
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Fire and forget — the unmounted component can't await it, but if
    // the user is navigating within the app the request still completes.
    flush();
  }, [flush]);

  return { status, lastSavedAt, flushNow: flush };
}

function safeSerialize(v: unknown): string {
  try { return JSON.stringify(v); } catch { return ""; }
}

export interface AutosaveBackup<T> {
  /** Timestamp (ms) when the backup was written. */
  at: number;
  /** Decoded snapshot payload. */
  data: T;
}

/**
 * Read a local backup written by a previous session. Returns null if
 * nothing is stored or the payload is corrupt.
 */
export function readAutosaveBackup<T>(key: string): AutosaveBackup<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "data" in parsed && "at" in parsed) {
      return parsed as AutosaveBackup<T>;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearAutosaveBackup(key: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}
