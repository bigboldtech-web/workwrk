"use client";

/* Helpdesk — customer support overview.
 *
 *  GET   /api/helpdesk/tickets
 *
 * Layout:
 *   OsTitleBar with subview nav links + New ticket CTA in actions.
 *   SLA tiles: Open · 1st-response met % · CSAT · Avg first reply time.
 *   Subview launchpad (4 cards): Tickets / Customers / Macros / KB.
 *   Channel mix bar (email/chat/portal/phone).
 *   Active queue: most-urgent tickets sorted by SLA + priority.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Headphones, Plus, Clock, Star, Smile, AlertOctagon,
  Mail, MessageCircle, Globe, Phone, Bot,
  Inbox, Users, BookOpen, ChevronRight, ArrowRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type HdStatus = "NEW" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_INTERNAL" | "RESOLVED" | "CLOSED" | "SPAM";
type HdPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type ApiSupportTicket = {
  id: string;
  subject: string;
  status: HdStatus;
  priority: HdPrio;
  channel?: string | null;
  category?: string | null;
  slaTier?: string | null;
  csatScore?: number | null;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  customer?: { id: string; name?: string | null; email?: string | null; companyName?: string | null } | null;
  assigneeId?: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<HdStatus, string> = {
  NEW: "New", OPEN: "Open", PENDING_CUSTOMER: "Pending · customer",
  PENDING_INTERNAL: "Pending · internal", RESOLVED: "Resolved", CLOSED: "Closed", SPAM: "Spam",
};
const STATUS_COLORS: Record<HdStatus, string> = {
  NEW: C.indigo, OPEN: C.orange, PENDING_CUSTOMER: C.purple,
  PENDING_INTERNAL: C.brown, RESOLVED: C.sage, CLOSED: C.green, SPAM: C.gray,
};
const PRIO_LABELS: Record<HdPrio, string> = {
  URGENT: "Urgent", HIGH: "High", NORMAL: "Normal", LOW: "Low",
};
const PRIO_SHORT: Record<HdPrio, string> = {
  URGENT: "P1", HIGH: "P2", NORMAL: "P3", LOW: "P4",
};
const PRIO_COLORS: Record<HdPrio, string> = {
  URGENT: C.red, HIGH: C.orange, NORMAL: C.blue, LOW: C.sage,
};

const CHANNEL_META: Record<string, { Icon: typeof Mail; color: string }> = {
  email: { Icon: Mail, color: C.blue },
  chat: { Icon: MessageCircle, color: C.purple },
  portal: { Icon: Globe, color: C.green },
  phone: { Icon: Phone, color: C.orange },
  api: { Icon: Bot, color: C.gray },
};
function channelMeta(ch?: string | null): { Icon: typeof Mail; color: string; label: string } {
  const k = (ch ?? "email").toLowerCase();
  for (const key of Object.keys(CHANNEL_META)) {
    if (k.includes(key)) return { ...CHANNEL_META[key], label: ch ?? key };
  }
  return { Icon: Mail, color: C.indigo, label: ch ?? "—" };
}

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function avInitials(s: string) { return s.slice(0, 2).toUpperCase(); }

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
function fmtDue(iso?: string | null): { label: string; tone: "good" | "warn" | "bad" | "muted" } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const h = ms / 3_600_000;
  if (h < 0) return { label: `${Math.ceil(-h)}h late`, tone: "bad" };
  if (h < 1) return { label: `${Math.ceil(h * 60)}m left`, tone: "bad" };
  if (h < 4) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  if (h < 24) return { label: `${Math.floor(h)}h left`, tone: "warn" };
  const d = Math.floor(h / 24);
  return { label: `${d}d left`, tone: d < 3 ? "good" : "muted" };
}

function isOpen(t: ApiSupportTicket): boolean {
  return t.status !== "RESOLVED" && t.status !== "CLOSED" && t.status !== "SPAM";
}

export default function HelpdeskPage() {
  const [tickets, setTickets] = useState<ApiSupportTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/tickets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTickets(data.tickets ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("helpdesk");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // ─── SLA / CSAT ──────────────────────────────────────────
  const stats = useMemo(() => {
    const list = tickets ?? [];
    const openList = list.filter(isOpen);
    const breached = openList.filter((t) => t.firstResponseDueAt && new Date(t.firstResponseDueAt).getTime() < Date.now() && !t.firstResponseAt);
    const atRisk = openList.filter((t) => {
      if (!t.firstResponseDueAt || t.firstResponseAt) return false;
      const ms = new Date(t.firstResponseDueAt).getTime() - Date.now();
      return ms >= 0 && ms < 3_600_000;
    });

    // First response SLA met %
    const respondedWithDue = list.filter((t) => t.firstResponseAt && t.firstResponseDueAt);
    const respondedOnTime = respondedWithDue.filter((t) => new Date(t.firstResponseAt!).getTime() <= new Date(t.firstResponseDueAt!).getTime());
    const slaPct = respondedWithDue.length === 0 ? null : Math.round((respondedOnTime.length / respondedWithDue.length) * 100);

    // Avg first reply time (only for tickets that have been answered)
    const replyTimes = list
      .filter((t) => t.firstResponseAt)
      .map((t) => new Date(t.firstResponseAt!).getTime() - new Date(t.createdAt).getTime());
    const avgReply = replyTimes.length === 0 ? null : replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length;

    // CSAT (avg of available scores)
    const csatScores = list.filter((t) => typeof t.csatScore === "number").map((t) => t.csatScore!);
    const avgCsat = csatScores.length === 0 ? null : csatScores.reduce((a, b) => a + b, 0) / csatScores.length;

    return { open: openList.length, breached, atRisk, slaPct, avgReply, avgCsat, csatCount: csatScores.length };
  }, [tickets]);

  // ─── Channel mix ─────────────────────────────────────────
  const channels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tickets ?? []) {
      const k = (t.channel ?? "email").toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    return Array.from(counts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => {
        const meta = channelMeta(name);
        return { name, count, pct: total === 0 ? 0 : (count / total) * 100, color: meta.color, Icon: meta.Icon };
      });
  }, [tickets]);

  // ─── Active queue ────────────────────────────────────────
  const queue = useMemo(() => {
    const list = (tickets ?? []).filter(isOpen);
    const score = (t: ApiSupportTicket) => {
      const p = ["LOW", "NORMAL", "HIGH", "URGENT"].indexOf(t.priority);
      const dueScore = t.firstResponseDueAt && !t.firstResponseAt
        ? -Math.min(0, (new Date(t.firstResponseDueAt).getTime() - Date.now()) / 3_600_000)
        : 0;
      return p * 100 + dueScore;
    };
    return list.slice().sort((a, b) => score(b) - score(a)).slice(0, 8);
  }, [tickets]);

  return (
    <>
      <OsTitleBar
        title="Helpdesk"
        Icon={Headphones}
        iconGradient={GRAD.orangePink}
        description={tickets === null
          ? "Loading helpdesk…"
          : `${stats.open} open · ${stats.breached.length} SLA breached · ${stats.atRisk.length} at risk`}
        people={[PEOPLE.pr, PEOPLE.mk, PEOPLE.sc]}
        morePeople={5}
        actions={
          <div className="hd__head-actions">
            <Link href="/helpdesk/tickets" className="hd__nav-link">Inbox</Link>
            <Link href="/helpdesk/customers" className="hd__nav-link">Customers</Link>
            <Link href="/helpdesk/macros" className="hd__nav-link">Macros</Link>
          </div>
        }
      />

      <div className="hd">
        {/* SLA / CSAT tiles */}
        <div className="hd__sla">
          <SlaTile
            tone={stats.breached.length > 0 ? "bad" : "good"}
            Icon={AlertOctagon}
            label="Breached"
            value={`${stats.breached.length}`}
            sub={stats.breached.length > 0 ? "1st response past due" : "all on time"}
          />
          <SlaTile
            tone="info"
            Icon={Clock}
            label="SLA met"
            value={stats.slaPct === null ? "—" : `${stats.slaPct}%`}
            sub={stats.slaPct === null ? "no answered tickets yet" : "1st response in time"}
            progress={stats.slaPct ?? undefined}
          />
          <SlaTile
            tone="info"
            Icon={Star}
            label="CSAT"
            value={stats.avgCsat === null ? "—" : stats.avgCsat.toFixed(1)}
            sub={stats.avgCsat === null ? "no scores yet" : `${stats.csatCount} rating${stats.csatCount === 1 ? "" : "s"} · /5`}
            progress={stats.avgCsat ? (stats.avgCsat / 5) * 100 : undefined}
          />
          <SlaTile
            tone="info"
            Icon={Smile}
            label="Avg 1st reply"
            value={stats.avgReply === null ? "—" : fmtDuration(stats.avgReply)}
            sub="mean response time"
          />
        </div>

        {/* Subview launchpad */}
        <div className="hd__launch">
          <LaunchCard href="/helpdesk/tickets"   Icon={Inbox}    gradient={GRAD.orangePink} title="Inbox"     sub={`${stats.open} open`} />
          <LaunchCard href="/helpdesk/customers" Icon={Users}    gradient={GRAD.greenTeal}  title="Customers" sub="contact directory" />
          <LaunchCard href="/helpdesk/macros"    Icon={Bot}      gradient={GRAD.bluePurple} title="Macros"    sub="canned responses" />
          <LaunchCard href="/itsm/kb"            Icon={BookOpen} gradient={GRAD.pinkPurple} title="Knowledge base" sub="self-serve articles" />
        </div>

        {/* 2-col body */}
        <div className="hd__grid">
          {/* Channel mix */}
          <section className="hd__card">
            <div className="hd__card-head">
              <Mail /> Channel mix
              <span className="hd__card-sub">{tickets?.length ?? 0} total ticket{tickets?.length === 1 ? "" : "s"}</span>
            </div>
            {channels.length === 0 ? (
              <div className="hd__card-empty">No tickets yet.</div>
            ) : (
              <>
                <div className="hd__channel-bar">
                  {channels.map((ch) => (
                    <div
                      key={ch.name}
                      className="hd__channel-seg"
                      style={{ width: `${ch.pct}%`, background: ch.color }}
                      title={`${ch.name}: ${ch.count} (${ch.pct.toFixed(1)}%)`}
                    />
                  ))}
                </div>
                <ul className="hd__channel-legend">
                  {channels.map((ch) => {
                    const Icon = ch.Icon;
                    return (
                      <li key={ch.name} className="hd__channel-row" style={{ ["--ch-c" as unknown as string]: ch.color }}>
                        <span className="hd__channel-icon"><Icon /></span>
                        <span className="hd__channel-name">{ch.name}</span>
                        <span className="hd__channel-count">{ch.count}</span>
                        <span className="hd__channel-pct">{ch.pct.toFixed(0)}%</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          {/* Active queue */}
          <section className="hd__card hd__card--queue">
            <div className="hd__card-head">
              <Inbox /> Active queue
              <Link href="/helpdesk/tickets" className="hd__card-link">All <ChevronRight /></Link>
            </div>
            {loadError ? (
              <OsEmptyView Icon={Headphones} iconGradient={GRAD.redPink} title="Couldn't load tickets" subtitle={`API error: ${loadError}.`} cta="Retry" />
            ) : tickets === null ? (
              <div className="hd__loading">Loading…</div>
            ) : queue.length === 0 ? (
              <div className="hd__empty">
                <Smile />
                <div>Inbox zero — nothing waiting.</div>
              </div>
            ) : (
              <div className="hd__queue">
                {queue.map((t) => {
                  const due = fmtDue(t.firstResponseDueAt);
                  const ch = channelMeta(t.channel);
                  const ChIcon = ch.Icon;
                  const av = t.assigneeId ? { initials: avInitials(t.assigneeId), color: avColor(t.assigneeId) } : null;
                  const customerLabel = t.customer?.companyName || t.customer?.name || t.customer?.email || "—";
                  const breached = !!due && due.tone === "bad" && !t.firstResponseAt;
                  return (
                    <Link
                      key={t.id}
                      href={`/helpdesk/${t.id}`}
                      className={`hd__qrow${breached ? " is-breached" : ""}`}
                    >
                      <span
                        className="hd__qprio"
                        style={{ ["--p-c" as unknown as string]: PRIO_COLORS[t.priority] }}
                        title={PRIO_LABELS[t.priority]}
                      >
                        {PRIO_SHORT[t.priority]}
                      </span>
                      <span className="hd__qchan" style={{ ["--ch-c" as unknown as string]: ch.color }} title={ch.label}>
                        <ChIcon />
                      </span>
                      <div className="hd__qmain">
                        <div className="hd__qsubject">{t.subject}</div>
                        <div className="hd__qmeta">
                          <span className="hd__qcust">{customerLabel}</span>
                          <span
                            className="hd__qstatus"
                            style={{ ["--s-c" as unknown as string]: STATUS_COLORS[t.status] }}
                          >
                            {STATUS_LABELS[t.status]}
                          </span>
                          <span className="hd__qage">{fmtRelative(t.createdAt)}</span>
                        </div>
                      </div>
                      {due && !t.firstResponseAt && (
                        <span className={`hd__qdue hd__qdue--${due.tone}`}>{due.label}</span>
                      )}
                      {av && (
                        <span className="hd__qav" style={{ background: av.color }}>{av.initials}</span>
                      )}
                      <ArrowRight className="hd__qarrow" />
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

function SlaTile({ tone, Icon, label, value, sub, progress }: { tone: "good" | "warn" | "bad" | "info"; Icon: typeof Clock; label: string; value: string; sub: string; progress?: number }) {
  return (
    <div className={`hd__tile hd__tile--${tone}`}>
      <span className="hd__tile-accent" aria-hidden="true" />
      <div className="hd__tile-row">
        <div className="hd__tile-icon"><Icon /></div>
        <div className="hd__tile-label">{label}</div>
      </div>
      <div className="hd__tile-value">{value}</div>
      <div className="hd__tile-sub">{sub}</div>
      {progress !== undefined && (
        <div className="hd__tile-bar"><div className="hd__tile-bar-fill" style={{ width: `${Math.min(100, progress)}%` }} /></div>
      )}
    </div>
  );
}

function LaunchCard({ href, Icon, gradient, title, sub }: { href: string; Icon: typeof Inbox; gradient: string; title: string; sub: string }) {
  return (
    <Link href={href} className="hd__launch-card">
      <div className="hd__launch-icon" style={{ background: gradient }}><Icon /></div>
      <div className="hd__launch-info">
        <span className="hd__launch-title">{title}</span>
        <span className="hd__launch-sub">{sub}</span>
      </div>
      <ChevronRight className="hd__launch-arrow" />
    </Link>
  );
}
