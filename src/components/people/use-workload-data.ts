"use client";

// The data under a Workload grid, shared by Teams > Workload and a Space's
// Workload tab, so both load a window the same way:
//
//   - only the newest request's answer is kept, so a slow answer for an
//     earlier window never overwrites a later one;
//   - `failed` is true only while the CURRENT url's load failed, so moving to
//     another window, or Try again, always sends a request;
//   - `matches(from, to)` says whether the data is for the window on screen.
//     A caller draws the grid only when it matches: while another window
//     loads it shows a skeleton, and when that load failed it says so. Old
//     tasks are never drawn on new days (the worst case is a lead reading
//     next week as free);
//   - returning to the tab reloads at most every 30 seconds, and a burst of
//     workwrk:items-changed events (a bulk edit) is one reload.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

const FOCUS_REFRESH_MS = 30_000;
const CHANGED_DEBOUNCE_MS = 300;

export function useWorkloadData<T extends { window: { from: string; to: string } }>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const r = await apiFetch<T>(url, { cache: "no-store" });
    // A newer request was sent while this one was out: its answer wins.
    if (mine !== seq.current) return;
    setLoading(false);
    lastLoad.current = Date.now();
    if (!r.ok) {
      setError(r.error || "Couldn't load the workload");
      setFailedUrl(url);
      return;
    }
    setError(null);
    setFailedUrl(null);
    setData(r.data);
  }, [url]);

  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    let changed: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => { if (Date.now() - lastLoad.current > FOCUS_REFRESH_MS) void load(); };
    const onChanged = () => { if (changed) clearTimeout(changed); changed = setTimeout(() => { void load(); }, CHANGED_DEBOUNCE_MS); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("workwrk:items-changed", onChanged);
    return () => {
      if (changed) clearTimeout(changed);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("workwrk:items-changed", onChanged);
    };
  }, [load]);

  const matches = useCallback((from: string, to: string) => !!data && data.window.from === from && data.window.to === to, [data]);
  return { data, setData, error, loading, failed: failedUrl === url, matches, load };
}
