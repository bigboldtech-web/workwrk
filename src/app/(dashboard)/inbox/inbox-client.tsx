"use client";

// The Inbox: a 360px list of notifications, and the thing each one is about
// open beside it.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox).
//
// WHAT THIS REBUILD FIXES, in the order the audit found them:
//
//   - Errors were swallowed. `catch { setRows([]) }` rendered the "you're all
//     caught up" empty state on a 500, so an outage and Inbox Zero looked
//     identical. Now a failed read says "Couldn't load your Inbox · Retry" and
//     the tab counts show "·" rather than 0.
//   - Tabs were computed client-side from one 50-row payload, so the counts
//     could not agree with the sidebar badge past 50 unread. They are server
//     counts now, from the same clause the badge uses.
//   - The bucket map knew ten of the twenty-six types the app writes. It is
//     `inbox-kinds.ts` now, and it is total.
//   - Date groups were literally three, so a notification from 2019 was filed
//     under "Last 7 days". They are real days and months, in the viewer's zone.
//   - Display preferences were written to a key the schema stripped, so none
//     of them ever persisted. They write `home.notifications.inboxView`.
//   - The "⇧1" to "⇧4" hints were drawn with no handler anywhere. The
//     shortcuts are real, and the hints match them.
//   - There was no pagination past 50 rows. There is a cursor.
//   - READ AND CLEARED WERE ONE STATE. Selecting a row marked it read, the tab
//     re-queried, the row left the list under the cursor and the detail pane
//     fell back to "Pick a notification to see it here" a second and a half
//     after you clicked. Reading a notification in the Inbox was impossible.
//     A read row now STAYS in its tab, quieter; only Clear files it away.
//   - `?n=<id>` selected nothing unless the row happened to be on the first
//     page of the open tab. It is fetched by id now, and the tab follows it.
//
// URL IS THE STATE: `?tab=` and `?n=` (the selected row). An email's deep link
// lands on `/inbox?n=<id>` and selects that row; `/me/mentions` 308s to
// `?tab=mentions`; `/assigned-comments` to `?tab=primary&type=task_comment`.
// A visit with no `?tab=` is canonicalised to the viewer's default tab in the
// address bar, so Copy link, Back and Forward all mean what is on screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { Switch } from "@/components/ui/switch";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { DotsArt } from "@/components/ui/dots-art";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import {
  FILTER_GROUPS,
  INBOX_TABS,
  TAB_EMPTY_SENTENCE,
  parseTab,
  type InboxFilterGroup,
  type InboxTab,
} from "@/lib/inbox-kinds";
import { inboxDateLabel, type LocaleContext } from "@/lib/work-buckets";
import { InboxRow, type InboxNotification } from "@/components/inbox/inbox-row";
import { InboxTargetPane } from "@/components/inbox/inbox-target-pane";

export interface InboxOptions {
  groupByDate: boolean;
  /** "Show everything in Other": Other also lists the Primary rows. */
  showAll: boolean;
  sortNewest: boolean;
  /** Days after which read rows are swept by the daily cron. Null = never. */
  autoClearDays: number | null;
  /**
   * Only the three tabs a person READS. Snoozed and Cleared are places rows go
   * on their way out; opening the Inbox on one of them every morning is not a
   * default anybody wants, and the preference schema refuses them too.
   */
  defaultTab: "primary" | "other" | "mentions";
}

interface InboxResponse {
  notifications: InboxNotification[];
  tab: InboxTab;
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
  counts: { primary: number; other: number; mentions: number; snoozed: number; unread: number };
}

const PAGE = 40;

/**
 * The user's words for the exact-type narrowings a redirect can arrive with.
 * `/assigned-comments` 308s to `?tab=primary&type=task_comment`, and a filter
 * that cannot be named cannot be shown or removed.
 */
const TYPE_FILTER_LABEL: Record<string, string> = {
  task_comment: "Comments on your tasks",
  task_assigned: "Assigned to you",
  mention: "Mentioned you",
};

