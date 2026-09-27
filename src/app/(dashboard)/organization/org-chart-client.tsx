"use client";

// Teams > Org chart (spec-teams-people /organization): who reports to whom,
// for the whole company, and for the people who keep it right, the place to
// fix it. The ONE org chart (Settings > Hierarchy redirects here).
//
//   data     GET /api/users?fields=chart: every current person's id, name,
//            manager, job title, department, office and dotted lines, for
//            every Member (cursorless, capped at 5,000 with a warning line)
//   toolbar  Filter (search, department, office, job title, Not linked to
//            a manager, Only my chain), the one blue Edit reporting lines
//            (Owner, Admin, People team and the org-wide levels; "Done"
//            while editing), and "..." (Expand all, Collapse all, Display,
//            Export CSV, Manage members)
//   edit     each row gains Reports to and Dotted lines pickers that save
//            on pick (PATCH /api/users/[id] { managerId } with the server's
//            loop and Agent checks; PUT /api/users/[id]/dotted-lines)
//
// Gone: the four tiles and the three fetches that fed them, the eight-root
// cap and "+N more", the "Loading hierarchy" text that never ended on a
// failed read, the error text with no Retry, and the Org settings link to
// the Settings root (it is Settings > Structure now, for Owner and Admin).

import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, ExternalLink, Pencil, Check, Settings2 } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { SkeletonRows } from "@/components/ui/skeleton";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { apiFetch } from "@/lib/api-fetch";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { buildOrgForest, filterForest, forestIds } from "@/lib/people/reporting-lines";
import { toCsv } from "@/lib/people/people-csv";
import { OrgTree, type ChartPerson } from "@/components/people/org-tree";

interface ChartRow {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  managerId: string | null;
  isAgent: boolean;
  roleId: string | null;
  departmentId: string | null;
  officeId: string | null;
  jobTitle: string | null;
  department: string | null;
  dottedManagerIds: string[];
  presenceStatus: string | null;
  presenceUntil: string | null;
}
interface ChartResponse {
  data: ChartRow[];
  total: number;
  truncated: boolean;
  viewer: { canEditLines: boolean; canExport: boolean; isAdmin: boolean };
}

