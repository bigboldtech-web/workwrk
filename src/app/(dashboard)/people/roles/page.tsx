"use client";

/* People · Roles — job-title library with level chips.
 *
 *  GET   /api/roles
 *  POST  /api/roles  { title, level }
 *
 * Layout:
 *   OsTitleBar with back + nav + New role.
 *   4-tile KPI strip: Roles · Headcount · Unfilled · Levels.
 *   Toolbar: search + level filter chips (C-Suite, VP, Director, etc.).
 *   Grouped sections by level: each with header pill + count + role cards.
 *   Cards: title + level chip + dept + headcount badge (orange when 0).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Briefcase, Plus, Users, Search, ArrowLeft, Building2, UserX,
  Layers, GraduationCap,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { usePrompt } from "@/components/ui/dialog-provider";

type Level = "EMPLOYEE" | "TEAM_LEAD" | "MANAGER" | "DIRECTOR" | "VP" | "C_LEVEL" | "HR" | "COMPANY_ADMIN" | "SUPER_ADMIN";

type ApiRole = {
  id: string;
  title: string;
  description?: string | null;
  level: Level;
  department?: { id: string; name: string } | null;
  _count?: { users?: number };
};

const LEVEL_ORDER: Level[] = ["C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "HR", "COMPANY_ADMIN", "SUPER_ADMIN"];
const LEVEL_LABELS: Record<Level, string> = {
  C_LEVEL: "C-Suite", VP: "VPs", DIRECTOR: "Directors", MANAGER: "Managers",
  TEAM_LEAD: "Team leads", EMPLOYEE: "Individual contributors",
  HR: "HR", COMPANY_ADMIN: "Company admin", SUPER_ADMIN: "Super admin",
};
const LEVEL_SHORT: Record<Level, string> = {
  C_LEVEL: "C-Suite", VP: "VP", DIRECTOR: "Director", MANAGER: "Manager",
  TEAM_LEAD: "Team lead", EMPLOYEE: "IC", HR: "HR", COMPANY_ADMIN: "Admin", SUPER_ADMIN: "Super",
};
const LEVEL_COLORS: Record<Level, string> = {
  C_LEVEL: C.purple, VP: C.pink, DIRECTOR: C.indigo, MANAGER: C.blue,
  TEAM_LEAD: C.teal, EMPLOYEE: C.sage, HR: C.orange, COMPANY_ADMIN: C.red, SUPER_ADMIN: C.red,
};
const LEVEL_RANK: Record<Level, number> = {
  C_LEVEL: 7, VP: 6, DIRECTOR: 5, MANAGER: 4, TEAM_LEAD: 3,
  EMPLOYEE: 1, HR: 2, COMPANY_ADMIN: 0, SUPER_ADMIN: 0,
};

const DEPT_PALETTE = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
function deptColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DEPT_PALETTE[h % DEPT_PALETTE.length];
}

export default function RolesPage() {
  const [roles, setRoles] = useState<ApiRole[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<Level | null>(null);
  const [showUnfilledOnly, setShowUnfilledOnly] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

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
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const title = (await promptDialog({ title: "Role title?" }))?.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/roles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, level: "EMPLOYEE" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Role created");
      void load();
    } catch { toast("Couldn't create role"); }
  }

  // ─── Filter + group ──────────────────────────────────────
  const filtered = useMemo(() => {
    let list = roles ?? [];
    if (levelFilter) list = list.filter((r) => (r.level ?? "EMPLOYEE") === levelFilter);
    if (showUnfilledOnly) list = list.filter((r) => (r._count?.users ?? 0) === 0);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.department?.name ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [roles, levelFilter, showUnfilledOnly, search]);

  const grouped = useMemo(() => {
    const m = new Map<Level, ApiRole[]>();
    for (const r of filtered) {
      const k: Level = r.level ?? "EMPLOYEE";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return LEVEL_ORDER
      .map((l) => ({
        level: l,
        items: (m.get(l) ?? []).slice().sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  // ─── KPIs ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = roles ?? [];
    const totalHeadcount = list.reduce((acc, r) => acc + (r._count?.users ?? 0), 0);
    const unfilled = list.filter((r) => (r._count?.users ?? 0) === 0).length;
    const levelCount = new Set(list.map((r) => r.level ?? "EMPLOYEE")).size;
    return { total: list.length, totalHeadcount, unfilled, levelCount };
  }, [roles]);

  const levelCounts = useMemo(() => {
    const list = roles ?? [];
    const m = new Map<Level, number>();
    for (const r of list) {
      const k: Level = r.level ?? "EMPLOYEE";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [roles]);

  return (
    <>
      <OsTitleBar
        title="Roles"
        Icon={Briefcase}
        iconGradient={GRAD.purpleIndigo}
        description={roles === null
          ? "Loading roles…"
          : `${stats.total} role${stats.total === 1 ? "" : "s"} · ${stats.totalHeadcount} people${stats.unfilled > 0 ? ` · ${stats.unfilled} unfilled` : ""}`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={4}
        actions={
          <div className="rls__head-actions">
            <button type="button" className="rls__back" onClick={() => history.back()}>
              <ArrowLeft /> People
            </button>
            <Link href="/people/departments" className="rls__nav-link"><Building2 /> Departments</Link>
            <Link href="/people/skills" className="rls__nav-link"><GraduationCap /> Skills</Link>
            <button type="button" className="rls__btn-primary" onClick={quickAdd}>
              <Plus /> New role
            </button>
          </div>
        }
      />

      <div className="rls">
        {/* KPIs */}
        <div className="rls__kpis">
          <KpiTile accent="var(--os-c-purple)" Icon={Briefcase} label="Roles defined" value={`${stats.total}`}        sub="job titles" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Users}     label="Headcount"     value={`${stats.totalHeadcount}`} sub="filling roles" />
          <KpiTile accent={stats.unfilled > 0 ? "var(--os-c-orange)" : "var(--os-c-green)"}
                   Icon={UserX} label="Unfilled" value={`${stats.unfilled}`} sub={stats.unfilled > 0 ? "needs hiring" : "all positions filled"} />
          <KpiTile accent="var(--os-c-teal)"   Icon={Layers}    label="Levels"        value={`${stats.levelCount}`}   sub="org tiers in use" />
        </div>

        {/* Toolbar */}
        <div className="rls__toolbar">
          <div className="rls__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search role title, department, description…"
              aria-label="Search roles"
            />
          </div>
          <label className="rls__unfilled-toggle">
            <input type="checkbox" checked={showUnfilledOnly} onChange={(e) => setShowUnfilledOnly(e.target.checked)} />
            <span>Unfilled only</span>
          </label>
        </div>

        {/* Level filter chips */}
        {LEVEL_ORDER.some((l) => (levelCounts.get(l) ?? 0) > 0) && (
          <div className="rls__levels">
            <button
              type="button"
              className={`rls__level${levelFilter === null ? " is-active" : ""}`}
              onClick={() => setLevelFilter(null)}
            >
              All levels <span className="rls__level-count">{stats.total}</span>
            </button>
            {LEVEL_ORDER.filter((l) => (levelCounts.get(l) ?? 0) > 0)
              .sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])
              .map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`rls__level${levelFilter === l ? " is-active" : ""}`}
                  style={{ ["--lvl-c" as unknown as string]: LEVEL_COLORS[l] }}
                  onClick={() => setLevelFilter(l)}
                >
                  <span className="rls__level-dot" />
                  {LEVEL_LABELS[l]}
                  <span className="rls__level-count">{levelCounts.get(l) ?? 0}</span>
                </button>
              ))}
          </div>
        )}

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Briefcase} iconGradient={GRAD.redPink} title="Couldn't load roles" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : roles === null ? (
          <div className="rls__loading">Loading roles…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Briefcase}
            iconGradient={GRAD.purpleIndigo}
            title="No roles defined yet"
            subtitle="Roles are job titles your org uses — 'Senior Engineer', 'AE', 'Director of Ops'. Each role gets an access level that controls what its holders can see."
            cta="New role"
          />
        ) : grouped.length === 0 ? (
          <div className="rls__empty">
            <Search />
            <div>No roles match these filters.</div>
            <button type="button" className="rls__empty-reset" onClick={() => { setSearch(""); setLevelFilter(null); setShowUnfilledOnly(false); }}>Clear filters</button>
          </div>
        ) : (
          grouped.map((g) => (
            <section
              key={g.level}
              className="rls__group"
              style={{ ["--g-c" as unknown as string]: LEVEL_COLORS[g.level] }}
            >
              <header className="rls__group-head">
                <span className="rls__group-pill">{LEVEL_SHORT[g.level]}</span>
                <h2 className="rls__group-title">{LEVEL_LABELS[g.level]}</h2>
                <span className="rls__group-count">{g.items.length} role{g.items.length === 1 ? "" : "s"}</span>
                <span className="rls__group-headcount">
                  {g.items.reduce((acc, r) => acc + (r._count?.users ?? 0), 0)} people
                </span>
                <span className="rls__group-line" />
              </header>
              <div className="rls__grid">
                {g.items.map((r) => <RoleCard key={r.id} role={r} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function RoleCard({ role: r }: { role: ApiRole }) {
  const count = r._count?.users ?? 0;
  const isUnfilled = count === 0;
  const levelColor = LEVEL_COLORS[r.level ?? "EMPLOYEE"];
  return (
    <article className={`rls__card${isUnfilled ? " is-unfilled" : ""}`} style={{ ["--card-c" as unknown as string]: levelColor }}>
      <header className="rls__card-head">
        <h3 className="rls__card-title">{r.title}</h3>
        <span className={`rls__card-count${isUnfilled ? " is-zero" : ""}`}>
          <Users /> {count}
        </span>
      </header>

      <div className="rls__card-tags">
        <span className="rls__card-level">{LEVEL_SHORT[r.level ?? "EMPLOYEE"]}</span>
        {r.department?.name && (
          <span className="rls__card-dept" style={{ ["--dept-c" as unknown as string]: deptColor(r.department.name) }}>
            <Building2 /> {r.department.name}
          </span>
        )}
        {isUnfilled && (
          <span className="rls__card-vacant">
            <UserX /> Open position
          </span>
        )}
      </div>

      {r.description && (
        <p className="rls__card-desc">{r.description.length > 140 ? r.description.slice(0, 140) + "…" : r.description}</p>
      )}
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Briefcase; label: string; value: string; sub: string }) {
  return (
    <div className="rls__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="rls__kpi-accent" aria-hidden="true" />
      <div className="rls__kpi-row">
        <div className="rls__kpi-icon"><Icon /></div>
        <div className="rls__kpi-label">{label}</div>
      </div>
      <div className="rls__kpi-value">{value}</div>
      <div className="rls__kpi-sub">{sub}</div>
    </div>
  );
}
