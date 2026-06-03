// Home — ClickUp-style team view (rebuilt 2026-06-03).
//
// Matches the ClickUp screenshot exactly:
//   - Workspace title row with star + Ask AI + Share on the right
//   - View tabs: Chat · Board · Calendar · List (+ View)
//   - Filter row: Status pill + group + members + filter + check
//   - Body: empty state OR (eventually) the team's task list
//
// The personal-dashboard content (greeting, stat cards, kudos, etc.)
// that used to live here has been removed per the 2026-06-03 design
// pivot. If a personal dashboard is needed later it can live at a
// dedicated route (/me/dashboard).

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles, Share2, Star, Plus, Hash, LayoutGrid, Calendar as CalendarIcon,
  List as ListIcon, Filter, CheckCircle2, Users as UsersIcon, Search, Settings,
} from "lucide-react";
import { NewSpaceDialog } from "@/components/layout/os/new-space-dialog";

interface SpaceLite {
  id: string;
  slug: string;
  name: string;
}

const VIEW_TABS: Array<{ key: string; label: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = [
  { key: "chat",     label: "Chat",     Icon: Hash,         color: "text-zinc-600" },
  { key: "board",    label: "Board",    Icon: LayoutGrid,   color: "text-violet-500" },
  { key: "calendar", label: "Calendar", Icon: CalendarIcon, color: "text-orange-500" },
  { key: "list",     label: "List",     Icon: ListIcon,     color: "text-emerald-500" },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<string>("list");
  // Default to an empty array so the empty state renders immediately
  // on first paint; the actual list arrives async and replaces it.
  const [spaces, setSpaces] = useState<SpaceLite[]>([]);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);

  const reloadSpaces = useCallback(async () => {
    try {
      const res = await fetch("/api/spaces", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setSpaces(Array.isArray(data.spaces) ? data.spaces : []);
    } catch {}
  }, []);

  useEffect(() => {
    void reloadSpaces();
  }, [reloadSpaces]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header row: workspace name + Ask AI + Share */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-3">
        <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          Cashkr Team
        </h1>
        <div className="flex-1" />
        <button
          type="button"
          className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
        >
          <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--os-brand)" }} />
          Ask AI
        </button>
        <button
          type="button"
          className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share
        </button>
      </div>

      {/* View tabs */}
      <div className="px-6 border-b border-zinc-200 flex items-center gap-1">
        {VIEW_TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-zinc-900 text-zinc-900 font-medium"
                  : "border-transparent text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <t.Icon className={`w-3.5 h-3.5 ${active ? "text-zinc-900" : t.color}`} />
              {t.label}
            </button>
          );
        })}
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-2 text-sm text-zinc-500 hover:text-zinc-900"
        >
          <Plus className="w-3.5 h-3.5" />
          View
        </button>
      </div>

      {/* Filter row */}
      <div className="px-6 py-2 border-b border-zinc-100 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs"
          style={{
            background: "color-mix(in srgb, var(--os-brand) 14%, transparent)",
            color: "var(--os-brand-deep)",
          }}
        >
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--os-brand)" }} />
          Status
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Group">
          <UsersIcon className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Filter">
          <Filter className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Closed">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center -space-x-1.5">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 border-2 border-white" />
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 border-2 border-white" />
        </div>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Search">
          <Search className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500" aria-label="Settings">
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center px-6 py-8">
        {spaces.length === 0 ? (
          <EmptyState onCreate={() => setNewSpaceOpen(true)} />
        ) : (
          <SpaceList spaces={spaces} />
        )}
      </div>

      <NewSpaceDialog
        open={newSpaceOpen}
        onOpenChange={setNewSpaceOpen}
        onCreated={() => void reloadSpaces()}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-5 relative w-36 h-24">
        {/* Card-stack illustration — three rounded rectangles fanned */}
        <div className="absolute top-1 -left-3 w-32 h-20 rounded-xl border-2 border-zinc-200 bg-white -rotate-6 opacity-50" />
        <div className="absolute -top-1 left-3 w-32 h-20 rounded-xl border-2 border-zinc-200 bg-white rotate-6 opacity-70" />
        <div className="absolute top-0 left-0 w-32 h-20 rounded-xl border-2 border-zinc-200 bg-white">
          <div className="absolute inset-2 flex flex-col gap-1.5">
            <div className="h-1.5 rounded-full bg-zinc-200 w-3/4" />
            <div className="h-1.5 rounded-full bg-zinc-200 w-1/2" />
            <div className="h-1.5 rounded-full bg-zinc-200 w-2/3" />
          </div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white border-2 border-zinc-300 flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:border-zinc-500 transition-colors"
          aria-label="Create space"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <p className="text-sm text-zinc-700 max-w-[280px] mb-4 mt-3">
        You have no existing Spaces to put shared tasks in.<br />
        Create a Space now to organize your work.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="px-5 py-2.5 rounded-md text-white text-sm font-medium hover:opacity-90 transition-opacity"
        style={{ background: "var(--os-brand)" }}
      >
        Create new Space
      </button>
    </div>
  );
}

function SpaceList({ spaces }: { spaces: SpaceLite[] }) {
  return (
    <div className="w-full max-w-3xl">
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-3">Spaces</h3>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {spaces.map((s) => (
          <li key={s.id}>
            <Link
              href={`/spaces/${s.slug}`}
              className="block px-4 py-3 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="text-sm font-medium text-zinc-900 truncate">{s.name}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
