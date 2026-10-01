"use client";

// JobTitlesList (spec-teams-people /people/roles): the job titles the
// company uses, who holds each, and which are still unfilled. One component
// for both doors: the Teams page (`door="teams"`) and Settings > Structure
// (`door="settings"`). Every Member reads; Owner, Admin, the People team
// (and the tier that wrote titles yesterday) create, rename, move and
// delete, as GET /api/roles?withAccess=1 says.
//
// Seniority is display only (Role.level read as seniority, access 2.1): the
// old "Job titles carry the access level their holders get" line was false
// and is gone. The prompt-based quick add that silently wrote EMPLOYEE is the
// New job title modal. Delete renders only when nobody (current or removed)
// holds the title and it defines no KRAs; the route refuses anything else
// with the reason.

import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Download, ExternalLink, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { OsPageHeader, OsToolbar } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { apiFetch } from "@/lib/api-fetch";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { SENIORITY_OPTIONS, seniorityLabel, seniorityRank } from "@/lib/people/seniority";
import { toCsv } from "@/lib/people/people-csv";

export interface JobTitle {
  id: string;
  title: string;
  description: string | null;
  level: string;
  seniority: string;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  createdAt: string;
  kpiCount: number;
  removedHolders: number;
  _count: { users: number; kraTemplates: number };
}

type SortKey = "title" | "people" | "recent";
type GroupKey = "department" | "seniority" | "none";
const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "title", label: "A to Z" },
  { value: "people", label: "Most people" },
  { value: "recent", label: "Recently added" },
];

