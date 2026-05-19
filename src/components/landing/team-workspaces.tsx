// "Built for every team" — section 4 (heavy revamp).
//
// Tabbed workspace. Six teams across the top (Sales, Operations, HR,
// Finance, Engineering, Marketing). Click a tab → the workspace mock
// below crossfades to that team's tailored setup. Each workspace is
// dense and alive: animated background mesh in the team's color,
// count-up on the headline KPI, mini sparklines on each KPI tile that
// draw on view, animated progress bars on the main board, a live
// activity ticker that auto-rotates every 4 seconds, a team-member
// avatar stack, and a floating side chip that bobs continuously with
// a "right-now" event.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useInView,
} from "framer-motion";
import {
  TrendingUp,
  ClipboardCheck,
  Users,
  DollarSign,
  Code2,
  Megaphone,
  ArrowRight,
  Sparkles,
  Bell,
  Zap,
} from "lucide-react";

// ════════════════════════════════════════════════════════════════════
// Types + team registry
// ════════════════════════════════════════════════════════════════════

interface KPI {
  label: string;
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  trend?: string;
  sparkline: readonly number[]; // values 0..1
}

interface TickerItem {
  icon: string;
  text: string;
  time: string;
}

interface Avatar {
  initials: string;
  hue: string;
}

interface TeamData {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  hue: string;
  hueSoft: string;
  hueDeep: string;
  eyebrow: string;     // "SALES WORKSPACE · Q3 PIPELINE"
  headlineLabel: string;
  headlineKPI: { to: number; suffix: string; prefix?: string; decimals?: number };
  kpis: readonly KPI[];
  ticker: readonly TickerItem[];
  avatars: readonly Avatar[];
  liveChip: { icon: string; text: string };
  Body: React.ComponentType<{ hue: string; hueSoft: string; bodyKey: number }>;
}

