"use client";

// OsCommandPalette — enhanced search modal modeled after ClickUp's
// "Brain" reference (2026-06-03 screenshot).
//
// Layout top → bottom:
//   header:  big search input + Ask-AI chip (opens the Sidekick panel)
//   sources: All / WorkwrK / Gmail / Drive / SharePoint / Apps
//   filters: Tasks / Docs / People / Commands / Actions + Filter + Sort
//   body:    a flat ranked feed. When the query is empty we show real
//            recents (recently-opened apps) + wired quick actions + the
//            navigation + command shortcuts. When typing, live results
//            from /api/search (the real Item/Board/Space/Folder/Doc graph)
//            lead, followed by the discovery rows filtered by query.
//   footer:  ←/→ navigate hint + Tab additional actions + settings
//
// There is NO mock/demo data here anymore: every row resolves to a real
// route or fires a real shell action. Entity results come live from the
// server; the empty state is built from the user's own recents + actions.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Home,
  CheckSquare,
  CalendarDays,
  Users2,
  BarChart3,
  Sparkles,
  Store,
  Settings,
  Inbox,
  Target,
  FileText,
  Mail,
  HardDrive,
  Filter,
  ArrowUpDown,
  CornerDownLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink as ExternalLinkIcon,
  Megaphone,
  Clock,
  Video,
  FileSpreadsheet,
  MoreHorizontal,
  Activity,
  Terminal,
  Notebook,
  Hash,
  PenTool,
  Layers,
  Folder,
  Check,
  type LucideIcon,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { AskAiButton } from "./ask-ai-button";
import { APPS, type AppEntry } from "./apps-catalog";

/* ─── Item kinds: each row in the palette is one of these ─── */

type BaseItem = {
  id: string;
  label: string;
  href?: string;
  action?: () => void;
};

type TaskItem = BaseItem & {
  kind: "task";
  status: "todo" | "in_progress" | "done" | "blocked";
  due?: string;
  assignee: { name: string; color: string };
};

type DocItem = BaseItem & {
  kind: "doc";
  type: "doc" | "spreadsheet" | "whiteboard";
  editedAt: string;
  editor?: string;
};

type PersonItem = BaseItem & {
  kind: "person";
  role: string;
  isAgent?: boolean;
  initials: string;
  color: string;
};

type SpaceItem = BaseItem & {
  kind: "space";
  Icon: LucideIcon;
  color: string;
  members: number;
};

type ActionItem = BaseItem & {
  kind: "action";
  Icon: LucideIcon;
  color: string;
  shortcut?: string;
  hint?: string;
};

type NavItem = BaseItem & {
  kind: "navigate";
  Icon: LucideIcon;
  color: string;
  shortcut?: string;
};

/** Commands are app-wide navigation ops with a memorable keyword alias
 *  (the "shortcut" — e.g. `mw` opens My Work). They mirror the ClickUp
 *  omnibox commands list. */
type CommandItem = BaseItem & {
  kind: "command";
  Icon: LucideIcon;
  alias?: string;
};

type Item = TaskItem | DocItem | PersonItem | SpaceItem | ActionItem | NavItem | CommandItem;

/* ─── Static discovery rows (all resolve to real routes) ─── */

const NAVIGATE: NavItem[] = [
  { kind: "navigate", id: "n-today",  label: "Today",       Icon: Home,         color: "var(--os-c-orange)", href: "/today",   shortcut: "G T" },
  { kind: "navigate", id: "n-inbox",  label: "Inbox",       Icon: Inbox,        color: "var(--os-c-blue)",   href: "/inbox",   shortcut: "G I" },
  { kind: "navigate", id: "n-tasks",  label: "My tasks",    Icon: CheckSquare,  color: "var(--os-brand)",    href: "/tasks",   shortcut: "G K" },
  { kind: "navigate", id: "n-meet",   label: "Planner",     Icon: CalendarDays, color: "var(--os-c-orange)", href: "/planner", shortcut: "G M" },
  { kind: "navigate", id: "n-okrs",   label: "Goals",       Icon: Target,       color: "var(--os-c-blue)",   href: "/okrs" },
  { kind: "navigate", id: "n-store",  label: "Marketplace", Icon: Store,        color: "var(--os-c-blue)",   href: "/store" },
  { kind: "navigate", id: "n-set",    label: "Settings",    Icon: Settings,     color: "var(--os-c-brown)",  href: "/settings" },
];

