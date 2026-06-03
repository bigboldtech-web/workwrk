"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus } from "lucide-react";
import { SPACE_ICON_CATALOG, SPACE_COLOR_PALETTE, getSpaceIcon } from "./space-icon-catalog";

function SpaceIconGlyph({ name, className }: { name: string; className?: string }) {
  const Icon = getSpaceIcon(name);
  if (!Icon) return null;
  return createElement(Icon, { className });
}

interface Props {
  iconName: string | null;
  color: string;
  fallbackInitial: string;
  onChange: (next: { iconName: string | null; color: string }) => void;
}

export function SpaceIconPicker({ iconName, color, fallbackInitial, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || swatchRef.current?.contains(t)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SPACE_ICON_CATALOG;
    return SPACE_ICON_CATALOG.filter((entry) => {
      if (entry.name.toLowerCase().includes(q)) return true;
      return entry.keywords?.some((k) => k.toLowerCase().includes(q));
    });
  }, [query]);

  return (
    <div className="relative">
      <button
        ref={swatchRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 w-10 rounded-lg flex items-center justify-center text-white text-sm font-semibold uppercase shadow-sm transition hover:opacity-90"
        style={{ backgroundColor: color }}
        aria-label="Choose icon and color"
      >
        {iconName ? <SpaceIconGlyph name={iconName} className="h-5 w-5" /> : fallbackInitial}
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className="absolute left-0 top-12 z-[60] w-[320px] rounded-xl border border-border bg-surface shadow-2xl p-3"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
              <input
                type="text"
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-2 rounded-md border border-border bg-surface-2 text-[12.5px] focus:outline-none focus:border-[color:var(--accent)]"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-1">
              <div
                className="h-6 w-6 rounded-full border-2 border-white shadow"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <label className="h-6 w-6 rounded-full bg-surface-2 border border-border flex items-center justify-center cursor-pointer hover:bg-surface-3">
                <Plus className="h-3 w-3 text-muted" />
                <input
                  type="color"
                  value={color}
                  onChange={(e) => onChange({ iconName, color: e.target.value })}
                  className="absolute opacity-0 pointer-events-none"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 mb-3">
            {SPACE_COLOR_PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => onChange({ iconName, color: c.hex })}
                className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                  color.toLowerCase() === c.hex.toLowerCase() ? "ring-2 ring-offset-1 ring-foreground/30" : ""
                }`}
                style={{ backgroundColor: c.hex }}
                aria-label={c.name}
              />
            ))}
          </div>

          <div className="grid grid-cols-9 gap-1 max-h-[280px] overflow-y-auto pr-1">
            {filtered.map((entry) => {
              const selected = iconName === entry.name;
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => {
                    onChange({ iconName: entry.name, color });
                    setOpen(false);
                  }}
                  className={`h-8 w-8 rounded-md flex items-center justify-center transition ${
                    selected
                      ? "ring-2 ring-offset-1 ring-foreground/40"
                      : "hover:bg-surface-2"
                  }`}
                  style={{ color }}
                  title={entry.name}
                >
                  <SpaceIconGlyph name={entry.name} className="h-4 w-4" />
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <div className="col-span-9 text-center text-xs text-muted py-6">
                No icons match &ldquo;{query}&rdquo;
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
