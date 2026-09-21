"use client";

// The Home page body: six widgets on one aggregate call.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/home).
//
// TWO COLUMNS, THE ORDER IS YOURS. The page it replaces used
// react-grid-layout, so every widget was draggable and resizable and the
// geometry lived in `home.taskCardLayoutV3`. The refresh fixed the order and
// the founder named the layout control as a loss, so the middle ground: the
// stored `widgets` list IS the order (Display > Move up / Move down), each
// widget keeps its column (reading widgets left, glanceable widgets right),
// and the greeting line has its own switch. The two grid keys stay retired.
//
// ONE CALL, ONE REFRESH. Every widget comes from `GET /api/me/home`, so focus,
// visibility and the item-changed events re-fetch once rather than six times,
// and a widget whose server-side load failed arrives as `null` and says so
// with its own Retry. The page itself is never empty.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckSquare,
  ClipboardCheck,
  FileText,
  Inbox as InboxIcon,
  Trophy,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { HOME_WIDGET_KEYS, HOME_WIDGET_LABEL, visibleHomeWidgets, type HomeWidgetKey } from "@/lib/home-prefs";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useBoot } from "@/components/layout/os/boot-context";
import { reviewStatusChip, type HomePayload, type HomeTaskRow } from "@/lib/home-payload";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import { clockIn, inboxRowTime, type LocaleContext } from "@/lib/work-buckets";
import { DotsArt } from "@/components/ui/dots-art";
import { HomeWidget, WidgetGroupHeader } from "@/components/home/home-widget";
import { WorkTaskRow } from "@/components/home/work-task-row";

/** Dispatched by the create-task modal when a task is created. */
const ITEM_CREATED = "workwrk:item-created";

/** Which column each widget lives in. */
const LEFT_WIDGETS: ReadonlySet<HomeWidgetKey> = new Set(["my-work", "weekly-review", "recent-docs"]);