/** Commands — nav shortcuts with a keyword alias users can type. Every
 *  entry has a real href (routes verified to exist). */
const COMMANDS: CommandItem[] = [
  { kind: "command", id: "cmd-planner",    label: "Open Planner",       Icon: CalendarDays, alias: "calendar", href: "/planner" },
  { kind: "command", id: "cmd-priorities", label: "Open My Priorities", Icon: Target,       alias: "pri",      href: "/today" },
  { kind: "command", id: "cmd-mywork",     label: "Open My Work",       Icon: CheckSquare,  alias: "mw",       href: "/tasks" },
  { kind: "command", id: "cmd-activity",   label: "Open My Activity",   Icon: Activity,     alias: "act",      href: "/dashboard" },
  { kind: "command", id: "cmd-inbox",      label: "Go to Inbox",        Icon: Inbox,        alias: "inb",      href: "/inbox" },
  { kind: "command", id: "cmd-docs",       label: "Go to Docs home",    Icon: FileText,     alias: "docs",     href: "/docs" },
  { kind: "command", id: "cmd-goals",      label: "Go to Goals",        Icon: Target,       alias: "goals",    href: "/okrs" },
  { kind: "command", id: "cmd-time",       label: "Go to Timesheets",   Icon: Clock,        alias: "ts",       href: "/timesheets" },
  { kind: "command", id: "cmd-connect",    label: "Connect apps",       Icon: Store,        alias: "conn",     href: "/integrations" },
];

/* ─── Top-level filters (source tabs + type chips) ─── */

const SOURCES: Array<{
  key: string;
  label: string;
  Icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tint?: string;
  connectable?: boolean;
}> = [
  { key: "all",         label: "All" },
  { key: "workwrk",     label: "WorkwrK",      Icon: Sparkles, tint: "var(--os-brand)" },
  { key: "gmail",       label: "Gmail",        Icon: Mail,     tint: "#EA4335", connectable: true },
  { key: "drive",       label: "Google Drive", Icon: HardDrive,tint: "#34A853", connectable: true },
  { key: "sharepoint",  label: "SharePoint",   Icon: FileText, tint: "#0078D4", connectable: true },
  { key: "apps",        label: "Apps",         Icon: Store,    tint: "#F97316" },
];

/** Type filter chip. Each defines its own predicate. Only kinds the
 *  palette actually produces get a chip; structural results (boards /
 *  spaces / folders) render inline but aren't separately filterable. */
const TYPE_FILTERS: Array<{
  key: string;
  label: string;
  Icon: LucideIcon;
  primary?: boolean;
  predicate: (it: Item) => boolean;
}> = [
  { key: "task",    label: "Tasks",    Icon: CheckSquare, primary: true, predicate: (i) => i.kind === "task" },
  { key: "doc",     label: "Docs",     Icon: FileText,    primary: true, predicate: (i) => i.kind === "doc" },
  { key: "person",  label: "People",   Icon: Users2,      primary: true, predicate: (i) => i.kind === "person" },
  { key: "command", label: "Commands", Icon: Terminal,    primary: true, predicate: (i) => i.kind === "command" },
  { key: "action",  label: "Actions",  Icon: Sparkles,                   predicate: (i) => i.kind === "action" },
];

/** Filter dropdown options. Predicate-based against the live/discovery
 *  set; kept honest (no hardcoded "me"). */
const FILTERS: Array<{ key: string; label: string; predicate?: (it: Item) => boolean }> = [
  { key: "any",    label: "Any" },
  { key: "active", label: "Active tasks only", predicate: (i) => i.kind === "task" && (i as TaskItem).status !== "done" },
  { key: "docs",   label: "Documents",         predicate: (i) => i.kind === "doc" },
];

/** Sort dropdown options. Default is "modified" which preserves the
 *  server + discovery order (most-relevant-feeling first). */
