"use client";

// Teams > Directory (spec-teams-people /people): find anyone at the company
// and open their record.
//
//   views       All · New (joined in the last 90 days) · No manager and
//               Removed (Owner, Admin, People team)
//   toolbar     Filter (search, department, job title, office, reports to,
//               tags, seniority, Deactivated), Sort, Table or Cards, the one
//               blue Invite, and "..." (Display, Import people, Export CSV,
//               Manage members)
//   body        a TableCard of people, server paginated (40 or 100 a page;
//               the old client-side 500 cap is gone), optionally grouped by
//               department, office or job title
//
// Everything lives in the URL (?view=&q=&dept=&title=&office=&reportsTo=
// &tags=&seniority=&deactivated=&sort=&group=&page=&size=&layout=), so Back restores
// it and a link is shareable. A row is a real link to /people/<id>: a click
// opens the record as a drawer over this list (the @drawer intercept), and
// cmd-click opens the full page in a new tab. Bulk actions are ONE request
// for the whole selection (POST /api/people/bulk-update).

import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Building2, Download, ExternalLink, LayoutGrid, Link2, List, MessageCircle, MoreHorizontal, Pencil, RotateCcw, Tag, Upload, UserMinus, UserPlus, Users,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Chip } from "@/components/ui/chip";
import { Avatar } from "@/components/ui/avatar-stack";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { useShortcut } from "@/lib/shortcuts";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import {
  activeDirectoryFilters, directoryApiParams, parseDirectoryQuery, type DirectoryGroup, type DirectorySort,
} from "@/lib/people/directory-query";
import { SENIORITY_OPTIONS } from "@/lib/people/seniority";
import { PeoplePickerField, PersonAvatar, personName, type PickPerson } from "@/components/people/person-bits";
import { ImportPeopleModal } from "@/components/people/import-people-modal";

interface Row {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  status: string;
  joinDate: string;
  deletedAt: string | null;
  isAgent: boolean;
  department: { id: string; name: string } | null;
  role: { id: string; title: string; seniority: string | null } | null;
  office: { id: string; name: string; city: string | null } | null;
  manager: PickPerson | null;
  directReports: number;
  tags: Array<{ id: string; name: string }>;
  presenceStatus: string | null;
  presenceUntil: string | null;
  phone?: string | null;
  canEdit: boolean;
}
interface ListResponse {
  data: Row[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean };
  /** Server totals per group over the whole filtered set (key "none" = no value). */
  groups?: Array<{ key: string; count: number }>;
  viewer: { privileged: boolean; canInvite: boolean; canImport: boolean; canExport: boolean; canRemove?: boolean };
}
type Opt = { id: string; label: string };

const SORTS: Array<{ value: DirectorySort; label: string }> = [
  { value: "name", label: "Name A to Z" },
  { value: "recent", label: "Recently joined" },
  { value: "tenure", label: "Longest tenure" },
  { value: "reports", label: "Most reports" },
];
const GROUPS: Array<{ value: DirectoryGroup; label: string }> = [
  { value: "none", label: "None" },
  { value: "department", label: "Department" },
  { value: "office", label: "Office" },
  { value: "title", label: "Job title" },
];
type ColKey = "email" | "office" | "joined" | "phone" | "tags";
const DISPLAY_KEY = "workwrk:directory:columns:v1";

function readColumns(): Record<ColKey, boolean> {
  const base: Record<ColKey, boolean> = { email: true, office: true, joined: true, phone: false, tags: false };
  try {
    const raw = window.localStorage.getItem(DISPLAY_KEY);
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<Record<ColKey, boolean>>) } : base;
  } catch {
    return base;
  }
}

