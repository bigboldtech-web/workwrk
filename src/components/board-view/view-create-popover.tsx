"use client";

// ViewCreatePopover + NewViewTrigger: the "+ View" affordance on a
// Board detail page. Click opens an anchored panel:
//   1. Search/describe input (AI placeholder; filters the catalog today)
//   2. Popular grid (List / Gantt Chart / Calendar / Doc / Board / Form / Dashboard)
//   3. Full grid of supported ViewTypes
//   4. Embed section (Any website / Google Sheets / Docs / Calendar / Maps / YouTube / Figma)
//      (POSTs view with embed URL once supported; today stubbed via toast)
//   5. Private view + Pin view checkboxes
//
// Calls POST /api/boards/[id]/views { name, type, isShared? } and on success
// router.refresh()es the board page so the new tab appears.
//
// The panel is PORTALLED (MorePortal, position: fixed) rather than rendered
// absolutely inside the tab strip: ViewTabStrip is `overflow-x-auto`, which
// forces overflow-y to auto as well, so an in-strip panel was clipped to the
// strip's 36px and the whole catalogue rendered invisibly ("I cannot add
// views"). The tab context menu already escapes the strip the same way.

import { Dots } from "@/components/ui/dots";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Sparkles,
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
  Activity,
  GaugeCircle,
  MapPin,
  Users as UsersIcon,
  Globe,
  FileSpreadsheet,
  FileType,
  FileImage,
  Grid3X3,
  ListTree,
  SquareStack,
} from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import { useOsToast } from "@/components/layout/os/toast";
import { MorePortal } from "@/components/layout/os/more-portal";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";

interface ViewTile {
  type: ViewType;
  label: string;
  tag?: string;
  Icon: typeof ListIcon;
  swatch: string;
  /** Seed config saved on the view at creation (e.g. the Monday-style
   *  grid flag that distinguishes Table from List, both TABLE type). */
  config?: Record<string, unknown>;
}

const POPULAR: ViewTile[] = [
  { type: "TABLE",     label: "List",      tag: undefined,    Icon: ListIcon,      swatch: "#71717A" },
  { type: "GANTT",     label: "Gantt",     tag: "Chart",      Icon: GanttChart,    swatch: "#EF4444" },
  { type: "CALENDAR",  label: "Calendar",  tag: undefined,    Icon: CalIcon,       swatch: "#F97316" },
  { type: "DOC",       label: "Doc",       tag: "Wiki",       Icon: FileText,      swatch: "#3B82F6" },
  { type: "KANBAN",    label: "Board",     tag: "Kanban",     Icon: LayoutGrid,    swatch: "#3B82F6" },
  { type: "FORM",      label: "Form",      tag: "Survey",     Icon: ClipboardList, swatch: "#7F5347" },
  { type: "DASHBOARD", label: "Dashboard", tag: "Report",     Icon: BarChart3,     swatch: "#EC4899" },
];

// Every tile maps to its real ViewType now (Phase: views-catalog):
// the old placeholders (Activity→CHART, Team→DASHBOARD) are gone.
// Team rides WORKLOAD with a config variant. There is ONE Canvas tile: the
// "Mind Map" tile beside it created the very same WHITEBOARD view with the
// very same renderer, so it was two names and two swatches for one thing,
// which naming-canon 2.6 collapses to Canvas. It comes back the day a real
// graph renderer exists to sit behind it.
// Order mirrors ClickUp's "+ View" panel; our extra views (Pivot / Hierarchy /
// File gallery) trail at the end. Colors match ClickUp's per-view palette.
const SECONDARY: ViewTile[] = [
  { type: "TABLE",        label: "Table",         tag: undefined, Icon: Table2,       swatch: "#10B981", config: { grid: "monday" } },
  { type: "WHITEBOARD",   label: "Canvas",    tag: undefined, Icon: Brush,        swatch: "#FACC15" },
  { type: "ACTIVITY",     label: "Activity",      tag: "Feed",    Icon: Activity,     swatch: "#0EA5E9" },
  { type: "WORKLOAD",     label: "Workload",      tag: "Capacity",Icon: GaugeCircle,  swatch: "#14B8A6" },
  { type: "WORKLOAD",     label: "Team",          tag: undefined, Icon: UsersIcon,    swatch: "#00C875", config: { variant: "team" } },
  { type: "MAP",          label: "Map",           tag: undefined, Icon: MapPin,       swatch: "#EA580C" },
  { type: "CHART",        label: "Chart",         tag: "Report",  Icon: BarChart3,    swatch: "#F43F5E" },
  { type: "TIMELINE",     label: "Timeline",      tag: undefined, Icon: AlignLeft,    swatch: "#F59E0B" },
  { type: "CARDS",        label: "Cards",         tag: "Gallery", Icon: SquareStack,  swatch: "#0891B2" },
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
  { key: "figma",    label: "Figma",           Icon: FileImage,       swatch: "#71717A" },
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
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`os-chrome inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-row transition-colors ${
          open ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
        }`}
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        View
      </button>

      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={560} open={open} placement="below">
        <ViewCreatePanel boardId={boardId} onClose={() => setOpen(false)} />
      </MorePortal>
    </>
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
      toast(`${tile.label} view added`);
      onClose();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };


  return (
    <div role="dialog" aria-label="Add a view" className="max-w-[92vw] overflow-hidden rounded-xl border border-line bg-raised text-ink shadow-[var(--os-shadow-pop)]">
      <div className="border-b border-line-soft p-3">
        <div className="relative">
          <Sparkles className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search views"
            aria-label="Search views"
            className="h-9 w-full rounded-md border border-line-strong bg-raised pe-3 ps-8 text-base text-ink placeholder:text-ink-3 focus:outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            autoFocus
          />
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

        <UpcomingOnly>
          <Section label="Embed">
            <div className="px-1">
              {EMBEDS
                .filter((e) => !filter || filter(e.label))
                .map((e) => <ComingSoonRow key={e.key} label={e.label} />)}
            </div>
          </Section>
        </UpcomingOnly>
      </div>

      <div className="flex items-center gap-4 border-t border-line-soft px-3 py-2 text-sm text-ink-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--os-brand)]"
          />
          Private view
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={pinView}
            onChange={(e) => setPinView(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--os-brand)]"
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
        <div className="mb-1.5 text-micro uppercase tracking-[0.06em] text-ink-2">
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
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-hover disabled:opacity-50"
    >
      <span
        className="h-7 w-7 rounded-[8px] flex items-center justify-center text-white shrink-0"
        style={{ backgroundColor: tile.swatch }}
      >
        {busy ? <Dots variant="pending" /> : <tile.Icon className="h-3.5 w-3.5" />}
      </span>
      <span className="truncate text-base text-ink">
        <span className="font-medium">{tile.label}</span>
        {tile.tag ? <span className="ms-1 font-normal text-ink-2">{tile.tag}</span> : null}
      </span>
    </button>
  );
}

