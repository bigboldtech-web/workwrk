"use client";

// My Tasks — ClickUp parity (Phase A, 2026-06-06).
// Greeting + draggable/resizable card grid powered by react-grid-layout.
// Layout persists per-user in UserPreference.home.taskCardLayout. Cards:
//   recents · agenda · personal-list · assigned-to-me · reminders ·
//   assigned-comments · ai-standup · priorities · my-work

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Settings, GripVertical, MoreHorizontal, Maximize2, Plus,
  List as ListIcon, CheckSquare, MessageSquare, Bell, X,
  Calendar as CalendarIcon, Sparkles, Filter, Users as UsersIcon,
} from "lucide-react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface RecentItem {
  id: string;
  title: string;
  type: "list" | "doc" | "item";
  parent: string;
  href: string;
}

interface MyItemRow {
  id: string;
  title: string;
  status: string | null;
  dueAt: string | null;
  board: { slug: string; name: string } | null;
}

type LayoutShape = Record<string, Layout[]>;

const DEFAULT_LAYOUTS: LayoutShape = {
  lg: [
    { i: "recents",           x: 0, y: 0,  w: 6, h: 6 },
    { i: "agenda",            x: 6, y: 0,  w: 6, h: 6 },
    { i: "personal-list",     x: 0, y: 6,  w: 6, h: 5 },
    { i: "assigned-to-me",    x: 6, y: 6,  w: 6, h: 5 },
    { i: "reminders",         x: 0, y: 11, w: 6, h: 5 },
    { i: "assigned-comments", x: 6, y: 11, w: 6, h: 4 },
    { i: "ai-standup",        x: 0, y: 16, w: 6, h: 5 },
    { i: "priorities",        x: 6, y: 15, w: 6, h: 5 },
    { i: "my-work",           x: 0, y: 21, w: 12, h: 5 },
  ],
  md: [
    { i: "recents",           x: 0, y: 0,  w: 6, h: 6 },
    { i: "agenda",            x: 6, y: 0,  w: 6, h: 6 },
    { i: "personal-list",     x: 0, y: 6,  w: 6, h: 5 },
    { i: "assigned-to-me",    x: 6, y: 6,  w: 6, h: 5 },
    { i: "reminders",         x: 0, y: 11, w: 6, h: 5 },
    { i: "assigned-comments", x: 6, y: 11, w: 6, h: 4 },
    { i: "ai-standup",        x: 0, y: 16, w: 6, h: 5 },
    { i: "priorities",        x: 6, y: 15, w: 6, h: 5 },
    { i: "my-work",           x: 0, y: 21, w: 12, h: 5 },
  ],
  sm: [
    { i: "recents",           x: 0, y: 0,  w: 12, h: 5 },
    { i: "agenda",            x: 0, y: 5,  w: 12, h: 5 },
    { i: "personal-list",     x: 0, y: 10, w: 12, h: 5 },
    { i: "assigned-to-me",    x: 0, y: 15, w: 12, h: 5 },
    { i: "reminders",         x: 0, y: 20, w: 12, h: 5 },
    { i: "assigned-comments", x: 0, y: 25, w: 12, h: 4 },
    { i: "ai-standup",        x: 0, y: 29, w: 12, h: 5 },
    { i: "priorities",        x: 0, y: 34, w: 12, h: 5 },
    { i: "my-work",           x: 0, y: 39, w: 12, h: 5 },
  ],
};

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5)  return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

