// Product mosaic — monday-quality tiles.
//
// Each tile is a real product surface snapshot with proper product
// chrome: top tab strip (Dashboard / Gantt / Kanban), Integrate +
// Automate badges, optional sidebar, real chart elements (donut,
// bar, gauge), big callout KPI numbers, floating avatar pins, mix
// of light and dark themed tiles for visual rhythm.

"use client";

import { motion } from "framer-motion";
import {
  Zap, Clock, MapPin, Search, Bell, Plus, MoreHorizontal, Sparkles,
} from "lucide-react";

// ════════════════════════════════════════════════════════════════════
// Tokens
// ════════════════════════════════════════════════════════════════════

const STATUS = {
  done:    { bg: "#00C875", label: "Done"     },
  working: { bg: "#FDAB3D", label: "Working"  },
  stuck:   { bg: "#E2445C", label: "Stuck"    },
  review:  { bg: "#579BFC", label: "Review"   },
  special: { bg: "#A25DDC", label: "Special"  },
  neutral: { bg: "#94A3B8", label: "Default"  },
};

const SHADOW =
  "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.10), 0 28px 60px -24px rgba(15,23,42,0.18)";
const SHADOW_HOVER =
  "0 2px 4px rgba(15,23,42,0.05), 0 14px 32px -10px rgba(15,23,42,0.14), 0 36px 72px -28px rgba(15,23,42,0.24)";

// ════════════════════════════════════════════════════════════════════
// Section
// ════════════════════════════════════════════════════════════════════

export function ProductMosaic() {
  return (
    <section
      className="relative py-24 lg:py-32 overflow-hidden"
      style={{ backgroundColor: "var(--m-surface)" }}
    >
      <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
        <motion.div
          className="max-w-3xl"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--brand-red)" }}>
            One canvas
          </p>
          <h2
            className="mt-5 font-extrabold tracking-[-0.03em]"
            style={{
              color: "var(--m-text)",
              fontSize: "clamp(2rem, 4vw, 3.4rem)",
              lineHeight: 1.04,
            }}
          >
            Run <span style={{ color: "var(--brand-red)" }}>every workflow</span>{" "}
            your team has &mdash; <br className="hidden md:block" />on one canvas.
          </h2>
          <p className="mt-5 text-base lg:text-lg leading-relaxed max-w-2xl" style={{ color: "var(--m-text-muted)" }}>
            Tasks, KPIs, OKRs, SOPs, expenses, kudos, pipeline, reviews,
            campaigns, recruiting, dashboards, calendars. 100+ surfaces on
            one platform &mdash; all wired to the same data model.
          </p>
        </motion.div>
      </div>

      <div className="relative mt-16 lg:mt-20 space-y-5 lg:space-y-6">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-40 z-10"
          style={{ background: "linear-gradient(to right, var(--m-surface), transparent)" }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-40 z-10"
          style={{ background: "linear-gradient(to left, var(--m-surface), transparent)" }}
        />

        <MarqueeRow direction="left"  duration={90}  tiles={ROW_1} />
        <MarqueeRow direction="right" duration={105} tiles={ROW_2} />
        <MarqueeRow direction="left"  duration={95}  tiles={ROW_3} />
      </div>
    </section>
  );
}

