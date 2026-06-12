"use client";

// Shared client cache for the org's ItemTypes (Task Types). Board views
// resolve Item.itemTypeId → { singular, icon } through this. One 60s-cached
// fetch is shared across every cell on the page.

import { useEffect, useState } from "react";

export type ItemTypeLite = { id: string; singular: string; plural: string; icon: string; isDefault: boolean };

let _cache: { items: ItemTypeLite[]; at: number } | null = null;
let _promise: Promise<ItemTypeLite[]> | null = null;

async function load(): Promise<ItemTypeLite[]> {
  if (_cache && Date.now() - _cache.at < 60_000) return _cache.items;
  if (_promise) return _promise;
  _promise = (async () => {
    const res = await fetch("/api/item-types", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const items: ItemTypeLite[] = Array.isArray(data.types) ? data.types : [];
    _cache = { items, at: Date.now() };
    return items;
  })();
  try { return await _promise; } finally { _promise = null; }
}

export interface ItemTypeIndex {
  list: ItemTypeLite[];
  byId: Map<string, ItemTypeLite>;
  /** The org's default type (isDefault), if known. */
  default: ItemTypeLite | null;
}

/** Hook: the org's item types as a list + id→type index. */
export function useItemTypes(): ItemTypeIndex {
  const [items, setItems] = useState<ItemTypeLite[]>(_cache?.items ?? []);
  useEffect(() => {
    let active = true;
    void load().then((rows) => { if (active) setItems(rows); });
    return () => { active = false; };
  }, []);
  const byId = new Map(items.map((t) => [t.id, t]));
  return { list: items, byId, default: items.find((t) => t.isDefault) ?? null };
}
