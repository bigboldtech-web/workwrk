"use client";

/* /policies/[id]/compliance, "Acknowledgements" (spec-process section 2):
 * who has acknowledged this policy, which version, when, and the evidence.
 *
 *   header   BackButton "{Policy title}" to the policy, title
 *            "Acknowledgements"; views All · Acknowledged · Pending · Overdue
 *            · Needs re-acknowledgement; toolbar Filter (search, Department,
 *            Version), Sort; no blue button; "…" Export CSV, Remind everyone
 *            pending
 *   body     StatRow (Acknowledged, Pending, Overdue, Needs re-ack) then a
 *            TableCard: Person · Department · Required · Status · Version ·
 *            Acknowledged at · Evidence ("View" opens the 360 Evidence
 *            panel) · row "…" (Remind, Change due date, Remove assignment).
 *            Footer totals and pagination.
 *
 *   GET /api/policies/[id]/ledger?view=&q=&department=&version=&sort=&dir=&page=
 *
 * Denied = the in-shell 404 from layout.tsx (people data).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Bell, Calendar, Download, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader, OsPageHeaderSkeleton } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker } from "@/components/ui/picker";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { StatRow } from "@/components/ui/stat-row";
import { InfoPanel, InfoRow } from "@/components/ui/info-panel";
import { DueDateDialog } from "@/components/process/due-date-dialog";
import { AssignDialog } from "@/components/process/assign-dialog";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { apiFetch } from "@/lib/api-fetch";
import { useRole } from "@/hooks/use-role";
import { useFormat } from "@/lib/format/use-date-prefs";
import { LEDGER_SORTS, LEDGER_STATUS_COLOR, LEDGER_STATUS_LABEL, LEDGER_VIEWS, LEDGER_VIEW_LABEL, parseLedgerSort, parseLedgerView, type LedgerView } from "@/lib/policy-ledger-view";
import type { LedgerRow } from "@/lib/policy-ledger";

type Payload = {
  policy: { id: string; title: string; version: number; ackVersion: number; status: string };
  rows: LedgerRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; from: number; to: number };
  summary: { total: number; acked: number; overdue: number; outOfDate: number; pending: number; rate: number };
  stats: Array<{ label: string; value: string; sub?: string; dot?: "danger" | "success" | "warning" }>;
  counts: Record<LedgerView, number>;
  departments: string[];
  versions: number[];
};

export default function PolicyLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const fmt = useFormat();
  // "Remind everyone pending" is FULL (Owner, Admin, People team: today's
  // admin tier in hooks/use-role); a manager who reaches the ledger through
  // their chain reminds per row instead.
  const { isAdmin: full } = useRole();

  const view = parseLedgerView(params.get("view"));
  const q = params.get("q") ?? "";
  const department = params.get("department");
  const version = params.get("version");
  const sort = parseLedgerSort(params.get("sort"));
  const dir: "asc" | "desc" = params.get("dir") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const base = `/policies/${id}/compliance`;
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepPage?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    if (!opts?.keepPage) next.delete("page");
    const s = next.toString();
    router.push(s ? `${base}?${s}` : base);
  }, [params, router, base]);
  const activeFilters = [q, department, version].filter(Boolean).length;

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "failed">("loading");
  const qs = useMemo(() => {
    const p = new URLSearchParams({ view, page: String(page), pageSize: "40" });
    if (q) p.set("q", q);
    if (department) p.set("department", department);
    if (version) p.set("version", version);
    if (sort) { p.set("sort", sort); p.set("dir", dir); }
    return p.toString();
  }, [view, page, q, department, version, sort, dir]);
  const load = useCallback(async () => {
    const r = await apiFetch<Payload | { data: Payload }>(`/api/policies/${id}/ledger?${qs}`, { cache: "no-store" });
    if (!r.ok) { setLoadState(r.status === 404 ? "notfound" : "failed"); return; }
    setPayload(("data" in r.data && r.data.data ? r.data.data : r.data) as Payload);
    setLoadState("ready");
  }, [id, qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [verOpen, setVerOpen] = useState(false);
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

  /* evidence panel */
  const [evidence, setEvidence] = useState<LedgerRow | null>(null);
  const evidenceBtn = useRef<HTMLButtonElement | null>(null);
  const viewBtns = useRef<Map<string, HTMLButtonElement>>(new Map());

  /* row menu and actions */
  const [menu, setMenu] = useState<{ row: LedgerRow; anchor: React.RefObject<HTMLElement | null>; point?: { x: number; y: number } } | null>(null);
  const [dueFor, setDueFor] = useState<LedgerRow | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const remind = async (row: LedgerRow) => {
    if (!row.assignmentId) { toast("This person has no assignment to remind about. Assign the policy first.", { tone: "danger" }); return; }
    const r = await apiFetch(`/api/policies/${id}/assignments/${row.assignmentId}/remind`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't send the reminder", { tone: "danger" }); return; }
    toast(`Reminded ${row.name}`);
  };
  const remindAll = async () => {
    const pending = payload?.summary ? payload.summary.pending + payload.summary.overdue + payload.summary.outOfDate : 0;
    const ok = await confirm({ title: `Send a reminder to ${pending} ${pending === 1 ? "person" : "people"}?`, description: "Everyone still pending gets one Inbox row and one email.", confirmLabel: "Send reminders" });
    if (!ok) return;
    const r = await apiFetch<{ reminded?: number; data?: { reminded?: number } }>(`/api/policies/${id}/assignments/remind`, { method: "POST" });
    if (!r.ok) { toast(r.error || "Couldn't send the reminders", { tone: "danger" }); return; }
    const n = r.data?.reminded ?? r.data?.data?.reminded ?? 0;
    toast(n ? `Reminded ${n} ${n === 1 ? "person" : "people"}` : "Nobody with an assignment is pending");
  };
  const saveDue = async (row: LedgerRow, next: string | null): Promise<boolean> => {
    if (!row.assignmentId) return false;
    const r = await apiFetch(`/api/policies/${id}/assignments/${row.assignmentId}`, { method: "PATCH", json: { dueDate: next } });
    if (!r.ok) { toast(r.error || "Couldn't change the due date", { tone: "danger" }); return false; }
    toast("Due date changed"); void load(); return true;
  };
  const remove = async (row: LedgerRow) => {
    if (!row.assignmentId) return;
    const ok = await confirm({ title: `Remove ${row.name} from this policy?`, description: "Their acknowledgement history stays.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/policies/${id}/assignments/${row.assignmentId}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't remove the assignment", { tone: "danger" }); return; }
    toast("Assignment removed"); void load();
  };

  const columns = useMemo<TableColumn<LedgerRow>[]>(() => [
    { key: "person", label: "Person", title: true, width: "minmax(180px,2fr)", render: (r) => <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={{ id: r.userId, firstName: r.name.split(" ")[0] ?? "", lastName: r.name.split(" ").slice(1).join(" "), email: r.email ?? "", avatar: r.avatar }} size={24} /><span className="truncate">{r.name}</span></span> },
    { key: "department", label: "Department", width: "minmax(120px,1fr)", render: (r) => <span className="truncate text-ink-2">{r.department}</span> },
    { key: "required", label: "Required", width: "90px", render: (r) => (r.required ? "Yes" : "No") },
    { key: "status", label: "Status", width: "150px", render: (r) => <StatusChip color={LEDGER_STATUS_COLOR[r.status]} label={LEDGER_STATUS_LABEL[r.status]} disabled /> },
    { key: "version", label: "Version", width: "80px", numeric: true, render: (r) => (r.versionAcked !== null ? `v${r.versionAcked}` : "") },
    { key: "ackedAt", label: "Acknowledged at", sortable: true, width: "150px", render: (r) => r.acknowledgedAt ? <span className="tabular-nums text-ink-2" title={fmt.title(r.acknowledgedAt)}>{fmt.date(r.acknowledgedAt, "datetime")}</span> : "" },
    { key: "due", label: "Due", sortable: true, width: "110px", render: (r) => r.dueDate ? <span className={`tabular-nums ${r.status === "overdue" ? "text-danger-text" : "text-ink-2"}`} title={fmt.title(r.dueDate)}>{fmt.date(r.dueDate, "date")}</span> : "" },
    { key: "evidence", label: "Evidence", width: "90px", render: (r) => r.acknowledgedAt ? <button ref={(el) => { if (el) viewBtns.current.set(r.userId, el); else viewBtns.current.delete(r.userId); }} type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); evidenceBtn.current = e.currentTarget; setEvidence(r); }} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">View</button> : null },
  ], [fmt]);

  if (loadState === "notfound") return <NotFoundView />;
  if (loadState === "failed") {
    return (<><OsPageHeader title="Acknowledgements" back={{ fallbackHref: `/policies/${id}`, label: "Policy" }} /><OsEmptyView variant="error" title="Couldn't load the acknowledgements" action={{ label: "Retry", onClick: () => { setLoadState("loading"); void load(); } }} /></>);
  }
  if (!payload) return <OsPageHeaderSkeleton views toolbar />;

  const clearAll = () => setParams({ q: null, department: null, version: null });
  const filteredEmpty = activeFilters > 0;
  const emptyNode = filteredEmpty
    ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={clearAll} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
    : view === "all" ? <span className="inline-flex items-center gap-2">No one has been asked to acknowledge this policy yet · <button type="button" onClick={() => setAssignOpen(true)} className="font-medium text-brand-deep hover:underline">Assign</button></span> : "Nothing here";
  const pg = payload.pagination;

  return (
    <>
      <Breadcrumb items={[{ label: "Policies", href: "/policies" }, { label: payload.policy.title, href: `/policies/${id}` }, { label: "Acknowledgements" }]} />
      <OsPageHeader
        title="Acknowledgements"
        back={{ fallbackHref: `/policies/${id}`, label: payload.policy.title }}
        views={LEDGER_VIEWS.map((v) => <ViewTab key={v} label={LEDGER_VIEW_LABEL[v]} active={view === v} onClick={() => setParams({ view: v === "all" ? null : v })} trailing={payload.counts[v] ? <span className="text-xs font-medium tabular-nums text-ink-2">{fmt.count(payload.counts[v])}</span> : undefined} />)}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: LEDGER_SORTS.find((s) => s.key === sort)?.label, active: !!sort },
          left: <span className="relative"><Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort" selected={sort} onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }} sections={[{ options: LEDGER_SORTS.map((s) => ({ value: s.key, label: s.label })) }]} width={200} /></span>,
          menu: [
            ...(!boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = `/api/policies/${id}/ledger/export`; } }] : []),
            ...(full ? [{ label: "Remind everyone pending", icon: Bell, onClick: () => void remindAll() }] : []),
          ],
        }}
      />

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="acknowledgements" activeCount={activeFilters} onClearAll={clearAll}>
          <li className="pb-2"><SearchField inputRef={searchRef} value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search people" /></li>
          <FilterGroup label="Department">
            <FilterRow label="Filter by department" checked={!!department} onCheckedChange={(on) => { if (!on) setParams({ department: null }); else setDeptOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setDeptOpen((o) => !o)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"><span className="truncate">{department ?? <span className="text-ink-3">Choose a department</span>}</span></button>
                <Picker open={deptOpen} onClose={() => setDeptOpen(false)} ariaLabel="Department" selected={department} onSelect={(v) => { setParams({ department: v }); setDeptOpen(false); }} sections={[{ options: payload.departments.map((d) => ({ value: d, label: d })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Version">
            <FilterRow label="Acknowledged version" checked={!!version} onCheckedChange={(on) => { if (!on) setParams({ version: null }); else setVerOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setVerOpen((o) => !o)} className="inline-flex h-8 items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">{version ? `v${version}` : <span className="text-ink-3">Choose a version</span>}</button>
                <Picker open={verOpen} onClose={() => setVerOpen(false)} ariaLabel="Version" selected={version} onSelect={(v) => { setParams({ version: v }); setVerOpen(false); }} sections={[{ options: payload.versions.map((v) => ({ value: String(v), label: `v${v}` })) }]} width={200} />
              </span>
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <StatRow cards={payload.stats} />
          <TableCard<LedgerRow>
            ariaLabel={LEDGER_VIEW_LABEL[view]}
            columns={columns}
            rows={payload.rows}
            rowKey={(r) => r.userId}
            rowHref={(r) => `/people/${r.userId}`}
            sort={sort ? { key: sort === "acknowledgedAt" ? "ackedAt" : sort, dir } : null}
            onSort={(key) => { const k = key === "ackedAt" ? "acknowledgedAt" : "due"; setParams(sort === k ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: k, dir: null }); }}
            onRowContextMenu={(r, e) => { if (!r.assignmentId) return; e.preventDefault(); setMenu({ row: r, anchor: { current: e.currentTarget as HTMLElement }, point: { x: e.clientX, y: e.clientY } }); }}
            rowMenu={(r) => (r.assignmentId ? <RowMenuTrigger open={menu?.row.userId === r.userId} onOpen={(ref) => setMenu({ row: r, anchor: ref })} /> : null)}
            empty={emptyNode}
            footer={{ total: pg.total, noun: "people", from: pg.from, to: pg.to, onPrev: pg.page > 1 ? () => setParams({ page: pg.page > 2 ? String(pg.page - 1) : null }, { keepPage: true }) : undefined, onNext: pg.to < pg.total ? () => setParams({ page: String(pg.page + 1) }, { keepPage: true }) : undefined }}
          />
        </div>
      </div>

      <InfoPanel open={!!evidence} onClose={() => setEvidence(null)} title="Evidence" returnFocusTo={evidenceBtn}>
        {evidence ? (
          <>
            <InfoRow label="Person">{evidence.name}{evidence.email ? <span className="block text-sm text-ink-2">{evidence.email}</span> : null}</InfoRow>
            <InfoRow label="Status">{LEDGER_STATUS_LABEL[evidence.status]}</InfoRow>
            <InfoRow label="Version">{evidence.versionAcked !== null ? `v${evidence.versionAcked}` : "Not acknowledged"}{evidence.versionAcked !== null && evidence.versionAcked < payload.policy.ackVersion ? ` (current is v${payload.policy.ackVersion})` : ""}</InfoRow>
            <InfoRow label="Acknowledged at">{evidence.acknowledgedAt ? fmt.date(evidence.acknowledgedAt, "datetime") : "Not yet"}</InfoRow>
            <InfoRow label="IP address"><span className="font-mono text-sm">{evidence.ipAddress ?? "Not recorded"}</span></InfoRow>
            <InfoRow label="User agent"><span className="text-sm text-ink-2">{evidence.userAgent ?? "Not recorded"}</span></InfoRow>
            <InfoRow label="Content hash"><span className="break-all font-mono text-xs text-ink-2">{evidence.contentHash ?? "Not recorded"}</span></InfoRow>
            <InfoRow label="Attestation">{evidence.attestation ?? "Not recorded"}</InfoRow>
          </>
        ) : null}
      </InfoPanel>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open onClose={() => setMenu(null)} placement="below" point={menu.point ?? null}>
          <MenuList onClick={() => setMenu(null)}>
            {menu.row.status !== "acked" && menu.row.assignmentId ? <MenuItem icon={Bell} label="Remind" onClick={() => void remind(menu.row)} /> : null}
            {menu.row.assignmentId ? <MenuItem icon={Calendar} label="Change due date" onClick={() => setDueFor(menu.row)} /> : null}
            {menu.row.assignmentId ? <><MenuSeparator /><MenuItem icon={Trash2} label="Remove assignment" destructive onClick={() => void remove(menu.row)} /></> : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {dueFor ? <DueDateDialog open value={dueFor.dueDate} description={`${dueFor.name} · ${payload.policy.title}`} onClose={() => setDueFor(null)} onSave={(next) => saveDue(dueFor, next)} /> : null}
      <AssignDialog open={assignOpen} onClose={() => setAssignOpen(false)} object={{ type: "policy", id, title: payload.policy.title }} onAssigned={() => void load()} />
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

function RowMenuTrigger({ onOpen, open }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Row actions" />;
}
