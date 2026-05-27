"use client";

/* People · Directory — the company "who's who".
 *
 * Top: search + horizontal department-filter chips. Below: people cards
 * grouped by department. Each card: avatar, name, title, email, manager
 * (if any), tenure chip, direct-reports count, on-leave badge.
 *
 * Reads: GET /api/users?limit=500
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Users, Search, Mail, Briefcase, MapPin, UserPlus } from "lucide-react";
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

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

const MS_DAY = 86_400_000;
function tenure(join?: string | null): string {
  if (!join) return "—";
  const days = Math.floor((Date.now() - new Date(join).getTime()) / MS_DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  const y = Math.floor(days / 365); const m = Math.floor((days % 365) / 30);
  return m === 0 ? `${y}y` : `${y}y ${m}mo`;
}

export default function PeopleDirectoryPage() {
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeDept, setActiveDept] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users?limit=500");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiUser[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setUsers(list.filter((u) => u.status !== "TERMINATED"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const filtered = useMemo(() => {
    let list = users ?? [];
    if (activeDept) list = list.filter((u) => (u.department?.id ?? "__none") === activeDept);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((u) =>
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.role?.title ?? "").toLowerCase().includes(q) ||
        (u.department?.name ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, activeDept, search]);

  const depts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const u of users ?? []) {
      const id = u.department?.id ?? "__none";
      const name = u.department?.name ?? "No department";
      if (!m.has(id)) m.set(id, { id, name, count: 0 });
      m.get(id)!.count += 1;
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [users]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiUser[]>();
    for (const u of filtered) {
      const k = u.department?.name ?? "No department";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(u);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const total = users?.length ?? 0;
  const onLeave = (users ?? []).filter((u) => u.status === "ON_LEAVE").length;

  return (
    <div className="pdir">
      <header className="pdir__head">
        <div className="pdir__head-l">
          <div className="pdir__icon"><Users /></div>
          <div>
            <h1 className="pdir__title">People directory</h1>
            <div className="pdir__sub">
              {users === null ? "Loading…" : `${total} teammate${total === 1 ? "" : "s"} · ${depts.length} department${depts.length === 1 ? "" : "s"}${onLeave > 0 ? ` · ${onLeave} on leave` : ""}`}
            </div>
          </div>
        </div>
        <div className="pdir__actions">
          <div className="pdir__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find anyone by name, role, dept, email…" />
          </div>
          <Link href="/organization" className="pdir__link">Org chart →</Link>
        </div>
      </header>

      <nav className="pdir__dept-filter">
        <button type="button" className={!activeDept ? "is-active" : ""} onClick={() => setActiveDept(null)}>
          All <em>{total}</em>
        </button>
        {depts.map((d) => (
          <button key={d.id} type="button" className={activeDept === d.id ? "is-active" : ""} onClick={() => setActiveDept(d.id)}>
            {d.name} <em>{d.count}</em>
          </button>
        ))}
      </nav>

      {loadError ? (
        <div className="pdir__error">{loadError}</div>
      ) : users === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="pdir__empty">
          <UserPlus />
          <div>
            <h3>{search ? "Nobody matches that search." : "No teammates yet"}</h3>
            <p>{search ? "Try a different name or role." : "Invite people from Workspace → Settings or HR → Onboarding."}</p>
          </div>
        </div>
      ) : (
        <div className="pdir__sections">
          {grouped.map(([dept, items]) => (
            <section key={dept} className="pdir__section">
              <header className="pdir__section-head">
                <h2>{dept}</h2>
                <span>{items.length}</span>
              </header>
              <div className="pdir__grid">
                {items.map((u) => (
                  <Link key={u.id} href={`/people/${u.id}`} className={`pcard ${u.status === "ON_LEAVE" ? "is-leave" : ""}`}>
                    <div className="pcard__head">
                      <span className="pcard__av" style={{ background: avColor(u.id) }}>{initials(u.firstName, u.lastName)}</span>
                      <div className="pcard__id">
                        <div className="pcard__name">{[u.firstName, u.lastName].filter(Boolean).join(" ")}</div>
                        <div className="pcard__role">{u.role?.title ?? "—"}</div>
                      </div>
                    </div>
                    <div className="pcard__meta">
                      {u.email && (
                        <a href={`mailto:${u.email}`} className="pcard__email" onClick={(e) => e.stopPropagation()}>
                          <Mail /> {u.email}
                        </a>
                      )}
                      {u.manager && (
                        <span className="pcard__reports"><Briefcase /> Reports to {[u.manager.firstName, u.manager.lastName].filter(Boolean).join(" ")}</span>
                      )}
                      {u.office?.city && (
                        <span className="pcard__loc"><MapPin /> {u.office.city}</span>
                      )}
                    </div>
                    <footer className="pcard__foot">
                      <span className="pcard__tenure">{tenure(u.joinDate)} with us</span>
                      {(u._count?.directReports ?? 0) > 0 && (
                        <span className="pcard__direct-reports">{u._count!.directReports} direct report{u._count!.directReports === 1 ? "" : "s"}</span>
                      )}
                      {u.status === "ON_LEAVE" && <span className="pcard__leave-chip">On leave</span>}
                    </footer>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