export default function MyTasksPage() {
  const { data: session } = useSession();
  const u = session?.user as { firstName?: string; name?: string } | undefined;
  const firstName = u?.firstName || (u?.name ? u.name.split(" ")[0] : "there");

  const [recents, setRecents] = useState<RecentItem[] | null>(null);
  const [assigned, setAssigned] = useState<MyItemRow[] | null>(null);
  const [reminderNoteDismissed, setReminderNoteDismissed] = useState(false);
  const [layouts, setLayouts] = useState<LayoutShape>(DEFAULT_LAYOUTS);
  const [layoutsHydrated, setLayoutsHydrated] = useState(false);
  const [hiddenCards, setHiddenCards] = useState<Set<string>>(new Set());
  const [manageOpen, setManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showGreeting, setShowGreeting] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecents = useCallback(async () => {
    try {
      const res = await fetch("/api/spaces", { cache: "no-store" });
      if (!res.ok) { setRecents([]); return; }
      const data = await res.json();
      const list: RecentItem[] = (data.spaces ?? []).slice(0, 8).map((s: { id: string; slug: string; name: string }) => ({
        id: s.id,
        title: s.name,
        type: "list" as const,
        parent: "Spaces",
        href: `/spaces/${s.slug}`,
      }));
      setRecents(list);
    } catch { setRecents([]); }
  }, []);

  const loadAssigned = useCallback(async () => {
    try {
      const res = await fetch("/api/me/items?status=open", { cache: "no-store" });
      if (!res.ok) { setAssigned([]); return; }
      const data = await res.json();
      setAssigned(Array.isArray(data.items) ? data.items : []);
    } catch { setAssigned([]); }
  }, []);

  const loadLayout = useCallback(async () => {
    try {
      const res = await fetch("/api/preferences", { cache: "no-store" });
      if (!res.ok) { setLayoutsHydrated(true); return; }
      const data = await res.json();
      const stored = data?.effective?.home?.taskCardLayout;
      if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
        setLayouts({ ...DEFAULT_LAYOUTS, ...stored });
      }
      const hiddenArr = data?.effective?.home?.taskCardsHidden;
      if (Array.isArray(hiddenArr)) {
        setHiddenCards(new Set(hiddenArr));
      }
    } catch {}
    setLayoutsHydrated(true);
  }, []);

  const saveHidden = useCallback((next: Set<string>) => {
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ home: { taskCardsHidden: Array.from(next) } }),
    });
  }, []);

  const toggleCard = useCallback((key: string) => {
    setHiddenCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveHidden(next);
      return next;
    });
  }, [saveHidden]);

  useEffect(() => {
    const run = async () => { await loadRecents(); };
    void run();
  }, [loadRecents]);
  useEffect(() => {
    const run = async () => { await loadAssigned(); };
    void run();
  }, [loadAssigned]);
  useEffect(() => {
    const run = async () => { await loadLayout(); };
    void run();
  }, [loadLayout]);

  const saveLayout = useCallback((next: LayoutShape) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home: { taskCardLayout: next } }),
      });
    }, 600);
  }, []);

  const onLayoutChange = useCallback((_current: Layout[], all: LayoutShape) => {
    if (!layoutsHydrated) return;
    setLayouts(all);
    saveLayout(all);
  }, [layoutsHydrated, saveLayout]);

  // Cards keyed by `i` for the grid. Memoised so identity stays stable
  // across renders (react-grid-layout uses key identity for animation).
  const cards = useMemo(() => ({
    "recents":           <RecentsCard recents={recents} />,
    "agenda":            <AgendaCard />,
    "personal-list":     <PersonalListCard />,
    "assigned-to-me":    <AssignedToMeCard assigned={assigned} />,
    "reminders":         <RemindersCard dismissed={reminderNoteDismissed} onDismiss={() => setReminderNoteDismissed(true)} />,
    "assigned-comments": <AssignedCommentsCard />,
    "ai-standup":        <AiStandUpCard firstName={firstName} />,
    "priorities":        <PrioritiesCard />,
    "my-work":           <MyWorkCard />,
  }), [recents, assigned, reminderNoteDismissed, firstName]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Top header row */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-zinc-900">My Tasks</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 !px-3 rounded-md text-[12.5px] border"
            style={{
              background: "color-mix(in srgb, var(--os-brand-rail) 12%, white)",
              color: "var(--os-brand-rail)",
              borderColor: "color-mix(in srgb, var(--os-brand-rail) 20%, transparent)",
            }}
          >
            Manage cards
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Settings"
              aria-expanded={settingsOpen}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-zinc-500 hover:bg-zinc-100"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            {settingsOpen ? (
              <MyTasksSettingsPopover
                showGreeting={showGreeting}
                onShowGreetingChange={setShowGreeting}
                onClose={() => setSettingsOpen(false)}
              />
            ) : null}
          </div>
        </div>
      </div>

      <ManageCardsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        hidden={hiddenCards}
        onToggle={toggleCard}
      />

      {/* Greeting */}
      {showGreeting ? (
        <div className="px-5 pb-3">
          <p className="text-[20px] font-semibold text-zinc-900">
            {timeGreeting()}, {firstName}
          </p>
        </div>
      ) : null}

      {/* Card grid (draggable + resizable) */}
      <div className="flex-1 overflow-y-auto px-3 pb-5">
        <ResponsiveGridLayout
          className="layout mytasks-grid"
          layouts={filterLayouts(layouts, hiddenCards)}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 12, sm: 12, xs: 6, xxs: 4 }}
          rowHeight={52}
          margin={[12, 12]}
          draggableCancel="a,button,input,textarea,select"
          resizeHandles={["n", "e", "s", "w", "ne", "nw", "se", "sw"]}
          compactType="vertical"
          isDraggable
          isResizable
          onLayoutChange={onLayoutChange}
        >
          {Object.entries(cards)
            .filter(([key]) => !hiddenCards.has(key))
            .map(([key, node]) => (
              <div key={key}>
                {node}
              </div>
            ))}
        </ResponsiveGridLayout>
      </div>
    </div>
  );
}

