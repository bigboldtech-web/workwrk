"use client";

// KRAs & KPIs (spec-goals section 2 /kra-kpi): the library of what each job
// title is responsible for (KRAs) and how it is measured (KPIs). Every Member
// reads; the People team and admins (the kras.create / kras.edit
// permissions the routes ask) create and file.
//
//   Views row   Job titles (/kra-kpi) · Needs a job title (?view=orphans,
//               editors only, with its count)
//   Toolbar     Filter (search across job titles, KRAs and KPIs; Department;
//               Seniority; Has no KRAs yet; Weights not 100%) · Sort · the
//               one blue New KRA with New KPI on its chevron ("Which KRA?"
//               first, then the KPI dialog) · "..." Display > Show job
//               titles with no KRAs (home.kraKpi.showEmptyTitles)
//   Body        one TableCard grouped by department; a row opens the job
//               title page (/people/roles/[id]) where KRAs and KPIs are
//               edited. The orphans view files each KRA to a job title
//               (Attach) or clears it (Not a KRA), never silently.
//
// ?new=kra (and the retired ?new=1) opens New KRA; ?new=kpi opens Which KRA?
// then New KPI. Closing clears the param, so the Teams "+" works again.
// Moved, not dropped: the four stat tiles are the views row count and the
// footer; the "Inside job titles" matches are the Filter search, shown as a
// suffix on the matched job title's own row.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Copy, ExternalLink, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker, type PickerOption, type PickerSectionDef } from "@/components/ui/picker";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { ToneChip } from "@/components/people/person-bits";
import { KraDialog } from "@/components/alignment/kra-dialog";
import { KpiDialog } from "@/components/alignment/kpi-dialog";
import { usePermission } from "@/hooks/use-permission";
import { useRole } from "@/hooks/use-role";
import { jobTitleWriterByFacts } from "@/lib/people/job-title-access";
import { NOT_SET, SENIORITY_OPTIONS, isSetSeniority, seniorityLabel } from "@/lib/people/seniority";
import { kraKpiSurfacePrefs, type KraKpiSurfacePrefs } from "@/lib/people-prefs";
import { apiFetch } from "@/lib/api-fetch";

type ApiRole = {
  id: string;
  title: string;
  level?: string;
  seniority?: string;
  department?: { id: string; name: string } | null;
  _count?: { users?: number; kraTemplates?: number };
  kpiCount?: number;
  weightTotal?: number;
};

type ApiKra = {
  id: string;
  name: string;
  roleId?: string | null;
  role?: { id: string; title: string } | null;
  kpis?: { id: string; name: string }[];
};

type OrphanKra = {
  id: string;
  name: string;
  description?: string | null;
  kpis: { id: string; name: string; isNorthStar?: boolean }[];
  activeAssignees: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null }[];
  totalAssignments: number;
  suggestedRole: { id: string; title: string } | null;
};

type Sort = "title" | "people" | "kras" | "department";
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "title", label: "Job title A to Z" },
  { value: "people", label: "People" },
  { value: "kras", label: "KRAs" },
  { value: "department", label: "Department" },
];
const NO_DEPT = "__none";

/** The "Which KRA?" rows, grouped by job title (orphans last). */
function kraPickerSections(kras: ApiKra[]): PickerSectionDef[] {
  const byRole = new Map<string, PickerOption[]>();
  for (const k of kras) {
    const label = k.role?.title ?? "Needs a job title";
    if (!byRole.has(label)) byRole.set(label, []);
    byRole.get(label)!.push({ value: k.id, label: k.name, keywords: label });
  }
  return Array.from(byRole.entries())
    .sort(([a], [b]) => (a === "Needs a job title" ? 1 : b === "Needs a job title" ? -1 : a.localeCompare(b)))
    .map(([label, options]) => ({ label, options }));
}

/** Every KRA in the library, page by page (no silent 500 cap). */
async function loadLibrary(): Promise<ApiKra[]> {
  const out: ApiKra[] = [];
  for (let page = 1; page <= 40; page++) {
    const r = await apiFetch<{ data: ApiKra[]; pagination?: { totalPages?: number; total?: number } }>(`/api/kras?limit=500&page=${page}&scope=library`, { cache: "no-store" });
    if (!r.ok) break;
    const rows = Array.isArray(r.data?.data) ? r.data.data : [];
    out.push(...rows);
    const pages = r.data?.pagination?.totalPages ?? 1;
    if (page >= pages || rows.length === 0) break;
  }
  return out;
}

