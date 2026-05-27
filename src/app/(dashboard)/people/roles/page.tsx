"use client";

/* People · Roles — job-title catalog grouped by access level.
 *
 * Roles are job titles your org defines (e.g. "Senior Engineer",
 * "Account Executive"). Each row shows headcount filling that role,
 * its access level (EMPLOYEE / MANAGER / DIRECTOR / VP / C_LEVEL),
 * and its parent department. Groups by level so you can audit the
 * org pyramid at a glance.
 *
 * Reads: GET /api/roles
 * Write: POST /api/roles  (quick-create via prompt)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Plus, Users } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

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
const LEVEL_LABEL: Record<Level, string> = {
  C_LEVEL: "C-Suite", VP: "VPs", DIRECTOR: "Directors", MANAGER: "Managers",
  TEAM_LEAD: "Team leads", EMPLOYEE: "Individual contributors",
  HR: "HR", COMPANY_ADMIN: "Company admin", SUPER_ADMIN: "Super admin",
};
const LEVEL_HUE: Record<Level, string> = {
  C_LEVEL: "var(--os-c-purple)", VP: "var(--os-c-pink)", DIRECTOR: "var(--os-c-indigo)",
  MANAGER: "var(--os-c-blue)", TEAM_LEAD: "var(--os-c-teal)", EMPLOYEE: "var(--os-c-darkgray)",
  HR: "var(--os-c-orange)", COMPANY_ADMIN: "var(--os-c-red)", SUPER_ADMIN: "var(--os-c-red)",
};

export default function RolesPage() {
  const [roles, setRoles] = useState<ApiRole[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/roles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoles(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const title = window.prompt("Role title?")?.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/roles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, level: "EMPLOYEE" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't create role"); }
  }

  const grouped = useMemo(() => {
    const m = new Map<Level, ApiRole[]>();
    for (const r of roles ?? []) {
      const k: Level = r.level ?? "EMPLOYEE";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return LEVEL_ORDER.map((l) => ({ level: l, items: m.get(l) ?? [] })).filter((g) => g.items.length > 0);
  }, [roles]);

  const total = roles?.length ?? 0;
  const totalHeadcount = (roles ?? []).reduce((acc, r) => acc + (r._count?.users ?? 0), 0);
  const unfilled = (roles ?? []).filter((r) => (r._count?.users ?? 0) === 0).length;

  return (
    <div className="roles">
      <header className="roles__head">
        <div className="roles__head-l">
          <div className="roles__icon"><Briefcase /></div>
          <div>
            <h1 className="roles__title">Roles</h1>
            <div className="roles__sub">{roles === null ? "Loading…" : `${total} role${total === 1 ? "" : "s"} · ${totalHeadcount} people across them · ${unfilled} unfilled`}</div>
          </div>
        </div>
        <button type="button" className="roles__new" onClick={quickAdd}>
          <Plus /> New role
        </button>
      </header>

      {loadError ? (
        <div className="roles__error">{loadError}</div>
      ) : roles === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="roles__empty">
          <Briefcase />
          <div>
            <h3>No roles defined yet</h3>
            <p>Roles are job titles your org uses — &quot;Senior Engineer&quot;, &quot;AE&quot;, &quot;Director of Ops&quot;. Each role gets an access level that controls what its holders can see.</p>
          </div>
        </div>
      ) : (
        <div className="roles__groups">
          {grouped.map((g) => (
            <section key={g.level} className="roles__group" style={{ borderLeft: `4px solid ${LEVEL_HUE[g.level]}` }}>
              <header className="roles__group-head">
                <h2>{LEVEL_LABEL[g.level]}</h2>
                <span>{g.items.length} role{g.items.length === 1 ? "" : "s"} · {g.items.reduce((acc, r) => acc + (r._count?.users ?? 0), 0)} people</span>
              </header>
              <div className="roles__list">
                {g.items.map((r) => {
                  const count = r._count?.users ?? 0;
                  return (
                    <div key={r.id} className="role-row">
                      <span className="role-row__title">{r.title}</span>
                      {r.description ? <span className="role-row__desc">{r.description}</span> : null}
                      <span className="role-row__dept">{r.department?.name ?? "—"}</span>
                      <span className={`role-row__count ${count === 0 ? "is-empty" : ""}`}>
                        <Users /> {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
