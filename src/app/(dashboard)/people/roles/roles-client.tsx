"use client";

/* People · Roles — job-title library with level chips.
 *
 *  GET   /api/roles
 *  POST  /api/roles  { title, level }
 *
 * Layout:
 *   Breadcrumb header (Teams / Roles) with icon tile + nav links + New role.
 *   TeamStatTile strip: Roles · Headcount · Unfilled · Levels.
 *   Toolbar: search + level filter chips (C-Suite, VP, Director, etc.).
 *   Grouped sections by level: each with header pill + count + role cards.
 *   Cards: title + level chip + dept + headcount badge (orange when 0).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, Plus, Users, Search, Building2, UserX,
  Layers, GraduationCap, Trash2,
} from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { usePrompt, useConfirm } from "@/components/ui/dialog-provider";
import { TeamStatTile } from "@/components/team/ui";

// Every AccessLevel the schema knows today, plus "OTHER" — a safe bucket
// for levels a future migration adds before this page learns about them.
// A role must NEVER silently vanish from the library because of its level.
type Level = "EMPLOYEE" | "AGENT" | "TEAM_LEAD" | "MANAGER" | "DIRECTOR" | "VP" | "C_LEVEL" | "HR" | "COMPANY_ADMIN" | "SUPER_ADMIN" | "OTHER";

type ApiRole = {
  id: string;
  title: string;
  description?: string | null;
  level?: string | null;
  department?: { id: string; name: string } | null;
  _count?: { users?: number };
};

const LEVEL_ORDER: Level[] = ["C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR", "COMPANY_ADMIN", "SUPER_ADMIN", "OTHER"];
const LEVEL_LABELS: Record<Level, string> = {
  C_LEVEL: "C-Suite", VP: "VPs", DIRECTOR: "Directors", MANAGER: "Managers",
  TEAM_LEAD: "Team leads", EMPLOYEE: "Individual contributors", AGENT: "Agents",
  HR: "HR", COMPANY_ADMIN: "Company admin", SUPER_ADMIN: "Super admin", OTHER: "Other levels",
};
const LEVEL_SHORT: Record<Level, string> = {
  C_LEVEL: "C-Suite", VP: "VP", DIRECTOR: "Director", MANAGER: "Manager",
  TEAM_LEAD: "Team lead", EMPLOYEE: "IC", AGENT: "Agent", HR: "HR",
  COMPANY_ADMIN: "Admin", SUPER_ADMIN: "Super", OTHER: "Other",
};
const LEVEL_COLORS: Record<Level, string> = {
  C_LEVEL: C.red, VP: C.brown, DIRECTOR: C.orange, MANAGER: C.blue,
  TEAM_LEAD: C.teal, EMPLOYEE: C.sage, AGENT: C.lime, HR: C.yellow,
  COMPANY_ADMIN: C.gray, SUPER_ADMIN: C.gray, OTHER: C.gray,
};
const LEVEL_RANK: Record<Level, number> = {
  C_LEVEL: 8, VP: 7, DIRECTOR: 6, MANAGER: 5, TEAM_LEAD: 4,
  HR: 3, EMPLOYEE: 2, AGENT: 1, COMPANY_ADMIN: 0, SUPER_ADMIN: 0, OTHER: 0,
};

/** Null/undefined keeps the old EMPLOYEE default; unknown strings bucket
 *  into OTHER instead of dropping the role from every group and chip. */
function normalizeLevel(level?: string | null): Level {
  if (!level) return "EMPLOYEE";
  return (LEVEL_ORDER as string[]).includes(level) ? (level as Level) : "OTHER";
}

