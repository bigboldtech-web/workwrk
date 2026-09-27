"use client";

// Teams > My team (spec-teams-people /team).
//
//   views     All · Direct reports (only when the viewer has indirect
//             reports too) · Needs attention
//   toolbar   Filter (search, Department, Job title, Manager for org-wide
//             viewers, Has no KRAs, Overdue work), Sort (Name, Most open
//             work, Most overdue, Last active), "..." (Display columns,
//             Export CSV for Owner and Admin). No blue button: nothing is
//             created here.
//   body      Needs your attention (only when a count is not zero), then
//             the "What everyone is working on" table. A row opens the
//             person drawer; "Working on" opens the task drawer.
//
// URL state: ?view=&q=&dept=&title=&manager=&noKras=&overdue=&sort=&page=.
// Refetches on focus, on rowVersion("people") and on workwrk:items-changed.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Download, ListChecks, Mail, MessageCircle, MoreHorizontal, Users } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { TableCard, type TableColumn, type TableFooter } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { AttentionQueue } from "@/components/team/attention-queue";
import { PeoplePickerField, PersonAvatar, ToneChip, personName, type PickPerson } from "@/components/people/person-bits";
import { apiFetch } from "@/lib/api-fetch";
import { formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useShortcut } from "@/lib/shortcuts";
import { attentionRows, parseTeamSort, type AttentionCounts, type TeamSort } from "@/lib/people/team-work";

interface Row {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatar: string | null;
  role: { id: string; title: string } | null;
  department: { id: string; name: string } | null;
  presenceStatus: string | null;
  presenceUntil: string | null;
  open: number;
  doneThisWeek: number;
  overdue: number;
  workingOn: { id: string; title: string; board: { id: string; name: string } } | null;
  lastActive: string | null;
  direct: boolean;
  canRecord: boolean;
}
interface ListResponse {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  viewer: { orgWide: boolean; orgName: string; hasIndirect: boolean; canExport: boolean };
}
type Opt = { id: string; label: string };

const SORTS: Array<{ value: TeamSort; label: string }> = [
  { value: "name", label: "Name" },
  { value: "open", label: "Most open work" },
  { value: "overdue", label: "Most overdue" },
  { value: "active", label: "Last active" },
];
type ColKey = "workingOn" | "lastActive" | "overdue";
const DISPLAY_KEY = "workwrk:my-team:columns:v1";
const COL_DEFAULT: Record<ColKey, boolean> = { workingOn: true, lastActive: true, overdue: true };

function readColumns(): Record<ColKey, boolean> {
  try {
    const raw = window.localStorage.getItem(DISPLAY_KEY);
    return raw ? { ...COL_DEFAULT, ...(JSON.parse(raw) as Partial<Record<ColKey, boolean>>) } : COL_DEFAULT;
  } catch {
    return COL_DEFAULT;
  }
}

