"use client";

// DepartmentsManager (spec-teams-people /people/departments): the company's
// departments, who heads each, and how many people are in it. One component
// for both doors: the Teams page (`door="teams"`, with the page header) and
// Settings > Structure (`door="settings"`, the list under that page's own
// header). Every Member reads; Owner, Admin and whoever the permission
// matrix grants organization.manageDepartments write (GET
// /api/departments?withAccess=1 says which).
//
// Table (default) or Tree; row click opens the Department drawer (520), where
// every field saves on its own; New department opens the same drawer empty,
// and while it is open in create mode its Create is the page's one primary.
// Colour is the eight-hue index (design-system 1.7); legacy hex and CSS-var
// values still read through departmentHue until the report-only remap runs.

import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Download, List, ListTree, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { OsPageHeader, OsToolbar } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { Drawer } from "@/components/ui/drawer";
import { Picker } from "@/components/ui/picker";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar-stack";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { recordWriteQueue } from "@/lib/people/record-write-queue";
import { USER_HUES, departmentHue } from "@/lib/people/department-hue";
import { toCsv } from "@/lib/people/people-csv";
import { PeoplePickerField, personName, type PickPerson } from "./person-bits";

export interface Dept {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  hue: number | null;
  parentId: string | null;
  headId: string | null;
  head: PickPerson | null;
  createdAt: string;
  removedMembers: number;
  _count: { members: number; roles: number };
  subDepartments: Array<{ id: string; name: string }>;
}

type SortKey = "name" | "people" | "recent";
const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "name", label: "Name A to Z" },
  { value: "people", label: "Most people" },
  { value: "recent", label: "Recently added" },
];

function HueDot({ hue }: { hue: number | null }) {
  const h = hue ? USER_HUES.find((x) => x.index === hue) : null;
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: h ? h.hex : "var(--os-line-strong)" }} />;
}

/** Depth-first order with depth, for the Tree view. Loop-safe. */
function treeOrder(list: Dept[], sort: (a: Dept, b: Dept) => number): Array<{ d: Dept; depth: number; kids: number }> {
  const byParent = new Map<string | null, Dept[]>();
  const ids = new Set(list.map((d) => d.id));
  for (const d of list) {
    const p = d.parentId && ids.has(d.parentId) && d.parentId !== d.id ? d.parentId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), d]);
  }
  const out: Array<{ d: Dept; depth: number; kids: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const d of [...(byParent.get(parent) ?? [])].sort(sort)) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ d, depth, kids: (byParent.get(d.id) ?? []).length });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left sits in a parent loop: show it at the root, never drop it.
  for (const d of list) if (!seen.has(d.id)) out.push({ d, depth: 0, kids: 0 });
  return out;
}

