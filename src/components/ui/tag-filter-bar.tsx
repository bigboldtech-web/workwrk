"use client";

// Reusable tag-filter chip strip. Drop it above any list view that
// supports `?tags=` filtering. Selected tag ids drive the value via
// onChange — caller owns the URL/state, this is purely presentation
// + data fetch for the available tags.

import { useState, useEffect } from "react";
import { Tag as TagIcon, X } from "lucide-react";

type Tag = {
  id: string;
  name: string;
  type: string;
  color: string | null;
};

export function TagFilterBar({
  selectedIds,
  onChange,
  entityType,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  // Optional — narrows the picker to tag types relevant for this
  // entity. Backend filter is unaware of TagType, so this only
  // affects which chips show in the picker, not the SQL.
  entityType?: string;
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setTags(Array.isArray(data) ? data : []))
      .catch(() => setTags([]));
  }, []);

  const selected = tags.filter((t) => selectedIds.includes(t.id));
  const available = tags.filter((t) => !selectedIds.includes(t.id));

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line text-muted hover:text-fg"
        aria-label="Filter by tags"
        title={entityType ? `Filter ${entityType.toLowerCase()}s by tag` : "Filter by tag"}
      >
        <TagIcon size={11} /> {open ? "Done" : "Tags"}
      </button>
      {selected.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-line text-fg"
          style={t.color ? { borderColor: t.color, color: t.color } : undefined}
        >
          {t.name}
          <button
            type="button"
            onClick={() => toggle(t.id)}
            className="opacity-60 hover:opacity-100"
            aria-label={`Remove ${t.name} filter`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {open && available.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap pl-2 border-l border-line">
          {available.slice(0, 30).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className="px-2 py-0.5 rounded-full border border-line text-muted hover:text-fg"
              style={t.color ? { borderColor: t.color, color: t.color } : undefined}
            >
              {t.name}
            </button>
          ))}
          {available.length > 30 && (
            <span className="text-muted">+{available.length - 30} more</span>
          )}
        </div>
      )}
    </div>
  );
}
