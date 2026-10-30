"use client";

// A Space's Workload tab: who in this Space has too much or too little work
// over the next weeks, across every List of it the viewer can read.
//
//   toolbar   the grid's own: previous, Today, next, the range, Tasks |
//             Hours and the window (1, 2 or 4 weeks). No capacity gear: a
//             person's hours are their own (Teams > Workload, Capacity...).
//   body      the shared WorkloadGrid (the one a List's WORKLOAD view and
//             Teams > Workload render), with the Unassigned row, the
//             Unscheduled column and the day popover.
//
// Data is GET /api/spaces/[id]/workload, so moving the window is a fetch,
// never a page reload. Settings are the viewer's Workload preferences, the
// same ones Teams > Workload saves (use-workload-prefs.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { Skeleton } from "@/components/ui/skeleton";
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
  truncated: boolean;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SpaceWorkloadView({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const datePrefs = useDatePrefs();
  const { toast } = useOsToast();
  const { prefs: p, setPref } = useWorkloadPrefs();

  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const to = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + p.windowDays - 1), [anchor, p.windowDays]);
  const rangeLabel = `${formatWallClockDate(ymd(anchor), datePrefs)} to ${formatWallClockDate(ymd(to), datePrefs)}`;

  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const qs = useMemo(
    () => new URLSearchParams({ from: ymd(anchor), to: ymd(to), today: ymd(new Date()) }).toString(),
    [anchor, to],
  );
  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiFetch<ApiData>(`/api/spaces/${encodeURIComponent(spaceId)}/workload?${qs}`, { cache: "no-store" });
    setLoading(false);
    if (!r.ok) { setError(r.error || "Couldn't load the workload"); return; }
    setError(null);
    setData(r.data);
  }, [spaceId, qs]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener("focus", again);
    window.addEventListener("workwrk:items-changed", again);
    return () => { window.removeEventListener("focus", again); window.removeEventListener("workwrk:items-changed", again); };
  }, [load]);

  const shareCounts = useMemo(() => Object.fromEntries((data?.items ?? []).map((it) => [it.id, it.assigneeCount] as const)), [data]);
  const formerById = useMemo(() => new Map((data?.items ?? []).map((it) => [it.id, it.formerIds] as const)), [data]);
  const items: BoardItemRow[] = useMemo(() => (data?.items ?? []).map((it) => ({
    id: it.id,
    boardId: it.boardId,
    title: it.title,
    status: it.status,
    ownerId: it.ownerId,
    assigneeIds: it.assigneeIds,
    groupKey: null,
    position: 0,
    metadata: it.estimateMinutes ? { timeEstimate: it.estimateMinutes } : {},
    startAt: it.startAt,
    dueAt: it.dueAt,
    priority: it.priority,
    archivedAt: null,
  } as BoardItemRow)), [data]);
  const boardNames = useMemo(() => Object.fromEntries((data?.boards ?? []).map((b) => [b.id, b.name])), [data]);
  const statusesByBoard = useMemo(() => Object.fromEntries((data?.boards ?? []).map((b) => [b.id, b.statuses])), [data]);
  const editable = useMemo(() => new Set((data?.boards ?? []).filter((b) => b.canEdit).map((b) => b.id)), [data]);
  const orgSchedule = data?.orgSchedule ?? WORK_SCHEDULE_DEFAULTS;
  const companyMeasured = (data?.people ?? []).filter((x) => !x.ownCapacity).length;

  const settings: WorkloadSettings = {
    mode: p.mode,
    windowDays: p.windowDays,
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
      toast("Someone already took this one. The workload is refreshed.", { tone: "danger" });
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
    return <OsEmptyView title="No Lists in this Space yet" hint="Workload counts the open tasks on this Space's Lists." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={loading ? "opacity-70 transition-opacity" : undefined}>
        <WorkloadGrid
          items={items}
          people={data.people}
          statuses={[]}
          statusesByBoard={statusesByBoard}
          settings={settings}
          canEdit={false}
          onSettingsChange={(patch) => {
            const next: Partial<WorkloadPrefs> = {};
            if (patch.mode) next.mode = patch.mode;
            if (patch.windowDays) next.windowDays = patch.windowDays;
            if (patch.countWeekends !== undefined) next.countWeekends = patch.countWeekends;
            if (patch.showAllPeople !== undefined) next.showAllPeople = patch.showAllPeople;
            if (Object.keys(next).length) setPref(next);
          }}
          onOpenItem={(id) => openTask(router, id)}
          anchor={anchor}
          onAnchorChange={setAnchor}
          orgSchedule={orgSchedule}
          boardNames={boardNames}
          canAssign={(it) => !!it.boardId && editable.has(it.boardId)}
          onAssign={assign}
          shareCounts={shareCounts}
          emptyAction={p.windowDays !== 28 ? { label: "Show the next 28 days", onClick: () => { setAnchor(startOfWeek(new Date())); setPref({ windowDays: 28 }); } } : undefined}
        />
      </div>
      {data.truncated ? (
        <p className="text-sm text-ink-2">
          Counted from the first {SPACE_WORKLOAD_CAP.toLocaleString()} open tasks, soonest due first. This Space has more.
        </p>
      ) : null}
      {companyMeasured > 0 ? (
        <p className="text-sm text-ink-3">
          {companyMeasured === 1 ? "1 person is" : `${companyMeasured} people are`} measured against the company schedule. Their own hours are visible to their manager and the People team.
        </p>
      ) : null}
      <p className="text-sm font-medium text-ink-2">Total people {data.people.length} · {rangeLabel}</p>
    </div>
  );
}