const DEPT_PALETTE = [C.blue, C.green, C.orange, C.sage, C.teal, C.yellow, C.brown, C.red];
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
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      // no-store + focus refetch: a level changed on the role detail page must
      // regroup here the moment the user comes back — not after a hard refresh.
      const res = await fetch("/api/roles", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoles(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refetch = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const confirm = useConfirm();
  const deleteRole = useCallback(async (r: ApiRole) => {
    const holders = r._count?.users ?? 0;
    if (holders > 0) {
      toast(`${holders} ${holders === 1 ? "person holds" : "people hold"} this role — reassign them first.`);
      return;
    }
    if (!(await confirm({
      title: `Delete role "${r.title}"?`,
      description: "Its KRA templates detach and stay in the library. No people are affected — deletion is refused while anyone holds the role.",
      confirmLabel: "Delete role",
      destructive: true,
    }))) return;
    const res = await fetch(`/api/roles/${r.id}`, { method: "DELETE" });
    if (res.ok) { toast("Role deleted"); void load(); }
    else {
      const d = await res.json().catch(() => ({}));
      toast(d?.error ?? "Couldn't delete the role");
    }
  }, [confirm, toast, load]);

  async function quickAdd() {
    const title = (await promptDialog({ title: "Role title?" }))?.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/roles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, level: "EMPLOYEE" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json().catch(() => null);
      const created = data?.data ?? data;
      toast("Role created");
      // Quick-add only asks for a title — land on the role page where
      // level / department / description are edited, instead of leaving
      // a default-EMPLOYEE role buried in the list.
      if (created?.id) {
        router.push(`/people/roles/${created.id}`);
        return;
      }
      void load();
    } catch { toast("Couldn't create role"); }
  }

  // The Teams "+" → New role routes here with ?new=1; fire quickAdd once.
  const searchParams = useSearchParams();
  const didAutoAdd = useRef(false);
  useEffect(() => {
    if (!didAutoAdd.current && searchParams.get("new") === "1") {
      didAutoAdd.current = true;
      void quickAdd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ─── Filter + group ──────────────────────────────────────
  const filtered = useMemo(() => {
    let list = roles ?? [];
    if (levelFilter) list = list.filter((r) => normalizeLevel(r.level) === levelFilter);
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
      const k = normalizeLevel(r.level);
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
    const levelCount = new Set(list.map((r) => normalizeLevel(r.level))).size;
    return { total: list.length, totalHeadcount, unfilled, levelCount };
  }, [roles]);

  const levelCounts = useMemo(() => {
    const list = roles ?? [];
    const m = new Map<Level, number>();
    for (const r of list) {
      const k = normalizeLevel(r.level);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [roles]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>Roles</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
            <Briefcase className="h-5 w-5 text-[#0073EA]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">Roles</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">
            {roles === null
              ? "loading…"
              : `${stats.total} role${stats.total === 1 ? "" : "s"} · ${stats.totalHeadcount} people${stats.unfilled > 0 ? ` · ${stats.unfilled} unfilled` : ""}`}
          </span>
          <div className="flex-1" />
          <Link href="/people" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Users className="w-3.5 h-3.5 text-zinc-400" /> Directory
          </Link>
          <Link href="/people/departments" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Building2 className="w-3.5 h-3.5 text-zinc-400" /> Departments
          </Link>
          <Link href="/people/skills" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <GraduationCap className="w-3.5 h-3.5 text-zinc-400" /> Skills
          </Link>
          <button type="button" onClick={quickAdd} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#0073EA] text-white text-[13px] font-medium hover:bg-[#0060c2]">
            <Plus className="w-3.5 h-3.5" /> New role
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-[1280px]">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TeamStatTile icon={Briefcase} label="Roles defined" value={stats.total} accent="#0073EA" sub="job titles" />
          <TeamStatTile icon={Users} label="Headcount" value={stats.totalHeadcount} accent="#14B8A6" sub="filling roles" />
          <TeamStatTile icon={UserX} label="Unfilled" value={stats.unfilled} accent={stats.unfilled > 0 ? "#F59E0B" : "#00C875"} sub={stats.unfilled > 0 ? "needs hiring" : "all positions filled"} />
          <TeamStatTile icon={Layers} label="Levels" value={stats.levelCount} accent="#71717A" sub="org tiers in use" />
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
          <OsEmptyView Icon={Briefcase} iconGradient={C.red} title="Couldn't load roles" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : roles === null ? (
          <div className="rls__loading">Loading roles…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Briefcase}
            iconGradient="#0073EA"
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
                {g.items.map((r) => <RoleCard key={r.id} role={r} onDelete={() => void deleteRole(r)} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function RoleCard({ role: r, onDelete }: { role: ApiRole; onDelete: () => void }) {
  const count = r._count?.users ?? 0;
  const isUnfilled = count === 0;
  const level = normalizeLevel(r.level);
  const levelColor = LEVEL_COLORS[level];
  return (
    <Link href={`/people/roles/${r.id}`} className={`rls__card${isUnfilled ? " is-unfilled" : ""}`} style={{ ["--card-c" as unknown as string]: levelColor, cursor: "pointer" }}>
      <header className="rls__card-head">
        <h3 className="rls__card-title">{r.title}</h3>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            title={count > 0 ? "Reassign holders first, then delete" : "Delete role"}
            aria-label={`Delete role ${r.title}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-300 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <span className={`rls__card-count${isUnfilled ? " is-zero" : ""}`}>
            <Users /> {count}
          </span>
        </span>
      </header>

      <div className="rls__card-tags">
        <span className="rls__card-level">{LEVEL_SHORT[level]}</span>
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
    </Link>
  );
}