export default function OrgChartClient() {
  const sp = useSearchParams();
  const { rowVersion } = useOsShell();
  const { boot } = useBoot();
  const { openSettings } = useSettingsNav();
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string | null>(null);
  const [office, setOffice] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [offices, setOffices] = useState<Array<{ id: string; name: string }>>([]);
  const [showTitle, setShowTitle] = useState(true);
  const [showDepartment, setShowDepartment] = useState(true);
  const [sortName, setSortName] = useState(false);
  const [expandAll, setExpandAll] = useState(0);
  const focusId = sp?.get("focus") ?? null;

  const load = useCallback(async () => {
    const r = await apiFetch<ChartResponse>("/api/users?fields=chart", { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load the org chart"); return; }
    setError(null);
    setData(r.data);
  }, []);
  const v = rowVersion("people");
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load, v]);
  useEffect(() => {
    const onFocus = () => { if (!editing) void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, editing]);
  const loadedOffices = useRef(false);
  useEffect(() => {
    if (!filterOpen || loadedOffices.current) return;
    loadedOffices.current = true;
    void apiFetch<Array<{ id: string; name: string }> | { data: Array<{ id: string; name: string }> }>("/api/offices", { cache: "no-store" })
      .then((r) => { if (r.ok) setOffices(Array.isArray(r.data) ? r.data : r.data.data ?? []); });
  }, [filterOpen]);

  // E toggles edit mode for editors (never while typing).
  const canEdit = data?.viewer.canEditLines ?? false;
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,[contenteditable='true'],[role='dialog']")) return;
      setEditing((x) => !x);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit]);

  const people = useMemo<ChartPerson[]>(() => (data?.data ?? []).map((u) => ({
    ...u,
    name: `${u.firstName} ${u.lastName}`.trim() || "Someone",
  })), [data]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const forest = useMemo(() => buildOrgForest(people, { sort: sortName ? "name" : "size" }), [people, sortName]);

  const filters = (q.trim() ? 1 : 0) + (dept ? 1 : 0) + (office ? 1 : 0) + (title ? 1 : 0) + (onlyUnlinked ? 1 : 0) + (onlyMine ? 1 : 0);
  const myChain = useMemo(() => {
    const mine = forest.roots.flatMap(function find(n): typeof forest.roots { return n.person.id === boot.viewer.id ? [n] : n.children.flatMap(find); });
    return new Set(forestIds(mine));
  }, [forest, boot.viewer.id]);
  const matches = useCallback((p: ChartPerson) => {
    const needle = q.trim().toLowerCase();
    return (!needle || p.name.toLowerCase().includes(needle))
      && (!dept || p.departmentId === dept)
      && (!office || p.officeId === office)
      && (!title || p.roleId === title)
      && (!onlyMine || myChain.has(p.id));
  }, [q, dept, office, title, onlyMine, myChain]);
  const roots = useMemo(() => {
    if (onlyUnlinked) {
      // Nobody reports to them and they report to nobody, plus the loops.
      return forest.roots.filter((r) => r.children.length === 0 && !r.person.managerId && matches(r.person));
    }
    return filters ? filterForest(forest.roots, matches) : forest.roots;
  }, [forest, filters, matches, onlyUnlinked]);
  const unlinked = useMemo(() => forest.unlinked.filter((p) => !filters || matches(p)), [forest, filters, matches]);

  const deptOptions = useMemo(() => [...new Map(people.filter((p) => p.departmentId).map((p) => [p.departmentId!, p.department ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [people]);
  const titleOptions = useMemo(() => [...new Map(people.filter((p) => p.roleId).map((p) => [p.roleId!, p.jobTitle ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [people]);
  const clear = () => { setQ(""); setDept(null); setOffice(null); setTitle(null); setOnlyUnlinked(false); setOnlyMine(false); };

  function exportCsv() {
    const csv = toCsv(["Name", "Job title", "Department", "Reports to"],
      people.map((p) => [p.name, p.jobTitle ?? "", p.department ?? "", p.managerId ? byId.get(p.managerId)?.name ?? "" : ""]));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `org-chart-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const hasReports = boot.viewer.hasReports;
  const isAdmin = data?.viewer.isAdmin ?? false;
  const nobodyLinked = data && people.length > 0 && people.every((p) => !p.managerId);

  return (
    <>
      <Breadcrumb items={[{ label: "Org chart" }]} />
      <OsPageHeader
        title="Org chart"
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: filters },
          primary: canEdit ? { label: editing ? "Done" : "Edit reporting lines", icon: editing ? Check : Pencil, onClick: () => setEditing((x) => !x) } : undefined,
          menu: [
            { label: "Expand all", onClick: () => setExpandAll((n) => Math.abs(n) + 1) },
            { label: "Collapse all", onClick: () => setExpandAll((n) => -(Math.abs(n) + 1)) },
            { separator: true as const },
            { label: "Show job title", checked: showTitle, keepOpen: true, onClick: () => setShowTitle((x) => !x) },
            { label: "Show department", checked: showDepartment, keepOpen: true, onClick: () => setShowDepartment((x) => !x) },
            { label: "Sort A to Z", checked: sortName, keepOpen: true, onClick: () => setSortName((x) => !x) },
            ...(data?.viewer.canExport ? [{ separator: true as const }, { label: "Export CSV", icon: Download, onClick: exportCsv }] : []),
            ...(isAdmin ? [
              { label: "Manage members", icon: ExternalLink, onClick: () => openSettings("/settings/members") },
              { label: "Org settings", icon: Settings2, onClick: () => openSettings("/settings/structure") },
            ] : []),
          ],
        }}
      />
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="people" activeCount={filters} onClearAll={clear}
          search={{ value: q, onChange: setQ, placeholder: "Search by name" }}>
          {deptOptions.length ? (
            <FilterGroup label="Department">
              {deptOptions.map(([id, name]) => <FilterRow key={id} label={name} checked={dept === id} onCheckedChange={(on) => setDept(on ? id : null)} />)}
            </FilterGroup>
          ) : null}
          {offices.length ? (
            <FilterGroup label="Office">
              {offices.map((o) => <FilterRow key={o.id} label={o.name} checked={office === o.id} onCheckedChange={(on) => setOffice(on ? o.id : null)} />)}
            </FilterGroup>
          ) : null}
          {titleOptions.length ? (
            <FilterGroup label="Job title">
              {titleOptions.map(([id, name]) => <FilterRow key={id} label={name} checked={title === id} onCheckedChange={(on) => setTitle(on ? id : null)} />)}
            </FilterGroup>
          ) : null}
          <FilterGroup label="Reporting">
            <FilterRow label="Not linked to a manager" checked={onlyUnlinked} onCheckedChange={setOnlyUnlinked} />
            {hasReports ? <FilterRow label="Only my chain" checked={onlyMine} onCheckedChange={setOnlyMine} /> : null}
          </FilterGroup>
        </FilterPanel>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {error && !data ? (
            <OsEmptyView variant="error" title="Couldn't load the org chart" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : !data ? (
            <div className="os-chrome overflow-hidden rounded-lg border border-line bg-raised"><SkeletonRows rows={10} /></div>
          ) : people.length <= 1 && !filters ? (
            <OsEmptyView title="No reporting lines yet" hint={canEdit ? undefined : "Ask an Admin to set reporting lines."} action={canEdit ? { label: "Edit reporting lines", onClick: () => setEditing(true) } : undefined} />
          ) : roots.length === 0 && unlinked.length === 0 ? (
            <p className="rounded-lg border border-line bg-raised px-4 py-3 text-row text-ink-2">
              Nobody matches · <button type="button" className="text-brand-deep hover:underline" onClick={clear}>Clear filters</button>
            </p>
          ) : (
            <>
              {nobodyLinked && !editing ? <p className="text-sm text-ink-2">Nobody has a manager yet.{canEdit ? " Use Edit reporting lines to set them." : " Ask an Admin to set reporting lines."}</p> : null}
              {data.truncated ? <p role="status" className="text-sm text-warning-text">Showing the first {data.data.length} of {data.total} people. Filter to find someone further down.</p> : null}
              <OrgTree
                roots={roots}
                unlinked={onlyUnlinked ? unlinked : unlinked}
                byId={byId}
                editable={editing}
                display={{ showTitle, showDepartment }}
                focusId={focusId}
                expandAll={filters ? Math.abs(expandAll) + 1 : expandAll}
                onSaved={() => void load()}
                canFixUnlinked={canEdit}
              />
              <p className="text-sm font-medium text-ink-2">Total people {data.total}{forest.unlinked.length ? ` · ${forest.unlinked.length} not linked` : ""}</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