const TEAMS: readonly TeamData[] = [
  {
    id: "sales",
    name: "Sales",
    icon: TrendingUp,
    hue: "#FF3D57",
    hueSoft: "#FFEDF0",
    hueDeep: "#B8001A",
    eyebrow: "Sales workspace · Q3 pipeline",
    headlineLabel: "Quota attainment",
    headlineKPI: { to: 92, suffix: "%" },
    kpis: [
      { label: "Forecast",   to: 2.4,  decimals: 1, prefix: "$", suffix: "M",   trend: "+18%", sparkline: [0.3, 0.4, 0.45, 0.5, 0.65, 0.7, 0.85, 0.92, 1] },
      { label: "Win rate",   to: 34,                              suffix: "%",   trend: "+4pp", sparkline: [0.4, 0.45, 0.5, 0.55, 0.6, 0.62, 0.7, 0.78, 0.85] },
      { label: "Avg cycle",  to: 23,                              suffix: "d",   trend: "-3d",  sparkline: [0.9, 0.85, 0.82, 0.75, 0.7, 0.65, 0.58, 0.5, 0.45] },
    ],
    ticker: [
      { icon: "💰", text: "DP closed Brindle Estates · $84k",                    time: "12m" },
      { icon: "📈", text: "MC moved 3 deals to Negotiation",                    time: "1h"  },
      { icon: "🎯", text: "Quota attainment crossed 90%",                       time: "2h"  },
      { icon: "🚀", text: "New Enterprise lead from Stratum Logistics",         time: "3h"  },
    ],
    avatars: [
      { initials: "DP", hue: "#FF3D57" },
      { initials: "MC", hue: "#0073EA" },
      { initials: "SC", hue: "#d946ef" },
      { initials: "JR", hue: "#10b981" },
      { initials: "KP", hue: "#f59e0b" },
    ],
    liveChip: { icon: "🔥", text: "Closing this week · $1.4M" },
    Body: SalesBody,
  },
  {
    id: "ops",
    name: "Operations",
    icon: ClipboardCheck,
    hue: "#0073EA",
    hueSoft: "#E6F2FD",
    hueDeep: "#003F80",
    eyebrow: "Operations workspace · today's SOPs",
    headlineLabel: "SOP compliance",
    headlineKPI: { to: 94, suffix: "%" },
    kpis: [
      { label: "On-time delivery", to: 98.2, decimals: 1, suffix: "%",   trend: "+0.6pp", sparkline: [0.6, 0.65, 0.7, 0.72, 0.78, 0.8, 0.85, 0.9, 0.95] },
      { label: "Open incidents",   to: 2,                                trend: "-1",     sparkline: [0.7, 0.65, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2] },
      { label: "Avg cycle",        to: 3.1, decimals: 1, suffix: "d",    trend: "-12%",   sparkline: [0.8, 0.75, 0.7, 0.65, 0.55, 0.5, 0.45, 0.4, 0.35] },
    ],
    ticker: [
      { icon: "✅", text: "SOP-141 signed off by Priya",          time: "5m"  },
      { icon: "⚠️", text: "Compliance audit flagged 1 exception", time: "1h"  },
      { icon: "📋", text: "New SOP-208 published · 4 readers",    time: "3h"  },
      { icon: "🔧", text: "Equipment safety inspection cleared",  time: "4h"  },
    ],
    avatars: [
      { initials: "PI", hue: "#0073EA" },
      { initials: "KP", hue: "#10b981" },
      { initials: "MR", hue: "#d946ef" },
      { initials: "AS", hue: "#7c3aed" },
    ],
    liveChip: { icon: "📋", text: "5 SOP runs active right now" },
    Body: OpsBody,
  },
  {
    id: "hr",
    name: "HR",
    icon: Users,
    hue: "#d946ef",
    hueSoft: "#fae8ff",
    hueDeep: "#86198f",
    eyebrow: "HR workspace · Q3 cycle, 4 days left",
    headlineLabel: "Reviews complete",
    headlineKPI: { to: 72, suffix: "%" },
    kpis: [
      { label: "eNPS",            to: 64,  prefix: "+", trend: "+8",   sparkline: [0.3, 0.35, 0.4, 0.5, 0.55, 0.6, 0.7, 0.78, 0.85] },
      { label: "Time to hire",    to: 21,               suffix: "d",   trend: "-4d",  sparkline: [0.9, 0.85, 0.8, 0.7, 0.65, 0.6, 0.5, 0.45, 0.4] },
      { label: "Retention 12m",   to: 94,               suffix: "%",   trend: "+2pp", sparkline: [0.6, 0.62, 0.65, 0.7, 0.72, 0.78, 0.82, 0.88, 0.92] },
    ],
    ticker: [
      { icon: "📝", text: "Maya needs sign-off · 2 days left",        time: "10m" },
      { icon: "🎉", text: "Karim promoted to VP Operations",           time: "2h"  },
      { icon: "👋", text: "Sarah K. starts Monday · onboarding queued", time: "4h"  },
      { icon: "📅", text: "Calibration session scheduled · Friday",     time: "6h"  },
    ],
    avatars: [
      { initials: "AS", hue: "#d946ef" },
      { initials: "PI", hue: "#0073EA" },
      { initials: "MC", hue: "#FF3D57" },
      { initials: "DK", hue: "#10b981" },
      { initials: "SC", hue: "#f59e0b" },
      { initials: "JR", hue: "#7c3aed" },
    ],
    liveChip: { icon: "📈", text: "8 reviews submitted today" },
    Body: HRBody,
  },
  {
    id: "finance",
    name: "Finance",
    icon: DollarSign,
    hue: "#10b981",
    hueSoft: "#d1fae5",
    hueDeep: "#065f46",
    eyebrow: "Finance workspace · Q3 budget vs actuals",
    headlineLabel: "Total spend · Q3",
    headlineKPI: { to: 534, prefix: "$", suffix: "k" },
    kpis: [
      { label: "Burn rate",     to: 178, prefix: "$", suffix: "k/mo", trend: "-4%",  sparkline: [0.8, 0.82, 0.78, 0.75, 0.72, 0.68, 0.65, 0.6, 0.58] },
      { label: "Runway",        to: 27,               suffix: " mo",  trend: "+2mo", sparkline: [0.5, 0.55, 0.6, 0.62, 0.65, 0.68, 0.72, 0.78, 0.82] },
      { label: "Approvals",     to: 5,                                trend: "-3",   sparkline: [0.7, 0.65, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25] },
    ],
    ticker: [
      { icon: "💸", text: "Vendor invoice $48k over budget · CFO review", time: "8m"  },
      { icon: "✅", text: "PO #2287 approved by Dan",                      time: "32m" },
      { icon: "📊", text: "Q2 close completed · books locked",             time: "yesterday" },
      { icon: "💳", text: "Stripe payout received · $84k",                  time: "4h"  },
    ],
    avatars: [
      { initials: "DK", hue: "#10b981" },
      { initials: "MR", hue: "#0073EA" },
      { initials: "PI", hue: "#d946ef" },
      { initials: "SC", hue: "#FF3D57" },
    ],
    liveChip: { icon: "💚", text: "On budget across 4/5 departments" },
    Body: FinanceBody,
  },
  {
    id: "eng",
    name: "Engineering",
    icon: Code2,
    hue: "#7c3aed",
    hueSoft: "#f3e8ff",
    hueDeep: "#4c1d95",
    eyebrow: "Engineering workspace · sprint 47",
    headlineLabel: "Sprint completion",
    headlineKPI: { to: 87, suffix: "%" },
    kpis: [
      { label: "Velocity",     to: 42,                suffix: " pts", trend: "+6",    sparkline: [0.5, 0.55, 0.6, 0.62, 0.7, 0.75, 0.78, 0.85, 0.92] },
      { label: "Cycle time",   to: 2.3,  decimals: 1, suffix: "d",    trend: "-0.4d", sparkline: [0.85, 0.78, 0.7, 0.65, 0.58, 0.5, 0.45, 0.4, 0.35] },
      { label: "Deploys/wk",   to: 18,                                trend: "+4",    sparkline: [0.4, 0.5, 0.55, 0.6, 0.65, 0.72, 0.78, 0.85, 0.9] },
    ],
    ticker: [
      { icon: "🚀", text: "PR #1247 merged · auto-deployed to staging",   time: "4m"  },
      { icon: "🐛", text: "Bug closed · review form date picker",         time: "27m" },
      { icon: "⚡", text: "Cycle time hit new low · 2.3d avg",            time: "1h"  },
      { icon: "🧪", text: "E2E suite passing · 247/247",                  time: "2h"  },
    ],
    avatars: [
      { initials: "MC", hue: "#7c3aed" },
      { initials: "JR", hue: "#FF3D57" },
      { initials: "PI", hue: "#0073EA" },
      { initials: "DK", hue: "#10b981" },
      { initials: "KP", hue: "#f59e0b" },
      { initials: "SC", hue: "#d946ef" },
    ],
    liveChip: { icon: "⚡", text: "18 deploys this week · new high" },
    Body: EngBody,
  },
  {
    id: "marketing",
    name: "Marketing",
    icon: Megaphone,
    hue: "#f59e0b",
    hueSoft: "#fef3c7",
    hueDeep: "#92400e",
    eyebrow: "Marketing workspace · active campaigns",
    headlineLabel: "Pipeline sourced · Q3",
    headlineKPI: { to: 2.5, decimals: 1, prefix: "$", suffix: "M" },
    kpis: [
      { label: "MQLs (Q3)",      to: 178,             trend: "+34",   sparkline: [0.4, 0.45, 0.5, 0.6, 0.65, 0.72, 0.78, 0.85, 0.92] },
      { label: "SQL conversion", to: 27,  suffix: "%", trend: "+3pp",  sparkline: [0.5, 0.55, 0.6, 0.62, 0.68, 0.72, 0.78, 0.82, 0.88] },
      { label: "CAC payback",    to: 9.2, decimals: 1, suffix: " mo", trend: "-1.4mo", sparkline: [0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45] },
    ],
    ticker: [
      { icon: "📧", text: "Email campaign launched · 12k opens",          time: "22m" },
      { icon: "🎯", text: "MQL alert · 8 new leads from launch event",    time: "1h"  },
      { icon: "💼", text: "Pipeline sourced crossed $2.5M target",         time: "yesterday" },
      { icon: "📰", text: "TechCrunch coverage · 24k impressions",         time: "2d" },
    ],
    avatars: [
      { initials: "AS", hue: "#f59e0b" },
      { initials: "MC", hue: "#FF3D57" },
      { initials: "PI", hue: "#0073EA" },
      { initials: "DK", hue: "#10b981" },
    ],
    liveChip: { icon: "🎯", text: "12k opens in last 24h" },
    Body: MarketingBody,
  },
];

