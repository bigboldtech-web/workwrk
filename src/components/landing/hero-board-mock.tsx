// Hero board mock — the "this is an operating system" centerpiece.
//
// Replaces the original Tasks checklist with a Performance / People
// board that signals: this isn't a to-do list, it's the system that
// runs the business.
//
// Composition:
//   - Hub tab strip (7 surfaces; People is active)
//   - Performance board (people, role, composite score, focus status)
//   - Floating side widgets: AI Cmd-K hint, KPI mini-card, live ticker
//
// Motion (on mount):
//   - Board frame fades up
//   - Tab strip slides in from the left
//   - Rows cascade in with a stagger
//   - Score progress bars fill from 0 to their value
//   - Sparkline in the KPI card draws itself
//   - Side widgets fade in last
// Motion (continuous):
//   - Live ticker rotates through 4 activity items
//   - Active hub tab has a soft pulsing dot

"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ArrowUpRight, Sparkles } from "lucide-react";

const HUB_TABS = [
  { name: "People",   active: true  },
  { name: "Work",     active: false },
  { name: "KPIs",     active: false },
  { name: "SOPs",     active: false },
  { name: "Money",    active: false },
  { name: "Talent",   active: false },
  { name: "Kudos",    active: false },
];

type Focus = "on-track" | "review" | "at-risk";

const ROWS: readonly { name: string; initials: string; role: string; score: number; focus: Focus; hue: string }[] = [
  { name: "Maya Chen",   initials: "MC", role: "Head of Engineering", score: 92, focus: "on-track", hue: "var(--status-done)"    },
  { name: "Priya Iyer",  initials: "PI", role: "COO",                  score: 95, focus: "on-track", hue: "var(--brand-blue)"     },
  { name: "Karim Patel", initials: "KP", role: "VP Operations",        score: 87, focus: "review",   hue: "var(--status-special)" },
  { name: "Dani Park",   initials: "DP", role: "Sales Lead",           score: 73, focus: "at-risk",  hue: "var(--brand-red)"      },
];

const FOCUS_PROPS: Record<Focus, { label: string; bg: string }> = {
  "on-track": { label: "On track",  bg: "var(--status-done)"    },
  "review":   { label: "In review", bg: "var(--status-info)"    },
  "at-risk":  { label: "At risk",   bg: "var(--status-stuck)"   },
};

const TICKER: readonly { icon: React.ReactNode; text: string; tone: string }[] = [
  { icon: "👏", text: "Maya gave kudos to Karim",              tone: "var(--brand-red)"     },
  { icon: "📈", text: "Q3 KPI on track · +6%",                  tone: "var(--status-done)"   },
  { icon: "✅", text: "SOP-141 signed off by Priya",            tone: "var(--brand-blue)"    },
  { icon: "🎯", text: "OKRs cascaded to Engineering",            tone: "var(--status-special)"},
];

