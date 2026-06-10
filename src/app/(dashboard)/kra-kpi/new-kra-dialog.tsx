"use client";

// NewKraDialog — replaces the window.prompt() quick-add. Captures name,
// category (free text with existing-category suggestions) and an optional
// description. POSTs /api/kras and calls onCreated so the library reloads.

import { useEffect, useRef, useState } from "react";
import { X, Target, Loader2 } from "lucide-react";

export function NewKraDialog({
  open,
  onOpenChange,
  categories,
  defaultCategory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Existing category names for the datalist suggestions. */
  categories: string[];
  defaultCategory?: string | null;
  onCreated: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(defaultCategory ?? "");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setCategory(defaultCategory ?? "");
      setDescription("");
      setError(null);
      // Focus after the dialog paints.
      const t = setTimeout(() => nameRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open, defaultCategory]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give the KRA a name."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          category: category.trim() || "Uncategorized",
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? "Only HR can create KRAs." : "Couldn't create the KRA.");
        setBusy(false);
        return;
      }
      onCreated("KRA created");
      onOpenChange(false);
    } catch {
      setError("Couldn't create the KRA.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={() => onOpenChange(false)} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New KRA"
        className="relative w-full max-w-md rounded-xl bg-white shadow-xl border border-zinc-200"
      >
        <header className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-100">
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-purple-50 text-purple-600">
            <Target className="w-4 h-4" />
          </span>
          <h2 className="text-[14px] font-semibold text-zinc-900 flex-1">New KRA</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-7 h-7 grid place-items-center rounded-md text-zinc-400 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-600">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="e.g. Pipeline generation"
              className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[13px] focus:outline-none focus:border-zinc-400"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-zinc-600">Category</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="kra-category-suggestions"
              placeholder="Uncategorized"
              className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[13px] focus:outline-none focus:border-zinc-400"
            />
            <datalist id="kra-category-suggestions">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-zinc-600">Description <span className="text-zinc-400 font-normal">(optional)</span></span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What outcome does this area own?"
              className="mt-1 w-full px-2.5 py-2 rounded-md border border-zinc-200 text-[13px] resize-none focus:outline-none focus:border-zinc-400"
            />
          </label>

          {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-100">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 px-3 rounded-md text-[12.5px] text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-zinc-900 text-white text-[12.5px] font-medium disabled:opacity-40 hover:bg-zinc-800"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Create KRA
          </button>
        </footer>
      </div>
    </div>
  );
}