// ════════════════════════════════════════════════════════════════════
// Section root
// ════════════════════════════════════════════════════════════════════

export function TeamWorkspaces() {
  const [activeId, setActiveId] = useState<string>("sales");
  const [bodyKey, setBodyKey] = useState(0);
  const active = TEAMS.find((t) => t.id === activeId) ?? TEAMS[0];

  const handleTab = (id: string) => {
    setActiveId(id);
    setBodyKey((k) => k + 1);
  };

  return (
    <section
      className="relative py-24 lg:py-32 overflow-hidden"
      style={{ backgroundColor: "var(--m-surface)" }}
    >
      {/* Animated mesh — recolors per active team */}
      <TeamBackdrop hue={active.hue} hueId={activeId} />

      <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
        {/* Header */}
        <div className="max-w-3xl">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "var(--brand-red)" }}
          >
            Built for every team
          </p>
          <h2
            className="mt-5 font-extrabold tracking-[-0.03em]"
            style={{
              color: "var(--m-text)",
              fontSize: "clamp(2rem, 4vw, 3.4rem)",
              lineHeight: 1.04,
            }}
          >
            The workspace each team would{" "}
            <span style={{ color: active.hue }}>build for themselves.</span>
          </h2>
          <p
            className="mt-5 text-base lg:text-lg leading-relaxed max-w-2xl"
            style={{ color: "var(--m-text-muted)" }}
          >
            Pick a team. WorkwrK reshapes around how that team actually
            works &mdash; with the boards, KPIs, and workflows already
            wired up, on the same data model as everyone else.
          </p>
        </div>

        {/* Tab strip */}
        <div className="mt-10 flex flex-wrap items-center gap-1 -ml-1">
          {TEAMS.map((team) => {
            const isActive = team.id === activeId;
            const Icon = team.icon;
            return (
              <button
                key={team.id}
                onClick={() => handleTab(team.id)}
                className="relative inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold transition-colors"
                style={{
                  color: isActive ? team.hue : "var(--m-text-muted)",
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="team-tab-active"
                    className="absolute inset-0 rounded-full -z-10"
                    style={{ backgroundColor: team.hueSoft }}
                    transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  />
                )}
                <Icon size={13} strokeWidth={2.4} />
                {team.name}
              </button>
            );
          })}
        </div>

        {/* Workspace mock */}
        <div className="mt-10 relative">
          <div
            className="relative bg-white rounded-3xl shadow-[0_40px_100px_-32px_rgba(15,23,42,0.22)] overflow-hidden"
            style={{ border: "1px solid var(--m-border)" }}
          >
            {/* Top color stripe — recolors per team */}
            <motion.div
              className="h-1"
              animate={{ backgroundColor: active.hue }}
              transition={{ duration: 0.4 }}
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <Workspace team={active} bodyKey={bodyKey} />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Floating side chip — bobs continuously, recolors per team */}
          <FloatingLiveChip team={active} />
        </div>
      </div>
    </section>
  );
}

// ── TeamBackdrop ────────────────────────────────────────────────────

function TeamBackdrop({ hue, hueId }: { hue: string; hueId: string }) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      <motion.div
        key={`blob-a-${hueId}`}
        className="absolute -top-40 -left-32 w-[640px] h-[640px] rounded-full blur-3xl"
        style={{ backgroundColor: hue, opacity: 0.08 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.08, x: [0, 60, -10, 0], y: [0, 30, -15, 0] }}
        transition={{
          opacity: { duration: 0.6 },
          x: { duration: 22, repeat: Infinity, ease: "easeInOut" },
          y: { duration: 22, repeat: Infinity, ease: "easeInOut" },
        }}
      />
    </div>
  );
}

// ── FloatingLiveChip — bobs alongside the workspace ─────────────────