function MarqueeRow({
  direction, duration, tiles,
}: { direction: "left" | "right"; duration: number; tiles: React.ReactNode[] }) {
  const animateX = direction === "left" ? ["0%", "-50%"] : ["-50%", "0%"];
  return (
    <div className="overflow-hidden">
      <motion.div
        className="flex gap-5 lg:gap-6 w-max"
        animate={{ x: animateX }}
        transition={{ x: { duration, ease: "linear", repeat: Infinity } }}
      >
        {[...tiles, ...tiles].map((tile, i) => (
          <div key={i} className="flex-shrink-0">{tile}</div>
        ))}
      </motion.div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Tile shell — supports product chrome (sidebar + tabs + badges)
// ════════════════════════════════════════════════════════════════════

interface TileChrome {
  brand?: string;          // small brand name top-left (e.g. "monday.com")
  tabs?: readonly string[]; // tab labels
  activeTab?: number;
  integrate?: boolean;     // show Integrate badge
  automateN?: number;      // show Automate / N badge
  brandHue?: string;
}

function Tile({
  width = 480,
  height = 340,
  dark = false,
  chrome,
  children,
}: {
  width?: number;
  height?: number;
  dark?: boolean;
  chrome?: TileChrome;
  children: React.ReactNode;
}) {
  const bg = dark ? "#0E1626" : "white";
  const fg = dark ? "rgba(255,255,255,0.92)" : "var(--m-text)";
  const border = dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid var(--m-border)";
  const dividerColor = dark ? "rgba(255,255,255,0.06)" : "var(--m-border)";
  const subText = dark ? "rgba(255,255,255,0.55)" : "var(--m-text-soft)";

  return (
    <div
      className="relative rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1"
      style={{
        width, height,
        backgroundColor: bg,
        color: fg,
        border,
        boxShadow: SHADOW,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = SHADOW_HOVER; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = SHADOW; }}
    >
      {chrome && (
        <div
          className="flex items-center gap-3 px-3.5 h-9 text-[11px]"
          style={{ borderBottom: `1px solid ${dividerColor}` }}
        >
          {chrome.brand && (
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: chrome.brandHue ?? "var(--brand-red)" }}
              />
              <span className="font-bold" style={{ color: fg }}>{chrome.brand}</span>
            </div>
          )}
          {chrome.tabs && (
            <div className="flex items-center gap-3.5">
              {chrome.tabs.map((tab, i) => {
                const active = i === (chrome.activeTab ?? 0);
                return (
                  <span
                    key={tab}
                    className="relative pb-1 font-semibold"
                    style={{
                      color: active ? fg : subText,
                      fontSize: 10.5,
                    }}
                  >
                    {tab}
                    {active && (
                      <span
                        className="absolute inset-x-0 -bottom-px h-[2px]"
                        style={{ backgroundColor: chrome.brandHue ?? "var(--brand-red)" }}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {chrome.integrate && (
              <span className="inline-flex items-center gap-1 font-medium" style={{ color: subText }}>
                <Zap size={10} /> Integrate
              </span>
            )}
            {typeof chrome.automateN === "number" && (
              <span className="inline-flex items-center gap-1 font-medium" style={{ color: subText }}>
                <Clock size={10} /> Automate <span style={{ color: subText, opacity: 0.6 }}>/</span> {chrome.automateN}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="px-4 py-4 h-full">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Chart primitives
// ════════════════════════════════════════════════════════════════════

function DonutChart({
  segments, size = 92,
}: {
  segments: { value: number; color: string }[];
  size?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke="rgba(15,23,42,0.08)" strokeWidth="10" fill="none"
      />
      {segments.map((seg, i) => {
        const len = (seg.value / total) * c;
        const dash = `${len} ${c - len}`;
        const elem = (
          <circle
            key={i}
            cx={size / 2} cy={size / 2} r={r}
            stroke={seg.color}
            strokeWidth="10"
            strokeDasharray={dash}
            strokeDashoffset={-offset}
            fill="none"
            strokeLinecap="butt"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += len;
        return elem;
      })}
    </svg>
  );
}

function BarChartMini({
  bars, height = 56, color = "var(--brand-red)",
}: {
  bars: { v: number; alt?: string }[];
  height?: number;
  color?: string;
}) {
  const max = Math.max(...bars.map((b) => b.v));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {bars.map((b, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${(b.v / max) * 100}%`,
            backgroundColor: b.alt ?? (i % 2 === 0 ? color : `${color}88`),
            minWidth: 6,
          }}
        />
      ))}
    </div>
  );
}

function GaugeChart({
  pct, size = 120, color = "var(--brand-red)", track = "rgba(15,23,42,0.08)",
}: { pct: number; size?: number; color?: string; track?: string }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const visible = c * 0.75;
  const used = (pct / 100) * visible;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(135deg)" }}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={track} strokeWidth="10" fill="none"
        strokeDasharray={`${visible} ${c - visible}`}
        strokeLinecap="round"
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={color} strokeWidth="10" fill="none"
        strokeDasharray={`${used} ${c - used}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function StylizedMap({ height = 100 }: { height?: number }) {
  // A friendly stylized USA-ish outline. Decorative, not literal geography.
  return (
    <svg viewBox="0 0 240 80" width="100%" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="mapGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(87, 155, 252, 0.16)" />
          <stop offset="1" stopColor="rgba(87, 155, 252, 0.04)" />
        </linearGradient>
      </defs>
      <path
        d="M10 28 Q30 18 50 26 T100 22 Q130 14 165 28 T220 30 L228 56 Q200 64 165 60 T100 64 Q70 70 50 62 T10 56 Z"
        fill="url(#mapGrad)"
        stroke="rgba(87, 155, 252, 0.35)"
        strokeWidth="0.8"
      />
      <path d="M50 35 L62 36 M86 32 L102 31 M120 38 L134 39 M156 35 L170 36 M188 42 L202 41" stroke="rgba(87, 155, 252, 0.3)" strokeWidth="0.6" strokeDasharray="2 2" fill="none" />
    </svg>
  );
}

// ── Small primitives ────────────────────────────────────────────────

function StatusPill({ kind, label }: { kind: keyof typeof STATUS; label?: string }) {
  const s = STATUS[kind];
  return (
    <span
      className="inline-flex items-center justify-center text-[10px] font-bold text-white px-2 h-[22px] rounded-md min-w-[60px]"
      style={{ backgroundColor: s.bg }}
    >
      {label ?? s.label}
    </span>
  );
}

function Avatar({ initials, hue, size = 22 }: { initials: string; hue: string; size?: number }) {
  return (
    <span
      className="rounded-full text-white font-bold flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: hue, width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  );
}

function FloatingAvatar({ initials, hue, top, left, right }: {
  initials: string; hue: string; top?: string; left?: string; right?: string;
}) {
  return (
    <span
      className="absolute rounded-full border-2 border-white shadow-[0_6px_14px_-4px_rgba(15,23,42,0.25)] flex items-center justify-center text-white font-bold"
      style={{ backgroundColor: hue, width: 26, height: 26, fontSize: 10, top, left, right, zIndex: 5 }}
    >
      {initials}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// TILES — each one a polished product surface
// ════════════════════════════════════════════════════════════════════

// 1. Q3 Results — Dashboard with bar charts + map
function TileQResults() {
  return (
    <Tile
      width={500}
      chrome={{
        tabs: ["Dashboard", "Gantt", "Kanban"],
        activeTab: 0,
        integrate: true,
        automateN: 2,
        brandHue: "#FF3D57",
      }}
    >
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--m-text-soft)" }}>
          Q3 Results
        </p>
        <p className="font-extrabold text-[15px] tracking-tight" style={{ color: "var(--m-text)" }}>
          Q results
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "Team time tracking", color: "#FF3D57" },
            { label: "Quarterly goal",      color: "#A25DDC" },
            { label: "Monthly revenue",     color: "#00C875" },
          ].map((c, i) => (
            <div key={i} className="rounded-lg p-2.5" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] mb-1.5" style={{ color: "var(--m-text-soft)" }}>
                {c.label}
              </p>
              <BarChartMini
                bars={[{ v: 3 }, { v: 5 }, { v: 4 }, { v: 6 }, { v: 5 }]}
                color={c.color}
                height={36}
              />
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg overflow-hidden relative" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
          <div className="px-2.5 pt-2 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--m-text-soft)" }}>
            Event location
          </div>
          <StylizedMap height={68} />
          <FloatingAvatar initials="MD" hue="#FF3D57" top="34px" left="46%" />
        </div>
      </div>
    </Tile>
  );
}

// 2. IT Tickets — Dashboard with donut + table
function TileTickets() {
  return (
    <Tile
      width={500}
      chrome={{
        tabs: ["Dashboard", "Gantt", "Kanban"],
        activeTab: 0,
        integrate: true,
        automateN: 2,
        brandHue: "#579BFC",
      }}
    >
      <div>
        <p className="font-extrabold text-[15px] tracking-tight" style={{ color: "var(--m-text)" }}>
          IT Tickets
        </p>

        <div className="mt-3 grid grid-cols-[120px_1fr_1fr] gap-2.5">
          {/* Donut */}
          <div className="rounded-lg p-2 flex flex-col items-center" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
            <p className="text-[8.5px] font-bold uppercase tracking-[0.1em] mb-1 self-start" style={{ color: "var(--m-text-soft)" }}>
              By urgency
            </p>
            <DonutChart
              size={68}
              segments={[
                { value: 50, color: "#E2445C" },
                { value: 30, color: "#FDAB3D" },
                { value: 20, color: "#579BFC" },
              ]}
            />
            <div className="flex flex-wrap gap-1 mt-1 justify-center">
              <LegendDot c="#E2445C" l="High" />
              <LegendDot c="#FDAB3D" l="Mid" />
              <LegendDot c="#579BFC" l="Low" />
            </div>
          </div>

          {/* Avg time KPI */}
          <div className="rounded-lg p-3 flex flex-col justify-between" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
            <p className="text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--m-text-soft)" }}>
              Avg resolution
            </p>
            <p className="text-[26px] font-extrabold tabular-nums tracking-tight" style={{ color: "var(--m-text)" }}>
              3<span className="text-[14px] font-bold" style={{ color: "var(--m-text-soft)" }}>hrs</span>
            </p>
          </div>

          {/* Open tickets KPI */}
          <div className="rounded-lg p-3 flex flex-col justify-between" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
            <p className="text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--m-text-soft)" }}>
              Open
            </p>
            <p className="text-[26px] font-extrabold tabular-nums tracking-tight" style={{ color: "#579BFC" }}>
              2 <span className="text-[12px] font-bold" style={{ color: "var(--m-text-soft)" }}>tickets</span>
            </p>
          </div>
        </div>

        {/* Tickets table */}
        <div className="mt-3 rounded-lg overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
          <div className="grid grid-cols-[1.4fr_60px_64px] gap-2 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}>
            <span>Open ticket</span>
            <span>Status</span>
            <span>Urgency</span>
          </div>
          {[
            { t: "Need new software license", s: "done"    as const, u: "Resolved", uHue: "#00C875" },
            { t: "Wifi is super slow today",   s: "working" as const, u: "Working",  uHue: "#FDAB3D" },
          ].map((r, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_60px_64px] gap-2 px-3 py-1.5 items-center border-t" style={{ borderColor: "var(--m-border)" }}>
              <span className="text-[10.5px] font-medium truncate" style={{ color: "var(--m-text)" }}>{r.t}</span>
              <StatusPill kind={r.s} label={STATUS[r.s].label} />
              <span className="text-[9.5px] font-bold text-white text-center px-1.5 h-[20px] inline-flex items-center justify-center rounded" style={{ backgroundColor: r.uHue }}>{r.u}</span>
            </div>
          ))}
        </div>
      </div>
    </Tile>
  );
}
function LegendDot({ c, l }: { c: string; l: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[8px]" style={{ color: "var(--m-text)" }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} /> {l}
    </span>
  );
}

// 3. Financial dashboard — DARK, KPIs + map
function TileFinance() {
  return (
    <Tile dark width={520}>
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "#E2445C" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#E2445C" }} />
            Responsible Adult · Feb 2026
          </span>
          <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>14-day streak · 1240 SP</span>
        </div>
        <p className="font-extrabold text-[18px] tracking-tight" style={{ color: "white" }}>
          Your finances <span style={{ color: "#00C875" }}>are thriving.</span>
        </p>
        <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
          You've only burned 15% of your budget. Record-breaking surplus.
        </p>

        {/* 3 KPI cards */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <DarkKPI label="Saved" value="$2.8k" sub="of $500 goal" hue="#00C875" />
          <DarkKPI label="Top earner" value="$3.2k" sub="84% reached" hue="#A25DDC" />
          <DarkKPI label="Spent" value="$381" sub="15% used" hue="#579BFC" />
        </div>

        {/* Bottom stat row */}
        <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg p-2.5" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {[
            { v: "$34k", l: "Projected savings" },
            { v: "Top 18%", l: "User ranking" },
            { v: "-8%",  l: "vs last month", hue: "#E2445C" },
            { v: "5×",   l: "Goal smashed",   hue: "#00C875" },
          ].map((s, i) => (
            <div key={i}>
              <p className="font-extrabold tabular-nums tracking-tight" style={{ color: s.hue ?? "white", fontSize: 16, lineHeight: 1 }}>
                {s.v}
              </p>
              <p className="text-[8px] mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>{s.l}</p>
            </div>
          ))}
        </div>
      </div>
    </Tile>
  );
}
function DarkKPI({ label, value, sub, hue }: { label: string; value: string; sub: string; hue: string }) {
  return (
    <div className="rounded-lg p-2.5 relative overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.5)" }}>{label}</p>
      <p className="mt-1 font-extrabold tabular-nums tracking-tight" style={{ color: hue, fontSize: 18, lineHeight: 1 }}>{value}</p>
      <p className="text-[8.5px] mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>{sub}</p>
    </div>
  );
}

// 4. Portfolio Kanban — DARK, 4 columns
function TilePortfolioKanban() {
  return (
    <Tile
      dark
      width={520}
      chrome={{
        tabs: ["Main table", "Kanban", "Dashboard"],
        activeTab: 1,
        integrate: true,
        automateN: 17,
        brandHue: "#A25DDC",
      }}
    >
      <div>
        <p className="font-extrabold text-[15px] tracking-tight" style={{ color: "white" }}>Portfolio</p>
        <p className="text-[9.5px]" style={{ color: "rgba(255,255,255,0.5)" }}>Eng team · Sprint 47</p>

        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          {[
            { name: "Ready",    hue: "#579BFC", cards: [{ t: "User profile", v: "2.0 SP · High" }] },
            { name: "Progress", hue: "#A25DDC", cards: [{ t: "User authorization", v: "3 SP · Critical" }, { t: "Multi-language", v: "2.5 SP · High" }] },
            { name: "Waiting",  hue: "#FDAB3D", cards: [{ t: "QA test mode", v: "1.5 SP · Med" }] },
            { name: "Done",     hue: "#00C875", cards: [{ t: "Fix sound effects", v: "1.5 SP · Med" }, { t: "Sessions timeout", v: "2 SP · Critical" }] },
          ].map((c, i) => (
            <div key={i} className="rounded-md p-1.5 flex flex-col" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full" style={{ backgroundColor: c.hue }} />
                  <span className="text-[8.5px] font-bold uppercase" style={{ color: c.hue }}>{c.name}</span>
                </div>
                <span className="text-[8.5px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{c.cards.length}</span>
              </div>
              <div className="space-y-1 flex-1">
                {c.cards.map((card, j) => (
                  <div key={j} className="rounded p-1.5" style={{ backgroundColor: "rgba(255,255,255,0.06)", borderLeft: `2px solid ${c.hue}` }}>
                    <p className="text-[9px] font-semibold leading-tight" style={{ color: "white" }}>{card.t}</p>
                    <p className="text-[7.5px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>{card.v}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <FloatingAvatar initials="MK" hue="#FF3D57" top="60px" left="64%" />
      </div>
    </Tile>
  );
}

// 5. Work focus — gauge + cards
function TileWorkFocus() {
  return (
    <Tile width={460}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: "var(--m-text-muted)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#A25DDC" }} />
            Focus
          </span>
          <div className="flex items-center gap-2 text-[9px] font-mono" style={{ color: "var(--m-text-soft)" }}>
            <span>Day</span><span>Week</span><span className="font-bold" style={{ color: "var(--m-text)" }}>Month</span>
          </div>
        </div>

        <div className="grid grid-cols-[120px_1fr] gap-3">
          {/* Gauge */}
          <div className="rounded-2xl p-3 flex flex-col items-center relative" style={{ backgroundColor: "#F2EAFE" }}>
            <p className="text-[8.5px] font-bold uppercase tracking-[0.1em] self-start" style={{ color: "#5b21b6" }}>
              Work focus
            </p>
            <div className="relative mt-1">
              <GaugeChart pct={54} size={96} color="#0E1626" track="rgba(14,22,38,0.15)" />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[16px] font-extrabold tabular-nums" style={{ color: "#0E1626" }}>13:41</p>
                <p className="text-[8px] font-medium" style={{ color: "#5b21b6" }}>Min left</p>
              </div>
            </div>
            <p className="text-[8.5px] mt-1" style={{ color: "#5b21b6" }}>New client web design</p>
          </div>

          {/* Up next */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] mb-1.5" style={{ color: "var(--m-text-soft)" }}>
              Up next
            </p>
            <div className="space-y-1.5">
              <FocusCard color="#FFF9CC" label="Social media" sub="45:21 / 70 min" hue="#9a8800" />
              <FocusCard color="#DCFCE7" label="Project plan" sub="28 min" hue="#15803d" />
            </div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] mt-3 mb-1" style={{ color: "var(--m-text-soft)" }}>
              Today
            </p>
            <div className="flex items-center justify-between text-[9.5px] px-2 py-1.5 rounded-md" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
              <span style={{ color: "var(--m-text)" }}>Social media gantt</span>
              <span className="text-white px-1.5 rounded text-[8.5px] font-bold" style={{ backgroundColor: "#00C875" }}>Done</span>
            </div>
          </div>
        </div>
      </div>
    </Tile>
  );
}
function FocusCard({ color, label, sub, hue }: { color: string; label: string; sub: string; hue: string }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: color }}>
      <p className="text-[9.5px] font-bold" style={{ color: hue }}>{label}</p>
      <p className="text-[8.5px] font-medium" style={{ color: hue, opacity: 0.75 }}>{sub}</p>
    </div>
  );
}

// 6. Deals pipeline — Kanban-style
function TilePipeline() {
  return (
    <Tile
      width={520}
      chrome={{
        tabs: ["Main table", "Sales report", "Pipeline"],
        activeTab: 2,
        integrate: true,
        automateN: 9,
        brandHue: "#FF3D57",
      }}
    >
      <div>
        <p className="font-extrabold text-[15px] tracking-tight" style={{ color: "var(--m-text)" }}>Deals pipeline</p>
        <p className="text-[9.5px]" style={{ color: "var(--m-text-soft)" }}>AI Lead Experts</p>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {[
            { name: "New",     hue: "#94A3B8", count: 4, val: "$232,000", cards: [{ c: "Microsoft", v: "$55k", lvl: "Critical" }] },
            { name: "Meeting", hue: "#579BFC", count: 2, val: "$34,000", cards: [{ c: "Google", v: "$24k", lvl: "Critical" }] },
            { name: "Proposal",hue: "#FDAB3D", count: 1, val: "$7,500",  cards: [{ c: "Yellow­works", v: "$7.5k", lvl: "Low" }] },
            { name: "Won",     hue: "#00C875", count: 2, val: "$22,000", cards: [{ c: "Waisman Gallery", v: "$12k", lvl: "High" }] },
          ].map((s, i) => (
            <div key={i} className="rounded-md p-1.5" style={{ backgroundColor: "var(--m-surface)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold uppercase" style={{ color: s.hue }}>{s.name} / {s.count}</span>
              </div>
              <p className="text-[10.5px] font-bold tabular-nums mb-1" style={{ color: "var(--m-text)" }}>{s.val}</p>
              {s.cards.map((card, j) => (
                <div key={j} className="bg-white rounded p-1.5" style={{ border: "1px solid var(--m-border)", borderLeft: `2px solid ${s.hue}` }}>
                  <p className="text-[9px] font-semibold truncate" style={{ color: "var(--m-text)" }}>{card.c}</p>
                  <p className="text-[8px]" style={{ color: "var(--m-text-soft)" }}>
                    {card.v} · <span style={{ color: s.hue }}>{card.lvl}</span>
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-2.5 rounded-md p-2.5 flex items-start gap-2" style={{ backgroundColor: "var(--m-surface)" }}>
          <span className="w-1 h-1 rounded-full mt-1.5" style={{ backgroundColor: "var(--brand-red)" }} />
          <div>
            <p className="text-[9.5px] font-bold" style={{ color: "var(--m-text)" }}>Send greetings email</p>
            <p className="text-[8.5px]" style={{ color: "var(--m-text-soft)" }}>Critical · Marketing</p>
          </div>
        </div>
      </div>
    </Tile>
  );
}

// 7. Team Tasks — TaskFlow-style 4-column board
function TileTeamTasks() {
  return (
    <Tile width={500}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--brand-red)" }} />
            <span className="text-[10px] font-bold" style={{ color: "var(--m-text)" }}>TaskFlow</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Search size={11} style={{ color: "var(--m-text-soft)" }} />
            <Bell size={11} style={{ color: "var(--m-text-soft)" }} />
            <Avatar initials="MK" hue="#A25DDC" size={16} />
          </div>
        </div>

        <div className="flex items-center justify-between mb-2.5">
          <p className="font-extrabold text-[16px] tracking-tight" style={{ color: "var(--m-text)" }}>Team tasks</p>
          <button className="text-[9.5px] font-bold text-white px-2.5 h-[22px] inline-flex items-center gap-1 rounded-md" style={{ backgroundColor: "var(--m-text)" }}>
            <Plus size={9} /> New
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {[
            { name: "To do",       hue: "#94A3B8", cards: [{ t: "Design assets",  size: "Med" }] },
            { name: "In progress", hue: "#FDAB3D", cards: [{ t: "CRM redesign",   size: "Med" }] },
            { name: "Blocked",     hue: "#E2445C", cards: [{ t: "Creative assets", size: "Low" }] },
            { name: "Completed",   hue: "#00C875", cards: [{ t: "CRM system",     size: "Med" }] },
          ].map((c, i) => (
            <div key={i} className="rounded-md p-1.5" style={{ backgroundColor: "var(--m-surface)" }}>
              <div className="flex items-center gap-1 mb-1.5">
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: c.hue }} />
                <span className="text-[8.5px] font-bold uppercase" style={{ color: c.hue }}>{c.name}</span>
              </div>
              <div className="space-y-1">
                {c.cards.map((card, j) => (
                  <div key={j} className="bg-white rounded p-1.5" style={{ border: "1px solid var(--m-border)" }}>
                    <div className="aspect-[3/2] rounded mb-1" style={{ background: `linear-gradient(135deg, ${c.hue}26, ${c.hue}10)` }} />
                    <p className="text-[8.5px] font-semibold truncate" style={{ color: "var(--m-text)" }}>{card.t}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[7.5px] font-bold text-white px-1 rounded" style={{ backgroundColor: c.hue }}>{card.size}</span>
                      <Avatar initials="DK" hue={c.hue} size={12} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Tile>
  );
}

// 8. Active projects — Multi-section table
function TileActiveProjects() {
  return (
    <Tile
      width={520}
      chrome={{
        brand: "TaskFlow",
        tabs: ["Main table", "Gantt", "Kanban"],
        activeTab: 0,
        integrate: true,
        automateN: 2,
        brandHue: "#A25DDC",
      }}
    >
      <div>
        <p className="font-extrabold text-[15px] tracking-tight" style={{ color: "var(--m-text)" }}>Active projects</p>
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] mt-1.5 mb-1" style={{ color: "var(--m-text-soft)" }}>High priority projects</p>

        <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
          <div className="grid grid-cols-[1.6fr_60px_50px_64px] gap-2 px-2.5 py-1 text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}>
            <span>Asset</span><span>Status</span><span>Priority</span><span>Market</span>
          </div>
          {[
            { t: "Company website design", s: "done"    as const, p: "High", pHue: "#E2445C", m: "EMEA / US" },
            { t: "Re-branding for museum",  s: "done"    as const, p: "High", pHue: "#E2445C", m: "EMEA / US" },
            { t: "Creating logo for biz",   s: "working" as const, p: "High", pHue: "#E2445C", m: "EMEA / US" },
            { t: "QA future initiatives",   s: "review"  as const, p: "High", pHue: "#E2445C", m: "EMEA / US" },
          ].map((r, i) => (
            <div key={i} className="grid grid-cols-[1.6fr_60px_50px_64px] gap-2 px-2.5 py-1.5 items-center border-t" style={{ borderColor: "var(--m-border)" }}>
              <span className="text-[10px] font-medium truncate" style={{ color: "var(--m-text)" }}>{r.t}</span>
              <StatusPill kind={r.s} />
              <span className="text-[9px] font-bold text-white text-center px-1.5 h-[18px] inline-flex items-center justify-center rounded" style={{ backgroundColor: r.pHue }}>{r.p}</span>
              <span className="text-[9px]" style={{ color: "var(--m-text-soft)" }}>{r.m}</span>
            </div>
          ))}
        </div>

        <p className="text-[9px] font-bold uppercase tracking-[0.12em] mt-2 mb-1" style={{ color: "var(--m-text-soft)" }}>Ongoing</p>
        <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
          {[
            { t: "Update design guidelines", s: "review" as const, p: "Med", pHue: "#FDAB3D", m: "EMEA / US" },
            { t: "Product marketing dict",    s: "review" as const, p: "Med", pHue: "#FDAB3D", m: "EMEA / US" },
          ].map((r, i) => (
            <div key={i} className="grid grid-cols-[1.6fr_60px_50px_64px] gap-2 px-2.5 py-1.5 items-center" style={{ borderTop: i > 0 ? "1px solid var(--m-border)" : "none" }}>
              <span className="text-[10px] font-medium truncate" style={{ color: "var(--m-text)" }}>{r.t}</span>
              <StatusPill kind={r.s} />
              <span className="text-[9px] font-bold text-white text-center px-1.5 h-[18px] inline-flex items-center justify-center rounded" style={{ backgroundColor: r.pHue }}>{r.p}</span>
              <span className="text-[9px]" style={{ color: "var(--m-text-soft)" }}>{r.m}</span>
            </div>
          ))}
        </div>

        <FloatingAvatar initials="MK" hue="#A25DDC" top="48%" right="-10px" />
      </div>
    </Tile>
  );
}

// 9. Q1 Campaigns
function TileCampaigns() {
  return (
    <Tile
      width={520}
      chrome={{
        brand: "TaskFlow",
        tabs: ["Main table", "Gantt", "Kanban"],
        activeTab: 0,
        integrate: true,
        automateN: 2,
        brandHue: "#FDAB3D",
      }}
    >
      <div>
        <p className="font-extrabold text-[15px] tracking-tight" style={{ color: "var(--m-text)" }}>Q1 Campaigns</p>
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] mt-2 mb-1" style={{ color: "#0073EA" }}>Social Campaigns</p>

        <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--m-border)" }}>
          <div className="grid grid-cols-[1.4fr_70px_60px_60px] gap-2 px-2.5 py-1 text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}>
            <span>Asset</span><span>Status</span><span>Priority</span><span>Market</span>
          </div>
          {[
            { t: "Competitor research",   s: "Review",  sHue: "#A25DDC", p: "High", pHue: "#E2445C", m: "EMEA / US" },
            { t: "Scheduling agent",       s: "Review",  sHue: "#A25DDC", p: "Med",  pHue: "#FDAB3D", m: "EMEA / US" },
            { t: "Creative copy",          s: "Review",  sHue: "#A25DDC", p: "High", pHue: "#E2445C", m: "EMEA / US" },
            { t: "Creative assets agent", s: "Review",  sHue: "#A25DDC", p: "High", pHue: "#E2445C", m: "EMEA / US" },
            { t: "Priority manager",       s: "Pending", sHue: "#FDAB3D", p: "Low",  pHue: "#00C875", m: "EMEA / US" },
          ].map((r, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_70px_60px_60px] gap-2 px-2.5 py-1.5 items-center border-t" style={{ borderColor: "var(--m-border)" }}>
              <span className="text-[10px] font-medium truncate" style={{ color: "var(--m-text)" }}>{r.t}</span>
              <span className="text-[9px] font-bold text-white text-center px-1.5 h-[18px] inline-flex items-center justify-center rounded" style={{ backgroundColor: r.sHue }}>{r.s}</span>
              <span className="text-[9px] font-bold text-white text-center px-1.5 h-[18px] inline-flex items-center justify-center rounded" style={{ backgroundColor: r.pHue }}>{r.p}</span>
              <span className="text-[9px]" style={{ color: "var(--m-text-soft)" }}>{r.m}</span>
            </div>
          ))}
        </div>

        <FloatingAvatar initials="DK" hue="#A25DDC" top="48%" right="48px" />
      </div>
    </Tile>
  );
}

// 10. Recruiting — agent activation
function TileRecruiting() {
  return (
    <Tile width={460}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--m-text)" }}>Recruiting</span>
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] px-1.5 h-[16px] inline-flex items-center rounded" style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}>
              Inactive
            </span>
          </div>
          <div className="flex items-center gap-2 text-[8.5px]" style={{ color: "var(--m-text-soft)" }}>
            <span>Run history</span>
            <span className="text-[9px] font-bold text-white px-2 h-[20px] inline-flex items-center rounded" style={{ backgroundColor: "var(--m-text)" }}>Activate</span>
          </div>
        </div>

        <div className="rounded-xl p-3 relative" style={{ background: "linear-gradient(135deg, #F2EAFE 0%, #fce7f3 100%)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={12} style={{ color: "#A25DDC" }} />
            <span className="text-[10px] font-bold" style={{ color: "#5b21b6" }}>Candidate sourcing</span>
          </div>
          <p className="text-[9.5px]" style={{ color: "#5b21b6" }}>
            Finds the best candidate matches and adds them to open positions.
          </p>
          <div
            className="mt-2.5 rounded-md p-2 bg-white"
            style={{ border: "1px dashed #A25DDC" }}
          >
            <p className="text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "#5b21b6" }}>Choose status</p>
            <div className="mt-1 flex gap-1.5">
              <span className="text-[9px] font-bold text-white px-2 h-[18px] inline-flex items-center rounded" style={{ backgroundColor: "#FDAB3D" }}>Working</span>
              <span className="text-[9px] font-bold text-white px-2 h-[18px] inline-flex items-center rounded" style={{ backgroundColor: "#579BFC" }}>Review</span>
              <span className="text-[9px] font-bold text-white px-2 h-[18px] inline-flex items-center rounded" style={{ backgroundColor: "#00C875" }}>Hired</span>
            </div>
          </div>
        </div>

        <FloatingAvatar initials="MK" hue="#FF3D57" top="80px" left="14%" />
      </div>
    </Tile>
  );
}

// 11. People dashboard — Composite scores DARK
function TileCompositeDashboard() {
  return (
    <Tile dark width={500}>
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[8.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.55)" }}>
            People · Composite
          </span>
          <span className="text-[8.5px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>Q3 cycle</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <DarkKPI label="Avg score"   value="87"    sub="+4 vs Q2" hue="#00C875" />
          <DarkKPI label="On track"    value="184"   sub="of 248"   hue="#579BFC" />
          <DarkKPI label="At risk"     value="12"    sub="needs 1:1" hue="#E2445C" />
        </div>

        <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[8.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.55)" }}>Top performers</span>
            <span className="text-[8.5px]" style={{ color: "rgba(255,255,255,0.4)" }}>by department</span>
          </div>
          {[
            { initials: "SC", name: "Sarah Chen",   role: "CEO",  score: 96, hue: "#A25DDC" },
            { initials: "PI", name: "Priya Iyer",   role: "COO",  score: 95, hue: "#579BFC" },
            { initials: "MC", name: "Maya Chen",    role: "CTO",  score: 92, hue: "#FF3D57" },
          ].map((p, i) => (
            <div key={i} className="flex items-center gap-2 mt-1.5">
              <Avatar initials={p.initials} hue={p.hue} size={20} />
              <span className="flex-1 text-[10px] font-semibold truncate" style={{ color: "white" }}>{p.name}</span>
              <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>{p.role}</span>
              <div className="w-[50px] h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
                <div className="h-full rounded-full" style={{ width: `${p.score}%`, backgroundColor: p.hue }} />
              </div>
              <span className="text-[10px] font-bold tabular-nums w-6 text-right" style={{ color: p.hue }}>{p.score}</span>
            </div>
          ))}
        </div>
      </div>
    </Tile>
  );
}

// 12. Sales report dashboard
function TileSalesReport() {
  return (
    <Tile
      width={500}
      chrome={{
        tabs: ["Dashboard", "Sales report"],
        activeTab: 0,
        integrate: true,
        automateN: 9,
        brandHue: "#00C875",
      }}
    >
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <p className="font-extrabold text-[15px] tracking-tight" style={{ color: "var(--m-text)" }}>Q3 sales report</p>
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 h-[18px] rounded" style={{ backgroundColor: "#dcfce7", color: "#15803d" }}>
            +18% vs Q2
          </span>
        </div>

        <div className="mt-2 grid grid-cols-[1.2fr_1fr] gap-2.5">
          <div className="rounded-lg p-3" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
            <p className="text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--m-text-soft)" }}>Closed revenue</p>
            <p className="mt-1 text-[26px] font-extrabold tabular-nums tracking-tight" style={{ color: "var(--m-text)" }}>
              $2.4<span className="text-[14px]" style={{ color: "var(--m-text-soft)" }}>M</span>
            </p>
            <BarChartMini
              bars={[
                { v: 3, alt: "#94A3B8" }, { v: 4, alt: "#94A3B8" }, { v: 6 }, { v: 5 },
                { v: 7 }, { v: 6 }, { v: 8 }, { v: 9, alt: "#FF3D57" },
              ]}
              color="#579BFC"
              height={42}
            />
          </div>
          <div className="rounded-lg p-3 flex flex-col" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
            <p className="text-[8.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--m-text-soft)" }}>Quota attainment</p>
            <p className="mt-1 text-[26px] font-extrabold tabular-nums tracking-tight" style={{ color: "#FF3D57" }}>92%</p>
            <div className="mt-auto h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "white" }}>
              <div className="h-full rounded-full" style={{ width: "92%", backgroundColor: "#FF3D57" }} />
            </div>
          </div>
        </div>

        <div className="mt-2.5 rounded-md p-2 flex items-center gap-2" style={{ backgroundColor: "var(--m-surface)", border: "1px solid var(--m-border)" }}>
          <span className="text-[14px]">🎯</span>
          <span className="text-[10px] flex-1" style={{ color: "var(--m-text)" }}>
            DP closed Brindle Estates · <span className="font-bold">$84k</span>
          </span>
          <span className="text-[8.5px]" style={{ color: "var(--m-text-soft)" }}>12m ago</span>
        </div>
      </div>
    </Tile>
  );
}

// ── Compose rows ────────────────────────────────────────────────────

const ROW_1 = [
  <TileQResults         key="r1-1" />,
  <TilePortfolioKanban  key="r1-2" />,
  <TileWorkFocus        key="r1-3" />,
  <TileTickets          key="r1-4" />,
];
const ROW_2 = [
  <TilePipeline           key="r2-1" />,
  <TileCompositeDashboard key="r2-2" />,
  <TileFinance            key="r2-3" />,
  <TileSalesReport        key="r2-4" />,
];
const ROW_3 = [
  <TileTeamTasks      key="r3-1" />,
  <TileActiveProjects key="r3-2" />,
  <TileRecruiting     key="r3-3" />,
  <TileCampaigns      key="r3-4" />,
];