const SORTS: Array<{ key: string; label: string; sorter?: (a: Item, b: Item) => number }> = [
  { key: "modified", label: "Modified date (recent)" },
  { key: "created",  label: "Created date" },
  { key: "alpha",    label: "Name A → Z", sorter: (a, b) => a.label.localeCompare(b.label) },
  { key: "alpha-z",  label: "Name Z → A", sorter: (a, b) => b.label.localeCompare(a.label) },
];

const STATUS_TONE: Record<TaskItem["status"], { dot: string; label: string }> = {
  todo:        { dot: "#A1A1AA",          label: "To do" },
  in_progress: { dot: "var(--os-c-blue)", label: "In progress" },
  done:        { dot: "var(--os-c-green)",label: "Done" },
  blocked:     { dot: "var(--os-c-red)",  label: "Blocked" },
};

const DOC_TYPE_ICON: Record<DocItem["type"], LucideIcon> = {
  doc: FileText,
  spreadsheet: FileSpreadsheet,
  whiteboard: BarChart3,
};

/** Per-type icon for live results that render as a generic navigation row
 *  (boards, spaces, folders, whiteboards, and the org/alignment surfaces). */
const NAV_ICON: Record<string, LucideIcon> = {
  board: Layers,
  space: Hash,
  folder: Folder,
  whiteboard: PenTool,
  department: Users2,
  meeting: CalendarDays,
  okr: Target,
  idea: Sparkles,
  policy: FileText,
  announcement: Megaphone,
};

/** App-key → catalog entry, for turning the shell's recent-app list into
 *  real navigation rows in the empty state. */
const APP_BY_KEY = new Map<string, AppEntry>(APPS.map((a) => [a.key, a]));

type ServerHit = { type: string; id: string; title: string; subtitle?: string; href?: string };

/* ─── Component ─── */

