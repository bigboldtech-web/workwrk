"use client";

// Review cycles (spec-teams-performance /reviews): every review round the
// company is running, and the way to start a new one.
//
//   views     Active (default, includes In calibration) · Draft · Completed
//             (and Cancelled) · All  (?view=)
//   toolbar   Filter (search, Type, Period, Started by, Covers), Sort (Newest
//             first, Name A to Z, Closing soonest, Least complete), the ONE
//             blue New cycle (only for someone who may start one), "..."
//             Display (columns), Export CSV (never an Agent), Scoring and
//             reviews (Owner and Admin)
//   body      a TableCard, no checkbox column (no action makes sense on
//             several cycles at once). The row opens the cycle page; the
//             row "..." holds the three named moves, each behind a confirm:
//             Launch cycle, Start calibration, Cancel cycle, plus Send a
//             reminder. Completed is only ever reached by Finalize.
//   footer    "Total cycles N", computed by the server over every cycle the
//             viewer may read (the old tile strip counted a capped page).
//
// What went: the Featured cycle hero (its Launch, ring and raw "Move to
// {next}" PATCH are the row menu and the cycle page), the four tiles (their
// numbers are the footer and the Progress column), the KRA/KPI and Talent
// header links (both are Teams sidebar rows).

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, Bell, Download, ExternalLink, Link2, Play, Plus, Scale, Settings2 } from "lucide-react";
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
import { TableCard, RowMoreButton, type TableColumn } from "@/components/ui/table-card";
import { useConfirm } from "@/components/ui/dialog-provider";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { PeoplePickerField, ToneChip, type PickPerson } from "@/components/people/person-bits";
import { ReviewStepDots } from "@/components/performance/review-step-dots";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { CYCLE_STATUS, CYCLE_TYPES, cycleStatusOf, cycleTypeLabel, stepsPassed } from "@/lib/performance/review-cycle";
import { NewReviewCycleDialog } from "./new-review-dialog";

type CycleRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  audienceType: string;
  covers: string;
  createdBy: { id: string; name: string } | null;
  counts: { total: number; selfDone: number; managerDone: number; calibrated: number; completed: number };
  canManage: boolean;
};
type ListResponse = { data: CycleRow[]; pagination: { total: number; page: number; limit: number; hasMore: boolean } };
type OptionalCol = "type" | "period" | "covers" | "progress" | "by";
const OPTIONAL_COLS: Array<{ key: OptionalCol; label: string }> = [
  { key: "type", label: "Type" },
  { key: "period", label: "Period" },
  { key: "covers", label: "Covers" },
  { key: "progress", label: "Completion" },
  { key: "by", label: "Started by" },
];
const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name A to Z" },
  { value: "closing", label: "Closing soonest" },
  { value: "least", label: "Least complete" },
];
type View = "active" | "draft" | "completed" | "all";
const VIEW_STATUSES: Record<View, string[]> = {
  active: ["ACTIVE", "IN_CALIBRATION"],
  draft: ["DRAFT"],
  completed: ["COMPLETED", "CANCELLED"],
  all: Object.keys(CYCLE_STATUS),
};
const PAGE = 40;

