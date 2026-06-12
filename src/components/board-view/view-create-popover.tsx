"use client";

// ViewCreatePopover + NewViewTrigger — the "+ View" affordance on a
// Board detail page. Click → anchored panel:
//   1. Search/describe input (AI placeholder — filters the catalog today)
//   2. Popular grid (List / Gantt Chart / Calendar / Doc / Board / Form / Dashboard)
//   3. Full grid of supported ViewTypes
//   4. Embed section (Any website / Google Sheets / Docs / Calendar / Maps / YouTube / Figma)
//      — POSTs view with embed URL once supported; today stubbed via toast
//   5. Private view + Pin view checkboxes
//
// Calls POST /api/boards/[id]/views { name, type, isShared? } and on success
// router.refresh()es the board page so the new tab appears.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Search, Loader2, Sparkles,
  List as ListIcon, GanttChart, Calendar as CalIcon, FileText, LayoutGrid, ClipboardList,
  BarChart3, Table2, Brush, AlignLeft, Activity, GaugeCircle, Workflow, MapPin, Users as UsersIcon,
  Globe, FileSpreadsheet, FileType, FileImage, Grid3X3, ListTree, SquareStack,
} from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import { useOsToast } from "@/components/layout/os/toast";

interface ViewTile {
  type: ViewType;
  label: string;
  tag?: string;
  Icon: typeof ListIcon;
  swatch: string;
  /** Seed config saved on the view at creation (e.g. the Monday-style
   *  grid flag that distinguishes Table from List — both TABLE type). */
  config?: Record<string, unknown>;
}

const POPULAR: ViewTile[] = [
  { type: "TABLE",     label: "List",      tag: undefined,    Icon: ListIcon,      swatch: "#71717A" },
  { type: "GANTT",     label: "Gantt",     tag: "Chart",      Icon: GanttChart,    swatch: "#EF4444" },
  { type: "CALENDAR",  label: "Calendar",  tag: undefined,    Icon: CalIcon,       swatch: "#F97316" },
  { type: "DOC",       label: "Doc",       tag: "Wiki",       Icon: FileText,      swatch: "#3B82F6" },
  { type: "KANBAN",    label: "Board",     tag: "Kanban",     Icon: LayoutGrid,    swatch: "#3B82F6" },
  { type: "FORM",      label: "Form",      tag: "Survey",     Icon: ClipboardList, swatch: "#8B5CF6" },
  { type: "DASHBOARD", label: "Dashboard", tag: "Report",     Icon: BarChart3,     swatch: "#EC4899" },
];

// Every tile maps to its real ViewType now (Phase: views-catalog) —
// the old placeholders (Activity→CHART, Team→DASHBOARD) are gone.
// Team rides WORKLOAD with a config variant; Mind Map rides WHITEBOARD
// (the canvas covers it until a dedicated graph renderer exists).
const SECONDARY: ViewTile[] = [
  { type: "TABLE",        label: "Table",         tag: undefined, Icon: Table2,       swatch: "#10B981", config: { grid: "monday" } },
  { type: "CHART",        label: "Chart",         tag: "Report",  Icon: BarChart3,    swatch: "#F43F5E" },
  { type: "WHITEBOARD",   label: "Whiteboard",    tag: undefined, Icon: Brush,        swatch: "#FACC15" },
  { type: "TIMELINE",     label: "Timeline",      tag: undefined, Icon: AlignLeft,    swatch: "#F59E0B" },
  { type: "ACTIVITY",     label: "Activity",      tag: "Feed",    Icon: Activity,     swatch: "#0EA5E9" },
  { type: "WORKLOAD",     label: "Workload",      tag: "Capacity",Icon: GaugeCircle,  swatch: "#14B8A6" },
  { type: "WORKLOAD",     label: "Team",          tag: undefined, Icon: UsersIcon,    swatch: "#A855F7", config: { variant: "team" } },
  { type: "WHITEBOARD",   label: "Mind Map",      tag: undefined, Icon: Workflow,     swatch: "#EC4899" },
  { type: "MAP",          label: "Map",           tag: undefined, Icon: MapPin,       swatch: "#EA580C" },
  { type: "CARDS",        label: "Cards",         tag: "Gallery", Icon: SquareStack,  swatch: "#6366F1" },
  { type: "PIVOT",        label: "Pivot",         tag: undefined, Icon: Grid3X3,      swatch: "#059669" },
  { type: "HIERARCHY",    label: "Hierarchy",     tag: "Tree",    Icon: ListTree,     swatch: "#0D9488" },
  { type: "FILE_GALLERY", label: "File gallery",  tag: undefined, Icon: FileImage,    swatch: "#71717A" },
];

interface EmbedTile { key: string; label: string; Icon: typeof Globe; swatch: string }

