"use client";

// LinkExistingPicker — small anchored popover that fetches a list of
// existing primitives (notes / whiteboards / files / tables) the
// viewer can see, lets them search, and links one to the current
// source entity via EntityLink.
//
// Designed to live next to the "+ Add" button on each LinkSection in
// the BoardItemDrawer. Click "Link existing" → popover → click a row
// → POST /api/entity-links + close.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link as LinkIcon, Search, Loader2, X, Check } from "lucide-react";

interface Candidate {
  id: string;
  title: string;
  subtitle?: string | null;
}

interface Props {
  /** Anchored next to "+ Add"; we control the toggle from the parent. */
  open: boolean;
  onClose: () => void;
  /** Pretty label for empty + search states ("note", "whiteboard", etc.). */
  kindLabel: string;
  /** Async loader that returns the candidate list (viewer-scoped + gated). */
  loadCandidates: () => Promise<Candidate[]>;
  /** IDs to filter out (already-linked targets). */
  excludeIds: string[];
  /** Returns once the link is persisted. Parent should also refresh its list. */
  onPick: (candidate: Candidate) => Promise<void>;
}

export function LinkExistingPicker({
  open,
  onClose,
  kindLabel,
  loadCandidates,
  excludeIds,
  onPick,
}: Props) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load on first open; reset state on close.
  useEffect(() => {
    if (!open) return;
    let active = true;
    loadCandidates()
      .then((data) => { if (active) setRows(data); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [open, loadCandidates]);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setRows(null);
    setBusyId(null);
    setPickedId(null);
  }, [open]);

  // Outside-click + Escape close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((c) => !excludeSet.has(c.id))
      .filter((c) => {
        if (!q) return true;
        if (c.title.toLowerCase().includes(q)) return true;
        if (c.subtitle?.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 30);
  }, [rows, query, excludeSet]);

  if (!open) return null;

  const pick = async (c: Candidate) => {
    setBusyId(c.id);
    try {
      await onPick(c);
      setPickedId(c.id);
      // Tiny confirmation flash before closing.
      setTimeout(() => onClose(), 300);
    } catch {
      // Surface stays open; caller toasts on failure.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-6 z-[80] w-[320px] rounded-xl border border-zinc-200 bg-white shadow-2xl overflow-hidden"
    >
      <div className="px-2.5 pt-2 pb-1.5 border-b border-zinc-100">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${kindLabel}s…`}
              className="w-full h-7 pl-7 pr-2 rounded-md border border-zinc-200 bg-white text-[12px] focus:outline-none focus:border-zinc-400"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 rounded hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-400"
            aria-label="Close picker"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="max-h-[260px] overflow-y-auto py-1">
        {rows === null ? (
          <div className="px-3 py-4 inline-flex items-center gap-1.5 text-[11.5px] text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-4 text-[11.5px] text-zinc-400">
            {query
              ? `No ${kindLabel}s match "${query}"`
              : `No ${kindLabel}s to link — create a new one above.`}
          </div>
        ) : (
          filtered.map((c) => {
            const busy = busyId === c.id;
            const picked = pickedId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                disabled={busy || picked}
                className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-zinc-50 disabled:opacity-60"
              >
                <LinkIcon className="h-3 w-3 text-zinc-400 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-medium text-zinc-900 truncate">{c.title}</span>
                  {c.subtitle ? (
                    <span className="block text-[10.5px] text-zinc-500 truncate">{c.subtitle}</span>
                  ) : null}
                </span>
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                ) : picked ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