function FloatingLiveChip({ team }: { team: TeamData }) {
  return (
    <motion.div
      className="hidden lg:flex absolute -right-4 top-32 items-center gap-2.5 pl-2.5 pr-4 h-11 rounded-full bg-white shadow-[0_18px_50px_-12px_rgba(15,23,42,0.22)] z-20"
      style={{ border: "1px solid var(--m-border)" }}
      animate={{ y: [0, -7, 0, 7, 0] }}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[13px] relative"
        style={{ backgroundColor: team.hue }}
      >
        {team.liveChip.icon}
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: team.hue }}
          animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          aria-hidden
        />
      </span>
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--m-text-soft)" }}>
          Right now
        </p>
        <p className="text-[12px] font-semibold leading-tight" style={{ color: "var(--m-text)" }}>
          {team.liveChip.text}
        </p>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Workspace — the per-team card body
// ════════════════════════════════════════════════════════════════════

function Workspace({ team, bodyKey }: { team: TeamData; bodyKey: number }) {
  return (
    <div className="grid lg:grid-cols-[1fr_240px] gap-0">
      {/* Main column */}
      <div className="p-6 lg:p-8">
        <WSHeader team={team} bodyKey={bodyKey} />
        <KPIStrip kpis={team.kpis} hue={team.hue} bodyKey={bodyKey} />
        <div className="mt-6">
          <team.Body hue={team.hue} hueSoft={team.hueSoft} bodyKey={bodyKey} />
        </div>
        <ActivityRow ticker={team.ticker} avatars={team.avatars} hue={team.hue} />
      </div>

      {/* Right rail — neutral surface, team color carried only by the metric + CTA */}
      <div
        className="hidden lg:flex flex-col justify-between p-5"
        style={{
          backgroundColor: "var(--m-surface)",
          borderLeft: "1px solid var(--m-border)",
        }}
      >
        <RightRail team={team} bodyKey={bodyKey} />
      </div>
    </div>
  );
}

// ── WSHeader: title + big animated headline KPI ─────────────────────

function WSHeader({ team, bodyKey }: { team: TeamData; bodyKey: number }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <p
          className="text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ color: "var(--m-text-soft)" }}
        >
          {team.eyebrow}
        </p>
        <p
          className="mt-2 font-extrabold tracking-[-0.02em]"
          style={{
            color: "var(--m-text)",
            fontSize: "clamp(1.4rem, 2vw, 1.8rem)",
            lineHeight: 1.1,
          }}
        >
          {team.headlineLabel}
        </p>
      </div>

      <CountUp
        key={`headline-${bodyKey}`}
        to={team.headlineKPI.to}
        decimals={team.headlineKPI.decimals}
        prefix={team.headlineKPI.prefix}
        suffix={team.headlineKPI.suffix}
        className="font-extrabold tracking-[-0.04em] tabular-nums"
        hue={team.hue}
      />
    </div>
  );
}

// ── KPIStrip with animated sparklines ───────────────────────────────

function KPIStrip({
  kpis, hue, bodyKey,
}: { kpis: readonly KPI[]; hue: string; bodyKey: number }) {
  return (
    <div className="mt-6 grid grid-cols-3 gap-3">
      {kpis.map((k, i) => (
        <KPITile key={`${bodyKey}-${i}`} kpi={k} hue={hue} delay={0.05 + i * 0.07} />
      ))}
    </div>
  );
}

function KPITile({ kpi, hue, delay }: { kpi: KPI; hue: string; delay: number }) {
  return (
    <motion.div
      className="p-3.5 rounded-xl bg-white relative overflow-hidden"
      style={{ border: "1px solid var(--m-border)" }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p
          className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
          style={{ color: "var(--m-text-soft)" }}
        >
          {kpi.label}
        </p>
        {kpi.trend && (
          <span
            className="text-[9.5px] font-bold tabular-nums"
            style={{
              color: kpi.trend.startsWith("-") && !kpi.label.toLowerCase().includes("cycle") && !kpi.label.toLowerCase().includes("payback") && !kpi.label.toLowerCase().includes("hire") && !kpi.label.toLowerCase().includes("incidents") && !kpi.label.toLowerCase().includes("burn") && !kpi.label.toLowerCase().includes("approvals")
                ? "var(--status-stuck)"
                : hue,
            }}
          >
            {kpi.trend}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <CountUp
          to={kpi.to}
          decimals={kpi.decimals}
          prefix={kpi.prefix}
          suffix={kpi.suffix}
          hue="var(--m-text)"
          className="text-[18px] font-bold tabular-nums"
        />
      </div>
      <Sparkline points={kpi.sparkline} hue={hue} delay={delay + 0.2} />
    </motion.div>
  );
}

// ── Sparkline: SVG path that draws itself ───────────────────────────

function Sparkline({
  points, hue, delay,
}: { points: readonly number[]; hue: string; delay: number }) {
  const w = 100;
  const h = 22;
  const stepX = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${h - p * h}`)
    .join(" ");
  const fillPath = `${path} L ${w} ${h} L 0 ${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 w-full"
      preserveAspectRatio="none"
      style={{ height: 22 }}
    >
      <motion.path
        d={fillPath}
        fill={hue}
        fillOpacity={0.12}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: delay + 0.3 }}
      />
      <motion.path
        d={path}
        stroke={hue}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, delay, ease: [0.22, 1, 0.36, 1] }}
      />
      {/* End dot */}
      <motion.circle
        cx={w}
        cy={h - (points[points.length - 1] ?? 0) * h}
        r="2"
        fill={hue}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: delay + 1.0 }}
      />
    </svg>
  );
}

