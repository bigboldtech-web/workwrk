"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { TaskLabel } from "./types";

/** Inline label picker — reads all org labels, lets the user toggle them
 *  on the current task, and creates new ones on the fly (manager-only;
 *  the API enforces this, the UI just surfaces the 403 as a toast-less
 *  silent fail since non-managers rarely hit it). */
export function LabelPicker({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    fetch("/api/labels")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d)) setLabels(d);
        else if (d?.data) setLabels(d.data);
      })
      .catch(() => {});
  }, []);

  function toggle(id: string) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const created = await res.json();
        const label = created.data ?? created;
        setLabels((prev) => [...prev, label].sort((a, b) => a.name.localeCompare(b.name)));
        onChange([...selectedIds, label.id]);
        setNewName("");
        setCreating(false);
      }
    } catch {}
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((l) => {
        const on = selectedIds.includes(l.id);
        return (
          <button
            type="button"
            key={l.id}
            onClick={() => toggle(l.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              on ? "text-[#0a0a0a]" : "text-muted border-border hover:bg-surface-2"
            }`}
            style={on ? { backgroundColor: l.color, borderColor: l.color } : undefined}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: on ? "#0a0a0a" : l.color }} />
            {l.name}
          </button>
        );
      })}
      {creating ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
              if (e.key === "Escape") { setCreating(false); setNewName(""); }
            }}
            placeholder="Label name…"
            className="h-6 w-28 rounded-full border border-border bg-background px-2 text-xs outline-none focus:border-[#d4ff2e]"
          />
          <button
            type="button"
            onClick={() => { setCreating(false); setNewName(""); }}
            className="text-muted hover:text-foreground"
            aria-label="Cancel"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted hover:text-foreground hover:border-[#d4ff2e]"
        >
          <Plus size={10} /> Label
        </button>
      )}
    </div>
  );
}