export function HeroBoardMock() {
  // Cycle the activity ticker every 3 seconds.
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTickerIdx((i) => (i + 1) % TICKER.length), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative">
      {/* Brand halo — fades in subtle */}
      <motion.div
        className="absolute -inset-10 rounded-[2.5rem] blur-3xl opacity-0 -z-10"
        animate={{ opacity: 0.18 }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        style={{
          background:
            "linear-gradient(135deg, var(--brand-red) 0%, var(--brand-yellow) 50%, var(--brand-blue) 100%)",
        }}
        aria-hidden
      />

      {/* The board itself, fades + lifts in */}
      <motion.div
        className="relative bg-white rounded-2xl shadow-[0_30px_80px_-30px_rgba(15,23,42,0.22)] overflow-hidden"
        style={{ border: "1px solid var(--m-border)" }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Browser chrome */}
        <div
          className="h-9 flex items-center gap-2 px-4 border-b"
          style={{
            backgroundColor: "var(--m-surface)",
            borderColor: "var(--m-border)",
          }}
        >
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--brand-red)", opacity: 0.55 }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--brand-yellow)", opacity: 0.65 }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--status-done)", opacity: 0.55 }} />
          <span className="ml-3 text-[11px] font-mono" style={{ color: "var(--m-text-soft)" }}>
            workwrk.com / people / performance
          </span>
        </div>

        {/* Hub tab strip */}
        <motion.div
          className="px-3 pt-3 flex items-center gap-px overflow-x-auto"
          style={{ borderBottom: "1px solid var(--m-border)" }}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {HUB_TABS.map((t) => (
            <span
              key={t.name}
              className="relative px-3 py-2 text-[12px] font-semibold whitespace-nowrap"
              style={{
                color: t.active ? "var(--m-text)" : "var(--m-text-soft)",
              }}
            >
              {t.active && (
                <motion.span
                  className="absolute left-3 right-3 -bottom-px h-[2px]"
                  style={{ backgroundColor: "var(--brand-red)" }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.4, delay: 0.5 }}
                />
              )}
              <span className="inline-flex items-center gap-1.5">
                {t.active && (
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: "var(--brand-red)" }}
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                {t.name}
              </span>
            </span>
          ))}
        </motion.div>

        {/* Board header */}
        <motion.div
          className="px-5 pt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.45 }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
              People · Performance
            </span>
            <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
            <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Q3 cycle</span>
          </div>
          <p className="mt-1 font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
            Composite scores
          </p>
        </motion.div>

        {/* Column headers */}
        <motion.div
          className="mt-3 mx-5 grid grid-cols-[1.5fr_1.1fr_minmax(0,1fr)_88px] gap-2 px-3 py-2 rounded-md text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{
            backgroundColor: "var(--m-surface)",
            color: "var(--m-text-soft)",
            border: "1px solid var(--m-border)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
        >
          <span>Person</span>
          <span>Role</span>
          <span>Score</span>
          <span className="text-center">Focus</span>
        </motion.div>

        {/* Group: On track */}
        <GroupBar color="var(--status-done)" label="On track" count={2} delay={0.65} />
        <Row {...ROWS[0]} delay={0.75} />
        <Row {...ROWS[1]} delay={0.85} />

        {/* Group: In review */}
        <GroupBar color="var(--status-info)" label="In review" count={1} delay={0.95} />
        <Row {...ROWS[2]} delay={1.05} />

        {/* Group: At risk */}
        <GroupBar color="var(--status-stuck)" label="At risk" count={1} delay={1.15} />
        <Row {...ROWS[3]} delay={1.25} />

        <div className="h-5" />
      </motion.div>

      {/* ── Floating widgets ─────────────────────────────────────── */}

      {/* AI Cmd-K hint chip — top right */}
      <motion.div
        className="absolute -top-3 -right-2 hidden sm:flex items-center gap-1.5 pl-2 pr-3 h-9 rounded-full bg-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.22)]"
        style={{ border: "1px solid var(--m-border)" }}
        initial={{ opacity: 0, y: -8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, delay: 1.4 }}
      >
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-white"
          style={{ backgroundColor: "var(--m-text)" }}
        >
          <Search size={12} />
        </span>
        <span className="text-[11px] font-semibold" style={{ color: "var(--m-text)" }}>
          Cmd-K
        </span>
        <span
          className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 h-4 inline-flex items-center rounded text-white"
          style={{ backgroundColor: "var(--brand-red)" }}
        >
          AI
        </span>
      </motion.div>

      {/* Live activity ticker — top left */}
      <motion.div
        className="absolute -top-3 -left-2 hidden sm:flex items-center gap-2 pl-2 pr-4 h-9 rounded-full bg-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.22)] overflow-hidden max-w-[300px]"
        style={{ border: "1px solid var(--m-border)" }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.5 }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={tickerIdx}
            className="flex items-center gap-2 min-w-0"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-[12px]"
              style={{
                backgroundColor: `color-mix(in srgb, ${TICKER[tickerIdx].tone} 18%, white)`,
              }}
            >
              {TICKER[tickerIdx].icon}
            </span>
            <span className="text-[11px] font-semibold truncate" style={{ color: "var(--m-text)" }}>
              {TICKER[tickerIdx].text}
            </span>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* KPI mini-card — bottom right */}
      <motion.div
        className="absolute -bottom-5 -right-5 hidden sm:block w-[210px] bg-white rounded-2xl shadow-[0_18px_50px_-12px_rgba(15,23,42,0.25)] p-4"
        style={{ border: "1px solid var(--m-border)" }}
        initial={{ opacity: 0, y: 16, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: 1.6 }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--m-text-soft)" }}>
            Team composite
          </span>
          <span className="text-[10px] font-bold" style={{ color: "var(--status-done)" }}>
            +6%
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--m-text)" }}>
            87
          </span>
          <span className="text-xs" style={{ color: "var(--m-text-soft)" }}>/ 100</span>
        </div>
        {/* Animated sparkline */}
        <svg viewBox="0 0 180 36" className="mt-2 w-full">
          <motion.path
            d="M0 26 L18 24 L36 25 L54 20 L72 22 L90 16 L108 18 L126 10 L144 12 L162 6 L180 4"
            stroke="var(--brand-red)"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, delay: 1.9, ease: [0.22, 1, 0.36, 1] }}
          />
          {/* End dot */}
          <motion.circle
            cx="180"
            cy="4"
            r="3"
            fill="var(--brand-red)"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 3.2 }}
          />
        </svg>
      </motion.div>

      {/* "Auto-assigned by AI" chip — bottom left */}
      <motion.div
        className="absolute -bottom-3 left-12 hidden md:flex items-center gap-2 pl-2 pr-3 h-9 rounded-full bg-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.22)]"
        style={{ border: "1px solid var(--m-border)" }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.8 }}
      >
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-white"
          style={{ backgroundColor: "var(--brand-red)" }}
        >
          <Sparkles size={11} />
        </span>
        <span className="text-[11px] font-semibold" style={{ color: "var(--m-text)" }}>
          AI auto-assigned <span style={{ color: "var(--m-text-soft)" }}>3 tasks</span>
        </span>
      </motion.div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────

