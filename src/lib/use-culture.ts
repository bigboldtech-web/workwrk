"use client";

// Shared access to the company culture (mission + values) for loading states.
// The mission/values are the reinforcement layer: wherever the app would show a
// bare spinner, we can surface a value instead. Fetched ONCE per app load
// (module cache + in-flight de-dupe) so every loader across the app shares one
// request. The rotation index is shared too (localStorage), so consecutive
// loaders — and the full-screen MissionSplash — cycle through different lines.

import { useEffect, useState } from "react";

export type Culture = { orgName: string; logo: string | null; mission: string; values: string[] };

let cache: Culture | null | undefined;
let inflight: Promise<Culture | null> | null = null;

/** The culture, fetched once and cached. Resolves to null if none/unauthorized. */
export function fetchCulture(): Promise<Culture | null> {
  if (cache !== undefined) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/organization/culture")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("culture"))))
      .then((j) => { cache = (j.data ?? j) as Culture; return cache; })
      .catch(() => { cache = null; return null; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const IDX_KEY = "wwk_mission_rotate_idx";
/** Advance the shared rotation index and return the current slot for `len`. */
export function nextRotateIndex(len: number): number {
  if (len <= 0) return 0;
  try {
    const cur = parseInt(window.localStorage.getItem(IDX_KEY) || "0", 10) || 0;
    window.localStorage.setItem(IDX_KEY, String((cur + 1) % 1_000_000));
    return cur % len;
  } catch { return 0; }
}

/** A single rotating culture line for a loading state — a VALUE by default
 *  (short, tasteful); pass includeMission to also draw the (longer) mission.
 *  Empty string until culture loads, and stays empty if none is configured so
 *  the loader falls back to its plain form. */
export function useCultureLine(opts?: { includeMission?: boolean }): string {
  const [line, setLine] = useState("");
  const includeMission = !!opts?.includeMission;
  useEffect(() => {
    let active = true;
    void fetchCulture().then((c) => {
      if (!active || !c) return;
      const pool: string[] = [];
      if (includeMission && c.mission) pool.push(c.mission.trim());
      for (const v of c.values) if (v && v.trim()) pool.push(v.trim());
      if (pool.length) setLine(pool[nextRotateIndex(pool.length)]);
    });
    return () => { active = false; };
  }, [includeMission]);
  return line;
}
