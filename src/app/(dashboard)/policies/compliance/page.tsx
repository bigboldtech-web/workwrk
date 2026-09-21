"use client";

/* /policies/compliance, "Policy compliance" (spec-process section 2): across
 * every policy, who is behind and which policies are at risk, for my people.
 *
 *   header   views Overview · By person · By policy · Open gaps; toolbar
 *            Filter (search, Department, Policy, Period); "…" Export CSV,
 *            Open SOP compliance. No blue button.
 *   body     Overview = StatRow (Required, Acknowledged, Pending, Overdue), a
 *            "By department" TableCard with the 4px progress column, then two
 *            half-width cards ("Policies at risk", "Open gaps") with "View
 *            all" links. The other views are one TableCard each. Every row
 *            opens somewhere: a policy to its Acknowledgements page, a
 *            person to their page, a department to By person.
 *
 *   GET /api/policies/compliance?q=&departmentId=&policyId=&period=
 *
 * Denied = the in-shell 404 from layout.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, ShieldCheck } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useBoot } from "@/components/layout/os/boot-context";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { StatRow } from "@/components/ui/stat-row";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format/use-date-prefs";
import { PERIODS, POLICY_COMPLIANCE_VIEWS, POLICY_COMPLIANCE_VIEW_LABEL, gapStatusWord, parsePeriod, parsePolicyComplianceView, policyComplianceStats } from "@/lib/policy-compliance-view";
import type { DeptRow, GapRow, PersonRow, PolicyComplianceData, PolicyRow } from "@/lib/policy-compliance";

function Completion({ rate }: { rate: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-active"><span className="block h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} /></span>
      <span className="tabular-nums text-ink-2">{rate}%</span>
    </span>
  );
}

export default function PolicyCompliancePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { boot } = useBoot();
  const fmt = useFormat();

  const view = parsePolicyComplianceView(params.get("view"));
  const q = params.get("q") ?? "";
  const departmentId = params.get("departmentId");
  const policyId = params.get("policyId");
  const period = parsePeriod(params.get("period"));
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    const s = next.toString();
    router.push(s ? `/policies/compliance?${s}` : "/policies/compliance");
  }, [params, router]);
  const activeFilters = [q, departmentId, policyId, period !== "all" ? "p" : null].filter(Boolean).length;

  const [data, setData] = useState<PolicyComplianceData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (departmentId) p.set("departmentId", departmentId);
    if (policyId) p.set("policyId", policyId);
    if (period !== "all") p.set("period", period);
    return p.toString();
  }, [q, departmentId, policyId, period]);
  const load = useCallback(async () => {
    const r = await apiFetch<PolicyComplianceData | { data: PolicyComplianceData }>(`/api/policies/compliance${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setData(("data" in r.data && r.data.data ? r.data.data : r.data) as PolicyComplianceData);
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [polOpen, setPolOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
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

  const deptColumns = useMemo<TableColumn<DeptRow>[]>(() => [
    { key: "name", label: "Department", title: true, width: "minmax(180px,2fr)", render: (r) => <span className="truncate">{r.name}</span> },
    { key: "people", label: "People", width: "90px", numeric: true, render: (r) => r.people },
    { key: "required", label: "Required", width: "100px", numeric: true, render: (r) => r.total },
    { key: "acked", label: "Acknowledged", width: "120px", numeric: true, render: (r) => r.acked },
    { key: "overdue", label: "Overdue", width: "90px", numeric: true, render: (r) => <span className={r.overdue > 0 ? "text-danger-text" : ""}>{r.overdue}</span> },
    { key: "rate", label: "Completion", width: "150px", render: (r) => <Completion rate={r.rate} /> },
  ], []);
  const personColumns = useMemo<TableColumn<PersonRow>[]>(() => [
    { key: "name", label: "Person", title: true, width: "minmax(180px,2fr)", render: (r) => <span className="truncate">{r.name}</span> },
    { key: "department", label: "Department", width: "minmax(120px,1fr)", render: (r) => <span className="truncate text-ink-2">{r.department}</span> },
    { key: "required", label: "Required", width: "100px", numeric: true, render: (r) => r.required },
    { key: "acked", label: "Acknowledged", width: "120px", numeric: true, render: (r) => r.acked },
    { key: "pending", label: "Pending", width: "90px", numeric: true, render: (r) => r.pending },
    { key: "overdue", label: "Overdue", width: "90px", numeric: true, render: (r) => <span className={r.overdue > 0 ? "text-danger-text" : ""}>{r.overdue}</span> },
    { key: "rate", label: "Rate", width: "150px", render: (r) => <Completion rate={r.rate} /> },
  ], []);
  const policyColumns = useMemo<TableColumn<PolicyRow>[]>(() => [
    { key: "title", label: "Policy", title: true, width: "minmax(200px,2fr)", render: (r) => <span className="truncate">{r.title}</span> },
    { key: "category", label: "Category", width: "minmax(100px,1fr)", render: (r) => <span className="truncate text-ink-2">{r.category ?? ""}</span> },
    { key: "required", label: "Required", width: "100px", numeric: true, render: (r) => r.total },
    { key: "acked", label: "Acknowledged", width: "120px", numeric: true, render: (r) => r.acked },
    { key: "overdue", label: "Overdue", width: "90px", numeric: true, render: (r) => <span className={r.overdue > 0 ? "text-danger-text" : ""}>{r.overdue}</span> },
    { key: "rate", label: "Rate", width: "150px", render: (r) => <Completion rate={r.rate} /> },
  ], []);
  const gapColumns = useMemo<TableColumn<GapRow>[]>(() => [
    { key: "person", label: "Person", title: true, width: "minmax(160px,1.5fr)", render: (r) => <span className="truncate">{r.userName}</span> },
    { key: "policy", label: "Policy", width: "minmax(180px,2fr)", render: (r) => <span className="truncate text-ink-2">{r.policyTitle}</span> },
    { key: "due", label: "Due", width: "110px", render: (r) => r.dueDate ? <span className={`tabular-nums ${r.status === "overdue" ? "text-danger-text" : "text-ink-2"}`} title={fmt.title(r.dueDate)}>{fmt.date(r.dueDate, "date")}</span> : <span className="text-ink-3">None</span> },
    { key: "late", label: "Days late", width: "120px", render: (r) => <span className={r.status === "overdue" ? "text-danger-text" : "text-ink-2"}>{gapStatusWord(r.status, r.daysOverdue)}</span> },
  ], [fmt]);

  // The two half-width preview cards on Overview get their own narrower
  // column sets. The full-width sets need ~570px of track and each preview
  // card is ~520 at the 1440 design width, so the full sets made the default
  // view scroll sideways inside both cards. Nothing is dropped: Required and
  // Acknowledged become one "3 / 20" cell, and the widths simply shrink.
  const atRiskColumns = useMemo<TableColumn<PolicyRow>[]>(() => [
    { key: "title", label: "Policy", title: true, width: "minmax(150px,2fr)", render: (r) => <span className="truncate">{r.title}</span> },
    { key: "acked", label: "Acknowledged", width: "120px", numeric: true, render: (r) => <span className="tabular-nums">{r.acked} / {r.total}</span> },
    { key: "rate", label: "Rate", width: "130px", render: (r) => <Completion rate={r.rate} /> },
  ], []);
  const gapsPreviewColumns = useMemo<TableColumn<GapRow>[]>(() => [
    { key: "person", label: "Person", title: true, width: "minmax(130px,1.5fr)", render: (r) => <span className="truncate">{r.userName}</span> },
    { key: "policy", label: "Policy", width: "minmax(130px,2fr)", render: (r) => <span className="truncate text-ink-2">{r.policyTitle}</span> },
    { key: "late", label: "Days late", width: "150px", render: (r) => <span className={cn("truncate", r.status === "overdue" ? "text-danger-text" : "text-ink-2")}>{gapStatusWord(r.status, r.daysOverdue)}</span> },
  ], []);

  const clearAll = () => setParams({ q: null, departmentId: null, policyId: null, period: null });
  const filteredEmpty = activeFilters > 0;
  const emptyRow = filteredEmpty
    ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={clearAll} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
    : "Nothing here yet";
  const showQuietEmpty = data !== null && data.overview.totalRequired === 0 && !filteredEmpty;
  const atRisk = (data?.policyCompliance ?? []).filter((p) => p.total > 0).slice(0, 5);
  const gapsTop = (data?.pendingList ?? []).slice(0, 5);
  const deptName = departmentId ? data?.departments.find((d) => d.id === departmentId)?.name ?? "1 department" : null;
  const policyName = policyId ? data?.policies.find((p) => p.id === policyId)?.title ?? "1 policy" : null;
  const exportHref = `/api/policies/compliance/export?view=${view === "people" ? "people" : view === "policies" ? "policies" : "gaps"}${qs ? `&${qs}` : ""}`;

  return (
    <>
      <Breadcrumb items={[{ label: "Policies", href: "/policies" }, { label: "Policy compliance" }]} />
      <OsPageHeader
        title="Policy compliance"
        views={POLICY_COMPLIANCE_VIEWS.map((v) => <ViewTab key={v} label={POLICY_COMPLIANCE_VIEW_LABEL[v]} active={view === v} onClick={() => setParams({ view: v === "overview" ? null : v })} />)}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: activeFilters },
          menu: [
            ...(!boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = exportHref; } }] : []),
            { label: "Open SOP compliance", icon: ShieldCheck, href: "/sops/compliance" },
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="compliance" activeCount={activeFilters} onClearAll={clearAll}>
          <li className="pb-2"><SearchField inputRef={searchRef} value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search people and policies" /></li>
          <FilterGroup label="Department">
            <FilterRow label="Filter by department" checked={!!departmentId} onCheckedChange={(on) => { if (!on) setParams({ departmentId: null }); else setDeptOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setDeptOpen((x) => !x)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"><span className="truncate">{deptName ?? <span className="text-ink-3">Choose a department</span>}</span></button>
                <Picker open={deptOpen} onClose={() => setDeptOpen(false)} ariaLabel="Department" searchPlaceholder="Find a department" selected={departmentId} onSelect={(v) => { setParams({ departmentId: v }); setDeptOpen(false); }} sections={[{ options: (data?.departments ?? []).map((d) => ({ value: d.id, label: d.name })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Policy">
            <FilterRow label="Filter by policy" checked={!!policyId} onCheckedChange={(on) => { if (!on) setParams({ policyId: null }); else setPolOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setPolOpen((x) => !x)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"><span className="truncate">{policyName ?? <span className="text-ink-3">Choose a policy</span>}</span></button>
                <Picker open={polOpen} onClose={() => setPolOpen(false)} ariaLabel="Policy" searchPlaceholder="Find a policy" selected={policyId} onSelect={(v) => { setParams({ policyId: v }); setPolOpen(false); }} sections={[{ options: (data?.policies ?? []).map((p) => ({ value: p.id, label: p.title })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Period">
            <FilterRow label="Acknowledged within" checked={period !== "all"} onCheckedChange={(on) => { if (!on) setParams({ period: null }); else setPeriodOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setPeriodOpen((x) => !x)} className="inline-flex h-8 items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">{PERIODS.find((p) => p.key === period)?.label}</button>
                <Picker open={periodOpen} onClose={() => setPeriodOpen(false)} ariaLabel="Period" selected={period} onSelect={(v) => { setParams({ period: v === "all" ? null : v }); setPeriodOpen(false); }} sections={[{ options: PERIODS.map((p) => ({ value: p.key, label: p.label })) }]} width={200} />
              </span>
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {loadError ? (
            <OsEmptyView variant="error" context="docs" title="Couldn't load compliance" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView context="docs" title="No policies assigned to your people yet" action={{ label: "Open policies", href: "/policies" }} />
          ) : view === "overview" ? (
            <>
              <StatRow loading={data === null} cards={data ? policyComplianceStats(data.overview) : [{ label: "Required", value: "" }, { label: "Acknowledged", value: "" }, { label: "Pending", value: "" }, { label: "Overdue", value: "" }]} />
              <TableCard<DeptRow> ariaLabel="By department" columns={deptColumns} rows={data ? data.departmentCompliance : null} rowKey={(r) => r.departmentId} rowHref={(r) => (r.departmentId === "unassigned" ? "/policies/compliance?view=people" : `/policies/compliance?view=people&departmentId=${r.departmentId}`)} skeletonRows={4} empty={emptyRow} />
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">Policies at risk</h2>
                    <button type="button" onClick={() => setParams({ view: "policies" })} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">View all</button>
                  </div>
                  <TableCard<PolicyRow> ariaLabel="Policies at risk" columns={atRiskColumns} rows={data ? atRisk : null} rowKey={(r) => r.policyId} rowHref={(r) => `/policies/${r.policyId}/compliance`} skeletonRows={3} empty="No policies requiring acknowledgement yet" />
                </section>
                <section className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">Open gaps</h2>
                    <button type="button" onClick={() => setParams({ view: "gaps" })} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">View all</button>
                  </div>
                  <TableCard<GapRow> ariaLabel="Open gaps" columns={gapsPreviewColumns} rows={data ? gapsTop : null} rowKey={(r) => `${r.policyId}:${r.userId}`} rowHref={(r) => `/policies/${r.policyId}/compliance?view=pending&q=${encodeURIComponent(r.userName)}`} skeletonRows={3} empty="Everyone has acknowledged the current version of every policy" />
                </section>
              </div>
            </>
          ) : view === "people" ? (
            <TableCard<PersonRow> ariaLabel="By person" columns={personColumns} rows={data ? data.personCompliance : null} rowKey={(r) => r.userId} rowHref={(r) => `/people/${r.userId}`} empty={emptyRow} footer={data ? { total: data.personCompliance.length, noun: "people", from: data.personCompliance.length ? 1 : 0, to: data.personCompliance.length } : undefined} />
          ) : view === "policies" ? (
            <TableCard<PolicyRow> ariaLabel="By policy" columns={policyColumns} rows={data ? data.policyCompliance : null} rowKey={(r) => r.policyId} rowHref={(r) => `/policies/${r.policyId}/compliance`} empty={emptyRow} footer={data ? { total: data.policyCompliance.length, noun: "policies", from: data.policyCompliance.length ? 1 : 0, to: data.policyCompliance.length } : undefined} />
          ) : (
            <TableCard<GapRow> ariaLabel="Open gaps" columns={gapColumns} rows={data ? data.pendingList : null} rowKey={(r) => `${r.policyId}:${r.userId}`} rowHref={(r) => `/policies/${r.policyId}/compliance?view=pending&q=${encodeURIComponent(r.userName)}`} empty={filteredEmpty ? emptyRow : "Everyone has acknowledged the current version of every policy"} footer={data ? { total: data.pendingList.length, noun: "gaps", from: data.pendingList.length ? 1 : 0, to: data.pendingList.length } : undefined} />
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
  return <input ref={inputRef} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); (e.currentTarget as HTMLInputElement).blur(); } }} placeholder={placeholder} aria-label={placeholder} className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />;
}
