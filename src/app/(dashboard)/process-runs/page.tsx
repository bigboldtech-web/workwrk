"use client";

/* /process-runs, "Run history" (spec-process section 2): every run of a
 * Checklist SOP.
 *
 *   header   views My runs · Team runs (hasReports) · All runs (People team,
 *            Owner, Admin); a pasted view the viewer cannot hold renders My
 *            runs with the parameter stripped and one notice line (never a
 *            404); toolbar Filter (search, Status, SOP, Assignee, Due,
 *            Started), Sort; the one blue "Start run"; "…" Export CSV
 *   body     one summary line "4 active · 1 overdue · 27 completed";
 *            TableCard: Run · SOP · Assignee · Progress · Due · Status ·
 *            Started · row "…" (Open run, Copy run link, Reassign, Change due
 *            date, Cancel run, Delete). Row click opens the Run drawer whose
 *            URL is ?run=<id> (no expand: a run has no full page yet).
 *
 *   GET /api/process-runs?scope=mine|team|all&status=&sopId=&assigneeId=&q=&sort=&page=
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Download, ExternalLink, Link2, Play, Trash2, UserPlus, XCircle } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { DueDateDialog } from "@/components/process/due-date-dialog";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { StartRunDialog } from "@/components/sops/start-run-dialog";
import { RunDrawer } from "@/components/process/run-drawer";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL, RUNS_SORTS, RUNS_VIEW_LABEL, allowedRunsViews, parseRunsSort, resolveRunsView, runsSummaryLine, type RunStatus, type RunsView } from "@/lib/process-runs";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  title: string;
  status: RunStatus;
  progress: number;
  steps: { done: number; total: number; sections: number };
  dueDate: string | null;
  startedAt: string;
  completedAt: string | null;
  assigneeId: string | null;
  assignee: PersonRef | null;
  sopId: string;
  shareToken: string | null;
  sop: { id: string; title: string };
};
type Payload = { data: Row[]; scope: RunsView; allowedScopes: RunsView[]; counts: Record<RunStatus, number>; pagination: { total: number; totalPages: number } };

function personName(p: PersonRef | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "";
}

export default function ProcessRunsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { rowVersion, bumpRowVersion } = useOsShell();
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();

  const { hasReports, peopleTeam, orgRole } = boot.viewer;
  const viewer = useMemo(() => ({ hasReports, peopleTeam, orgRole }), [hasReports, peopleTeam, orgRole]);
  const allowed = useMemo(() => allowedRunsViews(viewer), [viewer]);
  const requestedView = params.get("view");
  const resolved = useMemo(() => resolveRunsView(requestedView, viewer), [requestedView, viewer]);
  const view = resolved.view;
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!resolved.strip) return;
    const t = setTimeout(() => {
      if (resolved.notice) setNotice(resolved.notice);
      const next = new URLSearchParams(params.toString());
      next.delete("view");
      const s = next.toString();
      router.replace(s ? `/process-runs?${s}` : "/process-runs");
    }, 0);
    return () => clearTimeout(t);
  }, [resolved.strip, resolved.notice, params, router]);

  const q = params.get("q") ?? "";
  const status = params.get("status");
  const sopId = params.get("sopId");
  const assigneeId = params.get("assigneeId");
  const dueFrom = params.get("dueFrom"); const dueTo = params.get("dueTo");
  const startedFrom = params.get("startedFrom"); const startedTo = params.get("startedTo");
  const sort = parseRunsSort(params.get("sort"));
  const dir: "asc" | "desc" = params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : sort === "started" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const runId = params.get("run");
  const setParams = useCallback((patch: Record<string, string | null>, opts?: { keepPage?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    if (!opts?.keepPage) next.delete("page");
    const s = next.toString();
    router.push(s ? `/process-runs?${s}` : "/process-runs");
  }, [params, router]);
  const activeFilters = [q, status, sopId, assigneeId, dueFrom || dueTo ? "d" : null, startedFrom || startedTo ? "s" : null].filter(Boolean).length;

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ scope: view, sort, dir, page: String(page), pageSize: "40" });
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (sopId) p.set("sopId", sopId);
    if (assigneeId) p.set("assigneeId", assigneeId);
    if (dueFrom) p.set("dueFrom", dueFrom); if (dueTo) p.set("dueTo", dueTo);
    if (startedFrom) p.set("startedFrom", startedFrom); if (startedTo) p.set("startedTo", startedTo);
    return p.toString();
  }, [view, sort, dir, page, q, status, sopId, assigneeId, dueFrom, dueTo, startedFrom, startedTo]);
  const load = useCallback(async () => {
    const r = await apiFetch<Payload>(`/api/process-runs?${qs}`, { cache: "no-store" });
    if (!r.ok) { setLoadError(true); return; }
    setLoadError(false);
    setPayload(r.data);
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const rv = rowVersion("process-runs");
  useEffect(() => { if (rv <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [rv, load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sopOpen, setSopOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [sops, setSops] = useState<Array<{ id: string; title: string }> | null>(null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  useEffect(() => {
    if (!filterOpen || sops !== null) return;
    let live = true;
    void (async () => {
      const [s, p] = await Promise.all([
        apiFetch<{ data: Array<{ id: string; title: string }> }>("/api/sops?kind=checklist&pageSize=100", { cache: "no-store" }),
        apiFetch<{ data?: PersonRef[] } | PersonRef[]>("/api/users?scope=all&limit=200", { cache: "no-store" }),
      ]);
      if (!live) return;
      setSops(s.ok ? s.data.data : []);
      setPeople(p.ok ? (Array.isArray(p.data) ? p.data : p.data?.data ?? []) : []);
    })();
    return () => { live = false; };
  }, [filterOpen, sops]);
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

  const [startOpen, setStartOpen] = useState(false);
  const [menu, setMenu] = useState<{ row: Row; anchor: React.RefObject<HTMLElement | null>; point?: { x: number; y: number } } | null>(null);
  const [reassignFor, setReassignFor] = useState<{ row: Row; point: { top: number; left: number } | null } | null>(null);
  const [dueFor, setDueFor] = useState<Row | null>(null);
  const isAdmin = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
  /** Where a picker opened from the row menu pins: under the "…", or at the right-click point. */
  const pointFromMenu = (m: typeof menu): { top: number; left: number } | null => {
    if (!m) return null;
    if (m.point) return { top: m.point.y + 4, left: m.point.x };
    const rect = m.anchor.current?.getBoundingClientRect();
    return rect ? { top: rect.bottom + 4, left: Math.max(8, rect.right - 300) } : null;
  };

  const openRun = (r: Row) => setParams({ run: r.id }, { keepPage: true });
  const copyRunLink = (r: Row) => { void navigator.clipboard.writeText(`${window.location.origin}/process-runs?run=${r.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" })); };
  const cancelRun = async (r: Row) => {
    const ok = await confirm({ title: `Cancel "${r.title}"?`, description: "The run link stops working. The steps done so far are kept in the history.", confirmLabel: "Cancel run", destructive: true });
    if (!ok) return;
    const res = await apiFetch(`/api/process-runs/${r.id}`, { method: "PATCH", json: { action: "cancel" } });
    if (!res.ok) { toast(res.error || "Couldn't cancel the run", { tone: "danger" }); return; }
    toast("Run cancelled");
    bumpRowVersion("process-runs");
    void load();
  };
  const saveDue = async (r: Row, next: string | null): Promise<boolean> => {
    const res = await apiFetch(`/api/process-runs/${r.id}`, { method: "PATCH", json: { action: "due", dueDate: next } });
    if (!res.ok) { toast(res.error || "Couldn't change the due date", { tone: "danger" }); return false; }
    toast("Due date changed");
    void load();
    return true;
  };
  const reassign = async (r: Row, next: string | null) => {
    setReassignFor(null);
    const res = await apiFetch(`/api/process-runs/${r.id}`, { method: "PATCH", json: { action: "reassign", assigneeId: next } });
    if (!res.ok) { toast(res.error || "Couldn't reassign", { tone: "danger" }); return; }
    toast("Reassigned");
    void load();
  };
  const deleteRun = async (r: Row) => {
    const ok = await confirm({ title: `Delete "${r.title}"?`, description: "This removes the run and its history for good.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const res = await apiFetch(`/api/process-runs/${r.id}`, { method: "DELETE" });
    if (!res.ok) { toast(res.error || "Couldn't delete the run", { tone: "danger" }); return; }
    toast("Run deleted");
    if (runId === r.id) setParams({ run: null }, { keepPage: true });
    void load();
  };
  const exportCsv = () => {
    const header = ["Run", "SOP", "Assignee", "Progress", "Due", "Status", "Started", "Completed"];
    const lines = (payload?.data ?? []).map((r) => [r.title, r.sop.title, personName(r.assignee) || "Anyone with the link", `${r.steps.done} of ${r.steps.total}`, r.dueDate ?? "", RUN_STATUS_LABEL[r.status], r.startedAt, r.completedAt ?? ""]);
    const csv = [header, ...lines].map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "runs.csv"; a.click(); URL.revokeObjectURL(url);
  };
  useEffect(() => {
    if (!reassignFor || people.length) return;
    void apiFetch<{ data?: PersonRef[] } | PersonRef[]>("/api/users?scope=all&limit=200", { cache: "no-store" }).then((p) => setPeople(p.ok ? (Array.isArray(p.data) ? p.data : p.data?.data ?? []) : []));
  }, [reassignFor, people.length]);

  const rows = payload?.data ?? null;
  const total = payload?.pagination.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * 40 + 1;
  const to = Math.min(total, (page - 1) * 40 + (rows?.length ?? 0));

  const columns = useMemo<TableColumn<Row>[]>(() => [
    { key: "run", label: "Run", title: true, width: "minmax(220px,2fr)", render: (r) => <span className="truncate">{r.title}</span> },
    { key: "sop", label: "SOP", width: "minmax(160px,1.5fr)", render: (r) => <Link href={`/sops/${r.sop.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-ink hover:underline">{r.sop.title}</Link> },
    { key: "assignee", label: "Assignee", width: "minmax(150px,1fr)", render: (r) => r.assignee ? <span className="inline-flex min-w-0 items-center gap-2"><PersonAvatar person={r.assignee} size={24} /><span className="truncate">{personName(r.assignee)}</span></span> : <span className="text-ink-3">Anyone with the link</span> },
    {
      key: "progress", label: "Progress", width: "150px",
      render: (r) => r.steps.total === 0 ? <span className="text-ink-3">No steps</span> : r.steps.sections <= 4 && r.steps.total <= 4
        ? <Dots variant="quad-steps" done={r.steps.done} total={r.steps.total} label={`${r.steps.done} of ${r.steps.total} steps`} />
        : <span className="inline-flex min-w-0 items-center gap-2"><span className="tabular-nums text-ink-2">{r.steps.done} of {r.steps.total}</span><span className="h-1 w-12 overflow-hidden rounded-full bg-active"><span className="block h-full bg-brand" style={{ width: `${r.progress}%` }} /></span></span>,
    },
    { key: "due", label: "Due", width: "110px", render: (r) => r.dueDate ? <span className={cn("tabular-nums", r.status === "OVERDUE" ? "text-danger-text" : "text-ink-2")} title={fmt.title(r.dueDate)}>{fmt.date(r.dueDate, "date")}</span> : <span className="text-ink-3">None</span> },
    { key: "status", label: "Status", width: "120px", render: (r) => <StatusChip color={RUN_STATUS_COLOR[r.status]} label={RUN_STATUS_LABEL[r.status]} disabled /> },
    { key: "started", label: "Started", sortable: true, width: "110px", render: (r) => <span className="tabular-nums text-ink-2" title={fmt.title(r.startedAt)}>{fmt.date(r.startedAt)}</span> },
  ], [fmt]);

  const filteredEmpty = activeFilters > 0;
  const emptyNode = filteredEmpty
    ? <span className="inline-flex items-center gap-2">No results · <button type="button" onClick={() => setParams({ q: null, status: null, sopId: null, assigneeId: null, dueFrom: null, dueTo: null, startedFrom: null, startedTo: null })} className="font-medium text-brand-deep hover:underline">Clear filters</button></span>
    : null;
  const showQuietEmpty = rows !== null && rows.length === 0 && !filteredEmpty;

  const peopleOptions: PickerOption[] = [{ value: "__anyone__", label: "Anyone with the link" }, ...people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> }))];

  return (
    <>
      <Breadcrumb items={[{ label: "SOPs", href: "/sops" }, { label: "Run history" }]} />
      <OsPageHeader
        title="Run history"
        views={allowed.length > 1 ? allowed.map((v) => (
          <ViewTab key={v} label={RUNS_VIEW_LABEL[v]} active={view === v} onClick={() => { setNotice(null); setParams({ view: v === "mine" ? null : v }); }} trailing={payload && payload.scope === v ? <span className="text-xs font-medium tabular-nums text-ink-2">{fmt.count(payload.pagination.total)}</span> : undefined} />
        )) : undefined}
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((o) => !o), count: activeFilters },
          sort: { onClick: () => setSortOpen((o) => !o), label: RUNS_SORTS.find((s) => s.key === sort)?.label, active: true },
          left: (
            <span className="relative">
              <Picker open={sortOpen} onClose={() => setSortOpen(false)} ariaLabel="Sort runs" selected={sort} onSelect={(v) => { setSortOpen(false); setParams(v === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: v, dir: null }); }}
                sections={[{ options: RUNS_SORTS.map((s) => ({ value: s.key, label: s.label })) }]} width={200} />
            </span>
          ),
          primary: { label: "Start run", icon: Play, onClick: () => setStartOpen(true) },
          menu: [...(!boot.viewer.isAgent ? [{ label: "Export CSV", icon: Download, onClick: exportCsv }] : [])],
        }}
      />
      {notice ? <p className="os-chrome px-6 pt-1 text-sm text-ink-2">{notice}</p> : null}

      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="runs" activeCount={activeFilters} onClearAll={() => setParams({ q: null, status: null, sopId: null, assigneeId: null, dueFrom: null, dueTo: null, startedFrom: null, startedTo: null })}>
          <li className="pb-2"><SearchField inputRef={searchRef} value={q} onChange={(v) => setParams({ q: v || null })} placeholder="Search runs" /></li>
          <FilterGroup label="Status">
            {(["ACTIVE", "OVERDUE", "COMPLETED", "CANCELLED"] as RunStatus[]).map((s) => <FilterRow key={s} label={RUN_STATUS_LABEL[s]} checked={status === s} onCheckedChange={(on) => setParams({ status: on ? s : null })} />)}
          </FilterGroup>
          <FilterGroup label="SOP">
            <FilterRow label="Filter by SOP" checked={!!sopId} onCheckedChange={(on) => { if (!on) setParams({ sopId: null }); else setSopOpen(true); }}>
              <span className="relative block">
                <button type="button" onClick={() => setSopOpen((o) => !o)} className="inline-flex h-8 max-w-full items-center rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"><span className="truncate">{sopId ? sops?.find((s) => s.id === sopId)?.title ?? "1 SOP" : "Choose a checklist"}</span></button>
                <Picker open={sopOpen} onClose={() => setSopOpen(false)} ariaLabel="SOP" searchPlaceholder="Find a checklist" selected={sopId} onSelect={(v) => { setParams({ sopId: v }); setSopOpen(false); }} sections={[{ options: (sops ?? []).map((s) => ({ value: s.id, label: s.title })) }]} />
              </span>
            </FilterRow>
          </FilterGroup>
          {view !== "mine" ? (
            <FilterGroup label="Assignee">
              <FilterRow label="Filter by assignee" checked={!!assigneeId} onCheckedChange={(on) => { if (!on) setParams({ assigneeId: null }); else setAssigneeOpen(true); }}>
                <span className="relative block">
                  <button type="button" onClick={() => setAssigneeOpen((o) => !o)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">{assigneeId ? personName(people.find((p) => p.id === assigneeId)) || "1 person" : <span className="text-ink-3">Choose a person</span>}</button>
                  <Picker open={assigneeOpen} onClose={() => setAssigneeOpen(false)} ariaLabel="Assignee" searchPlaceholder="Find a person" selected={assigneeId} onSelect={(v) => { setParams({ assigneeId: v }); setAssigneeOpen(false); }} sections={[{ options: people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> })) }]} />
                </span>
              </FilterRow>
            </FilterGroup>
          ) : null}
          <FilterGroup label="Due">
            <FilterRow label="Date range" checked={!!(dueFrom || dueTo)} onCheckedChange={(on) => { if (!on) setParams({ dueFrom: null, dueTo: null }); else setParams({ dueTo: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }); }}>
              <DateRange from={dueFrom} to={dueTo} onFrom={(v) => setParams({ dueFrom: v })} onTo={(v) => setParams({ dueTo: v })} />
            </FilterRow>
          </FilterGroup>
          <FilterGroup label="Started">
            <FilterRow label="Date range" checked={!!(startedFrom || startedTo)} onCheckedChange={(on) => { if (!on) setParams({ startedFrom: null, startedTo: null }); else setParams({ startedFrom: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) }); }}>
              <DateRange from={startedFrom} to={startedTo} onFrom={(v) => setParams({ startedFrom: v })} onTo={(v) => setParams({ startedTo: v ? `${v}T23:59:59` : null })} />
            </FilterRow>
          </FilterGroup>
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm text-ink-2">{payload ? runsSummaryLine(payload.counts) : " "}</p>
          {loadError ? (
            <OsEmptyView variant="error" title="Couldn't load runs" action={{ label: "Retry", onClick: () => void load() }} />
          ) : showQuietEmpty ? (
            <OsEmptyView title="No runs yet. Start one from any checklist SOP." action={{ label: "Browse checklists", href: "/sops?kind=checklist" }} />
          ) : (
            <TableCard<Row>
              ariaLabel={RUNS_VIEW_LABEL[view]}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => openRun(r)}
              highlightKey={runId}
              sort={{ key: sort === "started" ? "started" : sort, dir }}
              onSort={(key) => { if (key === "started") setParams(sort === "started" ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: null, dir: null }); }}
              onRowContextMenu={(r, e) => { e.preventDefault(); setMenu({ row: r, anchor: { current: e.currentTarget as HTMLElement }, point: { x: e.clientX, y: e.clientY } }); }}
              rowMenu={(r) => <RowMenuTrigger open={menu?.row.id === r.id} onOpen={(ref) => setMenu({ row: r, anchor: ref })} />}
              empty={emptyNode}
              footer={{ total, noun: "runs", from, to, onPrev: page > 1 ? () => setParams({ page: page > 2 ? String(page - 1) : null }, { keepPage: true }) : undefined, onNext: to < total ? () => setParams({ page: String(page + 1) }, { keepPage: true }) : undefined }}
            />
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open onClose={() => setMenu(null)} placement="below" point={menu.point ?? null}>
          <MenuList onClick={() => setMenu(null)}>
            {menu.row.shareToken && menu.row.status !== "CANCELLED" ? <MenuItem icon={ExternalLink} label="Open run" onClick={() => window.open(`/run/${menu.row.shareToken}`, "_blank", "noopener")} /> : null}
            <MenuItem icon={Link2} label="Copy run link" onClick={() => copyRunLink(menu.row)} />
            {(boot.viewer.hasReports || isAdmin || boot.viewer.peopleTeam) && menu.row.status !== "COMPLETED" && menu.row.status !== "CANCELLED" ? <MenuItem icon={UserPlus} label="Reassign…" onClick={() => setReassignFor({ row: menu.row, point: pointFromMenu(menu) })} /> : null}
            {menu.row.status !== "COMPLETED" && menu.row.status !== "CANCELLED" ? <MenuItem icon={Calendar} label="Change due date" onClick={() => setDueFor(menu.row)} /> : null}
            {menu.row.status !== "COMPLETED" && menu.row.status !== "CANCELLED" ? <MenuItem icon={XCircle} label="Cancel run" onClick={() => void cancelRun(menu.row)} /> : null}
            {isAdmin ? <><MenuSeparator /><MenuItem icon={Trash2} label="Delete" destructive onClick={() => void deleteRun(menu.row)} /></> : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {reassignFor ? (
        /* Pinned under the row's "…" (or at the right-click point) so the
           picker stays attached to the row it changes. */
        <Picker open onClose={() => setReassignFor(null)} ariaLabel="Reassign" searchPlaceholder="Find a person" anchorPoint={reassignFor.point ?? { top: 80, left: 80 }} selected={reassignFor.row.assigneeId ?? "__anyone__"} onSelect={(v) => void reassign(reassignFor.row, v === "__anyone__" ? null : v)} sections={[{ options: peopleOptions }]} width={300} />
      ) : null}
      {dueFor ? (
        <DueDateDialog open value={dueFor.dueDate} description={`${dueFor.title}${dueFor.assignee ? ` · ${personName(dueFor.assignee)}` : ""}`} onClose={() => setDueFor(null)} onSave={(next) => saveDue(dueFor, next)} />
      ) : null}
      <StartRunDialog open={startOpen} onClose={() => setStartOpen(false)} onStarted={(run) => { bumpRowVersion("process-runs"); void load(); setParams({ run: run.id }, { keepPage: true }); }} />
      {runId ? <RunDrawer runId={runId} onClose={() => setParams({ run: null }, { keepPage: true })} /> : null}
    </>
  );
}

function DateRange({ from, to, onFrom, onTo }: { from: string | null; to: string | null; onFrom: (v: string | null) => void; onTo: (v: string | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">From</span><DateField size="sm" value={from ? from.slice(0, 10) : null} onChange={onFrom} placeholder="Any" ariaLabel="From" className="min-w-0 flex-1" /></span>
      <span className="flex items-center gap-2 text-sm text-ink-2"><span className="w-9 shrink-0">To</span><DateField size="sm" value={to ? to.slice(0, 10) : null} onChange={onTo} placeholder="Any" ariaLabel="To" className="min-w-0 flex-1" /></span>
    </div>
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
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label="Run actions" />;
}