export default function ReviewsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { prefs, patchPrefs } = useOsShell();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  // A cycle's start and close are calendar days, stored at midnight UTC:
  // read them as days, never shifted a day by the viewer's time zone.
  const dayPrefs = { ...datePrefs, timezone: "UTC" };
  const { openSettings } = useSettingsNav();

  const viewer = boot.viewer as { id: string; orgRole?: string; isAgent?: boolean; peopleTeam?: boolean; hasReports?: boolean };
  const orgAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  const orgWide = orgAdmin || viewer.peopleTeam === true;
  const canCreate = orgWide || viewer.hasReports === true;
  const canExport = !viewer.isAgent && viewer.orgRole !== "GUEST";

  const rawView = sp?.get("view");
  const view: View = rawView === "draft" || rawView === "completed" || rawView === "all" ? rawView : "active";
  const q = sp?.get("q") ?? "";
  const status = sp?.get("status") ?? "";
  const type = sp?.get("type") ?? "";
  const from = sp?.get("from") ?? "";
  const to = sp?.get("to") ?? "";
  const by = sp?.get("by") ?? "";
  const audience = sp?.get("audience") ?? "";
  const sortParam = sp?.get("sort") ?? "";
  const sort = SORTS.some((s) => s.value === sortParam) ? sortParam : "newest";
  const page = Math.max(1, Number(sp?.get("page") ?? "1") || 1);
  const filters = [q, type, from, to, by, audience].filter(Boolean).length;

  const stored = ((prefs.home as { teams?: { surface?: Record<string, { viewOptions?: { columns?: Record<string, boolean> } }> } } | undefined)
    ?.teams?.surface?.reviews?.viewOptions?.columns) ?? {};
  const [colsLocal, setColsLocal] = useState<Partial<Record<OptionalCol, boolean>>>({});
  const cols = Object.fromEntries(OPTIONAL_COLS.map((c) => [c.key, colsLocal[c.key] ?? stored[c.key] ?? c.key !== "by"])) as Record<OptionalCol, boolean>;
  const setCol = (k: OptionalCol, on: boolean) => {
    setColsLocal((c) => ({ ...c, [k]: on }));
    void patchPrefs({ home: { teams: { surface: { reviews: { viewOptions: { columns: { [k]: on } } } } } } }).then((ok) => {
      if (!ok) toast("Couldn't save that setting", { tone: "danger" });
    });
  };

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!("page" in patch)) next.delete("page");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  // ── New cycle (?new=1 from the Teams "+") ───────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [now] = useState(() => new Date());
  const newArmed = useRef(true);
  useEffect(() => {
    if (sp?.get("new") !== "1") { newArmed.current = true; return; }
    if (!newArmed.current) return;
    newArmed.current = false;
    setParams({ new: null });
    if (canCreate) setTimeout(() => setNewOpen(true), 0);
  }, [sp, canCreate, setParams]);

  // ── The list ──────────────────────────────────────────────────────
  const listQs = useMemo(() => {
    const p = new URLSearchParams({ view, sort, page: String(page), limit: String(PAGE) });
    for (const [k, v] of Object.entries({ q, status, type, from, to, by, audience })) if (v) p.set(k, v);
    return p.toString();
  }, [view, sort, page, q, status, type, from, to, by, audience]);
  const [list, setList] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/reviews?${listQs}`, { cache: "no-store" });
    if (!r.ok) {
      setError(r.error || "Couldn't load review cycles");
      toast(r.error || "Couldn't load review cycles", { tone: "danger" });
      return;
    }
    setError(null);
    setList(r.data);
  }, [listQs, toast]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // ── Filter state ──────────────────────────────────────────────────
  const [filterOpen, setFilterOpen] = useState(filters > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [draftQ, setDraftQ] = useState(q);
  const [byPick, setByPick] = useState<PickPerson | null>(null);
  const [depts, setDepts] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);
  useEffect(() => {
    if (!filterOpen || depts.length) return;
    void apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }).then((r) => { if (r.ok && Array.isArray(r.data)) setDepts(r.data); });
  }, [filterOpen, depts.length]);
  const clearFilters = () => { setDraftQ(""); setByPick(null); setParams({ q: null, type: null, from: null, to: null, by: null, audience: null, status: null }); };
  const types = type ? type.split(",") : [];
  const toggleType = (t: string, on: boolean) => {
    const next = new Set(types);
    if (on) next.add(t); else next.delete(t);
    setParams({ type: [...next].join(",") || null });
  };

  // ── Row actions ───────────────────────────────────────────────────
  const [menu, setMenu] = useState<{ row: CycleRow; anchor: RefObject<HTMLElement | null> } | null>(null);
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const launch = async (c: CycleRow) => {
    const ok = await confirm({ title: `Launch ${c.name}?`, description: `This creates a review for everyone it covers (${c.covers.toLowerCase()}) and emails each of them.`, confirmLabel: "Launch", destructive: false });
    if (!ok) return;
    const r = await apiFetch<{ count: number }>(`/api/reviews/${c.id}/launch`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't launch the cycle", { tone: "danger" }); return; }
    toast(`Launched. ${people(r.data.count)} asked for a review.`);
    void load();
  };
  const startCalibration = async (c: CycleRow) => {
    const ok = await confirm({ title: `Start calibration for ${c.name}?`, description: "Managers can no longer change a review they submitted after this. Anyone not done yet can still submit.", confirmLabel: "Start calibration", destructive: false });
    if (!ok) return;
    const r = await apiFetch(`/api/reviews`, { method: "PATCH", json: { id: c.id, status: "IN_CALIBRATION" } });
    if (!r.ok) { toast(r.error || "Couldn't start calibration", { tone: "danger" }); return; }
    toast("Calibration started");
    void load();
  };
  const remind = async (c: CycleRow) => {
    const r = await apiFetch<{ notified: number }>(`/api/reviews/${c.id}/reminders`, { method: "POST", json: {} });
    if (!r.ok) { toast(r.error || "Couldn't send reminders", { tone: "danger" }); return; }
    toast(r.data.notified ? `Reminded ${people(r.data.notified)}` : "Nobody needed a reminder");
  };
  const cancel = async (c: CycleRow) => {
    const ok = await confirm({ title: `Cancel ${c.name}?`, description: "Nothing is deleted. The cycle stops and nobody is asked for anything more.", confirmLabel: "Cancel cycle", cancelLabel: "Keep it", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/reviews/${c.id}/cancel`, { method: "POST", json: {} });
    if (!r.ok) { toast(r.error || "Couldn't cancel the cycle", { tone: "danger" }); return; }
    toast("Cycle cancelled");
    void load();
  };
  const copyLink = (id: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/reviews/${id}`)
      .then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  };

  const period = (c: CycleRow) => `${formatDate(c.startDate, dayPrefs, "date")} to ${formatDate(c.endDate, dayPrefs, "date")}`;
  const statusFilterNode = (
    <span className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setStatusOpen((v) => !v); }} className="ms-1 inline-flex h-6 items-center rounded px-1 text-xs font-medium text-ink-2 hover:bg-hover hover:text-ink" aria-haspopup="listbox">
        {status ? cycleStatusOf(status).label : "All"} ▾
      </button>
      {statusOpen ? (
        <Picker open onClose={() => setStatusOpen(false)} ariaLabel="Status" selected={status || "any"} className="absolute start-0 top-7 z-50"
          sections={[{ options: [{ value: "any", label: "All" }, ...VIEW_STATUSES[view].map((s) => ({ value: s, label: cycleStatusOf(s).label }))] }]}
          onSelect={(v) => { setStatusOpen(false); setParams({ status: v === "any" ? null : v }); }} />
      ) : null}
    </span>
  );

  const columns: TableColumn<CycleRow>[] = [
    {
      key: "name", label: "Cycle", title: true, width: "minmax(240px,2fr)", headerFilter: statusFilterNode,
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{c.name}</span>
          <ToneChip tone={cycleStatusOf(c.status).tone} label={cycleStatusOf(c.status).label} />
        </span>
      ),
    },
    ...(cols.type ? [{ key: "type", label: "Type", width: "150px", hideBelow: 820, render: (c: CycleRow) => <span className="truncate">{cycleTypeLabel(c.type)}</span> }] : []),
    ...(cols.period ? [{ key: "period", label: "Period", width: "minmax(200px,1fr)", hideBelow: 980, render: (c: CycleRow) => <span className="truncate tabular-nums">{period(c)}</span> }] : []),
    ...(cols.covers ? [{ key: "covers", label: "Covers", width: "minmax(110px,1fr)", hideBelow: 1000, render: (c: CycleRow) => <span className="truncate text-ink-2">{c.covers}</span> }] : []),
    ...(cols.progress ? [{
      key: "progress", label: "Progress", width: "190px", hideBelow: 700,
      render: (c: CycleRow) => (
        <span className="flex items-center gap-2">
          {/* Stalled: still Active past its close date, so the step it is on is --os-danger-solid. */}
          <ReviewStepDots passed={stepsPassed(c.status, c.counts)} stalled={c.status === "ACTIVE" && new Date(c.endDate).getTime() < Date.now()} />
          <span className="text-sm tabular-nums text-ink-2">{c.counts.total ? `${c.counts.completed} of ${c.counts.total}` : c.status === "DRAFT" ? "Not launched" : "Nobody"}</span>
        </span>
      ),
    }] : []),
    ...(cols.by ? [{ key: "by", label: "Started by", width: "150px", hideBelow: 1200, render: (c: CycleRow) => <span className="truncate text-ink-2">{c.createdBy?.name ?? "People team"}</span> }] : []),
    {
      key: "closes", label: "Closes", width: "130px",
      render: (c) => <span className="tabular-nums text-ink-2">{c.status === "COMPLETED" || c.status === "CANCELLED" ? `Closed ${formatDate(c.endDate, dayPrefs, "date")}` : formatDate(c.endDate, dayPrefs, "date")}</span>,
    },
  ];

  const total = list?.pagination.total ?? 0;
  const fromN = total ? (page - 1) * PAGE + 1 : 0;
  const toN = Math.min(total, page * PAGE);
  const emptyNode = filters > 0 || status ? (
    <span className="text-row text-ink-2">No cycles match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>
  ) : (
    <span className="text-row text-ink-2">
      {view === "draft" ? "No draft cycles" : view === "completed" ? "No completed cycles yet" : view === "active" ? "No cycle is running" : "No review cycles yet"}
      {canCreate ? <> · <button type="button" className="text-brand-deep hover:underline" onClick={() => setNewOpen(true)}>Start the first cycle</button></> : null}
    </span>
  );

  return (
    <>
      <Breadcrumb items={[{ label: "Review cycles" }]} />
      <OsPageHeader
        title="Review cycles"
        askAi
        views={
          <>
            <ViewTab label="Active" active={view === "active"} onClick={() => setParams({ view: null, status: null })} />
            <ViewTab label="Draft" active={view === "draft"} onClick={() => setParams({ view: "draft", status: null })} />
            <ViewTab label="Completed" active={view === "completed"} onClick={() => setParams({ view: "completed", status: null })} />
            <ViewTab label="All" active={view === "all"} onClick={() => setParams({ view: "all", status: null })} />
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filters },
          sort: { onClick: () => setSortOpen((v) => !v), label: sort === "newest" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "newest" },
          ...(canCreate && !newOpen ? { primary: { label: "New cycle", icon: Plus, onClick: () => setNewOpen(true) } } : {}),
          menu: [
            ...OPTIONAL_COLS.map((c) => ({ label: `Show ${c.label}`, checked: cols[c.key], keepOpen: true, onClick: () => setCol(c.key, !cols[c.key]) })),
            ...(canExport ? [{ separator: true as const }, { label: "Export CSV", icon: Download, onClick: () => { window.location.href = `/api/reviews/export.csv?${listQs}`; } }] : []),
            ...(orgAdmin ? [{ separator: true as const }, { label: "Scoring and reviews", icon: Settings2, onClick: () => openSettings("/settings/scoring") }] : []),
          ],
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort cycles" selected={sort}
              sections={[{ options: SORTS }]}
              onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "newest" ? null : v }); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="cycles"
          activeCount={filters}
          onClearAll={clearFilters}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search cycles" }}
        >
          <FilterGroup label="Type">
            {CYCLE_TYPES.map((t) => <FilterRow key={t.value} label={t.label} checked={types.includes(t.value)} onCheckedChange={(on) => toggleType(t.value, on)} />)}
          </FilterGroup>
          <FilterGroup label="Period">
            <li className="flex items-center gap-2 px-2 py-1 text-sm text-ink-2">
              <input type="date" aria-label="From" value={from} onChange={(e) => setParams({ from: e.target.value || null })} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm text-ink" />
              <span>to</span>
              <input type="date" aria-label="To" value={to} onChange={(e) => setParams({ to: e.target.value || null })} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm text-ink" />
            </li>
          </FilterGroup>
          <FilterGroup label="Started by">
            <li className="px-1 py-1">
              <PeoplePickerField ariaLabel="Started by" value={by ? [by] : []} people={byPick ? [byPick] : []} placeholder="Anyone"
                onChange={(ids, picked) => { setByPick(picked[0] ?? null); setParams({ by: ids[0] ?? null }); }} />
            </li>
          </FilterGroup>
          <FilterGroup label="Covers">
            <FilterRow label="Everyone" checked={audience === "ALL"} onCheckedChange={(on) => setParams({ audience: on ? "ALL" : null })} />
            <FilterRow label="Specific people" checked={audience === "USERS"} onCheckedChange={(on) => setParams({ audience: on ? "USERS" : null })} />
            {depts.map((d) => <FilterRow key={d.id} label={d.name} checked={audience === d.id} onCheckedChange={(on) => setParams({ audience: on ? d.id : null })} />)}
          </FilterGroup>
        </FilterPanel>
        <div className="min-w-0 flex-1">
          {error && !list ? (
            <OsEmptyView variant="error" title="Couldn't load review cycles" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : (
            <TableCard
              ariaLabel="Review cycles"
              columns={columns}
              rows={list?.data ?? null}
              rowKey={(c) => c.id}
              rowHref={(c) => `/reviews/${c.id}`}
              rowMenu={(c) => (
                <RowMoreButton label={`Actions for ${c.name}`} open={menu?.row.id === c.id}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ row: c, anchor: { current: e.currentTarget } }); }} />
              )}
              empty={emptyNode}
              footer={list ? {
                total,
                noun: "cycles",
                from: fromN,
                to: toN,
                onPrev: page > 1 ? () => setParams({ page: String(page - 1) }) : undefined,
                onNext: toN < total ? () => setParams({ page: String(page + 1) }) : undefined,
              } : undefined}
            />
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Cycle actions">
            <MenuItem icon={ExternalLink} label="Open" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/reviews/${id}`); }} />
            <MenuItem icon={Link2} label="Copy link" onClick={() => { const id = menu.row.id; setMenu(null); copyLink(id); }} />
            {menu.row.canManage && menu.row.status === "DRAFT" ? (
              <><MenuSeparator /><MenuItem icon={Play} label="Launch cycle" onClick={() => { const r = menu.row; setMenu(null); void launch(r); }} /></>
            ) : null}
            {menu.row.canManage && menu.row.status === "ACTIVE" ? (
              <><MenuSeparator /><MenuItem icon={Scale} label="Start calibration" onClick={() => { const r = menu.row; setMenu(null); void startCalibration(r); }} /></>
            ) : null}
            {menu.row.status === "ACTIVE" || menu.row.status === "IN_CALIBRATION" ? (
              <MenuItem icon={Bell} label="Send a reminder" onClick={() => { const r = menu.row; setMenu(null); void remind(r); }} />
            ) : null}
            {menu.row.canManage && !viewer.isAgent && (menu.row.status === "DRAFT" || menu.row.status === "ACTIVE") ? (
              <><MenuSeparator /><MenuItem icon={Ban} label="Cancel cycle" destructive onClick={() => { const r = menu.row; setMenu(null); void cancel(r); }} /></>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}

      {newOpen ? (
        <NewReviewCycleDialog
          open
          now={now}
          orgWide={orgWide}
          onOpenChange={setNewOpen}
          onCreated={(c) => { toast(`${c.name} created as a draft`); router.push(`/reviews/${c.id}`); }}
        />
      ) : null}
    </>
  );
}