export default function PeopleDirectoryClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { rowVersion } = useOsShell();
  const { boot } = useBoot();
  const datePrefs = useDatePrefs();
  const { openSettings } = useSettingsNav();

  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const privileged = data?.viewer.privileged ?? false;
  const q = useMemo(() => parseDirectoryQuery(new URLSearchParams(sp?.toString() ?? ""), { privileged: true }), [sp]);
  const filters = activeDirectoryFilters(q);
  const [draftQ, setDraftQ] = useState(q.q);
  const [filterOpen, setFilterOpen] = useState(filters > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<Record<ColKey, boolean>>({ email: true, office: true, joined: true, phone: false, tags: false });
  const [importOpen, setImportOpen] = useState(sp?.get("import") === "1");
  const [menu, setMenu] = useState<{ row: Row; anchor: RefObject<HTMLElement | null> } | null>(null);
  const [depts, setDepts] = useState<Opt[]>([]);
  const [roles, setRoles] = useState<Opt[]>([]);
  const [offices, setOffices] = useState<Opt[]>([]);
  const [tags, setTags] = useState<Opt[]>([]);
  const [reportsTo, setReportsTo] = useState<PickPerson | null>(null);
  const [bulkDeptOpen, setBulkDeptOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  // Table or Cards is a renderer, not a view: its own ?layout= key.
  const view = sp?.get("layout") === "cards" ? "cards" : "table";
  const listView = q.view;

  useEffect(() => { const t = setTimeout(() => setColumns(readColumns()), 0); return () => clearTimeout(t); }, []);
  const setColumn = (k: ColKey, on: boolean) => {
    setColumns((c) => {
      const next = { ...c, [k]: on };
      try { window.localStorage.setItem(DISPLAY_KEY, JSON.stringify(next)); } catch { /* a private window keeps it for the visit */ }
      return next;
    });
  };

  // One patch per change, so Clear filters clears every key at once.
  const setParams = useCallback((patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete("page");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  useEffect(() => {
    if (draftQ === q.q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q.q, setParams]);

  const apiQs = useMemo(() => directoryApiParams(q).toString(), [q]);
  const load = useCallback(async () => {
    const r = await apiFetch<ListResponse>(`/api/users?${apiQs}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load the directory"); return; }
    setError(null);
    setData(r.data);
  }, [apiQs]);
  const peopleVersion = rowVersion("people");
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load, peopleVersion]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // A privileged view or filter asked for by someone who cannot hold it:
  // the default view, and the parameter stripped (never a 404).
  useEffect(() => {
    if (!data || data.viewer.privileged) return;
    const strip: Record<string, null> = {};
    if (sp?.get("view") === "removed" || sp?.get("view") === "nomanager") strip.view = null;
    if (sp?.get("deactivated")) strip.deactivated = null;
    if (Object.keys(strip).length) setParams(strip);
  }, [data, sp, setParams]);

  // The filter pickers load when the panel first opens.
  const loadedOpts = useRef(false);
  useEffect(() => {
    if (!filterOpen || loadedOpts.current) return;
    loadedOpts.current = true;
    void (async () => {
      const [d, r, o, t] = await Promise.all([
        apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }),
        apiFetch<Array<{ id: string; title: string }>>("/api/roles", { cache: "no-store" }),
        apiFetch<Array<{ id: string; name: string }> | { data: Array<{ id: string; name: string }> }>("/api/offices", { cache: "no-store" }),
        apiFetch<Array<{ id: string; name: string }>>("/api/tags", { cache: "no-store" }),
      ]);
      if (d.ok && Array.isArray(d.data)) setDepts(d.data.map((x) => ({ id: x.id, label: x.name })));
      if (r.ok && Array.isArray(r.data)) setRoles(r.data.map((x) => ({ id: x.id, label: x.title })));
      if (o.ok) setOffices((Array.isArray(o.data) ? o.data : o.data.data ?? []).map((x) => ({ id: x.id, label: x.name })));
      if (t.ok && Array.isArray(t.data)) setTags(t.data.map((x) => ({ id: x.id, label: x.name })));
    })();
  }, [filterOpen]);
  // The bulk bar's department picker needs the list too.
  useEffect(() => {
    if (!bulkDeptOpen || depts.length) return;
    void apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }).then((d) => { if (d.ok && Array.isArray(d.data)) setDepts(d.data.map((x) => ({ id: x.id, label: x.name }))); });
  }, [bulkDeptOpen, depts.length]);
  useEffect(() => {
    if (!bulkTagOpen || tags.length) return;
    void apiFetch<Array<{ id: string; name: string }>>("/api/tags", { cache: "no-store" }).then((t) => { if (t.ok && Array.isArray(t.data)) setTags(t.data.map((x) => ({ id: x.id, label: x.name }))); });
  }, [bulkTagOpen, tags.length]);

  useShortcut({ id: "people.search", keys: "/", label: "Search people", scope: "page", group: "On this page", run: (e) => {
    e.preventDefault();
    setFilterOpen(true);
    setTimeout(() => document.querySelector<HTMLInputElement>("[data-filter-search]")?.focus(), 0);
  } });

  const clearFilters = () => { setDraftQ(""); setReportsTo(null); setParams({ q: null, dept: null, title: null, office: null, reportsTo: null, tags: null, seniority: null, deactivated: null }); };
  const toggleList = (key: "tags" | "seniority", value: string, on: boolean) => {
    const cur = key === "tags" ? q.tagIds : q.seniority;
    const next = on ? [...new Set([...cur, value])] : cur.filter((x) => x !== value);
    setParams({ [key]: next.length ? next.join(",") : null });
  };

  async function bulk(action: string, payload: Record<string, unknown>, done: (n: number) => string) {
    const userIds = [...selected];
    const r = await apiFetch<{ updated: number; skipped: number }>("/api/people/bulk-update", { method: "POST", json: { userIds, action, payload } });
    if (!r.ok) { toast(r.error || "Couldn't change them", { tone: "danger", action: { label: "Try again", onClick: () => void bulk(action, payload, done) } }); return; }
    toast(`${done(r.data.updated)}${r.data.skipped ? ` · ${r.data.skipped} skipped (not yours to change)` : ""}`);
    setSelected(new Set());
    void load();
  }

  async function restore(row: Row) {
    const r = await apiFetch(`/api/users/${row.id}?restore=true`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't restore them", { tone: "danger" }); return; }
    toast(`Restored ${personName(row)}`, {
      action: {
        label: "Undo",
        onClick: () => { void apiFetch(`/api/users/${row.id}`, { method: "DELETE" }).then((u) => { if (!u.ok) toast(u.error || "Couldn't undo", { tone: "danger" }); void load(); }); },
      },
    });
    void load();
  }

  function exportHref(ids?: string[]) {
    const p = directoryApiParams(q);
    p.delete("page"); p.delete("limit"); p.delete("scope");
    if (ids?.length) p.set("ids", ids.join(","));
    return `/api/users/export?${p}`;
  }

  const rows = data?.data ?? null;
  const talkOn = boot.launcherApps.includes("chat");
  const removedView = listView === "removed";
  const canSelect = !!rows?.some((r) => r.canEdit) && !removedView;

  const columnsDef = useMemo<TableColumn<Row>[]>(() => {
    const cols: TableColumn<Row>[] = [
      { key: "person", label: "Person", title: true, width: "minmax(220px,1.6fr)", render: (r) => (
        <span className={`flex min-w-0 items-center gap-2 ${removedView ? "opacity-70" : ""}`}>
          <PersonAvatar person={r} size={28} />
          <span className={`truncate ${removedView ? "text-ink-2" : ""}`}>{personName(r)}</span>
          {listView === "new" ? <Chip>New</Chip> : null}
          {r.isAgent ? <Chip>Agent</Chip> : null}
          {r.status === "INACTIVE" && !r.deletedAt ? <Chip>Deactivated</Chip> : null}
        </span>
      ) },
      // The row is itself a link, so the cells that go somewhere else are
      // buttons (a link inside a link is invalid HTML).
      { key: "title", label: "Job title", width: "minmax(140px,1fr)", render: (r) => r.role
        ? <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/people/roles/${r.role!.id}`); }} className="truncate text-start hover:underline">{r.role.title}</button>
        : <span className="text-ink-3">No job title</span> },
      { key: "dept", label: "Department", width: "minmax(130px,0.9fr)", hideBelow: 640, render: (r) => r.department
        ? <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setParams({ dept: r.department!.id }); }} className="truncate text-start hover:underline">{r.department.name}</button>
        : <span className="text-ink-3">None</span> },
      { key: "manager", label: "Reports to", width: "minmax(150px,1fr)", hideBelow: 760, render: (r) => r.manager
        ? <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/people/${r.manager!.id}`); }} className="flex min-w-0 items-center gap-1.5 text-start hover:underline"><Avatar person={r.manager} size={20} /><span className="truncate">{personName(r.manager)}</span></button>
        : <span className="text-ink-3">Nobody</span> },
    ];
    if (columns.email) cols.push({ key: "email", label: "Email", width: "minmax(180px,1.2fr)", hideBelow: 1000, render: (r) => <span className="truncate">{r.email}</span> });
    if (columns.phone) cols.push({ key: "phone", label: "Phone", width: "140px", hideBelow: 1000, render: (r) => <span className="truncate tabular-nums">{r.phone ?? ""}</span> });
    if (columns.office) cols.push({ key: "office", label: "Office", width: "120px", hideBelow: 1200, render: (r) => <span className="truncate">{r.office?.city || r.office?.name || ""}</span> });
    if (columns.tags) cols.push({ key: "tags", label: "Tags", width: "minmax(140px,0.8fr)", hideBelow: 1100, render: (r) => (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">{r.tags.map((t) => <Chip key={t.id}>{t.name}</Chip>)}</span>
    ) });
    if (columns.joined) cols.push({ key: "joined", label: removedView ? "Removed" : "Joined", width: "136px", hideBelow: 700, render: (r) => (
      <span className="tabular-nums text-ink-2">{formatDate(removedView && r.deletedAt ? r.deletedAt : r.joinDate, datePrefs, "date")}</span>
    ) });
    return cols;
  }, [columns, datePrefs, listView, removedView, setParams, router]);

  const pg = data?.pagination;
  const footer = pg
    ? {
        total: pg.total,
        noun: removedView ? "removed" : "people",
        from: pg.total === 0 ? 0 : (pg.page - 1) * pg.limit + 1,
        to: Math.min(pg.total, pg.page * pg.limit),
        onPrev: pg.page > 1 ? () => setParams({ page: String(pg.page - 1) }, true) : undefined,
        onNext: pg.hasMore ? () => setParams({ page: String(pg.page + 1) }, true) : undefined,
        pageSize: q.size,
        pageSizes: [40, 100],
        onPageSize: (n: number) => setParams({ size: n === 40 ? null : String(n) }),
      }
    : undefined;

  // Grouped rendering, ONE card: the server sorts by the group first, so a
  // page is runs of the same key, each opened by a 44px header row whose
  // count is the server's total for the group (not the page's run).
  const groupTotals = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.key, g.count])), [data?.groups]);
  const groupOf = useMemo(() => {
    if (q.group === "none") return undefined;
    return (r: Row) => {
      const pick = q.group === "department"
        ? { id: r.department?.id ?? null, label: r.department?.name ?? "No department" }
        : q.group === "office"
          ? { id: r.office?.id ?? null, label: r.office?.name ?? "No office" }
          : { id: r.role?.id ?? null, label: r.role?.title ?? "No job title" };
      const key = pick.id ?? "none";
      return { key, label: pick.label, count: groupTotals.get(key) ?? null };
    };
  }, [q.group, groupTotals]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);

  const rowMenu = (r: Row) => (
    <button
      type="button"
      aria-label={`Actions for ${personName(r)}`}
      aria-haspopup="menu"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ row: r, anchor: { current: e.currentTarget } }); }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );

  const bulkActions = canSelect ? (
    <>
      <div className="relative">
        <button type="button" onClick={() => setBulkDeptOpen((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink hover:bg-hover"><Building2 className="h-4 w-4" aria-hidden />Change department</button>
        <Picker open={bulkDeptOpen} onClose={() => setBulkDeptOpen(false)} side="top" ariaLabel="Change department" searchPlaceholder="Search departments"
          sections={[{ options: depts.map((d) => ({ value: d.id, label: d.label })) }]}
          onSelect={(v) => { setBulkDeptOpen(false); const d = depts.find((x) => x.id === v); void bulk("change_department", { departmentId: v }, (n) => `${n} ${n === 1 ? "person" : "people"} moved to ${d?.label ?? "the department"}`); }}
          className="absolute bottom-10 start-0 z-50" />
      </div>
      <div className="relative">
        <button type="button" onClick={() => setBulkTagOpen((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink hover:bg-hover"><Tag className="h-4 w-4" aria-hidden />Add tag</button>
        <Picker open={bulkTagOpen} onClose={() => setBulkTagOpen(false)} side="top" ariaLabel="Add tag" searchPlaceholder="Search tags" emptyLabel="No tags yet. Create them in Settings."
          sections={[{ options: tags.map((t) => ({ value: t.id, label: t.label })) }]}
          onSelect={(v) => { setBulkTagOpen(false); const t = tags.find((x) => x.id === v); void bulk("add_tag", { tagIds: [v] }, (n) => `Tagged ${n} ${n === 1 ? "person" : "people"} ${t?.label ?? ""}`.trim()); }}
          className="absolute bottom-10 start-0 z-50" />
      </div>
      {data?.viewer.canExport ? (
        <button type="button" onClick={() => { window.location.href = exportHref([...selected]); }} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink hover:bg-hover"><Download className="h-4 w-4" aria-hidden />Export selected</button>
      ) : null}
    </>
  ) : undefined;

  const table = (list: Row[] | null, withFooter: boolean) => (
    <TableCard
      ariaLabel="People"
      columns={columnsDef}
      rows={list}
      rowKey={(r) => r.id}
      rowHref={(r) => `/people/${r.id}`}
      rowMenu={removedView
        ? (r) => (data?.viewer.privileged ? <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void restore(r); }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Restore</button> : null)
        : rowMenu}
      selectable={canSelect}
      isRowSelectable={(r) => r.canEdit}
      selected={selected}
      onSelectedChange={setSelected}
      bulkActions={bulkActions}
      footer={withFooter ? footer : undefined}
      groupOf={groupOf}
      collapsedGroups={collapsed}
      onToggleGroup={toggleGroup}
      empty={
        filters > 0
          ? <span className="text-row text-ink-2">No one matches · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>
          : <span className="text-row text-ink-2">{removedView ? "Nobody has been removed" : listView === "nomanager" ? "Everyone has a manager" : listView === "new" ? "Nobody joined in the last 90 days" : "No one here yet"}</span>
      }
    />
  );

  const noOneAtAll = rows && rows.length === 0 && filters === 0 && listView === "all";

  return (
    <>
      <Breadcrumb items={[{ label: "Directory" }]} />
      <OsPageHeader
        title="Directory"
        views={
          <>
            <ViewTab label="All" active={listView === "all"} onClick={() => setParams({ view: null })} />
            <ViewTab label="New" active={listView === "new"} onClick={() => setParams({ view: "new" })} />
            {privileged ? <ViewTab label="No manager" active={listView === "nomanager"} onClick={() => setParams({ view: "nomanager" })} /> : null}
            {privileged ? <ViewTab label="Removed" active={listView === "removed"} onClick={() => setParams({ view: "removed" })} /> : null}
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filters },
          sort: { onClick: () => setSortOpen((v) => !v), label: q.sort === "name" ? "Sort" : SORTS.find((s) => s.value === q.sort)?.label, active: q.sort !== "name" },
          switcher: { value: view, options: [{ key: "table", label: "Table", icon: List }, { key: "cards", label: "Cards", icon: LayoutGrid }], onChange: (k) => setParams({ layout: k === "cards" ? "cards" : null }, true) },
          primary: data?.viewer.canInvite ? { label: "Invite", icon: UserPlus, onClick: () => openSettings("/settings/members?invite=1") } : undefined,
          menu: [
            { label: "Email", checked: columns.email, keepOpen: true, onClick: () => setColumn("email", !columns.email) },
            { label: "Office", checked: columns.office, keepOpen: true, onClick: () => setColumn("office", !columns.office) },
            { label: "Joined", checked: columns.joined, keepOpen: true, onClick: () => setColumn("joined", !columns.joined) },
            ...(privileged ? [{ label: "Phone", checked: columns.phone, keepOpen: true, onClick: () => setColumn("phone", !columns.phone) }] : []),
            { label: "Tags", checked: columns.tags, keepOpen: true, onClick: () => setColumn("tags", !columns.tags) },
            { separator: true as const },
            ...GROUPS.map((g) => ({ label: `Group by ${g.label.toLowerCase()}`, checked: q.group === g.value, onClick: () => setParams({ group: g.value === "none" ? null : g.value }) })),
            ...(data?.viewer.canImport || data?.viewer.canExport ? [{ separator: true as const }] : []),
            ...(data?.viewer.canImport ? [{ label: "Import people", icon: Upload, onClick: () => setImportOpen(true) }] : []),
            ...(data?.viewer.canExport ? [{ label: "Export CSV", icon: Download, onClick: () => { window.location.href = exportHref(); } }] : []),
            ...(data?.viewer.canImport ? [{ label: "Manage members", icon: ExternalLink, onClick: () => openSettings("/settings/members") }] : []),
          ],
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort people" selected={q.sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(v) => { setSortOpen(false); setParams({ sort: v === "name" ? null : v }); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="people"
          activeCount={filters}
          onClearAll={clearFilters}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search people" }}
        >
          <FilterGroup label="Reports to">
            <PeoplePickerField
              ariaLabel="Reports to"
              value={q.managerId ? [q.managerId] : []}
              people={reportsTo ? [reportsTo] : []}
              placeholder="Anyone"
              onChange={(ids, picked) => { setReportsTo(picked[0] ?? null); setParams({ reportsTo: ids[0] ?? null }); }}
            />
          </FilterGroup>
          {depts.length ? (
            <FilterGroup label="Department">
              {depts.map((d) => <FilterRow key={d.id} label={d.label} checked={q.departmentId === d.id} onCheckedChange={(on) => setParams({ dept: on ? d.id : null })} />)}
            </FilterGroup>
          ) : null}
          {roles.length ? (
            <FilterGroup label="Job title">
              {roles.map((r) => <FilterRow key={r.id} label={r.label} checked={q.roleId === r.id} onCheckedChange={(on) => setParams({ title: on ? r.id : null })} />)}
            </FilterGroup>
          ) : null}
          {offices.length ? (
            <FilterGroup label="Office">
              {offices.map((o) => <FilterRow key={o.id} label={o.label} checked={q.officeId === o.id} onCheckedChange={(on) => setParams({ office: on ? o.id : null })} />)}
            </FilterGroup>
          ) : null}
          {tags.length ? (
            <FilterGroup label="Tags">
              {tags.map((t) => <FilterRow key={t.id} label={t.label} checked={q.tagIds.includes(t.id)} onCheckedChange={(on) => toggleList("tags", t.id, on)} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Seniority">
            {SENIORITY_OPTIONS.map((s) => <FilterRow key={s.value} label={s.label} checked={q.seniority.includes(s.value)} onCheckedChange={(on) => toggleList("seniority", s.value, on)} />)}
          </FilterGroup>
          {privileged ? (
            <FilterGroup label="Status">
              <FilterRow label="Deactivated" checked={q.deactivated} onCheckedChange={(on) => setParams({ deactivated: on ? "1" : null })} />
            </FilterGroup>
          ) : null}
        </FilterPanel>
        <div className="min-w-0 flex-1">
          {error && !rows ? (
            <OsEmptyView variant="error" title="Couldn't load the directory" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : noOneAtAll ? (
            <OsEmptyView title="No one here yet" action={data?.viewer.canInvite ? { label: "Invite your team", onClick: () => openSettings("/settings/members?invite=1") } : undefined} />
          ) : view === "cards" && rows ? (
            <div className="flex flex-col gap-3">
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {rows.map((r) => (
                  <li key={r.id} className="h-full">
                    <Link href={`/people/${r.id}`} className="flex h-full items-center gap-3 rounded-lg border border-line bg-raised p-3 hover:bg-hover">
                      <PersonAvatar person={r} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-row font-medium text-ink">{personName(r)}</span>
                        <span className="block truncate text-sm text-ink-2">{r.role?.title ?? "No job title"}</span>
                        {r.department ? <span className="mt-1 inline-flex"><Chip>{r.department.name}</Chip></span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {footer ? (
                <div className="flex items-center justify-between text-sm text-ink-2">
                  <span className="font-medium">Total {footer.noun} {footer.total}</span>
                  <span className="flex items-center gap-2">
                    {footer.from} to {footer.to}
                    <button type="button" disabled={!footer.onPrev} onClick={footer.onPrev} className="h-8 rounded-md px-2 hover:bg-hover disabled:opacity-40">Previous</button>
                    <button type="button" disabled={!footer.onNext} onClick={footer.onNext} className="h-8 rounded-md px-2 hover:bg-hover disabled:opacity-40">Next</button>
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            table(rows, true)
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${personName(menu.row)}`}>
            <MenuItem icon={Users} label="Open" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/${id}`); }} />
            <MenuItem icon={Link2} label="Copy link" onClick={() => {
              const id = menu.row.id; setMenu(null);
              void navigator.clipboard.writeText(`${window.location.origin}/people/${id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
            }} />
            {privileged && menu.row.canEdit && !menu.row.deletedAt ? (
              <MenuItem icon={Pencil} label="Edit details" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/${id}?edit=details`); }} />
            ) : null}
            {talkOn && menu.row.id !== boot.viewer.id ? (
              <MenuItem icon={MessageCircle} label="Message" onClick={() => {
                const id = menu.row.id; setMenu(null);
                void apiFetch<{ id?: string }>("/api/conversations", { method: "POST", json: { type: "DM", memberIds: [id] } }).then((r) => { if (r.ok && r.data.id) router.push(`/tlk/${r.data.id}`); else toast("Couldn't open the conversation", { tone: "danger" }); });
              }} />
            ) : null}
            {data?.viewer.canRemove && menu.row.id !== boot.viewer.id && !menu.row.deletedAt ? (
              <>
                <MenuSeparator />
                <MenuItem icon={UserMinus} destructive label="Remove" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/${id}?edit=remove`); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}
      {importOpen ? (
        <ImportPeopleModal
          onClose={() => { setImportOpen(false); if (sp?.get("import")) setParams({ import: null }, true); }}
          onImported={() => void load()}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">{data ? `${data.pagination.total} people` : ""}</span>
    </>
  );
}
