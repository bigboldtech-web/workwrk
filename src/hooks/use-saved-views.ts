"use client";

// Saved views — per-list view persistence (filters + sort + columns).
// Stored in localStorage under `workwrk:views:<scope>` so each list
// (people, tasks, kudos, ...) has its own bucket. The hook is generic
// over the view-state shape so each caller can store exactly what's
// meaningful for that page (filter strings, column visibility, etc.).
//
// Use:
//   type PeopleView = { dept: string; status: string; sort: string };
//   const { views, current, save, load, remove, setCurrent } =
//     useSavedViews<PeopleView>("people");

import { useCallback, useEffect, useState } from "react";

export type SavedView<T> = {
  id: string;
  name: string;
  state: T;
  createdAt: string;
};

const PREFIX = "workwrk:views:";
const EVENT = "workwrk:saved-views";

function readArr<T>(key: string): SavedView<T>[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArr<T>(key: string, arr: SavedView<T>[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(arr));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key } }));
}

export function useSavedViews<T>(scope: string) {
  const key = PREFIX + scope;
  const currentKey = key + ":current";

  const [views, setViews] = useState<SavedView<T>[]>([]);
  const [currentId, _setCurrentId] = useState<string | null>(null);

  // Load + cross-tab sync.
  useEffect(() => {
    const sync = () => {
      setViews(readArr<T>(key));
      if (typeof window !== "undefined") {
        _setCurrentId(window.localStorage.getItem(currentKey) || null);
      }
    };
    sync();
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (!detail || detail.key === key) sync();
    };
    const storage = (e: StorageEvent) => {
      if (e.key === key || e.key === currentKey) sync();
    };
    window.addEventListener(EVENT, listener);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(EVENT, listener);
      window.removeEventListener("storage", storage);
    };
  }, [key, currentKey]);

  const save = useCallback(
    (name: string, state: T): SavedView<T> => {
      const view: SavedView<T> = {
        id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim() || "Untitled view",
        state,
        createdAt: new Date().toISOString(),
      };
      const next = [...readArr<T>(key), view];
      writeArr(key, next);
      return view;
    },
    [key],
  );

  const remove = useCallback(
    (id: string) => {
      const next = readArr<T>(key).filter((v) => v.id !== id);
      writeArr(key, next);
      if (typeof window !== "undefined" && window.localStorage.getItem(currentKey) === id) {
        window.localStorage.removeItem(currentKey);
        _setCurrentId(null);
      }
    },
    [key, currentKey],
  );

  const setCurrent = useCallback(
    (id: string | null) => {
      if (typeof window === "undefined") return;
      if (id) window.localStorage.setItem(currentKey, id);
      else window.localStorage.removeItem(currentKey);
      _setCurrentId(id);
    },
    [currentKey],
  );

  const load = useCallback(
    (id: string): T | null => {
      const v = readArr<T>(key).find((x) => x.id === id);
      if (!v) return null;
      setCurrent(id);
      return v.state;
    },
    [key, setCurrent],
  );

  const current = currentId ? views.find((v) => v.id === currentId) ?? null : null;

  return { views, current, currentId, save, load, remove, setCurrent };
}
