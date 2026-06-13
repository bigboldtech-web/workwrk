"use client";

// TagPicker — multi-select popover over the org's CUSTOM workspace tags
// (Tag model). Search, toggle, and inline "Create" when the query has
// no exact match. Used by the table Tags cell, the drawer row, and the
// create-task modal. Values are Tag ids; display uses the tag's color.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import type { ItemTag } from "@/lib/board-items-shared";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";

const FALLBACK_COLOR = "#94a3b8";

export function TagChip({ tag, onRemove }: { tag: ItemTag; onRemove?: () => void }) {
  const color = tag.color || FALLBACK_COLOR;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium max-w-[140px]"
      style={{ background: `${color}22`, color }}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${tag.name}`} className="opacity-60 hover:opacity-100">
          <X className="w-3 h-3" />
        </button>
      ) : null}
    </span>
  );
}

// Deterministic color for newly minted tags — same djb2 trick as
// owner avatars so a tag keeps its hue everywhere.
function colorFor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return `hsl(${Math.abs(h) % 360} 60% 45%)`;
}

interface TagPickerProps {
  value: ItemTag[];
  canEdit: boolean;
  /** Chips-only trigger for dense table cells (max 2 chips + overflow). */
  compact?: boolean;
  onChange: (tags: ItemTag[]) => void;
}

export function TagPicker({ value, canEdit, compact = false, onChange }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<ItemTag[] | null>(null);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // Load the org's CUSTOM tags on first open. /api/tags returns a raw array.
  useEffect(() => {
    if (!open || all !== null) return;
    let active = true;
    fetch("/api/tags?type=CUSTOM", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!active) return;
        const rows: ItemTag[] = Array.isArray(d) ? d.map((t: { id: string; name: string; color: string | null }) => ({ id: t.id, name: t.name, color: t.color })) : [];
        setAll(rows);
      })
      .catch(() => { if (active) setAll([]); });
    return () => { active = false; };
  }, [open, all]);

  const toggle = useCallback((tag: ItemTag) => {
    const has = value.some((t) => t.id === tag.id);
    onChange(has ? value.filter((t) => t.id !== tag.id) : [...value, tag]);
  }, [value, onChange]);

  const createTag = useCallback(async (name: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, type: "CUSTOM", color: colorFor(name.toLowerCase()) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.id) {
        const tag: ItemTag = { id: data.id, name: data.name, color: data.color };
        setAll((prev) => (prev ? [...prev, tag] : [tag]));
        onChange([...value, tag]);
        setQuery("");
      }
    } finally {
      setCreating(false);
    }
  }, [creating, value, onChange]);

  const q = query.trim().toLowerCase();
  const filtered = (all ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  const exactMatch = (all ?? []).some((t) => t.name.toLowerCase() === q);

  const shown = compact ? value.slice(0, 2) : value;
  const overflow = value.length - shown.length;

  const display = value.length ? (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {shown.map((t) => <TagChip key={t.id} tag={t} />)}
      {overflow > 0 ? <span className="text-[11px] text-zinc-500">+{overflow}</span> : null}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      <TagIcon className="w-3.5 h-3.5" />
      {compact ? null : "No tags"}
    </span>
  );

  if (!canEdit) return display;

  return (
    <div className="relative inline-block max-w-full" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 -mx-1 hover:bg-zinc-100 max-w-full"
        aria-label="Edit tags"
      >
        {display}
      </button>
      {open ? (
        <div
          className="absolute z-50 mt-1 left-0 w-[240px] rounded-md border border-zinc-200 bg-white shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-zinc-100">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q && !exactMatch) {
                  e.preventDefault();
                  void createTag(query.trim());
                }
              }}
              placeholder="Search or add a tag…"
              className="w-full text-[13px] bg-transparent outline-none placeholder:text-zinc-400"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto py-1">
            {all === null ? (
              <div className="px-3 py-3 text-[11.5px] text-zinc-400">Loading…</div>
            ) : (
              <>
                {filtered.map((t) => {
                  const active = value.some((v) => v.id === t.id);
                  return (
                    <MenuItem
                      key={t.id}
                      leading={<TagChip tag={t} />}
                      label={null}
                      selected={active}
                      onClick={() => toggle(t)}
                    />
                  );
                })}
                {q && !exactMatch ? (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={Plus}
                      label={<>Create “{query.trim()}”</>}
                      disabled={creating}
                      onClick={() => void createTag(query.trim())}
                    />
                  </>
                ) : null}
                {!filtered.length && !q ? (
                  <div className="px-3 py-3 text-[11.5px] text-zinc-400">No tags yet — type to create one</div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
