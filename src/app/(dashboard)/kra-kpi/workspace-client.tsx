"use client";

/* KRA / KPI — the job-title-first alignment workspace.
 *
 * KRAs and KPIs are managed PER JOB TITLE, never as a flat wall: this
 * page is the role picker. Each row is a job title with its headcount
 * and "N KRAs · M KPIs"; selecting one opens the role's definition
 * workspace (/people/roles/[id]) where the template is edited. Legacy
 * KRAs that belong to no job title are SURFACED in a separate
 * "Needs a job title" section for an admin to attach — never deleted,
 * never auto-assigned.
 *
 *  GET   /api/roles          — job titles + KRA/KPI counts
 *  GET   /api/kras?limit=500 — global KRA/KPI search index (scoped)
 *  GET   /api/kras/orphans   — roleId-null KRAs (kras.edit only)
 *  PATCH /api/kras           — attach an orphan to a job title
 */

import { SkeletonRows } from "@/components/ui/skeleton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Target, Plus, Search, ChevronRight, Briefcase, Users,
  AlertTriangle, Gauge, Star,
} from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TeamStatTile } from "@/components/team/ui";
import { KraDialog } from "@/components/alignment/kra-dialog";
import { KpiDialog } from "@/components/alignment/kpi-dialog";
import { Picker, type PickerOption, type PickerSectionDef } from "@/components/ui/picker";
import { usePermission } from "@/hooks/use-permission";

type ApiRole = {
  id: string;
  title: string;
  level?: string;
  description?: string | null;
  department?: { id: string; name: string } | null;
  _count?: { users?: number; kraTemplates?: number };
  kpiCount?: number;
};

type ApiKra = {
  id: string;
  name: string;
  description?: string | null;
  roleId?: string | null;
  role?: { id: string; title: string } | null;
  /** Role-level default weightage (0-100) — the share of the job title
   *  this area carries. Summed per role for the "weight N%" chip. */
  weight?: number;
  kpis?: { id: string; name: string; unit?: string | null; isNorthStar?: boolean }[];
};

type OrphanKra = {
  id: string;
  name: string;
  description?: string | null;
  kpis: { id: string; name: string; isNorthStar?: boolean }[];
  activeAssignees: { id: string; firstName?: string | null; lastName?: string | null; role?: { id: string; title: string } | null }[];
  totalAssignments: number;
  assigneeRoles: { id: string; title: string }[];
  suggestedRole: { id: string; title: string } | null;
};

const LEVEL_SHORT: Record<string, string> = {
  C_LEVEL: "C-Suite", VP: "VP", DIRECTOR: "Director", MANAGER: "Manager",
  TEAM_LEAD: "Team lead", EMPLOYEE: "IC", HR: "HR", COMPANY_ADMIN: "Admin", SUPER_ADMIN: "Super",
};

const NO_DEPT = "No department";

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