const EMBEDS: EmbedTile[] = [
  { key: "website",  label: "Any website",     Icon: Globe,           swatch: "#71717A" },
  { key: "sheets",   label: "Google Sheets",   Icon: FileSpreadsheet, swatch: "#10B981" },
  { key: "docs",     label: "Google Docs",     Icon: FileType,        swatch: "#3B82F6" },
  { key: "gcal",     label: "Google Calendar", Icon: CalIcon,         swatch: "#F97316" },
  { key: "gmaps",    label: "Google Maps",     Icon: MapPin,          swatch: "#EA580C" },
  { key: "youtube",  label: "YouTube",         Icon: FileImage,       swatch: "#EF4444" },
  { key: "figma",    label: "Figma",           Icon: FileImage,       swatch: "#A855F7" },
];

interface Props {
  boardId: string;
}

export function NewViewTrigger({ boardId }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 px-2 py-2 text-sm transition-colors ${
          open ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"
        }`}
      >
        <Plus className="w-3.5 h-3.5" />
        View
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="absolute left-0 top-10 z-[80] w-[560px] max-w-[92vw]"
        >
          <ViewCreatePanel boardId={boardId} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </span>
  );
}

function ViewCreatePanel({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [query, setQuery] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pinView, setPinView] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const filter = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (label: string) => label.toLowerCase().includes(q);
  }, [query]);

  const create = async (tile: ViewTile) => {
    setBusy(tile.label);
    try {
      const res = await fetch(`/api/boards/${boardId}/views`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: tile.label,
          type: tile.type,
          ...(tile.config ? { config: tile.config } : {}),
          // ShareSpaceDialog-style semantics: isShared=true is public/shared.
          // The popover toggle is named "Private view" → invert.
          isShared: !isPrivate,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Could not create view");
        return;
      }
      if (pinView) {
        toast(`${tile.label} view added · pin coming soon`);
      } else {
        toast(`${tile.label} view added`);
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const stub = (label: string) => () => toast(`${label} embed coming soon`);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-2xl overflow-hidden">
      <div className="p-3 border-b border-zinc-100">
        <div className="relative">
          <Sparkles className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or describe a view to create"
            className="w-full h-9 pl-8 pr-9 rounded-md border border-zinc-200 bg-white text-[13px] focus:outline-none focus:border-zinc-400"
            autoFocus
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            aria-label="Submit"
            title="AI-create coming soon"
            onClick={() => toast("AI-create coming soon")}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-[440px] overflow-y-auto p-3 space-y-4">
        <Section label="Popular">
          <Grid>
            {POPULAR
              .filter((t) => !filter || filter(t.label))
              .map((t) => (
                <ViewTileButton key={`${t.type}-${t.label}`} tile={t} busy={busy === t.label} onClick={() => create(t)} />
              ))}
          </Grid>
        </Section>

        <Section label="">
          <Grid>
            {SECONDARY
              .filter((t) => !filter || filter(t.label))
              .map((t) => (
                <ViewTileButton key={`${t.type}-${t.label}`} tile={t} busy={busy === t.label} onClick={() => create(t)} />
              ))}
          </Grid>
        </Section>

        <Section label="Embed">
          <Grid>
            {EMBEDS
              .filter((e) => !filter || filter(e.label))
              .map((e) => (
                <EmbedTileButton key={e.key} tile={e} onClick={stub(e.label)} />
              ))}
          </Grid>
        </Section>
      </div>

      <div className="px-3 py-2 border-t border-zinc-100 flex items-center gap-4 text-[12px] text-zinc-700">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="h-3.5 w-3.5 accent-zinc-900"
          />
          Private view
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={pinView}
            onChange={(e) => setPinView(e.target.checked)}
            className="h-3.5 w-3.5 accent-zinc-900"
          />
          Pin view
        </label>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      {label ? (
        <div className="text-[10.5px] uppercase tracking-wide text-zinc-400 font-semibold mb-1.5">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}

function ViewTileButton({
  tile,
  busy,
  onClick,
}: {
  tile: ViewTile;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-zinc-50 text-left disabled:opacity-50"
    >
      <span
        className="h-6 w-6 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ backgroundColor: tile.swatch }}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <tile.Icon className="h-3 w-3" />}
      </span>
      <span className="text-[12.5px] text-zinc-900 truncate">
        <span className="font-medium">{tile.label}</span>
        {tile.tag ? <span className="ml-1 text-zinc-500 font-normal">{tile.tag}</span> : null}
      </span>
    </button>
  );
}

function EmbedTileButton({ tile, onClick }: { tile: EmbedTile; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-zinc-50 text-left"
    >
      <span
        className="h-6 w-6 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ backgroundColor: tile.swatch }}
      >
        <tile.Icon className="h-3 w-3" />
      </span>
      <span className="text-[12.5px] text-zinc-700 truncate">{tile.label}</span>
    </button>
  );
}
