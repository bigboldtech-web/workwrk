"use client";

/* /sops/compliance, "SOP compliance" (spec-process section 2): how my people
 * are doing on the SOPs assigned to them.
 *
 *   header   views Overview · By person · By SOP · Overdue; toolbar Filter
 *            (the search field first, then Department and Mandatory only);
 *            "…" Export CSV, Open Policy compliance. No blue button.
 *   body     Overview = StatRow (Assigned, Completed, In progress, Overdue),
 *            a "By department" TableCard with the 4px completion bar, then
 *            two half-width cards (lowest completion, overdue) with "View
 *            all" links that switch views. The other three views are one
 *            TableCard each. Every row opens somewhere: a person to their
 *            page, a SOP to its People tab, a department to By person.
 *
 *   GET /api/sop-assignments/compliance?q=&departmentId=&mandatory=1
 *
 * Denied = the in-shell 404 from layout.tsx (a Member without reports never
 * sees the sidebar row and never lands here).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Download } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { StatRow } from "@/components/ui/stat-row";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { getSopKind, SOP_KIND_LABEL } from "@/lib/sop-kind";
import { cn } from "@/lib/utils";

type View = "overview" | "people" | "sops" | "overdue";
const VIEWS: View[] = ["overview", "people", "sops", "overdue"];
const VIEW_LABEL: Record<View, string> = { overview: "Overview", people: "By person", sops: "By SOP", overdue: "Overdue" };

type Overview = { total: number; completed: number; inProgress: number; overdue: number; overallRate: number };
type DeptRow = { departmentId: string; name: string; people: number; total: number; completed: number; overdue: number; rate: number };
type PersonRow = { userId: string; name: string; department: string; total: number; completed: number; overdue: number; rate: number; avgScore: number | null };
type SopRow = { sopId: string; title: string; category: string | null; sopType: string; total: number; completed: number; overdue: number; rate: number };
type OverdueRow = { id: string; sopId: string; sopTitle: string; userId: string; userName: string; department: string; dueDate: string; mandatory: boolean; stepsCompleted: number; stepsTotal: number };
type ApiData = { overview: Overview; departmentCompliance: DeptRow[]; personScores: PersonRow[]; sopCompliance: SopRow[]; overdueList: OverdueRow[] };
type Department = { id: string; name: string };

const MS_DAY = 86_400_000;

function Completion({ rate }: { rate: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-active"><span className="block h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} /></span>
      <span className="tabular-nums text-ink-2">{rate}%</span>
    </span>
  );
}

export default function SopCompliancePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion } = useOsShell();
  const { boot } = useBoot();
  const fmt = useFormat();

  const view: View = VIEWS.includes(params.get("view") as View) ? (params.get("view") as View) : "overview";
  const q = params.get("q") ?? "";
  const departmentId = params.get("departmentId");
  const mandatory = params.get("mandatory") === "1";
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    const s = next.toString();
    router.push(s ? `/sops/compliance?${s}` : "/sops/compliance");
  }, [params, router]);
  const activeFilters = [q, departmentId, mandatory ? "m" : null].filter(Boolean).length;

  const [data, setData] = useState<ApiData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (departmentId) p.set("departmentId", departmentId);
    if (mandatory) p.set("mandatory", "1");
    return p.toString();
  }, [q, departmentId, mandatory]);
  const load = useCallback(async () => {
    const r = await apiFetch<ApiData | { data: ApiData }>(`/api/sop-assignments/compliance${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setData("data" in r.data && r.data.data ? r.data.data : (r.data as ApiData));
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("sops");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /* Filter panel */
  const [filterOpen, setFilterOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  useEffect(() => {
    if (!filterOpen || departments !== null) return;
    let live = true;
    void apiFetch<Department[] | { data?: Department[] }>("/api/departments", { cache: "no-store" }).then((r) => {
      if (!live) return;
      setDepartments(r.ok ? (Array.isArray(r.data) ? r.data : r.data?.data ?? []) : []);
    });
    return () => { live = false; };
  }, [filterOpen, departments]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !typing)) {
        e.preventDefault(); setFilterOpen(true); setTimeout(() => searchRef.current?.focus(), 50);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Export is the server route, so the file carries the same scoped and
  // filtered rows the page shows (spec-process section 2: GET
  // /api/sop-assignments/compliance/export).
  const exportHref = `/api/sop-assignments/compliance/export?view=${view === "sops" ? "sops" : view === "overdue" ? "overdue" : "people"}${qs ? `&${qs}` : ""}`;

  /* Columns */
  const deptColumns = useMemo<TableColumn<DeptRow>[]>(() => [
    { key: "name", label: "Department", title: true, width: "minmax(180px,2fr)", render: (r) => <span className="truncate">{r.name}</span> },
    { key: "people", label: "People", width: "90px", numeric: true, render: (r) => r.people },
    { key: "assigned", label: "Assigned", width: "100px", numeric: true, render: (r) => r.total },
    { key: "completed", label: "Completed", width: "110px", numeric: true, render: (r) => r.completed },
    { key: "overdue", label: "Overdue", width: "90px", numeric: true, render: (r) => <span className={r.overdue > 0 ? "text-danger-text" : ""}>{r.overdue}</span> },
    { key: "rate", label: "Completion", width: "150px", render: (r) => <Completion rate={r.rate} /> },
  ], []);
  const personColumns = useMemo<TableColumn<PersonRow>[]>(() => [
    { key: "name", label: "Person", title: true, width: "minmax(180px,2fr)", render: (r) => <span className="truncate">{r.name}</span> },
    { key: "department", label: "Department", width: "minmax(120px,1fr)", render: (r) => <span className="truncate text-ink-2">{r.department}</span> },
    { key: "assigned", label: "Assigned", width: "100px", numeric: true, render: (r) => r.total },
    { key: "completed", label: "Completed", width: "110px", numeric: true, render: (r) => r.completed },
    { key: "overdue", label: "Overdue", width: "90px", numeric: true, render: (r) => <span className={r.overdue > 0 ? "text-danger-text" : ""}>{r.overdue}</span> },
    { key: "rate", label: "Rate", width: "150px", render: (r) => <Completion rate={r.rate} /> },
    { key: "score", label: "Average score", width: "120px", numeric: true, render: (r) => (r.avgScore === null ? "" : r.avgScore) },
  ], []);
  const sopColumns = useMemo<TableColumn<SopRow>[]>(() => [
    { key: "title", label: "SOP", title: true, width: "minmax(200px,2fr)", render: (r) => <span className="truncate">{r.title}</span> },
    { key: "kind", label: "Kind", width: "120px", render: (r) => <span className="text-ink-2">{SOP_KIND_LABEL[getSopKind(r.sopType, null)]}</span> },
    { key: "assigned", label: "Assigned", width: "100px", numeric: true, render: (r) => r.total },
    { key: "completed", label: "Completed", width: "110px", numeric: true, render: (r) => r.completed },
    { key: "overdue", label: "Overdue", width: "90px", numeric: true, render: (r) => <span className={r.overdue > 0 ? "text-danger-text" : ""}>{r.overdue}</span> },
    { key: "rate", label: "Rate", width: "150px", render: (r) => <Completion rate={r.rate} /> },
  ], []);
  const overdueColumns = useMemo<TableColumn<OverdueRow>[]>(() => [
    { key: "person", label: "Person", title: true, width: "minmax(160px,1.5fr)", render: (r) => <span className="truncate">{r.userName}</span> },
    { key: "sop", label: "SOP", width: "minmax(180px,2fr)", render: (r) => <span className="truncate text-ink-2">{r.sopTitle}</span> },
    { key: "due", label: "Due", width: "110px", render: (r) => <span className="tabular-nums text-danger-text" title={fmt.title(r.dueDate)}>{fmt.date(r.dueDate, "date")}</span> },
    { key: "late", label: "Days late", width: "100px", numeric: true, render: (r) => Math.max(0, Math.floor((Date.now() - new Date(r.dueDate).getTime()) / MS_DAY)) },
    { key: "mandatory", label: "Mandatory", width: "100px", render: (r) => (r.mandatory ? "Yes" : "No") },
  ], [fmt]);

  const filteredEmpty = activeFilters > 0;
  const emptyRow = filteredEmpty
    ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, departmentId: null, mandatory: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
    : "Nothing here yet";
  const showQuietEmpty = data !== null && data.overview.total === 0 && !filteredEmpty;
  const o = data?.overview;
  const lowest = (data?.sopCompliance ?? []).filter((s) => s.total > 0).slice(0, 5);
  const overdueTop = (data?.overdueList ?? []).slice(0, 5);
  const deptName = departmentId ? departments?.find((d) => d.id === departmentId)?.name ?? "1 department" : null;

  return (
    <>
      <Breadcrumb items={[{ label: "SOPs", href: "/sops" }, { label: "SOP compliance" }]} />
      <OsPageHeader
        title="SOP compliance"
        views={VIEWS.map((v) => <ViewTab key={v} label={VIEW_LABEL[v]} active={view === v} href={v === "overview" ? "/sops/compliance" : `/sops/compliance?view=${v}`} />)}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: activeFilters },
          menu: [
            ...(!boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = exportHref; } }] : []),
            { label: "Open Policy compliance", icon: BarChart3, href: "/policies/compliance" },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="compliance" activeCount={activeFilters} onClearAll={() => setParams({ q: null, departmentId: null, mandatory: null })}>
          <li className="pb-2"><SearchField inputRef={searchRef} value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search people and SOPs" /></li>
          <FilterGroup label="Department">
            <FilterRow label="Filter by department" checked={!!departmentId} onCheckedChange={(on) => { if (!on) setParams({ departmentId: null }); else setDeptOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setDeptOpen((x) => !x)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"><span className="truncate">{deptName ?? <span className="text-ink-3">Choose a department</span>}</span></button>
                <Picker open={deptOpen} onClose={() => setDeptOpen(false)} ariaLabel="Department" searchPlaceholder="Find a department" selected={departmentId} onSelect={(v) => { setParams({ departmentId: v }); setDeptOpen(false); }} sections={[{ options: (departments ?? []).map((d) => ({ value: d.id, label: d.name })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Mandatory">
            <FilterRow label="Mandatory only" checked={mandatory} onCheckedChange={(on) => setParams({ mandatory: on ? "1" : null })} />
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {loadError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load compliance" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="docs" title="No SOPs assigned to your people yet" action={{ label: "Open SOPs", href: "/sops" }} />
          ) : view === "overview" ? (
            <>
              <StatRow
                loading={data === null}
                cards={[
                  { label: "Assigned", value: o ? fmt.count(o.total) : "", sub: o ? `${o.overallRate}% completion` : undefined },
                  { label: "Completed", value: o ? fmt.count(o.completed) : "" },
                  { label: "In progress", value: o ? fmt.count(o.inProgress) : "" },
                  { label: "Overdue", value: o ? fmt.count(o.overdue) : "", sub: o && o.overdue > 0 ? "overdue" : "nothing overdue", dot: o && o.overdue > 0 ? "danger" : undefined },
                ]}
              />
              <TableCard<DeptRow>
                ariaLabel="By department"
                columns={deptColumns}
                rows={data ? data.departmentCompliance : null}
                rowKey={(r) => r.departmentId}
                rowHref={(r) => (r.departmentId === "unassigned" ? "/sops/compliance?view=people" : `/sops/compliance?view=people&departmentId=${r.departmentId}`)}
                skeletonRows={4}
                empty={emptyRow}
              />
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">SOPs with the lowest completion</h2>
                    <button type="button" onClick={() => setParams({ view: "sops" })} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">View all</button>
                  </div>
                  <TableCard<SopRow> ariaLabel="SOPs with the lowest completion" columns={sopColumns.filter((c) => c.key !== "kind" && c.key !== "overdue")} rows={data ? lowest : null} rowKey={(r) => r.sopId} rowHref={(r) => `/sops/${r.sopId}`} skeletonRows={3} empty="No SOPs with completion data yet" />
                </section>
                <section className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">Overdue</h2>
                    <button type="button" onClick={() => setParams({ view: "overdue" })} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">View all</button>
                  </div>
                  <TableCard<OverdueRow> ariaLabel="Overdue" columns={overdueColumns.filter((c) => c.key !== "mandatory")} rows={data ? overdueTop : null} rowKey={(r) => r.id} rowHref={(r) => `/sops/${r.sopId}`} skeletonRows={3} empty="Nothing overdue" />
                </section>
              </div>
            </>
          ) : view === "people" ? (
            <TableCard<PersonRow> ariaLabel="By person" columns={personColumns} rows={data ? data.personScores : null} rowKey={(r) => r.userId} rowHref={(r) => `/people/${r.userId}`} empty={emptyRow} footer={data ? { total: data.personScores.length, noun: "people", from: data.personScores.length ? 1 : 0, to: data.personScores.length } : undefined} />
          ) : view === "sops" ? (
            <TableCard<SopRow> ariaLabel="By SOP" columns={sopColumns} rows={data ? data.sopCompliance : null} rowKey={(r) => r.sopId} rowHref={(r) => `/sops/${r.sopId}`} empty={emptyRow} footer={data ? { total: data.sopCompliance.length, noun: "SOPs", from: data.sopCompliance.length ? 1 : 0, to: data.sopCompliance.length } : undefined} />
          ) : (
            <TableCard<OverdueRow> ariaLabel="Overdue" columns={overdueColumns} rows={data ? data.overdueList : null} rowKey={(r) => r.id} rowHref={(r) => `/sops/${r.sopId}`} empty={filteredEmpty ? emptyRow : "Nothing overdue"} footer={data ? { total: data.overdueList.length, noun: "assignments", from: data.overdueList.length ? 1 : 0, to: data.overdueList.length } : undefined} />
          )}
        </div>
      </div>
    </>
  );
}

function SearchField({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef: React.MutableRefObject<HTMLInputElement | null> }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return <input ref={inputRef} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); (e.currentTarget as HTMLInputElement).blur(); } }} placeholder={placeholder} aria-label={placeholder} className={cn("h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand")} />;
}
