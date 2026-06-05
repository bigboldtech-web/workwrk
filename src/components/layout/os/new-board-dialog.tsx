"use client";

// NewBoardDialog — the ClickUp-style "View" picker modal married to a
// board-name field. The picker grid matches the 2026-06-02 screenshot:
// Popular section (16 tiles, 2-column grid), then Integrations section
// (embeds — placeholder for now), then footer with Private view + Pin
// view checkboxes.
//
// On submit, POSTs to /api/boards with name + defaultViewType, then
// optionally routes to the new board's page.
//
// View tiles map to schema ViewType enum values:
//   List → TABLE     Gantt → GANTT
//   Calendar → CALENDAR  Doc Wiki → DOC
//   Board → KANBAN   Form → FORM
//   Table → TABLE    Dashboard → DASHBOARD
//   Whiteboard → WHITEBOARD  Timeline → TIMELINE
//   Workload → WORKLOAD  Map → MAP
//   Activity Feed / Mind Map / Team / Create-with-AI → "Coming soon"
//
// Integrations row (Sheets/Docs/Calendar/Maps/YouTube/Figma/Any website)
// are placeholder buttons that don't create a board yet — Phase 3b will
// wire them as embeddable view types.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  List as ListIcon,
  GanttChart,
  Calendar as CalIcon,
  FileText,
  LayoutGrid,
  ClipboardList,
  BarChart3,
  Table2,
  Brush,
  AlignLeft,
  Activity as ActivityIcon,
  GaugeCircle,
  Network,
  Users as UsersIcon,
  MapPin,
  Globe,
  Sheet,
  CalendarRange,
  Play,
  Send,
} from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import { BloomMark } from "./bloom-mark";

// ── Tile definitions ──────────────────────────────────────────────

interface ViewTile {
  key: string;                     // unique id; used by state
  label: string;
  sublabel?: string;               // grey suffix in ClickUp style (e.g. "Wiki", "Survey")
  Icon: React.ComponentType<{ className?: string }>;
  /** ViewType this maps to — null = "Coming soon" placeholder. */
  viewType: ViewType | null;
  hue: string;                     // bg tint for the icon chip
}

const POPULAR_TILES: ViewTile[] = [
  { key: "list",        label: "List",                            Icon: ListIcon,        viewType: "TABLE",      hue: "#3ab39e" },
  { key: "gantt",       label: "Gantt", sublabel: "Chart",        Icon: GanttChart,      viewType: "GANTT",      hue: "#22c55e" },
  { key: "calendar",    label: "Calendar",                        Icon: CalIcon,         viewType: "CALENDAR",   hue: "#f59e0b" },
  { key: "doc",         label: "Doc", sublabel: "Wiki",           Icon: FileText,        viewType: "DOC",        hue: "#3b82f6" },
  { key: "board",       label: "Board", sublabel: "Kanban",       Icon: LayoutGrid,      viewType: "KANBAN",     hue: "#7c3aed" },
  { key: "form",        label: "Form", sublabel: "Survey",        Icon: ClipboardList,   viewType: "FORM",       hue: "#a855f7" },
  { key: "ai",          label: "Create with AI",                  Icon: BloomMark,       viewType: null,         hue: "#ec4899" },
  { key: "dashboard",   label: "Dashboard", sublabel: "Report",   Icon: BarChart3,       viewType: "DASHBOARD",  hue: "#6366f1" },
  { key: "table",       label: "Table",                           Icon: Table2,          viewType: "TABLE",      hue: "#14b8a6" },
  { key: "whiteboard",  label: "Whiteboard",                      Icon: Brush,           viewType: "WHITEBOARD", hue: "#22d3ee" },
  { key: "timeline",    label: "Timeline",                        Icon: AlignLeft,       viewType: "TIMELINE",   hue: "#8b5cf6" },
  { key: "activity",    label: "Activity", sublabel: "Feed",      Icon: ActivityIcon,    viewType: null,         hue: "#a78b6c" },
  { key: "workload",    label: "Workload", sublabel: "Capacity",  Icon: GaugeCircle,     viewType: "WORKLOAD",   hue: "#0ea5e9" },
  { key: "mindmap",     label: "Mind Map",                        Icon: Network,         viewType: null,         hue: "#10b981" },
  { key: "team",        label: "Team",                            Icon: UsersIcon,       viewType: null,         hue: "#f43f5e" },
  { key: "map",         label: "Map",                             Icon: MapPin,          viewType: "MAP",        hue: "#ef4444" },
];

const INTEGRATION_TILES: ViewTile[] = [
  { key: "embed-any",       label: "Any website",     Icon: Globe,         viewType: null, hue: "#64748b" },
  { key: "embed-sheets",    label: "Google Sheets",   Icon: Sheet,         viewType: null, hue: "#16a34a" },
  { key: "embed-docs",      label: "Google Docs",     Icon: FileText,      viewType: null, hue: "#2563eb" },
  { key: "embed-calendar",  label: "Google Calendar", Icon: CalendarRange, viewType: null, hue: "#f59e0b" },
  { key: "embed-maps",      label: "Google Maps",     Icon: MapPin,        viewType: null, hue: "#10b981" },
  { key: "embed-youtube",   label: "YouTube",         Icon: Play,          viewType: null, hue: "#ef4444" },
  { key: "embed-figma",     label: "Figma",           Icon: Brush,         viewType: null, hue: "#a855f7" },
];

