"use client";

/* Marketing — hub launchpad with subview tiles + featured campaigns.
 *
 *  GET   /api/marketing/campaigns
 *  POST  /api/marketing/campaigns   { name }
 *
 * Layout:
 *   OsTitleBar with subview nav links + New campaign in actions.
 *   KPI strip: Active · Budget · Spent · Goal completion (live calc).
 *   Subview tiles (4 cards): Campaigns / Content / Events / Reports.
 *   Featured campaigns: 2-col grid of active/approved campaigns with progress rings.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Megaphone, Plus, Target, DollarSign, Activity, CheckCircle2,
  LayoutGrid, FileText, CalendarDays, LineChart,
  ChevronRight, Play, Pause, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type CampaignStatus = "PLANNING" | "APPROVED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

type ApiCampaign = {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  channel?: string | null;
  budget?: number | string | null;
  spent?: number | string | null;
  currency?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ownerId?: string | null;
  goalMetric?: string | null;
  goalTarget?: number | null;
  goalActual?: number | null;
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  PLANNING: "Planning", APPROVED: "Approved", ACTIVE: "Active",
  PAUSED: "Paused", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<CampaignStatus, string> = {
  PLANNING: C.indigo, APPROVED: C.yellow, ACTIVE: C.orange,
  PAUSED: C.brown, COMPLETED: C.green, CANCELLED: C.gray,
};

const CHANNEL_COLORS: Record<string, string> = {
  email: C.blue, paid: C.orange, social: C.pink, outbound: C.indigo,
  event: C.purple, content: C.teal, seo: C.green, ads: C.red, webinar: C.purple,
};
function channelColor(ch?: string | null): string {
  if (!ch) return C.gray;
  const k = ch.toLowerCase();
  for (const key of Object.keys(CHANNEL_COLORS)) {
    if (k.includes(key)) return CHANNEL_COLORS[key];
  }
  return C.indigo;
}

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}
function fmtMoney(n: number, currency = "₹"): string {
  if (n >= 1_00_00_000) return `${currency}${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `${currency}${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `${currency}${(n / 1_000).toFixed(0)}k`;
  return `${currency}${Math.round(n).toLocaleString()}`;
}
function fmtDateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return "—";
  const s = start ? new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const e = end ? new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  return `${s} → ${e}`;
}

export default function MarketingPage() {
  const [campaigns, setCampaigns] = useState<ApiCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/campaigns");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("marketing");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function newCampaign() {
    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled campaign" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Campaign added");
      void load();
    } catch {
      toast("Couldn't add campaign");
    }
  }

  // ─── Aggregations ─────────────────────────────────────────
  const stats = useMemo(() => {
    const list = campaigns ?? [];
    const active = list.filter((c) => c.status === "ACTIVE");
    const completed = list.filter((c) => c.status === "COMPLETED");
    const planning = list.filter((c) => c.status === "PLANNING" || c.status === "APPROVED");
    const totalBudget = list.reduce((acc, c) => acc + num(c.budget), 0);
    const totalSpent = list.reduce((acc, c) => acc + num(c.spent), 0);
    const budgetUsage = totalBudget === 0 ? 0 : Math.round((totalSpent / totalBudget) * 100);
    const withGoals = list.filter((c) => c.goalTarget);
    const goalCompletion = withGoals.length === 0
      ? 0
      : Math.round(withGoals.reduce((acc, c) => acc + Math.min(100, ((c.goalActual ?? 0) / (c.goalTarget ?? 1)) * 100), 0) / withGoals.length);
    return {
      total: list.length, active, completed, planning,
      totalBudget, totalSpent, budgetUsage, goalCompletion,
    };
  }, [campaigns]);

  // Featured: active campaigns first, then approved, then planning. Max 6.
  const featured = useMemo(() => {
    const list = campaigns ?? [];
    const ranked = list.slice().sort((a, b) => {
      const order: Record<CampaignStatus, number> = { ACTIVE: 0, APPROVED: 1, PLANNING: 2, PAUSED: 3, COMPLETED: 4, CANCELLED: 5 };
      return order[a.status] - order[b.status];
    });
    return ranked.slice(0, 6);
  }, [campaigns]);

  const channels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of campaigns ?? []) {
      if (!c.channel) continue;
      const k = c.channel;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count, color: channelColor(name) }));
  }, [campaigns]);

  return (
    <>
      <OsTitleBar
        title="Marketing"
        Icon={Megaphone}
        iconGradient={GRAD.orangePink}
        description={campaigns === null
          ? "Loading hub…"
          : `${stats.total} campaign${stats.total === 1 ? "" : "s"} · ${stats.active.length} active · ${fmtMoney(stats.totalSpent)} spent`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.an]}
        morePeople={3}
        actions={
          <div className="mkt__head-actions">
            <Link href="/marketing/campaigns" className="mkt__nav-link">Campaigns</Link>
            <Link href="/marketing/content" className="mkt__nav-link">Content</Link>
            <Link href="/marketing/events" className="mkt__nav-link">Events</Link>
            <button type="button" className="mkt__btn-primary" onClick={newCampaign}>
              <Plus /> New campaign
            </button>
          </div>
        }
      />

      <div className="mkt">
        {/* KPI strip */}
        <div className="mkt__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Activity}      label="Active"   value={`${stats.active.length}`} sub={`${stats.planning.length} in planning`} />
          <KpiTile accent="var(--os-c-purple)" Icon={DollarSign}    label="Budget"   value={fmtMoney(stats.totalBudget)} sub={`across ${stats.total} campaign${stats.total === 1 ? "" : "s"}`} />
          <KpiTile accent="var(--os-c-red)"    Icon={DollarSign}    label="Spent"    value={fmtMoney(stats.totalSpent)} sub={`${stats.budgetUsage}% of budget`} progress={stats.budgetUsage} />
          <KpiTile accent="var(--os-c-green)"  Icon={Target}        label="Goal hit" value={`${stats.goalCompletion}%`} sub="avg across goals" progress={stats.goalCompletion} />
        </div>

        {/* Subview launchpad */}
        <div className="mkt__launchpad">
          <LaunchTile href="/marketing/campaigns" Icon={LayoutGrid}    gradient={GRAD.orangePink}  title="Campaigns" sub={`${stats.total} total`} desc="Plan, launch, and measure marketing campaigns across every channel." />
          <LaunchTile href="/marketing/content"   Icon={FileText}      gradient={GRAD.pinkPurple}  title="Content"   sub="content calendar"      desc="Editorial calendar for blogs, social posts, emails, and newsletters." />
          <LaunchTile href="/marketing/events"    Icon={CalendarDays}  gradient={GRAD.indigoBlue}  title="Events"    sub="upcoming & past"      desc="In-person and virtual events with attendee tracking and budget." />
          <LaunchTile href="/marketing/campaigns" Icon={LineChart}     gradient={GRAD.greenTeal}   title="Reports"   sub="performance & ROI"    desc="Campaign performance, channel mix, attribution and ROI dashboards." />
        </div>

        {/* Featured campaigns */}
        {loadError ? (
          <OsEmptyView Icon={Megaphone} iconGradient={GRAD.redPink} title="Couldn't load campaigns" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : campaigns === null ? (
          <div className="mkt__loading">Loading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <OsEmptyView
            Icon={Megaphone}
            iconGradient={GRAD.orangePink}
            title="No campaigns yet"
            subtitle="Plan your first campaign — track budget vs spend, goal vs actual, and pipeline impact."
            chips={["Email", "Paid search", "Social", "Outbound", "Event", "Content"]}
            cta="New campaign"
          />
        ) : (
          <section className="mkt__section">
            <header className="mkt__section-head">
              <h2>Featured campaigns</h2>
              <Link href="/marketing/campaigns" className="mkt__section-link">View all <ChevronRight /></Link>
            </header>
            <div className="mkt__featured">
              {featured.map((c) => <CampaignTile key={c.id} campaign={c} />)}
            </div>
          </section>
        )}

        {/* Channel mix */}
        {channels.length > 0 && (
          <section className="mkt__section">
            <header className="mkt__section-head">
              <h2>Channel mix</h2>
              <span className="mkt__section-sub">{channels.length} active channel{channels.length === 1 ? "" : "s"}</span>
            </header>
            <div className="mkt__channels">
              {channels.map((ch) => (
                <div key={ch.name} className="mkt__channel" style={{ ["--ch-c" as unknown as string]: ch.color }}>
                  <span className="mkt__channel-dot" aria-hidden="true" />
                  <span className="mkt__channel-name">{ch.name}</span>
                  <span className="mkt__channel-count">{ch.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub, progress }: { accent: string; Icon: typeof Target; label: string; value: string; sub: string; progress?: number }) {
  return (
    <div className="mkt__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="mkt__kpi-accent" aria-hidden="true" />
      <div className="mkt__kpi-row">
        <div className="mkt__kpi-icon"><Icon /></div>
        <div className="mkt__kpi-label">{label}</div>
      </div>
      <div className="mkt__kpi-value">{value}</div>
      <div className="mkt__kpi-sub">{sub}</div>
      {progress !== undefined && (
        <div className="mkt__kpi-bar"><div className="mkt__kpi-bar-fill" style={{ width: `${Math.min(100, progress)}%` }} /></div>
      )}
    </div>
  );
}

function LaunchTile({ href, Icon, gradient, title, sub, desc }: { href: string; Icon: typeof LayoutGrid; gradient: string; title: string; sub: string; desc: string }) {
  return (
    <Link href={href} className="mkt__launch">
      <div className="mkt__launch-icon" style={{ background: gradient }}><Icon /></div>
      <div className="mkt__launch-head">
        <span className="mkt__launch-title">{title}</span>
        <span className="mkt__launch-sub">{sub}</span>
      </div>
      <p className="mkt__launch-desc">{desc}</p>
      <span className="mkt__launch-arrow">Open <ChevronRight /></span>
    </Link>
  );
}

function CampaignTile({ campaign }: { campaign: ApiCampaign }) {
  const statusColor = STATUS_COLORS[campaign.status];
  const budget = num(campaign.budget);
  const spent = num(campaign.spent);
  const spendPct = budget === 0 ? 0 : Math.min(100, Math.round((spent / budget) * 100));
  const goalPct = campaign.goalTarget
    ? Math.min(100, Math.round(((campaign.goalActual ?? 0) / campaign.goalTarget) * 100))
    : null;
  const StatusIcon = campaign.status === "ACTIVE" ? Play : campaign.status === "PAUSED" ? Pause : campaign.status === "COMPLETED" ? CheckCircle2 : Loader2;
  return (
    <Link href={`/marketing/${campaign.id}`} className="mkt__camp" style={{ ["--camp-c" as unknown as string]: statusColor }}>
      <span className="mkt__camp-accent" aria-hidden="true" />
      <div className="mkt__camp-head">
        <span className="mkt__camp-status">
          <StatusIcon /> {STATUS_LABELS[campaign.status]}
        </span>
        {campaign.channel && (
          <span className="mkt__camp-channel" style={{ ["--ch-c" as unknown as string]: channelColor(campaign.channel) }}>
            {campaign.channel}
          </span>
        )}
      </div>
      <div className="mkt__camp-name">{campaign.name}</div>
      {campaign.description && (
        <p className="mkt__camp-desc">{campaign.description}</p>
      )}
      <div className="mkt__camp-dates">{fmtDateRange(campaign.startDate, campaign.endDate)}</div>

      <div className="mkt__camp-rings">
        {goalPct !== null && (
          <RingStat label="Goal" pct={goalPct} color="var(--os-c-green)" sub={`${campaign.goalActual ?? 0} / ${campaign.goalTarget}`} />
        )}
        {budget > 0 && (
          <RingStat label="Spend" pct={spendPct} color={spendPct > 90 ? "var(--os-c-red)" : "var(--os-c-blue)"} sub={`${fmtMoney(spent, campaign.currency ?? "₹")} / ${fmtMoney(budget, campaign.currency ?? "₹")}`} />
        )}
      </div>
    </Link>
  );
}

function RingStat({ label, pct, color, sub }: { label: string; pct: number; color: string; sub: string }) {
  const R = 22;
  const C2 = 2 * Math.PI * R;
  const dash = (Math.min(100, pct) / 100) * C2;
  return (
    <div className="mkt__ring-stat">
      <div className="mkt__ring-wrap" style={{ ["--ring-c" as unknown as string]: color }}>
        <svg viewBox="0 0 56 56" className="mkt__ring-svg">
          <circle cx="28" cy="28" r={R} fill="none" stroke="var(--os-surface-1)" strokeWidth="6" />
          <circle
            cx="28" cy="28" r={R}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C2 - dash}`}
            transform="rotate(-90 28 28)"
            style={{ transition: "stroke-dasharray 240ms ease" }}
          />
        </svg>
        <span className="mkt__ring-num">{pct}%</span>
      </div>
      <div className="mkt__ring-meta">
        <span className="mkt__ring-label">{label}</span>
        <span className="mkt__ring-sub">{sub}</span>
      </div>
    </div>
  );
}
