"use client";

/* Settings · Audit log — org-wide activity feed.
 *
 *  GET /api/audit-logs  (best-effort; falls back to a sample feed for the demo)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, Search, Hash, ChevronRight, User as UserIcon, Edit3, Trash2,
  Plus, Eye, ShieldAlert, Key, Building, FileText, Calendar as CalendarIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiLog = {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string;
  actorName?: string;
  actorId?: string;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

const ACTION_ICON: Record<string, typeof Activity> = {
  CREATE: Plus, UPDATE: Edit3, DELETE: Trash2, READ: Eye,
  LOGIN: Key, LOGOUT: Key, AUTH: ShieldAlert, ROLE_CHANGE: Building,
  EXPORT: FileText, PERMISSION: ShieldAlert,
};
const ACTION_HUE: Record<string, string> = {
  CREATE: C.green, UPDATE: C.blue, DELETE: C.red, READ: C.indigo,
  LOGIN: C.purple, LOGOUT: C.purple, AUTH: C.orange, ROLE_CHANGE: C.pink,
  EXPORT: C.teal, PERMISSION: C.orange,
};

function actionHue(a: string) { return ACTION_HUE[a] ?? C.indigo; }
function actionIcon(a: string) { return ACTION_ICON[a] ?? Activity; }

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SAMPLE: ApiLog[] = [
  { id: "1", action: "LOGIN", actorName: "BB", ip: "203.0.113.42", createdAt: new Date(Date.now() - 12 * 60_000).toISOString() },
  { id: "2", action: "CREATE", entityType: "Expense", actorName: "MK", createdAt: new Date(Date.now() - 90 * 60_000).toISOString(), metadata: { amount: 247 } },
  { id: "3", action: "UPDATE", entityType: "Policy", actorName: "BB", createdAt: new Date(Date.now() - 6 * 60 * 60_000).toISOString() },
  { id: "4", action: "ROLE_CHANGE", entityType: "User", actorName: "BB", createdAt: new Date(Date.now() - 22 * 60 * 60_000).toISOString(), metadata: { from: "EMPLOYEE", to: "MANAGER" } },
  { id: "5", action: "DELETE", entityType: "ApiKey", actorName: "BB", createdAt: new Date(Date.now() - 1.5 * 86_400_000).toISOString() },
  { id: "6", action: "EXPORT", entityType: "Payroll", actorName: "SC", createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
];

export default function AuditLogPage() {
  const [logs, setLogs] = useState<ApiLog[] | null>(null);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/audit-logs?limit=200");
      if (!res.ok) { setLogs(SAMPLE); return; }
      const d = await res.json();
      const list: ApiLog[] = d.data ?? (Array.isArray(d) ? d : []);
      setLogs(list.length > 0 ? list : SAMPLE);
    } catch { setLogs(SAMPLE); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("settings");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const actions = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs ?? []) m.set(l.action, (m.get(l.action) ?? 0) + 1);
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [logs]);

  const filtered = useMemo(() => {
    let list = logs ?? [];
    if (actionFilter) list = list.filter((l) => l.action === actionFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((l) =>
      l.action.toLowerCase().includes(q) ||
      (l.entityType ?? "").toLowerCase().includes(q) ||
      (l.actorName ?? "").toLowerCase().includes(q));
    return list;
  }, [logs, actionFilter, search]);

  const stats = useMemo(() => {
    const list = logs ?? [];
    const day = 86_400_000;
    const today = list.filter((l) => Date.now() - new Date(l.createdAt).getTime() < day).length;
    const auth = list.filter((l) => l.action === "LOGIN" || l.action === "LOGOUT" || l.action === "AUTH").length;
    const changes = list.filter((l) => l.action === "CREATE" || l.action === "UPDATE" || l.action === "DELETE").length;
    return { total: list.length, today, auth, changes };
  }, [logs]);

  return (
    <>
      <OsTitleBar
        title="Audit log"
        Icon={Activity}
        iconGradient={GRAD.orangePink}
        description={`${stats.total} event${stats.total === 1 ? "" : "s"} · ${stats.today} today · ${stats.changes} mutations`}
        actions={
          <div className="adt__head-actions">
            <Link href="/settings" className="adt__nav-link"><Hash /> Settings</Link>
            <Link href="/settings/api" className="adt__nav-link"><Key /> API keys</Link>
          </div>
        }
      />

      <div className="adt">
        <div className="adt__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Activity}    label="Today"       value={`${stats.today}`}    sub="last 24h" />
          <KpiTile accent="var(--os-c-purple)" Icon={Key}          label="Auth events" value={`${stats.auth}`}     sub="logins / MFA" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Edit3}        label="Mutations"   value={`${stats.changes}`}  sub="C/U/D actions" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Hash}         label="Total"       value={`${stats.total}`}    sub="all time visible" />
        </div>

        <div className="adt__toolbar">
          <div className="adt__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actor, action, entity…" />
          </div>
        </div>

        {actions.length > 0 && (
          <div className="adt__cats">
            <button type="button" className={`adt__cat${actionFilter === null ? " is-active" : ""}`} onClick={() => setActionFilter(null)}>
              <Hash /> All <span>{stats.total}</span>
            </button>
            {actions.map(([a, n]) => (
              <button
                key={a}
                type="button"
                className={`adt__cat${actionFilter === a ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: actionHue(a) }}
                onClick={() => setActionFilter(actionFilter === a ? null : a)}
              >
                <span className="adt__cat-dot" />
                {a}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {logs === null ? (
          <div className="adt__loading">Loading…</div>
        ) : filtered.length === 0 ? (
          <OsEmptyView Icon={Activity} iconGradient={GRAD.orangePink} title="No audit events" subtitle="Events appear here as soon as someone takes action." chips={["LOGIN", "CREATE", "UPDATE", "DELETE"]} />
        ) : (
          <div className="adt__list">
            {filtered.map((l) => {
              const Icon = actionIcon(l.action);
              return (
                <article key={l.id} className="adt__row" style={{ ["--r-c" as unknown as string]: actionHue(l.action) }}>
                  <span className="adt__row-icon"><Icon /></span>
                  <div className="adt__row-main">
                    <div className="adt__row-title">
                      <strong>{l.action}</strong>
                      {l.entityType && <span>· {l.entityType}</span>}
                      {l.actorName && <span><UserIcon /> {l.actorName}</span>}
                    </div>
                    <div className="adt__row-meta">
                      <span><CalendarIcon /> {relativeDate(l.createdAt)}</span>
                      {l.ip && <span>IP {l.ip}</span>}
                      {l.metadata && <span>{Object.entries(l.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</span>}
                    </div>
                  </div>
                  <ChevronRight className="adt__row-arrow" />
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Activity; label: string; value: string; sub: string }) {
  return (
    <div className="adt__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="adt__kpi-accent" aria-hidden="true" />
      <div className="adt__kpi-row">
        <div className="adt__kpi-icon"><Icon /></div>
        <div className="adt__kpi-label">{label}</div>
      </div>
      <div className="adt__kpi-value">{value}</div>
      <div className="adt__kpi-sub">{sub}</div>
    </div>
  );
}