// ── Activity row: avatars + auto-cycling ticker ─────────────────────

function ActivityRow({
  ticker, avatars, hue,
}: { ticker: readonly TickerItem[]; avatars: readonly Avatar[]; hue: string }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % ticker.length), 4000);
    return () => clearInterval(t);
  }, [ticker.length]);

  const item = ticker[idx];

  return (
    <div
      className="mt-6 flex items-center gap-4 px-4 py-3 rounded-xl"
      style={{
        backgroundColor: "var(--m-surface)",
        border: "1px solid var(--m-border)",
      }}
    >
      {/* Avatar stack */}
      <div className="flex -space-x-1.5">
        {avatars.slice(0, 5).map((a, i) => (
          <span
            key={i}
            className="w-7 h-7 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white"
            style={{ backgroundColor: a.hue, zIndex: avatars.length - i }}
          >
            {a.initials}
          </span>
        ))}
        {avatars.length > 5 && (
          <span
            className="w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-white"
            style={{
              backgroundColor: "var(--m-border)",
              color: "var(--m-text-muted)",
            }}
          >
            +{avatars.length - 5}
          </span>
        )}
      </div>

      {/* Live ticker */}
      <div className="flex-1 min-w-0 overflow-hidden h-6 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            className="absolute inset-0 flex items-center gap-2"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.35 }}
          >
            <span className="text-[14px]">{item.icon}</span>
            <span className="text-[12.5px] truncate" style={{ color: "var(--m-text)" }}>
              {item.text}
            </span>
            <span className="ml-auto text-[10px]" style={{ color: "var(--m-text-soft)" }}>
              {item.time}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Live dot */}
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <motion.span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: hue }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: hue }}>
          Live
        </span>
      </span>
    </div>
  );
}

// ── Right rail per team — distribution chart + quick actions ────────

