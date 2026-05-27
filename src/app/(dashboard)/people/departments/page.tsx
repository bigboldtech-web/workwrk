"use client";

/* People · Departments — org structure with headcount + head.
 *
 * Department cards (not a table) showing each dept's color stripe, name,
 * head (avatar + name), headcount, and child departments. Designed for
 * the moment an HR manager asks "show me how big each department is and
 * who runs it."
 *
 * Reads: GET /api/departments
 * Write: POST /api/departments  (quick-create via prompt)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building, Plus, Users, ChevronRight } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiDept = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  parentId?: string | null;
  head?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
  _count?: { members?: number };
  subDepartments?: ApiDept[];
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

const PALETTE = ["#0073EA", "#A25DDC", "#00C875", "#FDAB3D", "#FF158A", "#5559DF", "#66CCC2", "#E2445C"];

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<ApiDept[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDepts(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("people");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = window.prompt("Department name?")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/departments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: PALETTE[Math.floor(Math.random() * PALETTE.length)] }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't create department"); }
  }

  const roots = useMemo(() => (depts ?? []).filter((d) => !d.parentId), [depts]);
  const total = depts?.length ?? 0;
  const totalHeadcount = (depts ?? []).reduce((acc, d) => acc + (d._count?.members ?? 0), 0);
  const withHead = (depts ?? []).filter((d) => d.head).length;

  return (
    <div className="depts">
      <header className="depts__head">
        <div className="depts__head-l">
          <div className="depts__icon"><Building /></div>
          <div>
            <h1 className="depts__title">Departments</h1>
            <div className="depts__sub">{depts === null ? "Loading…" : `${total} department${total === 1 ? "" : "s"} · ${totalHeadcount} people · ${withHead} have a head assigned`}</div>
          </div>
        </div>
        <button type="button" className="depts__new" onClick={quickAdd}>
          <Plus /> New department
        </button>
      </header>

      {loadError ? (
        <div className="depts__error">{loadError}</div>
      ) : depts === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="depts__empty">
          <Building />
          <div>
            <h3>No departments yet</h3>
            <p>Departments organize your people and route policies, payroll, and announcements. Create your first one to get started.</p>
          </div>
        </div>
      ) : (
        <div className="depts__grid">
          {roots.map((d) => <DeptCard key={d.id} dept={d} />)}
        </div>
      )}
    </div>
  );
}

function DeptCard({ dept }: { dept: ApiDept }) {
  const headcount = dept._count?.members ?? 0;
  const subCount = dept.subDepartments?.length ?? 0;
  return (
    <article className="dept-card" style={{ borderTop: `4px solid ${dept.color ?? "var(--os-c-indigo)"}` }}>
      <header className="dept-card__head">
        <h3>{dept.name}</h3>
        <span className="dept-card__count"><Users /> {headcount}</span>
      </header>
      {dept.description ? <p className="dept-card__desc">{dept.description}</p> : null}
      <div className="dept-card__head-row">
        <span>Head</span>
        {dept.head ? (
          <span className="dept-card__head-person">
            <span className="dept-card__head-av" style={{ background: avColor(dept.head.id) }}>{initials(dept.head.firstName, dept.head.lastName)}</span>
            <span>{[dept.head.firstName, dept.head.lastName].filter(Boolean).join(" ")}</span>
          </span>
        ) : (
          <em style={{ color: "var(--os-c-orange)" }}>No head set</em>
        )}
      </div>
      {subCount > 0 ? (
        <div className="dept-card__subs">
          {dept.subDepartments!.map((s) => (
            <span key={s.id} className="dept-card__sub">
              <ChevronRight /> {s.name} <em>· {s._count?.members ?? 0}</em>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
