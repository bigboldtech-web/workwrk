"use client";

// Search palette (spec-shell 2.9): find anything or jump anywhere by typing.
//
//   Radix Dialog, 640 wide (the one flagged width outside the modal set),
//   top 12vh. Header: one 44px input. Under it one chip row, single-select:
//   All · Tasks · Docs · People · Spaces & Lists · Apps · Settings. Body:
//   sections with 11/600 labels and 36px rows. Footer: real hints only.
//
//   Empty query: RECENT (the last apps opened, localStorage ephemera),
//   JUMP TO (Home, My work, Inbox first, then the hubs, then every folded
//   app the viewer may open, in rail order: this is the launcher), CREATE
//   (Task, Doc, List, Reminder, Notepad, Voice note; gated like the Create
//   menu). Typing (2+ chars, 180ms): GET /api/search, grouped TASKS · DOCS ·
//   PEOPLE · SPACES & LISTS · TABLES (Tables module on) · FORMS · APPS (name
//   match on the viewer's apps) ·
//   SETTINGS (registry, Workspace pages only for Owner and Admin) · ACTIONS
//   ("Ask AI about …" when the AI hub is visible, "Create a task").
//
// Removed from the old palette: the Gmail / Drive / SharePoint / Apps source
// tabs, Filter and Sort, the gear with no handler, "Tab for actions", the
// decorative arrows, the Ask AI header button (an ACTIONS row now) and the
// retired labels Today, My tasks, My Priorities, AI Notetaker.

import { useRouter } from "next/navigation";
import { useRole } from "@/hooks/use-role";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Activity,
  AlarmClock,
  Building2,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  FileText,
  House,
  Inbox,
  Layers,
  ListTodo,
  Megaphone,
  MessageSquare,
  Mic,
  NotebookPen,
  Search,
  Settings2,
  Sparkles,
  Star,
  Table2,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { apiFetch } from "@/lib/api-fetch";
import { shortcutHint } from "@/lib/shortcuts";
import { HUB_LABELS, SHELL_LABELS } from "@/lib/nav/labels";
import { isHubKey, WORK_HOME_HREF } from "@/lib/nav/route-hub";
import {
  filterSettingsEntries,
  filterSettingsPages,
  settingsHrefToday,
} from "@/lib/settings-registry";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { cn } from "@/lib/utils";
import { useOsShell } from "./shell-context";
import { useBoot, useViewerRole } from "./boot-context";
import { useOsToast } from "./toast";
// The palette opens over any page, so an object row opens in the section
// the person is in at the moment they pick it (src/lib/nav/object-href.ts).
import { objectHrefNow, sectionHrefNow } from "./use-object-href";
import type { AppEntry } from "./apps-catalog";

/* ─── Model ─── */

type ChipKey = "all" | "task" | "doc" | "person" | "space" | "app" | "settings";

const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "task", label: "Tasks" },
  { key: "doc", label: "Docs" },
  { key: "person", label: "People" },
  { key: "space", label: "Spaces & Lists" },
  { key: "app", label: "Apps" },
  { key: "settings", label: "Settings" },
];

/** The scope and sort controls the palette footer offers over live results. */
type ScopeKey = "any" | "tasks" | "docs";
type SortKey = "relevance" | "name" | "name-desc";
const SCOPES: Array<{ key: ScopeKey; label: string }> = [
  { key: "any", label: "Any" },
  { key: "tasks", label: "Tasks only" },
  { key: "docs", label: "Documents" },
];
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "relevance", label: "Most relevant" },
  { key: "name", label: "Name A to Z" },
  { key: "name-desc", label: "Name Z to A" },
];

type Row = {
  id: string;
  label: string;
  /** The container path ("Sales › Q4") or a one-line hint, 13px ink-2. */
  secondary?: string;
  glyph: ReactNode;
  href?: string;
  /** Runs instead of navigating; the palette closes first. */
  action?: () => void;
  shortcut?: string;
};

type Section = {
  key: string;
  label: string;
  chip: ChipKey | "any";
  rows: Row[];
};

type ServerHit = {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
};

/** Stable empty list, so "no message hits" never changes identity and the
 *  sections memo below is not invalidated on every keystroke. */
const EMPTY_MESSAGE_HITS: MessageHit[] = [];