// ── Component ──────────────────────────────────────────────────────

interface BoardLike {
  id: string;
  slug: string;
  name: string;
  defaultViewType: ViewType;
}

export function NewBoardDialog({
  open,
  onOpenChange,
  spaceId,
  folderId,
  onCreated,
  redirectOnCreate = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  folderId?: string | null;
  onCreated?: (b: BoardLike) => void;
  redirectOnCreate?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedTile, setSelectedTile] = useState<string>("list");
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { popular: POPULAR_TILES, integrations: INTEGRATION_TILES };
    const match = (t: ViewTile) =>
      t.label.toLowerCase().includes(q) || (t.sublabel?.toLowerCase().includes(q) ?? false);
    return {
      popular: POPULAR_TILES.filter(match),
      integrations: INTEGRATION_TILES.filter(match),
    };
  }, [query]);

  const reset = () => {
    setName("");
    setQuery("");
    setSelectedTile("list");
    setIsPrivate(false);
    setError(null);
    setSubmitting(false);
  };

  const handle = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Board name is required");
      return;
    }
    const tile = [...POPULAR_TILES, ...INTEGRATION_TILES].find((t) => t.key === selectedTile);
    if (!tile) {
      setError("Pick a view type to continue");
      return;
    }
    if (tile.viewType === null) {
      setError(`"${tile.label}" is coming soon — pick a different view to create the board.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          folderId: folderId ?? null,
          name: trimmedName,
          defaultViewType: tile.viewType,
          visibility: isPrivate ? "PRIVATE" : "WORKSPACE",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to create board");
        setSubmitting(false);
        return;
      }
      const board = data.board as BoardLike;
      onCreated?.(board);
      handle(false);
      if (redirectOnCreate) router.push(`/boards/${board.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create board");
      setSubmitting(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={handle}>
      <DialogContent className="max-w-[560px] p-0">
        <div className="px-5 pt-5 pb-2">
          <DialogTitle className="text-base font-semibold">New Board</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500 mt-1">
            Name your Board and pick how it should open.
          </DialogDescription>
        </div>

        <div className="px-5 pb-3">
          <label className="text-xs font-medium block mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Onboarding tasks, Sprint board, Customer feedback"
            className="w-full h-9 px-3 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:border-[var(--os-brand)]"
            autoFocus
          />
        </div>

        <div className="px-5 pb-2">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or describe a view to create"
              className="w-full h-9 px-3 pr-9 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:border-[var(--os-brand)]"
            />
            <button
              type="button"
              className="absolute right-1.5 top-1.5 inline-flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-zinc-900"
              aria-label="Search views"
              tabIndex={-1}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="px-3 pb-3 max-h-[55vh] overflow-y-auto">
          {tiles.popular.length > 0 ? (
            <>
              <div className="text-xs text-zinc-500 px-3 pt-2 pb-1">Popular</div>
              <TileGrid tiles={tiles.popular} selectedKey={selectedTile} onPick={setSelectedTile} />
            </>
          ) : null}
          {tiles.integrations.length > 0 ? (
            <>
              <div className="text-xs text-zinc-500 px-3 pt-3 pb-1">Embed an integration</div>
              <TileGrid tiles={tiles.integrations} selectedKey={selectedTile} onPick={setSelectedTile} />
            </>
          ) : null}
          {tiles.popular.length + tiles.integrations.length === 0 ? (
            <div className="px-3 py-6 text-sm text-zinc-500 text-center">
              No views match &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex items-center justify-between gap-3">
          <label className="flex-1 cursor-pointer" onClick={() => setIsPrivate(!isPrivate)}>
            <div className="text-[13px] font-medium text-zinc-900">Make Private</div>
            <div className="text-[11.5px] text-zinc-500 leading-snug">
              Tighter than the Space — only board members + the Space owner can read.
            </div>
          </label>
          <span
            role="switch"
            aria-checked={isPrivate}
            tabIndex={0}
            onClick={() => setIsPrivate((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                setIsPrivate((v) => !v);
              }
            }}
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${
              isPrivate ? "bg-zinc-900" : "bg-zinc-200"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                isPrivate ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </span>
        </div>

        {error ? <div className="px-5 py-2 text-xs text-red-500 bg-red-500/10">{error}</div> : null}

        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-zinc-200">
          <button type="button" onClick={() => handle(false)} className="text-sm text-zinc-500 hover:text-zinc-900 px-3 py-2" disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Board"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TileGrid({
  tiles,
  selectedKey,
  onPick,
}: {
  tiles: ViewTile[];
  selectedKey: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {tiles.map((t) => {
        const active = selectedKey === t.key;
        const disabled = t.viewType === null;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(t.key)}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
              active
                ? "bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)]"
                : "hover:bg-zinc-50"
            }`}
          >
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded"
              style={{ background: `${t.hue}22`, color: t.hue }}
            >
              <t.Icon className="w-4 h-4" />
            </span>
            <span className="text-sm flex items-baseline gap-1.5">
              {t.label}
              {t.sublabel ? <span className="text-xs text-zinc-500">{t.sublabel}</span> : null}
              {disabled ? <span className="text-[10px] uppercase tracking-wide text-zinc-500">Soon</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
