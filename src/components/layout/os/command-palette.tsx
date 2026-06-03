"use client";

// OsCommandPalette — enhanced search modal modeled after ClickUp's
// "Brain" reference (2026-06-03 screenshot).
//
// Layout top → bottom:
//   header:  big search input + Ask-AI chip (opens the Sidekick panel)
//   sources: All / WorkwrK / Gmail / Drive / SharePoint / Apps
//   filters: Tasks / Docs / People / Spaces / Agents + Filter + Sort
//   body:    Section-grouped results — see SectionKind. When the query is
//            empty we show a "today" digest (suggested + recent tasks +
//            recent docs + key people + quick actions). When typing, we
//            filter every section by query and only render the ones that
//            still have matches.
//   footer:  ←/→ navigate hint + Tab additional actions + settings
//
// The data here (TASKS, DOCS, PEOPLE, SPACES) is a curated sample of
// "what a real WorkwrK workspace looks like" so the UI demonstrates
// useful results out of the box. Real adapters (DB queries, integration
// connectors) plug in by replacing the SOURCE arrays below.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Home,
  CheckSquare,
  CalendarDays,
  Users2,
  BarChart3,
  Code2,
  Headphones,
  CircleDollarSign,
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
  ThumbsUp,
  Clock,
  Video,
  MessageSquare,
  FileSpreadsheet,
  TrendingUp,
  MoreHorizontal,
  Activity,
  Star,
  Terminal,
  Notebook,
  Hash,
  PenTool,
  Download,
  Layers,
  Check,
  type LucideIcon,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { AskAiButton } from "./ask-ai-button";

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
  due?: string;       // "Today", "Tomorrow", "Fri Jun 06"
  assignee: { name: string; color: string };
};