function GroupBar({
  color, label, count, delay,
}: { color: string; label: string; count: number; delay: number }) {
  return (
    <motion.div
      className="mt-3 mx-5 flex items-center gap-2 px-3 py-1.5 rounded-md"
      style={{ backgroundColor: "rgba(0,0,0,0.02)" }}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-[12px] font-bold" style={{ color }}>
        {label}
      </span>
      <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>
        {count} {count === 1 ? "person" : "people"}
      </span>
    </motion.div>
  );
}

function Row({
  name, initials, role, score, focus, hue, delay,
}: {
  name: string; initials: string; role: string; score: number; focus: Focus; hue: string; delay: number;
}) {
  const f = FOCUS_PROPS[focus];
  return (
    <motion.div
      className="mx-5 grid grid-cols-[1.5fr_1.1fr_minmax(0,1fr)_88px] gap-2 px-3 py-2.5 items-center border-l-[3px]"
      style={{
        borderLeftColor: f.bg,
        borderTop: "1px solid var(--m-border)",
      }}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Person */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
          style={{ backgroundColor: hue }}
        >
          {initials}
        </span>
        <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--m-text)" }}>
          {name}
        </span>
      </div>

      {/* Role */}
      <span className="text-[12px] truncate" style={{ color: "var(--m-text-muted)" }}>
        {role}
      </span>

      {/* Score bar + number */}
      <div className="flex items-center gap-2">
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: "var(--m-surface)" }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: f.bg }}
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.9, delay: delay + 0.15, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--m-text)" }}>
          {score}
        </span>
      </div>

      {/* Focus pill */}
      <span
        className="text-[10px] font-bold text-white text-center px-2 h-6 inline-flex items-center justify-center rounded-md"
        style={{ backgroundColor: f.bg }}
      >
        {f.label}
      </span>
    </motion.div>
  );
}