function greetingFor(now: Date, firstName: string | null | undefined): string {
  const h = now.getHours();
  const word = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${word}, ${firstName}` : word;
}

export function HomeClient({
  initialWidgets,
  initialGreeting = true,
  isGuest,
  widgetsUnknown = false,
}: {
  initialWidgets: HomeWidgetKey[];
  /** The greeting line above the widgets (`viewOptions.greeting`, default on). */
  initialGreeting?: boolean;
  isGuest: boolean;
  /**
   * The server could not read the stored widget choice. `initialWidgets` is
   * then the product default, which is a guess and not the person's setting,
   * so the client re-asks once rather than leaving them looking at a layout
   * they did not pick.
   */
  widgetsUnknown?: boolean;
}) {
  const { openCreateTask, patchPrefs } = useOsShell();
  const { toast } = useOsToast();
  const { boot } = useBoot();

  const [widgets, setWidgets] = useState<HomeWidgetKey[]>(initialWidgets);
  const [greeting, setGreeting] = useState(initialGreeting);
  const [data, setData] = useState<HomePayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  // One instant per render pass, so every date chip in one paint agrees.
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<HomePayload>("/api/me/home", { cache: "no-store" });
      if (!res.ok) {
        // The page-level failure, which is different from a widget-level one:
        // every widget shows its own Retry, driven by this same flag. Nothing
        // here renders an empty list on a failed read.
        setFailed(true);
        return;
      }
      setData(res.data);
      setFailed(false);
      setNow(new Date());
    } catch {
      // apiFetch resolves rather than throws, so this is the belt to its
      // braces: a surprise here must still land on the Retry state and never
      // on a page that looks like an empty inbox.
      setFailed(true);
    }
  }, []);

  // One effect: the first read and every re-read. `load` is the external
  // system this page synchronises with, and the listeners below are the
  // subscription half of the same job.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    // The first read goes through `refresh` too, so a page opened in a
    // background tab does not fetch until somebody looks at it, and then the
    // visibilitychange listener below fetches it, fresh, at that moment.
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    // The two events a task write fans out: the create modal's own, and the
    // one every item PATCH (and the SSE stream) emits.
    window.addEventListener(ITEM_CREATED, refresh);
    window.addEventListener(WINDOW_EVENTS.itemChanged, refresh);
    window.addEventListener(WINDOW_EVENTS.notifChanged, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(ITEM_CREATED, refresh);
      window.removeEventListener(WINDOW_EVENTS.itemChanged, refresh);
      window.removeEventListener(WINDOW_EVENTS.notifChanged, refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!widgetsUnknown) return;
    let alive = true;
    void (async () => {
      const res = await apiFetch<{ effective?: { home?: { work?: { surface?: Record<string, unknown> } } } }>(
        "/api/preferences",
        { cache: "no-store" },
      );
      if (!alive || !res.ok) return;
      const stored = (res.data.effective?.home?.work?.surface?.home as { viewOptions?: { widgets?: unknown } } | undefined)
        ?.viewOptions?.widgets;
      if (Array.isArray(stored)) {
        setWidgets(visibleHomeWidgets(stored as HomeWidgetKey[], isGuest));
      }
    })();
    return () => { alive = false; };
  }, [widgetsUnknown, isGuest]);

  const locale: LocaleContext = useMemo(
    () => ({ timeZone: data?.locale.timeZone ?? null, weekStart: data?.locale.weekStart ?? null }),
    [data?.locale.timeZone, data?.locale.weekStart],
  );

  // The viewer's choice, narrowed by their role. A Guest's `home` access row
  // grants My work and Inbox and nothing else, so the other four come back
  // `null` from the server: and `null` means "could not load", which would
  // leave a Guest staring at four "Couldn't load · Retry" widgets forever if
  // "Reset layout" ever switched them on. Narrowing here, at render, is what
  // makes Reset safe for everybody.
  const visible = useMemo(() => visibleHomeWidgets(widgets, isGuest), [widgets, isGuest]);
  const shows = useCallback((key: HomeWidgetKey) => visible.includes(key), [visible]);

  /** One write for the list: it is both which widgets show and in what order. */
  const persistWidgets = useCallback(
    async (next: HomeWidgetKey[], failure: string) => {
      const previous = widgets;
      setWidgets(next);
      const ok = await patchPrefs({ home: { work: { surface: { home: { viewOptions: { widgets: next } } } } } });
      if (!ok) {
        setWidgets(previous);
        toast(failure);
      }
    },
    [widgets, patchPrefs, toast],
  );

  const setWidgetVisible = useCallback(
    (key: HomeWidgetKey, on: boolean) => {
      // Switched on, a widget lands at the end of its list rather than back
      // in the product order: the order is the person's now.
      const next = on ? [...widgets.filter((k) => k !== key), key] : widgets.filter((k) => k !== key);
      void persistWidgets(next, "Couldn't save which widgets show");
    },
    [widgets, persistWidgets],
  );

  const moveWidget = useCallback(
    (key: HomeWidgetKey, dir: -1 | 1) => {
      const idx = widgets.indexOf(key);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= widgets.length) return;
      const next = [...widgets];
      [next[idx], next[to]] = [next[to], next[idx]];
      void persistWidgets(next, "Couldn't save the order");
    },
    [widgets, persistWidgets],
  );

  const setGreetingOn = useCallback(
    async (on: boolean) => {
      setGreeting(on);
      const ok = await patchPrefs({ home: { work: { surface: { home: { viewOptions: { greeting: on } } } } } });
      if (!ok) {
        setGreeting(!on);
        toast("Couldn't save the greeting setting");
      }
    },
    [patchPrefs, toast],
  );

  const resetLayout = useCallback(async () => {
    // Every widget back on. What a GUEST then sees is still two, because
    // `visible` narrows by role at render: the stored choice is the person's,
    // the role is the workspace's, and they are two different questions.
    const all = [...HOME_WIDGET_KEYS];
    setWidgets(all);
    setGreeting(true);
    const ok = await patchPrefs({ home: { work: { surface: { home: { viewOptions: { widgets: all, greeting: true } } } } } });
    if (!ok) toast("Couldn't reset the layout");
  }, [patchPrefs, toast]);

  // ── Completing a task from the widget ───────────────────────────
  //
  // Optimistic, undoable for five seconds, and honest on failure. The row's
  // OWN List decides which word "done" is: `doneStatus` came from the server
  // with the row, so ticking a task in a List whose done status is "Shipped"
  // writes "Shipped" and not a status that List has never heard of.
  const completeTask = useCallback(
    async (item: HomeTaskRow) => {
      if (!item.doneStatus) {
        toast("This list has no done status", { description: "Open the task to set its status." });
        return;
      }
      const previous = item.status;
      setCompleting((s) => new Set(s).add(item.id));
      const res = await apiFetch(`/api/items/${item.id}`, { method: "PATCH", json: { status: item.doneStatus } });
      setCompleting((s) => {
        const next = new Set(s);
        next.delete(item.id);
        return next;
      });
      if (!res.ok) {
        toast("Couldn't complete that task", { tone: "danger", description: res.error });
        return;
      }
      toast("Task completed", {
        onUndo: async () => {
          const undo = await apiFetch(`/api/items/${item.id}`, { method: "PATCH", json: { status: previous } });
          if (!undo.ok) toast("Couldn't undo that", { tone: "danger" });
          void load();
        },
      });
      void load();
    },
    [toast, load],
  );

  const loading = data === null && !failed;

  return (
    <>
      <OsPageHeader
        title="Home"
        askAi
        toolbar={{
          primary: { label: "Create task", onClick: () => openCreateTask() },
          menu: [
            { label: "Display", onClick: () => setDisplayOpen(true) },
            { label: "Reset layout", onClick: () => void resetLayout() },
          ],
        }}
      />

      {displayOpen ? (
        <div className="relative">
          <div className="absolute end-6 top-1 z-40">
            {/* Right-anchored: the wrapper sits at the right edge with zero
                width, so a start-aligned panel would grow off-screen and give
                the page a horizontal scrollbar. */}
            <DisplayPanel
              onClose={() => setDisplayOpen(false)}
              greeting={greeting}
              onGreeting={(on) => void setGreetingOn(on)}
              // A Guest is offered the two widgets their access grants, never
              // six switches four of which do nothing.
              keys={HOME_WIDGET_KEYS.filter((k) => !isGuest || initialWidgets.includes(k) || k === "my-work" || k === "inbox")}
              order={widgets}
              onToggle={setWidgetVisible}
              onMove={moveWidget}
            />
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Body weight on purpose: the page already has its one title
            ("Home"); a second 22px line under it read as two headings. */}
        {greeting ? (
          <p className="mx-auto mb-5 max-w-[1400px] text-base text-ink-2">
            {greetingFor(now, boot.viewer.firstName)}
          </p>
        ) : null}
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(560px,1fr)_360px]">
          {/* Left column: the reading widgets, in the person's order. */}
          <div className="flex min-w-0 flex-col gap-6">
            {visible.filter((k) => LEFT_WIDGETS.has(k)).map((k) => (
              <div key={k} className="contents">{renderWidget(k)}</div>
            ))}
          </div>
          {/* Right column: the glanceable widgets, in the person's order. */}
          <div className="flex min-w-0 flex-col gap-6">
            {visible.filter((k) => !LEFT_WIDGETS.has(k)).map((k) => (
              <div key={k} className="contents">{renderWidget(k)}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );

  /** One widget by key. Order and visibility are decided by the caller. */
  function renderWidget(key: HomeWidgetKey) {
    switch (key) {
      case "my-work":
        return (
              <MyWorkWidget
                data={data?.work ?? null}
                loading={loading}
                failed={failed || (data !== null && data.work === null)}
                retry={load}
                locale={locale}
                now={now}
                completing={completing}
                onComplete={completeTask}
                onAdd={() => openCreateTask()}
              />
        );
      case "weekly-review":
        return loading || data?.weeklyReview ? (
              <WeeklyReviewWidget data={data?.weeklyReview ?? null} loading={loading} />
        ) : null;
      case "recent-docs":
        return (
              <HomeWidget
                title="Recent docs"
                icon={FileText}
                loading={loading}
                error={failed || (data !== null && data.recentDocs === null) ? { retry: load } : undefined}
                isEmpty={(data?.recentDocs?.rows.length ?? 0) === 0}
                empty={{ sentence: "Nothing opened yet" }}
                footer={{ label: "Open Docs", href: "/docs" }}
              >
                <ul>
                  {(data?.recentDocs?.rows ?? []).map((d) => (
                    <li key={d.id} className="border-b border-line-soft last:border-b-0">
                      <Link
                        href={`/docs/${d.id}`}
                        className="flex items-center gap-2.5 px-4 hover:bg-hover"
                        style={{ minHeight: "var(--os-row-h)" }}
                      >
                        <FileText className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-ink">{d.title || "Untitled"}</span>
                        <span className="shrink-0 text-xs text-ink-2">{inboxRowTime(d.viewedAt, now, locale)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </HomeWidget>
        );
      case "inbox":
        return (
              <HomeWidget
                title="Inbox"
                icon={InboxIcon}
                loading={loading}
                error={failed || (data !== null && data.inbox === null) ? { retry: load } : undefined}
                isEmpty={(data?.inbox?.rows.length ?? 0) === 0}
                empty={{ sentence: "You're all caught up" }}
                footer={
                  data?.inbox
                    ? { label: `Open Inbox · ${data.inbox.unread} unread`, href: "/inbox" }
                    : { label: "Open Inbox", href: "/inbox" }
                }
              >
                <ul>
                  {(data?.inbox?.rows ?? []).map((n) => (
                    <li key={n.id} className="border-b border-line-soft last:border-b-0">
                      <Link
                        href={`/inbox?n=${n.id}`}
                        className="flex items-center gap-2.5 px-4 hover:bg-hover"
                        style={{ minHeight: "var(--os-row-h)" }}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">{n.title}</span>
                        <span className="shrink-0 text-xs text-ink-2">{inboxRowTime(n.createdAt, now, locale)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </HomeWidget>
        );
      case "reminders":
        return isGuest ? null : (
              <HomeWidget
                title="Reminders"
                icon={Bell}
                loading={loading}
                error={failed || (data !== null && data.reminders === null) ? { retry: load } : undefined}
                isEmpty={(data?.reminders?.rows.length ?? 0) === 0}
                empty={{ sentence: "No reminders due today" }}
                // The one widget that shipped with no footer link, so there
                // was no way to make a reminder from Home at all. The reminder
                // popover is the shell's, opened by the same `workwrk:tool`
                // event the topbar quick-tool and the bell use.
                footer={{
                  label: "New reminder",
                  onClick: () =>
                    window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: "reminder" })),
                }}
              >
                <ul>
                  {(data?.reminders?.rows ?? []).map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-2.5 border-b border-line-soft px-4 last:border-b-0"
                      style={{ minHeight: "var(--os-row-h)" }}
                    >
                      {r.href ? (
                        <Link href={r.href} className="min-w-0 flex-1 truncate text-ink hover:underline">{r.title}</Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                      )}
                      <span className={r.overdue ? "shrink-0 text-xs font-medium text-danger-text" : "shrink-0 text-xs text-ink-2"}>
                        {clockIn(new Date(r.remindAt), locale.timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
              </HomeWidget>
        );
      case "goals":
        return isGuest ? null : (
              <HomeWidget
                title="My goals"
                icon={Trophy}
                loading={loading}
                error={failed || (data !== null && data.goals === null) ? { retry: load } : undefined}
                isEmpty={(data?.goals?.rows.length ?? 0) === 0}
                // No link in the empty block: the footer already carries the
                // same one, and two identical links one above the other is a
                // choice the reader does not have.
                empty={{ sentence: "No goals yet" }}
                footer={{ label: "Open Goals", href: "/okrs" }}
              >
                <ul>
                  {(data?.goals?.rows ?? []).map((g) => (
                    <li key={g.id} className="border-b border-line-soft last:border-b-0">
                      <Link
                        href={`/okrs/${g.id}`}
                        className="flex items-center gap-2.5 px-4 hover:bg-hover"
                        style={{ minHeight: "var(--os-row-h)" }}
                      >
                        <GoalRing percent={g.progress} />
                        <span className="min-w-0 flex-1 truncate text-ink">{g.title}</span>
                        <span className="shrink-0 text-xs font-medium text-ink-2">{g.progress}%</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </HomeWidget>
        );
      default:
        return null;
    }
  }
}

/* ─────────────────────────── the Display panel ─────────────────────────── */

/**
 * Which widgets show, in what order, and whether the greeting line shows.
 * A switch and Move up / Move down per widget: the same controls the
 * Customize panel uses for sidebar sections, so one pattern means "order".
 */
function DisplayPanel({
  onClose,
  greeting,
  onGreeting,
  keys,
  order,
  onToggle,
  onMove,
}: {
  onClose: () => void;
  greeting: boolean;
  onGreeting: (on: boolean) => void;
  keys: readonly HomeWidgetKey[];
  order: readonly HomeWidgetKey[];
  onToggle: (key: HomeWidgetKey, on: boolean) => void;
  onMove: (key: HomeWidgetKey, dir: -1 | 1) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  // Shown widgets in their stored order first, then the hidden ones.
  const rows = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Display options"
      className="os-chrome w-[300px] rounded-lg border border-line bg-raised py-1 text-ink shadow-[var(--os-shadow-pop)]"
    >
      <div className="px-3 pb-1 pt-2 text-micro uppercase tracking-[0.06em] text-ink-2">Widgets</div>
      <ul>
        {rows.map((k) => {
          const on = order.includes(k);
          const idx = order.indexOf(k);
          return (
            <li key={k} className="flex h-9 items-center gap-1 px-2">
              <span className="min-w-0 flex-1 truncate ps-1 text-base text-ink">{HOME_WIDGET_LABEL[k]}</span>
              <button
                type="button"
                onClick={() => onMove(k, -1)}
                disabled={!on || idx <= 0}
                aria-label={`Move ${HOME_WIDGET_LABEL[k]} up`}
                title="Move up"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => onMove(k, 1)}
                disabled={!on || idx < 0 || idx >= order.length - 1}
                aria-label={`Move ${HOME_WIDGET_LABEL[k]} down`}
                title="Move down"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowDown className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <Switch checked={on} onChange={(v) => onToggle(k, v)} aria-label={`Show ${HOME_WIDGET_LABEL[k]}`} />
            </li>
          );
        })}
      </ul>
      <div className="mx-3 my-1 h-px bg-line" />
      <div className="flex h-9 items-center gap-3 px-3">
        <span className="min-w-0 flex-1 truncate text-base text-ink">Greeting</span>
        <Switch checked={greeting} onChange={onGreeting} aria-label="Show the greeting" />
      </div>
    </div>
  );
}

/* ───────────────────────── My work widget ───────────────────────── */

function MyWorkWidget({
  data,
  loading,
  failed,
  retry,
  locale,
  now,
  completing,
  onComplete,
  onAdd,
}: {
  data: HomePayload["work"];
  loading: boolean;
  failed: boolean;
  retry: () => void;
  locale: LocaleContext;
  now: Date;
  completing: Set<string>;
  onComplete: (item: HomeTaskRow) => void;
  onAdd: () => void;
}) {
  const total = data ? data.overdue.length + data.today.length + data.week.length : 0;
  const more = data?.counts.more ?? 0;

  return (
    <HomeWidget
      title="My work"
      icon={CheckSquare}
      loading={loading}
      error={failed ? { retry } : undefined}
      footer={{ label: more > 0 ? `Open My work · ${more} more` : "Open My work", href: "/my-work" }}
      skeletonRows={5}
    >
      <div>
        {/* The quiet empty block lives INSIDE the body rather than replacing
            it, so the "+ Add task" row below survives: a person with nothing
            due this week is exactly the person who wants to add something,
            and the empty state is not a reason to take the control away. */}
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <DotsArt arrangement="row" size={64} />
            <p className="text-base text-ink-2">Nothing due this week</p>
          </div>
        ) : null}
        {(["overdue", "today", "week"] as const).map((group) => {
          const rows = data?.[group] ?? [];
          if (rows.length === 0) return null;
          const label = group === "overdue" ? "Overdue" : group === "today" ? "Today" : "This week";
          return (
            <div key={group}>
              <WidgetGroupHeader
                label={label}
                count={data?.counts[group]}
                tone={group === "overdue" ? "danger" : undefined}
              />
              {rows.map((item) => (
                <WorkTaskRow
                  key={item.id}
                  item={item}
                  locale={locale}
                  now={now}
                  overdue={group === "overdue"}
                  completing={completing.has(item.id)}
                  onComplete={onComplete}
                />
              ))}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center gap-2.5 border-t border-line-soft px-4 text-start text-ink-2 hover:bg-hover hover:text-ink"
          style={{ minHeight: "var(--os-row-h)" }}
        >
          <span className="text-lg leading-none" aria-hidden>+</span>
          Add task
        </button>
      </div>
    </HomeWidget>
  );
}

/* ─────────────────────── Weekly review widget ────────────────────── */

function WeeklyReviewWidget({ data, loading }: { data: HomePayload["weeklyReview"]; loading: boolean }) {
  const chip = reviewStatusChip(data?.status);
  const week = data?.weekStart ? new Date(data.weekStart) : null;
  const weekLabel = week
    ? `Week of ${week.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][week.getUTCMonth()]}`
    : "This week";

  return (
    <HomeWidget
      title="Weekly review"
      icon={ClipboardCheck}
      loading={loading}
      footer={{ label: "Open weekly review", href: "/me/weekly-review" }}
    >
      <div>
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4" style={{ minHeight: "var(--os-row-h)" }}>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{weekLabel}</span>
          <ReviewChip tone={chip.tone} label={chip.label} />
        </div>
        {data && data.kpisToRecord > 0 ? (
          // /people/me?tab=kras was a link to a tab that does not exist: the
          // profile page holds its tab in useState and never reads ?tab=, so
          // this row landed silently on My reviews. The place a KPI number is
          // actually recorded is the Your KPIs card on the weekly review, so
          // the row goes there, to that card.
          <Link
            href="/me/weekly-review#kpis"
            className="flex items-center gap-2.5 px-4 hover:bg-hover"
            style={{ minHeight: "var(--os-row-h)" }}
          >
            <span className="min-w-0 flex-1 truncate text-ink">
              {data.kpisToRecord} KPI {data.kpisToRecord === 1 ? "number" : "numbers"} to record
            </span>
            <span className="shrink-0 text-xs font-medium text-ink-2">{data.kpisToRecord}</span>
          </Link>
        ) : null}
      </div>
    </HomeWidget>
  );
}

/**
 * The review status as a pale chip. It is not `StatusChip`: that primitive is
 * driven by a per-status hex a List owner picked, and a review's four states
 * are the design system's semantic tones, which live in tokens.
 */
function ReviewChip({ tone, label }: { tone: "neutral" | "warning" | "info" | "success"; label: string }) {
  const cls =
    tone === "success"
      ? "bg-success-bg text-success-text"
      : tone === "warning"
        ? "bg-warning-bg text-warning-text"
        : tone === "info"
          ? "bg-brand-soft text-brand-deep"
          : "bg-active text-ink-2";
  return (
    <span className={`inline-flex h-[26px] shrink-0 items-center rounded-md px-2 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

/** The 20px goal ring: brand arc on a neutral track, no gradient, no label. */
function GoalRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <circle cx={10} cy={10} r={r} fill="none" stroke="var(--os-surface-2)" strokeWidth={3} />
      <circle
        cx={10}
        cy={10}
        r={r}
        fill="none"
        stroke="var(--os-brand)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${(c * clamped) / 100} ${c}`}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}