/** One hit from GET /api/conversations/search-messages. */
type MessageHit = {
  messageId: string;
  conversationId: string;
  conversationType: string;
  conversationName: string | null;
  members: { userId: string; user: { id: string; firstName: string; lastName: string } }[];
  author: { id: string; firstName: string; lastName: string };
  snippet: string;
  inThread: boolean;
};

type LiveKind = "task" | "doc" | "person" | "space" | "table" | "form" | "more";

const SEARCH_TYPES: Record<string, LiveKind> = {
  item: "task",
  task: "task",
  note: "doc",
  sop: "doc",
  whiteboard: "doc",
  policy: "doc",
  person: "person",
  board: "space",
  space: "space",
  folder: "space",
  // The Tables and Forms groups (spec-tables-forms section 2): searched by
  // /api/search only while the Tables module is on.
  table: "table",
  form: "form",
  okr: "more",
  meeting: "more",
  department: "more",
  idea: "more",
  announcement: "more",
};

const MORE_ICON: Record<string, LucideIcon> = {
  okr: Target,
  meeting: CalendarDays,
  department: Building2,
  idea: Sparkles,
  announcement: Megaphone,
};

function Glyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Icon
      className="h-4 w-4 shrink-0 text-ink-2"
      strokeWidth={1.5}
      aria-hidden
    />
  );
}

