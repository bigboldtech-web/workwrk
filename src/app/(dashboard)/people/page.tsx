"use client";

/* People · Directory — photo-card "who's who" of the company.
 *
 *  GET /api/users?limit=500
 *
 * Layout:
 *   OsTitleBar with org nav links in actions.
 *   4-tile KPI strip: Total · Departments · On leave · New (last 30d).
 *   Toolbar: search + status tabs (All / On leave / New) + sort dropdown.
 *   Department chip row (auto-derived).
 *   Grouped sections by department with colored dot + count + line.
 *   Photo cards: gradient avatar tile + name/role + dept/office chips + manager line + tenure pill.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users, Search, Mail, Briefcase, MapPin, UserPlus, ChevronDown,
  Building2, Sparkles, Hash, Network, GraduationCap, ArrowLeft,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
  status?: "ACTIVE" | "INACTIVE" | "ON_LEAVE" | "TERMINATED";
  joinDate?: string | null;
  accessLevel?: string;
  manager?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  role?: { id: string; title: string } | null;
  department?: { id: string; name: string } | null;
  office?: { id: string; name?: string | null; city?: string | null } | null;
  _count?: { directReports?: number };
};

const AV_GRADIENTS = [
  GRAD.bluePurple, GRAD.greenTeal, GRAD.pinkPurple, GRAD.indigoBlue,
  GRAD.orangePink, GRAD.purpleIndigo, GRAD.tealGreen, GRAD.yellowOrange,
];
function avGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_GRADIENTS[h % AV_GRADIENTS.length];
}
function initials(f?: string | null, l?: string | null): string {
  return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?";
}
function fullName(u: ApiUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
}

const CAT_COLORS = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
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
function tenureTone(join?: string | null): "new" | "regular" | "veteran" {
  if (!join) return "regular";
  const days = (Date.now() - new Date(join).getTime()) / MS_DAY;
  if (days < 90) return "new";
  if (days > 365 * 3) return "veteran";
  return "regular";
}

type Filter = "all" | "active" | "on-leave" | "new";
type SortKey = "name" | "recent" | "tenure" | "reports";

export default function PeopleDirectoryPage() {
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeDept, setActiveDept] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users?limit=500");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiUser[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setUsers(list.filter((u) => u.status !== "TERMINATED"));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
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

  // ─── Filter ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = users ?? [];
    if (filter === "on-leave") list = list.filter((u) => u.status === "ON_LEAVE");
    if (filter === "new") list = list.filter((u) => u.joinDate && (Date.now() - new Date(u.joinDate).getTime()) < 90 * MS_DAY);
    if (filter === "active") list = list.filter((u) => u.status === "ACTIVE" || !u.status);
    if (activeDept) list = list.filter((u) => (u.department?.id ?? "__none") === activeDept);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((u) =>
        fullName(u).toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.role?.title ?? "").toLowerCase().includes(q) ||
        (u.department?.name ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [users, filter, activeDept, search]);

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

  // ─── KPIs ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = users ?? [];
    const onLeave = list.filter((u) => u.status === "ON_LEAVE").length;
    const newHires = list.filter((u) => u.joinDate && (Date.now() - new Date(u.joinDate).getTime()) < 90 * MS_DAY).length;
    return { total: list.length, depts: depts.length, onLeave, newHires };
  }, [users, depts.length]);

  return (
    <>
      <OsTitleBar
        title="People"
        Icon={Users}
        iconGradient={GRAD.bluePurple}
        description={users === null
          ? "Loading directory…"
          : `${stats.total} teammate${stats.total === 1 ? "" : "s"} · ${stats.depts} department${stats.depts === 1 ? "" : "s"}${stats.onLeave > 0 ? ` · ${stats.onLeave} on leave` : ""}`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={Math.max(0, stats.total - 3)}
        actions={
          <div className="ppl__head-actions">
            <Link href="/people/departments" className="ppl__nav-link"><Network /> Org chart</Link>
            <Link href="/people/roles" className="ppl__nav-link"><Briefcase /> Roles</Link>
            <Link href="/people/skills" className="ppl__nav-link"><GraduationCap /> Skills</Link>
            <button type="button" className="ppl__btn-primary" onClick={() => alert("Invite people via Workspace settings.")}>
              <UserPlus /> Invite
            </button>
          </div>
        }
      />

      <div className="ppl">
        {/* KPIs */}
        <div className="ppl__kpis">
          <KpiTile accent="var(--os-c-blue)"   Icon={Users}     label="Headcount"   value={`${stats.total}`}     sub="all active teammates" />
          <KpiTile accent="var(--os-c-purple)" Icon={Building2} label="Departments" value={`${stats.depts}`}     sub="org units" />
          <KpiTile accent="var(--os-c-orange)" Icon={ArrowLeft} label="On leave"    value={`${stats.onLeave}`}   sub={stats.onLeave > 0 ? "back when noted" : "everyone here"} />
          <KpiTile accent="var(--os-c-green)"  Icon={Sparkles}  label="New (90d)"   value={`${stats.newHires}`}  sub="recent joiners" />
        </div>

        {/* Toolbar */}
        <div className="ppl__toolbar">
          <div className="ppl__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find anyone by name, role, dept, email…"
              aria-label="Search people"
            />
          </div>
          <div className="ppl__tabs">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <span>{stats.total}</span></button>
            <button type="button" className={filter === "active" ? "is-active" : ""} onClick={() => setFilter("active")}>Active</button>
            <button type="button" className={`${filter === "on-leave" ? "is-active" : ""} ${stats.onLeave > 0 ? "is-warn" : ""}`} onClick={() => setFilter("on-leave")}>On leave <span>{stats.onLeave}</span></button>
            <button type="button" className={filter === "new" ? "is-active" : ""} onClick={() => setFilter("new")}>New <span>{stats.newHires}</span></button>
          </div>
          <div className="ppl__sort">
            <span>Sort</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="ppl__sort-select">
              <option value="name">A–Z</option>
              <option value="recent">Recently joined</option>
              <option value="tenure">Longest tenure</option>
              <option value="reports">Most reports</option>
            </select>
            <ChevronDown />
          </div>
        </div>

        {/* Department chips */}
        {depts.length > 0 && (
          <div className="ppl__depts">
            <button
              type="button"
              className={`ppl__dept${activeDept === null ? " is-active" : ""}`}
              onClick={() => setActiveDept(null)}
            >
              <Hash /> All departments <span className="ppl__dept-count">{stats.total}</span>
            </button>
            {depts.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`ppl__dept${activeDept === d.id ? " is-active" : ""}`}
                style={{ ["--dept-c" as unknown as string]: d.color }}
                onClick={() => setActiveDept(d.id)}
              >
                <span className="ppl__dept-dot" />
                {d.name}
                <span className="ppl__dept-count">{d.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Users} iconGradient={GRAD.redPink} title="Couldn't load people" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : users === null ? (
          <div className="ppl__loading">Loading directory…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={UserPlus}
            iconGradient={GRAD.bluePurple}
            title="No teammates yet"
            subtitle="Invite people from Workspace settings or HR onboarding."
            cta="Invite"
          />
        ) : filtered.length === 0 ? (
          <div className="ppl__empty">
            <Search />
            <div>No one matches these filters.</div>
            <button type="button" className="ppl__empty-reset" onClick={() => { setActiveDept(null); setFilter("all"); setSearch(""); }}>Clear filters</button>
          </div>
        ) : activeDept ? (
          // Single dept selected — flat grid
          <div className="ppl__grid">
            {flatSorted.map((u) => <PersonCard key={u.id} user={u} />)}
          </div>
        ) : (
          // Grouped by department
          grouped.map((g) => (
            <section key={g.name} className="ppl__group" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="ppl__group-head">
                <span className="ppl__group-dot" />
                <h2 className="ppl__group-title">{g.name}</h2>
                <span className="ppl__group-count">{g.people.length}</span>
                <span className="ppl__group-line" />
              </header>
              <div className="ppl__grid">
                {g.people.map((u) => <PersonCard key={u.id} user={u} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
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

function PersonCard({ user: u }: { user: ApiUser }) {
  const av = avGradient(u.id);
  const initials_ = initials(u.firstName, u.lastName);
  const name = fullName(u);
  const tone = tenureTone(u.joinDate);
  const onLeave = u.status === "ON_LEAVE";
  const isNew = u.joinDate && (Date.now() - new Date(u.joinDate).getTime()) < 90 * MS_DAY;
  const reports = u._count?.directReports ?? 0;

  return (
    <Link href={`/people/${u.id}`} className={`ppl__card${onLeave ? " is-leave" : ""}`}>
      <div className="ppl__card-cover" style={{ background: av }} aria-hidden="true">
        <span className="ppl__card-init">{initials_}</span>
        {onLeave && <span className="ppl__card-leave">On leave</span>}
        {isNew && !onLeave && <span className="ppl__card-new">New</span>}
      </div>

      <div className="ppl__card-body">
        <div className="ppl__card-name">{name}</div>
        {u.role?.title && <div className="ppl__card-role">{u.role.title}</div>}

        <div className="ppl__card-tags">
          {u.department?.name && (
            <span className="ppl__card-dept" style={{ ["--dept-c" as unknown as string]: deptColor(u.department.name) }}>
              {u.department.name}
            </span>
          )}
          {u.office?.city && (
            <span className="ppl__card-loc">
              <MapPin /> {u.office.city}
            </span>
          )}
        </div>

        {u.email && (
          <a href={`mailto:${u.email}`} className="ppl__card-email" onClick={(e) => e.stopPropagation()}>
            <Mail /> <span>{u.email}</span>
          </a>
        )}

        {u.manager && (
          <div className="ppl__card-mgr">
            <Briefcase /> Reports to {[u.manager.firstName, u.manager.lastName].filter(Boolean).join(" ") || "Manager"}
          </div>
        )}
      </div>

      <div className="ppl__card-foot">
        <span className={`ppl__card-tenure ppl__card-tenure--${tone}`}>{tenure(u.joinDate)}</span>
        {reports > 0 && (
          <span className="ppl__card-reports">
            <Users /> {reports} report{reports === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Users; label: string; value: string; sub: string }) {
  return (
    <div className="ppl__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="ppl__kpi-accent" aria-hidden="true" />
      <div className="ppl__kpi-row">
        <div className="ppl__kpi-icon"><Icon /></div>
        <div className="ppl__kpi-label">{label}</div>
      </div>
      <div className="ppl__kpi-value">{value}</div>
      <div className="ppl__kpi-sub">{sub}</div>
    </div>
  );
}
