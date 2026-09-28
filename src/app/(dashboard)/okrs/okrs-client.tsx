"use client";

// /okrs: Goals as a records list (spec-goals section 2 /okrs).
//
//   Views row   My goals (/okrs) · Team goals (?view=team, for viewers with
//               reports, the People team and Admin) · Company goals
//   Toolbar     Filter (Verdict, Level, Owner, Due, Needs a nudge, Direct
//               reports only) · Sort · the one blue New goal · "..." Display
//               (Show completed goals, Effort column), both persisted to
//               UserPreference.home.goals
//   Body        one TableCard: My and Company goals grouped by level; Team
//               goals grouped by person, each header one line with the
//               person's goals, average, hours this month, last moved and
//               their rolled-up verdict (the worst open goal)
//
// Every verdict on this page comes from GET /api/okrs, which computes it with
// the same function as the goal page (src/lib/goal-verdict.ts), so a row and
// its goal page can never disagree. Rows open the goal page (goals are pages,
// not drawers). Row "..." and right-click: Open, Edit, Assign owner, Copy
// link, Mark complete, Delete, each rendered only when the API allows it.
//
// What moved (nothing was dropped): the four stat tiles are the Verdict
// filter and the Team goals headers; "Need attention" is Filter > Verdict or
// Needs a nudge; the By person / By level toggle is the fixed grouping per
// view; the ?mine=1 chip is the My goals pill.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Trash2, UserRound } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";
import { TableCard, BulkAction, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { DateField } from "@/components/ui/date-field";
import { Avatar } from "@/components/ui/avatar-stack";
import { useConfirm } from "@/components/ui/dialog-provider";
import { PeoplePickerField, ToneChip, type PickPerson } from "@/components/people/person-bits";
import { CreateGoalModal, type GoalLevel } from "@/components/okrs/create-goal-modal";
import { GoalRowMoreMenu } from "@/components/okrs/goal-row-more-menu";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { goalsSurfacePrefs, type GoalsSurfacePrefs } from "@/lib/people-prefs";
import { verdictChip, type GoalVerdict } from "@/lib/goal-verdict";
import { GOALS_VIEW_HREF, type GoalsView } from "@/lib/nav/goals-view";

type Person = { id: string; firstName: string | null; lastName: string | null; avatar: string | null; email: string };

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  ownerId: string | null;
  owner: Person | null;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  checkInCadence: string;
  parentId: string | null;
  progress: number;
  progressSource: string;
  verdict: GoalVerdict;
  isStale: boolean;
  lastMovedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  effort?: { totalHours: number; tasksOpen: number; lastActivityAt: string | null };
}

interface PersonGroup {
  key: string;
  ownerId: string | null;
  name: string;
  avatar: string | null;
  goals: number;
  avgProgress: number | null;
  hoursThisMonth: number;
  lastMovedAt: string | null;
  verdict: GoalVerdict | null;
}

interface ListResponse {
  data: GoalRow[];
  pagination: { page: number; pageSize: number; total: number };
  counts: Record<GoalLevel, number>;
  groups?: PersonGroup[];
  noGoals?: Person[];
  canTeam: boolean;
  mayAssignOwners?: boolean;
}

type Sort = "due" | "progress" | "name" | "checkin" | "verdict";
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "due", label: "Due date" },
  { value: "progress", label: "Progress" },
  { value: "name", label: "Name" },
  { value: "checkin", label: "Last check-in" },
  { value: "verdict", label: "Verdict" },
];
const VERDICT_FILTERS: GoalVerdict[] = ["on_track", "at_risk", "off_track", "completed", "not_measured"];
const LEVELS: Array<{ value: GoalLevel; label: string; group: string }> = [
  { value: "COMPANY", label: "Company", group: "Company goals" },
  { value: "DEPARTMENT", label: "Department", group: "Department goals" },
  { value: "INDIVIDUAL", label: "Individual", group: "Individual goals" },
];
const PAGE_SIZE = 40;

