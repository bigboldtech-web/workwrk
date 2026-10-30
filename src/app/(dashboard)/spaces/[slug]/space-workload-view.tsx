"use client";

// A Space's Workload tab: who in this Space has too much or too little work
// over the next weeks, across every List of it the viewer can open.
//
//   toolbar   the grid's own: previous, Today, next, the range, Tasks |
//             Hours, the window (1, 2 or 4 weeks) and the capacity gear
//             (Tasks a day, Count weekends: the viewer's own settings),
//             then Lists and Search people, which narrow what is drawn.
//   body      the shared WorkloadGrid (the one a List's WORKLOAD view and
//             Teams > Workload render), with the Unassigned row, the
//             Unscheduled column and the day popover.
//
// Data is GET /api/spaces/[id]/workload, so moving the window is a fetch,
// never a page reload. Only the newest request's answer is drawn, and the
// grid only ever draws the window it has data for: a load that fails says
// which window failed and keeps showing the one that loaded, never old tasks
// on new days (the worst case is a lead reading next week as free).
// Settings are the viewer's Workload preferences, the same ones Teams >
// Workload saves (use-workload-prefs.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Picker } from "@/components/ui/picker";
import { useWorkloadPrefs } from "@/components/people/use-workload-prefs";
import { WorkloadGrid, startOfWeek, type WorkloadPerson, type WorkloadSettings } from "@/components/board-view/workload-grid";
import { apiFetch } from "@/lib/api-fetch";
import { openTask } from "@/lib/nav/open-task";
import { formatWallClockDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { WORK_SCHEDULE_DEFAULTS, type WorkSchedule } from "@/lib/work-schedule";
import { SPACE_WORKLOAD_CAP, mayAssignOver } from "@/lib/work/space-workload";
import type { WorkloadPrefs } from "@/lib/people-prefs";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";

interface ApiPerson extends WorkloadPerson {
  spaceMember: boolean;
  /** False: measured against the company schedule (their own hours are not the viewer's to see). */
  ownCapacity: boolean;
}
interface ApiItem {
  id: string;
  title: string;
  status: string | null;
  boardId: string;
  ownerId: string | null;
  assigneeIds: string[];
  assigneeCount: number;
  unassigned: boolean;
  formerIds: string[];
  startAt: string | null;
  dueAt: string | null;
  priority: string | null;
  estimateMinutes: number | null;
}
interface ApiData {
  window: { from: string; to: string };
  orgSchedule: WorkSchedule;
  people: ApiPerson[];
  items: ApiItem[];
  boards: Array<{ id: string; name: string; canEdit: boolean; statuses: StatusOption[] }>;
  truncated: { window: boolean; unscheduled: boolean; overdue: boolean };
}

/** A refetch on returning to the tab waits this long after the last load. */
const FOCUS_REFRESH_MS = 30_000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function SpaceWorkloadView({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const datePrefs = useDatePrefs();
  const { toast } = useOsToast();
  const { prefs: p, setPref } = useWorkloadPrefs();

  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const to = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + p.windowDays - 1), [anchor, p.windowDays]);
  const range = (a: string, b: string) => `${formatWallClockDate(a, datePrefs)} to ${formatWallClockDate(b, datePrefs)}`;

  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listIds, setListIds] = useState<Set<string>>(() => new Set());
  const [listPickOpen, setListPickOpen] = useState(false);
  const [q, setQ] = useState("");

  const qs = useMemo(
    () => new URLSearchParams({ from: ymd(anchor), to: ymd(to), today: ymd(new Date()) }).toString(),
    [anchor, to],
  );
  const seq = useRef(0);
  const lastLoad = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const r = await apiFetch<ApiData>(`/api/spaces/${encodeURIComponent(spaceId)}/workload?${qs}`, { cache: "no-store" });
    // A newer request was sent while this one was out: its answer wins.
    if (mine !== seq.current) return;
    setLoading(false);
    lastLoad.current = Date.now();
    if (!r.ok) { setError(r.error || "Couldn't load the workload"); return; }
    setError(null);
    setData(r.data);
  }, [spaceId, qs]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    let changed: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => { if (Date.now() - lastLoad.current > FOCUS_REFRESH_MS) void load(); };
    // A burst of changes (a bulk edit) is one reload.
    const onChanged = () => { if (changed) clearTimeout(changed); changed = setTimeout(() => { void load(); }, 300); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("workwrk:items-changed", onChanged);
    return () => {
      if (changed) clearTimeout(changed);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("workwrk:items-changed", onChanged);
    };
  }, [load]);

  // The window the grid draws is the one it has data for. While a new one
  // loads it moves at once (dimmed), so Next pressed twice moves two weeks;
  // when that load fails it goes back to what loaded, and says so.
  const requestedFrom = ymd(anchor);
  const failed = !!data && !!error;
  const stale = failed && !!data && (data.window.from !== requestedFrom || data.window.to !== ymd(to));
  const drawnAnchor = stale && data ? fromYmd(data.window.from) : anchor;
  const drawnDays = stale && data
    ? Math.round((fromYmd(data.window.to).getTime() - fromYmd(data.window.from).getTime()) / 86_400_000) + 1
    : p.windowDays;
  const drawnWindow: WorkloadSettings["windowDays"] = drawnDays === 7 || drawnDays === 28 ? drawnDays : 14;

  const needle = q.trim().toLowerCase();
  const shownPeople = useMemo(() => (data?.people ?? [])
    .filter((x) => !needle || `${x.firstName ?? ""} ${x.lastName ?? ""}`.toLowerCase().includes(needle))
    .map((x) => ({ ...x, companySchedule: !x.ownCapacity })), [data, needle]);
  const shownIds = useMemo(() => new Set(shownPeople.map((x) => x.id)), [shownPeople]);
  const shareCounts = useMemo(() => Object.fromEntries((data?.items ?? []).map((it) => [it.id, it.assigneeCount] as const)), [data]);
  const formerById = useMemo(() => new Map((data?.items ?? []).map((it) => [it.id, it.formerIds] as const)), [data]);
  const items: BoardItemRow[] = useMemo(() => (data?.items ?? [])
    .filter((it) => listIds.size === 0 || listIds.has(it.boardId))
    .map((it) => ({ it, holders: [it.ownerId, ...it.assigneeIds].filter((x): x is string => !!x && shownIds.has(x)) }))
    // A search narrows to the people found; Unassigned stays unless the viewer searched.
    .filter(({ it, holders }) => holders.length > 0 || (it.unassigned && !needle))
    .map(({ it, holders }) => ({
      id: it.id,
      boardId: it.boardId,
      title: it.title,
      status: it.status,
      ownerId: it.ownerId && shownIds.has(it.ownerId) ? it.ownerId : holders[0] ?? null,
      assigneeIds: [...new Set(holders)],
      groupKey: null,
      position: 0,
      metadata: it.estimateMinutes ? { timeEstimate: it.estimateMinutes } : {},
      startAt: it.startAt,
      dueAt: it.dueAt,
      priority: it.priority,
      archivedAt: null,
    } as BoardItemRow)), [data, listIds, shownIds, needle]);
  const boardNames = useMemo(() => Object.fromEntries((data?.boards ?? []).map((b) => [b.id, b.name])), [data]);
  const statusesByBoard = useMemo(() => Object.fromEntries((data?.boards ?? []).map((b) => [b.id, b.statuses])), [data]);
  const editable = useMemo(() => new Set((data?.boards ?? []).filter((b) => b.canEdit).map((b) => b.id)), [data]);
  const orgSchedule = data?.orgSchedule ?? WORK_SCHEDULE_DEFAULTS;
  const companyMeasured = shownPeople.filter((x) => x.companySchedule).length;

  const settings: WorkloadSettings = {
    mode: p.mode,
    windowDays: drawnWindow,
    dailyHours: null,
    dailyTasks: p.dailyTasks,
    perPersonHours: {},
    countWeekends: p.countWeekends,
    showAllPeople: p.showAllPeople,
  };

  const assign = useCallback(async (itemId: string, personId: string) => {
    // Re-read first: someone may have taken it since the grid loaded, and
    // their assignment must never be overwritten without a word. A task that
    // only names people who no longer work here is handed on.
    const cur = await apiFetch<{ ownerId?: string | null; assigneeIds?: string[] | null; item?: { ownerId?: string | null; assigneeIds?: string[] | null } }>(`/api/items/${itemId}`, { cache: "no-store" });
    if (!cur.ok) { toast(cur.error || "Couldn't assign it", { tone: "danger" }); return false; }
    const row = cur.data.item ?? cur.data;
    if (!mayAssignOver({ ownerId: row.ownerId ?? null, assigneeIds: row.assigneeIds ?? [] }, formerById.get(itemId) ?? [])) {
      toast("Someone took this task first. Workload now shows who has it.", { tone: "danger" });
      window.dispatchEvent(new Event("workwrk:items-changed"));
      return false;
    }
    const r = await apiFetch(`/api/items/${itemId}`, { method: "PATCH", json: { ownerId: personId, assigneeIds: [personId] } });
    if (!r.ok) { toast(r.error || "Couldn't assign it", { tone: "danger" }); return false; }
    const who = data?.people.find((x) => x.id === personId);
    toast(`Assigned to ${`${who?.firstName ?? ""} ${who?.lastName ?? ""}`.trim() || "them"}`);
    window.dispatchEvent(new Event("workwrk:items-changed"));
    return true;
  }, [data, formerById, toast]);

  if (error && !data) {
    return <OsEmptyView variant="error" title="Couldn't load the workload" hint={error} action={{ label: "Try again", onClick: () => void load() }} />;
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised p-3" aria-busy="true" aria-label="Loading the workload">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }
  if (data.boards.length === 0) {
    return <OsEmptyView title="No Lists you can open in this Space" hint="Workload counts the open tasks on this Space's Lists." />;
  }

  const chosenLists = data.boards.filter((b) => listIds.has(b.id));
  const cap = SPACE_WORKLOAD_CAP.toLocaleString();
  const cut = [
    data.truncated.window ? `more than ${cap} tasks in this window, so it counts the ${cap} due soonest` : null,
    data.truncated.unscheduled ? `more than ${cap} tasks with no dates, so Unscheduled counts the ${cap} changed most recently` : null,
    data.truncated.overdue ? `more than ${cap} overdue tasks, so it counts the ${cap} due most recently` : null,
  ].filter((x): x is string => !!x);

  const toolbarExtra = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="relative">
        <button
          type="button"
          aria-label="Lists"
          aria-haspopup="listbox"
          aria-expanded={listPickOpen}
          onClick={() => setListPickOpen((v) => !v)}
          className="inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-sm text-ink hover:border-line-strong"
        >
          <span className="min-w-0 truncate">
            {chosenLists.length === 0 ? "All Lists" : chosenLists.length === 1 ? chosenLists[0].name : `${chosenLists.length} Lists`}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
        </button>
        <Picker
          open={listPickOpen}
          onClose={() => setListPickOpen(false)}
          multi
          alwaysSearch
          searchPlaceholder="Search Lists"
          ariaLabel="Lists"
          selected={[...listIds]}
          emptyLabel="No List matches"
          sections={[{ options: data.boards.map((b) => ({ value: b.id, label: b.name })) }]}
          onSelect={(id) => setListIds((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
          width={260}
          className="absolute start-0 top-10 z-50"
        />
      </span>
      <label className="relative inline-flex items-center">
        <Search className="pointer-events-none absolute start-2 h-3.5 w-3.5 text-ink-2" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="h-8 w-[180px] rounded-md border border-line bg-raised ps-7 pe-2 text-sm text-ink placeholder:text-ink-3 max-sm:w-[150px]"
        />
      </label>
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[var(--os-danger-bg)] px-3 py-2 text-sm text-danger-text">
          <span>
            {stale
              ? <>Couldn&apos;t load {range(requestedFrom, ymd(to))}. Showing {range(data.window.from, data.window.to)}.</>
              : <>Couldn&apos;t refresh the workload. It shows what loaded before.</>}
          </span>
          <button type="button" onClick={() => void load()} className="font-medium underline">Try again</button>
        </div>
      ) : null}
      {cut.length ? (
        <p role="status" className="text-sm text-ink-2">
          This Space has {cut.join("; ")}.
        </p>
      ) : null}
      <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading || undefined}>
        <WorkloadGrid
          items={items}
          people={shownPeople}
          statuses={[]}
          statusesByBoard={statusesByBoard}
          settings={settings}
          canEdit={false}
          viewerCapacity
          toolbarExtra={toolbarExtra}
          onSettingsChange={(patch) => {
            const next: Partial<WorkloadPrefs> = {};
            if (patch.mode) next.mode = patch.mode;
            if (patch.windowDays) next.windowDays = patch.windowDays;
            if (patch.countWeekends !== undefined) next.countWeekends = patch.countWeekends;
            if (patch.showAllPeople !== undefined) next.showAllPeople = patch.showAllPeople;
            if (patch.dailyTasks !== undefined && patch.dailyTasks <= 99) next.dailyTasks = patch.dailyTasks;
            if (Object.keys(next).length) setPref(next);
          }}
          onOpenItem={(id) => openTask(router, id)}
          anchor={drawnAnchor}
          onAnchorChange={setAnchor}
          orgSchedule={orgSchedule}
          boardNames={boardNames}
          canAssign={(it) => !!it.boardId && editable.has(it.boardId)}
          onAssign={assign}
          shareCounts={shareCounts}
          emptyAction={p.windowDays !== 28 ? { label: "Show the next 28 days", onClick: () => { setAnchor(startOfWeek(new Date())); setPref({ windowDays: 28 }); } } : undefined}
        />
      </div>
      {companyMeasured > 0 ? (
        <p className="text-sm text-ink-2">
          * Workload uses the company schedule for {companyMeasured === 1 ? "1 person" : `${companyMeasured} people`}. Only their manager, the People team and Admins see their own hours.
        </p>
      ) : null}
      {data.people.length > 0 && shownPeople.length === 0 ? (
        <p className="text-sm text-ink-2">No one matches · <button type="button" className="text-brand-deep hover:underline" onClick={() => setQ("")}>Clear search</button></p>
      ) : null}
      <p className="text-sm font-medium text-ink-2">{shownPeople.length === 1 ? "1 person" : `${shownPeople.length} people`}</p>
    </div>
  );
}