function PersonGlyph({ name }: { name: string }) {
  const initials =
    name
      .split(" ")
      .map((s) => s[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-active text-[10px] font-medium text-ink-strong"
      aria-hidden
    >
      {initials}
    </span>
  );
}

function hasSpeechRecognition(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/* ─── Component ─── */

/** The dialog. Its body mounts only while open, so every open starts clean. */
export function OsCommandPalette() {
  const { paletteOpen, closePalette } = useOsShell();
  return (
    <DialogPrimitive.Root
      open={paletteOpen}
      onOpenChange={(v) => {
        if (!v) closePalette();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[var(--os-scrim)]" />
        <PaletteBody />
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** One search request's answer, kept with the query it answered. */
type SearchState = {
  q: string;
  status: "loading" | "ok" | "failed";
  hits: ServerHit[];
};

function PaletteBody() {
  const {
    closePalette,
    openSidekick,
    openCreateTask,
    openCreateList,
    recentAppKeys,
    hubHref,
    launcherApps,
    railApps,
    prefs,
  } = useOsShell();
  const { boot } = useBoot();
  const { isAdmin, isGuest } = useViewerRole();
  // The `manage_process` rule (Owner, Admin, People team) the acknowledgement
  // default entries carry as their externalGate: today's admin tier in
  // hooks/use-role (SUPER_ADMIN, COMPANY_ADMIN, C_LEVEL, HR), the same set
  // lib/process-scope canManageProcess checks on the server.
  const { isAdmin: canManageProcess } = useRole();
  const { openSettings } = useSettingsNav();
  const { toast } = useOsToast();
  const router = useRouter();

  const [query, setQueryState] = useState("");
  const [chip, setChipState] = useState<ChipKey>("all");
  // Scope and sort over live results (the footer's two selects). Scope
  // narrows the hit TYPES; sort re-orders by name or keeps the server's
  // relevance order. Both were footer chips before the refresh.
  const [scope, setScope] = useState<ScopeKey>("any");
  const [sortBy, setSortBy] = useState<SortKey>("relevance");
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The body mounts on the client only, so the check runs in the browser.
  const [voice] = useState(() => hasSpeechRecognition());

  const q = query.trim();
  const isMember = !isGuest;
  const aiVisible = railApps.some((a) => a.key === "ai");
  const setQuery = (v: string) => {
    setQueryState(v);
    setActive(0);
  };
  const setChip = (v: ChipKey) => {
    setChipState(v);
    setActive(0);
  };

  // Live results: 2+ chars, 180ms debounce. The answer carries its query, so
  // a stale one is simply not the current one; nothing is aborted, because
  // apiFetch reads an aborted fetch as "offline" and would raise the offline
  // strip on every keystroke.
  useEffect(() => {
    if (q.length < 2) return;
    let stale = false;
    const t = window.setTimeout(async () => {
      setSearch({ q, status: "loading", hits: [] });
      const r = await apiFetch<ServerHit[] | { data?: ServerHit[] }>(
        `/api/search?q=${encodeURIComponent(q)}`,
      );
      if (stale) return;
      if (!r.ok) {
        setSearch({ q, status: "failed", hits: [] });
        return;
      }
      const d = r.data;
      setSearch({
        q,
        status: "ok",
        hits: Array.isArray(d) ? d : (d?.data ?? []),
      });
    }, 180);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [q, attempt]);
  // MESSAGES. spec-talk 2.1 Top bar: "when Talk is on the palette gains a
  // 'Messages' group backed by GET /api/conversations/search-messages?q=".
  // This is where cross-conversation message search lives now; it used to
  // ride the Talk sidebar's own search box, which spec-talk section 1 says
  // "never searches messages", and whose hits linked to the conversation
  // with no ?m=, so a result dropped you at the bottom of the channel rather
  // than at the message you had searched for (comms #30).
  //
  // A separate request from /api/search on purpose: it is module-gated, it
  // answers a different shape, and a failure in it must not take the rest of
  // the palette's results with it.
  const talkOn = Array.isArray(prefs.modules?.activeAppKeys) && prefs.modules.activeAppKeys.includes("chat");
  // The answer carries the query it answered, so a stale one is simply not
  // the current one and nothing has to be cleared synchronously in the
  // effect. Same shape as the /api/search state above, for the same reason.
  const [msgSearch, setMsgSearch] = useState<{ q: string; hits: MessageHit[] }>({ q: "", hits: [] });
  useEffect(() => {
    if (!talkOn || q.length < 2) return;
    let stale = false;
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ results?: MessageHit[] }>(
        `/api/conversations/search-messages?q=${encodeURIComponent(q)}`,
      );
      if (stale) return;
      setMsgSearch({ q, hits: r.ok ? (r.data?.results ?? []) : [] });
    }, 180);
    return () => { stale = true; window.clearTimeout(t); };
  }, [talkOn, q, attempt]);
  const messageHits = talkOn && q.length >= 2 && msgSearch.q === q ? msgSearch.hits : EMPTY_MESSAGE_HITS;
  const viewerId = boot.viewer.id;

  const current = search && search.q === q && q.length >= 2 ? search : null;
  const live = current?.status === "ok" ? current.hits : [];
  const searching =
    q.length >= 2 && current?.status !== "ok" && current?.status !== "failed";
  const failed = current?.status === "failed";

  const createDoc = useCallback(async () => {
    const r = await apiFetch<{ doc?: { id?: string } }>("/api/docs", {
      method: "POST",
      json: {
        title: "Untitled doc",
        content: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });
    const id = r.ok ? r.data?.doc?.id : undefined;
    if (!id) {
      toast("Couldn't create doc. Try again");
      return;
    }
    router.push(objectHrefNow("doc", id));
  }, [router, toast]);

  const tool = useCallback((detail: "reminder" | "notepad" | "voice") => {
    // The three capture overlays listen for this until their rewrite (2.19 to 2.21).
    window.setTimeout(
      () => window.dispatchEvent(new CustomEvent("workwrk:tool", { detail })),
      0,
    );
  }, []);

  const appRow = useCallback(
    (a: AppEntry): Row => {
      const hub = a.hubKey ?? (isHubKey(a.key) ? a.key : "home");
      const label = isHubKey(a.key) ? HUB_LABELS[a.key] : a.label;
      const Icon = a.Icon as LucideIcon;
      return {
        id: `app-${a.key}`,
        label,
        secondary: a.hubKey ? HUB_LABELS[hub] : undefined,
        glyph: <Glyph icon={Icon} />,
        href: hubHref(a.key),
      };
    },
    [hubHref],
  );

  const createRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    if (isMember)
      rows.push({
        id: "c-task",
        label: "Task",
        glyph: <Glyph icon={CheckSquare} />,
        shortcut: shortcutHint("create-task"),
        action: () => openCreateTask(),
      });
    rows.push({
      id: "c-doc",
      label: "Doc",
      glyph: <Glyph icon={FileText} />,
      action: () => {
        void createDoc();
      },
    });
    if (isMember)
      rows.push({
        id: "c-list",
        label: "List",
        glyph: <Glyph icon={ListTodo} />,
        action: () => openCreateList(),
      });
    if (isMember)
      rows.push({
        // spec-planner section 2 `/planner`: "command palette 'Calendar'
        // (navigate) and 'New event' (action)". The jump row for Calendar
        // is the Planner hub row below; this is the action half.
        //
        // A ROUTE, NOT A WINDOW EVENT: the composer lives on /planner and
        // the palette opens from anywhere, so a window event would do
        // nothing on every page but one. The Calendar consumes `?new=event`
        // on arrival and strips it.
        id: "c-event",
        label: "Event",
        glyph: <Glyph icon={CalendarDays} />,
        href: "/planner?new=event",
      });
    rows.push({
      id: "c-reminder",
      label: "Reminder",
      glyph: <Glyph icon={AlarmClock} />,
      action: () => tool("reminder"),
    });
    rows.push({
      id: "c-notepad",
      label: "Notepad",
      glyph: <Glyph icon={NotebookPen} />,
      action: () => tool("notepad"),
    });
    if (voice)
      rows.push({
        id: "c-voice",
        label: "Voice note",
        glyph: <Glyph icon={Mic} />,
        action: () => tool("voice"),
      });
    return rows;
  }, [isMember, voice, openCreateTask, openCreateList, createDoc, tool]);

  const jumpRows = useMemo<Row[]>(() => {
    const personal: Row[] = [
      {
        id: "j-home",
        label: "Home",
        glyph: <Glyph icon={House} />,
        href: WORK_HOME_HREF,
        shortcut: shortcutHint("go-home"),
      },
      {
        id: "j-mywork",
        label: "My work",
        glyph: <Glyph icon={CheckSquare} />,
        href: "/my-work",
        shortcut: shortcutHint("go-my-work"),
      },
      {
        id: "j-inbox",
        label: SHELL_LABELS.inbox,
        glyph: <Glyph icon={Inbox} />,
        href: "/inbox",
        shortcut: shortcutHint("go-inbox"),
      },
    ];
    // The three Work-hub pages that have no rail app of their own, so without
    // a row here the palette cannot reach them. spec-work-home section 2 names
    // the palette as an entry point for each. None of them exist for a Guest,
    // whose access row grants My work and Inbox and nothing else.
    if (isMember) {
      personal.push(
        { id: "j-everything", label: "Everything", glyph: <Glyph icon={Layers} />, href: "/everything" },
        { id: "j-favorites", label: "Favorites", glyph: <Glyph icon={Star} />, href: "/favorites" },
        { id: "j-activity", label: "Activity", glyph: <Glyph icon={Activity} />, href: "/activity" },
      );
    }
    const hubs = launcherApps.filter((a) => isHubKey(a.key)).map(appRow);
    const folded = launcherApps.filter((a) => !isHubKey(a.key)).map(appRow);
    return [...personal, ...hubs, ...folded];
  }, [launcherApps, appRow, isMember]);

  const recentRows = useMemo<Row[]>(() => {
    const byKey = new Map(launcherApps.map((a) => [a.key, a]));
    return recentAppKeys
      .map((k) => byKey.get(k))
      .filter((a): a is AppEntry => Boolean(a))
      .slice(0, 5)
      .map((a) => ({ ...appRow(a), id: `recent-${a.key}` }));
  }, [recentAppKeys, launcherApps, appRow]);

  const settingsRows = useCallback(
    (text: string): Row[] => {
      const pages = filterSettingsPages(text, isAdmin ? undefined : "me");
      const pageRows: Row[] = pages
        .map((p) => ({ p, href: settingsHrefToday(p) }))
        .filter((x): x is { p: (typeof pages)[number]; href: string } =>
          Boolean(x.href),
        )
        .map(({ p, href }) => ({
          id: `set-${p.key}`,
          label: p.label,
          secondary:
            p.door === "workspace"
              ? SHELL_LABELS.workspaceSettings
              : SHELL_LABELS.mySettings,
          glyph: <Glyph icon={Settings2} />,
          action: () => openSettings(href),
        }));
      // Per-SETTING entries that live outside the settings door (the three
      // acknowledgement defaults on /sops/manage). Listed only for a viewer
      // who passes the entry's org gate, and only against a typed query, so
      // the empty-query Settings group stays the pages list.
      const entryRows: Row[] = text.trim()
        ? filterSettingsEntries(text, { allowedExternalGates: canManageProcess ? ["manage_process"] : [] }).map((e) => ({
            id: `setting-${e.id}`,
            label: e.label,
            secondary: e.description,
            glyph: <Glyph icon={Settings2} />,
            action: () => router.push(e.href),
          }))
        : [];
      return [...pageRows, ...entryRows];
    },
    [isAdmin, canManageProcess, openSettings, router],
  );

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (q.length === 0) {
      if (chip === "all" || chip === "app") {
        if (chip === "all" && recentRows.length > 0)
          out.push({
            key: "recent",
            label: "Recent",
            chip: "any",
            rows: recentRows,
          });
        out.push({
          key: "jump",
          label: "Jump to",
          chip: "app",
          rows: jumpRows,
        });
      }
      if (chip === "all")
        out.push({
          key: "create",
          label: "Create",
          chip: "any",
          rows: createRows,
        });
      if (chip === "settings")
        out.push({
          key: "settings",
          label: "Settings",
          chip: "settings",
          rows: settingsRows(""),
        });
      return out;
    }
    const lq = q.toLowerCase();
    const groups: Record<LiveKind, Row[]> =
      { task: [], doc: [], person: [], space: [], table: [], form: [], more: [] };
    const scoped = live.filter((h) => {
      const kind = SEARCH_TYPES[h.type];
      if (scope === "tasks") return kind === "task";
      if (scope === "docs") return kind === "doc";
      return true;
    });
    const sortedLive =
      sortBy === "relevance"
        ? scoped
        : [...scoped].sort((a, b) => (sortBy === "name" ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title)));
    for (const h of sortedLive) {
      const kind = SEARCH_TYPES[h.type];
      if (!kind || !h.href) continue;
      const row: Row = {
        id: `live-${h.type}-${h.id}`,
        label: h.title,
        secondary: h.subtitle,
        href: h.href,
        glyph:
          kind === "task" ? (
            <Glyph icon={CheckSquare} />
          ) : kind === "person" ? (
            <PersonGlyph name={h.title} />
          ) : kind === "table" ? (
            <Glyph icon={Table2} />
          ) : kind === "form" ? (
            <Glyph icon={ClipboardList} />
          ) : kind === "more" ? (
            <Glyph icon={MORE_ICON[h.type] ?? Search} />
          ) : (
            <EntityTile
              size="xs"
              name={h.title}
              fallback={
                h.type === "folder"
                  ? "folder"
                  : h.type === "board"
                    ? "list"
                    : h.type === "space"
                      ? undefined
                      : "doc"
              }
            />
          ),
      };
      groups[kind].push(row);
    }
    const apps = [...jumpRows.slice(0, 3), ...launcherApps.map(appRow)].filter(
      (r) => r.label.toLowerCase().includes(lq),
    );
    const settings = settingsRows(q);
    const actions: Row[] = [];
    if (aiVisible && isMember)
      actions.push({
        id: "a-ai",
        label: `Ask AI about "${q}"`,
        glyph: <Glyph icon={Sparkles} />,
        shortcut: shortcutHint("ask-ai"),
        action: () => openSidekick(q),
      });
    if (isMember)
      actions.push({
        id: "a-task",
        label: "Create a task",
        glyph: <Glyph icon={CheckSquare} />,
        shortcut: shortcutHint("create-task"),
        action: () => openCreateTask(),
      });
    const want = (k: ChipKey) => chip === "all" || chip === k;
    if (want("task"))
      out.push({
        key: "tasks",
        label: "Tasks",
        chip: "task",
        rows: groups.task,
      });
    if (want("doc"))
      out.push({ key: "docs", label: "Docs", chip: "doc", rows: groups.doc });
    if (want("person"))
      out.push({
        key: "people",
        label: "People",
        chip: "person",
        rows: groups.person,
      });
    if (want("space"))
      out.push({
        key: "spaces",
        label: "Spaces & Lists",
        chip: "space",
        rows: groups.space,
      });
    if (chip === "all" && groups.table.length > 0)
      out.push({ key: "tables", label: "Tables", chip: "any", rows: groups.table });
    if (chip === "all" && groups.form.length > 0)
      out.push({ key: "forms", label: "Forms", chip: "any", rows: groups.form });
    if (chip === "all" && messageHits.length > 0)
      out.push({
        key: "messages",
        label: "Messages",
        chip: "any",
        rows: messageHits.slice(0, 8).map((h) => {
          const where = h.conversationType === "CHANNEL"
            ? `#${h.conversationName ?? "channel"}`
            : h.conversationName
              || h.members.filter((m) => m.user.id !== viewerId)
                .map((m) => `${m.user.firstName} ${m.user.lastName}`.trim()).join(", ")
              || "Direct message";
          return {
            id: `msg-${h.messageId}`,
            label: `${h.author.firstName}: ${h.snippet}`,
            secondary: h.inThread ? `${where} · in thread` : where,
            // ?m= is what makes the hit land ON the message.
            href: `/tlk/${h.conversationId}?m=${encodeURIComponent(h.messageId)}`,
            glyph: <Glyph icon={MessageSquare} />,
          };
        }),
      });
    if (chip === "all")
      out.push({ key: "more", label: "More", chip: "any", rows: groups.more });
    if (want("app"))
      out.push({ key: "apps", label: "Apps", chip: "app", rows: apps });
    if (want("settings"))
      out.push({
        key: "settings",
        label: "Settings",
        chip: "settings",
        rows: settings,
      });
    if (chip === "all")
      out.push({
        key: "actions",
        label: "Actions",
        chip: "any",
        rows: actions,
      });
    return out.filter((s) => s.rows.length > 0);
  }, [
    q,
    chip,
    scope,
    sortBy,
    live,
    recentRows,
    jumpRows,
    createRows,
    settingsRows,
    launcherApps,
    appRow,
    aiVisible,
    isMember,
    openSidekick,
    openCreateTask,
    messageHits,
    viewerId,
  ]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  // The highlight never points past the list when results shrink under it.
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1));

  const activate = useCallback(
    (row: Row, newTab = false) => {
      if (row.href && newTab) {
        window.open(sectionHrefNow(row.href), "_blank", "noopener");
        return;
      }
      closePalette();
      if (row.href) router.push(sectionHrefNow(row.href));
      else row.action?.();
    },
    [closePalette, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const row = flat[activeIdx];
      if (row) {
        e.preventDefault();
        activate(row, e.metaKey || e.ctrlKey);
      }
    } else if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      query === ""
    ) {
      e.preventDefault();
      const i = CHIPS.findIndex((c) => c.key === chip);
      const next =
        e.key === "ArrowRight"
          ? (i + 1) % CHIPS.length
          : (i - 1 + CHIPS.length) % CHIPS.length;
      setChip(CHIPS[next].key);
    }
  };

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const hint = q.length >= 2;
  let runningIdx = -1;

  return (
    <DialogPrimitive.Content
      aria-label={SHELL_LABELS.search}
      aria-describedby={undefined}
      onKeyDown={onKeyDown}
      className="workwrk-os os-chrome fixed inset-x-0 mx-auto top-[12vh] z-[61] flex max-h-[76vh] w-[640px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-line bg-raised text-ink shadow-[var(--os-shadow-modal)] outline-none"
    >
      <DialogPrimitive.Title className="sr-only">
        {SHELL_LABELS.search}
      </DialogPrimitive.Title>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <Search
          className="h-4 w-4 shrink-0 text-ink-3"
          strokeWidth={1.5}
          aria-hidden
        />
        <input
          ref={inputRef}
          data-palette-search
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or type a command…"
          aria-label={SHELL_LABELS.search}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        ) : null}
        <kbd className="rounded border border-line bg-kbd px-1.5 font-sans text-[11px] font-medium text-ink-2">
          esc
        </kbd>
      </div>

      <div
        role="radiogroup"
        aria-label="Search in"
        className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3"
      >
        {CHIPS.map((c) => {
          const on = chip === c.key;
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={-1}
              onClick={() => {
                setChip(c.key);
                inputRef.current?.focus();
              }}
              className={cn(
                "h-8 shrink-0 rounded-md px-3 text-sm font-medium",
                on
                  ? "bg-active text-ink"
                  : "text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto py-1"
        role="listbox"
        aria-label="Results"
      >
        {failed ? (
          <div className="flex h-9 items-center gap-1 px-4 text-sm text-ink-2">
            <span>Search isn&apos;t available right now</span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="font-medium text-brand-deep hover:underline"
            >
              Try again
            </button>
          </div>
        ) : null}
        {hint && !failed && !searching && live.length === 0 ? (
          <div className="flex h-9 items-center px-4 text-sm text-ink-2">
            No results for &ldquo;{q}&rdquo;
          </div>
        ) : null}
        {q.length > 0 && q.length < 2 ? (
          <div className="flex h-9 items-center px-4 text-sm text-ink-2">
            Keep typing to search
          </div>
        ) : null}
        {q.length === 0 &&
        (chip === "task" ||
          chip === "doc" ||
          chip === "person" ||
          chip === "space") ? (
          <div className="flex h-9 items-center px-4 text-sm text-ink-2">
            Type to search{" "}
            {CHIPS.find((c) => c.key === chip)?.label.toLowerCase()}
          </div>
        ) : null}
        {sections.map((s) => (
          <div key={s.key}>
            <div className="px-4 pb-1 pt-2 text-micro uppercase tracking-[0.06em] text-ink-2">
              {s.label}
            </div>
            {s.rows.map((row) => {
              runningIdx += 1;
              const idx = runningIdx;
              const on = idx === activeIdx;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-idx={idx}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(idx)}
                  onClick={(e) => activate(row, e.metaKey || e.ctrlKey)}
                  className={cn(
                    "flex h-9 w-full items-center gap-3 px-4 text-start text-base text-ink",
                    on ? "bg-active" : "hover:bg-hover",
                  )}
                >
                  <span className="inline-flex w-5 shrink-0 items-center justify-center">
                    {row.glyph}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.secondary ? (
                    <span className="min-w-0 max-w-[45%] truncate text-sm text-ink-2">
                      {row.secondary}
                    </span>
                  ) : null}
                  {row.shortcut ? (
                    <kbd className="shrink-0 font-sans text-xs font-medium text-ink-3">
                      {row.shortcut}
                    </kbd>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
        {searching ? (
          <div aria-hidden className="py-1">
            {["60%", "40%", "80%"].map((w, i) => (
              <div key={i} className="flex h-9 items-center gap-3 px-4">
                <span className="h-4 w-4 shrink-0 rounded bg-skeleton os-skeleton-pulse" />
                <span
                  className="h-3.5 rounded bg-skeleton os-skeleton-pulse"
                  style={{ width: w }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap border-t border-line px-4 text-xs font-medium text-ink-3">
        <span>↑↓ move</span>
        <span aria-hidden>·</span>
        <span>↵ open</span>
        <span aria-hidden className={hint ? "max-md:hidden" : undefined}>·</span>
        <span className={hint ? "max-md:hidden" : undefined}>⌘↵ open in new tab</span>
        <span aria-hidden>·</span>
        <span>esc close</span>
        <span className="flex-1" />
        {/* With results on screen the scope and sort controls take the
            footer's right end and the workspace name yields to them. */}
        {hint ? (
          <>
            <FooterPick label="Scope" value={scope} options={SCOPES} onChange={(v) => { setScope(v); setActive(0); }} />
            <FooterPick label="Sort" value={sortBy} options={SORTS} onChange={(v) => { setSortBy(v); setActive(0); }} />
          </>
        ) : (
          <span className="truncate">{boot.org.name}</span>
        )}
      </div>
    </DialogPrimitive.Content>
  );
}

/**
 * The footer's Scope and Sort pickers: a 24px text button that opens a
 * MenuList above it (the footer is the dialog's last row), on the tokens,
 * instead of a native <select> painting an OS dropdown inside the palette.
 * Enter or Space opens, arrow keys move, Escape closes the menu only.
 */
function FooterPick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ key: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.key === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!hostRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={hostRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium hover:bg-hover hover:text-ink",
          open ? "bg-active text-ink" : "text-ink-2",
        )}
      >
        <span className="text-ink-3">{label}</span>
        {current.label}
        <ChevronDown className="h-3 w-3" strokeWidth={1.5} aria-hidden />
      </button>
      {open ? (
        <div className="absolute bottom-full end-0 z-20 mb-1" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
          <MenuList style={{ minWidth: 168 }} aria-label={label}>
            {options.map((o) => (
              <MenuItem
                key={o.key}
                label={o.label}
                selected={o.key === value}
                onClick={() => { onChange(o.key); setOpen(false); }}
              />
            ))}
          </MenuList>
        </div>
      ) : null}
    </div>
  );
}
