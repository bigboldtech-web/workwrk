"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useToast } from "@/components/ui/toast";

interface Category {
  id: string;
  name: string;
}

interface KraCategoryPickerProps {
  categories: Category[];
  value: string;                              // selected category name (we use name as the value to keep API compat)
  onChange: (name: string) => void;
  onCategoriesChanged: () => void | Promise<void>;  // refresh categories from parent
  placeholder?: string;
}

export function KraCategoryPicker({
  categories,
  value,
  onChange,
  onCategoriesChanged,
  placeholder = "Select category",
}: KraCategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const { error: toastError } = useToast();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function addCategory() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/kra-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const created = await res.json().catch(() => null);
        const createdName = created?.data?.name || created?.name || newName.trim();
        await onCategoriesChanged();
        onChange(createdName);
        setNewName("");
        setAdding(false);
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to add category");
      }
    } finally { setBusy(false); }
  }

  async function deleteCategory(id: string, name: string) {
    if (!(await confirm({
      title: `Delete category "${name}"?`,
      description: "KRAs using this category will keep the name as a free-text label.",
      confirmLabel: "Delete category",
      destructive: true,
    }))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/kra-categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await onCategoriesChanged();
        if (value === name) onChange("");
      }
    } finally { setBusy(false); }
  }

  async function saveEdit(id: string, oldName: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    if (editName.trim() === oldName) { setEditingId(null); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/kra-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: editName.trim() }),
      });
      if (res.ok) {
        await onCategoriesChanged();
        if (value === oldName) onChange(editName.trim());
        setEditingId(null);
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to update");
      }
    } finally { setBusy(false); }
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]"
      >
        <span className="flex-1 truncate text-left">
          {value || <span className="text-muted">{placeholder}</span>}
        </span>
        <ChevronDown size={14} className="opacity-50 shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] rounded-lg border border-border bg-surface shadow-xl animate-in fade-in-0 zoom-in-95">
          <div className="max-h-64 overflow-y-auto p-1">
            {categories.length === 0 && !adding && (
              <p className="py-3 text-center text-xs text-muted">No categories yet. Add one below.</p>
            )}
            {categories.map((c) => (
              <div key={c.id} className="group flex items-center gap-1 rounded-md hover:bg-surface-2 px-1">
                {editingId === c.id ? (
                  <>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(c.id, c.name);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className="flex-1 bg-transparent text-sm outline-none border-b border-[#d4ff2e] py-1.5 px-1"
                    />
                    <button onClick={() => saveEdit(c.id, c.name)} className="p-1 text-[#d4ff2e] hover:text-[#d4ff2e]">
                      <Check size={14} />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1 text-muted hover:text-foreground">
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { onChange(c.name); setOpen(false); }}
                      className={`flex-1 text-left text-sm py-1.5 px-1 rounded ${value === c.name ? "text-[#d4ff2e]" : "text-foreground"}`}
                    >
                      {c.name}
                      {value === c.name && <span className="ml-2 text-[#d4ff2e] text-xs">✓</span>}
                    </button>
                    <button
                      onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                      className="p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-foreground"
                      title="Edit"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => deleteCategory(c.id, c.name)}
                      className="p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Add new */}
          <div className="border-t border-border p-2">
            {adding ? (
              <div className="flex items-center gap-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCategory();
                    if (e.key === "Escape") { setAdding(false); setNewName(""); }
                  }}
                  placeholder="Category name"
                  autoFocus
                  className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-[#d4ff2e]"
                />
                <button
                  onClick={addCategory}
                  disabled={busy || !newName.trim()}
                  className="px-2 h-8 rounded-md bg-[#d4ff2e] text-[#0a0a0a] text-xs disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => { setAdding(false); setNewName(""); }}
                  className="px-2 h-8 rounded-md text-muted text-xs hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#d4ff2e] hover:bg-surface-2"
              >
                <Plus size={12} /> New category
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
