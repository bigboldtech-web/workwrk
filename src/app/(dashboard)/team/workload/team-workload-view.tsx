"use client";

// Teams > Workload (spec-teams-people /team/workload).
//
//   toolbar   Filter (search, Person, Department, List, Priority, "Show
//             people with no scheduled work"), the window navigator
//             (previous, Today, next, the range), the Tasks | Hours
//             segmented control; "..." holds Window (7, 14, 28 days),
//             Count weekends, Show people with no scheduled work,
//             Capacity..., Export CSV (Owner, Admin). No blue button.
//   body      the shared WorkloadGrid (the same one a List's WORKLOAD view
//             renders), with the Unassigned row, the Unscheduled column and
//             the day popover.
//
// Settings persist as the viewer's preferences (home.work.workload: mode,
// windowDays, countWeekends, showAllPeople, dailyTasks). Per-person hours
// are User.weeklyCapacityHours (the Capacity modal). The old browser-only
// store (localStorage "workwrk:team-workload:v1") is migrated ONCE: its
// settings become preferences the viewer has not set yet, its per-person
// daily hours (else its team-wide "Daily hours" override) become weekly
// hours for people the viewer may write who have none, and the key is
// deleted only after every write has an answer.
//
// Filters live in the URL (q, person, dept, list, priority, comma lists),
// so a reload keeps them and a link shares them. Person is a searchable
// picker over the people in scope, never a checkbox per person.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Gauge, X } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Picker } from "@/components/ui/picker";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { formatWallClockDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { CapacityModal } from "@/components/people/capacity-modal";
import { WorkloadGrid, startOfWeek, type WorkloadPerson, type WorkloadSettings } from "@/components/board-view/workload-grid";
import { apiFetch } from "@/lib/api-fetch";
import { openTask } from "@/lib/nav/open-task";
import { workloadPrefs, type WorkloadPrefs } from "@/lib/people-prefs";
import { computeWorkload, capacityOn, UNASSIGNED } from "@/lib/people/workload-count";
import { effectivePersonSchedule, WORK_SCHEDULE_DEFAULTS, type WorkSchedule } from "@/lib/work-schedule";
import { toCsv } from "@/lib/people/people-csv";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";

const LEGACY_KEY = "workwrk:team-workload:v1";
const PRIORITIES = [
  { value: "URGENT", label: "Urgent" },
  { value: "HIGH", label: "High" },
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Low" },
];