const nameOf = (p: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined) =>
  p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone" : "";

export default function OkrsClient({ initialNew = false, view, legacyLevel, canonicalHref, notice }: {
  initialNew?: boolean;
  view: GoalsView;
  legacyLevel?: string;
  canonicalHref?: string;
  notice?: string;
}) {
  const router = useRouter();
  const fmt = useFormat();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const { prefs, patchPrefs, rowVersion } = useOsShell();
  const [mayAssign, setMayAssign] = useState(false);
  const isTeam = view === "team";

  // One URL per view: a retired form is rewritten in place once (no history
  // entry, and the server-decided notice line stays until the next visit).
  useEffect(() => {
    if (canonicalHref && typeof window !== "undefined") window.history.replaceState(null, "", canonicalHref);
  }, [canonicalHref]);

  // Display options (home.goals), optimistic.
  const stored = goalsSurfacePrefs(prefs.home);
  const [localPrefs, setLocalPrefs] = useState<Partial<GoalsSurfacePrefs>>({});
  const display: GoalsSurfacePrefs = { ...stored, ...localPrefs };
  const setDisplay = useCallback((patch: Partial<GoalsSurfacePrefs>) => {
    setLocalPrefs((l) => ({ ...l, ...patch }));
    void patchPrefs({ home: { goals: patch } }).then((ok) => {
      if (!ok) toast("Couldn't save that setting. It applies until you leave.", { tone: "danger" });
    });
  }, [patchPrefs, toast]);

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("due");
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [verdicts, setVerdicts] = useState<GoalVerdict[]>([]);
  const [levels, setLevels] = useState<GoalLevel[]>([]);
  const [owners, setOwners] = useState<PickPerson[]>([]);
  const [dueFrom, setDueFrom] = useState<string | null>(null);
  const [dueTo, setDueTo] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const [direct, setDirect] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);
  const [creating, setCreating] = useState<boolean>(initialNew);
  const [fromQuery, setFromQuery] = useState(initialNew);
  const [editing, setEditing] = useState<{ goal: GoalRow; focusOwner?: boolean } | null>(null);
  const [bulkOwnerOpen, setBulkOwnerOpen] = useState(false);
  const menuRefs = useRef(new Map<string, ContextMenuHandle | null>());

  // The Goals "+" may push ?new=1 while this page is mounted: follow the prop.
  const [seenInitialNew, setSeenInitialNew] = useState(initialNew);
  if (initialNew !== seenInitialNew) {
    setSeenInitialNew(initialNew);
    if (initialNew) { setCreating(true); setFromQuery(true); }
  }

  const filterCount = verdicts.length + levels.length + owners.length + (dueFrom || dueTo ? 1 : 0) + (nudge ? 1 : 0) + (direct ? 1 : 0) + (q.trim() ? 1 : 0);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
    if (view === "mine" || view === "team" || view === "company") p.set("view", view);
    if (view === "level" && legacyLevel && !levels.length) p.set("level", legacyLevel);
    if (isTeam) p.set("withEffort", "1");
    if (display.showCompleted) p.set("includeCompleted", "1");
    if (verdicts.length) p.set("verdict", verdicts.join(","));
    if (levels.length) p.set("level", levels.join(","));
    if (owners.length) p.set("owner", owners.map((o) => o.id).join(","));
    if (dueFrom) p.set("dueFrom", dueFrom);
    if (dueTo) p.set("dueTo", dueTo);
    if (nudge) p.set("nudge", "1");
    if (direct) p.set("direct", "1");
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [page, sort, view, legacyLevel, isTeam, display.showCompleted, verdicts, levels, owners, dueFrom, dueTo, nudge, direct, q]);

  const hadData = useRef(false);
  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/okrs?${qs}`, { cache: "no-store" });
    if (!r.ok) {
      setError(`${r.error || "Couldn't load goals"}${r.status ? ` (${r.status})` : ""}`);
      // A failed refetch keeps the rows already on screen.
      if (hadData.current) toast("Couldn't refresh goals. Showing what was loaded.", { tone: "danger" });
      return;
    }
    hadData.current = true;
    setError(null);
    setData(r.data);
    // Owner assignment follows the rule POST and PATCH /api/okrs apply.
    setMayAssign(Boolean(r.data.mayAssignOwners));
    setSelected((cur) => new Set([...cur].filter((id) => r.data.data.some((g) => g.id === id && g.canEdit))));
  }, [qs, toast]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  const v = rowVersion("okrs");
  useEffect(() => { if (v <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [v, load]);
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);
  const resetPage = () => setPage(1);

  // Team goals: people whose verdict is At risk or Off track start open; if
  // nobody is, every group starts open (a page of closed rows hides the work).
  const groups = data?.groups;
  const initialCollapsed = useMemo(() => {
    if (!isTeam || !groups) return null;
    const urgent = new Set(groups.filter((g) => g.verdict === "at_risk" || g.verdict === "off_track").map((g) => g.key));
    return new Set(urgent.size ? groups.filter((g) => !urgent.has(g.key)).map((g) => g.key) : []);
  }, [isTeam, groups]);
  const collapsedNow = collapsed ?? initialCollapsed ?? new Set<string>();

  const rows = data?.data ?? null;
  const groupByKey = useMemo(() => new Map((groups ?? []).map((g) => [g.key, g])), [groups]);
  const selectedRows = (rows ?? []).filter((r) => selected.has(r.id));
  const allDeletable = selectedRows.length > 0 && selectedRows.every((r) => r.canDelete);

  function closeCreate() {
    setCreating(false);
    if (fromQuery) {
      setFromQuery(false);
      router.replace(isTeam ? GOALS_VIEW_HREF.team : view === "company" ? GOALS_VIEW_HREF.company : GOALS_VIEW_HREF.mine, { scroll: false });
    }
  }

  async function bulkComplete() {
    const list = selectedRows.filter((r) => r.canEdit && !r.completedAt);
    if (!list.length) return;
    const ok = await confirm({ title: `Mark ${list.length} ${list.length === 1 ? "goal" : "goals"} complete?`, description: "They read as Completed everywhere. You can reopen each from its menu.", confirmLabel: "Mark complete" });
    if (!ok) return;
    let failed = 0;
    for (const r of list) {
      const res = await apiFetch("/api/okrs", { method: "PATCH", json: { id: r.id, completed: true } });
      if (!res.ok) failed += 1;
    }
    toast(failed ? `Marked ${list.length - failed} complete; ${failed} couldn't be updated` : `Marked ${list.length} complete`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    void load();
  }
  async function bulkOwner(p: PickPerson) {
    const list = selectedRows.filter((r) => r.canEdit);
    let failed = 0;
    for (const r of list) {
      const res = await apiFetch("/api/okrs", { method: "PATCH", json: { id: r.id, ownerId: p.id } });
      if (!res.ok) failed += 1;
    }
    toast(failed ? `Assigned ${list.length - failed}; ${failed} couldn't be assigned` : `Assigned ${list.length} to ${nameOf(p)}`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    void load();
  }
  async function bulkDelete() {
    const list = selectedRows;
    const ok = await confirm({ title: `Delete ${list.length} ${list.length === 1 ? "goal" : "goals"}?`, description: "Their targets and check-ins go with them. This can't be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    let failed = 0;
    for (const r of list) {
      const res = await apiFetch(`/api/okrs/${r.id}`, { method: "DELETE" });
      if (!res.ok) failed += 1;
    }
    toast(failed ? `Deleted ${list.length - failed}; ${failed} couldn't be deleted` : `Deleted ${list.length}`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    void load();
  }

  const columns = useMemo<TableColumn<GoalRow>[]>(() => {
    const progressCell = (r: GoalRow) => r.progressSource === "NONE"
      ? (
        <span className="flex items-center gap-2">
          <span className="h-1 w-24 shrink-0 rounded-full bg-active" aria-hidden />
          <span className="whitespace-nowrap text-sm text-ink-2">Not measured</span>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-active" aria-hidden>
            <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, r.progress))}%` }} />
          </span>
          <span className="tabular-nums">{r.progress}%</span>
        </span>
      );
    const dueCell = (r: GoalRow) => {
      if (!r.endDate) return <span className="text-ink-2">No due date</span>;
      // A due date is a calendar day stored as UTC midnight: the wall-clock
      // formatter never shows it a day early west of UTC, and it is overdue
      // only once that day has ended for the viewer.
      const dueKey = r.endDate.slice(0, 10);
      const overdue = r.verdict !== "completed" && fmt.today() > dueKey;
      return <span className={overdue ? "text-danger-text" : ""}>{fmt.wallDate(dueKey)}{overdue ? " · overdue" : ""}</span>;
    };
    const base: TableColumn<GoalRow>[] = [
      { key: "title", label: "Goal", title: true, width: "minmax(240px,2fr)", render: (r) => <span className="truncate">{r.title}</span> },
      { key: "verdict", label: "Verdict", width: "140px", render: (r) => { const c = verdictChip(r.verdict); return <ToneChip tone={c.tone} label={c.label} />; } },
      { key: "progress", label: "Progress", width: "210px", render: progressCell },
    ];
    if (!isTeam) base.push({ key: "owner", label: "Owner", width: "minmax(160px,1fr)", hideBelow: 720, render: (r) => r.owner
      ? <span className="flex min-w-0 items-center gap-2"><Avatar person={r.owner} size={24} /><span className="truncate">{nameOf(r.owner)}</span></span>
      : <span className="text-ink-2">No owner</span> });
    base.push({ key: "due", label: "Due", width: "150px", render: dueCell });
    if (view === "mine" || view === "level") base.push({ key: "level", label: "Level", width: "110px", hideBelow: 900, render: (r) => <span className="text-ink-2">{LEVELS.find((l) => l.value === r.level)?.label}</span> });
    if (isTeam && display.showEffort) base.push({ key: "effort", label: "Effort", width: "130px", hideBelow: 1024, render: (r) => r.effort ? <span className="tabular-nums text-ink-2">{r.effort.totalHours}h · {r.effort.tasksOpen} open</span> : null });
    if (isTeam) base.push({ key: "moved", label: "Last moved", width: "120px", hideBelow: 1024, render: (r) => <span className="text-ink-2">{r.lastMovedAt ? fmt.relative(r.lastMovedAt) : "Never"}</span> });
    return base;
  }, [isTeam, view, display.showEffort, fmt]);

  const groupOf = (r: GoalRow) => {
    if (isTeam) {
      const key = r.ownerId ?? "__unowned";
      const g = groupByKey.get(key);
      const meta = g ? [
        `${g.goals} ${g.goals === 1 ? "goal" : "goals"}`,
        g.avgProgress != null ? `${g.avgProgress}% avg` : null,
        `${g.hoursThisMonth}h this month`,
        g.lastMovedAt ? `last moved ${fmt.date(g.lastMovedAt, "date")}` : null,
      ].filter(Boolean).join(" · ") : "";
      const chip = g?.verdict ? verdictChip(g.verdict) : null;
      return {
        key,
        count: null,
        label: (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {r.owner ? <Avatar person={r.owner} size={24} /> : null}
            <span className="shrink-0 font-medium text-ink">{g?.name ?? (nameOf(r.owner) || "Unassigned")}</span>
            <span className="truncate text-xs font-medium text-ink-2">{meta}</span>
            {chip ? <span className="ms-auto shrink-0"><ToneChip tone={chip.tone} label={chip.label} /></span> : null}
          </span>
        ),
      };
    }
    const l = LEVELS.find((x) => x.value === r.level) ?? LEVELS[2];
    return { key: l.value, label: l.group, count: data?.counts?.[l.value] ?? null };
  };

  const total = data?.pagination.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const isAdmin = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
  // The same facts the sidebar's Team goals row reads (hasReports, the
  // People team, Admin), so the pill renders on first paint, not after the
  // fetch.
  const canTeam = (data?.canTeam ?? isTeam) || boot.viewer.hasReports === true || boot.viewer.peopleTeam === true || isAdmin;

  const views = (
    <>
      <ViewTab label="My goals" active={view === "mine" || view === "level"} href={GOALS_VIEW_HREF.mine} />
      {canTeam ? <ViewTab label="Team goals" active={isTeam} href={GOALS_VIEW_HREF.team} /> : null}
      <ViewTab label="Company goals" active={view === "company"} href={GOALS_VIEW_HREF.company} />
    </>
  );

  const emptyCopy = isTeam ? "No goals across your team yet" : view === "company" ? "No company goals yet" : "No goals yet";
  const clearFilters = () => { setVerdicts([]); setLevels([]); setOwners([]); setDueFrom(null); setDueTo(null); setNudge(false); setDirect(false); setQ(""); resetPage(); };
  const toggle = <T,>(list: T[], val: T, on: boolean) => (on ? [...list, val] : list.filter((x) => x !== val));

  return (
    <>
      <OsPageHeader
        title="Goals"
        views={views}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: filterCount },
          sort: { onClick: () => setSortOpen((x) => !x), label: sort === "due" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "due" },
          primary: { label: "New goal", onClick: () => setCreating(true) },
          menu: [
            { label: "Show completed goals", checked: display.showCompleted, keepOpen: true, onClick: () => { setDisplay({ showCompleted: !display.showCompleted }); resetPage(); } },
            ...(isTeam ? [{ label: "Effort column", checked: display.showEffort, keepOpen: true, onClick: () => setDisplay({ showEffort: !display.showEffort }) }] : []),
          ],
        }}
      />
      {notice ? <p className="os-chrome px-6 pb-1 text-sm text-ink-2">{notice}</p> : null}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort goals" selected={sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(val) => { setSortOpen(false); setSort(val as Sort); resetPage(); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="goals" activeCount={filterCount} onClearAll={clearFilters}
          search={{ value: q, onChange: (val) => { setQ(val); resetPage(); }, placeholder: "Search goals" }}>
          <FilterGroup label="Verdict">
            {VERDICT_FILTERS.map((vd) => (
              <FilterRow key={vd} label={verdictChip(vd).label} checked={verdicts.includes(vd)} onCheckedChange={(on) => { setVerdicts((c) => toggle(c, vd, on)); resetPage(); }} />
            ))}
          </FilterGroup>
          {view !== "company" ? (
            <FilterGroup label="Level">
              {LEVELS.map((l) => (
                <FilterRow key={l.value} label={l.label} checked={levels.includes(l.value)} onCheckedChange={(on) => { setLevels((c) => toggle(c, l.value, on)); resetPage(); }} />
              ))}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Owner">
            <PeoplePickerField multiple ariaLabel="Owner" value={owners.map((o) => o.id)} people={owners} placeholder="Anyone"
              onChange={(_ids, picked) => { setOwners(picked); resetPage(); }} />
          </FilterGroup>
          <FilterGroup label="Due">
            <div className="flex flex-col gap-2">
              <DateField size="sm" value={dueFrom} onChange={(val) => { setDueFrom(val); resetPage(); }} placeholder="From" ariaLabel="Due from" />
              <DateField size="sm" value={dueTo} onChange={(val) => { setDueTo(val); resetPage(); }} placeholder="To" ariaLabel="Due to" />
            </div>
          </FilterGroup>
          {isTeam ? (
            <FilterGroup label="Team">
              <FilterRow label="Needs a nudge" checked={nudge} onCheckedChange={(on) => { setNudge(on); resetPage(); }} />
              <FilterRow label="Direct reports only" checked={direct} onCheckedChange={(on) => { setDirect(on); resetPage(); }} />
            </FilterGroup>
          ) : null}
        </FilterPanel>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {error && !data ? (
            <OsEmptyView variant="error" title="Couldn't load goals" hint={error} action={{ label: "Retry", onClick: () => void load() }} />
          ) : data && total === 0 && filterCount === 0 ? (
            <OsEmptyView title={emptyCopy} hint={isTeam ? undefined : "New goal, above, sets one up with a due date and a target."} />
          ) : (
            <TableCard
              ariaLabel="Goals"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/okrs/${r.id}`}
              groupOf={groupOf}
              collapsedGroups={collapsedNow}
              onToggleGroup={(key) => setCollapsed(() => { const n = new Set(collapsedNow); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              selectable={(rows ?? []).some((r) => r.canEdit)}
              isRowSelectable={(r) => r.canEdit}
              selected={selected}
              onSelectedChange={setSelected}
              onRowContextMenu={(r, e) => { const h = menuRefs.current.get(r.id); if (h) { e.preventDefault(); h.openAtPoint(e.clientX, e.clientY); } }}
              rowMenu={(r) => (
                <GoalRowMoreMenu
                  ref={(h) => { menuRefs.current.set(r.id, h); }}
                  goal={r}
                  canEdit={r.canEdit}
                  canDelete={r.canDelete}
                  canAssignOwner={mayAssign}
                  completed={Boolean(r.completedAt)}
                  onEdit={(opts) => setEditing({ goal: r, focusOwner: opts?.focusOwner })}
                  onDeleted={() => void load()}
                  onChanged={() => void load()}
                />
              )}
              bulkActions={(
                <>
                  <BulkAction icon={CheckCircle2} label="Mark complete" onClick={() => void bulkComplete()} />
                  {mayAssign ? (
                    <div className="relative">
                      <BulkAction icon={UserRound} label="Assign owner" onClick={() => setBulkOwnerOpen((x) => !x)} />
                      {bulkOwnerOpen ? (
                        <div className="absolute bottom-10 start-0 z-50 w-[260px]">
                          <PeoplePickerField ariaLabel="Assign owner" value={[]} people={[]} placeholder="Choose a person" side="top"
                            onChange={(_ids, picked) => { setBulkOwnerOpen(false); if (picked[0]) void bulkOwner(picked[0]); }} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {allDeletable
                    ? <BulkAction icon={Trash2} label="Delete" destructive onClick={() => void bulkDelete()} />
                    : <span className="px-2 text-sm text-ink-2">Some of these are not yours to delete.</span>}
                </>
              )}
              empty={<span className="text-row text-ink-2">No goals match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>}
              footer={data ? {
                total, noun: "goals", from, to, pageSize: PAGE_SIZE,
                onPrev: page > 1 ? () => setPage((p) => p - 1) : undefined,
                onNext: to < total ? () => setPage((p) => p + 1) : undefined,
              } : undefined}
            />
          )}
          {isTeam && data?.noGoals && data.noGoals.length > 0 ? (
            <p className="text-sm text-ink-2">
              No goals yet: {data.noGoals.slice(0, 8).map((p) => nameOf(p)).join(", ")}{data.noGoals.length > 8 ? ` and ${data.noGoals.length - 8} more` : ""}.
            </p>
          ) : null}
        </div>
      </div>
      {creating ? (
        <CreateGoalModal
          open
          level={view === "company" ? "COMPANY" : "INDIVIDUAL"}
          onClose={closeCreate}
          onSaved={(id) => {
            closeCreate();
            toast("Goal created", id ? { action: { label: "Open", onClick: () => router.push(`/okrs/${id}`) } } : undefined);
            void load();
          }}
        />
      ) : null}
      {editing ? (
        <CreateGoalModal
          key={editing.goal.id}
          open
          level={editing.goal.level}
          goal={{ ...editing.goal, owner: editing.goal.owner ?? null }}
          focusOwner={editing.focusOwner}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast("Goal saved"); void load(); }}
        />
      ) : null}
    </>
  );
}
