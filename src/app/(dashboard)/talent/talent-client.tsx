"use client";

// Talent (spec-teams-performance /talent): where your people sit on
// performance and potential, and the way to place them.
//
//   views     the periods as pills, newest first (?period=): the current
//             fiscal quarter by default, then the others, "..." for the
//             rest and All periods. A period is one of this fiscal year's
//             quarters, a period someone was placed for, or a completed
//             review cycle's name: a bounded list, never free text.
//   toolbar   Filter (search, Department, Job title, Reports to, Action,
//             Not yet placed) | Grid or List, the ONE blue Place person,
//             "..." Display (List columns), Fill from scores (a confirm that
//             names the count), Export CSV (never an Agent), Scoring and
//             reviews (Owner and Admin)
//   Grid      the neutral 9-box (NineBoxGrid); a cell opens the 360 detail
//             panel with its people, each a link, with Move on the grid,
//             Open profile and Remove placement in its "..."
//   List      a TableCard with the checkbox column: Move on the grid,
//             Remove placement, Export selected
//
// The population is the viewer's scope (the People team and Admin: the
// org; a manager: their chain), and a person never sees their own
// placement (DECIDED), on the grid, in the list or in a picker.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Grid3x3, List, MoreHorizontal, Move, Plus, Settings2, Trash2, UserRound, Wand2, X } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCard, BulkAction, RowMoreButton, type TableColumn } from "@/components/ui/table-card";
import { useConfirm } from "@/components/ui/dialog-provider";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PickerButton } from "@/components/dashboards/widget-registry";
import { PeoplePickerField, PersonAvatar, personName, type PickPerson } from "@/components/people/person-bits";
import { NineBoxGrid } from "@/components/performance/nine-box-grid";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { BOX_KEYS, TALENT_ACTIONS, actionLabel, boxDescription, boxLabel, levelLabel, type BoxKey } from "@/lib/performance/talent";

type UserLite = { id: string; firstName: string | null; lastName: string | null; avatar: string | null; managerId: string | null; department: { id: string; name: string } | null; role: { id: string; title: string } | null };
type Placement = {
  id: string;
  userId: string;
  period: string;
  performance: 1 | 2 | 3;
  potential: 1 | 2 | 3;
  boxPosition: string;
  action: string | null;
  notes: string | null;
  source: string;
  updatedAt: string;
  user: UserLite | null;
  placedBy: { id: string; name: string } | null;
};
type PeriodsResponse = { periods: Array<{ key: string; count: number }>; current: string };
type OptionalCol = "performance" | "potential" | "action" | "period" | "by" | "on";
const OPTIONAL_COLS: Array<{ key: OptionalCol; label: string }> = [
  { key: "performance", label: "Performance" },
  { key: "potential", label: "Potential" },
  { key: "action", label: "Action" },
  { key: "period", label: "Period" },
  { key: "by", label: "Placed by" },
  { key: "on", label: "Placed on" },
];
const ALL = "__all";