interface ApiPerson extends WorkloadPerson {
  email: string | null;
  departmentId: string | null;
  weeklyCapacityHours: number | null;
  canEditCapacity: boolean;
}
interface ApiItem {
  id: string;
  title: string;
  status: string | null;
  boardId: string;
  ownerId: string | null;
  assigneeIds: string[];
  /** Everyone the item is split across, including people out of view. */
  assigneeCount?: number;
  unassigned: boolean;
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
  viewer: { orgWide: boolean; canExport: boolean; isAdmin: boolean };
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function csvSet(v: string | null | undefined): Set<string> {
  return new Set((v ?? "").split(",").map((x) => x.trim()).filter(Boolean));
}

export function TeamWorkloadView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const datePrefs = useDatePrefs();
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const stored = workloadPrefs(prefs.home);
  // Optimistic local copy so a toggle never waits on the round trip.
  const [local, setLocal] = useState<Partial<WorkloadPrefs>>({});
  const p: WorkloadPrefs = { ...stored, ...local };
  const setPref = useCallback((patch: Partial<WorkloadPrefs>) => {
    setLocal((l) => ({ ...l, ...patch }));
    void patchPrefs({ home: { work: { workload: patch } } }).then((ok) => {
      if (!ok) toast("Couldn't save that setting. It applies until you leave.", { tone: "danger" });
    });
  }, [patchPrefs, toast]);

  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const to = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + p.windowDays - 1), [anchor, p.windowDays]);
  const rangeLabel = `${formatWallClockDate(ymd(anchor), datePrefs)} to ${formatWallClockDate(ymd(to), datePrefs)}`;

  // Filters live in the URL: a reload keeps them and a link shares them.
  const q = sp?.get("q") ?? "";
  const personKey = sp?.get("person") ?? "";
  const deptKey = sp?.get("dept") ?? "";
  const listKey = sp?.get("list") ?? "";
  const priorityKey = sp?.get("priority") ?? "";
  const deactivated = sp?.get("deactivated") === "1";
  const personIds = useMemo(() => csvSet(personKey), [personKey]);
  const deptIds = useMemo(() => csvSet(deptKey), [deptKey]);
  const boardIds = useMemo(() => csvSet(listKey), [listKey]);
  const priorities = useMemo(() => csvSet(priorityKey), [priorityKey]);
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);
  const [draftQ, setDraftQ] = useState(q);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);
  const filterCount = (q ? 1 : 0) + personIds.size + deptIds.size + boardIds.size + priorities.size + (deactivated ? 1 : 0);
  const [filterOpen, setFilterOpen] = useState(filterCount > 0);
  const [personPickOpen, setPersonPickOpen] = useState(false);
  const [depts, setDepts] = useState<Array<{ id: string; name: string }>>([]);

  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [capacityOpen, setCapacityOpen] = useState(false);

  const qs = useMemo(() => {
    const s = new URLSearchParams({ from: ymd(anchor), to: ymd(to), today: ymd(new Date()) });
    if (boardIds.size) s.set("boardIds", [...boardIds].join(","));
    if (priorities.size) s.set("priority", [...priorities].join(","));
    // A deactivated person's open work is still work: a manager can bring
    // it into view to hand it on.
    if (deactivated) s.set("includeDeactivated", "1");
    return s.toString();
  }, [anchor, to, boardIds, priorities, deactivated]);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiFetch<ApiData>(`/api/team/workload?${qs}`, { cache: "no-store" });
    setLoading(false);
    if (!r.ok) { setError(r.error || "Couldn't load the workload"); return; }
    setError(null);
    setData(r.data);
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener("focus", again);
    window.addEventListener("workwrk:items-changed", again);
    return () => { window.removeEventListener("focus", again); window.removeEventListener("workwrk:items-changed", again); };
  }, [load]);
  useEffect(() => {
    if (!filterOpen || depts.length) return;
    void apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }).then((d) => { if (d.ok && Array.isArray(d.data)) setDepts(d.data); });
  }, [filterOpen, depts.length]);

  // ── The one-time localStorage migration ───────────────────────────
  const migrated = useRef(false);
  useEffect(() => {
    if (!data || migrated.current) return;
    migrated.current = true;
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(LEGACY_KEY); } catch { return; }
    if (!raw) return;
    let blob: Record<string, unknown> = {};
    try { blob = JSON.parse(raw) as Record<string, unknown>; } catch { try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* nothing to keep */ } return; }
    void (async () => {
      const storedRaw = ((prefs.home as { work?: { workload?: Record<string, unknown> } } | undefined)?.work?.workload) ?? {};
      const patch: Partial<WorkloadPrefs> = {};
      if (storedRaw.mode === undefined && (blob.mode === "hours" || blob.mode === "tasks")) patch.mode = blob.mode;
      if (storedRaw.windowDays === undefined && (blob.windowDays === 7 || blob.windowDays === 14 || blob.windowDays === 28)) patch.windowDays = blob.windowDays;
      if (storedRaw.countWeekends === undefined && typeof blob.countWeekends === "boolean") patch.countWeekends = blob.countWeekends;
      if (storedRaw.showAllPeople === undefined && typeof blob.showAllPeople === "boolean") patch.showAllPeople = blob.showAllPeople;
      if (storedRaw.dailyTasks === undefined && typeof blob.dailyTasks === "number" && Number.isInteger(blob.dailyTasks) && blob.dailyTasks >= 1 && blob.dailyTasks <= 99) patch.dailyTasks = blob.dailyTasks;
      let allAnswered = true;
      if (Object.keys(patch).length) {
        setLocal((l) => ({ ...l, ...patch }));
        if (!(await patchPrefs({ home: { work: { workload: patch } } }))) allAnswered = false;
      }
      const per = blob.perPersonHours && typeof blob.perPersonHours === "object" ? (blob.perPersonHours as Record<string, unknown>) : {};
      // The old page's team-wide "Daily hours" override applied to everyone
      // without a per-person value; it becomes their weekly hours the same way.
      const teamDaily = typeof blob.dailyHours === "number" ? blob.dailyHours : null;
      let wrote = false;
      for (const person of data.people) {
        const daily = typeof per[person.id] === "number" ? per[person.id] : teamDaily;
        if (typeof daily !== "number" || !Number.isFinite(daily) || daily < 1 || daily > 24) continue;
        if (!person.canEditCapacity || person.weeklyCapacityHours != null) continue;
        const days = effectivePersonSchedule(data.orgSchedule, person.workSchedule).workdays.length || 5;
        const r = await apiFetch(`/api/users/${person.id}`, { method: "PATCH", json: { weeklyCapacityHours: Math.round(daily * days * 100) / 100 } });
        // A refusal is an answer (the viewer may not write it); only a
        // dropped connection or a server error keeps the key for next time.
        if (!r.ok && (r.status === 0 || r.status >= 500)) allAnswered = false;
        if (r.ok) wrote = true;
      }
      if (allAnswered) {
        try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* removed next visit */ }
      }
      if (wrote) void load();
    })();
  }, [data, prefs.home, patchPrefs, load]);

  // ── Grid inputs ───────────────────────────────────────────────────
  const shownPeople = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.people ?? []).filter((person) => {
      if (personIds.size && !personIds.has(person.id)) return false;
      if (deptIds.size && !(person.departmentId && deptIds.has(person.departmentId))) return false;
      if (needle && !`${person.firstName ?? ""} ${person.lastName ?? ""} ${person.email ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, personIds, deptIds]);
  const shownIds = useMemo(() => new Set(shownPeople.map((x) => x.id)), [shownPeople]);
  const narrowed = personIds.size > 0 || deptIds.size > 0 || !!q.trim();
  const shareCounts = useMemo(() => Object.fromEntries((data?.items ?? []).map((it) => [it.id, it.assigneeCount ?? 0] as const)), [data]);
  const items: BoardItemRow[] = useMemo(() => (data?.items ?? [])
    .map((it) => ({ it, assignees: [it.ownerId, ...it.assigneeIds].filter((x): x is string => !!x && shownIds.has(x)) }))
    // A person filter narrows to their rows; Unassigned stays unless the
    // viewer narrowed to specific people.
    .filter(({ it, assignees }) => assignees.length > 0 || (it.unassigned && !narrowed))
    .map(({ it, assignees }) => ({
      id: it.id,
      boardId: it.boardId,
      title: it.title,
      status: it.status,
      ownerId: it.ownerId && shownIds.has(it.ownerId) ? it.ownerId : assignees[0] ?? null,
      assigneeIds: [...new Set(assignees)],
      groupKey: null,
      position: 0,
      metadata: it.estimateMinutes ? { timeEstimate: it.estimateMinutes } : {},
      startAt: it.startAt,
      dueAt: it.dueAt,
      priority: it.priority,
      archivedAt: null,
    } as BoardItemRow)), [data, shownIds, narrowed]);
  const boardNames = useMemo(() => Object.fromEntries((data?.boards ?? []).map((b) => [b.id, b.name])), [data]);
  const statusesByBoard = useMemo(() => Object.fromEntries((data?.boards ?? []).map((b) => [b.id, b.statuses])), [data]);
  const editable = useMemo(() => new Set((data?.boards ?? []).filter((b) => b.canEdit).map((b) => b.id)), [data]);
  const orgSchedule = data?.orgSchedule ?? WORK_SCHEDULE_DEFAULTS;

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
    // Re-read first: someone may have taken it since the popover loaded,
    // and their assignment must never be overwritten without a word.
    const cur = await apiFetch<{ ownerId?: string | null; assigneeIds?: string[] | null; item?: { ownerId?: string | null; assigneeIds?: string[] | null } }>(`/api/items/${itemId}`, { cache: "no-store" });
    if (cur.ok) {
      const row = cur.data.item ?? cur.data;
      if (row.ownerId || (row.assigneeIds?.length ?? 0) > 0) {
        toast("Someone already took this one. The workload is refreshed.", { tone: "danger" });
        window.dispatchEvent(new Event("workwrk:items-changed"));
        return false;
      }
    }
    const r = await apiFetch(`/api/items/${itemId}`, { method: "PATCH", json: { ownerId: personId, assigneeIds: [personId] } });
    if (!r.ok) { toast(r.error || "Couldn't assign it", { tone: "danger" }); return false; }
    const who = data?.people.find((x) => x.id === personId);
    toast(`Assigned to ${`${who?.firstName ?? ""} ${who?.lastName ?? ""}`.trim() || "them"}`);
    window.dispatchEvent(new Event("workwrk:items-changed"));
    return true;
  }, [data, toast]);

  function exportCsv() {
    if (!data) return;
    const scheduleOf = (k: string) => { const person = data.people.find((x) => x.id === k); return person ? effectivePersonSchedule(orgSchedule, person.workSchedule) : orgSchedule; };
    const loads = computeWorkload(
      items.map((it) => ({ id: it.id, ownerId: it.ownerId, assigneeIds: it.assigneeIds, startAt: it.startAt ?? null, dueAt: it.dueAt ?? null, estimateMinutes: typeof it.metadata.timeEstimate === "number" ? it.metadata.timeEstimate : null, shareCount: shareCounts[it.id] ?? null })),
      shownPeople.map((x) => x.id),
      { from: anchor, days: p.windowDays, countWeekends: p.countWeekends, today: new Date() },
      scheduleOf,
    );
    const days = Array.from({ length: p.windowDays }, (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i));
    const rows: Array<Array<string | number>> = shownPeople.map((person) => {
      const l = loads.get(person.id);
      const schedule = scheduleOf(person.id);
      const cap = days.reduce((s, d) => s + capacityOn({ schedule, weeklyCapacityHours: person.weeklyCapacityHours }, d, { mode: "hours", dailyTasks: p.dailyTasks, countWeekends: p.countWeekends }), 0);
      return [`${person.firstName ?? ""} ${person.lastName ?? ""}`.trim(), person.email ?? "", l?.totalTasks ?? 0, Math.round((l?.totalHours ?? 0) * 10) / 10, Math.round(cap * 10) / 10, l?.unscheduled.length ?? 0, l?.overdue.length ?? 0];
    });
    const un = loads.get(UNASSIGNED);
    if (un) rows.unshift(["Unassigned", "", un.totalTasks, Math.round(un.totalHours * 10) / 10, "", un.unscheduled.length, un.overdue.length]);
    const blob = new Blob([toCsv(["Person", "Email", "Task days", "Hours", "Capacity hours", "Unscheduled", "Overdue"], rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `workload-${ymd(anchor)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const toggle = (set: Set<string>, v: string, on: boolean, key: string) => {
    const next = new Set(set);
    if (on) next.add(v); else next.delete(v);
    setParams({ [key]: next.size ? [...next].join(",") : null });
  };
  const clearFilters = () => { setDraftQ(""); setParams({ q: null, person: null, dept: null, list: null, priority: null, deactivated: null }); };
  const nameOf = (x: { firstName: string | null; lastName: string | null; email?: string | null }) => `${x.firstName ?? ""} ${x.lastName ?? ""}`.trim() || x.email || "Unknown";
  const chosenPeople = (data?.people ?? []).filter((x) => personIds.has(x.id));
  const shift = (n: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth(), a.getDate() + n));
  const isCurrent = anchor.getTime() === startOfWeek(new Date()).getTime();

  return (
    <>
      <Breadcrumb items={[{ label: "Workload" }]} />
      <OsPageHeader
        title="Workload"
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filterCount },
          left: (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="mx-1 h-5 w-px bg-[var(--os-line)]" aria-hidden />
              <button type="button" onClick={() => shift(-7)} aria-label="Previous week" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => setAnchor(startOfWeek(new Date()))} disabled={isCurrent} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50">Today</button>
              <button type="button" onClick={() => shift(7)} aria-label="Next week" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><ChevronRight className="h-4 w-4" /></button>
              <span className="px-1 text-base font-medium tabular-nums text-ink" aria-live="polite">{rangeLabel}</span>
              <SegmentedControl label="Count by" value={p.mode} onChange={(v) => setPref({ mode: v })} options={[{ value: "tasks", label: "Tasks" }, { value: "hours", label: "Hours" }]} />
            </span>
          ),
          menu: [
            { label: "Window: 7 days", checked: p.windowDays === 7, onClick: () => setPref({ windowDays: 7 }) },
            { label: "Window: 14 days", checked: p.windowDays === 14, onClick: () => setPref({ windowDays: 14 }) },
            { label: "Window: 28 days", checked: p.windowDays === 28, onClick: () => setPref({ windowDays: 28 }) },
            { separator: true as const },
            { label: "Count weekends", checked: p.countWeekends, keepOpen: true, onClick: () => setPref({ countWeekends: !p.countWeekends }) },
            { label: "Show people with no scheduled work", checked: p.showAllPeople, keepOpen: true, onClick: () => setPref({ showAllPeople: !p.showAllPeople }) },
            { separator: true as const },
            { label: "Capacity...", icon: Gauge, onClick: () => setCapacityOpen(true) },
            ...(data?.viewer.canExport ? [{ label: "Export CSV", icon: Download, onClick: exportCsv }] : []),
          ],
        }}
      />
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="people"
          activeCount={filterCount}
          onClearAll={clearFilters}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search people" }}
        >
          {data?.people.length ? (
            <FilterGroup label="Person">
              <li className="relative list-none">
                <button
                  type="button"
                  aria-label="Person"
                  aria-haspopup="listbox"
                  aria-expanded={personPickOpen}
                  onClick={() => setPersonPickOpen((v) => !v)}
                  className="inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-ink hover:border-line-strong"
                >
                  <span className="min-w-0 flex-1 truncate text-start">
                    {chosenPeople.length === 0 ? <span className="text-ink-3">Anyone</span> : chosenPeople.map(nameOf).join(", ")}
                  </span>
                  {chosenPeople.length > 0 ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Clear person filter"
                      onClick={(e) => { e.stopPropagation(); setParams({ person: null }); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setParams({ person: null }); } }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  ) : null}
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
                </button>
                <Picker
                  open={personPickOpen}
                  onClose={() => setPersonPickOpen(false)}
                  multi
                  alwaysSearch
                  searchPlaceholder="Search people"
                  ariaLabel="Person"
                  selected={[...personIds]}
                  emptyLabel="No one matches"
                  sections={[{
                    options: data.people.map((x) => ({
                      value: x.id,
                      label: nameOf(x),
                      keywords: x.email ?? undefined,
                      glyph: <PersonAvatar person={{ ...x, email: null }} size={20} />,
                    })),
                  }]}
                  onSelect={(id) => toggle(personIds, id, !personIds.has(id), "person")}
                  width={236}
                  className="absolute start-0 top-10 z-50"
                />
              </li>
            </FilterGroup>
          ) : null}
          {depts.length ? (
            <FilterGroup label="Department">
              {depts.map((d) => <FilterRow key={d.id} label={d.name} checked={deptIds.has(d.id)} onCheckedChange={(on) => toggle(deptIds, d.id, on, "dept")} />)}
            </FilterGroup>
          ) : null}
          {data?.boards.length ? (
            <FilterGroup label="List">
              {data.boards.map((b) => <FilterRow key={b.id} label={b.name} checked={boardIds.has(b.id)} onCheckedChange={(on) => toggle(boardIds, b.id, on, "list")} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Priority">
            {PRIORITIES.map((pr) => <FilterRow key={pr.value} label={pr.label} checked={priorities.has(pr.value)} onCheckedChange={(on) => toggle(priorities, pr.value, on, "priority")} />)}
          </FilterGroup>
          <FilterGroup label="Show">
            <li className="flex h-9 items-center justify-between gap-3 px-2 text-sm text-ink">
              <span>People with no scheduled work</span>
              <Switch checked={p.showAllPeople} onChange={(v) => setPref({ showAllPeople: v })} aria-label="Show people with no scheduled work" />
            </li>
            <li className="flex h-9 items-center justify-between gap-3 px-2 text-sm text-ink">
              <span>Deactivated people</span>
              <Switch checked={deactivated} onChange={(v) => setParams({ deactivated: v ? "1" : null })} aria-label="Include deactivated people" />
            </li>
          </FilterGroup>
        </FilterPanel>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {error && !data ? (
            <OsEmptyView variant="error" title="Couldn't load the workload" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : !data ? (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised p-3" aria-busy="true" aria-label="Loading the workload">
              {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <>
              <div className={loading ? "opacity-70 transition-opacity" : undefined}>
                <WorkloadGrid
                  items={items}
                  people={shownPeople}
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
                    if (patch.dailyTasks !== undefined && patch.dailyTasks <= 99) next.dailyTasks = patch.dailyTasks;
                    if (Object.keys(next).length) setPref(next);
                  }}
                  onOpenItem={(id) => openTask(router, id)}
                  anchor={anchor}
                  onAnchorChange={setAnchor}
                  hideToolbar
                  orgSchedule={orgSchedule}
                  boardNames={boardNames}
                  canAssign={(it) => !!it.boardId && editable.has(it.boardId)}
                  onAssign={assign}
                  shareCounts={shareCounts}
                  emptyAction={p.windowDays !== 28 ? { label: "Show the next 28 days", onClick: () => { setAnchor(startOfWeek(new Date())); setPref({ windowDays: 28 }); } } : undefined}
                />
              </div>
              {data.people.length > 0 && shownPeople.length === 0 ? (
                <p className="text-sm text-ink-2">No one matches · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></p>
              ) : null}
              <p className="text-sm font-medium text-ink-2">Total people {shownPeople.length} · {rangeLabel}</p>
            </>
          )}
        </div>
      </div>
      {capacityOpen && data ? (
        <CapacityModal
          people={shownPeople}
          orgSchedule={orgSchedule}
          canEditOrgDefault={data.viewer.isAdmin}
          dailyTasks={p.dailyTasks}
          onDailyTasks={(n) => setPref({ dailyTasks: n })}
          onSaved={(id, hours) => setData((d) => (d ? { ...d, people: d.people.map((x) => (x.id === id ? { ...x, weeklyCapacityHours: hours } : x)) } : d))}
          onClose={() => setCapacityOpen(false)}
        />
      ) : null}
    </>
  );
}
