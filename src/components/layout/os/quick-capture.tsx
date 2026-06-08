"use client";

/* Global quick-capture handler.
 *
 * Cmd+Shift+N (or Ctrl+Shift+N on Windows/Linux) from anywhere in the
 * app creates a fresh blank note and jumps straight into editing. Lives
 * at the OS shell level so the shortcut works regardless of which page
 * the user is on.
 *
 * Skipped while focus is in an input/textarea/contentEditable so users
 * who actually want to type "N" never get hijacked.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOsToast } from "./toast";

export function QuickCaptureHandler() {
  const router = useRouter();
  const { toast } = useOsToast();
  const inflight = useRef(false);

  useEffect(() => {
    async function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== "N" && e.key !== "n") return;

      // Don't hijack typing in a real input.
      const t = e.target as Element | null;
      if (t && (
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
        (t as HTMLElement).isContentEditable
      )) return;

      e.preventDefault();
      if (inflight.current) return;
      inflight.current = true;

      try {
        const res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Untitled note", content: { blocks: [] } }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          toast(`Couldn't create note${err?.error ? ` — ${err.error}` : ""}`);
          return;
        }
        const data = await res.json();
        const id = data?.doc?.id ?? data?.data?.id ?? data?.id;
        if (id) router.push(`/docs/${id}`);
      } catch {
        toast("Couldn't create note");
      } finally {
        inflight.current = false;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toast]);

  return null;
}
