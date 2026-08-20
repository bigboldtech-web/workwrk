"use client";

/* People · Directory — photo-card "who's who" of the company.
 *
 *  GET /api/users?limit=500
 *
 * Layout:
 *   Breadcrumb header (Teams / Directory) with icon tile + org nav links.
 *   TeamStatTile strip: Headcount · Departments · New (90d).
 *   Toolbar: search + status tabs (All / Active / New / Former) + sort dropdown.
 *   Department chip row (auto-derived).
 *   Grouped sections by department with colored dot + count + line.
 *   Person cards: TeamAvatar + name/role + dept/office chips + manager line + tenure.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users, Search, Briefcase, MapPin,
  Building2, Sparkles, Network, RotateCcw, Tag as TagIcon,
} from "lucide-react";
import { C } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { TeamStatTile, TeamAvatar } from "@/components/team/ui";
import { useToast } from "@/components/ui/toast";

type ApiUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
  status?: "ACTIVE" | "INACTIVE" | "ON_LEAVE" | "TERMINATED";
  joinDate?: string | null;
  deletedAt?: string | null;
  accessLevel?: string;
  manager?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  role?: { id: string; title: string } | null;
  department?: { id: string; name: string } | null;
  office?: { id: string; name?: string | null; city?: string | null } | null;
  _count?: { directReports?: number };
  tags?: { id: string; name: string; color?: string | null }[];
};

function fullName(u: ApiUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
}

// Brand-safe department palette — no pink/purple in product chrome.
const CAT_COLORS = [C.blue, C.green, C.orange, C.sage, C.teal, C.yellow, C.brown, C.red];
function deptColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

const MS_DAY = 86_400_000;
function tenure(join?: string | null): string {
  if (!join) return "—";
  const days = Math.floor((Date.now() - new Date(join).getTime()) / MS_DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  const y = Math.floor(days / 365); const m = Math.floor((days % 365) / 30);
  return m === 0 ? `${y}y` : `${y}y ${m}mo`;
}
function isNewJoin(join?: string | null): boolean {
  return Boolean(join && (Date.now() - new Date(join).getTime()) < 90 * MS_DAY);
}
type Filter = "all" | "active" | "new" | "former";
type SortKey = "name" | "recent" | "tenure" | "reports";

export default function PeopleDirectoryPage() {
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [former, setFormer] = useState<ApiUser[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeDept, setActiveDept] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { success: toastSuccess, error: toastError } = useToast();

  const load = useCallback(async () => {
    try {
      // includeDeleted feeds the "Former" tab only — every other view
      // works off the active split below, so removed people never leak
      // into headcount, department chips, or the grouped grid.
      const res = await fetch("/api/users?limit=500&includeDeleted=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiUser[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setUsers(list.filter((u) => !u.deletedAt && u.status !== "TERMINATED"));
      setFormer(list.filter((u) => Boolean(u.deletedAt)));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  const restore = useCallback(async (u: ApiUser) => {
    setRestoringId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}?restore=true`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      toastSuccess(`${fullName(u)} restored`);
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoringId(null);
    }
  }, [load, toastSuccess, toastError]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // ─── Departments ─────────────────────────────────────────
  const depts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number; color: string }>();
    for (const u of users ?? []) {
      const id = u.department?.id ?? "__none";
      const name = u.department?.name ?? "Unassigned";
      if (!m.has(id)) m.set(id, { id, name, count: 0, color: deptColor(name) });
      m.get(id)!.count += 1;
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [users]);

  // ─── Tags (auto-derived from loaded people, like departments) ────
  const allTags = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color?: string | null; count: number }>();
    for (const u of users ?? []) {
      for (const t of u.tags ?? []) {
        if (!m.has(t.id)) m.set(t.id, { id: t.id, name: t.name, color: t.color, count: 0 });
        m.get(t.id)!.count += 1;
      }
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [users]);

  // ─── Filter ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = users ?? [];
    if (filter === "new") list = list.filter((u) => u.joinDate && (Date.now() - new Date(u.joinDate).getTime()) < 90 * MS_DAY);
    if (filter === "active") list = list.filter((u) => u.status === "ACTIVE" || !u.status);
    if (activeDept) list = list.filter((u) => (u.department?.id ?? "__none") === activeDept);
    // Tag filter: keep people carrying ANY selected tag (union), matching the
    // /api/users?tagIds= server semantics.
    if (activeTags.size > 0) list = list.filter((u) => (u.tags ?? []).some((t) => activeTags.has(t.id)));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((u) =>
        fullName(u).toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.role?.title ?? "").toLowerCase().includes(q) ||
        (u.tags ?? []).some((t) => t.name.toLowerCase().includes(q)) ||
        (u.department?.name ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [users, filter, activeDept, activeTags, search]);

  // ─── Group (only when no specific dept active) ───────────
  const grouped = useMemo(() => {
    const map = new Map<string, ApiUser[]>();
    for (const u of filtered) {
      const k = u.department?.name ?? "Unassigned";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(u);
    }
    const sortFn = sortFor(sortKey);
    for (const arr of map.values()) arr.sort(sortFn);
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, people]) => ({ name, color: deptColor(name), people }));
  }, [filtered, sortKey]);

  const flatSorted = useMemo(() => filtered.slice().sort(sortFor(sortKey)), [filtered, sortKey]);

  // Former teammates — search applies; dept chips and status logic don't.
  const formerFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? former.filter((u) =>
          fullName(u).toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.role?.title ?? "").toLowerCase().includes(q) ||
          (u.department?.name ?? "").toLowerCase().includes(q))
      : former;
    return list.slice().sort((a, b) =>
      (b.deletedAt ? new Date(b.deletedAt).getTime() : 0) - (a.deletedAt ? new Date(a.deletedAt).getTime() : 0));
  }, [former, search]);

  // ─── KPIs ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = users ?? [];
    const newHires = list.filter((u) => u.joinDate && (Date.now() - new Date(u.joinDate).getTime()) < 90 * MS_DAY).length;
    return { total: list.length, depts: depts.length, newHires };
  }, [users, depts.length]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>Directory</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
            <Users className="h-5 w-5 text-[#0073EA]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">Directory</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">{users === null ? "loading…" : `${stats.total} people · ${stats.depts} departments`}</span>
          <div className="flex-1" />
          <Link href="/organization" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[14px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Network className="w-3.5 h-3.5 text-zinc-400" /> Org chart
          </Link>
          <Link href="/people/roles" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[14px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Briefcase className="w-3.5 h-3.5 text-zinc-400" /> Roles
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-[1280px]">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <TeamStatTile icon={Users} label="Headcount" value={stats.total} accent="#0073EA" sub="active teammates" />
          <TeamStatTile icon={Building2} label="Departments" value={stats.depts} accent="#71717A" sub="org units" />
          <TeamStatTile icon={Sparkles} label="New (90d)" value={stats.newHires} accent="#16a34a" sub="recent joiners" />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-zinc-200 flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-zinc-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find anyone by name, role, dept, email…" aria-label="Search people" className="flex-1 text-[14px] bg-transparent outline-none placeholder:text-zinc-400" />
          </div>
          <div className="inline-flex items-center gap-1">
            {([["all", "All"], ["active", "Active"], ["new", "New"], ["former", "Former"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={`h-8 px-2.5 rounded-md text-[13.5px] ${filter === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>{label}</button>
            ))}
          </div>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 px-2 rounded-md border border-zinc-200 text-[13.5px] text-zinc-600 outline-none">
            <option value="name">A–Z</option>
            <option value="recent">Recently joined</option>
            <option value="tenure">Longest tenure</option>
            <option value="reports">Most reports</option>
          </select>
        </div>

        {/* Department chips (actives only — hidden on the Former tab) */}
        {filter !== "former" && depts.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => setActiveDept(null)} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] border ${activeDept === null ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
              All <span className="opacity-60">{stats.total}</span>
            </button>
            {depts.map((d) => (
              <button key={d.id} type="button" onClick={() => setActiveDept(d.id)} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] border ${activeDept === d.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                {d.name}
                <span className="opacity-60">{d.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* Tag filter row — auto-derived from people's tags. Click to segment the
            directory by tag (union). Hidden on Former and when no tags exist. */}
        {filter !== "former" && allTags.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[12px] uppercase tracking-wide text-zinc-400 font-semibold mr-0.5">
              <TagIcon className="w-3 h-3" /> Tags
            </span>
            {allTags.map((t) => {
              const on = activeTags.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    setActiveTags((prev) => {
                      const n = new Set(prev);
                      if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                      return n;
                    })
                  }
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] border transition ${on ? "border-transparent text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
                  style={on ? { background: t.color ?? "#18181b" } : t.color ? { color: t.color } : undefined}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: on ? "rgba(255,255,255,0.85)" : (t.color ?? "#a1a1aa") }} />
                  {t.name}
                  <span className="opacity-60">{t.count}</span>
                </button>
              );
            })}
            {activeTags.size > 0 ? (
              <button type="button" onClick={() => setActiveTags(new Set())} className="text-[12.5px] text-zinc-500 hover:text-zinc-800 ml-1">
                Clear tags
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Body */}
        {loadError ? (
          <div className="border border-zinc-200 rounded-xl px-6 py-12 text-center text-sm text-zinc-500">Couldn&rsquo;t load people — {loadError}</div>
        ) : users === null ? (
          <div className="text-sm text-zinc-400 py-8 text-center">Loading directory…</div>
        ) : filter === "former" ? (
          formerFiltered.length === 0 ? (
            <div className="border border-zinc-200 rounded-xl px-6 py-10 text-center text-sm text-zinc-500">
              {former.length === 0
                ? "No former teammates. People removed from the company land here and can be restored."
                : "No former teammates match this search."}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {formerFiltered.map((u) => (
                <FormerPersonCard key={u.id} user={u} onRestore={() => restore(u)} restoring={restoringId === u.id} />
              ))}
            </div>
          )
        ) : stats.total === 0 ? (
          <div className="border border-zinc-200 rounded-xl px-6 py-12 text-center">
            <div className="text-base font-medium text-zinc-900 mb-1">No teammates yet</div>
            <p className="text-sm text-zinc-500">Invite people from Workspace settings or HR onboarding.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-zinc-200 rounded-xl px-6 py-10 text-center text-sm text-zinc-500">
            No one matches these filters.
            <button type="button" className="text-[var(--os-brand)] hover:underline ml-1.5" onClick={() => { setActiveDept(null); setFilter("all"); setSearch(""); setActiveTags(new Set()); }}>Clear</button>
          </div>
        ) : activeDept ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {flatSorted.map((u) => <PersonCard key={u.id} user={u} />)}
          </div>
        ) : (
          grouped.map((g) => (
            <section key={g.name}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                <h2 className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">{g.name}</h2>
                <span className="text-[12px] text-zinc-400">{g.people.length}</span>
                <span className="flex-1 h-px bg-zinc-100" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.people.map((u) => <PersonCard key={u.id} user={u} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function sortFor(sortKey: SortKey) {
  return (a: ApiUser, b: ApiUser) => {
    if (sortKey === "name") return fullName(a).localeCompare(fullName(b));
    if (sortKey === "recent") {
      return (b.joinDate ? new Date(b.joinDate).getTime() : 0) - (a.joinDate ? new Date(a.joinDate).getTime() : 0);
    }
    if (sortKey === "tenure") {
      return (a.joinDate ? new Date(a.joinDate).getTime() : Infinity) - (b.joinDate ? new Date(b.joinDate).getTime() : Infinity);
    }
    if (sortKey === "reports") {
      return (b._count?.directReports ?? 0) - (a._count?.directReports ?? 0);
    }
    return 0;
  };
}

/* A removed (soft-deleted) person: greyed card, "Removed {date}" chip,
 * one-click Restore (DELETE /api/users/[id]?restore=true). The name
 * still links to the profile — history survives removal by design. */
function FormerPersonCard({ user: u, onRestore, restoring }: { user: ApiUser; onRestore: () => void; restoring: boolean }) {
  const name = fullName(u);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <div className="opacity-50 grayscale shrink-0"><TeamAvatar name={name} avatar={u.avatar} size={40} /></div>
        <div className="min-w-0 flex-1">
          <Link href={`/people/${u.id}`} className="block text-[14.5px] font-medium text-zinc-500 truncate hover:text-zinc-800">
            {name}
          </Link>
          <div className="text-[13px] text-zinc-400 truncate">{u.role?.title || u.email || ""}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap text-[12px]">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#E2445C]/10 text-[#E2445C]">
          Removed {u.deletedAt ? new Date(u.deletedAt).toLocaleDateString() : ""}
        </span>
        {u.department?.name ? <span className="text-zinc-400">{u.department.name}</span> : null}
        <button
          type="button"
          onClick={onRestore}
          disabled={restoring}
          className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
        >
          <RotateCcw className="w-3 h-3" /> {restoring ? "Restoring…" : "Restore"}
        </button>
      </div>
    </div>
  );
}

function PersonCard({ user: u }: { user: ApiUser }) {
  const name = fullName(u);
  const isNew = isNewJoin(u.joinDate);
  const reports = u._count?.directReports ?? 0;

  return (
    <Link href={`/people/${u.id}`} className="block rounded-xl border border-zinc-200 bg-white p-3 hover:border-zinc-300 hover:shadow-sm transition">
      <div className="flex items-center gap-3">
        <TeamAvatar name={name} avatar={u.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-zinc-900 truncate flex items-center gap-1.5">
            <span className="truncate">{name}</span>
            {isNew ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 shrink-0">New</span> : null}
          </div>
          {u.role?.title ? <div className="text-[13px] text-zinc-500 truncate">{u.role.title}</div> : null}
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap text-[12px]">
        {u.department?.name ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded" style={{ background: `${deptColor(u.department.name)}1a`, color: deptColor(u.department.name) }}>{u.department.name}</span>
        ) : null}
        {u.office?.city ? <span className="inline-flex items-center gap-1 text-zinc-500"><MapPin className="w-3 h-3" />{u.office.city}</span> : null}
        <span className="text-zinc-400 tabular-nums ml-auto">{tenure(u.joinDate)}{reports > 0 ? ` · ${reports} report${reports === 1 ? "" : "s"}` : ""}</span>
      </div>
      {u.tags && u.tags.length > 0 ? (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {u.tags.slice(0, 4).map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11.5px]"
              style={t.color ? { background: `${t.color}1a`, color: t.color } : { background: "#f4f4f5", color: "#52525b" }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color ?? "#a1a1aa" }} />
              {t.name}
            </span>
          ))}
          {u.tags.length > 4 ? <span className="text-[11.5px] text-zinc-400">+{u.tags.length - 4}</span> : null}
        </div>
      ) : null}
      {u.manager ? (
        <div className="mt-1.5 text-[12px] text-zinc-400 truncate flex items-center gap-1">
          <Briefcase className="w-3 h-3 shrink-0" /> Reports to {[u.manager.firstName, u.manager.lastName].filter(Boolean).join(" ") || "Manager"}
        </div>
      ) : null}
    </Link>
  );
}
