"use client";

// useWidgetItems — the ONE data-fetch hook every dashboard widget shares.
// A tiny in-memory per-source promise cache means six widgets reading the
// same source resolve off a single network fetch. `refresh` drops the
// cache entry for its source so the next mount/refresh refetches.

import { useCallback, useEffect, useState } from "react";
import { STATUS_LOOKUP } from "@/lib/board-items-shared";
import type { StatScope, WidgetSource } from "../widget-types";

export interface WidgetItem {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: string | null;
  owner: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
}

const cache = new Map<string, Promise<WidgetItem[]>>();

function sourceKey(source: WidgetSource | undefined): string {
  return !source || source.kind === "all" ? "all" : `board:${source.boardId}`;
}

function sourceUrl(key: string): string {
  return key === "all" ? "/api/me/everything" : `/api/boards/${key.slice("board:".length)}/items`;
}

function normalize(raw: unknown): WidgetItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string") return null;
  const owner = r.owner && typeof r.owner === "object"
    ? (r.owner as WidgetItem["owner"])
    : null;
  return {
    id: r.id,
    title: r.title,
    status: typeof r.status === "string" ? r.status : null,
    priority: typeof r.priority === "string" ? r.priority : null,
    dueAt: typeof r.dueAt === "string" ? r.dueAt : null,
    owner,
  };
}

function fetchItems(key: string): Promise<WidgetItem[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fetch(sourceUrl(key), { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const list: unknown[] = Array.isArray(data?.items) ? data.items : [];
      return list.map(normalize).filter((x): x is WidgetItem => x !== null);
    })
    .catch((err) => {
      // Failed fetches must not poison the cache for later widgets.
      cache.delete(key);
      throw err;
    });
  cache.set(key, p);
  return p;
}

interface HookState {
  key: string;
  items: WidgetItem[] | null;
  error: boolean;
}

export function useWidgetItems(source: WidgetSource | undefined) {
  const key = sourceKey(source);
  const [state, setState] = useState<HookState>({ key, items: null, error: false });

  // Source switched: reset during render (sanctioned derive-from-props
  // pattern) instead of a cascading setState-in-effect.
  if (state.key !== key) setState({ key, items: null, error: false });

  useEffect(() => {
    let alive = true;
    fetchItems(key).then(
      (list) => { if (alive) setState((s) => (s.key === key ? { key, items: list, error: false } : s)); },
      () => { if (alive) setState((s) => (s.key === key ? { key, items: [], error: true } : s)); },
    );
    return () => { alive = false; };
  }, [key]);

  const refresh = useCallback(() => {
    cache.delete(key);
    setState({ key, items: null, error: false });
    fetchItems(key).then(
      (list) => setState((s) => (s.key === key ? { key, items: list, error: false } : s)),
      () => setState((s) => (s.key === key ? { key, items: [], error: true } : s)),
    );
  }, [key]);

  return { items: state.items, loading: state.items === null, error: state.error, refresh };
}

// ─── Shared item math ───────────────────────────────────────────────

/** Done = status resolves to a non-ACTIVE group in the default set.
 *  Unknown/custom statuses count as open, matching isDoneStatus. */
export function isItemDone(item: WidgetItem): boolean {
  const opt = item.status ? STATUS_LOOKUP[item.status] : undefined;
  return opt ? opt.group !== "ACTIVE" : false;
}

export function isItemOverdue(item: WidgetItem, now = Date.now()): boolean {
  if (!item.dueAt || isItemDone(item)) return false;
  const due = Date.parse(item.dueAt);
  return Number.isFinite(due) && due < now;
}

export function countForScope(items: WidgetItem[], scope: StatScope): number {
  switch (scope) {
    case "total":     return items.length;
    case "completed": return items.filter(isItemDone).length;
    case "overdue":   return items.filter((i) => isItemOverdue(i)).length;
    case "open":
    default:          return items.filter((i) => !isItemDone(i)).length;
  }
}