/** The snooze presets, resolved at click time in the viewer's own clock. */
function snoozeTargets(): Array<{ value: string; label: string; at: () => Date }> {
  return [
    { value: "3h", label: "Later today (in 3 hours)", at: () => new Date(Date.now() + 3 * 3_600_000) },
    { value: "tomorrow", label: "Tomorrow 9am", at: () => atHour(1, 9) },
    { value: "monday", label: "Next week, Monday 9am", at: () => nextMonday9() },
  ];
}
function atHour(addDays: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function nextMonday9(): Date {
  const d = new Date();
  const delta = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function InboxClient({
  currentUserId,
  isGuest,
  initialOptions,
  locale,
  mutedUntil,
}: {
  currentUserId: string;
  isGuest: boolean;
  initialOptions: InboxOptions;
  locale: LocaleContext;
  mutedUntil: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { patchPrefs, layerCount } = useOsShell();
  const { refreshCounts } = useBoot();
  const { toast } = useOsToast();

  const tabParam = params.get("tab");
  const tab: InboxTab = tabParam ? parseTab(tabParam) : initialOptions.defaultTab;
  const selectedId = params.get("n");
  const typeParam = params.get("type");

  const [options, setOptions] = useState(initialOptions);
  const [rows, setRows] = useState<InboxNotification[] | null>(null);
  const [counts, setCounts] = useState<InboxResponse["counts"] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<InboxFilterGroup[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [snoozeFor, setSnoozeFor] = useState<string[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  // The row named by `?n=`, fetched by id when it is not on the loaded page.
  // `undefined` = not asked yet, `null` = asked and it is gone.
  const [deepRow, setDeepRow] = useState<InboxNotification | null | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const buildQuery = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams({ tab, limit: String(PAGE) });
      if (cursor) qs.set("cursor", cursor);
      if (groups.length) qs.set("kinds", groups.join(","));
      if (unreadOnly) qs.set("unread", "1");
      if (typeParam) qs.set("type", typeParam);
      if (!options.sortNewest) qs.set("sort", "oldest");
      if (options.showAll) qs.set("all", "1");
      return qs.toString();
    },
    [tab, groups, unreadOnly, typeParam, options.sortNewest, options.showAll],
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<InboxResponse>(`/api/notifications?${buildQuery(null)}`, { cache: "no-store" });
      if (!res.ok) {
        // NEVER the empty state on a failed read. An outage and Inbox Zero are
        // different things, and the old page could not tell you which.
        setFailed(res.error);
        return;
      }
      setRows(res.data.notifications);
      setCounts(res.data.counts);
      setNextCursor(res.data.nextCursor);
      setFailed(null);
      setNow(new Date());
    } catch {
      setFailed("Couldn't load your Inbox");
    }
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const res = await apiFetch<InboxResponse>(`/api/notifications?${buildQuery(nextCursor)}`, { cache: "no-store" });
    if (!res.ok) {
      toast("Couldn't load more", { tone: "danger" });
      return;
    }
    setRows((prev) => [...(prev ?? []), ...res.data.notifications]);
    setNextCursor(res.data.nextCursor);
  }, [nextCursor, buildQuery, toast]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(WINDOW_EVENTS.notifChanged, refresh);
    // 45s, the fallback the spec keeps behind the SSE event above.
    const tick = window.setInterval(refresh, 45_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(WINDOW_EVENTS.notifChanged, refresh);
      window.clearInterval(tick);
    };
  }, [load]);

  // THE URL IS THE STATE, so the URL has to say what the state is. Without
  // `?tab=` the page rendered the viewer's stored default tab while the
  // address bar said nothing, so Copy link, Back, Forward and sharing all
  // disagreed with the screen and the same link opened a different tab for a
  // colleague. One replace on arrival settles it.
  useEffect(() => {
    if (tabParam) return;
    if (selectedId) return; // the deep-link effect below picks the row's own tab
    setParam({ tab: initialOptions.defaultTab });
  }, [tabParam, selectedId, initialOptions.defaultTab, setParam]);

  const rowInPage = useMemo(
    () => (selectedId ? (rows ?? []).find((r) => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  );

  // `?n=<id>` is the URL notification emails, the Home widget and the bell all
  // link to, and it used to select a row only when that row happened to be on
  // the first page of the tab the viewer had open. Ask the server for the row
  // itself, and follow it to its tab when the URL did not name one.
  useEffect(() => {
    // No reset when the selection clears: `selected` below already requires
    // the fetched row's id to match the URL, so a stale one can never render.
    if (!selectedId) return;
    if (rowInPage) return;
    if (deepRow && deepRow.id === selectedId) return;
    let alive = true;
    void (async () => {
      const res = await apiFetch<{ notification: InboxNotification | null; tab?: InboxTab }>(
        `/api/notifications?id=${encodeURIComponent(selectedId)}`,
        { cache: "no-store" },
      );
      if (!alive) return;
      if (!res.ok) { setDeepRow(null); return; }
      setDeepRow(res.data.notification);
      if (!tabParam && res.data.tab) setParam({ tab: res.data.tab });
    })();
    return () => { alive = false; };
  }, [selectedId, rowInPage, deepRow, tabParam, setParam]);

  // The row the pane shows. It is NOT "whatever is in the loaded page": that
  // is what made the pane empty itself 1.5 seconds after every click, back
  // when reading a row took it out of the tab.
  const selected = useMemo(
    () => rowInPage ?? (deepRow && deepRow.id === selectedId ? deepRow : null),
    [rowInPage, deepRow, selectedId],
  );

  /** Every write goes through here, so one place owns the optimistic update. */
  const write = useCallback(
    async (body: Record<string, unknown>, apply: (n: InboxNotification) => InboxNotification, ids: string[]) => {
      setRows((prev) => prev?.map((n) => (ids.includes(n.id) ? apply(n) : n)) ?? prev);
      // The deep-linked row is not in `rows` when it lives on another tab, and
      // it is what the pane is showing, so it gets the same optimistic patch.
      setDeepRow((prev) => (prev && ids.includes(prev.id) ? apply(prev) : prev));
      const res = await apiFetch("/api/notifications", { method: "PATCH", json: body });
      if (!res.ok) {
        toast("That didn't save", { tone: "danger", description: res.error, action: { label: "Retry", onClick: () => void load() } });
      }
      void load();
      // The chrome carries the same number this page just changed. Nothing
      // told it, so the sidebar said Inbox 14 while the tabs beside it added
      // up to 13, and the two contradicted each other until a reload. This
      // calls the boot counts refresh directly rather than firing the
      // notifChanged window event, because this page listens for that event
      // too and would answer its own broadcast with a second full reload.
      void refreshCounts();
    },
    [toast, load, refreshCounts],
  );

  const markRead = useCallback(
    (ids: string[], read: boolean) => void write({ ids, read }, (n) => ({ ...n, read }), ids),
    [write],
  );

  // Clear is its OWN write, and that is the whole point. It used to send the
  // identical `{ ids, read: true }` as Mark read, with a different toast, over
  // a Cleared tab defined as `read = true`, so reading something filed it
  // away and "Mark all read" emptied Primary. Clear now sets `clearedAt`;
  // read is a weight and Clear is a filing decision.
  const clear = useCallback(
    (ids: string[]) => {
      const previous = [...(rows ?? []), ...(deepRow ? [deepRow] : [])]
        .filter((n) => ids.includes(n.id))
        .map((n) => ({ id: n.id, read: n.read }));
      void write({ ids, cleared: true }, (n) => ({ ...n, read: true, cleared: true }), ids);
      toast(ids.length === 1 ? "Cleared" : `${ids.length} cleared`, {
        onUndo: () => {
          // Un-clear first, then put back the read weight each row had. Undo
          // that only un-cleared would leave every row marked read.
          void write({ ids, cleared: false }, (n) => ({ ...n, cleared: false }), ids);
          const stillUnread = previous.filter((p) => !p.read).map((p) => p.id);
          if (stillUnread.length) markRead(stillUnread, false);
        },
      });
    },
    [rows, deepRow, write, toast, markRead],
  );

  /** The Cleared tab's own row action: put it back where it came from. */
  const unclear = useCallback(
    (ids: string[]) => {
      void write({ ids, cleared: false }, (n) => ({ ...n, cleared: false }), ids);
      toast(ids.length === 1 ? "Moved back to Inbox" : `${ids.length} moved back to Inbox`);
    },
    [write, toast],
  );

  const snooze = useCallback(
    (ids: string[], until: Date) => {
      setRows((prev) => prev?.filter((n) => !ids.includes(n.id)) ?? prev);
      void apiFetch("/api/notifications", { method: "PATCH", json: { ids, snoozeUntil: until.toISOString() } }).then((res) => {
        if (!res.ok) toast("Couldn't snooze that", { tone: "danger" });
        void load();
      });
      setSnoozeFor(null);
    },
    [toast, load],
  );

  const markAllRead = useCallback(async () => {
    const res = await apiFetch<{ count: number; ids: string[]; undoable?: boolean }>("/api/notifications", {
      method: "PATCH",
      json: { markAllRead: true, tab },
    });
    if (!res.ok) {
      toast("Couldn't mark them read", { tone: "danger" });
      return;
    }
    const undoIds = res.data.ids ?? [];
    // No Undo past the server's cap. An Undo that silently restores the first
    // 500 of 3,000 rows is worse than no Undo, because it looks like it worked.
    const canUndo = res.data.undoable !== false && undoIds.length > 0;
    toast(`${res.data.count} marked read`, {
      onUndo: canUndo ? () => markRead(undoIds, false) : undefined,
    });
    void load();
  }, [tab, toast, load, markRead]);

  const saveOption = useCallback(
    async (patch: Partial<InboxOptions>) => {
      const next = { ...options, ...patch };
      setOptions(next);
      const ok = await patchPrefs({ home: { notifications: { inboxView: next } } });
      if (!ok) {
        setOptions(options);
        toast("Couldn't save your Inbox options");
      }
    },
    [options, patchPrefs, toast],
  );

  // Selecting a row marks it read after 1.5 seconds of being selected, long
  // enough that arrowing past a row does not clear it.
  useEffect(() => {
    if (!selected || selected.read) return;
    const id = selected.id;
    const t = window.setTimeout(() => markRead([id], true), 1500);
    return () => window.clearTimeout(t);
  }, [selected, markRead]);

  // Keyboard, all of it real AND all of it advertised.
  //
  // These used to be a private `window.addEventListener("keydown")` in this
  // file, so `src/lib/shortcuts.ts`, the `?` overlay and /account/shortcuts
  // listed none of them and the only way to find them was to read the source.
  // Registering them through `useShortcut` with `scope: "page"` is what makes
  // "advertised equals working" true here: the overlay renders the registry,
  // so a chord exists in the list exactly when it exists as a handler.
  const move = useCallback(
    (delta: number) => {
      const list = rows ?? [];
      if (list.length === 0) return;
      const index = list.findIndex((r) => r.id === selectedId);
      const next = index < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, index + delta));
      if (list[next]) setParam({ n: list[next].id });
    },
    [rows, selectedId, setParam],
  );

  useShortcut({ id: "inbox-next", keys: "arrowdown", label: "Next notification", scope: "page", run: () => move(1) });
  useShortcut({ id: "inbox-prev", keys: "arrowup", label: "Previous notification", scope: "page", run: () => move(-1) });
  // The five tab chords, written out one per line rather than mapped, because
  // a hook in a loop is a hook order that depends on data.
  const openTab = useCallback(
    (index: number) => {
      const t = INBOX_TABS[index];
      if (t) setParam({ tab: t.key, n: null, type: null });
    },
    [setParam],
  );
  useShortcut({ id: "inbox-tab-1", keys: "1", label: `Open ${INBOX_TABS[0].label}`, scope: "page", run: () => openTab(0) });
  useShortcut({ id: "inbox-tab-2", keys: "2", label: `Open ${INBOX_TABS[1].label}`, scope: "page", run: () => openTab(1) });
  useShortcut({ id: "inbox-tab-3", keys: "3", label: `Open ${INBOX_TABS[2].label}`, scope: "page", run: () => openTab(2) });
  useShortcut({ id: "inbox-tab-4", keys: "4", label: `Open ${INBOX_TABS[3].label}`, scope: "page", run: () => openTab(3) });
  useShortcut({ id: "inbox-tab-5", keys: "5", label: `Open ${INBOX_TABS[4].label}`, scope: "page", run: () => openTab(4) });
  useShortcut(
    { id: "inbox-clear", keys: "e", label: "Clear", scope: "page", run: () => selectedId && clear([selectedId]), when: () => !!selectedId },
    true,
  );
  useShortcut(
    { id: "inbox-unread", keys: "u", label: "Mark unread", scope: "page", run: () => selectedId && markRead([selectedId], false), when: () => !!selectedId },
    true,
  );
  useShortcut(
    { id: "inbox-snooze", keys: "s", label: "Snooze", scope: "page", run: () => selectedId && setSnoozeFor([selectedId]), when: () => !!selectedId },
    true,
  );
  useShortcut({ id: "inbox-mark-all", keys: "shift+e", label: "Mark all read", scope: "page", run: () => void markAllRead() });
  useShortcut({ id: "inbox-filter", keys: "f", label: "Filter", scope: "page", run: () => setFilterOpen((v) => !v) });
  useShortcut(
    {
      id: "inbox-deselect",
      keys: "escape",
      label: "Close the notification",
      scope: "page",
      // Only when nothing else is open: Esc belongs to the topmost layer
      // first, so a filter panel or a picker closes before the pane deselects.
      when: () => !!selectedId && layerCount === 0,
      run: () => setParam({ n: null }),
    },
    !!selectedId && layerCount === 0,
  );

  const dated = useMemo(() => {
    if (!rows) return [];
    if (!options.groupByDate) return [{ label: "", rows }];
    const out: Array<{ label: string; rows: InboxNotification[] }> = [];
    for (const n of rows) {
      const label = inboxDateLabel(n.createdAt, now, locale);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(n);
      else out.push({ label, rows: [n] });
    }
    return out;
  }, [rows, options.groupByDate, now, locale]);

  const loading = rows === null && failed === null;
  const hasUnreadHere = (rows ?? []).some((r) => !r.read);
  const returnTo = `${pathname}?tab=${tab}`;
  // `?type=` arrives on the /assigned-comments 308 and used to be an INVISIBLE
  // filter: it narrowed the list, was not counted on the Filter chip, was not
  // shown in the panel and had no clear control, so a person following an old
  // bookmark saw a filtered Primary tab with nothing saying so.
  const typeLabel = typeParam ? TYPE_FILTER_LABEL[typeParam] ?? typeParam : null;
  const activeFilters = groups.length + (unreadOnly ? 1 : 0) + (typeParam ? 1 : 0);
  const clearAllFilters = useCallback(() => {
    setGroups([]);
    setUnreadOnly(false);
    if (typeParam) setParam({ type: null });
  }, [typeParam, setParam]);

  function tabCount(key: InboxTab): number | null {
    if (!counts) return null;
    if (key === "primary") return counts.primary;
    if (key === "other") return counts.other;
    if (key === "mentions") return counts.mentions;
    if (key === "snoozed") return counts.snoozed;
    return null;
  }

  return (
    // The split fills the frame's main area and scrolls INSIDE its two
    // columns, so the list has its own scrollbar and the pane keeps its
    // header in view. Without the bounded height here the page grows to the
    // height of the notification list and the pane's empty state ends up a
    // thousand pixels down.
    <div className="flex h-full min-h-0 flex-col">
      <OsPageHeader
        title="Inbox"
        views={
          <>
            {INBOX_TABS.map((t) => {
              const n = tabCount(t.key);
              return (
                <ViewTab
                  key={t.key}
                  label={t.label}
                  active={tab === t.key}
                  onClick={() => setParam({ tab: t.key, n: null, type: null })}
                  trailing={
                    n === null ? (
                      // A count we could not read prints a middle dot, never a
                      // zero: "0 unread" and "we don't know" are different.
                      failed ? <span className="ms-1.5 text-xs text-ink-3">·</span> : null
                    ) : n > 0 ? (
                      <span className="ms-1.5 text-xs font-medium text-ink-2">{n > 99 ? "99+" : n}</span>
                    ) : null
                  }
                />
              );
            })}
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          sort: { onClick: () => setSortOpen((v) => !v), label: options.sortNewest ? "Sort" : "Oldest first", active: !options.sortNewest },
          right: (
            <>
              {hasUnreadHere ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="inline-flex h-9 items-center rounded-md border border-line px-3 text-base font-medium text-ink hover:bg-hover"
                >
                  Mark all read
                </button>
              ) : null}
              {/* The bordered square IS Inbox options (spec section 2), not a
                  menu with one row in it that then opens the popover: a
                  one-item menu reads as a bug and costs a click. */}
              <button
                type="button"
                aria-label="Inbox options"
                title="Inbox options"
                aria-haspopup="dialog"
                aria-expanded={optionsOpen}
                onClick={() => setOptionsOpen((v) => !v)}
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-raised text-ink-2 hover:bg-hover hover:text-ink ${optionsOpen ? "bg-active text-ink" : ""}`}
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </>
          ),
        }}
      />

      {/* The two toolbar popovers. */}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker
              open
              onClose={() => setSortOpen(false)}
              ariaLabel="Sort notifications"
              selected={options.sortNewest ? "newest" : "oldest"}
              sections={[{ options: [{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }] }]}
              onSelect={(v) => { setSortOpen(false); void saveOption({ sortNewest: v === "newest" }); }}
            />
          </div>
        ) : null}
        {optionsOpen ? (
          <div className="absolute end-6 top-0 z-40">
            <Picker
              open
              onClose={() => setOptionsOpen(false)}
              ariaLabel="Inbox options"
              align="end"
              width={288}
              multi
              selected={[
                ...(options.groupByDate ? ["groupByDate"] : []),
                ...(options.showAll ? ["showAll"] : []),
                `tab:${options.defaultTab}`,
                `clear:${options.autoClearDays ?? 0}`,
              ]}
              sections={[
                {
                  label: "Display",
                  options: [
                    { value: "groupByDate", label: "Group by date" },
                    { value: "showAll", label: "Show everything in Other" },
                  ],
                },
                {
                  label: "Default tab",
                  options: INBOX_TABS.slice(0, 3).map((t) => ({ value: `tab:${t.key}`, label: t.label })),
                },
                {
                  label: "Auto-clear read notifications",
                  options: [
                    { value: "clear:0", label: "Never" },
                    { value: "clear:7", label: "After 7 days" },
                    { value: "clear:14", label: "After 14 days" },
                    { value: "clear:30", label: "After 30 days" },
                  ],
                },
              ]}
              footer={
                <button
                  type="button"
                  onClick={() => { setOptionsOpen(false); router.push("/account/notifications"); }}
                  className="w-full px-2 py-1.5 text-start text-base text-ink-2 hover:text-ink"
                >
                  Notification settings
                </button>
              }
              onSelect={(value) => {
                if (value === "groupByDate") { void saveOption({ groupByDate: !options.groupByDate }); return; }
                if (value === "showAll") { void saveOption({ showAll: !options.showAll }); return; }
                if (value.startsWith("tab:")) {
                  const picked = parseTab(value.slice(4));
                  if (picked === "primary" || picked === "other" || picked === "mentions") {
                    void saveOption({ defaultTab: picked });
                  }
                  return;
                }
                if (value.startsWith("clear:")) {
                  const days = Number(value.slice(6));
                  void saveOption({ autoClearDays: days > 0 ? days : null });
                }
              }}
            />
          </div>
        ) : null}
      </div>

      {mutedUntil && new Date(mutedUntil) > now ? (
        <div className="os-row flex h-9 shrink-0 items-center gap-2 border-b border-line bg-subtle px-6 text-ink-2">
          Notifications muted until {new Date(mutedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          <button
            type="button"
            onClick={() => void patchPrefs({ home: { notifications: { mutedUntil: null } } })}
            className="font-medium text-brand-deep hover:underline"
          >
            Unmute
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {filterOpen ? (
          <FilterPanel
            open
            onClose={() => setFilterOpen(false)}
            objects="notifications"
            activeCount={activeFilters}
            onClearAll={clearAllFilters}
          >
            {typeLabel ? (
              // The `?type=` narrowing, said out loud and removable. It is a
              // row of its own rather than a kind checkbox because it is one
              // exact type, not a Filter-panel group.
              <FilterRow label={typeLabel} checked onCheckedChange={() => setParam({ type: null })} />
            ) : null}
            {FILTER_GROUPS.map((g) => (
              <FilterRow
                key={g.key}
                label={g.label}
                checked={groups.includes(g.key)}
                onCheckedChange={(on) => setGroups((prev) => (on ? [...prev, g.key] : prev.filter((k) => k !== g.key)))}
              />
            ))}
            {/* A switch, not a checkbox: the rows above pick WHICH kinds to
                show and this one changes the state of the whole list, which is
                the distinction design-system 5.2 draws between the two. */}
            <li className="flex h-9 items-center gap-3 rounded-md px-2">
              <span className="min-w-0 flex-1 truncate text-row text-ink">Unread only</span>
              <Switch checked={unreadOnly} onChange={setUnreadOnly} aria-label="Unread only" />
            </li>
          </FilterPanel>
        ) : null}

        {/* The list, 360, on the subtle ground. */}
        <div ref={listRef} className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-e border-line bg-subtle">
          {failed ? (
            <div className="flex flex-col items-start gap-1 p-6">
              <p className="text-base text-ink">Couldn&rsquo;t load your Inbox</p>
              <button type="button" onClick={() => void load()} className="text-base font-medium text-brand-deep hover:underline">
                Retry
              </button>
            </div>
          ) : loading ? (
            <ListSkeleton />
          ) : (rows?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <DotsArt arrangement="row" size={64} />
              <p className="text-base text-ink-2">{TAB_EMPTY_SENTENCE[tab]}</p>
            </div>
          ) : (
            <>
              {dated.map((group) => (
                <div key={group.label || "all"}>
                  {group.label ? (
                    <div className="sticky top-0 z-10 flex h-7 items-center border-b border-line-soft bg-subtle px-3 text-xs font-semibold uppercase tracking-wide text-ink-2">
                      {group.label}
                    </div>
                  ) : null}
                  <ul role="listbox" aria-label={group.label || "Notifications"}>
                    {group.rows.map((n) => (
                      <InboxRow
                        key={n.id}
                        notification={n}
                        selected={n.id === selectedId}
                        checked={checked.has(n.id)}
                        anyChecked={checked.size > 0}
                        now={now}
                        locale={locale}
                        onSelect={() => setParam({ n: n.id })}
                        onCheck={() =>
                          setChecked((s) => {
                            const next = new Set(s);
                            if (next.has(n.id)) next.delete(n.id);
                            else next.add(n.id);
                            return next;
                          })
                        }
                        onMarkRead={() => markRead([n.id], true)}
                        onMarkUnread={() => markRead([n.id], false)}
                        onSnooze={() => setSnoozeFor([n.id])}
                        // On the Cleared tab the third action is the way back
                        // out, not a second way in. A tab a row can only enter
                        // is a tab a row is stuck in.
                        onClear={() => (tab === "cleared" ? unclear([n.id]) : clear([n.id]))}
                        cleared={tab === "cleared"}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              {nextCursor ? (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="os-row flex h-11 w-full items-center justify-center text-ink-2 hover:bg-hover hover:text-ink"
                >
                  Load more
                </button>
              ) : null}
            </>
          )}
        </div>

        {/* The target, fluid. */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {failed ? (
            <OsEmptyView
              variant="error"
              title="Couldn't load your Inbox"
              hint={failed}
              action={{ label: "Retry", onClick: () => void load() }}
            />
          ) : (
            <InboxTargetPane
              notification={selected}
              currentUserId={currentUserId}
              isGuest={isGuest}
              returnTo={returnTo}
              now={now}
              locale={locale}
              onMarkRead={() => selected && markRead([selected.id], true)}
              onSnooze={() => selected && setSnoozeFor([selected.id])}
              onClear={() => selected && (tab === "cleared" ? unclear([selected.id]) : clear([selected.id]))}
              clearLabel={tab === "cleared" ? "Move back to Inbox" : "Clear"}
            />
          )}
        </div>
      </div>

      {/* Snooze, one popover for the row action, the pane action and `s`. */}
      {snoozeFor ? (
        <div className="fixed bottom-24 start-[360px] z-50">
          <Picker
            open
            onClose={() => setSnoozeFor(null)}
            ariaLabel="Snooze until"
            width={288}
            sections={[{ options: snoozeTargets().map((s) => ({ value: s.value, label: s.label })) }]}
            onSelect={(value) => {
              const preset = snoozeTargets().find((s) => s.value === value);
              if (preset) snooze(snoozeFor, preset.at());
            }}
          />
        </div>
      ) : null}

      {/* The bulk bar, once anything is checked. */}
      {checked.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          <div
            className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-raised px-3 py-2"
            style={{ boxShadow: "var(--os-shadow-pop)" }}
          >
            <span className="px-2 text-base font-medium text-ink">{checked.size} selected</span>
            <BulkAction label="Mark read" onClick={() => { markRead([...checked], true); setChecked(new Set()); }} />
            <BulkAction label="Snooze" onClick={() => setSnoozeFor([...checked])} />
            <BulkAction
              label={tab === "cleared" ? "Move back to Inbox" : "Clear"}
              onClick={() => { if (tab === "cleared") unclear([...checked]); else clear([...checked]); setChecked(new Set()); }}
            />
            <BulkAction label="Cancel" onClick={() => setChecked(new Set())} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BulkAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center rounded-md px-2.5 text-base text-ink-2 hover:bg-hover hover:text-ink"
    >
      {label}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex h-[64px] items-center gap-2.5 border-b border-line-soft px-3">
          <span className="os-skeleton-pulse h-5 w-5 shrink-0 rounded bg-skeleton" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="os-skeleton-pulse h-3.5 rounded bg-skeleton" style={{ width: `${[70, 55, 80, 60][i % 4]}%` }} />
            <span className="os-skeleton-pulse h-3 rounded bg-skeleton" style={{ width: `${[40, 50, 35, 45][i % 4]}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