export default function TeamClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { rowVersion } = useOsShell();
  const { boot } = useBoot();
  const datePrefs = useDatePrefs();

  const view = sp?.get("view") === "direct" ? "direct" : sp?.get("view") === "needs-attention" ? "needs-attention" : "all";
  const q = sp?.get("q") ?? "";
  const dept = sp?.get("dept") ?? "";
  const title = sp?.get("title") ?? "";
  const manager = sp?.get("manager") ?? "";
  const noKras = sp?.get("noKras") === "1";
  const overdue = sp?.get("overdue") === "1";
  const sort = parseTeamSort(sp?.get("sort"));
  const page = Math.max(1, Number(sp?.get("page")) || 1);
  const filters = [q, dept, title, manager].filter(Boolean).length + (noKras ? 1 : 0) + (overdue ? 1 : 0);

  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attention, setAttention] = useState<(AttentionCounts & { chainWide: boolean }) | null>(null);
  const [draftQ, setDraftQ] = useState(q);
  const [filterOpen, setFilterOpen] = useState(filters > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [columns, setColumns] = useState<Record<ColKey, boolean>>(COL_DEFAULT);
  const [menu, setMenu] = useState<{ row: Row; anchor: RefObject<HTMLElement | null> } | null>(null);
  const [depts, setDepts] = useState<Opt[]>([]);
  const [roles, setRoles] = useState<Opt[]>([]);
  const [managerPick, setManagerPick] = useState<PickPerson | null>(null);

  useEffect(() => { const t = setTimeout(() => setColumns(readColumns()), 0); return () => clearTimeout(t); }, []);
  const setColumn = (k: ColKey, on: boolean) => {
    setColumns((c) => {
      const next = { ...c, [k]: on };
      try { window.localStorage.setItem(DISPLAY_KEY, JSON.stringify(next)); } catch { /* kept for this visit */ }
      return next;
    });
  };

  const setParams = useCallback((patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete("page");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);

  const apiQs = useMemo(() => {
    const p = new URLSearchParams();
    if (view !== "all") p.set("view", view);
    if (q) p.set("q", q);
    if (dept) p.set("dept", dept);
    if (title) p.set("title", title);
    if (manager) p.set("manager", manager);
    if (noKras) p.set("noKras", "1");
    if (overdue) p.set("overdue", "1");
    if (sort !== "name") p.set("sort", sort);
    p.set("page", String(page));
    p.set("limit", "40");
    return p.toString();
  }, [view, q, dept, title, manager, noKras, overdue, sort, page]);

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([
      apiFetch<ListResponse>(`/api/team/members-work?${apiQs}`, { cache: "no-store" }),
      apiFetch<AttentionCounts & { chainWide: boolean }>("/api/team/attention", { cache: "no-store" }),
    ]);
    if (!r.ok) { setError(r.error || "Couldn't load your team"); return; }
    setError(null);
    setData(r.data);
    if (a.ok) setAttention(a.data);
  }, [apiQs]);
  const peopleVersion = rowVersion("people");
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load, peopleVersion]);
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener("focus", again);
    window.addEventListener("workwrk:items-changed", again);
    return () => { window.removeEventListener("focus", again); window.removeEventListener("workwrk:items-changed", again); };
  }, [load]);

  // Direct reports is a view only a viewer with indirect reports holds:
  // anyone else asking for it gets All, the parameter stripped.
  useEffect(() => {
    if (data && view === "direct" && !data.viewer.hasIndirect) setParams({ view: null });
  }, [data, view, setParams]);
  useEffect(() => {
    if (data && manager && !data.viewer.orgWide) setParams({ manager: null });
  }, [data, manager, setParams]);

  const loadedOpts = useRef(false);
  useEffect(() => {
    if (!filterOpen || loadedOpts.current) return;
    loadedOpts.current = true;
    void (async () => {
      const [d, r] = await Promise.all([
        apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }),
        apiFetch<Array<{ id: string; title: string }>>("/api/roles", { cache: "no-store" }),
      ]);
      if (d.ok && Array.isArray(d.data)) setDepts(d.data.map((x) => ({ id: x.id, label: x.name })));
      if (r.ok && Array.isArray(r.data)) setRoles(r.data.map((x) => ({ id: x.id, label: x.title })));
    })();
  }, [filterOpen]);

  useShortcut({ id: "team.search", keys: "/", label: "Search my team", scope: "page", group: "On this page", run: (e) => {
    e.preventDefault();
    setFilterOpen(true);
    setTimeout(() => document.querySelector<HTMLInputElement>("[data-filter-search]")?.focus(), 0);
  } });

  const clearFilters = () => { setDraftQ(""); setManagerPick(null); setParams({ q: null, dept: null, title: null, manager: null, noKras: null, overdue: null }); };

  const talkOn = boot.launcherApps.includes("chat");
  const rows = data?.rows ?? null;
  const queue = attention ? attentionRows(attention, { chainWide: attention.chainWide }) : [];

  const columnsDef = useMemo<TableColumn<Row>[]>(() => {
    const cols: TableColumn<Row>[] = [
      { key: "person", label: "Person", title: true, width: "minmax(200px,1.4fr)", render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar person={r} size={28} />
          <span className="truncate">{personName(r)}</span>
        </span>
      ) },
      { key: "title", label: "Job title", width: "minmax(130px,1fr)", hideBelow: 700, render: (r) => r.role ? <span className="truncate">{r.role.title}</span> : <span className="text-ink-3">No job title</span> },
      { key: "open", label: "Open", width: "72px", numeric: true, align: "end", render: (r) => <span className="tabular-nums">{r.open}</span> },
      { key: "done", label: "Done this week", width: "120px", numeric: true, align: "end", hideBelow: 900, render: (r) => <span className="tabular-nums">{r.doneThisWeek}</span> },
    ];
    if (columns.overdue) cols.push({ key: "overdue", label: "Overdue", width: "112px", render: (r) => r.overdue > 0
      ? <ToneChip tone="danger" label={`${r.overdue} overdue`} />
      : <span className="tabular-nums text-ink-2">0</span> });
    if (columns.workingOn) cols.push({ key: "working", label: "Working on", width: "minmax(180px,1.6fr)", hideBelow: 820, render: (r) => r.workingOn ? (
      <span className="flex min-w-0 items-center gap-1.5">
        {/* The row is a link to the person, so these go somewhere else as buttons. */}
        <button type="button" title={`${r.workingOn.title} · ${r.workingOn.board.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/item/${r.workingOn!.id}`); }} className="min-w-0 truncate text-start hover:underline">{r.workingOn.title}</button>
        {r.open > 1 ? (
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/people/${r.id}#working-on`); }} className="shrink-0 rounded px-1 text-xs font-medium text-ink-2 hover:bg-hover hover:text-ink" aria-label={`${r.open - 1} more open items for ${personName(r)}`}>+{r.open - 1}</button>
        ) : null}
      </span>
    ) : <span className="text-ink-3">Nothing open</span> });
    if (columns.lastActive) cols.push({ key: "active", label: "Last active", width: "120px", hideBelow: 1040, render: (r) => <span className="text-ink-2">{r.lastActive ? formatRelative(r.lastActive, datePrefs) : "Not yet"}</span> });
    return cols;
  }, [columns, datePrefs, router]);

  const footer = data
    ? {
        total: data.total,
        noun: data.viewer.orgWide ? `people · Everyone at ${data.viewer.orgName || "your workspace"}` : "people",
        from: data.total === 0 ? 0 : (data.page - 1) * data.limit + 1,
        to: Math.min(data.total, data.page * data.limit),
        onPrev: data.page > 1 ? () => setParams({ page: String(data.page - 1) }, true) : undefined,
        onNext: data.hasMore ? () => setParams({ page: String(data.page + 1) }, true) : undefined,
      }
    : undefined;

  const nobodyHasWork = !!rows && rows.length > 0 && filters === 0 && view === "all" && rows.every((r) => r.open === 0) && data?.total === rows.length;

  return (
    <>
      <Breadcrumb items={[{ label: "My team" }]} />
      <OsPageHeader
        title="My team"
        views={
          <>
            <ViewTab label="All" active={view === "all"} onClick={() => setParams({ view: null })} />
            {data?.viewer.hasIndirect ? <ViewTab label="Direct reports" active={view === "direct"} onClick={() => setParams({ view: "direct" })} /> : null}
            <ViewTab label="Needs attention" active={view === "needs-attention"} onClick={() => setParams({ view: "needs-attention" })} />
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: filters },
          sort: { onClick: () => setSortOpen((v) => !v), label: sort === "name" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "name" },
          menu: [
            { label: "Working on", checked: columns.workingOn, keepOpen: true, onClick: () => setColumn("workingOn", !columns.workingOn) },
            { label: "Last active", checked: columns.lastActive, keepOpen: true, onClick: () => setColumn("lastActive", !columns.lastActive) },
            { label: "Overdue", checked: columns.overdue, keepOpen: true, onClick: () => setColumn("overdue", !columns.overdue) },
            ...(data?.viewer.canExport
              ? [{ separator: true as const }, { label: "Export CSV", icon: Download, onClick: () => { const p = new URLSearchParams(apiQs); p.delete("page"); p.delete("limit"); p.set("format", "csv"); window.location.href = `/api/team/members-work?${p}`; } }]
              : []),
          ],
        }}
      />
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort my team" selected={sort}
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
          {depts.length ? (
            <FilterGroup label="Department">
              {depts.map((d) => <FilterRow key={d.id} label={d.label} checked={dept === d.id} onCheckedChange={(on) => setParams({ dept: on ? d.id : null })} />)}
            </FilterGroup>
          ) : null}
          {roles.length ? (
            <FilterGroup label="Job title">
              {roles.map((r) => <FilterRow key={r.id} label={r.label} checked={title === r.id} onCheckedChange={(on) => setParams({ title: on ? r.id : null })} />)}
            </FilterGroup>
          ) : null}
          {data?.viewer.orgWide ? (
            <FilterGroup label="Manager">
              <PeoplePickerField
                ariaLabel="Manager"
                value={manager ? [manager] : []}
                people={managerPick ? [managerPick] : []}
                placeholder="Anyone"
                onChange={(ids, picked) => { setManagerPick(picked[0] ?? null); setParams({ manager: ids[0] ?? null }); }}
              />
            </FilterGroup>
          ) : null}
          <FilterGroup label="Show only">
            <li className="flex h-9 items-center justify-between gap-3 px-2 text-sm text-ink">
              <span>Has no KRAs</span>
              <Switch checked={noKras} onChange={(v) => setParams({ noKras: v ? "1" : null })} aria-label="Has no KRAs" />
            </li>
            <li className="flex h-9 items-center justify-between gap-3 px-2 text-sm text-ink">
              <span>Overdue work</span>
              <Switch checked={overdue} onChange={(v) => setParams({ overdue: v ? "1" : null })} aria-label="Overdue work" />
            </li>
          </FilterGroup>
        </FilterPanel>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <AttentionQueue rows={queue} />
          <h2 className="m-0 -mb-2 text-base font-semibold text-ink">What everyone is working on</h2>
          {error && !rows ? (
            <OsEmptyView variant="error" title="Couldn't load your team" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : nobodyHasWork ? (
            <>
              <TeamTable rows={rows} columns={columnsDef} footer={footer} onMenu={(row, anchor) => setMenu({ row, anchor })} empty={null} />
              <p className="text-sm text-ink-2">Nobody on your team has open work</p>
            </>
          ) : (
            <TeamTable
              rows={rows}
              columns={columnsDef}
              footer={footer}
              onMenu={(row, anchor) => setMenu({ row, anchor })}
              empty={
                filters > 0 || view !== "all"
                  ? <span className="text-row text-ink-2">No one matches · <button type="button" className="text-brand-deep hover:underline" onClick={() => { setDraftQ(""); setManagerPick(null); setParams({ view: null, q: null, dept: null, title: null, manager: null, noKras: null, overdue: null }); }}>Clear filters</button></span>
                  : <span className="text-row text-ink-2">Nobody on your team has open work</span>
              }
            />
          )}
        </div>
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={232} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${personName(menu.row)}`}>
            <MenuItem icon={Users} label="Open profile" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/${id}`); }} />
            {talkOn && menu.row.id !== boot.viewer.id ? (
              <MenuItem icon={MessageCircle} label="Message" onClick={() => {
                const id = menu.row.id; setMenu(null);
                void apiFetch<{ id?: string }>("/api/conversations", { method: "POST", json: { type: "DM", memberIds: [id] } }).then((r) => { if (r.ok && r.data.id) router.push(`/tlk/${r.data.id}`); else toast("Couldn't open the conversation", { tone: "danger" }); });
              }} />
            ) : null}
            {menu.row.email ? (
              <MenuItem icon={Mail} label="Email" onClick={() => { const e = menu.row.email; setMenu(null); window.location.href = `mailto:${e}`; }} />
            ) : null}
            {menu.row.workingOn ? (
              <MenuItem icon={ListChecks} label="Open their latest task" onClick={() => { const id = menu.row.workingOn!.id; setMenu(null); router.push(`/item/${id}`); }} />
            ) : null}
            {menu.row.canRecord ? (
              <MenuItem icon={ClipboardList} label="Record numbers" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/${id}?tab=kras&record=1`); }} />
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}
      <span className="sr-only" aria-live="polite">{data ? `${data.total} people` : ""}</span>
    </>
  );
}

function TeamTable({ rows, columns, footer, onMenu, empty }: {
  rows: Row[] | null;
  columns: TableColumn<Row>[];
  footer: TableFooter | undefined;
  onMenu: (row: Row, anchor: RefObject<HTMLElement | null>) => void;
  empty: React.ReactNode;
}) {
  return (
    <TableCard
      ariaLabel="What everyone is working on"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      rowHref={(r) => `/people/${r.id}`}
      rowMenu={(r) => (
        <button
          type="button"
          aria-label={`Actions for ${personName(r)}`}
          aria-haspopup="menu"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(r, { current: e.currentTarget }); }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      footer={footer}
      empty={empty}
    />
  );
}