export function JobTitlesList({ door = "teams" }: { door?: "teams" | "settings" }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { openSettings } = useSettingsNav();
  const [list, setList] = useState<JobTitle[] | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depts, setDepts] = useState<Array<{ id: string; name: string }>>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [menu, setMenu] = useState<{ row: JobTitle; anchor: RefObject<HTMLElement | null> } | null>(null);
  const [moveFor, setMoveFor] = useState<JobTitle | null>(null);
  const moveAnchor = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [hasKras, setHasKras] = useState(false);
  const [sort, setSort] = useState<SortKey>("title");
  const [group, setGroup] = useState<GroupKey>("department");
  const [showDesc, setShowDesc] = useState(false);
  const view = sp?.get("view") === "unfilled" ? "unfilled" : "all";
  const deptFilter = sp?.get("dept") ?? null;
  const newOpen = sp?.get("new") === "1";

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const load = useCallback(async () => {
    const [r, d] = await Promise.all([
      apiFetch<{ data: JobTitle[]; canWrite: boolean }>("/api/roles?withAccess=1", { cache: "no-store" }),
      apiFetch<Array<{ id: string; name: string }>>("/api/departments?fresh=1", { cache: "no-store" }),
    ]);
    if (!r.ok) { setError(r.error || "Couldn't load job titles"); return; }
    setError(null);
    setList(r.data.data);
    setCanWrite(r.data.canWrite);
    if (d.ok && Array.isArray(d.data)) setDepts(d.data.map((x) => ({ id: x.id, name: x.name })));
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  // A seniority changed on a job title page shows on return.
  useEffect(() => {
    const onFocus = () => { void load(); };
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);
  useEffect(() => { if (list && newOpen && !canWrite) setParams({ new: null }); }, [list, newOpen, canWrite, setParams]);

  const filters = (q.trim() ? 1 : 0) + (deptFilter ? 1 : 0) + (seniority.length ? 1 : 0) + (hasKras ? 1 : 0);
  const shown = useMemo(() => {
    if (!list) return null;
    const needle = q.trim().toLowerCase();
    let rows = list.filter((r) =>
      (view === "all" || r._count.users === 0) &&
      (!needle || r.title.toLowerCase().includes(needle) || (r.description ?? "").toLowerCase().includes(needle)) &&
      (!deptFilter || r.departmentId === deptFilter) &&
      (!seniority.length || seniority.includes(r.seniority)) &&
      (!hasKras || r._count.kraTemplates > 0));
    rows = [...rows].sort((a, b) =>
      sort === "people" ? b._count.users - a._count.users || a.title.localeCompare(b.title)
        : sort === "recent" ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
          : a.title.localeCompare(b.title));
    return rows;
  }, [list, q, view, deptFilter, seniority, hasKras, sort]);

  const groups = useMemo(() => {
    if (!shown) return null;
    if (group === "none") return [{ key: "all", label: null as string | null, rows: shown }];
    const map = new Map<string, { label: string; rank: number; rows: JobTitle[] }>();
    for (const r of shown) {
      const key = group === "department" ? r.departmentId ?? "__none" : r.seniority;
      const label = group === "department" ? r.department?.name ?? "No department" : seniorityLabel(r.seniority);
      const rank = group === "seniority" ? seniorityRank(r.seniority) : 0;
      const g = map.get(key) ?? { label, rank, rows: [] };
      g.rows.push(r);
      map.set(key, g);
    }
    return [...map.entries()]
      .sort((a, b) => (group === "seniority" ? a[1].rank - b[1].rank : a[0] === "__none" ? 1 : b[0] === "__none" ? -1 : a[1].label.localeCompare(b[1].label)))
      .map(([key, g]) => ({ key, label: g.label as string | null, rows: g.rows }));
  }, [shown, group]);

  const deletable = (r: JobTitle) => r._count.users === 0 && r.removedHolders === 0 && r._count.kraTemplates === 0;
  const groupByKey = useMemo(() => new Map((groups ?? []).map((g) => [g.key, g])), [groups]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeptOpen, setBulkDeptOpen] = useState(false);
  const selectedRows = useMemo(() => (list ?? []).filter((r) => selected.has(r.id)), [list, selected]);
  const selectedUnfilled = selectedRows.filter(deletable);

  // Bulk: one PATCH or DELETE per title, counted; a failure names how many
  // did not go through and leaves them selected.
  async function bulkMove(departmentId: string | null) {
    const rows = selectedRows;
    const failed: string[] = [];
    for (const r of rows) {
      const res = await apiFetch(`/api/roles/${r.id}`, { method: "PATCH", json: { departmentId } });
      if (!res.ok) failed.push(r.id);
    }
    const done = rows.length - failed.length;
    const where = departmentId ? depts.find((d) => d.id === departmentId)?.name ?? "the department" : "no department";
    toast(failed.length ? `Moved ${done}; ${failed.length} couldn't be moved` : `Moved ${done} ${done === 1 ? "job title" : "job titles"} to ${where}`, failed.length ? { tone: "danger" } : undefined);
    setSelected(new Set(failed));
    void load();
  }
  async function bulkDelete() {
    const rows = selectedUnfilled;
    const ok = await confirm({ title: `Delete ${rows.length} unfilled ${rows.length === 1 ? "job title" : "job titles"}?`, description: "Only titles nobody holds and with no KRAs are deleted. This can't be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const failed: string[] = [];
    for (const r of rows) {
      const res = await apiFetch(`/api/roles/${r.id}`, { method: "DELETE" });
      if (!res.ok) failed.push(r.id);
    }
    const done = rows.length - failed.length;
    toast(failed.length ? `Deleted ${done}; ${failed.length} couldn't be deleted` : `Deleted ${done} ${done === 1 ? "job title" : "job titles"}`, failed.length ? { tone: "danger" } : undefined);
    setSelected(new Set(failed));
    void load();
  }

  async function rename(r: JobTitle) {
    const next = await prompt({ title: "Rename job title", defaultValue: r.title, submitLabel: "Rename", required: true });
    if (!next || !next.trim() || next.trim() === r.title) return;
    const res = await apiFetch(`/api/roles/${r.id}`, { method: "PATCH", json: { title: next.trim() } });
    if (!res.ok) { toast(res.error || "Couldn't rename it", { tone: "danger" }); return; }
    toast("Renamed");
    void load();
  }
  async function moveTo(r: JobTitle, departmentId: string | null) {
    const res = await apiFetch(`/api/roles/${r.id}`, { method: "PATCH", json: { departmentId } });
    if (!res.ok) { toast(res.error || "Couldn't move it", { tone: "danger" }); return; }
    toast(departmentId ? `Moved to ${depts.find((d) => d.id === departmentId)?.name ?? "the department"}` : "Removed from its department");
    void load();
  }
  async function remove(r: JobTitle) {
    const ok = await confirm({ title: `Delete ${r.title}?`, description: "This can't be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const res = await apiFetch(`/api/roles/${r.id}`, { method: "DELETE" });
    if (!res.ok) { toast(res.error || "Couldn't delete it", { tone: "danger" }); return; }
    toast(`Deleted ${r.title}`);
    void load();
  }
  function exportCsv() {
    const csv = toCsv(["Job title", "Department", "Seniority", "People", "KRAs", "KPIs", "Description"],
      (list ?? []).map((r) => [r.title, r.department?.name ?? "", seniorityLabel(r.seniority), r._count.users, r._count.kraTemplates, r.kpiCount, r.description ?? ""]));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `job-titles-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const columns = useMemo<TableColumn<JobTitle>[]>(() => [
    { key: "title", label: "Job title", title: true, width: "minmax(220px,1.5fr)", render: (r) => <span className="truncate">{r.title}</span> },
    { key: "seniority", label: "Seniority", width: "140px", render: (r) => <Chip>{seniorityLabel(r.seniority)}</Chip> },
    ...(showDesc ? [{ key: "desc", label: "Description", width: "minmax(180px,1.2fr)", hideBelow: 900, render: (r: JobTitle) => <span className="truncate text-ink-2">{r.description ?? ""}</span> }] : []),
    { key: "people", label: "People", width: "120px", numeric: true, render: (r) => r._count.users > 0 ? <span className="tabular-nums">{r._count.users}</span> : <span className="text-sm text-ink-2">Open position</span> },
    { key: "kras", label: "KRAs", width: "80px", numeric: true, hideBelow: 560, render: (r) => <span className="tabular-nums">{r._count.kraTemplates}</span> },
    { key: "kpis", label: "KPIs", width: "80px", numeric: true, hideBelow: 640, render: (r) => <span className="tabular-nums">{r.kpiCount}</span> },
  ], [showDesc]);

  const isAdmin = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
  const toolbar = {
    filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: filters },
    sort: { onClick: () => setSortOpen((x) => !x), label: sort === "title" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "title" },
    primary: canWrite ? { label: "New job title", icon: Plus, onClick: () => setParams({ new: "1" }) } : undefined,
    menu: [
      { label: "Description", checked: showDesc, keepOpen: true, onClick: () => setShowDesc((x) => !x) },
      { separator: true as const },
      { label: "Group by department", checked: group === "department", onClick: () => setGroup("department") },
      { label: "Group by seniority", checked: group === "seniority", onClick: () => setGroup("seniority") },
      { label: "No grouping", checked: group === "none", onClick: () => setGroup("none") },
      ...(isAdmin && !boot.viewer.isAgent ? [{ separator: true as const }, { label: "Export CSV", icon: Download, onClick: exportCsv }] : []),
      ...(isAdmin && door === "teams" ? [{ label: "Manage in Settings", icon: ExternalLink, onClick: () => openSettings("/settings/structure?tab=titles") }] : []),
      // In Settings the page tabs are the only tab strip, so the All and
      // Unfilled views ride in this menu instead of a second row.
      ...(door === "settings"
        ? [{ separator: true as const }, { label: "Only open positions", checked: view === "unfilled", keepOpen: true, onClick: () => setParams({ view: view === "unfilled" ? null : "unfilled" }) }]
        : []),
    ],
  };
  const views = (
    <>
      <ViewTab label="All" active={view === "all"} onClick={() => setParams({ view: null })} />
      <ViewTab label="Unfilled" active={view === "unfilled"} onClick={() => setParams({ view: "unfilled" })} />
    </>
  );
  const clear = () => { setQ(""); setSeniority([]); setHasKras(false); setParams({ dept: null }); };

  return (
    <>
      {door === "teams" ? <Breadcrumb items={[{ label: "Job titles" }]} /> : null}
      {door === "teams" ? <OsPageHeader title="Job titles" views={views} toolbar={toolbar} /> : (
        <>
          <p className="text-base text-ink-2">Job titles describe the work. They never change what someone can open.</p>
          <OsToolbar {...toolbar} className="!px-0" />
        </>
      )}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort job titles" selected={sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(v) => { setSortOpen(false); setSort(v as SortKey); }} />
          </div>
        ) : null}
      </div>
      <div className={door === "teams" ? "os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2" : "os-chrome flex min-h-0 flex-1 gap-4 pt-2"}>
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="job titles" activeCount={filters} onClearAll={clear}
          search={{ value: q, onChange: setQ, placeholder: "Search job titles" }}>
          {depts.length ? (
            <FilterGroup label="Department">
              {depts.map((d) => <FilterRow key={d.id} label={d.name} checked={deptFilter === d.id} onCheckedChange={(on) => setParams({ dept: on ? d.id : null })} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Seniority">
            {SENIORITY_OPTIONS.map((s) => (
              <FilterRow key={s.value} label={s.label} checked={seniority.includes(s.value)} onCheckedChange={(on) => setSeniority((cur) => on ? [...cur, s.value] : cur.filter((x) => x !== s.value))} />
            ))}
          </FilterGroup>
          <FilterGroup label="KRAs">
            <FilterRow label="Has KRAs" checked={hasKras} onCheckedChange={setHasKras} />
          </FilterGroup>
        </FilterPanel>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {error && !list ? (
            <OsEmptyView variant="error" title="Couldn't load job titles" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : list && list.length === 0 ? (
            <OsEmptyView title="No job titles yet" action={canWrite ? { label: "Create a job title", onClick: () => setParams({ new: "1" }) } : undefined} />
          ) : !groups ? (
            <TableCard ariaLabel="Job titles" columns={columns} rows={null} rowKey={(r) => r.id} />
          ) : groups.every((g) => g.rows.length === 0) ? (
            <TableCard ariaLabel="Job titles" columns={columns} rows={[]} rowKey={(r) => r.id}
              empty={<span className="text-row text-ink-2">No job titles match · <button type="button" className="text-brand-deep hover:underline" onClick={clear}>Clear filters</button></span>} />
          ) : (
            // ONE card: each group opens with a 44px header row inside it (the
            // whole list is loaded, so each count is the group's real size).
            <TableCard
              ariaLabel="Job titles"
              columns={columns}
              rows={groups.flatMap((g) => g.rows)}
              rowKey={(r) => r.id}
              rowHref={(r) => `/people/roles/${r.id}`}
              groupOf={group === "none" ? undefined : (r) => {
                const key = group === "department" ? r.departmentId ?? "__none" : r.seniority;
                const g = groupByKey.get(key);
                return { key, label: g?.label ?? "", count: g?.rows.length ?? null };
              }}
              collapsedGroups={collapsed}
              onToggleGroup={(key) => setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              selectable={canWrite}
              selected={selected}
              onSelectedChange={setSelected}
              bulkActions={canWrite ? (
                <>
                  <div className="relative">
                    <button type="button" onClick={() => setBulkDeptOpen((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink hover:bg-hover"><Building2 className="h-4 w-4" aria-hidden />Set department</button>
                    <Picker open={bulkDeptOpen} onClose={() => setBulkDeptOpen(false)} side="top" ariaLabel="Set department" searchPlaceholder="Search departments"
                      sections={[{ options: [{ value: "__none__", label: "No department" }, ...depts.map((d) => ({ value: d.id, label: d.name }))] }]}
                      onSelect={(v) => { setBulkDeptOpen(false); void bulkMove(v === "__none__" ? null : v); }}
                      className="absolute bottom-10 start-0 z-50" />
                  </div>
                  {selectedUnfilled.length ? (
                    <button type="button" onClick={() => void bulkDelete()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-danger-text hover:bg-hover"><Trash2 className="h-4 w-4" aria-hidden />Delete unfilled ({selectedUnfilled.length})</button>
                  ) : null}
                </>
              ) : undefined}
              rowMenu={canWrite ? (r) => (
                <button type="button" aria-label={`Actions for ${r.title}`} aria-haspopup="menu"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ row: r, anchor: { current: e.currentTarget } }); }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              ) : undefined}
              footer={list ? { total: shown?.length ?? 0, noun: "job titles", from: shown?.length ? 1 : 0, to: shown?.length ?? 0 } : undefined}
            />
          )}
        </div>
      </div>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.row.title}`}>
            <MenuItem icon={Users} label="Open" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/roles/${id}`); }} />
            <MenuItem icon={Pencil} label="Rename" onClick={() => { const r = menu.row; setMenu(null); void rename(r); }} />
            <MenuItem icon={Building2} label="Set department" onClick={() => { const r = menu.row; moveAnchor.current = menu.anchor.current; setMenu(null); setMoveFor(r); }} />
            {deletable(menu.row) ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { const r = menu.row; setMenu(null); void remove(r); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {moveFor ? (
        <MorePortal anchorRef={moveAnchor} width={260} open placement="below" onClose={() => setMoveFor(null)}>
          <Picker open onClose={() => setMoveFor(null)} ariaLabel="Set department" selected={moveFor.departmentId ?? "__none__"} searchPlaceholder="Search departments"
            sections={[{ options: [{ value: "__none__", label: "No department" }, ...depts.map((d) => ({ value: d.id, label: d.name }))] }]}
            onSelect={(v) => { const r = moveFor; setMoveFor(null); void moveTo(r, v === "__none__" ? null : v); }} />
        </MorePortal>
      ) : null}
      {newOpen && canWrite ? (
        <NewJobTitleDialog depts={depts} defaultDept={deptFilter}
          onClose={() => setParams({ new: null })}
          onCreated={(id) => { router.push(`/people/roles/${id}`); }} />
      ) : null}
    </>
  );
}

/** New job title (560, ui/dialog): replaces the "Role title?" prompt. */
export function NewJobTitleDialog({ depts, defaultDept, onClose, onCreated }: {
  depts: Array<{ id: string; name: string }>; defaultDept?: string | null; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(defaultDept ?? null);
  const [seniority, setSeniority] = useState("EMPLOYEE");
  const [description, setDescription] = useState("");
  const [deptOpen, setDeptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = title.trim() !== "" || description.trim() !== "";
  const confirm = useConfirm();
  async function close() {
    if (dirty && !(await confirm({ title: "Discard this job title?", description: "What you typed is not saved.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }
  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ id: string }>("/api/roles", { method: "POST", json: { title: title.trim(), departmentId, seniority, description: description.trim() || null } });
    setBusy(false);
    if (!r.ok) { setError(r.error || "Couldn't create it"); return; }
    onCreated(r.data.id);
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New job title</DialogTitle>
          <DialogDescription>A job title carries the KRAs, KPIs and SOPs of the role. Seniority is for display and never changes what someone can do.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Title <span className="font-normal text-ink-2">(required)</span></span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
              className="h-9 rounded-md border border-line bg-raised px-3 text-sm text-ink focus:border-brand focus:outline-none" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>Department</span>
              <div className="relative">
                <button type="button" onClick={() => setDeptOpen((x) => !x)} aria-label="Department" className="inline-flex h-9 w-full items-center rounded-md border border-line bg-raised px-3 text-start text-sm font-normal text-ink">
                  <span className={departmentId ? "" : "text-ink-3"}>{depts.find((d) => d.id === departmentId)?.name ?? "No department"}</span>
                </button>
                <Picker open={deptOpen} onClose={() => setDeptOpen(false)} ariaLabel="Department" selected={departmentId ?? "__none__"} searchPlaceholder="Search departments"
                  sections={[{ options: [{ value: "__none__", label: "No department" }, ...depts.map((d) => ({ value: d.id, label: d.name }))] }]}
                  onSelect={(v) => { setDeptOpen(false); setDepartmentId(v === "__none__" ? null : v); }} className="absolute start-0 top-10 z-50" />
              </div>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>Seniority</span>
              <select value={seniority} onChange={(e) => setSeniority(e.target.value)} className="h-9 rounded-md border border-line bg-raised px-2 text-sm font-normal text-ink">
                {SENIORITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="rounded-md border border-line bg-raised px-3 py-2 text-sm font-normal text-ink focus:border-brand focus:outline-none" />
          </label>
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void close()}>Cancel</Button>
          <Button onClick={() => void create()} disabled={!title.trim() || busy}>{busy ? "Creating" : "Create job title"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