export function DepartmentsManager({ door = "teams" }: { door?: "teams" | "settings" }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { rowVersion } = useOsShell();
  const { boot } = useBoot();
  const [list, setList] = useState<Dept[] | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [noHead, setNoHead] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [layout, setLayout] = useState<"table" | "tree">("table");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showDesc, setShowDesc] = useState(false);
  const [showTitles, setShowTitles] = useState(true);
  const [headFilter, setHeadFilter] = useState<PickPerson | null>(null);
  const [parentFilter, setParentFilter] = useState<string | null>(null);
  const [parentPickOpen, setParentPickOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkParentOpen, setBulkParentOpen] = useState(false);
  const [menu, setMenu] = useState<{ d: Dept; anchor: { current: HTMLElement | null } } | null>(null);
  const confirm = useConfirm();
  const openId = sp?.get("open") ?? null;
  const creating = sp?.get("new") === "1";
  const newParent = sp?.get("parent") ?? null;

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const load = useCallback(async () => {
    const r = await apiFetch<{ data: Dept[]; canWrite: boolean }>("/api/departments?withAccess=1", { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load departments"); return; }
    setError(null);
    setList(r.data.data);
    setCanWrite(r.data.canWrite);
  }, []);
  const v = rowVersion("people");
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load, v]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);
  // ?new=1 from someone who cannot create is stripped (the default view).
  useEffect(() => { if (list && creating && !canWrite) setParams({ new: null }); }, [list, creating, canWrite, setParams]);

  const cmp = useMemo(() => (a: Dept, b: Dept) =>
    sort === "people" ? b._count.members - a._count.members || a.name.localeCompare(b.name)
      : sort === "recent" ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
        : a.name.localeCompare(b.name), [sort]);

  const byId = useMemo(() => new Map((list ?? []).map((d) => [d.id, d])), [list]);
  const filtered = useMemo(() => {
    if (!list) return null;
    const needle = q.trim().toLowerCase();
    return list.filter((d) =>
      (!needle || d.name.toLowerCase().includes(needle) || (d.head && personName(d.head).toLowerCase().includes(needle))) &&
      (!noHead || !d.headId) &&
      (!headFilter || d.headId === headFilter.id) &&
      (!parentFilter || d.parentId === parentFilter));
  }, [list, q, noHead, headFilter, parentFilter]);
  const filters = (q.trim() ? 1 : 0) + (noHead ? 1 : 0) + (headFilter ? 1 : 0) + (parentFilter ? 1 : 0);
  const clearFilters = () => { setQ(""); setNoHead(false); setHeadFilter(null); setParentFilter(null); };

  const rows = useMemo(() => {
    if (!filtered) return null;
    if (layout === "tree" && filters === 0) {
      const ordered = treeOrder(filtered, cmp);
      // Hide the rows under a collapsed ancestor.
      const out: Array<{ d: Dept; depth: number; kids: number }> = [];
      let hideBelow: number | null = null;
      for (const r of ordered) {
        if (hideBelow !== null && r.depth > hideBelow) continue;
        hideBelow = collapsed.has(r.d.id) ? r.depth : null;
        out.push(r);
      }
      return out;
    }
    return [...filtered].sort(cmp).map((d) => ({ d, depth: 0, kids: d.subDepartments.length }));
  }, [filtered, layout, filters, cmp, collapsed]);

  const columns = useMemo<TableColumn<{ d: Dept; depth: number; kids: number }>[]>(() => [
    { key: "name", label: "Department", title: true, width: "minmax(220px,1.4fr)", render: ({ d, depth, kids }) => (
      <span className="flex min-w-0 items-center gap-2" style={{ paddingInlineStart: layout === "tree" ? depth * 20 : 0 }}>
        {layout === "tree" ? (
          kids > 0 ? (
            <button type="button" aria-label={collapsed.has(d.id) ? "Expand" : "Collapse"} aria-expanded={!collapsed.has(d.id)}
              onClick={(e) => { e.stopPropagation(); setCollapsed((c) => { const n = new Set(c); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; }); }}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:bg-hover">
              {collapsed.has(d.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-5" />
        ) : null}
        <HueDot hue={departmentHue(d.color).index} />
        <span className="truncate">{d.name}</span>
      </span>
    ) },
    { key: "head", label: "Head", width: "minmax(160px,1fr)", render: ({ d }) => d.head
      ? <span className="flex min-w-0 items-center gap-1.5"><Avatar person={d.head} size={20} /><span className="truncate">{personName(d.head)}</span></span>
      : <span className="text-ink-3">No head</span> },
    { key: "parent", label: "Parent", width: "minmax(130px,0.8fr)", hideBelow: 700, render: ({ d }) => <span className="truncate text-ink-2">{d.parentId ? byId.get(d.parentId)?.name ?? "" : ""}</span> },
    ...(showDesc ? [{ key: "desc", label: "Description", width: "minmax(180px,1.2fr)", hideBelow: 900, render: ({ d }: { d: Dept }) => <span className="truncate text-ink-2">{d.description ?? ""}</span> }] : []),
    { key: "people", label: "People", width: "96px", numeric: true, render: ({ d }) => (
      <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/people?dept=${d.id}`); }} className="tabular-nums hover:underline">{d._count.members}</button>
    ) },
    ...(showTitles ? [{ key: "titles", label: "Job titles", width: "96px", numeric: true, hideBelow: 560, render: ({ d }: { d: Dept }) => (
      <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/people/roles?dept=${d.id}`); }} className="tabular-nums hover:underline">{d._count.roles}</button>
    ) }] : []),
  ], [layout, collapsed, byId, router, showDesc, showTitles]);

  // A department is deletable only when nobody (current or removed) is in it
  // and it has no sub-departments: the same rule the drawer and the route use.
  const isDeletable = (d: Dept) => d._count.members === 0 && d.removedMembers === 0 && d.subDepartments.length === 0;
  const selectedDepts = (list ?? []).filter((d) => selected.has(d.id));
  const selectedDeletable = selectedDepts.filter(isDeletable);
  async function bulkSetParent(parentId: string | null) {
    const rows = selectedDepts.filter((d) => d.id !== parentId);
    const failed: string[] = [];
    for (const d of rows) {
      const r = await apiFetch(`/api/departments/${d.id}`, { method: "PATCH", json: { parentId } });
      if (!r.ok) failed.push(d.id);
    }
    const done = rows.length - failed.length;
    toast(failed.length ? `Moved ${done}; ${failed.length} couldn't be moved (a loop, or no access)` : `Moved ${done} ${done === 1 ? "department" : "departments"}`, failed.length ? { tone: "danger" } : undefined);
    setSelected(new Set(failed));
    void load();
  }
  async function deleteDepts(rows: Dept[]) {
    if (rows.length === 0) return;
    const ok = await confirm({
      title: rows.length === 1 ? `Delete ${rows[0].name}?` : `Delete ${rows.length} departments?`,
      description: "Only empty departments with no sub-departments are deleted. This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const failed: string[] = [];
    for (const d of rows) {
      const r = await apiFetch(`/api/departments/${d.id}`, { method: "DELETE" });
      if (!r.ok) failed.push(d.id);
    }
    const done = rows.length - failed.length;
    toast(failed.length ? `Deleted ${done}; ${failed.length} couldn't be deleted` : `Deleted ${done} ${done === 1 ? "department" : "departments"}`, failed.length ? { tone: "danger" } : undefined);
    setSelected(new Set(failed));
    void load();
  }

  function exportCsv() {
    const csv = toCsv(["Department", "Head", "Parent", "People", "Job titles", "Description"],
      (list ?? []).map((d) => [d.name, d.head ? personName(d.head) : "", d.parentId ? byId.get(d.parentId)?.name ?? "" : "", d._count.members, d._count.roles, d.description ?? ""]));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `departments-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const isAdmin = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
  const toolbar = {
    filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: filters },
    sort: { onClick: () => setSortOpen((x) => !x), label: sort === "name" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "name" },
    switcher: { value: layout, options: [{ key: "table", label: "Table", icon: List }, { key: "tree", label: "Tree", icon: ListTree }], onChange: (k: string) => setLayout(k === "tree" ? "tree" : "table") },
    // The drawer's Create is the one primary while it is open in create mode.
    primary: canWrite && !creating ? { label: "New department", icon: Plus, onClick: () => setParams({ new: "1", open: null }) } : undefined,
    menu: [
      { label: "Description", checked: showDesc, keepOpen: true, onClick: () => setShowDesc((x) => !x) },
      { label: "Job titles", checked: showTitles, keepOpen: true, onClick: () => setShowTitles((x) => !x) },
      ...(isAdmin && !boot.viewer.isAgent ? [{ separator: true as const }, { label: "Export CSV", icon: Download, onClick: exportCsv }] : []),
    ],
  };

  return (
    <>
      {door === "teams" ? <Breadcrumb items={[{ label: "Departments" }]} /> : null}
      {door === "teams" ? <OsPageHeader title="Departments" toolbar={toolbar} /> : <OsToolbar {...toolbar} />}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort departments" selected={sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(val) => { setSortOpen(false); setSort(val as SortKey); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="departments" activeCount={filters}
          onClearAll={clearFilters} search={{ value: q, onChange: setQ, placeholder: "Search departments" }}>
          <FilterGroup label="Head">
            <PeoplePickerField ariaLabel="Head" value={headFilter ? [headFilter.id] : []} people={headFilter ? [headFilter] : []} placeholder="Anyone"
              onChange={(_ids, picked) => setHeadFilter(picked[0] ?? null)} />
            <FilterRow label="Has no head" checked={noHead} onCheckedChange={setNoHead} />
          </FilterGroup>
          <FilterGroup label="Parent">
            <div className="relative">
              <button type="button" aria-haspopup="listbox" aria-expanded={parentPickOpen} onClick={() => setParentPickOpen((v) => !v)}
                className="inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-ink hover:border-line-strong">
                <span className={`min-w-0 flex-1 truncate text-start ${parentFilter ? "" : "text-ink-3"}`}>{parentFilter ? byId.get(parentFilter)?.name ?? "Any" : "Any"}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
              </button>
              <Picker open={parentPickOpen} onClose={() => setParentPickOpen(false)} ariaLabel="Parent department" searchPlaceholder="Search departments" selected={parentFilter ?? "__any__"}
                sections={[{ options: [{ value: "__any__", label: "Any" }, ...(list ?? []).filter((d) => d.subDepartments.length > 0).map((d) => ({ value: d.id, label: d.name }))] }]}
                onSelect={(v) => { setParentPickOpen(false); setParentFilter(v === "__any__" ? null : v); }}
                className="absolute start-0 top-9 z-50" />
            </div>
          </FilterGroup>
        </FilterPanel>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {layout === "tree" && filters === 0 && list && list.some((d) => d.subDepartments.length) ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setCollapsed(new Set())} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Expand all</button>
              <button type="button" onClick={() => setCollapsed(new Set((list ?? []).filter((d) => d.subDepartments.length).map((d) => d.id)))} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Collapse all</button>
            </div>
          ) : null}
          {error && !list ? (
            <OsEmptyView variant="error" title="Couldn't load departments" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : list && list.length === 0 ? (
            <OsEmptyView title="No departments yet" action={canWrite ? { label: "Create a department", onClick: () => setParams({ new: "1" }) } : undefined} />
          ) : (
            <TableCard
              ariaLabel="Departments"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.d.id}
              onRowClick={(r) => setParams({ open: r.d.id, new: null })}
              highlightKey={openId}
              selectable={canWrite}
              selected={selected}
              onSelectedChange={setSelected}
              bulkActions={canWrite ? (
                <>
                  <div className="relative">
                    <button type="button" onClick={() => setBulkParentOpen((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink hover:bg-hover"><ListTree className="h-4 w-4" aria-hidden />Set parent</button>
                    <Picker open={bulkParentOpen} onClose={() => setBulkParentOpen(false)} side="top" ariaLabel="Set parent" searchPlaceholder="Search departments"
                      sections={[{ options: [{ value: "__none__", label: "No parent" }, ...(list ?? []).filter((d) => !selected.has(d.id)).map((d) => ({ value: d.id, label: d.name }))] }]}
                      onSelect={(val) => { setBulkParentOpen(false); void bulkSetParent(val === "__none__" ? null : val); }}
                      className="absolute bottom-10 start-0 z-50" />
                  </div>
                  {selectedDeletable.length ? (
                    <button type="button" onClick={() => void deleteDepts(selectedDeletable)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-danger-text hover:bg-hover"><Trash2 className="h-4 w-4" aria-hidden />Delete empty ({selectedDeletable.length})</button>
                  ) : null}
                </>
              ) : undefined}
              rowMenu={canWrite ? (r) => (
                <button type="button" aria-label={`Actions for ${r.d.name}`} aria-haspopup="menu"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ d: r.d, anchor: { current: e.currentTarget } }); }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              ) : undefined}
              footer={list ? { total: list.length, noun: "departments", from: rows?.length ? 1 : 0, to: rows?.length ?? 0 } : undefined}
              empty={<span className="text-row text-ink-2">No departments match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>}
            />
          )}
        </div>
      </div>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.d.name}`}>
            <MenuItem icon={Pencil} label="Edit" onClick={() => { const id = menu.d.id; setMenu(null); setParams({ open: id, new: null }); }} />
            <MenuItem icon={Plus} label="Add sub-department" onClick={() => { const id = menu.d.id; setMenu(null); setParams({ new: "1", open: null, parent: id }); }} />
            {isDeletable(menu.d) ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { const d = menu.d; setMenu(null); void deleteDepts([d]); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {(openId && byId.get(openId)) || creating ? (
        <DepartmentDrawer
          key={creating ? `new:${newParent ?? ""}` : openId}
          defaultParentId={creating ? newParent : null}
          dept={creating ? null : byId.get(openId!) ?? null}
          all={list ?? []}
          canWrite={canWrite}
          onClose={() => setParams({ open: null, new: null, parent: null })}
          onChanged={() => void load()}
          onCreated={(id) => { void load(); setParams({ new: null, open: id, parent: null }); toast("Department created"); }}
        />
      ) : null}
    </>
  );
}

type FieldState = "idle" | "saving" | "saved" | "retrying" | { error: string };

function DrawerRow({ label, field, state, children }: { label: string; field: string; state: Record<string, FieldState>; children: React.ReactNode }) {
  const st = state[field];
  return (
    <div className="grid grid-cols-[120px_1fr_20px] items-start gap-3 py-1.5">
      <span className="pt-1.5 text-sm font-medium text-ink-2">{label}</span>
      <div className="min-w-0">
        {children}
        {typeof st === "object" ? <p role="alert" className="mt-1 text-xs text-danger-text">{st.error}</p> : null}
        {st === "retrying" ? <p role="status" className="mt-1 text-xs text-danger-text">Not saved, retrying. It saves when you reconnect.</p> : null}
      </div>
      <span className="pt-2">{st === "saved" ? <Check className="h-4 w-4 text-success-text" aria-label="Saved" /> : null}</span>
    </div>
  );
}

function DepartmentDrawer({ dept, all, canWrite, onClose, onChanged, onCreated, defaultParentId = null }: {
  dept: Dept | null; all: Dept[]; canWrite: boolean; onClose: () => void; onChanged: () => void; onCreated: (id: string) => void;
  /** "Add sub-department" from a row: the new department starts under it. */
  defaultParentId?: string | null;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const create = dept === null;
  const [name, setName] = useState(dept?.name ?? "");
  const [description, setDescription] = useState(dept?.description ?? "");
  const [head, setHead] = useState<PickPerson | null>(dept?.head ?? null);
  const [parentId, setParentId] = useState<string | null>(dept?.parentId ?? (defaultParentId && all.some((d) => d.id === defaultParentId) ? defaultParentId : null));
  const [hue, setHue] = useState<number | null>(dept ? departmentHue(dept.color).index : null);
  const [parentOpen, setParentOpen] = useState(false);
  const [state, setState] = useState<Record<string, FieldState>>({});
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<{ rows: PickPerson[]; total: number } | null>(null);
  const [titles, setTitles] = useState<Array<{ id: string; title: string }> | null>(null);

  useEffect(() => {
    if (!dept) return;
    let live = true;
    void apiFetch<{ data: PickPerson[]; pagination: { total: number } }>(`/api/users?scope=directory&dept=${dept.id}&limit=8`, { cache: "no-store" })
      .then((r) => { if (live && r.ok) setPeople({ rows: r.data.data, total: r.data.pagination.total }); });
    void apiFetch<Array<{ id: string; title: string; departmentId: string | null }>>("/api/roles", { cache: "no-store" })
      .then((r) => { if (live && r.ok && Array.isArray(r.data)) setTitles(r.data.filter((t) => t.departmentId === dept.id)); });
    return () => { live = false; };
  }, [dept]);

  // A department can never sit under itself or one of its own descendants.
  const blocked = useMemo(() => {
    if (!dept) return new Set<string>();
    const out = new Set<string>([dept.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of all) if (d.parentId && out.has(d.parentId) && !out.has(d.id)) { out.add(d.id); grew = true; }
    }
    return out;
  }, [dept, all]);

  async function save(field: string, body: Record<string, unknown>): Promise<boolean> {
    if (!dept) return true;
    setState((s) => ({ ...s, [field]: "saving" }));
    // The record write queue keeps a change a dropped connection lost and
    // retries it, even after the drawer closes.
    const r = await recordWriteQueue().write("PATCH", `/api/departments/${dept.id}`, body, {
      onRetrying: () => setState((s) => ({ ...s, [field]: "retrying" })),
    });
    if (!r.ok) { setState((s) => ({ ...s, [field]: { error: r.error || "Not saved" } })); return false; }
    setState((s) => ({ ...s, [field]: "saved" }));
    onChanged();
    return true;
  }

  async function createIt() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await apiFetch<{ id: string }>("/api/departments", { method: "POST", json: { name: name.trim(), description: description.trim() || null, headId: head?.id ?? null, parentId, color: hue ? String(hue) : null } });
    setBusy(false);
    if (!r.ok) { setState((s) => ({ ...s, name: { error: r.error || "Couldn't create it" } })); return; }
    onCreated(r.data.id);
  }

  async function remove() {
    if (!dept) return;
    const ok = await confirm({ title: `Delete ${dept.name}?`, description: "This can't be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/departments/${dept.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete it", { tone: "danger" }); return; }
    toast(`Deleted ${dept.name}`);
    onChanged();
    onClose();
  }

  const deletable = dept && dept._count.members === 0 && dept.removedMembers === 0 && dept.subDepartments.length === 0;
  const blockers = dept ? [
    dept._count.members ? `${dept._count.members} ${dept._count.members === 1 ? "person" : "people"}` : null,
    dept.removedMembers ? `${dept.removedMembers} removed ${dept.removedMembers === 1 ? "person" : "people"}` : null,
    dept.subDepartments.length ? `${dept.subDepartments.length} sub-department${dept.subDepartments.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean) : [];
  const parentName = parentId ? all.find((d) => d.id === parentId)?.name ?? "" : "";
  return (
    <Drawer
      open
      onClose={onClose}
      ariaLabel="Department"
      layerId="department-drawer"
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">Departments › <span className="text-ink">{create ? "New department" : dept?.name}</span></span>
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" /></button>
        </>
      }
      footer={create ? (
        <div className="flex justify-end gap-2 px-4 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void createIt()} disabled={!name.trim() || busy}>{busy ? "Creating" : "Create"}</Button>
        </div>
      ) : undefined}
    >
      <div className="flex flex-col gap-5 px-5 py-4">
        {canWrite ? (
          <div className="flex flex-col">
            <DrawerRow state={state} label="Name" field="name">
              <input autoFocus={create} value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
                onBlur={() => { if (!create && dept && name.trim() && name.trim() !== dept.name) void save("name", { name: name.trim() }); if (!create && !name.trim()) setState((s) => ({ ...s, name: { error: "A department needs a name" } })); }}
                aria-label="Name" className="h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none" />
            </DrawerRow>
            <DrawerRow state={state} label="Description" field="description">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                onBlur={() => { if (!create && dept && description !== (dept.description ?? "")) void save("description", { description }); }}
                aria-label="Description" className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none" />
            </DrawerRow>
            <DrawerRow state={state} label="Head" field="headId">
              <PeoplePickerField ariaLabel="Head" value={head ? [head.id] : []} people={head ? [head] : []} placeholder="No head"
                onChange={(_ids, picked) => { const prev = head; const next = picked[0] ?? null; setHead(next); if (!create) void save("headId", { headId: next?.id ?? null }).then((ok) => { if (!ok) setHead(prev); }); }} />
            </DrawerRow>
            <DrawerRow state={state} label="Parent" field="parentId">
              <div className="relative">
                <button type="button" aria-label="Parent department" onClick={() => setParentOpen((x) => !x)} className="inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-ink hover:border-line-strong">
                  <span className={`min-w-0 flex-1 truncate text-start ${parentId ? "" : "text-ink-3"}`}>{parentName || "No parent"}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-ink-2" aria-hidden />
                </button>
                <Picker open={parentOpen} onClose={() => setParentOpen(false)} ariaLabel="Parent department" selected={parentId ?? "__none__"} searchPlaceholder="Search departments"
                  sections={[{ options: [{ value: "__none__", label: "No parent" }, ...all.filter((d) => !blocked.has(d.id)).map((d) => ({ value: d.id, label: d.name }))] }]}
                  onSelect={(val) => { setParentOpen(false); const next = val === "__none__" ? null : val; const prev = parentId; setParentId(next); if (!create) void save("parentId", { parentId: next }).then((ok) => { if (!ok) setParentId(prev); }); }}
                  className="absolute start-0 top-10 z-50" />
              </div>
            </DrawerRow>
            <DrawerRow state={state} label="Colour" field="color">
              <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-1 pt-1">
                <button type="button" role="radio" aria-checked={hue === null} onClick={() => { setHue(null); if (!create) void save("color", { color: null }); }}
                  className={`inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium ${hue === null ? "border-brand text-brand-deep" : "border-line text-ink-2"}`}>None</button>
                {USER_HUES.map((h) => (
                  <button key={h.index} type="button" role="radio" aria-checked={hue === h.index} aria-label={h.name} title={h.name}
                    onClick={() => { setHue(h.index); if (!create) void save("color", { color: String(h.index) }); }}
                    className={`h-6 w-6 rounded-md border-2 ${hue === h.index ? "border-ink" : "border-transparent"}`}>
                    <span className="block h-full w-full rounded" style={{ background: h.hex }} />
                  </button>
                ))}
              </div>
            </DrawerRow>
          </div>
        ) : dept ? (
          <dl className="flex flex-col">
            <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5"><dt className="text-sm font-medium text-ink-2">Name</dt><dd className="text-row text-ink">{dept.name}</dd></div>
            {dept.description ? <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5"><dt className="text-sm font-medium text-ink-2">Description</dt><dd className="whitespace-pre-wrap text-row text-ink">{dept.description}</dd></div> : null}
            <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5"><dt className="text-sm font-medium text-ink-2">Head</dt><dd className="text-row text-ink">{dept.head ? <Link href={`/people/${dept.head.id}`} className="hover:underline">{personName(dept.head)}</Link> : <span className="text-ink-3">No head</span>}</dd></div>
            {parentName ? <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5"><dt className="text-sm font-medium text-ink-2">Parent</dt><dd className="text-row text-ink">{parentName}</dd></div> : null}
          </dl>
        ) : null}

        {dept ? (
          <>
            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-ink">People</h3>
              {people === null ? <SkeletonRows rows={3} rowHeight="36px" /> : people.rows.length === 0 ? <p className="text-sm text-ink-2">Nobody is in this department.</p> : (
                <ul className="flex flex-col">
                  {people.rows.map((p) => (
                    <li key={p.id}><Link href={`/people/${p.id}`} className="flex h-9 items-center gap-2 rounded-md px-1 text-sm text-ink hover:bg-hover"><Avatar person={p} size={24} />{personName(p)}</Link></li>
                  ))}
                </ul>
              )}
              {people && people.total > 0 ? <Link href={`/people?dept=${dept.id}`} className="text-sm text-brand-deep hover:underline">See all {people.total} in the Directory</Link> : null}
            </section>
            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-ink">Job titles</h3>
              {titles === null ? <SkeletonRows rows={2} rowHeight="36px" /> : titles.length === 0 ? <p className="text-sm text-ink-2">No job titles in this department.</p> : (
                <ul className="flex flex-col">{titles.map((t) => <li key={t.id}><Link href={`/people/roles/${t.id}`} className="flex h-9 items-center rounded-md px-1 text-sm text-ink hover:bg-hover">{t.title}</Link></li>)}</ul>
              )}
            </section>
            {canWrite ? (
              <section className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-semibold text-ink">Delete department</h3>
                {deletable ? (
                  <button type="button" onClick={() => void remove()} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-danger-text hover:bg-danger-bg"><Trash2 className="h-4 w-4" aria-hidden />Delete department</button>
                ) : (
                  <p className="mt-1 text-sm text-ink-2">Move {blockers.join(" and ")} first.</p>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
