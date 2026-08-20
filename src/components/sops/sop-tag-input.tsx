"use client";

// SopTagInput — chip input for SOP.tags with org-wide autocomplete.
//
// Tags exist only ON SOPs (the tag list is derived from usage), so this input
// is where tags are born: type and press Enter (or comma) to add, pick from
// the suggestions to reuse an existing label and avoid "HR" vs "Hr" drift.
// Suggestions come from GET /api/sop-tags. The dropdown is position:absolute
// inside the component's own relative wrapper on purpose — it must survive
// transformed ancestors (dialogs) without a body portal.

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Tag as TagIcon } from "lucide-react";

interface SopTagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function SopTagInput({ value, onChange, disabled, placeholder = "Add a tag…" }: SopTagInputProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [known, setKnown] = useState<Array<{ name: string; count: number }>>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/sop-tags")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (active) setKnown(Array.isArray(d) ? d : d.data || []); })
      .catch(() => { /* suggestions are optional */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  const lowerValue = useMemo(() => new Set(value.map((t) => t.toLowerCase())), [value]);
  const q = query.trim().toLowerCase();
  const suggestions = known
    .filter((t) => !lowerValue.has(t.name.toLowerCase()))
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .slice(0, 8);

  function add(raw: string) {
    const tag = raw.trim().replace(/,+$/, "").slice(0, 40);
    if (!tag) return;
    // Reuse the existing casing when the same label already exists org-wide,
    // so "hr" typed twice never mints a second "HR" spelling.
    const existing = known.find((t) => t.name.toLowerCase() === tag.toLowerCase());
    const canonical = existing ? existing.name : tag;
    if (lowerValue.has(canonical.toLowerCase())) { setQuery(""); return; }
    onChange([...value, canonical]);
    setQuery("");
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={`flex min-h-8 flex-wrap items-center gap-1 rounded-lg border bg-white px-2 py-1 dark:bg-zinc-900 ${
          disabled ? "border-zinc-100 opacity-60 dark:border-zinc-800" : "border-zinc-200 focus-within:border-[#0073EA] dark:border-zinc-700"
        }`}
      >
        <TagIcon size={12} className="shrink-0 text-zinc-400" />
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[12px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove tag ${tag}`}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        <input
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(query); }
            else if (e.key === "Backspace" && !query && value.length > 0) remove(value[value.length - 1]);
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[90px] flex-1 bg-transparent text-xs text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
        />
      </div>

      {focused && !disabled && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-[200] mt-1 w-full max-w-[280px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {suggestions.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => add(t.name)}
              className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-white/5"
            >
              <span className="truncate">{t.name}</span>
              <span className="ml-2 shrink-0 text-[11px] text-zinc-400">{t.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
