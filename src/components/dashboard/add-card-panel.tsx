"use client";

// AddCardPanel — ClickUp's "Add Card" gallery chrome (left category rail +
// searchable preview-tile grid). Task List / Calculation / Notes tiles add
// a live widget via onAdd; the rest toast until their widget types land.

import { useState } from "react";
import {
  Plus, Star, SlidersHorizontal, Zap, CircleDot, Tag, Users, Flag, Timer,
  Table, AppWindow, Search, X, type LucideIcon,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import type { WidgetPreset, WidgetType } from "@/components/dashboard/widget-types";

const CATEGORIES: Array<{ key: string; label: string; icon: LucideIcon }> = [
  { key: "featured",  label: "Featured",        icon: Star },
  { key: "custom",    label: "Custom",          icon: SlidersHorizontal },
  { key: "sprints",   label: "Sprints",         icon: Zap },
  { key: "statuses",  label: "Statuses",        icon: CircleDot },
  { key: "tags",      label: "Tags",            icon: Tag },
  { key: "assignees", label: "Assignees",       icon: Users },
  { key: "priorities",label: "Priorities",      icon: Flag },
  { key: "time",      label: "Time Tracking",   icon: Timer },
  { key: "tables",    label: "Tables",          icon: Table },
  { key: "embeds",    label: "Embeds and Apps", icon: AppWindow },
];

// ClickUp's real Featured card copy; flat single-accent preview tints only.
// Tints deliberately stay light in dark mode (preview-image look, matching
// ClickUp) — bg-slate-50 instead of bg-zinc-50 so the dark catchalls skip it.
// `widget` maps a tile to the DashWidget type it creates (with an optional
// title/config preset); tiles without a mapping stay honest (toast) until
// their widget renderer ships in a later wave.
const FEATURED: Array<{ name: string; desc: string; tint: string; widget?: WidgetType; preset?: WidgetPreset }> = [
  { name: "Task List",          desc: "Create a List view using tasks from any location.", tint: "bg-slate-50", widget: "task-list" },
  { name: "Workload by Status", desc: "Display the distribution of your statuses usage across locations.", tint: "bg-sky-50", widget: "battery" },
  { name: "Calculation",        desc: "Calculate sums, averages, and so much more for your tasks.", tint: "bg-amber-50", widget: "stat" },
  { name: "Time Reporting",     desc: "See tasks that have time tracked.", tint: "bg-emerald-50" },
  { name: "Portfolio",          desc: "Categorize and track progress of Lists & Folders.", tint: "bg-slate-50" },
  {
    name: "Tasks by Assignee",
    desc: "See open tasks grouped by each assignee.",
    tint: "bg-sky-50",
    widget: "chart",
    preset: { title: "Tasks by Assignee", config: { chartBy: "assignee", chartKind: "bar" } },
  },
  { name: "Notes",              desc: "Jot down quick notes right on your dashboard.", tint: "bg-amber-50", widget: "notes" },
  { name: "Discussion",         desc: "Start a conversation with your team.", tint: "bg-emerald-50" },
];

export function AddCardPanel({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  /** Adds a widget of the given type to the dashboard. Absent = all tiles toast. */
  onAdd?: (type: WidgetType, preset?: WidgetPreset) => void;
}) {
  const [category, setCategory] = useState("featured");
  const [query, setQuery] = useState("");
  const { toast } = useOsToast();

  if (!open) return null;

  const activeLabel = CATEGORIES.find((c) => c.key === category)?.label ?? "Featured";
  const tiles = FEATURED.filter(
    (t) => !query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} aria-hidden />
      <div className="relative flex h-[560px] w-[880px] max-w-[calc(100vw-48px)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
        {/* Left category rail */}
        <div className="flex w-56 shrink-0 flex-col border-r border-zinc-100 p-2">
          <div className="flex h-8 items-center gap-2 px-2">
            <span className="grid h-5 w-5 place-items-center rounded-md border border-zinc-200">
              <Plus className="h-3 w-3 text-zinc-600" />
            </span>
            <span className="text-[13px] font-semibold text-zinc-900">Add Card</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors ${
                  category === c.key ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <c.icon className="h-3.5 w-3.5 text-zinc-500" />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-100 px-4">
            <span className="text-[13px] font-semibold text-zinc-900">{activeLabel}</span>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="h-7 w-52 rounded-md border border-zinc-200 bg-white pl-7 pr-2 text-[12.5px] outline-none focus:border-zinc-300"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="mb-3 text-[15px] font-semibold text-zinc-900">{activeLabel}</h3>
            {tiles.length === 0 ? (
              <p className="text-[12.5px] text-zinc-500">No cards match &ldquo;{query}&rdquo;.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {tiles.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      if (t.widget && onAdd) {
                        onAdd(t.widget, t.preset);
                        onClose();
                      } else {
                        toast("Coming with a later wave");
                      }
                    }}
                    className="group rounded-lg border border-zinc-200 bg-white text-left transition-colors hover:border-zinc-300 hover:shadow-sm"
                  >
                    <div className={`h-28 rounded-t-lg border-b border-zinc-100 ${t.tint}`} />
                    <div className="p-3">
                      <div className="text-[13px] font-semibold text-zinc-900">{t.name}</div>
                      <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
