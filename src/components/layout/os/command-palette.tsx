"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Home,
  CheckSquare,
  CalendarDays,
  Users2,
  Briefcase,
  Code2,
  Headphones,
  CircleDollarSign,
  Sparkles,
  Store,
  Plus,
  Settings,
  Inbox,
  Target,
  FileText,
} from "lucide-react";
import { useOsShell } from "./shell-context";

type Item = {
  id: string;
  label: string;
  group: string;
  href?: string;
  action?: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  meta?: string;
};

const STATIC_ITEMS: Item[] = [
  // Navigate
  { id: "go-today",   group: "Navigate", label: "Today",        href: "/today",       Icon: Home,        meta: "G T" },
  { id: "go-inbox",   group: "Navigate", label: "Inbox",        href: "/inbox",       Icon: Inbox,       meta: "G I" },
  { id: "go-tasks",   group: "Navigate", label: "My tasks",     href: "/tasks",       Icon: CheckSquare, meta: "G K" },
  { id: "go-meet",    group: "Navigate", label: "Meetings",     href: "/meetings",    Icon: CalendarDays,meta: "G M" },
  { id: "go-okrs",    group: "Navigate", label: "OKRs",         href: "/okrs",        Icon: Target },
  { id: "go-docs",    group: "Navigate", label: "Docs & notes", href: "/docs",        Icon: FileText },
  // Spaces
  { id: "sp-sales",   group: "Spaces", label: "Sales space",       href: "/spaces/sales",       Icon: Briefcase },
  { id: "sp-eng",     group: "Spaces", label: "Engineering space", href: "/spaces/engineering", Icon: Code2 },
  { id: "sp-people",  group: "Spaces", label: "People & HR space", href: "/spaces/people",      Icon: Users2 },
  { id: "sp-fin",     group: "Spaces", label: "Finance space",     href: "/spaces/finance",     Icon: CircleDollarSign },
  { id: "sp-supp",    group: "Spaces", label: "Support space",     href: "/spaces/support",     Icon: Headphones },
  // Agents
  { id: "ag-ria",     group: "Agents", label: "Open Ria (SDR)",          href: "/agents/ria",   Icon: Sparkles },
  { id: "ag-priya",   group: "Agents", label: "Open Priya (HR Ops)",     href: "/agents/priya", Icon: Sparkles },
  { id: "ag-hire",    group: "Agents", label: "Hire a new agent…",       href: "/agents",       Icon: Plus },
  // Library
  { id: "lib-store",  group: "Library", label: "Marketplace",       href: "/store",        Icon: Store },
  { id: "lib-set",    group: "Library", label: "Workspace settings", href: "/settings",     Icon: Settings },
  // Actions
  { id: "act-task",   group: "Create", label: "New task…",            Icon: Plus, action: () => {} },
  { id: "act-doc",    group: "Create", label: "New doc…",             Icon: Plus, action: () => {} },
  { id: "act-meet",   group: "Create", label: "Schedule meeting…",    Icon: Plus, action: () => {} },
];

function fuzzy(q: string, label: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return label.toLowerCase().includes(ql);
}

export function OsCommandPalette() {
  const { paletteOpen, closePalette } = useOsShell();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const filtered = useMemo(() => {
    const items = STATIC_ITEMS.filter((it) => fuzzy(query, it.label));
    const grouped: Record<string, Item[]> = {};
    for (const it of items) (grouped[it.group] ||= []).push(it);
    return { items, grouped };
  }, [query]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(filtered.items.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered.items[active];
        if (!item) return;
        if (item.href) router.push(item.href);
        else item.action?.();
        closePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, filtered.items, active, router, closePalette]);

  if (!paletteOpen || !mounted) return null;

  // Flatten index to keep "active" in sync with grouped render
  let runningIndex = -1;

  return createPortal(
    <div
      className="os-cmdk-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="os-cmdk workwrk-os" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="os-cmdk__input">
          <Search />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search or run a command…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            autoComplete="off"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="os-cmdk__body">
          {filtered.items.length === 0 ? (
            <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--os-text-3)", fontSize: 13 }}>
              No matches.
            </div>
          ) : (
            Object.entries(filtered.grouped).map(([group, items]) => (
              <div key={group} className="os-cmdk__group">
                <div className="os-cmdk__group-title">{group}</div>
                {items.map((it) => {
                  runningIndex += 1;
                  const isActive = runningIndex === active;
                  const Icon = it.Icon;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`os-cmdk__item ${isActive ? "is-active" : ""}`}
                      onMouseEnter={() => setActive(runningIndex)}
                      onClick={() => {
                        if (it.href) router.push(it.href);
                        else it.action?.();
                        closePalette();
                      }}
                    >
                      <span className="os-cmdk__item-icon"><Icon /></span>
                      <span className="os-cmdk__item-label">{it.label}</span>
                      {it.meta ? <span className="os-cmdk__item-meta">{it.meta}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
