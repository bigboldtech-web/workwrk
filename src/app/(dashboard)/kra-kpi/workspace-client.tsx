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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Target, Plus, Search, ChevronRight, Briefcase, Users, Activity,
  Award, AlertTriangle, Gauge, Star,
} from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TeamStatTile } from "@/components/team/ui";
import { KraDialog } from "@/components/alignment/kra-dialog";

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

export default function KraKpiPage() {
  const [roles, setRoles] = useState<ApiRole[] | null>(null);
  const [kras, setKras] = useState<ApiKra[]>([]);
  const [orphans, setOrphans] = useState<OrphanKra[] | null>(null); // null = hidden (no permission)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const router = useRouter();

  // The Teams "+" → New KRA routes here with ?new=1; open the dialog once.
  const searchParams = useSearchParams();
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (!didAutoOpen.current && searchParams.get("new") === "1") {
      didAutoOpen.current = true;
      setNewOpen(true);
    }
  }, [searchParams]);

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
    fetch("/api/kras?limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: ApiKra[] = d?.data?.items ?? d?.data?.data ?? (Array.isArray(d?.data) ? d.data : []);
        setKras(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    fetch("/api/kras/orphans")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOrphans(d?.data?.orphans ?? null))
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
          <Link href="/kra-kpi/review" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Activity className="w-3.5 h-3.5 text-zinc-400" /> KPI review cycle
          </Link>
          <Link href="/reviews" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Award className="w-3.5 h-3.5 text-zinc-400" /> Reviews
          </Link>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#0073EA] text-white text-[13px] font-medium hover:bg-[#0060c2]"
          >
            <Plus className="w-3.5 h-3.5" /> New KRA
          </button>
        </div>
        <p className="mt-2 text-[12.5px] text-zinc-500 max-w-[720px]">
          KRAs and KPIs live inside job titles. Pick a role to define what it
          owns — every person holding that title inherits the template, and
          quarterly targets live on each person&rsquo;s goals.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-[1100px]">
        {/* Stat strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TeamStatTile icon={Briefcase} label="Job titles" value={stats.jobTitles} accent="#0073EA" sub="each owns its template" />
          <TeamStatTile icon={Target} label="KRAs" value={stats.kras} accent="#14B8A6" sub="areas of responsibility" />
          <TeamStatTile icon={Gauge} label="KPI gauges" value={stats.kpis} accent="#71717A" sub="running measures" />
          <TeamStatTile
            icon={AlertTriangle}
            label="Needs a job title"
            value={stats.orphanCount}
            accent={stats.orphanCount > 0 ? "#F59E0B" : "#00C875"}
            sub={orphans === null ? "admin-only view" : stats.orphanCount > 0 ? "orphan KRAs to attach" : "every KRA has a home"}
          />
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-zinc-200 bg-white max-w-[480px] focus-within:border-[#0073EA]">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job titles, KRAs, KPIs…"
            aria-label="Search job titles, KRAs and KPIs"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
          />
        </div>

        {/* KRA / KPI matches that jump to their role */}
        {q && definitionMatches.length > 0 ? (
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">Inside job titles</h2>
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
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 w-7 shrink-0">{m.kind}</span>
                  <span className="text-[13px] text-zinc-800 truncate">{m.label}</span>
                  <span className="text-[11.5px] text-zinc-400 truncate">{m.sub}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-300 ml-auto shrink-0" />
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Job titles */}
        {loadError ? (
          <OsEmptyView Icon={Target} iconGradient={GRAD.redPink} title="Couldn't load job titles" subtitle={loadError} cta="Retry" onCta={() => void load()} />
        ) : roles === null ? (
          <div className="py-16 text-center text-[13px] text-zinc-400">Loading…</div>
        ) : roles.length === 0 ? (
          <OsEmptyView
            Icon={Briefcase}
            iconGradient="#0073EA"
            title="No job titles yet"
            subtitle="KRAs and KPIs live inside job titles. Create your roles first, then define what each one owns."
            cta="Create roles"
            onCta={() => router.push("/people/roles?new=1")}
          />
        ) : filteredRoles.length === 0 && definitionMatches.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-zinc-400">Nothing matches &ldquo;{search}&rdquo;.</div>
        ) : (
          grouped.map((g) => (
            <section key={g.name}>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">{g.name}</h2>
              <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                {g.items.map((r) => <RoleRow key={r.id} role={r} />)}
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
                  <h2 className="text-[13.5px] font-semibold text-zinc-900 leading-tight">Needs a job title</h2>
                  <p className="text-[11.5px] text-zinc-500">
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

      <KraDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        roles={(roles ?? []).map((r) => ({ id: r.id, title: r.title }))}
        onSaved={(msg) => { toast(msg); void load(); }}
      />
    </div>
  );
}

function RoleRow({ role: r }: { role: ApiRole }) {
  const kraCount = r._count?.kraTemplates ?? 0;
  const kpiCount = r.kpiCount ?? 0;
  const people = r._count?.users ?? 0;
  return (
    <Link href={`/people/roles/${r.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
        <Briefcase className="w-3.5 h-3.5 text-[#0073EA]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-zinc-900 truncate">{r.title}</span>
          {r.level ? (
            <span className="text-[10px] font-medium text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 uppercase tracking-wide shrink-0">
              {LEVEL_SHORT[r.level] ?? r.level}
            </span>
          ) : null}
        </span>
        <span className="block text-[11.5px] text-zinc-400 truncate">
          {r.department?.name ?? "No department"}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 text-[12px] text-zinc-500 shrink-0" title={`${people} person${people === 1 ? "" : "s"} holding this title`}>
        <Users className="w-3.5 h-3.5 text-zinc-400" /> {people}
      </span>
      {kraCount === 0 ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-600 shrink-0">
          <AlertTriangle className="w-3 h-3" /> No KRAs yet
        </span>
      ) : (
        <span className="text-[12px] text-zinc-500 tabular-nums shrink-0">
          {kraCount} KRA{kraCount === 1 ? "" : "s"} · {kpiCount} KPI{kpiCount === 1 ? "" : "s"}
        </span>
      )}
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
          <span className="text-[13px] font-medium text-zinc-900 truncate">{o.name}</span>
          <span className="text-[11px] text-zinc-400 shrink-0">
            {o.kpis.length} KPI{o.kpis.length === 1 ? "" : "s"}
          </span>
          {o.kpis.some((k) => k.isNorthStar) ? (
            <Star className="w-3 h-3 text-amber-400 shrink-0" style={{ fill: "currentColor" }} />
          ) : null}
        </span>
        {assignees.length > 0 ? (
          <span className="block text-[11.5px] text-zinc-400 truncate">
            Assigned to {assignees.slice(0, 3).join(", ")}{assignees.length > 3 ? ` +${assignees.length - 3}` : ""}
          </span>
        ) : (
          <span className="block text-[11.5px] text-zinc-400">No active assignees</span>
        )}
      </span>

      {o.suggestedRole ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void attach(o.suggestedRole!.id, o.suggestedRole!.title)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[#0073EA]/30 bg-[#0073EA]/5 text-[12px] font-medium text-[#0073EA] hover:bg-[#0073EA]/10 disabled:opacity-50 shrink-0"
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
          className="h-7 px-1.5 rounded-md border border-zinc-200 bg-white text-[12px] text-zinc-700 focus:outline-none focus:border-[#0073EA]"
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
          className="h-7 px-2.5 rounded-md bg-zinc-900 text-white text-[12px] font-medium hover:bg-zinc-800 disabled:opacity-40"
        >
          Attach
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          title="Not a KRA — delete it"
          className="h-7 px-2.5 rounded-md text-[12px] font-medium text-[#E2445C] hover:bg-[#E2445C]/10 disabled:opacity-40"
        >
          Not a KRA
        </button>
      </span>
    </div>
  );
}
