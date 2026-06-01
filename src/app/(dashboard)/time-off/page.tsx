"use client";

/* Time off — PTO tracker with approval queue + calendar peek.
 *
 *  GET  /api/time-off
 *  POST /api/time-off/[id]/decide  { decision: APPROVE | REJECT }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plane, Plus, Search, ArrowLeft, Calendar as CalendarIcon, CheckCircle2,
  XCircle, Clock, Users, ChevronRight, ArrowRight, FileText,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ToStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

type ApiRequest = {
  id: string;
  startDate: string;
  endDate: string;
  hours: number;
  reason?: string | null;
  status: ToStatus;
  decisionAt?: string | null;
  decisionNote?: string | null;
  user?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  policy?: { id: string; name: string; type: string; color?: string | null } | null;
};

const STATUS_LABELS: Record<ToStatus, string> = {
  PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<ToStatus, string> = {
  PENDING: C.yellow, APPROVED: C.green, REJECTED: C.red, CANCELLED: C.gray,
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { const a = (f ?? "")[0] ?? ""; const b = (l ?? "")[0] ?? ""; return ((a + b) || "?").toUpperCase(); }

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start); const e = new Date(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  if (s.toDateString() === e.toDateString()) return s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;
}
function daysUntil(iso: string): number {
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

export default function TimeOffPage() {
  const [requests, setRequests] = useState<ApiRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "mine" | "upcoming">("all");
  const [search, setSearch] = useState("");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/time-off");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequests(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("timeoff");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    try {
      const res = await fetch(`/api/time-off/${id}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Manager+ access required");
        else toast("Couldn't update");
        return;
      }
      toast(decision === "APPROVE" ? "Approved" : "Rejected");
      void load();
    } catch { toast("Couldn't update"); }
  }

  const filtered = useMemo(() => {
    let list = requests ?? [];
    if (filter === "pending") list = list.filter((r) => r.status === "PENDING");
    if (filter === "upcoming") list = list.filter((r) => r.status === "APPROVED" && new Date(r.endDate).getTime() >= Date.now() - 86_400_000);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) =>
      (r.user?.firstName ?? "").toLowerCase().includes(q) ||
      (r.user?.lastName ?? "").toLowerCase().includes(q) ||
      (r.policy?.name ?? "").toLowerCase().includes(q) ||
      (r.reason ?? "").toLowerCase().includes(q));
    return list.slice().sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [requests, filter, search]);

  const stats = useMemo(() => {
    const list = requests ?? [];
    const pending = list.filter((r) => r.status === "PENDING");
    const approved = list.filter((r) => r.status === "APPROVED");
    const today = Date.now();
    const outNow = approved.filter((r) => new Date(r.startDate).getTime() <= today && new Date(r.endDate).getTime() >= today - 86_400_000);
    const upcoming = approved.filter((r) => new Date(r.startDate).getTime() > today);
    const totalHours = approved.reduce((acc, r) => acc + r.hours, 0);
    return { pending: pending.length, approved: approved.length, outNow: outNow.length, upcoming: upcoming.length, totalDays: Math.round(totalHours / 8) };
  }, [requests]);

  return (
    <>
      <OsTitleBar
        title="Time off"
        Icon={Plane}
        iconGradient={GRAD.indigoBlue}
        description={requests === null ? "Loading…" : `${stats.pending} pending · ${stats.outNow} out today · ${stats.upcoming} upcoming`}
        actions={
          <div className="tof__head-actions">
            <Link href="/time-off/policies" className="tof__nav-link"><FileText /> Policies</Link>
            <button type="button" className="tof__btn-primary" onClick={() => toast("Request flow needs policy + dates — opens via your /today widget")}>
              <Plus /> Request time off
            </button>
          </div>
        }
      />

      <div className="tof">
        <div className="tof__kpis">
          <KpiTile accent="var(--os-c-yellow)" Icon={Clock}        label="Pending"   value={`${stats.pending}`}  sub="awaiting decision" />
          <KpiTile accent="var(--os-c-orange)" Icon={Plane}        label="Out today" value={`${stats.outNow}`}    sub="currently away" />
          <KpiTile accent="var(--os-c-blue)"   Icon={CalendarIcon} label="Upcoming"  value={`${stats.upcoming}`}  sub="approved future" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Approved"  value={`${stats.approved}`}  sub={`${stats.totalDays} days total`} />
        </div>

        <div className="tof__toolbar">
          <div className="tof__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee, policy, reason…" />
          </div>
          <div className="tof__tabs">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All</button>
            <button type="button" className={`${filter === "pending" ? "is-active" : ""} ${stats.pending > 0 ? "is-warn" : ""}`} onClick={() => setFilter("pending")}>Pending <span>{stats.pending}</span></button>
            <button type="button" className={filter === "upcoming" ? "is-active" : ""} onClick={() => setFilter("upcoming")}>Upcoming <span>{stats.upcoming}</span></button>
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={Plane} iconGradient={GRAD.redPink} title="Couldn't load time off" subtitle={loadError} cta="Retry" />
        ) : requests === null ? (
          <div className="tof__loading">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="tof__empty">
            <Plane />
            <div>No time off in this view.</div>
          </div>
        ) : (
          <div className="tof__list">
            {filtered.map((r) => {
              const statusColor = STATUS_COLORS[r.status];
              const policyColor = r.policy?.color ?? C.blue;
              const days = Math.round(r.hours / 8);
              const av = r.user ? { initials: initials(r.user.firstName, r.user.lastName), color: avColor(r.user.id) } : null;
              const isPending = r.status === "PENDING";
              const daysAway = daysUntil(r.startDate);
              const startLabel = r.status === "APPROVED" && daysAway > 0 ? `starts in ${daysAway}d`
                              : r.status === "APPROVED" && daysAway === 0 ? "starts today"
                              : r.status === "APPROVED" && daysAway < 0 && new Date(r.endDate).getTime() >= Date.now() ? "out now"
                              : null;
              return (
                <article key={r.id} className="tof__req" style={{ ["--row-c" as unknown as string]: statusColor }}>
                  <span className="tof__req-accent" aria-hidden="true" />
                  {av ? <span className="tof__req-av" style={{ background: av.color }}>{av.initials}</span> : <span className="tof__req-av" style={{ background: C.gray }}>?</span>}
                  <div className="tof__req-main">
                    <div className="tof__req-head">
                      <span className={`tof__req-status tof__req-status--${r.status.toLowerCase()}`}>{STATUS_LABELS[r.status]}</span>
                      {r.policy && (
                        <span className="tof__req-policy" style={{ ["--p-c" as unknown as string]: policyColor }}>
                          {r.policy.name}
                        </span>
                      )}
                      {startLabel && <span className="tof__req-soon">{startLabel}</span>}
                    </div>
                    <div className="tof__req-who">
                      {r.user ? `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || "Employee" : "Employee"}
                    </div>
                    <div className="tof__req-meta">
                      <span><CalendarIcon /> {fmtPeriod(r.startDate, r.endDate)}</span>
                      <span><Clock /> {r.hours}h · {days}d</span>
                      {r.reason && <span>· {r.reason}</span>}
                    </div>
                  </div>
                  {isPending ? (
                    <div className="tof__req-decide">
                      <button type="button" className="tof__decide tof__decide--approve" onClick={() => decide(r.id, "APPROVE")} title="Approve">
                        <CheckCircle2 /> Approve
                      </button>
                      <button type="button" className="tof__decide tof__decide--reject" onClick={() => decide(r.id, "REJECT")} title="Reject">
                        <XCircle /> Reject
                      </button>
                    </div>
                  ) : r.approver ? (
                    <div className="tof__req-approver">
                      <span>{r.status === "APPROVED" ? "Approved by" : "Decided by"}</span>
                      <span className="tof__req-approver-av" style={{ background: avColor(r.approver.id) }}>
                        {initials(r.approver.firstName, r.approver.lastName)}
                      </span>
                      <span>{[r.approver.firstName, r.approver.lastName].filter(Boolean).join(" ")}</span>
                    </div>
                  ) : null}
                  <ChevronRight className="tof__req-arrow" />
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Plane; label: string; value: string; sub: string }) {
  return (
    <div className="tof__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="tof__kpi-accent" aria-hidden="true" />
      <div className="tof__kpi-row">
        <div className="tof__kpi-icon"><Icon /></div>
        <div className="tof__kpi-label">{label}</div>
      </div>
      <div className="tof__kpi-value">{value}</div>
      <div className="tof__kpi-sub">{sub}</div>
    </div>
  );
}