export default function KraKpiPage() {
  const [roles, setRoles] = useState<ApiRole[] | null>(null);
  const [kras, setKras] = useState<ApiKra[]>([]);
  const [orphans, setOrphans] = useState<OrphanKra[] | null>(null); // null = hidden (no permission)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  // New KPI: "Which KRA?" first (a Picker), then KpiDialog under that KRA
  // (spec-goals section 2 `/kra-kpi`, PO-17: the Teams "+" New KPI finally
  // lands on a KPI control).
  const [kraPickOpen, setKraPickOpen] = useState(false);
  const [kpiFor, setKpiFor] = useState<{ id: string; name: string } | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const router = useRouter();
  // Every Member reads the library (Phase 6, the `kra-kpi` APP_RULES row);
  // the create controls render only for the kras.create permission the
  // routes ask. While the matrix loads nothing write-shaped renders.
  const canCreate = usePermission("kras", "create") === true;

  // The Teams "+" routes here with ?new=kra (New KRA) or ?new=kpi (New KPI);
  // ?new=1 is the retired form of ?new=kra. Each opens once, and closing
  // clears the param so a refresh does not re-open it.
  const searchParams = useSearchParams();
  const newParam = searchParams.get("new");
  const didAutoOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!canCreate || !newParam || didAutoOpen.current === newParam) return;
    didAutoOpen.current = newParam;
    if (newParam === "kra" || newParam === "1") setNewOpen(true);
    else if (newParam === "kpi") setKraPickOpen(true);
  }, [newParam, canCreate]);
  const clearNewParam = useCallback(() => {
    if (!newParam) return;
    didAutoOpen.current = null;
    router.replace("/kra-kpi", { scroll: false });
  }, [newParam, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/roles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoles(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
    // Best-effort extras — never block the role list.
    // scope=library: every definition in the org, for every Member.
    fetch("/api/kras?limit=500&scope=library")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: ApiKra[] = d?.data?.items ?? d?.data?.data ?? (Array.isArray(d?.data) ? d.data : []);
        setKras(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    fetch("/api/kras/orphans")
      .then((r) => (r.ok ? r.json() : null))
      // The route answers { orphans, total } at the TOP level (jsonSuccess
      // does not wrap); reading d.data.orphans kept this section hidden for
      // everyone, editors included.
      .then((d) => setOrphans(d?.orphans ?? d?.data?.orphans ?? null))
      .catch(() => setOrphans(null));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("kra-kpi");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const q = search.trim().toLowerCase();

  const filteredRoles = useMemo(() => {
    let list = roles ?? [];
    if (q) {
      list = list.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        (r.department?.name ?? "").toLowerCase().includes(q) ||
        (LEVEL_SHORT[r.level ?? ""] ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [roles, q]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiRole[]>();
    for (const r of filteredRoles) {
      const dept = r.department?.name ?? NO_DEPT;
      if (!m.has(dept)) m.set(dept, []);
      m.get(dept)!.push(r);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)))
      .map(([name, items]) => ({ name, items: items.slice().sort((a, b) => a.title.localeCompare(b.title)) }));
  }, [filteredRoles]);

  // Global search: KRA / KPI hits that jump to their job title.
  const definitionMatches = useMemo(() => {
    if (!q) return [];
    const rows: { key: string; kind: "KRA" | "KPI"; label: string; sub: string; roleId: string | null }[] = [];
    for (const k of kras) {
      const roleTitle = k.role?.title ?? "Needs a job title";
      if (k.name.toLowerCase().includes(q)) {
        rows.push({ key: `kra-${k.id}`, kind: "KRA", label: k.name, sub: roleTitle, roleId: k.role?.id ?? null });
      }
      for (const p of k.kpis ?? []) {
        if (p.name.toLowerCase().includes(q)) {
          rows.push({ key: `kpi-${p.id}`, kind: "KPI", label: p.name, sub: `${k.name} · ${roleTitle}`, roleId: k.role?.id ?? null });
        }
      }
    }
    return rows.slice(0, 12);
  }, [kras, q]);

  // Per-role KRA weight sums for the "weight N%" chip — the picker
  // shows at a glance which job titles actually sum to 100%. The chip
  // only renders when the loaded KRA list covers the role's FULL
  // template set (team-scoped /api/kras can return a partial slice for
  // managers; a partial sum would be a lie, so it renders nothing).
  const weightByRole = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>();
    for (const k of kras) {
      const rid = k.roleId ?? k.role?.id;
      if (!rid) continue;
      const cur = m.get(rid) ?? { sum: 0, count: 0 };
      cur.sum += typeof k.weight === "number" && Number.isFinite(k.weight) ? k.weight : 0;
      cur.count += 1;
      m.set(rid, cur);
    }
    return m;
  }, [kras]);

  const stats = useMemo(() => {
    const list = roles ?? [];
    const roleKras = list.reduce((acc, r) => acc + (r._count?.kraTemplates ?? 0), 0);
    const roleKpis = list.reduce((acc, r) => acc + (r.kpiCount ?? 0), 0);
    const orphanCount = orphans?.length ?? 0;
    const orphanKpis = (orphans ?? []).reduce((acc, o) => acc + o.kpis.length, 0);
    return {
      jobTitles: list.length,
      kras: roleKras + orphanCount,
      kpis: roleKpis + orphanKpis,
      orphanCount,
    };
  }, [roles, orphans]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>KRAs &amp; KPIs</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
            <Target className="h-5 w-5 text-[#0073EA]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">KRAs &amp; KPIs</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">
            {roles === null
              ? "loading…"
              : `${stats.jobTitles} job title${stats.jobTitles === 1 ? "" : "s"} · ${stats.kras} KRA${stats.kras === 1 ? "" : "s"} · ${stats.kpis} KPI${stats.kpis === 1 ? "" : "s"}`}
          </span>
          <div className="flex-1" />
          {/* "KPI review cycle" and "Reviews" left the header: they are the
              Teams sidebar rows KPI reviews (/team/kpi-reviews, which the old
              /kra-kpi/review now 308s to) and Review cycles (/reviews). */}
          {canCreate ? (
            <span className="relative inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => setKraPickOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-base text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
              >
                <Gauge className="w-3.5 h-3.5 text-zinc-400" /> New KPI
              </button>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#0073EA] text-white text-base font-medium hover:bg-[#0060c2]"
              >
                <Plus className="w-3.5 h-3.5" /> New KRA
              </button>
              <Picker
                open={kraPickOpen}
                onClose={() => { setKraPickOpen(false); if (newParam === "kpi") clearNewParam(); }}
                align="end"
                ariaLabel="Which KRA?"
                searchPlaceholder="Which KRA?"
                alwaysSearch
                emptyLabel={kras.length === 0 ? "No KRAs yet. Create a KRA first." : "No matches"}
                sections={kraPickerSections(kras)}
                onSelect={(value) => {
                  const k = kras.find((x) => x.id === value);
                  setKraPickOpen(false);
                  if (k) setKpiFor({ id: k.id, name: k.name });
                }}
              />
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-base text-zinc-500 max-w-[720px]">
          KRAs and KPIs live inside job titles. Pick a job title to see what
          it owns: every person holding that title inherits the template, and
          quarterly targets live on each person&rsquo;s goals.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-[1100px] mx-auto w-full">
        {/* Stat strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TeamStatTile icon={Briefcase} label="Job titles" value={stats.jobTitles} accent="#0073EA" sub="each owns its template" />
          <TeamStatTile icon={Target} label="KRAs" value={stats.kras} accent="#14B8A6" sub="areas of responsibility" />
          <TeamStatTile icon={Gauge} label="KPI gauges" value={stats.kpis} accent="#71717A" sub="running measures" />
          {/* Editors only (the orphans route asks kras.edit): a tile that
              read "admin-only view" to everyone else carried nothing. */}
          {orphans !== null ? (
            <TeamStatTile
              icon={AlertTriangle}
              label="Needs a job title"
              value={stats.orphanCount}
              accent={stats.orphanCount > 0 ? "#F59E0B" : "#00C875"}
              sub={stats.orphanCount > 0 ? "orphan KRAs to attach" : "every KRA has a home"}
            />
          ) : null}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-zinc-200 bg-white max-w-[480px] focus-within:border-[#0073EA]">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job titles, KRAs, KPIs…"
            aria-label="Search job titles, KRAs and KPIs"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-zinc-400"
          />
        </div>

        {/* KRA / KPI matches that jump to their role */}
        {q && definitionMatches.length > 0 ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">Inside job titles</h2>
            <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
              {definitionMatches.map((m) => (
                <Link
                  key={m.key}
                  href={m.roleId ? `/people/roles/${m.roleId}` : "#orphans"}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-50"
                >
                  {m.kind === "KRA"
                    ? <Target className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    : <Gauge className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                  <span className="text-micro font-semibold uppercase tracking-wide text-zinc-400 w-7 shrink-0">{m.kind}</span>
                  <span className="text-base text-zinc-800 truncate">{m.label}</span>
                  <span className="text-xs text-zinc-400 truncate">{m.sub}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-300 ml-auto shrink-0" />
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Job titles */}
        {loadError ? (
          <OsEmptyView variant="error" title="Couldn't load job titles" hint={loadError} action={{ label: "Try again", onClick: () => void load() }} />
        ) : roles === null ? (
          <SkeletonRows />
        ) : roles.length === 0 ? (
          <OsEmptyView
            context="goals"
            title="No job titles yet"
            hint="KRAs and KPIs live inside job titles, so create those first."
            action={canCreate ? { label: "New job title", onClick: () => router.push("/people/roles?new=1") } : undefined}
          />
        ) : filteredRoles.length === 0 && definitionMatches.length === 0 ? (
          <div className="py-16 text-center text-base text-zinc-400">Nothing matches &ldquo;{search}&rdquo;.</div>
        ) : (
          grouped.map((g) => (
            <section key={g.name}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">{g.name}</h2>
              <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                {g.items.map((r) => <RoleRow key={r.id} role={r} weight={weightByRole.get(r.id)} />)}
              </div>
            </section>
          ))
        )}

        {/* Orphan KRAs — surfaced, never deleted, never auto-assigned */}
        {orphans !== null && orphans.length > 0 ? (
          <section id="orphans" className="pt-2">
            <div className="rounded-xl border border-amber-200 bg-white">
              <div className="flex items-center gap-2.5 px-4 pt-3.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                  <AlertTriangle size={15} className="text-amber-500" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 leading-tight">Needs a job title</h2>
                  <p className="text-xs text-zinc-500">
                    These KRAs belong to no role, so nobody inherits them. Attach
                    each one to the job title it belongs to — nothing is deleted.
                  </p>
                </div>
              </div>
              <div className="mt-3 divide-y divide-zinc-100 border-t border-zinc-100">
                {orphans.map((o) => (
                  <OrphanRow
                    key={o.id}
                    orphan={o}
                    roles={roles ?? []}
                    onAttached={(msg) => { toast(msg); void load(); }}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {kpiFor ? (
        <KpiDialog
          open
          onOpenChange={(o) => { if (!o) { setKpiFor(null); if (newParam === "kpi") clearNewParam(); } }}
          kraId={kpiFor.id}
          kraName={kpiFor.name}
          onSaved={(msg) => { toast(msg); void load(); }}
        />
      ) : null}
      <KraDialog
        open={newOpen}
        onOpenChange={(o) => { setNewOpen(o); if (!o && (newParam === "kra" || newParam === "1")) clearNewParam(); }}
        roles={(roles ?? []).map((r) => ({ id: r.id, title: r.title }))}
        onSaved={(msg) => { toast(msg); void load(); }}
      />
    </div>
  );
}

function RoleRow({ role: r, weight }: { role: ApiRole; weight?: { sum: number; count: number } }) {
  const kraCount = r._count?.kraTemplates ?? 0;
  const kpiCount = r.kpiCount ?? 0;
  const people = r._count?.users ?? 0;
  // Only claim a weight total when the loaded KRAs cover the whole role.
  const weightSum = weight && kraCount > 0 && weight.count === kraCount ? Math.round(weight.sum) : null;
  return (
    <Link href={`/people/roles/${r.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
        <Briefcase className="w-3.5 h-3.5 text-[#0073EA]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-base font-medium text-zinc-900 truncate">{r.title}</span>
          {r.level ? (
            <span className="text-micro font-medium text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 uppercase tracking-wide shrink-0">
              {LEVEL_SHORT[r.level] ?? r.level}
            </span>
          ) : null}
        </span>
        <span className="block text-xs text-zinc-400 truncate">
          {r.department?.name ?? "No department"}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 text-sm text-zinc-500 shrink-0" title={`${people} person${people === 1 ? "" : "s"} holding this title`}>
        <Users className="w-3.5 h-3.5 text-zinc-400" /> {people}
      </span>
      {kraCount === 0 ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600 shrink-0">
          <AlertTriangle className="w-3 h-3" /> No KRAs yet
        </span>
      ) : (
        <span className="text-sm text-zinc-500 tabular-nums shrink-0">
          {kraCount} KRA{kraCount === 1 ? "" : "s"} · {kpiCount} KPI{kpiCount === 1 ? "" : "s"}
        </span>
      )}
      {weightSum != null ? (
        weightSum === 100 ? (
          <span
            className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 tabular-nums shrink-0"
            title="KRA weights total 100%"
          >
            weight 100%
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600 tabular-nums shrink-0"
            title={`KRA weights total ${weightSum}%, should be 100%`}
          >
            <AlertTriangle className="w-3 h-3" /> weight {weightSum}%
          </span>
        )
      ) : null}
      <ChevronRight className="w-4 h-4 text-zinc-300 shrink-0" />
    </Link>
  );
}

function OrphanRow({
  orphan: o,
  roles,
  onAttached,
}: {
  orphan: OrphanKra;
  roles: ApiRole[];
  onAttached: (msg: string) => void;
}) {
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useOsToast();
  const confirm = useConfirm();

  // Not every legacy row is a real KRA. Vague, everyone-owns-it entries
  // ("Collaboration", "Quality of work") measure nobody and belong to no
  // job title — the admin clears them here rather than force-fitting them
  // onto a role. Guarded by a destructive confirm that names what goes.
  const remove = async () => {
    const kpiNote = o.kpis.length > 0 ? ` and its ${o.kpis.length} KPI${o.kpis.length === 1 ? "" : "s"}` : "";
    const peopleNote = o.activeAssignees.length > 0
      ? ` It is currently assigned to ${o.activeAssignees.length} person${o.activeAssignees.length === 1 ? "" : "s"}.`
      : "";
    const ok = await confirm({
      title: "Delete this KRA",
      description: `Delete "${o.name}"${kpiNote}?${peopleNote} This cannot be undone.`,
      destructive: true,
      confirmLabel: "Delete KRA",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/kras?id=${encodeURIComponent(o.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't delete the KRA");
        return;
      }
      onAttached(`Deleted "${o.name}"`);
    } catch {
      toast("Couldn't delete the KRA");
    } finally {
      setBusy(false);
    }
  };

  const attach = async (targetRoleId: string, targetTitle: string) => {
    if (!targetRoleId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/kras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, roleId: targetRoleId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't attach the KRA");
        return;
      }
      onAttached(`Attached "${o.name}" to ${targetTitle}`);
    } catch {
      toast("Couldn't attach the KRA");
    } finally {
      setBusy(false);
    }
  };

  const assignees = o.activeAssignees
    .map((a) => [a.firstName, a.lastName].filter(Boolean).join(" ").trim())
    .filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <Target className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
      <span className="min-w-0 flex-1 basis-52">
        <span className="flex items-center gap-2">
          <span className="text-base font-medium text-zinc-900 truncate">{o.name}</span>
          <span className="text-xs text-zinc-400 shrink-0">
            {o.kpis.length} KPI{o.kpis.length === 1 ? "" : "s"}
          </span>
          {o.kpis.some((k) => k.isNorthStar) ? (
            <Star className="w-3 h-3 text-amber-400 shrink-0" style={{ fill: "currentColor" }} />
          ) : null}
        </span>
        {assignees.length > 0 ? (
          <span className="block text-xs text-zinc-400 truncate">
            Assigned to {assignees.slice(0, 3).join(", ")}{assignees.length > 3 ? ` +${assignees.length - 3}` : ""}
          </span>
        ) : (
          <span className="block text-xs text-zinc-400">No active assignees</span>
        )}
      </span>

      {o.suggestedRole ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void attach(o.suggestedRole!.id, o.suggestedRole!.title)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[#0073EA]/30 bg-[#0073EA]/5 text-sm font-medium text-[#0073EA] hover:bg-[#0073EA]/10 disabled:opacity-50 shrink-0"
          title="All active assignees hold this job title"
        >
          Attach to {o.suggestedRole.title}
        </button>
      ) : null}

      <span className="inline-flex items-center gap-1.5 shrink-0">
        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          disabled={busy}
          aria-label={`Job title for ${o.name}`}
          className="h-7 px-1.5 rounded-md border border-zinc-200 bg-white text-sm text-zinc-700 focus:outline-none focus:border-[#0073EA]"
        >
          <option value="">Choose job title…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <button
          type="button"
          disabled={busy || !roleId}
          onClick={() => {
            const picked = roles.find((r) => r.id === roleId);
            if (picked) void attach(picked.id, picked.title);
          }}
          className="h-7 px-2.5 rounded-md bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-40"
        >
          Attach
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          title="Not a KRA — delete it"
          className="h-7 px-2.5 rounded-md text-sm font-medium text-[#E2445C] hover:bg-[#E2445C]/10 disabled:opacity-40"
        >
          Not a KRA
        </button>
      </span>
    </div>
  );
}