function RightRail({ team, bodyKey }: { team: TeamData; bodyKey: number }) {
  return (
    <>
      <div>
        <p
          className="text-[9.5px] font-bold uppercase tracking-[0.18em]"
          style={{ color: "var(--m-text-soft)" }}
        >
          This week
        </p>
        <p
          className="mt-2 font-extrabold text-[26px] tracking-tight tabular-nums"
          style={{ color: team.hue }}
        >
          <CountUp
            key={`week-${bodyKey}`}
            to={team.id === "sales" ? 47 : team.id === "ops" ? 38 : team.id === "hr" ? 12 : team.id === "finance" ? 23 : team.id === "eng" ? 18 : 24}
            hue={team.hue}
            className="font-extrabold tabular-nums"
          />
        </p>
        <p className="mt-1 text-[11px]" style={{ color: "var(--m-text-muted)" }}>
          {team.id === "sales" ? "deals advanced"
            : team.id === "ops" ? "SOP runs completed"
            : team.id === "hr" ? "reviews signed off"
            : team.id === "finance" ? "approvals processed"
            : team.id === "eng" ? "deploys shipped"
            : "campaigns active"}
        </p>
        <motion.div
          key={`bar-${bodyKey}`}
          className="mt-3 h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: "var(--m-border)" }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: team.hue }}
            initial={{ width: 0 }}
            animate={{ width: "78%" }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
        </motion.div>
      </div>

      <div className="mt-6">
        <p
          className="text-[9.5px] font-bold uppercase tracking-[0.18em] mb-2"
          style={{ color: "var(--m-text-soft)" }}
        >
          Quick actions
        </p>
        <div className="space-y-1.5">
          {(team.id === "sales" ? ["+ New deal", "Log call", "Forecast"]
            : team.id === "ops" ? ["Run SOP", "Vendor PR", "Incident"]
            : team.id === "hr" ? ["+ New role", "Start review", "Onboard"]
            : team.id === "finance" ? ["Approve PO", "Run report", "Reconcile"]
            : team.id === "eng" ? ["New sprint", "Deploy", "Bug triage"]
            : ["+ Campaign", "Lead form", "Email blast"]
          ).map((action) => (
            <button
              key={action}
              className="w-full text-left text-[11.5px] font-semibold px-3 py-2 rounded-md bg-white transition-colors hover:border-[color:var(--m-border-dark)]"
              style={{
                color: "var(--m-text)",
                border: "1px solid var(--m-border)",
              }}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-4">
        <button
          className="w-full inline-flex items-center justify-between text-[12px] font-semibold px-3 py-2.5 rounded-md text-white"
          style={{ backgroundColor: team.hue }}
        >
          Open {team.name} hub <ArrowRight size={12} />
        </button>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// CountUp — animates from 0 → target whenever `key` changes
// ════════════════════════════════════════════════════════════════════

function CountUp({
  to, decimals, prefix, suffix, hue, className, duration = 1.2,
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  hue: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const ctl = animate(0, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setValue(v),
    });
    return () => ctl.stop();
  }, [inView, to, duration]);

  const formatted = decimals !== undefined
    ? value.toFixed(decimals)
    : Math.round(value).toLocaleString();

  return (
    <motion.span
      ref={ref}
      className={className}
      style={{
        color: hue,
        fontSize: className?.includes("text-") ? undefined : "clamp(2.5rem, 4vw, 3.6rem)",
        lineHeight: 1,
      }}
    >
      {prefix}
      {formatted}
      {suffix}
    </motion.span>
  );
}

// ════════════════════════════════════════════════════════════════════
// Per-team body content (the main visualization for each workspace)
// ════════════════════════════════════════════════════════════════════

// 1. SALES — Pipeline stages with animated fills + closing-this-week list
function SalesBody({ hue, hueSoft, bodyKey }: { hue: string; hueSoft: string; bodyKey: number }) {
  const stages = [
    { stage: "Discovery",  count: 18, value: "$680k", hue: "#94a3b8", pct: 28 },
    { stage: "Demo",       count: 9,  value: "$540k", hue: "#0073EA", pct: 52 },
    { stage: "Negotiation", count: 6, value: "$820k", hue: hue,       pct: 78 },
    { stage: "Closed won", count: 4,  value: "$360k", hue: "#10b981", pct: 100 },
  ];
  const deals = [
    { name: "Helios Labs",        owner: "DP", amount: "$120k", stage: "Negotiation" },
    { name: "Stratum Logistics", owner: "MC", amount: "$84k",  stage: "Negotiation" },
    { name: "Quill Health",       owner: "PI", amount: "$95k",  stage: "Demo" },
  ];
  return (
    <div>
      <div className="grid grid-cols-4 gap-2.5">
        {stages.map((s, i) => (
          <motion.div
            key={`${bodyKey}-${s.stage}`}
            className="rounded-xl p-3 bg-white"
            style={{ border: "1px solid var(--m-border)" }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 + i * 0.05 }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: s.hue }}>
                {s.stage}
              </span>
              <span className="text-[10px] font-mono" style={{ color: "var(--m-text-soft)" }}>{s.count}</span>
            </div>
            <p className="mt-1.5 text-[16px] font-bold tabular-nums" style={{ color: "var(--m-text)" }}>{s.value}</p>
            <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: s.hue }}
                initial={{ width: 0 }}
                animate={{ width: `${s.pct}%` }}
                transition={{ duration: 0.9, delay: 0.2 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Closing this week */}
      <div className="mt-4 rounded-xl overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
        <p
          className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}
        >
          Closing this week
        </p>
        {deals.map((d, i) => (
          <motion.div
            key={`${bodyKey}-${d.name}`}
            className="grid grid-cols-[1.4fr_60px_1fr_120px] gap-2 px-4 py-2.5 items-center border-t"
            style={{ borderColor: "var(--m-border)" }}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: 0.4 + i * 0.05 }}
          >
            <span className="text-[12px] font-semibold truncate" style={{ color: "var(--m-text)" }}>
              {d.name}
            </span>
            <span
              className="w-6 h-6 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
              style={{ backgroundColor: hue }}
            >
              {d.owner}
            </span>
            <span className="text-[12px] font-bold tabular-nums text-right" style={{ color: "var(--m-text)" }}>
              {d.amount}
            </span>
            <span
              className="text-[9px] font-bold text-white text-center px-2 h-6 inline-flex items-center justify-center rounded-md"
              style={{ backgroundColor: "#f59e0b" }}
            >
              {d.stage}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// 2. OPERATIONS — SOP run table with status pills
function OpsBody({ hue, hueSoft, bodyKey }: { hue: string; hueSoft: string; bodyKey: number }) {
  const tasks: { label: string; sop: string; status: "done" | "working" | "stuck"; owner: string; ownerHue: string }[] = [
    { label: "Morning shift handover",       sop: "SOP-011", status: "done",    owner: "PI", ownerHue: "#0073EA" },
    { label: "Vendor quality check · batch 42", sop: "SOP-067", status: "done", owner: "KP", ownerHue: "#10b981" },
    { label: "Equipment safety inspection",   sop: "SOP-104", status: "working", owner: "MR", ownerHue: "#d946ef" },
    { label: "End-of-day inventory count",    sop: "SOP-141", status: "working", owner: "PI", ownerHue: "#0073EA" },
    { label: "Compliance audit log review",   sop: "SOP-208", status: "stuck",   owner: "AS", ownerHue: "#7c3aed" },
  ];
  const statusProps = {
    done:    { bg: "var(--status-done)",    label: "Done",    pct: 100 },
    working: { bg: "var(--status-working)", label: "Working", pct: 60 },
    stuck:   { bg: "var(--status-stuck)",   label: "Stuck",   pct: 30 },
  };
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
      <div
        className="grid grid-cols-[1.4fr_100px_64px_88px_64px] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}
      >
        <span>SOP run</span>
        <span>Reference</span>
        <span>Owner</span>
        <span className="text-center">Status</span>
        <span className="text-right">Progress</span>
      </div>
      {tasks.map((t, i) => {
        const s = statusProps[t.status];
        return (
          <motion.div
            key={`${bodyKey}-${t.sop}`}
            className="grid grid-cols-[1.4fr_100px_64px_88px_64px] gap-2 px-4 py-2.5 items-center border-t border-l-[3px]"
            style={{ borderColor: "var(--m-border)", borderLeftColor: s.bg }}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.05 + i * 0.06 }}
          >
            <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--m-text)" }}>
              {t.label}
            </span>
            <span className="text-[11px] font-mono" style={{ color: "var(--m-text-soft)" }}>{t.sop}</span>
            <span
              className="w-6 h-6 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
              style={{ backgroundColor: t.ownerHue }}
            >
              {t.owner}
            </span>
            <span
              className="text-[10px] font-bold text-white text-center px-2 h-6 inline-flex items-center justify-center rounded-md"
              style={{ backgroundColor: s.bg }}
            >
              {s.label}
            </span>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: s.bg }}
                initial={{ width: 0 }}
                animate={{ width: `${s.pct}%` }}
                transition={{ duration: 0.7, delay: 0.25 + i * 0.06 }}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// 3. HR — Cycle dashboard + queue
function HRBody({ hue, hueSoft, bodyKey }: { hue: string; hueSoft: string; bodyKey: number }) {
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-3">
      <motion.div
        className="rounded-xl p-4 bg-white"
        style={{ border: "1px solid var(--m-border)" }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold" style={{ color: "var(--m-text)" }}>Review cycle</span>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: hue }}>72%</span>
        </div>
        <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
          <motion.div
            key={`cycle-${bodyKey}`}
            className="h-full rounded-full"
            style={{ backgroundColor: hue }}
            initial={{ width: 0 }}
            animate={{ width: "72%" }}
            transition={{ duration: 1, delay: 0.2 }}
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[
            { label: "Self",        done: 22, total: 24, hue },
            { label: "Manager",     done: 19, total: 24, hue: "#7c3aed" },
            { label: "360 peer",    done: 68, total: 96, hue: "#0073EA" },
            { label: "Calibration", done: 4,  total: 9,  hue: "#f59e0b" },
          ].map((s, i) => {
            const pct = (s.done / s.total) * 100;
            return (
              <motion.div
                key={`${bodyKey}-${s.label}`}
                className="bg-white rounded-md p-2"
                style={{ border: "1px solid var(--m-border)" }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.06 }}
              >
                <p className="text-[8.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--m-text-soft)" }}>{s.label}</p>
                <p className="mt-0.5 text-[11.5px] font-bold tabular-nums" style={{ color: "var(--m-text)" }}>
                  {s.done}<span className="text-[8.5px] font-normal" style={{ color: "var(--m-text-soft)" }}>/{s.total}</span>
                </p>
                <div className="mt-1 h-0.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
                  <motion.div className="h-full rounded-full" style={{ backgroundColor: s.hue }}
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.7, delay: 0.45 + i * 0.06 }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      <motion.div
        className="rounded-xl p-4 bg-white"
        style={{ border: "1px solid var(--m-border)" }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--m-text-soft)" }}>
          Open seats · 7
        </p>
        <div className="mt-3 space-y-2">
          {[
            { title: "Senior PM · Growth",     candidates: 12 },
            { title: "Staff Eng · Platform",   candidates: 9  },
            { title: "Customer Success Lead",  candidates: 18 },
            { title: "Sales Engineer · East",  candidates: 6  },
          ].map((s, i) => (
            <motion.div
              key={`${bodyKey}-${s.title}`}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-white"
              style={{ border: "1px solid var(--m-border)" }}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.07 }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: hue }} />
              <span className="text-[11.5px] font-medium flex-1 truncate" style={{ color: "var(--m-text)" }}>{s.title}</span>
              <span className="text-[10px] font-bold" style={{ color: hue }}>{s.candidates}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// 4. FINANCE — Budget vs actuals
function FinanceBody({ hue, hueSoft, bodyKey }: { hue: string; hueSoft: string; bodyKey: number }) {
  const budgets: { dept: string; budget: string; actual: string; pct: number; over?: boolean }[] = [
    { dept: "Engineering",   budget: "$184k", actual: "$172k", pct: 93 },
    { dept: "Sales + GTM",   budget: "$142k", actual: "$138k", pct: 97 },
    { dept: "Operations",    budget: "$96k",  actual: "$104k", pct: 108, over: true },
    { dept: "Marketing",     budget: "$78k",  actual: "$71k",  pct: 91 },
    { dept: "G&A",           budget: "$54k",  actual: "$49k",  pct: 91 },
  ];
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
      <div
        className="grid grid-cols-[1.2fr_1fr_1fr_minmax(0,1.4fr)] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}
      >
        <span>Department</span>
        <span className="text-right">Budget</span>
        <span className="text-right">Actual</span>
        <span>Utilization</span>
      </div>
      {budgets.map((b, i) => (
        <motion.div
          key={`${bodyKey}-${b.dept}`}
          className="grid grid-cols-[1.2fr_1fr_1fr_minmax(0,1.4fr)] gap-2 px-4 py-2.5 items-center border-t"
          style={{ borderColor: "var(--m-border)" }}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.05 + i * 0.06 }}
        >
          <span className="text-[12.5px] font-semibold truncate" style={{ color: "var(--m-text)" }}>{b.dept}</span>
          <span className="text-[11.5px] tabular-nums text-right" style={{ color: "var(--m-text-muted)" }}>{b.budget}</span>
          <span
            className="text-[12px] font-bold tabular-nums text-right"
            style={{ color: b.over ? "var(--status-stuck)" : "var(--m-text)" }}
          >
            {b.actual}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: b.over ? "var(--status-stuck)" : hue }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, b.pct)}%` }}
                transition={{ duration: 0.9, delay: 0.2 + i * 0.06 }}
              />
            </div>
            <span
              className="text-[10.5px] font-bold tabular-nums w-9 text-right"
              style={{ color: b.over ? "var(--status-stuck)" : hue }}
            >
              {b.pct}%
            </span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// 5. ENGINEERING — Sprint board
function EngBody({ hue, hueSoft, bodyKey }: { hue: string; hueSoft: string; bodyKey: number }) {
  const cols: { title: string; count: number; color: string; cards: { label: string; type: "feat" | "bug" | "chore"; pts: number; owner?: string; done?: boolean }[] }[] = [
    { title: "Backlog",     count: 14, color: "#94a3b8", cards: [
      { label: "Add filter chips to KPI board", type: "feat",  pts: 3 },
      { label: "Refactor Inbox reducer",         type: "chore", pts: 5 },
    ]},
    { title: "In progress", count: 6,  color: "#0073EA", cards: [
      { label: "Cmd-K AI suggestions v2",  type: "feat", pts: 8, owner: "MC" },
      { label: "Org-chart drag handles",   type: "feat", pts: 5, owner: "JR" },
    ]},
    { title: "Review",      count: 3,  color: hue,       cards: [
      { label: "Webhook signing keys",         type: "chore", pts: 3, owner: "PI" },
      { label: "Budget vs actuals delta calc", type: "bug",   pts: 2, owner: "DK" },
    ]},
    { title: "Shipped",     count: 7,  color: "#10b981", cards: [
      { label: "OKR cascade refactor",      type: "feat", pts: 8, owner: "SC", done: true },
      { label: "Composite score weight UI", type: "feat", pts: 5, owner: "MC", done: true },
    ]},
  ];
  const typeProps = {
    feat:  { bg: "#dcfce7", color: "#15803d", label: "FEAT"  },
    bug:   { bg: "#fee2e2", color: "#b91c1c", label: "BUG"   },
    chore: { bg: "#e0e7ff", color: "#3730a3", label: "CHORE" },
  };
  return (
    <div className="grid grid-cols-4 gap-2">
      {cols.map((col, ci) => (
        <motion.div
          key={`${bodyKey}-${col.title}`}
          className="rounded-lg p-2"
          style={{ backgroundColor: "var(--m-surface)" }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 + ci * 0.06 }}
        >
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: col.color }} />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: col.color }}>
                {col.title}
              </span>
            </div>
            <span className="text-[9px] font-mono" style={{ color: "var(--m-text-soft)" }}>{col.count}</span>
          </div>
          <div className="space-y-1.5">
            {col.cards.map((card, i) => {
              const t = typeProps[card.type];
              return (
                <motion.div
                  key={`${bodyKey}-${col.title}-${i}`}
                  className="bg-white rounded-md p-2 shadow-sm"
                  style={{ border: "1px solid var(--m-border)" }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + ci * 0.06 + i * 0.04 }}
                >
                  <p
                    className={`text-[11px] font-medium leading-snug ${card.done ? "line-through opacity-60" : ""}`}
                    style={{ color: "var(--m-text)" }}
                  >
                    {card.label}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className="text-[8.5px] font-bold px-1.5 h-4 inline-flex items-center rounded-sm"
                      style={{ backgroundColor: t.bg, color: t.color }}
                    >
                      {t.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold" style={{ color: "var(--m-text-muted)" }}>
                        {card.pts}pt
                      </span>
                      {card.owner && (
                        <span
                          className="w-4 h-4 rounded-full text-white text-[8px] font-bold flex items-center justify-center"
                          style={{ backgroundColor: hue }}
                        >
                          {card.owner}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// 6. MARKETING — Campaign table
function MarketingBody({ hue, hueSoft, bodyKey }: { hue: string; hueSoft: string; bodyKey: number }) {
  const campaigns: {
    name: string; channel: string; status: "live" | "draft" | "paused";
    pipeline: string; mql: number; hue: string;
  }[] = [
    { name: "Q3 outbound · enterprise", channel: "Email + LinkedIn", status: "live",   pipeline: "$840k", mql: 47, hue: hue       },
    { name: "Series of webinars",        channel: "Webinar",          status: "live",   pipeline: "$320k", mql: 24, hue: "#0073EA" },
    { name: "Product launch · v4.2",     channel: "Multi",            status: "live",   pipeline: "$1.2M", mql: 89, hue: "#FF3D57" },
    { name: "ABM · top 50 healthcare",   channel: "Ads + Sales",      status: "draft",  pipeline: "—",      mql: 0,  hue: "#94a3b8" },
    { name: "Customer advocacy",          channel: "Field",            status: "paused", pipeline: "$140k", mql: 18, hue: "#94a3b8" },
  ];
  const statusProps = {
    live:   { bg: "#10b981", label: "Live"   },
    draft:  { bg: "#94a3b8", label: "Draft"  },
    paused: { bg: "#f59e0b", label: "Paused" },
  };
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
      <div
        className="grid grid-cols-[1.6fr_1fr_1fr_80px_80px] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}
      >
        <span>Campaign</span>
        <span>Channel</span>
        <span className="text-right">Pipeline</span>
        <span className="text-center">MQL</span>
        <span className="text-center">Status</span>
      </div>
      {campaigns.map((c, i) => {
        const s = statusProps[c.status];
        return (
          <motion.div
            key={`${bodyKey}-${c.name}`}
            className="grid grid-cols-[1.6fr_1fr_1fr_80px_80px] gap-2 px-4 py-2.5 items-center border-t border-l-[3px]"
            style={{ borderColor: "var(--m-border)", borderLeftColor: c.hue }}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.05 + i * 0.06 }}
          >
            <span className="text-[12.5px] font-semibold truncate" style={{ color: "var(--m-text)" }}>
              {c.name}
            </span>
            <span className="text-[11px] truncate" style={{ color: "var(--m-text-muted)" }}>
              {c.channel}
            </span>
            <span className="text-[12px] font-bold tabular-nums text-right" style={{ color: "var(--m-text)" }}>
              {c.pipeline}
            </span>
            <span className="text-[11.5px] font-bold tabular-nums text-center" style={{ color: c.hue }}>
              {c.mql || "—"}
            </span>
            <span
              className="text-[9px] font-bold text-white text-center px-2 h-6 inline-flex items-center justify-center rounded-md"
              style={{ backgroundColor: s.bg }}
            >
              {s.label}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
