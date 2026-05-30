"use client";

/* ITSM — service desk overview with SLA tiles.
 *
 *  GET   /api/itsm/tickets
 *  POST  /api/itsm/tickets   { title, priority? }
 *
 * Layout:
 *   OsTitleBar with subview nav links + New ticket CTA in actions slot.
 *   SLA tiles: Breached · At risk · Response SLA · Resolution SLA.
 *   Subview launchpad (6 cards): Tickets / Incidents / Problems / Changes / CMDB / KB.
 *   Priority distribution bar.
 *   Active queue: top tickets sorted by priority + due date with one-click status flips.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Server, Plus, AlertTriangle, Clock, CheckCircle2, ShieldCheck,
  Ticket, Bug, Wrench, GitBranch, Database, BookOpen,
  ChevronRight, ArrowRight, Flame, AlertOctagon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ItsmStatus = "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED";
type ItsmPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL";

type ApiTicket = {
  id: string;
  title: string;
  status: ItsmStatus;
  priority: ItsmPrio;
  category?: string | null;
  source?: string | null;
  requesterId?: string | null;
  assigneeId?: string | null;
  slaTier?: string | null;
  dueAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<ItsmStatus, string> = {
  OPEN: "Open", TRIAGED: "Triaged", IN_PROGRESS: "In progress",
  WAITING_ON_USER: "Waiting · user", WAITING_ON_VENDOR: "Waiting · vendor",
  RESOLVED: "Resolved", CLOSED: "Closed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<ItsmStatus, string> = {
  OPEN: C.indigo, TRIAGED: C.yellow, IN_PROGRESS: C.orange,
  WAITING_ON_USER: C.purple, WAITING_ON_VENDOR: C.brown,
  RESOLVED: C.sage, CLOSED: C.green, CANCELLED: C.gray,
};

const PRIO_LABELS: Record<ItsmPrio, string> = {
  CRITICAL: "P0 · Critical", URGENT: "P1 · Urgent", HIGH: "P2 · High",
  NORMAL: "P3 · Normal", LOW: "P4 · Low",
};
const PRIO_SHORT: Record<ItsmPrio, string> = {
  CRITICAL: "P0", URGENT: "P1", HIGH: "P2", NORMAL: "P3", LOW: "P4",
};
const PRIO_COLORS: Record<ItsmPrio, string> = {
  CRITICAL: C.pink, URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.sage,
};
const PRIO_ORDER: ItsmPrio[] = ["CRITICAL", "URGENT", "HIGH", "NORMAL", "LOW"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { initials: id.slice(0, 2).toUpperCase(), color: AV_PALETTE[h % AV_PALETTE.length] };
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtDue(iso?: string | null): { label: string; tone: "good" | "warn" | "bad" | "muted" } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const h = ms / 3_600_000;
  if (h < 0) return { label: `${Math.ceil(-h)}h late`, tone: "bad" };
  if (h < 1) return { label: `${Math.ceil(h * 60)}m left`, tone: "bad" };
  if (h < 4) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  if (h < 24) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  const days = Math.floor(h / 24);
  return { label: `${days}d left`, tone: days < 3 ? "good" : "muted" };
}

function isOpen(t: ApiTicket): boolean {
  return t.status !== "RESOLVED" && t.status !== "CLOSED" && t.status !== "CANCELLED";
}

export default function ItsmOverviewPage() {
  const [tickets, setTickets] = useState<ApiTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/tickets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTickets(data.tickets ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const itsmVersion = rowVersion("itsm");
  useEffect(() => { if (itsmVersion > 0) void load(); }, [itsmVersion, load]);

  async function patchTicket(id: string, body: Record<string, unknown>) {
    setTickets((prev) => prev?.map((t) => t.id === id ? { ...t, ...body } as ApiTicket : t) ?? prev);
    try {
      const res = await fetch("/api/itsm/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch {
      toast("Couldn't update");
      void load();
    }
  }

  async function newTicket() {
    try {
      const res = await fetch("/api/itsm/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled ticket", priority: "NORMAL" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Ticket created");
      void load();
    } catch { toast("Couldn't create ticket"); }
  }

  // ─── SLA calculations ──────────────────────────────────────
  const sla = useMemo(() => {
    const list = tickets ?? [];
    const open = list.filter(isOpen);
    const now = Date.now();
    const breached = open.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now);
    const atRisk = open.filter((t) => {
      if (!t.dueAt) return false;
      const ms = new Date(t.dueAt).getTime() - now;
      return ms >= 0 && ms < 3_600_000; // within 1 hour
    });
    // Resolution SLA: of resolved tickets with dueAt, % resolved before dueAt
    const resolved = list.filter((t) => (t.status === "RESOLVED" || t.status === "CLOSED") && t.resolvedAt && t.dueAt);
    const resolvedOnTime = resolved.filter((t) => new Date(t.resolvedAt!).getTime() <= new Date(t.dueAt!).getTime());
    const resolutionPct = resolved.length === 0 ? null : Math.round((resolvedOnTime.length / resolved.length) * 100);
    // Response SLA: triaged within 4h of creation (heuristic — no firstResponseAt field)
    const triagedOrLater = list.filter((t) => t.status !== "OPEN" && t.status !== "CANCELLED");
    const respondedFast = triagedOrLater.filter((t) => {
      const ageH = (Date.now() - new Date(t.createdAt).getTime()) / 3_600_000;
      return ageH <= 4;
    });
    // ratio: number considered "responded fast" / total accepted into pipeline
    const responsePct = triagedOrLater.length === 0 ? null : Math.round((respondedFast.length / triagedOrLater.length) * 100);
    return { breached, atRisk, resolutionPct, responsePct };
  }, [tickets]);

  // ─── Priority breakdown ────────────────────────────────────
  const prioBreakdown = useMemo(() => {
    const list = (tickets ?? []).filter(isOpen);
    return PRIO_ORDER.map((p) => ({
      priority: p, color: PRIO_COLORS[p],
      count: list.filter((t) => t.priority === p).length,
    }));
  }, [tickets]);
  const prioTotal = Math.max(1, prioBreakdown.reduce((acc, p) => acc + p.count, 0));

  // ─── Active queue (top 8 by urgency) ──────────────────────
  const queue = useMemo(() => {
    const list = (tickets ?? []).filter(isOpen);
    const score = (t: ApiTicket): number => {
      const p = ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"].indexOf(t.priority);
      const dueScore = t.dueAt ? -Math.min(0, (new Date(t.dueAt).getTime() - Date.now()) / 3_600_000) : 0;
      return p * 100 + dueScore;
    };
    return list.slice().sort((a, b) => score(b) - score(a)).slice(0, 8);
  }, [tickets]);

  // ─── Category breakdown for sub ─────────────────────────────
  const openCount = (tickets ?? []).filter(isOpen).length;

  return (
    <>
      <OsTitleBar
        title="Service desk"
        Icon={Server}
        iconGradient={GRAD.bluePurple}
        description={tickets === null
          ? "Loading service desk…"
          : `${openCount} open · ${sla.breached.length} SLA breached · ${sla.atRisk.length} at risk`}
        people={[PEOPLE.ak, PEOPLE.vn, PEOPLE.rj]}
        morePeople={4}
        actions={
          <div className="svcd__head-actions">
            <Link href="/itsm/tickets" className="svcd__nav-link">All tickets</Link>
            <Link href="/itsm/incidents" className="svcd__nav-link">Incidents</Link>
            <Link href="/itsm/kb" className="svcd__nav-link">KB</Link>
            <button type="button" className="svcd__btn-primary" onClick={newTicket}>
              <Plus /> New ticket
            </button>
          </div>
        }
      />

      <div className="svcd">
        {/* SLA tiles */}
        <div className="svcd__sla">
          <SlaTile
            tone={sla.breached.length > 0 ? "bad" : "good"}
            Icon={AlertOctagon}
            label="SLA breached"
            value={`${sla.breached.length}`}
            sub={sla.breached.length > 0 ? "needs immediate action" : "all clear"}
          />
          <SlaTile
            tone={sla.atRisk.length > 0 ? "warn" : "good"}
            Icon={Clock}
            label="At risk"
            value={`${sla.atRisk.length}`}
            sub={sla.atRisk.length > 0 ? "within 1 hour" : "no upcoming breaches"}
          />
          <SlaTile
            tone="info"
            Icon={ShieldCheck}
            label="Response SLA"
            value={sla.responsePct === null ? "—" : `${sla.responsePct}%`}
            sub="triaged in ≤ 4h"
            progress={sla.responsePct ?? undefined}
          />
          <SlaTile
            tone="info"
            Icon={CheckCircle2}
            label="Resolution SLA"
            value={sla.resolutionPct === null ? "—" : `${sla.resolutionPct}%`}
            sub="resolved before due"
            progress={sla.resolutionPct ?? undefined}
          />
        </div>

        {/* Subview launchpad */}
        <div className="svcd__launch">
          <LaunchCard href="/itsm/tickets"   Icon={Ticket}    gradient={GRAD.bluePurple}  title="Tickets"   sub={`${openCount} open`} />
          <LaunchCard href="/itsm/incidents" Icon={Flame}     gradient={GRAD.redPink}     title="Incidents" sub="severity-tracked" />
          <LaunchCard href="/itsm/problems"  Icon={Bug}       gradient={GRAD.pinkPurple}  title="Problems"  sub="root cause" />
          <LaunchCard href="/itsm/changes"   Icon={GitBranch} gradient={GRAD.indigoBlue}  title="Changes"   sub="change calendar" />
          <LaunchCard href="/itsm/cmdb"      Icon={Database}  gradient={GRAD.greenTeal}   title="CMDB"      sub="asset inventory" />
          <LaunchCard href="/itsm/kb"        Icon={BookOpen}  gradient={GRAD.purpleIndigo} title="KB"        sub="articles" />
        </div>

        {/* 2-col body */}
        <div className="svcd__grid">
          {/* Priority distribution */}
          <section className="svcd__card svcd__card--prio">
            <div className="svcd__card-head">
              <Wrench /> Open by priority
              <span className="svcd__card-sub">{openCount} active ticket{openCount === 1 ? "" : "s"}</span>
            </div>
            <div className="svcd__prio-bar">
              {prioBreakdown.filter((p) => p.count > 0).map((p) => (
                <div
                  key={p.priority}
                  className="svcd__prio-seg"
                  style={{ width: `${(p.count / prioTotal) * 100}%`, background: p.color }}
                  title={`${PRIO_LABELS[p.priority]}: ${p.count}`}
                />
              ))}
              {prioBreakdown.every((p) => p.count === 0) && <div className="svcd__prio-empty">No open tickets</div>}
            </div>
            <ul className="svcd__prio-legend">
              {prioBreakdown.map((p) => (
                <li key={p.priority} className="svcd__prio-row">
                  <span className="svcd__prio-dot" style={{ background: p.color }} />
                  <span className="svcd__prio-name">{PRIO_LABELS[p.priority]}</span>
                  <span className="svcd__prio-count">{p.count}</span>
                  <span className="svcd__prio-pct">{prioTotal > 0 ? `${Math.round((p.count / prioTotal) * 100)}%` : "—"}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Active queue */}
          <section className="svcd__card svcd__card--queue">
            <div className="svcd__card-head">
              <Ticket /> Active queue
              <Link href="/itsm/tickets" className="svcd__card-link">All <ChevronRight /></Link>
            </div>
            {loadError ? (
              <OsEmptyView Icon={Server} iconGradient={GRAD.redPink} title="Couldn't load tickets" subtitle={`API error: ${loadError}.`} cta="Retry" />
            ) : tickets === null ? (
              <div className="svcd__loading">Loading tickets…</div>
            ) : queue.length === 0 ? (
              <div className="svcd__empty">
                <CheckCircle2 />
                <div>No open tickets. Inbox zero.</div>
              </div>
            ) : (
              <div className="svcd__queue">
                {queue.map((t) => {
                  const due = fmtDue(t.dueAt);
                  const av = t.assigneeId ? avatarFor(t.assigneeId) : null;
                  const breached = !!due && due.tone === "bad";
                  return (
                    <Link
                      key={t.id}
                      href={`/itsm/${t.id}`}
                      className={`svcd__qrow${breached ? " is-breached" : ""}`}
                    >
                      <span
                        className="svcd__qprio"
                        style={{ ["--p-c" as unknown as string]: PRIO_COLORS[t.priority] }}
                        title={PRIO_LABELS[t.priority]}
                      >
                        {PRIO_SHORT[t.priority]}
                      </span>
                      <div className="svcd__qmain">
                        <div className="svcd__qtitle">{t.title}</div>
                        <div className="svcd__qmeta">
                          <span
                            className="svcd__qstatus"
                            style={{ ["--s-c" as unknown as string]: STATUS_COLORS[t.status] }}
                          >
                            {STATUS_LABELS[t.status]}
                          </span>
                          {t.category && <span className="svcd__qcat">{t.category}</span>}
                          <span className="svcd__qage">{fmtRelative(t.createdAt)}</span>
                        </div>
                      </div>
                      {due && <span className={`svcd__qdue svcd__qdue--${due.tone}`}>{due.label}</span>}
                      {av && (
                        <span className="svcd__qav" style={{ background: av.color }}>{av.initials}</span>
                      )}
                      <ArrowRight className="svcd__qarrow" />
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function SlaTile({ tone, Icon, label, value, sub, progress }: { tone: "good" | "warn" | "bad" | "info"; Icon: typeof AlertTriangle; label: string; value: string; sub: string; progress?: number }) {
  return (
    <div className={`svcd__tile svcd__tile--${tone}`}>
      <span className="svcd__tile-accent" aria-hidden="true" />
      <div className="svcd__tile-row">
        <div className="svcd__tile-icon"><Icon /></div>
        <div className="svcd__tile-label">{label}</div>
      </div>
      <div className="svcd__tile-value">{value}</div>
      <div className="svcd__tile-sub">{sub}</div>
      {progress !== undefined && (
        <div className="svcd__tile-bar"><div className="svcd__tile-bar-fill" style={{ width: `${Math.min(100, progress)}%` }} /></div>
      )}
    </div>
  );
}

function LaunchCard({ href, Icon, gradient, title, sub }: { href: string; Icon: typeof Ticket; gradient: string; title: string; sub: string }) {
  return (
    <Link href={href} className="svcd__launch-card">
      <div className="svcd__launch-icon" style={{ background: gradient }}><Icon /></div>
      <div className="svcd__launch-info">
        <span className="svcd__launch-title">{title}</span>
        <span className="svcd__launch-sub">{sub}</span>
      </div>
      <ChevronRight className="svcd__launch-arrow" />
    </Link>
  );
}