export default function TalentClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const { openSettings } = useSettingsNav();
  const viewer = boot.viewer as { id: string; orgRole?: string; isAgent?: boolean };
  const orgAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  // ── Periods ───────────────────────────────────────────────────────
  const [periods, setPeriods] = useState<PeriodsResponse | null>(null);
  const [periodsError, setPeriodsError] = useState<string | null>(null);
  const loadPeriods = useCallback(async () => {
    const r = await apiFetch<PeriodsResponse>("/api/talent-assessment/periods", { cache: "no-store" });
    if (!r.ok) { setPeriodsError(r.error || "Couldn't load the periods"); return; }
    setPeriodsError(null);
    setPeriods(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void loadPeriods(); }, 0); return () => clearTimeout(t); }, [loadPeriods]);
  const periodParam = sp?.get("period") ?? "";
  const period = periodParam || periods?.current || "";
  const allPeriods = period === ALL;

  const view = sp?.get("view") === "list" ? "list" : "grid";
  const q = sp?.get("q") ?? "";
  const dept = sp?.get("dept") ?? "";
  const title = sp?.get("title") ?? "";
  const reportsTo = sp?.get("reportsTo") ?? "";
  const action = sp?.get("action") ?? "";
  const unplaced = sp?.get("unplaced") === "1";
  const filters = [q, dept, title, reportsTo, action, unplaced ? "1" : ""].filter(Boolean).length;

  // ── Placements ────────────────────────────────────────────────────
  const [rows, setRows] = useState<Placement[] | null>(null);
  const [rowsFor, setRowsFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!period) return;
    const r = await apiFetch<Placement[]>(`/api/talent-assessment${allPeriods ? "" : `?period=${encodeURIComponent(period)}`}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load the talent grid"); toast(r.error || "Couldn't load the talent grid", { tone: "danger" }); return; }
    setError(null);
    setRows(Array.isArray(r.data) ? r.data : []);
    setRowsFor(period);
  }, [period, allPeriods, toast]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  // A finalize on a cycle writes placements: come back to fresh ones.
  useEffect(() => {
    const again = () => { void load(); void loadPeriods(); };
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [load, loadPeriods]);

  // ── People not yet placed (the List view's "Not yet placed") ──────
  const [unplacedPeople, setUnplacedPeople] = useState<UserLite[] | null>(null);
  useEffect(() => {
    if (!unplaced || allPeriods || !period) return;
    let live = true;
    void apiFetch<{ data: UserLite[] }>(`/api/talent-assessment/people?unplacedFor=${encodeURIComponent(period)}`, { cache: "no-store" }).then((r) => { if (live) setUnplacedPeople(r.ok ? r.data.data : []); });
    return () => { live = false; };
  }, [unplaced, allPeriods, period, rows]);

  const matches = useCallback((u: UserLite | null) => {
    if (!u) return false;
    if (q && !personName(u).toLowerCase().includes(q.toLowerCase())) return false;
    if (dept && u.department?.id !== dept) return false;
    if (title && u.role?.id !== title) return false;
    if (reportsTo && u.managerId !== reportsTo) return false;
    return true;
  }, [q, dept, title, reportsTo]);
  const shown = useMemo(() => (unplaced ? [] : (rows ?? []).filter((p) => matches(p.user) && (!action || p.action === action))), [rows, matches, action, unplaced]);
  const cells = useMemo(() => {
    const c: Partial<Record<BoxKey, Array<{ id: string; firstName: string | null; lastName: string | null; avatar: string | null }>>> = {};
    for (const p of shown) if (p.user && BOX_KEYS.includes(p.boxPosition as BoxKey)) (c[p.boxPosition as BoxKey] ??= []).push(p.user);
    return c;
  }, [shown]);
  const depts = useMemo(() => [...new Map((rows ?? []).filter((p) => p.user?.department).map((p) => [p.user!.department!.id, p.user!.department!.name])).entries()], [rows]);
  const titles = useMemo(() => [...new Map((rows ?? []).filter((p) => p.user?.role).map((p) => [p.user!.role!.id, p.user!.role!.title])).entries()], [rows]);

  // ── Display columns (List) ────────────────────────────────────────
  const stored = ((prefs.home as { teams?: { surface?: Record<string, { viewOptions?: { columns?: Record<string, boolean> } }> } } | undefined)
    ?.teams?.surface?.talent?.viewOptions?.columns) ?? {};
  const [colsLocal, setColsLocal] = useState<Partial<Record<OptionalCol, boolean>>>({});
  const cols = Object.fromEntries(OPTIONAL_COLS.map((c) => [c.key, colsLocal[c.key] ?? stored[c.key] ?? true])) as Record<OptionalCol, boolean>;
  const setCol = (k: OptionalCol, on: boolean) => {
    setColsLocal((c) => ({ ...c, [k]: on }));
    void patchPrefs({ home: { teams: { surface: { talent: { viewOptions: { columns: { [k]: on } } } } } } }).then((ok) => { if (!ok) toast("Couldn't save that setting", { tone: "danger" }); });
  };

  // ── Actions ───────────────────────────────────────────────────────
  const [cell, setCell] = useState<BoxKey | null>(null);
  const [cellFor, setCellFor] = useState(period);
  if (cellFor !== period) { setCellFor(period); setCell(null); }
  const [place, setPlace] = useState<null | { people: UserLite[]; box: BoxKey | null; action: string | null; notes: string; period: string }>(null);
  const [menu, setMenu] = useState<{ p: Placement | null; u: UserLite; anchor: RefObject<HTMLElement | null> } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(filters > 0);
  const [draftQ, setDraftQ] = useState(q);
  const [reportsPick, setReportsPick] = useState<PickPerson | null>(null);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);
  const clearFilters = () => { setDraftQ(""); setReportsPick(null); setParams({ q: null, dept: null, title: null, reportsTo: null, action: null, unplaced: null }); };

  const removePlacement = async (p: Placement) => {
    const ok = await confirm({ title: `Remove ${p.user ? personName(p.user) : "this person"} from the grid?`, description: `They go back to not placed for ${p.period}. Nothing else about them changes.`, confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/talent-assessment/${p.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't remove the placement", { tone: "danger" }); return; }
    toast("Placement removed");
    void load();
    void loadPeriods();
  };
  const removeMany = async (ids: string[]) => {
    const ok = await confirm({ title: `Remove ${ids.length} ${ids.length === 1 ? "placement" : "placements"}?`, description: "They go back to not placed for that period.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    let failed = 0;
    for (const id of ids) { const r = await apiFetch(`/api/talent-assessment/${id}`, { method: "DELETE" }); if (!r.ok) failed += 1; }
    toast(failed ? `Removed ${ids.length - failed}. ${failed} could not be removed.` : `Removed ${ids.length}`, failed ? { tone: "danger" } : undefined);
    setSelected(new Set());
    void load();
  };
  const fill = async () => {
    if (allPeriods || !period) return;
    const c = await apiFetch<{ wouldPlace: number; skipped: number }>(`/api/talent-assessment/fill?period=${encodeURIComponent(period)}`, { cache: "no-store" });
    if (!c.ok) { toast(c.error || "Couldn't count who to place", { tone: "danger" }); return; }
    if (!c.data.wouldPlace) { toast(`Nobody to place: everyone with a performance score is already placed for ${period}`); return; }
    const ok = await confirm({ title: `Place ${c.data.wouldPlace} ${c.data.wouldPlace === 1 ? "person" : "people"}?`, description: `${c.data.wouldPlace === 1 ? "This person has" : "They have"} a performance score and no placement for ${period}. Potential starts at Medium. You can move anyone afterwards.`, confirmLabel: "Place", destructive: false });
    if (!ok) return;
    const r = await apiFetch<{ placed: number }>("/api/talent-assessment/fill", { method: "POST", json: { period } });
    if (!r.ok) { toast(r.error || "Couldn't place them", { tone: "danger" }); return; }
    toast(`Placed ${r.data.placed} ${r.data.placed === 1 ? "person" : "people"}`);
    void load();
    void loadPeriods();
  };
  const exportHref = (ids?: string[]) => `/api/talent-assessment?format=csv${allPeriods ? "" : `&period=${encodeURIComponent(period)}`}${ids?.length ? `&ids=${ids.join(",")}` : ""}`;
  const openPlace = (people: UserLite[], box: BoxKey | null, existing?: Placement | null) => {
    setPlace({ people, box, action: existing?.action ?? null, notes: existing?.notes ?? "", period: existing?.period ?? (allPeriods ? periods?.current ?? "" : period) });
  };

  const periodList = periods?.periods ?? [];
  const pills = periodList.slice(0, 3);
  const overflow = periodList.slice(3);
  const activeInOverflow = overflow.some((p) => p.key === period);

  const columns: TableColumn<Placement>[] = [
    { key: "person", label: "Person", title: true, width: "minmax(200px,1.6fr)", render: (p) => (
      <span className="flex min-w-0 items-center gap-2">{p.user ? <PersonAvatar person={p.user} size={28} /> : null}<span className="min-w-0 truncate">{p.user ? personName(p.user) : ""}</span></span>
    ) },
    { key: "box", label: "Box", width: "minmax(170px,1fr)", render: (p) => <span className="truncate" title={boxDescription(p.boxPosition)}>{boxLabel(p.boxPosition)}</span> },
    ...(cols.performance ? [{ key: "performance", label: "Performance", width: "110px", hideBelow: 760, render: (p: Placement) => <span>{levelLabel(p.performance)}</span> }] : []),
    ...(cols.potential ? [{ key: "potential", label: "Potential", width: "100px", hideBelow: 760, render: (p: Placement) => <span>{levelLabel(p.potential)}</span> }] : []),
    ...(cols.action ? [{ key: "action", label: "Action", width: "150px", hideBelow: 880, render: (p: Placement) => (p.action ? <span className="inline-flex h-6 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink">{actionLabel(p.action)}</span> : null) }] : []),
    ...(cols.period ? [{ key: "period", label: "Period", width: "130px", hideBelow: 980, render: (p: Placement) => <span className="truncate text-ink-2">{p.period}</span> }] : []),
    ...(cols.by ? [{ key: "by", label: "Placed by", width: "150px", hideBelow: 1100, render: (p: Placement) => <span className="truncate text-ink-2">{p.source === "SCORES" ? "From scores" : p.source === "CALIBRATION" ? "From a review cycle" : p.placedBy?.name ?? ""}</span> }] : []),
    ...(cols.on ? [{ key: "on", label: "Placed on", width: "120px", hideBelow: 1200, render: (p: Placement) => <span className="tabular-nums text-ink-2">{formatDate(p.updatedAt, datePrefs, "date")}</span> }] : []),
  ];
  const unplacedColumns: TableColumn<UserLite>[] = [
    { key: "person", label: "Person", title: true, width: "minmax(220px,2fr)", render: (u) => <span className="flex min-w-0 items-center gap-2"><PersonAvatar person={u} size={28} /><span className="min-w-0 truncate">{personName(u)}</span></span> },
    { key: "dept", label: "Department", width: "minmax(140px,1fr)", render: (u) => <span className="truncate text-ink-2">{u.department?.name ?? ""}</span> },
    { key: "title", label: "Job title", width: "minmax(140px,1fr)", render: (u) => <span className="truncate text-ink-2">{u.role?.title ?? ""}</span> },
  ];

  const cellRows = cell ? shown.filter((p) => p.boxPosition === cell) : [];
  const loading = rows === null || rowsFor !== period;

  return (
    <>
      <Breadcrumb items={[{ label: "Talent (9-box)" }]} />
      <OsPageHeader
        title="Talent"
        askAi
        views={periods ? (
          <>
            {pills.map((p) => <ViewTab key={p.key} label={p.key} active={period === p.key} onClick={() => setParams({ period: p.key === periods.current ? null : p.key })} />)}
            {overflow.length ? (
              <span className="relative">
                <ViewTab label={activeInOverflow ? period : "•••"} active={activeInOverflow} onClick={() => setOverflowOpen((v) => !v)} />
                {overflowOpen ? (
                  <Picker open onClose={() => setOverflowOpen(false)} ariaLabel="More periods" selected={period} className="absolute start-0 top-8 z-50"
                    sections={[{ options: overflow.map((p) => ({ value: p.key, label: p.key, hint: p.count ? String(p.count) : undefined })) }]}
                    onSelect={(v) => { setOverflowOpen(false); setParams({ period: v }); }} />
                ) : null}
              </span>
            ) : null}
            <ViewTab label="All periods" active={allPeriods} onClick={() => setParams({ period: ALL })} />
          </>
        ) : undefined}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filters },
          switcher: { value: view, options: [{ key: "grid", label: "Grid", icon: Grid3x3 }, { key: "list", label: "List", icon: List }], onChange: (k) => setParams({ view: k === "list" ? "list" : null }) },
          // One blue on screen: the modal's own Place person replaces it.
          ...(place ? {} : { primary: { label: "Place person", icon: Plus, onClick: () => openPlace([], cell) } }),
          menu: [
            ...(view === "list" ? OPTIONAL_COLS.map((c) => ({ label: `Show ${c.label}`, checked: cols[c.key], keepOpen: true, onClick: () => setCol(c.key, !cols[c.key]) })) : []),
            ...(!allPeriods ? [...(view === "list" ? [{ separator: true as const }] : []), { label: "Fill from scores", icon: Wand2, onClick: () => void fill() }] : []),
            ...(!viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = exportHref(); } }] : []),
            ...(orgAdmin ? [{ separator: true as const }, { label: "Scoring and reviews", icon: Settings2, onClick: () => openSettings("/settings/scoring") }] : []),
          ],
        }}
      />
      <div className="os-chrome flex min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-8 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="people" activeCount={filters} onClearAll={clearFilters}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search people" }}>
          {depts.length ? <FilterGroup label="Department">{depts.map(([id, name]) => <FilterRow key={id} label={name} checked={dept === id} onCheckedChange={(on) => setParams({ dept: on ? id : null })} />)}</FilterGroup> : null}
          {titles.length ? <FilterGroup label="Job title">{titles.map(([id, name]) => <FilterRow key={id} label={name} checked={title === id} onCheckedChange={(on) => setParams({ title: on ? id : null })} />)}</FilterGroup> : null}
          <FilterGroup label="Reports to">
            <li className="px-1 py-1">
              <PeoplePickerField ariaLabel="Reports to" managersOnly value={reportsTo ? [reportsTo] : []} people={reportsPick ? [reportsPick] : []} placeholder="Anyone"
                onChange={(ids, picked) => { setReportsPick(picked[0] ?? null); setParams({ reportsTo: ids[0] ?? null }); }} />
            </li>
          </FilterGroup>
          <FilterGroup label="Action">{TALENT_ACTIONS.map((a) => <FilterRow key={a.value} label={a.label} checked={action === a.value} onCheckedChange={(on) => setParams({ action: on ? a.value : null })} />)}</FilterGroup>
          {!allPeriods ? <FilterGroup label="Placement"><FilterRow label="Not yet placed" checked={unplaced} onCheckedChange={(on) => setParams({ unplaced: on ? "1" : null, view: on ? "list" : null })} /></FilterGroup> : null}
        </FilterPanel>
        <div className="flex min-w-0 flex-1 gap-4">
          <div className="min-w-0 flex-1">
            {(error && !rows) || (periodsError && !periods) ? (
              <OsEmptyView variant="error" title="Couldn't load the talent grid" hint={error ?? periodsError ?? undefined} action={{ label: "Try again", onClick: () => { void loadPeriods(); void load(); } }} />
            ) : unplaced ? (
              <TableCard
                ariaLabel="People not yet placed"
                columns={unplacedColumns}
                rows={unplacedPeople}
                rowKey={(u) => u.id}
                rowMenu={(u) => <RowMoreButton label={`Actions for ${personName(u)}`} onClick={(e) => setMenu({ p: null, u, anchor: { current: e.currentTarget } })} />}
                empty={<span className="text-row text-ink-2">Everyone you can see is placed for {period}</span>}
                footer={unplacedPeople ? { total: unplacedPeople.length, noun: "people not yet placed", from: unplacedPeople.length ? 1 : 0, to: unplacedPeople.length, hidePaging: true } : undefined}
              />
            ) : view === "list" ? (
              <TableCard
                ariaLabel="Placements"
                columns={columns}
                rows={loading ? null : shown}
                rowKey={(p) => p.id}
                rowHref={(p) => `/people/${p.userId}`}
                selectable
                selected={selected}
                onSelectedChange={setSelected}
                rowMenu={(p) => (p.user ? <RowMoreButton label={`Actions for ${personName(p.user)}`} onClick={(e) => setMenu({ p, u: p.user!, anchor: { current: e.currentTarget } })} /> : null)}
                empty={filters ? <span className="text-row text-ink-2">No one matches · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span> : <span className="text-row text-ink-2">Nobody is placed for {allPeriods ? "any period" : period}{!allPeriods ? <> · <button type="button" className="text-brand-deep hover:underline" onClick={() => void fill()}>Fill from scores</button></> : null}</span>}
                bulkActions={
                  <>
                    <BulkAction icon={Move} label="Move on the grid" onClick={() => openPlace(shown.filter((p) => selected.has(p.id) && p.user).map((p) => p.user!), null)} />
                    {!viewer.isAgent ? <BulkAction icon={Trash2} label="Remove placement" destructive onClick={() => void removeMany([...selected])} /> : null}
                    {!viewer.isAgent ? <BulkAction icon={Download} label="Export selected" onClick={() => { window.location.href = exportHref([...selected]); }} /> : null}
                  </>
                }
                footer={loading ? undefined : { total: shown.length, noun: "placements", from: shown.length ? 1 : 0, to: shown.length, hidePaging: true }}
              />
            ) : loading ? (
              <div className="grid max-w-[900px] grid-cols-3 gap-px" aria-busy="true" aria-label="Loading the talent grid">
                {Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-[148px] w-full rounded-none" />)}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <NineBoxGrid cells={cells} selected={cell} onSelect={(k) => setCell((c) => (c === k ? null : k))} />
                {shown.length === 0 ? (
                  filters ? (
                    <p className="m-0 text-sm text-ink-2">No one matches · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></p>
                  ) : (
                    <p className="m-0 text-sm text-ink-2">Nobody is placed for {allPeriods ? "any period" : period}.{!allPeriods ? <> <button type="button" className="text-brand-deep hover:underline" onClick={() => void fill()}>Fill from scores</button></> : null}</p>
                  )
                ) : null}
              </div>
            )}
          </div>
          {view === "grid" && cell && !unplaced ? (
            <aside className="w-[360px] shrink-0 self-start rounded-lg border border-line bg-raised" aria-label={boxLabel(cell)}>
              <header className="flex items-start gap-2 border-b border-line-soft px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-lg font-semibold text-ink">{boxLabel(cell)}</h2>
                  <p className="m-0 text-sm text-ink-2">{boxDescription(cell)} · {cellRows.length} {cellRows.length === 1 ? "person" : "people"}</p>
                </div>
                <button type="button" aria-label="Close" onClick={() => setCell(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" /></button>
              </header>
              {cellRows.length ? (
                <ul className="m-0 list-none divide-y divide-line-soft p-0">
                  {cellRows.map((p) => p.user ? (
                    <li key={p.id} className="flex min-h-9 items-center gap-2 px-4 py-1.5">
                      <PersonAvatar person={p.user} size={24} />
                      <Link href={`/people/${p.userId}`} className="min-w-0 flex-1 truncate text-row text-ink hover:underline">{personName(p.user)}</Link>
                      {p.action ? <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink">{actionLabel(p.action)}</span> : null}
                      <button type="button" aria-label={`Actions for ${personName(p.user)}`} aria-haspopup="menu" onClick={(e) => setMenu({ p, u: p.user!, anchor: { current: e.currentTarget } })}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                      </button>
                    </li>
                  ) : null)}
                </ul>
              ) : <p className="m-0 px-4 py-3 text-sm text-ink-2">Nobody here{allPeriods ? "" : ` for ${period}`}.</p>}
            </aside>
          ) : null}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Placement actions">
            <MenuItem icon={Move} label={menu.p ? "Move on the grid" : "Place on the grid"} onClick={() => { const m = menu; setMenu(null); openPlace([m.u], m.p ? (m.p.boxPosition as BoxKey) : null, m.p); }} />
            <MenuItem icon={UserRound} label="Open profile" onClick={() => { const id = menu.u.id; setMenu(null); router.push(`/people/${id}`); }} />
            {menu.p && !viewer.isAgent ? <><MenuSeparator /><MenuItem icon={Trash2} label="Remove placement" destructive onClick={() => { const p = menu.p!; setMenu(null); void removePlacement(p); }} /></> : null}
          </MenuList>
        </MorePortal>
      ) : null}

      {place ? (
        <PlacePersonDialog
          initial={place}
          periods={periodList.map((p) => p.key)}
          onClose={() => setPlace(null)}
          onPlaced={(n) => { setPlace(null); setSelected(new Set()); toast(n === 1 ? "Placed on the grid" : `Placed ${n} people`); void load(); void loadPeriods(); }}
        />
      ) : null}
    </>
  );
}

function PlacePersonDialog({
  initial,
  periods,
  onClose,
  onPlaced,
}: {
  initial: { people: UserLite[]; box: BoxKey | null; action: string | null; notes: string; period: string };
  periods: string[];
  onClose: () => void;
  onPlaced: (n: number) => void;
}) {
  const confirm = useConfirm();
  const [people, setPeople] = useState<UserLite[]>(initial.people);
  const [box, setBox] = useState<BoxKey | null>(initial.box);
  const [period, setPeriod] = useState(initial.period);
  const [action, setAction] = useState<string | null>(initial.action);
  const [notes, setNotes] = useState(initial.notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<UserLite[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const fixedPeople = initial.people.length > 0;

  useEffect(() => {
    if (!pickOpen) return;
    const t = setTimeout(() => {
      void apiFetch<{ data: UserLite[] }>(`/api/talent-assessment/people?q=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) => { if (r.ok) setFound(r.data.data); });
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [pickOpen, q]);

  const dirty = (!fixedPeople && people.length > 0) || box !== initial.box || notes !== initial.notes || action !== initial.action;
  const requestClose = async () => {
    if (busy) return;
    if (dirty && !(await confirm({ title: "Discard this placement?", description: "Nothing has been placed yet.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  };
  const save = async () => {
    if (!people.length) { setErr("Pick who to place."); return; }
    if (!box) { setErr("Pick a box on the grid."); return; }
    if (!period) { setErr("Pick a period."); return; }
    const [performance, potential] = box.split("-").map(Number);
    setBusy(true);
    setErr(null);
    let ok = 0;
    const failed: string[] = [];
    for (const p of people) {
      const r = await apiFetch("/api/talent-assessment", { method: "POST", json: { userId: p.id, period, performance, potential, action, notes: notes.trim() || null } });
      if (r.ok) ok += 1; else failed.push(`${personName(p)}: ${r.error || "not saved"}`);
    }
    setBusy(false);
    if (failed.length) { setErr(`Not placed: ${failed.join("; ")}`); if (!ok) return; }
    onPlaced(ok);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) void requestClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{fixedPeople && people.length === 1 ? `Place ${personName(people[0])}` : fixedPeople ? `Move ${people.length} people` : "Place person"}</DialogTitle>
          <DialogDescription>Where they sit on performance and potential for a period.</DialogDescription>
        </DialogHeader>
        {!fixedPeople ? (
          <div className="relative flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Person</span>
            <button type="button" onClick={() => setPickOpen((v) => !v)} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-start text-row text-ink hover:bg-hover">
              {people[0] ? <><PersonAvatar person={people[0]} size={20} /><span className="truncate">{personName(people[0])}</span></> : <span className="text-ink-3">Pick someone you can see</span>}
            </button>
            {pickOpen ? (
              <Picker open onClose={() => setPickOpen(false)} ariaLabel="Person" alwaysSearch searchPlaceholder="Search people" onSearchChange={setQ} className="absolute start-0 top-16 z-50" width={360}
                emptyLabel="Nobody by that name in your scope"
                sections={[{ options: found.map((u) => ({ value: u.id, label: personName(u), description: [u.role?.title, u.department?.name].filter(Boolean).join(" · ") || undefined })) }]}
                onSelect={(id) => { const u = found.find((x) => x.id === id); if (u) setPeople([u]); setPickOpen(false); }} />
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Box</span>
          <NineBoxGrid size="mini" cells={{}} selected={box} onSelect={setBox} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Period</span>
            <PickerButton ariaLabel="Period" label={period || <span className="text-ink-3">Pick a period</span>} selected={period} sections={[{ options: periods.map((p) => ({ value: p, label: p })) }]} onSelect={setPeriod} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Action</span>
            <PickerButton ariaLabel="Action" label={action ? actionLabel(action) : "None"} selected={action ?? "none"}
              sections={[{ options: [{ value: "none", label: "None" }, ...TALENT_ACTIONS] }]} onSelect={(v) => setAction(v === "none" ? null : v)} />
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
        </label>
        {err ? <p role="alert" className="m-0 text-sm text-danger-text">{err}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => void requestClose()} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Placing" : "Place person"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