// ─── Card components ────────────────────────────────────────────────

function RecentsCard({ recents }: { recents: RecentItem[] | null }) {
  return (
    <DashCard title="Recents" actions={<CardEyebrow />}>
      {recents === null ? <CardLoading /> :
        recents.length === 0 ? <CardEmpty>Nothing recent yet.</CardEmpty> : (
          <ul className="-mx-2">
            {recents.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.href}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 rounded text-[12.5px]"
                >
                  <ListIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="text-zinc-900 truncate">{r.title}</span>
                  <span className="text-zinc-400 shrink-0">·</span>
                  <span className="text-zinc-500 truncate">in {r.parent}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </DashCard>
  );
}

function AgendaCard() {
  return (
    <DashCard title="Agenda" actions={<CardEyebrow />}>
      <div className="flex flex-col items-center justify-center text-center py-2">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100 mb-2">
          <CalendarIcon className="w-5 h-5 text-zinc-500" />
        </span>
        <p className="text-[11.5px] text-zinc-600 mb-4 max-w-[260px]">
          Connect your calendar to view upcoming events and join your next call
        </p>
        <div className="w-full space-y-2 max-w-[340px]">
          <CalendarConnect provider="Google Calendar" tone="multicolor" />
          <CalendarConnect provider="Microsoft Outlook" tone="blue" />
        </div>
      </div>
    </DashCard>
  );
}

function PersonalListCard() {
  return (
    <DashCard title="Personal List" titleHint>
      <div className="flex flex-col items-center justify-center text-center py-6">
        <span className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-zinc-200 mb-2">
          <CheckSquare className="w-5 h-5 text-zinc-400" />
        </span>
        <p className="text-[12px] text-zinc-600 mb-3 max-w-[260px]">
          Personal List is a home for your tasks. <Link href="#" className="underline">Learn more</Link>
        </p>
        <button
          type="button"
          className="text-[12.5px] px-3 py-1.5 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Create a task
        </button>
      </div>
    </DashCard>
  );
}

function AssignedToMeCard({ assigned }: { assigned: MyItemRow[] | null }) {
  return (
    <DashCard
      title="Assigned to me"
      actions={
        <>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-zinc-700 hover:bg-zinc-100"
            title="Due date"
          >
            <CalendarIcon className="w-3 h-3" />
            Due date
          </button>
          <CardEyebrow />
          <button
            type="button"
            aria-label="Add"
            className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </>
      }
    >
      {assigned === null ? <CardLoading /> :
        assigned.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-4">
            <CheckSquare className="w-6 h-6 text-zinc-300 mb-2" />
            <p className="text-[12px] text-zinc-500">
              Tasks assigned to you will appear here.
            </p>
          </div>
        ) : (
          <ul className="-mx-2">
            {assigned.slice(0, 8).map((it) => (
              <li key={it.id}>
                <Link
                  href={it.board ? `/boards/${it.board.slug}?item=${it.id}` : "#"}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 rounded text-[12.5px]"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <span className="text-zinc-900 truncate flex-1">{it.title}</span>
                  {it.board ? (
                    <span className="text-[11px] text-zinc-500 truncate max-w-[140px]">{it.board.name}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
    </DashCard>
  );
}

function RemindersCard({ dismissed, onDismiss }: { dismissed: boolean; onDismiss: () => void }) {
  return (
    <DashCard title="Reminders">
      {!dismissed ? (
        <div className="text-[11.5px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mb-3 flex items-start gap-2">
          <span className="flex-1">
            Note: You can still create legacy Reminders here, but Reminders created elsewhere will now go to Inbox.{" "}
            <Link href="#" className="underline">Learn more</Link>
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="p-0.5 rounded hover:bg-zinc-200 text-zinc-500 shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : null}
      <div className="flex flex-col items-center justify-center text-center py-4">
        <Bell className="w-6 h-6 text-zinc-300 mb-2" />
        <p className="text-[12px] text-zinc-500 mb-3">
          Added Reminders will show here. <Link href="#" className="underline">Learn more</Link>
        </p>
        <button
          type="button"
          className="text-[12.5px] px-3 py-1.5 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add reminder
        </button>
      </div>
    </DashCard>
  );
}

function AssignedCommentsCard() {
  return (
    <DashCard title="Assigned comments">
      <div className="flex flex-col items-center justify-center text-center py-4">
        <MessageSquare className="w-6 h-6 text-zinc-300 mb-2" />
        <p className="text-[12px] text-zinc-500">
          You don&apos;t have any assigned comments.{" "}
          <Link href="/assigned-comments" className="underline">Learn more</Link>
        </p>
      </div>
    </DashCard>
  );
}

function AiStandUpCard({ firstName }: { firstName: string }) {
  return (
    <DashCard
      title="AI StandUp"
      subtitle="Last 7 days"
      titleIcon={<Sparkles className="w-3.5 h-3.5 text-violet-500" />}
      actions={
        <>
          <button type="button" aria-label="Refresh" className="p-1 rounded hover:bg-zinc-100 text-zinc-500" title="Refresh">
            <Filter className="w-3.5 h-3.5" />
          </button>
          <CardEyebrow />
        </>
      }
    >
      <div className="space-y-3">
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-[11px]">
          <Sparkles className="w-3 h-3" />
          Brain
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Overview</p>
          <p className="text-[12.5px] text-zinc-700">
            There is no recorded activity for {firstName} in the last 7 days.
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Key Highlights</p>
          <ul className="text-[12.5px] text-zinc-700 list-disc pl-4 space-y-0.5">
            <li>No tasks or updates to report for this period.</li>
          </ul>
        </div>
      </div>
    </DashCard>
  );
}

function PrioritiesCard() {
  return (
    <DashCard title="Priorities" titleHint>
      <div className="flex flex-col items-center justify-center text-center py-6">
        <span className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-zinc-200 mb-2">
          <CheckSquare className="w-5 h-5 text-zinc-400" />
        </span>
        <p className="text-[12px] text-zinc-600 mb-3 max-w-[280px]">
          Priorities keep your most important tasks in one list.{" "}
          <Link href="#" className="underline">Learn more</Link>
        </p>
        <button
          type="button"
          className="text-[12.5px] px-3 py-1.5 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Create a task
        </button>
      </div>
    </DashCard>
  );
}

function MyWorkCard() {
  return (
    <DashCard title="My Work">
      <div className="flex flex-col items-center justify-center text-center py-8">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-lg border border-zinc-200 mb-2">
          <UsersIcon className="w-5 h-5 text-zinc-400" />
        </span>
        <p className="text-[12px] text-zinc-600 mb-3 max-w-[320px]">
          Tasks and Reminders assigned to you will appear here.{" "}
          <Link href="#" className="underline">Learn more</Link>
        </p>
        <button
          type="button"
          className="text-[12.5px] px-3 py-1.5 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add task or reminder
        </button>
      </div>
    </DashCard>
  );
}

// ─── Shared chrome ──────────────────────────────────────────────────

function DashCard({
  title,
  subtitle,
  titleIcon,
  titleHint,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  titleIcon?: React.ReactNode;
  titleHint?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="h-full w-full rounded-lg border border-zinc-200 bg-white p-3 flex flex-col overflow-hidden">
      <div className="dash-card-handle flex items-center justify-between mb-2.5 cursor-grab active:cursor-grabbing select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <GripVertical className="w-3 h-3 text-zinc-300 shrink-0" />
          {titleIcon}
          <h2 className="text-[13px] font-semibold text-zinc-900 truncate">{title}</h2>
          {subtitle ? (
            <span className="text-[11.5px] text-zinc-500 truncate">({subtitle})</span>
          ) : null}
          {titleHint ? (
            <span
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-zinc-300 text-[9px] text-zinc-400 shrink-0"
              title="Card info"
              aria-hidden
            >
              i
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          {actions ?? <CardEyebrow />}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function CardEyebrow() {
  return (
    <>
      <button type="button" aria-label="Expand" className="p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700">
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
      <button type="button" aria-label="More" className="p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
    </>
  );
}

function CardLoading() {
  return <div className="text-[12px] text-zinc-400 py-3 text-center">Loading…</div>;
}

function CardEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-zinc-500 px-2 py-3">{children}</p>;
}

const CARD_CATALOG: Array<{ key: string; label: string; description: string; accent: string }> = [
  { key: "ai-standup",        label: "AI StandUp",        description: "AI generated standup.", accent: "from-violet-500 to-indigo-500" },
  { key: "recents",           label: "Recents",           description: "A list of all the objects and locations you've recently viewed.", accent: "from-sky-500 to-blue-500" },
  { key: "agenda",            label: "Agenda",            description: "Visualize tasks and events on your different calendars in one place.", accent: "from-purple-500 to-fuchsia-500" },
  { key: "my-work",           label: "My Work",           description: "A list for all of your assigned tasks and reminders.", accent: "from-indigo-500 to-violet-500" },
  { key: "assigned-to-me",    label: "Assigned to me",    description: "Consolidate your tasks across different lists that you have as an assignee.", accent: "from-indigo-500 to-violet-500" },
  { key: "personal-list",     label: "Personal List",     description: "Keep track of your personal tasks in a list that is only visible to you.", accent: "from-indigo-500 to-violet-500" },
  { key: "assigned-comments", label: "Assigned Comments", description: "Resolve and view any comment that has been assigned to you.", accent: "from-teal-500 to-cyan-500" },
  { key: "priorities",        label: "Priorities",        description: "Prioritize your most important tasks into one concise list.", accent: "from-indigo-500 to-violet-500" },
  { key: "reminders",         label: "Reminders",         description: "Add reminders that sit alongside tasks.", accent: "from-orange-500 to-amber-500" },
];

function filterLayouts(layouts: LayoutShape, hidden: Set<string>): LayoutShape {
  const out: LayoutShape = {};
  for (const [bp, items] of Object.entries(layouts)) {
    out[bp] = items.filter((it) => !hidden.has(it.i));
  }
  return out;
}

function MyTasksSettingsPopover({
  showGreeting,
  onShowGreetingChange,
  onClose,
}: {
  showGreeting: boolean;
  onShowGreetingChange: (value: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-zinc-200 bg-white p-5 shadow-lg">
        <p className="mb-4 text-[13px] font-medium text-zinc-500">Layout</p>
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-zinc-900">Page greeting</span>
          <button
            type="button"
            role="switch"
            aria-checked={showGreeting}
            onClick={() => onShowGreetingChange(!showGreeting)}
            className={`relative h-5 w-9 rounded-full border transition-colors ${
              showGreeting
                ? "border-[var(--os-brand-rail)] bg-[var(--os-brand-rail)]"
                : "border-zinc-200 bg-zinc-100"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${
                showGreeting ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </>
  );
}

function ManageCardsModal({
  open,
  onClose,
  hidden,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Add Cards">
      <div
        className="absolute inset-0 bg-transparent"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute right-1.5 top-10 bottom-1.5 z-10 w-[340px] max-w-[calc(100vw-24px)] rounded-xl border border-zinc-200 bg-white shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="text-[15px] font-semibold text-zinc-900">Add Cards</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-3 space-y-3">
          {CARD_CATALOG.map((c) => {
            const isHidden = hidden.has(c.key);
            return (
              <li key={c.key}>
                <article className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br ${c.accent} text-white shadow-sm`}>
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggle(c.key)}
                      className={`rounded-md !px-2 py-1 text-[11px] font-medium ${
                        isHidden
                          ? "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                          : "bg-[var(--os-brand-rail)] text-white"
                      }`}
                    >
                      {isHidden ? "Add" : "✓ Added"}
                    </button>
                  </div>
                  <h3 className="mb-1 text-[14px] font-semibold text-zinc-900">{c.label}</h3>
                  <p className="text-[12px] leading-5 text-zinc-500">{c.description}</p>
                </article>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}

function CalendarConnect({ provider, tone }: { provider: string; tone: "multicolor" | "blue" }) {
  const dot =
    tone === "multicolor"
      ? "bg-gradient-to-br from-red-400 via-yellow-400 to-green-500"
      : "bg-blue-600";
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md border border-zinc-200">
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-4 h-4 rounded-sm ${dot} shrink-0`} aria-hidden />
        <span className="text-[12.5px] text-zinc-800 truncate">{provider}</span>
      </span>
      <button
        type="button"
        disabled
        title="Coming soon"
        className="text-[11.5px] px-2.5 py-1 rounded bg-zinc-100 text-zinc-500 cursor-not-allowed"
      >
        Connect
      </button>
    </div>
  );
}
