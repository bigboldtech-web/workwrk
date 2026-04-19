"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface KraOption {
  id: string;
  name: string;
  category?: string;
  description?: string;
}

interface KraPickerProps {
  kras: KraOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  excludeIds?: string[];
  className?: string;
}

export function KraPicker({ kras, value, onChange, placeholder = "Select KRA", excludeIds = [], className }: KraPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const available = kras.filter((k) => !excludeIds.includes(k.id));
  const filtered = available.filter((k) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return k.name.toLowerCase().includes(q) || (k.category || "").toLowerCase().includes(q) || (k.description || "").toLowerCase().includes(q);
  });

  // Group by category
  const grouped: Record<string, KraOption[]> = {};
  for (const k of filtered) {
    const cat = k.category || "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(k);
  }
  const sortedCategories = Object.keys(grouped).sort();

  const selected = kras.find((k) => k.id === value);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]"
      >
        <span className="flex-1 min-w-0 text-left">
          {selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate min-w-0">{selected.name}</span>
              {selected.category && (
                <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{selected.category}</span>
              )}
            </span>
          ) : (
            <span className="text-muted truncate block">{placeholder}</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[280px] rounded-lg border border-border bg-surface shadow-xl animate-in fade-in-0 zoom-in-95">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={14} className="text-muted shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search KRAs..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-64 overflow-y-auto p-1">
            {sortedCategories.length === 0 && (
              <p className="py-4 text-center text-xs text-muted">No KRAs found</p>
            )}
            {sortedCategories.map((cat) => (
              <div key={cat}>
                <div className="sticky top-0 bg-surface px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {cat}
                </div>
                {grouped[cat].map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => { onChange(k.id); setOpen(false); setSearch(""); }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors hover:bg-surface-2",
                      k.id === value && "bg-[rgba(212,255,46,0.08)] text-[#d4ff2e]"
                    )}
                  >
                    <span className="flex-1 truncate">{k.name}</span>
                    {k.id === value && <span className="text-[#d4ff2e] text-xs">✓</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