type DocItem = BaseItem & {
  kind: "doc";
  type: "doc" | "spreadsheet" | "whiteboard";
  editedAt: string;   // "2h ago", "yesterday"
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

type SuggestedItem = BaseItem & {
  kind: "suggested";
  Icon: LucideIcon;
  color: string;
  hint?: string;
};

/** Commands are app-wide ops with a memorable keyword alias (the
 *  "shortcut" — e.g. `dd` runs Download Diagnostics). They mirror the
 *  ClickUp omnibox commands list. */
type CommandItem = BaseItem & {
  kind: "command";
  Icon: LucideIcon;
  /** Keyword alias shown next to the label (and matched against `query`). */
  alias?: string;
};

type Item = TaskItem | DocItem | PersonItem | SpaceItem | ActionItem | NavItem | SuggestedItem | CommandItem;

/* ─── Mock data: what a working WorkwrK looks like ─── */

const SUGGESTED: SuggestedItem[] = [
  { kind: "suggested", id: "sug-today",   label: "Open my today's plan",                Icon: Home,         color: "var(--os-c-orange)", href: "/today",      hint: "Start your day" },
  { kind: "suggested", id: "sug-review",  label: "Submit this week's weekly review",    Icon: CheckSquare,  color: "var(--os-c-purple)", href: "/me/weekly-review", hint: "Due Friday" },
  { kind: "suggested", id: "sug-stalled", label: "Show me what's stalled in my space",  Icon: TrendingUp,   color: "var(--os-c-red)",    href: "/spaces",     hint: "AI summary" },
];

const TASKS: TaskItem[] = [
  { kind: "task", id: "t-budget",   label: "Finalize Q3 budget review",        status: "in_progress", due: "Tomorrow",  assignee: { name: "Ria",    color: "var(--os-c-orange)" } },
  { kind: "task", id: "t-jd",       label: "Review open job descriptions",     status: "todo",        due: "Fri Jun 06",assignee: { name: "Priya",  color: "var(--os-c-purple)" } },
  { kind: "task", id: "t-renewal",  label: "Acme renewal — send proposal",     status: "in_progress", due: "Today",     assignee: { name: "Aman",   color: "var(--os-c-blue)" } },
  { kind: "task", id: "t-onboard",  label: "Wrap onboarding for 2 new hires",  status: "blocked",     due: "Mon",       assignee: { name: "Priya",  color: "var(--os-c-purple)" } },
  { kind: "task", id: "t-mtg-notes",label: "Share weekly all-hands recap",     status: "todo",                          assignee: { name: "Maya",   color: "var(--os-c-green)" } },
];

const DOCS: DocItem[] = [
  { kind: "doc", id: "d-mutual",   label: "Mutual Connection — Sales pitch",      type: "doc",         editedAt: "2h ago",       editor: "Ibrahim", href: "/docs?id=mutual" },
  { kind: "doc", id: "d-okrs",     label: "OKRs Q3 — company-wide",               type: "doc",         editedAt: "yesterday",    editor: "Ria",     href: "/okrs" },
  { kind: "doc", id: "d-runbook",  label: "Customer onboarding runbook",          type: "doc",         editedAt: "3d ago",       editor: "Priya",   href: "/docs?id=runbook" },
  { kind: "doc", id: "d-pricing",  label: "2026 Pricing model — proposal",        type: "spreadsheet", editedAt: "5d ago",       editor: "Aman",    href: "/financials/statements" },
  { kind: "doc", id: "d-roadmap",  label: "Product roadmap — H2",                 type: "whiteboard",  editedAt: "last week",    editor: "Maya",    href: "/whiteboards" },
];

const PEOPLE: PersonItem[] = [
  { kind: "person", id: "p-ria",     label: "Ria Patel",     role: "SDR Agent",       isAgent: true,  initials: "R", color: "var(--os-c-orange)", href: "/agents/ria" },
  { kind: "person", id: "p-priya",   label: "Priya Shah",    role: "HR Operations",                   initials: "P", color: "var(--os-c-purple)", href: "/people/priya" },
  { kind: "person", id: "p-aman",    label: "Aman Kapoor",   role: "Account Exec",                    initials: "A", color: "var(--os-c-blue)",   href: "/people/aman" },
  { kind: "person", id: "p-maya",    label: "Maya Iyer",     role: "Product Manager",                 initials: "M", color: "var(--os-c-green)",  href: "/people/maya" },
  { kind: "person", id: "p-ibrahim", label: "Ibrahim Surya", role: "You · CEO",                       initials: "I", color: "var(--os-c-pink)",   href: "/me" },
];

const SPACES: SpaceItem[] = [
  { kind: "space", id: "s-sales",  label: "Sales",        Icon: BarChart3,        color: "var(--os-c-green)",  members: 12, href: "/crm" },
  { kind: "space", id: "s-eng",    label: "Engineering",  Icon: Code2,            color: "var(--os-c-blue)",   members: 8,  href: "/dev" },
  { kind: "space", id: "s-people", label: "People & HR",  Icon: Users2,           color: "var(--os-c-pink)",   members: 6,  href: "/people" },
  { kind: "space", id: "s-fin",    label: "Finance",      Icon: CircleDollarSign, color: "var(--os-c-teal)",   members: 4,  href: "/financials" },
  { kind: "space", id: "s-supp",   label: "Support",      Icon: Headphones,       color: "var(--os-c-orange)", members: 5,  href: "/helpdesk" },
];

const ACTIONS: ActionItem[] = [
  { kind: "action", id: "a-task",     label: "Create task",             Icon: CheckSquare,       color: "var(--os-c-green)",  shortcut: "⌘ N",     hint: "Quick capture" },
  { kind: "action", id: "a-doc",      label: "New doc",                 Icon: FileText,          color: "var(--os-c-teal)",   shortcut: "⌘ ⇧ D" },
  { kind: "action", id: "a-meet",     label: "Schedule meeting",        Icon: CalendarDays,      color: "var(--os-c-pink)",   shortcut: "⌘ M" },
  { kind: "action", id: "a-announce", label: "Send announcement",       Icon: Megaphone,         color: "var(--os-c-red)" },
  { kind: "action", id: "a-kudos",    label: "Give kudos",              Icon: ThumbsUp,          color: "var(--os-c-yellow)" },
  { kind: "action", id: "a-time",     label: "Start time tracker",      Icon: Clock,             color: "var(--os-c-indigo)" },
  { kind: "action", id: "a-clip",     label: "Record a clip",           Icon: Video,             color: "var(--os-c-purple)" },
  { kind: "action", id: "a-survey",   label: "Send a survey",           Icon: FileSpreadsheet,   color: "var(--os-c-brown)" },
  { kind: "action", id: "a-candor",   label: "Open Candor 1-on-1",      Icon: MessageSquare,     color: "var(--os-c-orange)" },
];

const NAVIGATE: NavItem[] = [
  { kind: "navigate", id: "n-today",  label: "Today",       Icon: Home,         color: "var(--os-c-orange)", href: "/today",    shortcut: "G T" },
  { kind: "navigate", id: "n-inbox",  label: "Inbox",       Icon: Inbox,        color: "var(--os-c-blue)",   href: "/inbox",    shortcut: "G I" },
  { kind: "navigate", id: "n-tasks",  label: "My tasks",    Icon: CheckSquare,  color: "var(--os-c-purple)", href: "/tasks",    shortcut: "G K" },
  { kind: "navigate", id: "n-meet",   label: "Meetings",    Icon: CalendarDays, color: "var(--os-c-pink)",   href: "/planner",  shortcut: "G M" },
  { kind: "navigate", id: "n-okrs",   label: "OKRs",        Icon: Target,       color: "var(--os-c-indigo)", href: "/okrs" },
  { kind: "navigate", id: "n-store",  label: "Marketplace", Icon: Store,        color: "var(--os-c-indigo)", href: "/store" },
  { kind: "navigate", id: "n-set",    label: "Workspace settings", Icon: Settings, color: "var(--os-c-brown)", href: "/settings" },
];

/** Commands — app-wide actions with a memorable keyword alias. Modeled
 *  after the ClickUp omnibox: each has a short alias users can type
 *  (e.g. `pri` for Open My Priorities, `dd` for Download Diagnostics). */
const COMMANDS: CommandItem[] = [
  { kind: "command", id: "cmd-planner",      label: "Open Planner",         Icon: CalendarDays, alias: "calendar",  href: "/planner" },
  { kind: "command", id: "cmd-priorities",   label: "Open My Priorities",   Icon: Target,       alias: "pri",       href: "/today" },
  { kind: "command", id: "cmd-mywork",       label: "Open My Work",         Icon: CheckSquare,  alias: "mw",        href: "/tasks" },
  { kind: "command", id: "cmd-activity",     label: "Open My Activity",     Icon: Activity,     alias: "act",       href: "/dashboard" },
  { kind: "command", id: "cmd-inbox",        label: "Go to Inbox",          Icon: Inbox,        alias: "inb",       href: "/inbox" },
  { kind: "command", id: "cmd-docs",         label: "Go to Docs home",      Icon: FileText,     alias: "docs",      href: "/docs" },
  { kind: "command", id: "cmd-pulse",        label: "Go to Pulse",          Icon: TrendingUp,   alias: "pulse",     href: "/pulse" },
  { kind: "command", id: "cmd-goals",        label: "Go to Goals",          Icon: Target,       alias: "goals",     href: "/okrs" },
  { kind: "command", id: "cmd-time",         label: "Go to Timesheets",     Icon: Clock,        alias: "ts",        href: "/timesheets" },
  { kind: "command", id: "cmd-newdoc",       label: "Create new Doc",       Icon: PenTool,      alias: "nd",        href: "/docs?new=1" },
  { kind: "command", id: "cmd-newnote",      label: "Create new Notepad",   Icon: Notebook,     alias: "nn",        href: "/notepad?new=1" },
  { kind: "command", id: "cmd-newtask",      label: "Create new Task",      Icon: CheckSquare,  alias: "nt",        href: "/tasks?new=1" },
  { kind: "command", id: "cmd-fav",          label: "Show Favorites",       Icon: Star,         alias: "fav" },
  { kind: "command", id: "cmd-tray",         label: "Show Tray",            Icon: Layers,       alias: "tray" },
  { kind: "command", id: "cmd-recent",       label: "Show Recent Activity", Icon: Activity,     alias: "rec" },
  { kind: "command", id: "cmd-setstatus",    label: "Set status",           Icon: Check,        alias: "ss" },
  { kind: "command", id: "cmd-slack",        label: "Update Slack status",  Icon: Hash,         alias: "slack" },
  { kind: "command", id: "cmd-connect",      label: "Connect apps",         Icon: Store,        alias: "conn",      href: "/integrations" },
  { kind: "command", id: "cmd-diag",         label: "Download Diagnostics", Icon: Download,     alias: "dd" },
  { kind: "command", id: "cmd-trace",        label: "Feature Trace",        Icon: Terminal,     alias: "ft" },
];

// Note: SUGGESTED items are intentionally excluded from the visible set.
// The whole "AI / suggested for you" concept has been removed from search
// per the design call — kept the constant only as data scaffolding for a
// future revival.
void SUGGESTED;

const ALL_ITEMS: Item[] = [
  ...TASKS,
  ...DOCS,
  ...PEOPLE,
  ...SPACES,
  ...ACTIONS,
  ...NAVIGATE,
  ...COMMANDS,
];

/* ─── Top-level filters (source tabs + type chips) ─── */

const SOURCES: Array<{
  key: string;
  label: string;
  Icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tint?: string;
  /** When true, the icon shows a small `+` badge — signals this source
   *  is an integration the user hasn't connected yet. Tapping the chip
   *  opens the connect flow (today: routes to /integrations). */
  connectable?: boolean;
}> = [
  { key: "all",         label: "All" },
  { key: "workwrk",     label: "WorkwrK",      Icon: Sparkles, tint: "var(--os-brand)" },
  { key: "gmail",       label: "Gmail",        Icon: Mail,     tint: "#EA4335", connectable: true },
  { key: "drive",       label: "Google Drive", Icon: HardDrive,tint: "#34A853", connectable: true },
  { key: "sharepoint",  label: "SharePoint",   Icon: FileText, tint: "#0078D4", connectable: true },
  { key: "apps",        label: "Apps",         Icon: Store,    tint: "#7C3AED" },
];

/** Type filter chip. Each defines its own predicate so a single chip can
 *  span multiple item kinds (e.g. "Whiteboards" only matches docs whose
 *  type === "whiteboard"). Chips not flagged `primary` collapse into the
 *  "···" overflow popover so the chip row stays scannable. */
const TYPE_FILTERS: Array<{
  key: string;
  label: string;
  Icon: LucideIcon;
  primary?: boolean;
  predicate: (it: Item) => boolean;
}> = [
  { key: "task",       label: "Tasks",       Icon: CheckSquare,     primary: true,  predicate: (i) => i.kind === "task" },
  { key: "doc",        label: "Docs",        Icon: FileText,        primary: true,  predicate: (i) => i.kind === "doc" && (i as DocItem).type === "doc" },
  { key: "person",     label: "People",      Icon: Users2,          primary: true,  predicate: (i) => i.kind === "person" },
  { key: "space",      label: "Spaces",      Icon: BarChart3,       primary: true,  predicate: (i) => i.kind === "space" },
  { key: "command",    label: "Commands",    Icon: Terminal,        primary: true,  predicate: (i) => i.kind === "command" },
  { key: "whiteboard", label: "Whiteboards", Icon: PenTool,                         predicate: (i) => i.kind === "doc" && (i as DocItem).type === "whiteboard" },
  { key: "pulse",      label: "Pulse",       Icon: TrendingUp,                      predicate: (i) => i.kind === "task" && (i as TaskItem).status === "in_progress" },
  { key: "goal",       label: "Goals",       Icon: Target,                          predicate: (i) => i.kind === "navigate" && i.id === "n-okrs" },
  { key: "form",       label: "Forms",       Icon: FileSpreadsheet,                 predicate: (i) => i.kind === "doc" && (i as DocItem).type === "spreadsheet" },
  { key: "channel",    label: "Channels",    Icon: Hash,                            predicate: () => false },
  { key: "comment",    label: "Comments",    Icon: MessageSquare,                   predicate: () => false },
  { key: "notepad",    label: "Notepads",    Icon: Notebook,                        predicate: () => false },
  { key: "action",     label: "Actions",     Icon: Sparkles,                        predicate: (i) => i.kind === "action" },
];

/** Filter dropdown options (header right). Each option toggles a single
 *  active filter; "Any" clears it. Filters are predicate-based against
 *  mock data — Created-by-me uses Ibrahim as the demo "me" since the
 *  palette doesn't yet pull the live caller. */
const FILTERS: Array<{ key: string; label: string; hint?: string; predicate?: (it: Item) => boolean }> = [
  { key: "any",         label: "Any" },
  { key: "by-me",       label: "Created by me",     hint: "Ibrahim",     predicate: (i) => i.kind === "doc" && (i as DocItem).editor === "Ibrahim" },
  { key: "active",      label: "Active tasks only", predicate: (i) => i.kind === "task" && (i as TaskItem).status !== "done" },
  { key: "trending",    label: "Trending",          predicate: (i) => i.kind === "task" && (i as TaskItem).status === "in_progress" },
  { key: "trending-you",label: "Trending for you",  predicate: (i) => i.kind === "task" && (i as TaskItem).assignee.name === "Ibrahim" },
  { key: "docs-only",   label: "WorkwrK documents", predicate: (i) => i.kind === "doc" },
];

/** Sort dropdown options. Default is "modified" which preserves the
 *  hand-curated order in ALL_ITEMS (most-recent-feeling first). */
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

/* ─── Component ─── */

export function OsCommandPalette() {
  const { paletteOpen, closePalette, openSidekick } = useOsShell();
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
   *   2. type chips — predicate-OR: an item matches if any active chip's
   *      predicate returns true (so toggling "Tasks" + "Docs" widens
   *      the set, not narrows it)
   *   3. Filter dropdown — single active predicate
   * Then `sortKey` reorders the result.
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
    const filtered = ALL_ITEMS.filter((it) => {
      if (!matchQuery(it)) return false;
      if (activeTypes.length > 0 && !activeTypes.some((t) => t.predicate(it))) return false;
      if (filterDef?.predicate && !filterDef.predicate(it)) return false;
      return true;
    });
    if (sortDef?.sorter) filtered.sort(sortDef.sorter);
    return filtered;
  }, [query, typeFilters, filterKey, sortKey]);

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
        // hint "Press / for commands"). Only fire when the user is in
        // the search input AND the value is empty — otherwise the slash
        // is a normal character (e.g. searching for "TODO/Done").
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

  /* Render helpers — one renderer per item kind so each section feels
     native to its content type. Each helper takes the running flat
     index so the active-row highlight tracks keyboard nav. */

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
      className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
        isActive ? "bg-zinc-50" : "hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );

  const TrailingChips = ({ isActive, isCommand }: { isActive: boolean; isCommand: boolean }) => (
    <span className={`flex items-center gap-1 transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
      {!isCommand ? (
        <span className="flex items-center justify-center w-6 h-6 rounded-md border border-zinc-200 bg-white text-zinc-500" title="Open in new tab">
          <ExternalLinkIcon className="w-3 h-3" />
        </span>
      ) : null}
      <span className="flex items-center justify-center w-6 h-6 rounded-md border border-zinc-200 bg-white text-zinc-500" title="Open">
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
        <span className="flex items-center justify-center w-7 h-7 rounded-lg border border-zinc-200 bg-white flex-shrink-0">
          <CheckSquare className="w-3.5 h-3.5 text-zinc-500" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] text-zinc-800 truncate font-medium">{it.label}</span>
          <span className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1 text-[11px] text-zinc-500">
              <span className="w-2 h-2 rounded-full" style={{ background: tone.dot }} />
              <span>{tone.label}</span>
            </span>
            {it.due ? (
              <span className="text-[11px] text-zinc-500">· due {it.due}</span>
            ) : null}
          </span>
        </span>
        <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-semibold flex-shrink-0"
              style={{ background: it.assignee.color }} title={it.assignee.name}>
          {it.assignee.name.charAt(0)}
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
          <span className="block text-[13.5px] text-zinc-800 truncate font-medium">{it.label}</span>
          <span className="text-[11px] text-zinc-500 mt-0.5 block">
            {it.editor ? `${it.editor} · ` : ""}edited {it.editedAt}
          </span>
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
        <span className="flex items-center justify-center w-7 h-7 rounded-full text-white flex-shrink-0 text-[12px] font-semibold" style={{ background: it.color }}>
          {it.initials}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] text-zinc-800 truncate font-medium">
            {it.label}
            {it.isAgent ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-medium">AGENT</span> : null}
          </span>
          <span className="text-[11px] text-zinc-500 mt-0.5 block">{it.role}</span>
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
          <span className="block text-[13.5px] text-zinc-800 truncate font-medium">{it.label} space</span>
          <span className="text-[11px] text-zinc-500 mt-0.5 block">{it.members} members</span>
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
          <span className="block text-[13.5px] text-zinc-800 truncate font-medium">{it.label}</span>
          {it.hint ? <span className="text-[11px] text-zinc-500 mt-0.5 block">{it.hint}</span> : null}
        </span>
        {it.shortcut && !isActive ? (
          <span className="text-[10.5px] text-zinc-500 font-mono">{it.shortcut}</span>
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
          <span className="block text-[13.5px] text-zinc-800 truncate font-medium">{it.label}</span>
        </span>
        {it.shortcut && !isActive ? (
          <span className="text-[10.5px] text-zinc-500 font-mono">{it.shortcut}</span>
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
        <span className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 bg-zinc-100 text-zinc-600">
          <it.Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[13.5px] text-zinc-800 truncate font-medium">{it.label}</span>
          {it.alias ? (
            <span className="text-[11px] text-zinc-400">·</span>
          ) : null}
          {it.alias ? (
            <span className="text-[11px] text-zinc-500 font-mono">{it.alias}</span>
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
      // suggested is excluded from ALL_ITEMS now; the case stays for
      // exhaustiveness even though it's unreachable.
      case "suggested": return null;
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
        className="workwrk-os w-full max-w-[760px] mx-4 bg-white rounded-2xl shadow-2xl border border-zinc-200 flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        {/* Header: search input + Ask AI pill (hands the current query off
            to the Brain panel as the initial prompt). */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-4">
          <Search className="w-[18px] h-[18px] text-zinc-400 flex-shrink-0" />
          <input
            ref={inputRef}
            data-palette-search
            type="text"
            placeholder="Search, run a command, or ask a question…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            autoComplete="off"
            className="flex-1 bg-transparent text-[16px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          <AskAiButton onClick={() => { openSidekick(query.trim() || undefined); closePalette(); }} title="Ask the Brain" />
          <span className="text-[10.5px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 font-mono">ESC</span>
        </div>

        {/* Source tabs — flat row, real breathing room between providers.
            ─ Connected sources (All / WorkwrK / Apps) render bright and
              clickable — text uses Tailwind text-zinc-900 so the
              existing dark-mode catchall flips it to #E5E7EB.
            ─ Connectable-but-not-yet-connected (Gmail / Drive /
              SharePoint) render dimmed so they self-signal "needs
              connecting" — softer text + slightly desaturated icon.
            ─ Connection badge sits on the icon corner, emerald gradient
              chip + canvas-color ring. */}
        <div className="flex items-center px-5 pt-2 pb-1.5" style={{ gap: 32 }}>
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
                  // Connected source — set it active. Real per-source
                  // adapter filtering wires in later.
                  setSourceKey(s.key);
                }}
                className={`relative flex items-center gap-2 h-8 text-[12.5px] font-medium flex-shrink-0 transition-colors ${
                  isUnconnected
                    ? "text-zinc-500 hover:text-zinc-400"
                    : sourceKey === s.key
                    ? "text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900"
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
                {/* Active underline — only on connected sources that
                    are currently selected. The line signals "this is
                    the live filter" without dimming the rest. */}
                {!isUnconnected && sourceKey === s.key ? (
                  <span
                    className="absolute left-0 right-0 -bottom-0.5 h-[2px] rounded-full"
                    style={{ background: "var(--os-c-pink)" }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Filter chips (primary + "···" overflow) + Filter + Sort. The
            overflow popover hosts chips that don't fit inline; toggling
            a chip from there moves it visually to the active set. */}
        <div className="relative flex items-center gap-2.5 px-5 py-2.5 border-b border-zinc-100">
          {TYPE_FILTERS.filter((f) => f.primary).map((f) => {
            const on = typeFilters.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleType(f.key)}
                className={`flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-medium border transition-colors ${
                  on
                    ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)] text-[var(--os-brand-deep)]"
                    : "border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                }`}
                aria-pressed={on}
              >
                <f.Icon className="w-3.5 h-3.5" />
                <span>{f.label}</span>
              </button>
            );
          })}
          {/* Show extra active (non-primary) chips inline so the user
              sees what's filtering — they live behind the More popover
              by default but surface here when on. */}
          {TYPE_FILTERS.filter((f) => !f.primary && typeFilters.has(f.key)).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleType(f.key)}
              className="flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-medium border border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)] text-[var(--os-brand-deep)]"
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
              className="flex items-center justify-center h-7 w-7 rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              aria-label="More type filters"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {moreOpen ? (
              <div
                className="absolute left-0 top-9 z-10 w-56 bg-white border border-zinc-200 rounded-lg shadow-lg py-1.5"
                onMouseLeave={() => setMoreOpen(false)}
              >
                {TYPE_FILTERS.filter((f) => !f.primary).map((f) => {
                  const on = typeFilters.has(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => toggleType(f.key)}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-zinc-800 hover:bg-zinc-50"
                    >
                      <f.Icon className="w-3.5 h-3.5 text-zinc-500" />
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
              className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium transition-colors ${
                filterKey !== "any"
                  ? "text-[var(--os-brand-deep)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)]"
                  : "text-zinc-700 hover:bg-zinc-50"
              }`}
              aria-expanded={filterOpen}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{filterKey === "any" ? "Filter" : FILTERS.find((f) => f.key === filterKey)?.label ?? "Filter"}</span>
              {filterKey !== "any" ? <span className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-[var(--os-brand)]" /> : null}
            </button>
            {filterOpen ? (
              <div
                className="absolute right-0 top-9 z-10 w-60 bg-white border border-zinc-200 rounded-lg shadow-lg py-1.5"
                onMouseLeave={() => setFilterOpen(false)}
              >
                {FILTERS.map((f) => {
                  const on = filterKey === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => { setFilterKey(f.key); setFilterOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-zinc-800 hover:bg-zinc-50"
                    >
                      <span className="flex-1">{f.label}</span>
                      {f.hint ? <span className="text-[10.5px] text-zinc-400">{f.hint}</span> : null}
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
              className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              aria-expanded={sortOpen}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Sort</span>
            </button>
            {sortOpen ? (
              <div
                className="absolute right-0 top-9 z-10 w-56 bg-white border border-zinc-200 rounded-lg shadow-lg py-1.5"
                onMouseLeave={() => setSortOpen(false)}
              >
                {SORTS.map((s) => {
                  const on = sortKey === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { setSortKey(s.key); setSortOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-zinc-800 hover:bg-zinc-50"
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

        {/* Flat results list. The type chips above are the only bifurcator:
            click "Tasks" → only tasks render here, etc. Per-row kind is
            conveyed by each row's own layout (status pill / avatar /
            file icon / etc.) so the list reads as one ranked feed. */}
        <div className="flex-1 max-h-[440px] overflow-y-auto px-3 py-3">
          {flatItems.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <Search className="w-7 h-7 mx-auto text-zinc-300 mb-3" />
              <div className="text-[13px] text-zinc-700 font-medium">
                {query ? `No matches for "${query}"` : "Nothing matches the active filters"}
              </div>
              <div className="text-[12px] text-zinc-500 mt-1">
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
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-zinc-100 text-[11px] text-zinc-500 bg-zinc-50/50">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-zinc-200 bg-white">
              <ChevronLeft className="w-3 h-3" />
            </span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-zinc-200 bg-white">
              <ChevronRight className="w-3 h-3" />
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <span>Press</span>
            <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 h-5 rounded border border-zinc-200 bg-white font-mono text-[10px]">/</span>
            <span>for commands ·</span>
            <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 h-5 rounded border border-zinc-200 bg-white font-mono text-[10px]">Tab</span>
            <span>for actions ·</span>
            <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 h-5 rounded border border-zinc-200 bg-white font-mono text-[10px]">Esc</span>
            <span>to close</span>
          </span>
          <span className="flex-1" />
          <button type="button" className="p-1 rounded hover:bg-zinc-200" aria-label="Search settings">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
