"use client";

// SopTagInput: chip input for SOP.tags with org-wide autocomplete.
//
// Tags exist only ON SOPs (the tag list is derived from usage), so this input
// is where tags are born: type and press Enter (or comma) to add, pick from
// the suggestions to reuse an existing label and avoid "HR" vs "Hr" drift.
// Suggestions come from GET /api/sop-tags. The dropdown is position:absolute
// inside the component's own relative wrapper on purpose: it must survive
// transformed ancestors (dialogs) without a body portal.
//
// Tokens only (design-system 2.2): dark mode is the rebinding of --os-*, so
// the `dark:` variants this file carried are gone with the zinc literals.

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Tag as TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SopTagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function SopTagInput({ value, onChange, disabled, placeholder = "Add a tag" }: SopTagInputProps) {
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
      <div className={cn("flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-raised px-2 py-1", disabled ? "border-line opacity-60" : "border-line-strong focus-within:border-brand")}>
        <TagIcon className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
        {value.map((tag) => (
          <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-md bg-active px-1.5 text-xs font-medium text-ink">
            {tag}
            {!disabled ? (
              <button type="button" onClick={() => remove(tag)} aria-label={`Remove tag ${tag}`} className="inline-flex h-4 w-4 items-center justify-center rounded text-ink-2 hover:text-ink">
                <X className="h-3 w-3" strokeWidth={1.5} aria-hidden />
              </button>
            ) : null}
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
          aria-label="Tags"
          className="h-6 min-w-[90px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      {focused && !disabled && suggestions.length > 0 ? (
        <ul className="absolute start-0 top-full z-[200] mt-1 w-full max-w-[280px] overflow-hidden rounded-md border border-line bg-raised py-1 shadow-[var(--os-shadow-pop)]" role="listbox">
          {suggestions.map((t) => (
            <li key={t.name}>
              <button type="button" onClick={() => add(t.name)} className="flex h-8 w-full items-center justify-between px-2.5 text-start text-sm text-ink hover:bg-hover">
                <span className="truncate">{t.name}</span>
                <span className="ms-2 shrink-0 text-xs tabular-nums text-ink-3">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