export function OsCommandPalette() {
  const { paletteOpen, closePalette, openSidekick, openCreateTask, recentAppKeys } = useOsShell();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sourceKey, setSourceKey] = useState<string>("all");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [filterKey, setFilterKey] = useState<string>("any");
  const [sortKey, setSortKey] = useState<string>("modified");
  const [moreOpen, setMoreOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  // Quick doc — mirrors ClickTopbar.createQuickDoc so the palette action
  // and the top-bar icon behave identically.
  const createQuickDoc = useCallback(async () => {
    try {
      const res = await fetch("/api/docs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled doc", content: { type: "doc", content: [{ type: "paragraph" }] } }),
      });
      if (!res.ok) return;
      const d = await res.json();
      if (d?.doc?.id) router.push(`/docs/${d.doc.id}`);
    } catch { /* transient — ignore */ }
  }, [router]);

  // Wired quick actions — each fires a real shell action or navigates to a
  // real route (no more decorative rows that just close the palette).
  const quickActions = useMemo<ActionItem[]>(() => [
    { kind: "action", id: "qa-task",     label: "Create task",         Icon: CheckSquare, color: "var(--os-c-green)",  hint: "Quick capture", action: () => openCreateTask() },
    { kind: "action", id: "qa-doc",      label: "New doc",             Icon: FileText,    color: "var(--os-c-teal)",   action: () => void createQuickDoc() },
    { kind: "action", id: "qa-note",     label: "New notepad",         Icon: Notebook,    color: "var(--os-brand)",    action: () => window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "notepad" })) },
    { kind: "action", id: "qa-reminder", label: "Set a reminder",      Icon: Clock,       color: "var(--os-c-orange)", action: () => window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "reminder" })) },
    { kind: "action", id: "qa-clip",     label: "Open AI Notetaker",   Icon: Video,       color: "var(--os-c-red)",    href: "/notetaker" },
    { kind: "action", id: "qa-announce", label: "Post an announcement",Icon: Megaphone,   color: "var(--os-c-red)",    href: "/announcements" },
    { kind: "action", id: "qa-time",     label: "Open Timesheets",     Icon: Clock,       color: "var(--os-c-blue)",   href: "/timesheets" },
  ], [openCreateTask, createQuickDoc]);

  // Real recents — the user's recently-opened apps, mapped to nav rows.
  const recents = useMemo<NavItem[]>(() => {
    return recentAppKeys
      .map((k) => APP_BY_KEY.get(k))
      .filter((a): a is AppEntry => !!a)
      .slice(0, 5)
      .map((a) => ({
        kind: "navigate" as const,
        id: `recent-${a.key}`,
        label: a.label,
        href: a.defaultHref,
        Icon: a.Icon as LucideIcon,
        color: "var(--os-ink-2)",
      }));
  }, [recentAppKeys]);

  const emptyBase = useMemo<Item[]>(
    () => [...recents, ...quickActions, ...NAVIGATE, ...COMMANDS],
    [recents, quickActions],
  );

  // Live results from /api/search — debounced fetch on query change.
  // Server hits are mapped into Item shapes so they slot into the existing
  // flatItems / keyboard-nav / sectioned-render machinery unchanged.
  const [live, setLive] = useState<Item[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setLive([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const d = await res.json();
        // /api/search returns a BARE array (jsonSuccess(results)), not a
        // {data:[...]} envelope — reading d.data alone left every query
        // empty, so live entity search silently returned nothing.
        const hits = (Array.isArray(d) ? d : d?.data ?? []) as ServerHit[];
        setLive(hits.map((h): Item | null => {
          if (h.type === "note" || h.type === "sop") {
            return { kind: "doc", id: `live-${h.type}-${h.id}`, label: h.title, href: h.href, type: "doc", editedAt: h.type === "sop" ? (h.subtitle ?? "SOP") : (h.subtitle ?? "") } as DocItem;
          }
          if (h.type === "item" || h.type === "task") {
            return { kind: "task", id: `live-${h.type}-${h.id}`, label: h.title, href: h.href, status: "todo", due: h.subtitle, assignee: { name: "", color: "var(--os-c-blue)" } } as TaskItem;
          }
          if (h.type === "person") {
            const initials = h.title.split(" ").map((s) => s[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
            return { kind: "person", id: `live-person-${h.id}`, label: h.title, href: h.href, role: h.subtitle ?? "", initials, color: "var(--os-c-blue)" } as PersonItem;
          }
          // Boards / spaces / folders / whiteboards / org surfaces → a
          // navigation row with a per-type icon.
          return h.href
            ? { kind: "navigate", id: `live-${h.type}-${h.id}`, label: h.title, href: h.href, Icon: NAV_ICON[h.type] ?? Search, color: "var(--os-ink-2)" } as NavItem
            : null;
        }).filter((x): x is Item => !!x));
      } catch { /* abort or transient — ignore */ }
    }, 180);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [query]);

  useEffect(() => setMounted(true), []);

  const toggleType = (key: string) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* Visible flat list. Three stacked filters:
   *   1. query — substring match on label OR (for commands) on alias
   *   2. type chips — predicate-OR
   *   3. Filter dropdown — single active predicate
   * Then `sortKey` reorders the result. When searching, live server
   * results lead and the discovery rows follow (filtered by query). When
   * empty, the emptyBase (recents + actions + nav + commands) shows.
   */
  const flatItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeTypes = TYPE_FILTERS.filter((f) => typeFilters.has(f.key));
    const filterDef = FILTERS.find((f) => f.key === filterKey);
    const sortDef = SORTS.find((s) => s.key === sortKey);
    const matchQuery = (it: Item) => {
      if (!q) return true;
      if (it.label.toLowerCase().includes(q)) return true;
      if (it.kind === "command" && (it as CommandItem).alias?.toLowerCase().includes(q)) return true;
      return false;
    };
    const baseItems: Item[] = q
      ? [...live, ...quickActions, ...NAVIGATE, ...COMMANDS]
      : emptyBase;
    const filtered = baseItems.filter((it) => {
      if (!matchQuery(it)) return false;
      if (activeTypes.length > 0 && !activeTypes.some((t) => t.predicate(it))) return false;
      if (filterDef?.predicate && !filterDef.predicate(it)) return false;
      return true;
    });
    if (sortDef?.sorter) filtered.sort(sortDef.sorter);
    return filtered;
  }, [query, typeFilters, filterKey, sortKey, live, quickActions, emptyBase]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActive(0);
      setSourceKey("all");
      setTypeFilters(new Set());
      setFilterKey("any");
      setSortKey("modified");
      setMoreOpen(false);
      setFilterOpen(false);
      setSortOpen(false);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [paletteOpen]);

  const onItemActivate = (it: Item) => {
    if (it.href) router.push(it.href);
    else it.action?.();
    closePalette();
  };

  useEffect(() => {
    if (!paletteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(flatItems.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems[active];
        if (item) onItemActivate(item);
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // "/" toggles commands-only view (matches the ClickUp palette
        // hint "Press / for commands"). Only fire when the value is empty.
        if (document.activeElement === inputRef.current && inputRef.current?.value === "") {
          e.preventDefault();
          setTypeFilters((prev) => {
            const next = new Set(prev);
            if (next.has("command") && next.size === 1) next.clear();
            else { next.clear(); next.add("command"); }
            return next;
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, flatItems, active]);

  if (!paletteOpen || !mounted) return null;

  /* Render helpers — one renderer per item kind. Each takes the running
     flat index so the active-row highlight tracks keyboard nav. */

  let runningIdx = -1;

  const Row = ({
    children,
    isActive,
    onClick,
    onMouseEnter,
  }: {
    children: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
    onMouseEnter: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
	      className={`group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
        isActive ? "bg-zinc-50 dark:bg-white/10" : "hover:bg-zinc-50 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );

  const TrailingChips = ({ isActive, isCommand }: { isActive: boolean; isCommand: boolean }) => (
    <span className={`flex items-center gap-1 transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
      {!isCommand ? (
        <span className="flex items-center justify-center w-6 h-6 rounded-md border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-[#1B1F26] text-zinc-500 dark:text-zinc-400" title="Open in new tab">
          <ExternalLinkIcon className="w-3 h-3" />
        </span>
      ) : null}
      <span className="flex items-center justify-center w-6 h-6 rounded-md border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-[#1B1F26] text-zinc-500 dark:text-zinc-400" title="Open">
        <CornerDownLeft className="w-3 h-3" />
      </span>
    </span>
  );

  const renderTask = (it: TaskItem) => {
    runningIdx += 1;
    const idx = runningIdx;
    const isActive = idx === active;
    const tone = STATUS_TONE[it.status];
    return (
      <Row key={it.id} isActive={isActive} onClick={() => onItemActivate(it)} onMouseEnter={() => setActive(idx)}>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-[#1B1F26] flex-shrink-0">
          <CheckSquare className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] text-zinc-800 dark:text-zinc-200 truncate font-medium">{it.label}</span>
          <span className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1 text-[12px] text-zinc-500 dark:text-zinc-400">
              <span className="w-2 h-2 rounded-full" style={{ background: tone.dot }} />
              <span>{it.due || tone.label}</span>
            </span>
          </span>
        </span>
        <TrailingChips isActive={isActive} isCommand={false} />
      </Row>
    );
  };

  const renderDoc = (it: DocItem) => {
    runningIdx += 1;
    const idx = runningIdx;
    const isActive = idx === active;
    const Icon = DOC_TYPE_ICON[it.type];
    return (
      <Row key={it.id} isActive={isActive} onClick={() => onItemActivate(it)} onMouseEnter={() => setActive(idx)}>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg text-white flex-shrink-0 shadow-sm" style={{ background: "var(--os-c-teal)" }}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] text-zinc-800 dark:text-zinc-200 truncate font-medium">{it.label}</span>
          {it.editedAt ? (
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 block truncate">
              {it.editor ? `${it.editor} · ` : ""}{it.editedAt}
            </span>
          ) : null}
        </span>
        <TrailingChips isActive={isActive} isCommand={false} />
      </Row>
    );
  };

  const renderPerson = (it: PersonItem) => {
    runningIdx += 1;
    const idx = runningIdx;
    const isActive = idx === active;
    return (
      <Row key={it.id} isActive={isActive} onClick={() => onItemActivate(it)} onMouseEnter={() => setActive(idx)}>
        <span className="flex items-center justify-center w-7 h-7 rounded-full text-white flex-shrink-0 text-[13px] font-semibold" style={{ background: it.color }}>
          {it.initials}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] text-zinc-800 dark:text-zinc-200 truncate font-medium">
            {it.label}
            {it.isAgent ? <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 font-medium">AGENT</span> : null}
          </span>
          {it.role ? <span className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 block truncate">{it.role}</span> : null}
        </span>
        <TrailingChips isActive={isActive} isCommand={false} />
      </Row>
    );
  };

  const renderSpace = (it: SpaceItem) => {
    runningIdx += 1;
    const idx = runningIdx;
    const isActive = idx === active;
    return (
      <Row key={it.id} isActive={isActive} onClick={() => onItemActivate(it)} onMouseEnter={() => setActive(idx)}>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg text-white flex-shrink-0 shadow-sm" style={{ background: it.color }}>
          <it.Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] text-zinc-800 dark:text-zinc-200 truncate font-medium">{it.label} space</span>
          <span className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 block">{it.members} members</span>
        </span>
        <TrailingChips isActive={isActive} isCommand={false} />
      </Row>
    );
  };

  const renderAction = (it: ActionItem) => {
    runningIdx += 1;
    const idx = runningIdx;
    const isActive = idx === active;
    return (
      <Row key={it.id} isActive={isActive} onClick={() => onItemActivate(it)} onMouseEnter={() => setActive(idx)}>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg text-white flex-shrink-0 shadow-sm" style={{ background: it.color }}>
          <it.Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] text-zinc-800 dark:text-zinc-200 truncate font-medium">{it.label}</span>
          {it.hint ? <span className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 block">{it.hint}</span> : null}
        </span>
        {it.shortcut && !isActive ? (
          <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 font-mono">{it.shortcut}</span>
        ) : null}
        <TrailingChips isActive={isActive} isCommand={true} />
      </Row>
    );
  };

  const renderNav = (it: NavItem) => {
    runningIdx += 1;
    const idx = runningIdx;
    const isActive = idx === active;
    return (
      <Row key={it.id} isActive={isActive} onClick={() => onItemActivate(it)} onMouseEnter={() => setActive(idx)}>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg text-white flex-shrink-0 shadow-sm" style={{ background: it.color }}>
          <it.Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] text-zinc-800 dark:text-zinc-200 truncate font-medium">{it.label}</span>
        </span>
        {it.shortcut && !isActive ? (
          <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 font-mono">{it.shortcut}</span>
        ) : null}
        <TrailingChips isActive={isActive} isCommand={false} />
      </Row>
    );
  };

  const renderCommand = (it: CommandItem) => {
    runningIdx += 1;
    const idx = runningIdx;
    const isActive = idx === active;
    return (
      <Row key={it.id} isActive={isActive} onClick={() => onItemActivate(it)} onMouseEnter={() => setActive(idx)}>
        <span className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300">
          <it.Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[14.5px] text-zinc-800 dark:text-zinc-200 truncate font-medium">{it.label}</span>
          {it.alias ? (
            <span className="text-[12px] text-zinc-400 dark:text-zinc-400">·</span>
          ) : null}
          {it.alias ? (
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400 font-mono">{it.alias}</span>
          ) : null}
        </span>
        <TrailingChips isActive={isActive} isCommand={true} />
      </Row>
    );
  };

  const renderItem = (it: Item) => {
    switch (it.kind) {
      case "task":     return renderTask(it as TaskItem);
      case "doc":      return renderDoc(it as DocItem);
      case "person":   return renderPerson(it as PersonItem);
      case "space":    return renderSpace(it as SpaceItem);
      case "action":   return renderAction(it as ActionItem);
      case "navigate": return renderNav(it as NavItem);
      case "command":  return renderCommand(it as CommandItem);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[8vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
	      <div
	        className="workwrk-os w-full max-w-[700px] mx-4 bg-white dark:bg-[#1B1F26] rounded-xl shadow-xl border border-zinc-200 dark:border-[#2A2F38] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        {/* Header: search input + Ask AI pill (hands the current query off
            to the Brain panel as the initial prompt). */}
	        <div className="flex items-center gap-2.5 px-4 pt-3 pb-3">
	          <Search className="w-4 h-4 text-zinc-400 dark:text-zinc-400 flex-shrink-0" />
          <input
            ref={inputRef}
            data-palette-search
            type="text"
            placeholder="Search, run a command, or ask a question…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            autoComplete="off"
	            className="flex-1 bg-transparent text-[14px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
          />
          <AskAiButton onClick={() => { openSidekick(query.trim() || undefined); closePalette(); }} title="Ask the Brain" />
          <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/10 border border-zinc-200 dark:border-[#2A2F38] font-mono">ESC</span>
        </div>

        {/* Source tabs. Connectable-but-not-yet-connected sources render
            dimmed + a connect badge, and route to /integrations on click. */}
	        <div className="flex items-center px-4 pt-1.5 pb-1" style={{ gap: 24 }}>
          {SOURCES.map((s) => {
            const isUnconnected = !!s.connectable;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  if (s.connectable) {
                    router.push("/integrations");
                    closePalette();
                    return;
                  }
                  setSourceKey(s.key);
                }}
	                className={`relative flex items-center gap-1.5 h-7 text-[13px] font-medium flex-shrink-0 transition-colors ${
                  isUnconnected
                    ? "text-zinc-500 dark:text-zinc-400 hover:text-zinc-400 dark:hover:text-zinc-300"
                    : sourceKey === s.key
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
                title={s.connectable ? `Connect ${s.label}` : s.label}
              >
                {s.Icon ? (
                  <span className="relative inline-flex w-4 h-4 items-center justify-center flex-shrink-0">
                    <s.Icon
                      className="w-3.5 h-3.5"
                      style={{ color: s.tint, opacity: isUnconnected ? 0.55 : 1 }}
                    />
                    {s.connectable ? (
                      <span
                        className="absolute -bottom-1 -right-1.5 w-[11px] h-[11px] rounded-full flex items-center justify-center"
                        style={{
                          background: "linear-gradient(135deg, #34D399, #10B981)",
                          boxShadow:
                            "0 0 0 1.5px var(--os-canvas), 0 1px 2px rgba(16, 185, 129, 0.4)",
                        }}
                        aria-label="Connect this integration"
                      >
                        <svg width="6" height="6" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                          <path d="M4 1.4V6.6M1.4 4H6.6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span>{s.label}</span>
                {!isUnconnected && sourceKey === s.key ? (
                  <span
                    className="absolute left-0 right-0 -bottom-0.5 h-[2px] rounded-full"
                    style={{ background: "var(--os-c-orange)" }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Filter chips (primary + "···" overflow) + Filter + Sort. */}
	        <div className="relative flex items-center gap-2 px-4 py-2 border-b border-zinc-100 dark:border-[#2A2F38]">
          {TYPE_FILTERS.filter((f) => f.primary).map((f) => {
            const on = typeFilters.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleType(f.key)}
	                className={`flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12.5px] font-medium border transition-colors ${
                  on
                    ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)] text-[var(--os-brand-deep)] dark:border-transparent dark:bg-[color-mix(in_srgb,var(--os-brand)_28%,#1B1F26)] dark:text-zinc-100"
                    : "border-zinc-200 dark:border-[#2A2F38] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
                }`}
                aria-pressed={on}
              >
                <f.Icon className="w-3.5 h-3.5" />
                <span>{f.label}</span>
              </button>
            );
          })}
          {TYPE_FILTERS.filter((f) => !f.primary && typeFilters.has(f.key)).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleType(f.key)}
	              className="flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12.5px] font-medium border border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)] text-[var(--os-brand-deep)]"
              aria-pressed
            >
              <f.Icon className="w-3.5 h-3.5" />
              <span>{f.label}</span>
            </button>
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setMoreOpen((v) => !v); setFilterOpen(false); setSortOpen(false); }}
	              className="flex items-center justify-center h-6 w-6 rounded-full border border-zinc-200 dark:border-[#2A2F38] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/10"
              aria-label="More type filters"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {moreOpen ? (
              <div
	                className="absolute left-0 top-8 z-10 w-52 bg-white dark:bg-[#1B1F26] border border-zinc-200 dark:border-[#2A2F38] rounded-lg shadow-lg py-1"
                onMouseLeave={() => setMoreOpen(false)}
              >
                {TYPE_FILTERS.filter((f) => !f.primary).map((f) => {
                  const on = typeFilters.has(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => toggleType(f.key)}
	                      className="w-full flex items-center gap-2 px-2.5 py-1 text-left text-[13px] text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
                    >
                      <f.Icon className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                      <span className="flex-1">{f.label}</span>
                      {on ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <span className="flex-1" />

          {/* Filter dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setFilterOpen((v) => !v); setSortOpen(false); setMoreOpen(false); }}
	              className={`flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[12.5px] font-medium transition-colors ${
                filterKey !== "any"
                  ? "text-[var(--os-brand-deep)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)]"
                  : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
              }`}
              aria-expanded={filterOpen}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{filterKey === "any" ? "Filter" : FILTERS.find((f) => f.key === filterKey)?.label ?? "Filter"}</span>
              {filterKey !== "any" ? <span className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-[var(--os-brand)]" /> : null}
            </button>
            {filterOpen ? (
              <div
	                className="absolute right-0 top-8 z-10 w-56 bg-white dark:bg-[#1B1F26] border border-zinc-200 dark:border-[#2A2F38] rounded-lg shadow-lg py-1"
                onMouseLeave={() => setFilterOpen(false)}
              >
                {FILTERS.map((f) => {
                  const on = filterKey === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => { setFilterKey(f.key); setFilterOpen(false); }}
	                      className="w-full flex items-center gap-2 px-2.5 py-1 text-left text-[13px] text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
                    >
                      <span className="flex-1">{f.label}</span>
                      {on ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Sort dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setSortOpen((v) => !v); setFilterOpen(false); setMoreOpen(false); }}
	              className="flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[12.5px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10 transition-colors"
              aria-expanded={sortOpen}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Sort</span>
            </button>
            {sortOpen ? (
              <div
	                className="absolute right-0 top-8 z-10 w-52 bg-white dark:bg-[#1B1F26] border border-zinc-200 dark:border-[#2A2F38] rounded-lg shadow-lg py-1"
                onMouseLeave={() => setSortOpen(false)}
              >
                {SORTS.map((s) => {
                  const on = sortKey === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { setSortKey(s.key); setSortOpen(false); }}
	                      className="w-full flex items-center gap-2 px-2.5 py-1 text-left text-[13px] text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
                    >
                      <span className="flex-1">{s.label}</span>
                      {on ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {/* Flat results list. */}
	        <div className="flex-1 max-h-[400px] overflow-y-auto px-2.5 py-2.5">
          {flatItems.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <Search className="w-7 h-7 mx-auto text-zinc-300 dark:text-zinc-400 mb-3" />
              <div className="text-[14px] text-zinc-700 dark:text-zinc-200 font-medium">
                {query ? `No matches for "${query}"` : "Nothing matches the active filters"}
              </div>
              <div className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">
                {query ? "Try a different query, or clear the type filters." : "Clear a filter to see results."}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {flatItems.map((it) => renderItem(it))}
            </div>
          )}
        </div>

        {/* Footer */}
	        <div className="flex items-center gap-2.5 px-3 py-2 border-t border-zinc-100 dark:border-[#2A2F38] text-[12px] text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-white/5">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-white/10">
              <ChevronLeft className="w-3 h-3" />
            </span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-white/10">
              <ChevronRight className="w-3 h-3" />
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <span>Press</span>
            <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 h-5 rounded border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-white/10 font-mono text-[11px]">/</span>
            <span>for commands ·</span>
            <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 h-5 rounded border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-white/10 font-mono text-[11px]">Tab</span>
            <span>for actions ·</span>
            <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 h-5 rounded border border-zinc-200 dark:border-[#2A2F38] bg-white dark:bg-white/10 font-mono text-[11px]">Esc</span>
            <span>to close</span>
          </span>
          <span className="flex-1" />
          <button type="button" className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/10" aria-label="Search settings">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