export default function KraKpiPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { prefs, patchPrefs, rowVersion } = useOsShell();
  const { boot } = useBoot();
  const canCreate = usePermission("kras", "create") === true;
  const { isManager: legacyManagerTier } = useRole();
  const canCreateTitle = legacyManagerTier || jobTitleWriterByFacts(boot.viewer);

  const [roles, setRoles] = useState<ApiRole[] | null>(null);
  const [kras, setKras] = useState<ApiKra[]>([]);
  const [orphans, setOrphans] = useState<OrphanKra[] | null>(null); // null = not an editor
  const [orphansKnown, setOrphansKnown] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [depts, setDepts] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<string[]>([]);
  const [noKras, setNoKras] = useState(false);
  const [weightsOff, setWeightsOff] = useState(false);
  const [sort, setSort] = useState<Sort>("title");
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = useState<{ roleId?: string } | null>(null);
  const [kraPickOpen, setKraPickOpen] = useState(false);
  const [kpiFor, setKpiFor] = useState<{ id: string; name: string } | null>(null);
  const [menu, setMenu] = useState<{ row: ApiRole; anchor: RefObject<HTMLElement | null> } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stored = kraKpiSurfacePrefs(prefs.home);
  const [localPrefs, setLocalPrefs] = useState<Partial<KraKpiSurfacePrefs>>({});
  const display = { ...stored, ...localPrefs };
  const setDisplay = (patch: Partial<KraKpiSurfacePrefs>) => {
    setLocalPrefs((l) => ({ ...l, ...patch }));
    void patchPrefs({ home: { kraKpi: patch } }).then((ok) => { if (!ok) toast("Couldn't save that setting. It applies until you leave.", { tone: "danger" }); });
  };

  const view = sp?.get("view") === "orphans" ? "orphans" : "titles";
  const newParam = sp?.get("new") ?? null;
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const load = useCallback(async () => {
    const r = await apiFetch<ApiRole[] | { data: ApiRole[] }>("/api/roles?fresh=1", { cache: "no-store" });
    if (!r.ok) { setLoadError(`${r.error || "Couldn't load job titles"}${r.status ? ` (${r.status})` : ""}`); return; }
    setLoadError(null);
    setRoles(Array.isArray(r.data) ? r.data : r.data.data ?? []);
    void loadLibrary().then(setKras).catch(() => {});
    // The route answers { orphans, total } at the top level; a 403 means
    // the viewer is not an editor, and the view does not render.
    void apiFetch<{ orphans: OrphanKra[] }>("/api/kras/orphans", { cache: "no-store" }).then((o) => { setOrphans(o.ok ? o.data.orphans ?? [] : null); setOrphansKnown(true); });
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const v = rowVersion("kra-kpi");
  useEffect(() => { if (v <= 0) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [v, load]);
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // A plain Member on a pasted ?view=orphans: the Job titles view, the
  // parameter stripped and one notice line (access 5.5 rule 4).
  useEffect(() => {
    if (!(view === "orphans" && orphansKnown && orphans === null)) return;
    const t = setTimeout(() => {
      setNotice("Only the People team and admins file KRAs to job titles.");
      setParams({ view: null });
    }, 0);
    return () => clearTimeout(t);
  }, [view, orphansKnown, orphans, setParams]);

  // The armed latch: ?new=kra|1|kpi opens once per arrival; closing clears it.
  const armed = useRef<string | null>(null);
  useEffect(() => {
    if (!canCreate || !newParam || armed.current === newParam) return;
    armed.current = newParam;
    const t = setTimeout(() => {
      if (newParam === "kra" || newParam === "1") setNewOpen({});
      else if (newParam === "kpi") setKraPickOpen(true);
    }, 0);
    return () => clearTimeout(t);
  }, [newParam, canCreate]);
  const clearNew = useCallback(() => { armed.current = null; if (newParam) setParams({ new: null }); }, [newParam, setParams]);

  const needle = q.trim().toLowerCase();
  // KRA and KPI name matches, per job title, for the Filter search.
  const matchesByRole = useMemo(() => {
    const m = new Map<string, string>();
    if (!needle) return m;
    for (const k of kras) {
      const rid = k.roleId ?? k.role?.id;
      if (!rid || m.has(rid)) continue;
      if (k.name.toLowerCase().includes(needle)) { m.set(rid, k.name); continue; }
      const kpi = (k.kpis ?? []).find((p) => p.name.toLowerCase().includes(needle));
      if (kpi) m.set(rid, kpi.name);
    }
    return m;
  }, [kras, needle]);

  const deptOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roles ?? []) m.set(r.department?.id ?? NO_DEPT, r.department?.name ?? "No department");
    return [...m.entries()].sort((a, b) => (a[0] === NO_DEPT ? 1 : b[0] === NO_DEPT ? -1 : a[1].localeCompare(b[1])));
  }, [roles]);

  const shown = useMemo(() => {
    if (!roles) return null;
    let list = roles.filter((r) => {
      const kraCount = r._count?.kraTemplates ?? 0;
      if (!display.showEmptyTitles && kraCount === 0 && !noKras) return false;
      if (depts.length && !depts.includes(r.department?.id ?? NO_DEPT)) return false;
      // "Not set" matches an empty or legacy value, which no other row covers.
      if (seniority.length) {
        const lv = r.seniority ?? r.level ?? "";
        if (!(isSetSeniority(lv) ? seniority.includes(lv) : seniority.includes("__notset"))) return false;
      }
      if (noKras && kraCount > 0) return false;
      if (weightsOff && (kraCount === 0 || (r.weightTotal ?? 0) === 100 || (r.weightTotal ?? 0) === 0)) return false;
      if (needle && !(r.title.toLowerCase().includes(needle) || matchesByRole.has(r.id))) return false;
      return true;
    });
    list = [...list].sort((a, b) =>
      sort === "people" ? (b._count?.users ?? 0) - (a._count?.users ?? 0) || a.title.localeCompare(b.title)
        : sort === "kras" ? (b._count?.kraTemplates ?? 0) - (a._count?.kraTemplates ?? 0) || a.title.localeCompare(b.title)
          : a.title.localeCompare(b.title));
    const deptName = (r: ApiRole) => r.department?.name ?? "￿";
    return list.sort((a, b) => deptName(a).localeCompare(deptName(b)));
  }, [roles, display.showEmptyTitles, depts, seniority, noKras, weightsOff, needle, matchesByRole, sort]);

  const groupSize = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of shown ?? []) m.set(r.department?.id ?? NO_DEPT, (m.get(r.department?.id ?? NO_DEPT) ?? 0) + 1);
    return m;
  }, [shown]);

  const columns = useMemo<TableColumn<ApiRole>[]>(() => [
    { key: "title", label: "Job title", title: true, width: "minmax(220px,2fr)", render: (r) => (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate">{r.title}</span>
        {matchesByRole.has(r.id) && !r.title.toLowerCase().includes(needle) ? <span className="truncate text-sm font-normal text-ink-2">· matched {matchesByRole.get(r.id)}</span> : null}
      </span>
    ) },
    { key: "seniority", label: "Seniority", width: "130px", hideBelow: 720, render: (r) => <span className="text-sm text-ink-2">{r.seniority || r.level ? seniorityLabel(r.seniority ?? r.level) : NOT_SET}</span> },
    { key: "people", label: "People", width: "90px", numeric: true, render: (r) => <span className="tabular-nums">{r._count?.users ?? 0}</span> },
    { key: "kras", label: "KRAs", width: "150px", render: (r) => {
      const k = r._count?.kraTemplates ?? 0;
      return k === 0 ? <span className="text-ink-2">No KRAs yet</span> : <span className="tabular-nums">{k} {k === 1 ? "KRA" : "KRAs"} · {r.kpiCount ?? 0} {r.kpiCount === 1 ? "KPI" : "KPIs"}</span>;
    } },
    { key: "weights", label: "Weights", width: "140px", hideBelow: 900, render: (r) => {
      if ((r._count?.kraTemplates ?? 0) === 0) return null;
      const w = r.weightTotal ?? 0;
      // No weights set at all is "Not set", not an alarm on every row.
      if (w === 0) return <span className="text-sm text-ink-2">Not set</span>;
      return w === 100 ? <span className="tabular-nums">100%</span> : <ToneChip tone="warning" label={`${w}% not 100%`} />;
    } },
  ], [matchesByRole, needle]);

  const orphanColumns = useMemo<TableColumn<OrphanKra>[]>(() => [
    { key: "name", label: "KRA", title: true, width: "minmax(200px,1.2fr)", render: (o) => <span className="truncate">{o.name}</span> },
    { key: "desc", label: "Description", width: "minmax(200px,1.5fr)", hideBelow: 900, render: (o) => <span className="line-clamp-2 text-sm text-ink-2">{o.description ?? ""}</span> },
    { key: "kpis", label: "KPIs", width: "70px", numeric: true, render: (o) => <span className="tabular-nums">{o.kpis.length}</span> },
    { key: "used", label: "Used by", width: "120px", render: (o) => o.activeAssignees.length
      ? <AvatarStack people={o.activeAssignees.map((a) => ({ id: a.id, firstName: a.firstName ?? null, lastName: a.lastName ?? null, avatar: a.avatar ?? null }))} max={3} size={24} />
      : <span className="text-sm text-ink-2">Nobody</span> },
    { key: "suggested", label: "Suggested", width: "160px", hideBelow: 720, render: (o) => <span className="truncate text-sm text-ink-2">{o.suggestedRole?.title ?? "None"}</span> },
    { key: "actions", label: "", width: "220px", render: (o) => <OrphanActions orphan={o} roles={roles ?? []} onDone={(msg) => { toast(msg); void load(); }} /> },
  ], [roles, toast, load]);

  const filterCount = (needle ? 1 : 0) + depts.length + seniority.length + (noKras ? 1 : 0) + (weightsOff ? 1 : 0);
  // The one search reaches KRAs with no job title too (the old "Inside job
  // titles" search matched them): the orphans view filters by it, and the
  // Job titles view says how many orphans match with a way to show them.
  const orphanMatches = useMemo(() => {
    if (!orphans) return null;
    if (!needle) return orphans;
    return orphans.filter((o) => o.name.toLowerCase().includes(needle) || o.kpis.some((k) => k.name.toLowerCase().includes(needle)));
  }, [orphans, needle]);
  const clearFilters = () => { setQ(""); setDepts([]); setSeniority([]); setNoKras(false); setWeightsOff(false); };
  const toggle = (list: string[], val: string, on: boolean) => (on ? [...list, val] : list.filter((x) => x !== val));
  const showViews = orphans !== null;

  return (
    <>
      <OsPageHeader
        title="KRAs & KPIs"
        views={showViews ? (
          <>
            <ViewTab label="Job titles" active={view === "titles"} onClick={() => setParams({ view: null })} />
            <ViewTab label="Needs a job title" active={view === "orphans"} onClick={() => setParams({ view: "orphans" })}
              trailing={orphans && orphans.length ? <span className="text-xs font-medium text-ink-2">{orphans.length}</span> : undefined} />
          </>
        ) : undefined}
        toolbar={{
          filter: view === "titles" ? { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: filterCount } : { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: needle ? 1 : 0 },
          sort: view === "titles" ? { onClick: () => setSortOpen((x) => !x), label: sort === "title" ? "Sort" : SORTS.find((s) => s.value === sort)?.label, active: sort !== "title" } : undefined,
          primary: canCreate ? { label: "New KRA", onClick: () => setNewOpen({}), split: { label: "New KPI", onClick: () => setKraPickOpen(true) } } : undefined,
          menu: [{ label: "Show job titles with no KRAs", checked: display.showEmptyTitles, keepOpen: true, onClick: () => setDisplay({ showEmptyTitles: !display.showEmptyTitles }) }],
        }}
      />
      {notice ? <p className="os-chrome px-6 pb-1 text-sm text-ink-2">{notice}</p> : null}
      {view === "titles" && needle && orphanMatches && orphanMatches.length ? (
        <p className="os-chrome m-0 px-6 pb-1 text-sm text-ink-2">
          {orphanMatches.length} {orphanMatches.length === 1 ? "KRA with no job title matches" : "KRAs with no job title match"} ·{" "}
          <button type="button" className="text-brand-deep hover:underline" onClick={() => setParams({ view: "orphans" })}>Show {orphanMatches.length === 1 ? "it" : "them"}</button>
        </p>
      ) : null}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort job titles" selected={sort}
              sections={[{ options: SORTS.map((s) => ({ value: s.value, label: s.label })) }]}
              onSelect={(val) => { setSortOpen(false); setSort(val as Sort); }} />
          </div>
        ) : null}
        {kraPickOpen ? (
          <div className="absolute end-6 top-0 z-40">
            <Picker open align="end" onClose={() => { setKraPickOpen(false); if (newParam === "kpi") clearNew(); }}
              ariaLabel="Which KRA?" searchPlaceholder="Which KRA?" alwaysSearch
              emptyLabel={kras.length === 0 ? "No KRAs yet. Create a KRA first." : "No matches"}
              sections={kraPickerSections(kras)}
              onSelect={(value) => {
                const k = kras.find((x) => x.id === value);
                setKraPickOpen(false);
                if (k) setKpiFor({ id: k.id, name: k.name });
                else if (newParam === "kpi") clearNew();
              }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        {view === "titles" ? (
          <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="job titles" activeCount={filterCount} onClearAll={clearFilters}
            search={{ value: q, onChange: setQ, placeholder: "Job titles, KRAs, KPIs" }}>
            {deptOptions.length ? (
              <FilterGroup label="Department">
                {deptOptions.map(([id, name]) => <FilterRow key={id} label={name} checked={depts.includes(id)} onCheckedChange={(on) => setDepts((c) => toggle(c, id, on))} />)}
              </FilterGroup>
            ) : null}
            <FilterGroup label="Seniority">
              {[...SENIORITY_OPTIONS, { value: "__notset", label: NOT_SET }].map((s) => <FilterRow key={s.value} label={s.label} checked={seniority.includes(s.value)} onCheckedChange={(on) => setSeniority((c) => toggle(c, s.value, on))} />)}
            </FilterGroup>
            <FilterGroup label="KRAs">
              <FilterRow label="Has no KRAs yet" checked={noKras} onCheckedChange={setNoKras} />
              <FilterRow label="Weights not 100%" checked={weightsOff} onCheckedChange={setWeightsOff} />
            </FilterGroup>
          </FilterPanel>
        ) : view === "orphans" && orphans !== null ? (
          <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="KRAs" activeCount={needle ? 1 : 0} onClearAll={() => setQ("")}
            search={{ value: q, onChange: setQ, placeholder: "KRAs, KPIs" }}>{null}</FilterPanel>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {loadError && !roles ? (
            <OsEmptyView variant="error" title="Couldn't load job titles" hint={loadError} action={{ label: "Retry", onClick: () => void load() }} />
          ) : view === "orphans" && orphans !== null ? (
            <TableCard ariaLabel="KRAs that need a job title" columns={orphanColumns} rows={orphanMatches ?? orphans} rowKey={(o) => o.id}
              empty={needle && orphans.length
                ? <span className="text-row text-ink-2">No KRAs match · <button type="button" className="text-brand-deep hover:underline" onClick={() => setQ("")}>Clear search</button></span>
                : <span className="text-row text-ink-2">Every KRA has a job title</span>}
              footer={{ total: (orphanMatches ?? orphans).length, noun: "KRAs", from: (orphanMatches ?? orphans).length ? 1 : 0, to: (orphanMatches ?? orphans).length }} />
          ) : roles && roles.length === 0 ? (
            <OsEmptyView context="goals" title="No job titles yet"
              action={canCreateTitle ? { label: "Create job titles", onClick: () => router.push("/people/roles?new=1") } : undefined} />
          ) : (
            <TableCard
              ariaLabel="Job titles"
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              rowHref={(r) => `/people/roles/${r.id}`}
              groupOf={(r) => {
                const key = r.department?.id ?? NO_DEPT;
                return { key, label: r.department?.name ?? "No department", count: groupSize.get(key) ?? null };
              }}
              collapsedGroups={collapsed}
              onToggleGroup={(key) => setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              rowMenu={(r) => (
                <button type="button" aria-label={`Actions for ${r.title}`} aria-haspopup="menu"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ row: r, anchor: { current: e.currentTarget } }); }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              )}
              empty={<span className="text-row text-ink-2">No job titles match · <button type="button" className="text-brand-deep hover:underline" onClick={clearFilters}>Clear filters</button></span>}
              footer={shown ? { total: shown.length, noun: "job titles", from: shown.length ? 1 : 0, to: shown.length } : undefined}
            />
          )}
        </div>
      </div>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.row.title}`}>
            <MenuItem icon={ExternalLink} label="Open job title" onClick={() => { const id = menu.row.id; setMenu(null); router.push(`/people/roles/${id}`); }} />
            {canCreate ? <MenuItem icon={Plus} label="New KRA here" onClick={() => { const id = menu.row.id; setMenu(null); setNewOpen({ roleId: id }); }} /> : null}
            <MenuSeparator />
            <MenuItem icon={Copy} label="Copy link" onClick={async () => {
              const id = menu.row.id;
              setMenu(null);
              try { await navigator.clipboard.writeText(`${window.location.origin}/people/roles/${id}`); toast("Link copied"); } catch { toast("Couldn't copy the link", { tone: "danger" }); }
            }} />
          </MenuList>
        </MorePortal>
      ) : null}
      {kpiFor ? (
        <KpiDialog
          open
          onOpenChange={(o) => { if (!o) { setKpiFor(null); if (newParam === "kpi") clearNew(); } }}
          kraId={kpiFor.id}
          kraName={kpiFor.name}
          onSaved={(msg) => { toast(msg); void load(); }}
        />
      ) : null}
      <KraDialog
        open={newOpen !== null}
        defaultRoleId={newOpen?.roleId ?? null}
        onOpenChange={(o) => { if (!o) { setNewOpen(null); if (newParam === "kra" || newParam === "1") clearNew(); } }}
        roles={(roles ?? []).map((r) => ({ id: r.id, title: r.title }))}
        onSaved={(msg) => { toast(msg); void load(); }}
      />
    </>
  );
}

function OrphanActions({ orphan: o, roles, onDone }: { orphan: OrphanKra; roles: ApiRole[]; onDone: (msg: string) => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  const attach = async (roleId: string, title: string) => {
    setBusy(true);
    const r = await apiFetch("/api/kras", { method: "PATCH", json: { id: o.id, roleId } });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't attach the KRA", { tone: "danger" }); return; }
    onDone(`Attached ${o.name} to ${title}`);
  };
  const remove = async () => {
    setMenuOpen(false);
    const names = o.activeAssignees.map((a) => `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim()).filter(Boolean);
    const ok = await confirm({
      title: `Delete ${o.name}?`,
      description: `${o.kpis.length ? `Its ${o.kpis.length} ${o.kpis.length === 1 ? "KPI goes" : "KPIs go"} with it. ` : ""}${names.length ? `${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""} will lose it. ` : ""}This can't be undone.`,
      destructive: true,
      confirmLabel: "Not a KRA",
    });
    if (!ok) return;
    setBusy(true);
    const r = await apiFetch(`/api/kras?id=${encodeURIComponent(o.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't delete the KRA", { tone: "danger" }); return; }
    onDone(`Deleted ${o.name}`);
  };

  return (
    <span className="relative flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy}
        onClick={() => (o.suggestedRole ? void attach(o.suggestedRole.id, o.suggestedRole.title) : setPickOpen(true))}
        className="inline-flex h-7 items-center rounded-md border border-line bg-raised px-2.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50">
        Attach
      </button>
      <button ref={menuRef} type="button" aria-label={`More for ${o.name}`} onClick={() => setMenuOpen((x) => !x)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <MorePortal anchorRef={menuRef} width={200} open={menuOpen} placement="below" onClose={() => setMenuOpen(false)}>
        <MenuList aria-label={`More for ${o.name}`}>
          <MenuItem icon={ExternalLink} label="Attach to..." onClick={() => { setMenuOpen(false); setPickOpen(true); }} />
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Not a KRA" destructive onClick={() => void remove()} />
        </MenuList>
      </MorePortal>
      {pickOpen ? (
        <Picker open onClose={() => setPickOpen(false)} ariaLabel="Attach to job title" searchPlaceholder="Search job titles"
          sections={[{ options: roles.map((r) => ({ value: r.id, label: r.title, hint: r.department?.name ?? undefined })) }]}
          onSelect={(val) => { setPickOpen(false); const r = roles.find((x) => x.id === val); if (r) void attach(r.id, r.title); }}
          className="absolute end-0 top-8 z-50" />
      ) : null}
    </span>
  );
}
