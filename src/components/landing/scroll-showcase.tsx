// Scroll-driven product showcase — the monday.com signature move.
//
// A tall container with a sticky pinned viewport. As the user scrolls,
// scroll progress is mapped to an active hub index (0..6). The left
// rail highlights that hub; the right side cross-fades the product
// mock to show that hub's actual UI.
//
// Layout:
//   - Container: ~7×100vh tall (so each hub gets ~100vh of scroll)
//   - Sticky inner: top:0, h:100vh — pinned to the viewport
//   - Inside the pin: left rail (hub list) + right canvas (product mock)
//
// Mobile note: scroll-pinning fights touch scroll on iOS / small screens,
// so we fall back to a vertically-stacked layout that renders each hub
// as its own section.

"use client";

import { useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useMotionValueEvent,
} from "framer-motion";
import {
  Inbox,
  Users,
  CheckSquare,
  DollarSign,
  Crosshair,
  Star,
  Megaphone,
  ArrowRight,
  Bell,
} from "lucide-react";

interface Hub {
  slug: string;
  name: string;
  tagline: string;
  desc: string;
  hue: string;
  hueSoft: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  Mock: React.ComponentType;
}

const HUBS: readonly Hub[] = [
  {
    slug: "home",
    name: "Home",
    tagline: "The morning command center",
    desc: "Every signal from every hub, aggregated and triaged. Inbox of 12 streams. Cmd-K AI search across the whole workspace.",
    hue: "#6366f1",
    hueSoft: "#eef2ff",
    icon: Inbox,
    Mock: MockHome,
  },
  {
    slug: "people",
    name: "People",
    tagline: "Org, performance, reviews",
    desc: "The org, the roles, the performance signal. Every profile is a 360° dossier — perf, comp, history, kudos count.",
    hue: "#7c3aed",
    hueSoft: "#f3e8ff",
    icon: Users,
    Mock: MockPeople,
  },
  {
    slug: "work",
    name: "Work",
    tagline: "Tasks, OKRs, KPIs, SOPs",
    desc: "Where work actually happens. Tasks with auto-escalation, OKRs that cascade, KPIs that score themselves, SOPs with audit trail.",
    hue: "#0ea5e9",
    hueSoft: "#e0f2fe",
    icon: CheckSquare,
    Mock: MockWork,
  },
  {
    slug: "money",
    name: "Money",
    tagline: "Spend, vendors, financials",
    desc: "Spend, vendors, procurement, budgets vs. actuals — the CFO surface, built around the same people and processes.",
    hue: "#10b981",
    hueSoft: "#d1fae5",
    icon: DollarSign,
    Mock: MockMoney,
  },
  {
    slug: "talent",
    name: "Talent",
    tagline: "Reviews, comp, onboarding",
    desc: "Reviews, comp, onboarding, recruiting — the full lifecycle of every team member, end to end.",
    hue: "#d946ef",
    hueSoft: "#fae8ff",
    icon: Crosshair,
    Mock: MockTalent,
  },
  {
    slug: "culture",
    name: "Culture",
    tagline: "Kudos, ideas, surveys",
    desc: "Kudos, ideas, surveys, announcements. Recognition counts in reviews. The social layer that drives engagement.",
    hue: "#ec4899",
    hueSoft: "#fce7f3",
    icon: Star,
    Mock: MockCulture,
  },
  {
    slug: "growth",
    name: "Growth",
    tagline: "Pipeline, customers, forecasts",
    desc: "Pipeline, deals, customers, forecasts, commissions. Revenue alongside the people and operational data.",
    hue: "#f59e0b",
    hueSoft: "#fef3c7",
    icon: Megaphone,
    Mock: MockGrowth,
  },
];

export function ScrollShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const [activeIdx, setActiveIdx] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    // Clamp so the last segment lasts until the very bottom of the
    // container, otherwise it flickers as scroll passes 1.0.
    const idx = Math.min(HUBS.length - 1, Math.max(0, Math.floor(v * HUBS.length)));
    if (idx !== activeIdx) setActiveIdx(idx);
  });

  const active = HUBS[activeIdx];

  return (
    <section
      ref={ref}
      className="relative bg-white"
      // 100vh per hub, plus an extra vh to give the last hub breathing room
      style={{ height: `${HUBS.length * 100 + 20}vh` }}
    >
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 w-full">
          <div className="grid lg:grid-cols-[1fr_1.35fr] gap-12 lg:gap-16 items-center">
            {/* ── Left rail ───────────────────────────────────────── */}
            <div>
              <p
                className="text-[11px] font-bold uppercase tracking-[0.22em]"
                style={{ color: "var(--brand-red)" }}
              >
                One platform · seven surfaces
              </p>

              <h2
                className="mt-5 font-extrabold tracking-[-0.03em]"
                style={{
                  color: "var(--m-text)",
                  fontSize: "clamp(2rem, 4vw, 3.4rem)",
                  lineHeight: 1.04,
                }}
              >
                Every workflow your business runs &mdash; <br />
                <span style={{ color: active.hue }}>under one roof.</span>
              </h2>

              <p
                className="mt-5 text-base lg:text-lg leading-relaxed max-w-md"
                style={{ color: "var(--m-text-muted)" }}
              >
                Scroll. Each hub is a fully-featured product on its own.
                Together they replace 15+ tools and share a single data
                model &mdash; so every signal connects to everything else.
              </p>

              {/* Hub list */}
              <ul className="mt-9 space-y-1.5">
                {HUBS.map((hub, i) => (
                  <HubLine
                    key={hub.slug}
                    hub={hub}
                    active={i === activeIdx}
                    idx={i}
                    total={HUBS.length}
                  />
                ))}
              </ul>
            </div>

            {/* ── Right canvas (product mocks crossfade) ──────────── */}
            <div className="relative">
              <MockShell active={active} activeIdx={activeIdx} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Left rail item ────────────────────────────────────────────────────

function HubLine({
  hub, active, idx, total,
}: { hub: Hub; active: boolean; idx: number; total: number }) {
  const Icon = hub.icon;
  return (
    <li className="relative">
      <motion.div
        className="flex items-center gap-3 py-2.5 pl-4 pr-3 rounded-lg"
        animate={{
          backgroundColor: active ? hub.hueSoft : "transparent",
        }}
        transition={{ duration: 0.3 }}
      >
        {/* Active indicator bar */}
        {active && (
          <motion.span
            layoutId="hub-active-bar"
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
            style={{ backgroundColor: hub.hue }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
          />
        )}

        {/* Icon */}
        <span
          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
          style={{
            backgroundColor: active ? hub.hue : "transparent",
            color: active ? "white" : hub.hue,
            border: active ? "none" : `1.5px solid ${hub.hue}40`,
          }}
        >
          <Icon size={15} strokeWidth={2.2} />
        </span>

        {/* Name + tagline */}
        <div className="flex-1 min-w-0">
          <p
            className="font-bold text-[15px] leading-tight transition-colors"
            style={{
              color: active ? "var(--m-text)" : "var(--m-text-muted)",
            }}
          >
            {hub.name}
          </p>
          <p
            className="text-[11.5px] leading-tight mt-0.5 transition-colors"
            style={{
              color: active ? "var(--m-text-muted)" : "var(--m-text-soft)",
            }}
          >
            {hub.tagline}
          </p>
        </div>

        {/* Progress indicator (small step number) */}
        <span
          className="text-[10px] font-mono font-bold transition-colors flex-shrink-0"
          style={{
            color: active ? hub.hue : "var(--m-text-soft)",
          }}
        >
          {String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </motion.div>
    </li>
  );
}

// ── Mock shell + crossfade ────────────────────────────────────────────

function MockShell({
  active, activeIdx,
}: { active: Hub; activeIdx: number }) {
  return (
    <div className="relative">
      {/* Per-hub colored halo behind the mock */}
      <motion.div
        key={`halo-${activeIdx}`}
        className="absolute -inset-8 rounded-[2.5rem] blur-3xl opacity-20 -z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.18 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        style={{ backgroundColor: active.hue }}
        aria-hidden
      />

      <div
        className="relative bg-white rounded-2xl shadow-[0_30px_80px_-30px_rgba(15,23,42,0.22)] overflow-hidden"
        style={{ border: "1px solid var(--m-border)" }}
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
            workwrk.com / {active.slug}
          </span>
        </div>

        {/* Mock content crossfade */}
        <div className="relative" style={{ minHeight: 440 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={active.slug}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <active.Mock />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MOCK SNIPPETS — one per hub. Each is a self-contained, visually
// distinct UI capture of that hub's flagship surface.
// ════════════════════════════════════════════════════════════════════

// ── Home: Inbox of unified signals ────────────────────────────────────
function MockHome() {
  const items = [
    { dot: "#7c3aed", icon: <Star size={11} />,      title: "Maya needs review approval",       meta: "People · 2h ago",       cta: "Approve" },
    { dot: "#ef4444", icon: <Bell size={11} />,      title: "KPI alert: Sales pipeline -8%",     meta: "Work · today",          cta: "Investigate" },
    { dot: "#0ea5e9", icon: <CheckSquare size={11} />,title: "SOP-141 needs refresh",             meta: "Work · annual review",  cta: "Open SOP" },
    { dot: "#10b981", icon: <Star size={11} />,      title: "Karim received 4 new kudos",        meta: "Culture · this week",   cta: "View" },
    { dot: "#f59e0b", icon: <DollarSign size={11} />,title: "Vendor invoice over budget · $3.2k",meta: "Money · pending",       cta: "Review" },
  ];
  return (
    <div className="p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
          Home
        </span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Inbox</span>
      </div>
      <p className="mt-1 font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
        12 signals to triage
      </p>

      <div className="mt-4 rounded-xl border divide-y" style={{ borderColor: "var(--m-border)" }}>
        {items.map((it, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-3 border-l-[3px] hover:bg-[var(--m-surface)] transition-colors"
            style={{ borderLeftColor: it.dot, borderColor: "var(--m-border)" }}
          >
            <span
              className="w-7 h-7 rounded-md flex items-center justify-center text-white flex-shrink-0"
              style={{ backgroundColor: it.dot }}
            >
              {it.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold truncate" style={{ color: "var(--m-text)" }}>
                {it.title}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--m-text-soft)" }}>
                {it.meta}
              </p>
            </div>
            <button
              className="text-[11px] font-semibold px-2.5 h-7 rounded-md border whitespace-nowrap"
              style={{
                borderColor: "var(--m-border-dark)",
                color: "var(--m-text)",
                backgroundColor: "white",
              }}
            >
              {it.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── People: Org chart with composite scores ────────────────────────────
function MockPeople() {
  return (
    <div className="p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
          People
        </span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Org chart</span>
      </div>
      <p className="mt-1 font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
        248 people · 9 departments
      </p>

      {/* Org tree */}
      <div className="mt-5 flex flex-col items-center">
        {/* CEO */}
        <OrgCard initials="SC" name="Sarah Chen"   role="CEO"  score={96} hue="#7c3aed" />
        <Branch />

        {/* C-suite row */}
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <OrgCard initials="PI" name="Priya Iyer"   role="COO"  score={95} hue="#0ea5e9" />
            <Branch />
            <OrgCard initials="KP" name="Karim Patel" role="VP Ops" score={87} hue="#10b981" mini />
          </div>
          <div className="flex flex-col items-center">
            <OrgCard initials="DK" name="Dan Kim"     role="CFO"  score={89} hue="#10b981" />
            <Branch />
            <OrgCard initials="MR" name="Mei R."      role="Controller" score={82} hue="#0ea5e9" mini />
          </div>
          <div className="flex flex-col items-center">
            <OrgCard initials="MC" name="Maya Chen"   role="CTO"  score={92} hue="#d946ef" />
            <Branch />
            <OrgCard initials="JR" name="Jamie R."    role="Eng Mgr" score={78} hue="#f59e0b" mini />
          </div>
        </div>
      </div>
    </div>
  );
}

function OrgCard({
  initials, name, role, score, hue, mini = false,
}: { initials: string; name: string; role: string; score: number; hue: string; mini?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg bg-white shadow-sm ${mini ? "px-2 py-1.5" : "px-3 py-2"}`}
      style={{ border: "1px solid var(--m-border)" }}
    >
      <span
        className={`rounded-full flex items-center justify-center text-white font-bold ${mini ? "w-6 h-6 text-[9px]" : "w-7 h-7 text-[10px]"}`}
        style={{ backgroundColor: hue }}
      >
        {initials}
      </span>
      <div className="min-w-0">
        <p className={`font-bold leading-tight truncate ${mini ? "text-[10.5px]" : "text-[12px]"}`} style={{ color: "var(--m-text)" }}>
          {name}
        </p>
        <p className={`leading-tight ${mini ? "text-[9px]" : "text-[10px]"}`} style={{ color: "var(--m-text-soft)" }}>
          {role}
        </p>
      </div>
      <span
        className={`font-bold ${mini ? "text-[9px]" : "text-[11px]"}`}
        style={{ color: hue }}
      >
        {score}
      </span>
    </div>
  );
}

function Branch() {
  return <div className="h-3 w-px" style={{ backgroundColor: "var(--m-border-dark)" }} />;
}

// ── Work: Kanban tasks board ──────────────────────────────────────────
function MockWork() {
  return (
    <div className="p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
          Work
        </span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Tasks · board view</span>
      </div>
      <p className="mt-1 font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
        Q3 launch board
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <KanbanCol title="Working" color="#fdab3d" count={3}>
          <KanbanCard label="Wire KPI engine to dashboards" tag="Eng"  tagHue="#0ea5e9" />
          <KanbanCard label="Migrate review templates"      tag="HR"   tagHue="#d946ef" />
          <KanbanCard label="SOC 2 evidence collection"     tag="Sec"  tagHue="#7c3aed" />
        </KanbanCol>
        <KanbanCol title="In review" color="#579bfc" count={2}>
          <KanbanCard label="Vendor scorecard update" tag="Ops" tagHue="#10b981" />
          <KanbanCard label="Q3 OKR drafts"             tag="GTM" tagHue="#f59e0b" />
        </KanbanCol>
        <KanbanCol title="Done" color="#00c875" count={2}>
          <KanbanCard label="OKR cascade complete"   tag="Mgmt" tagHue="#7c3aed" done />
          <KanbanCard label="Onboarding flow v2"      tag="HR"   tagHue="#d946ef" done />
        </KanbanCol>
      </div>
    </div>
  );
}

function KanbanCol({
  title, color, count, children,
}: { title: string; color: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-2.5" style={{ backgroundColor: "var(--m-surface)" }}>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color }}>
            {title}
          </span>
        </div>
        <span className="text-[9px] font-mono" style={{ color: "var(--m-text-soft)" }}>{count}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KanbanCard({
  label, tag, tagHue, done = false,
}: { label: string; tag: string; tagHue: string; done?: boolean }) {
  return (
    <div className="bg-white rounded-md p-2.5 shadow-sm" style={{ border: "1px solid var(--m-border)" }}>
      <p
        className={`text-[11.5px] font-medium leading-tight ${done ? "line-through opacity-60" : ""}`}
        style={{ color: "var(--m-text)" }}
      >
        {label}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span
          className="text-[9px] font-bold px-1.5 h-4 inline-flex items-center rounded-sm text-white"
          style={{ backgroundColor: tagHue }}
        >
          {tag}
        </span>
        <span className="w-5 h-5 rounded-full" style={{ backgroundColor: tagHue, opacity: 0.7 }} />
      </div>
    </div>
  );
}

// ── Money: Approvals queue ────────────────────────────────────────────
function MockMoney() {
  const rows: { vendor: string; cat: string; amount: string; status: "pending" | "approved" | "flagged" }[] = [
    { vendor: "Helios Labs",       cat: "Software",     amount: "$3,200",  status: "pending"  },
    { vendor: "Stratum Logistics", cat: "Freight",      amount: "$12,400", status: "approved" },
    { vendor: "Brindle Estates",   cat: "Real estate",  amount: "$48,000", status: "flagged"  },
    { vendor: "Quill Health",      cat: "Consulting",   amount: "$5,800",  status: "approved" },
    { vendor: "Numero One",        cat: "Marketing",    amount: "$2,100",  status: "pending"  },
  ];
  const statusProps = {
    pending:  { bg: "var(--status-working)", label: "Pending"   },
    approved: { bg: "var(--status-done)",    label: "Approved"  },
    flagged:  { bg: "var(--status-stuck)",   label: "Over budget" },
  };
  return (
    <div className="p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
          Money
        </span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Approvals · Q3</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
          Vendor spend
        </p>
        <p className="text-[11px]" style={{ color: "var(--m-text-soft)" }}>
          <span className="font-bold" style={{ color: "var(--m-text)" }}>$71.5k</span> / $80k budget
        </p>
      </div>

      {/* Budget bar */}
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
        <div className="h-full rounded-full" style={{ width: "89%", backgroundColor: "#10b981" }} />
      </div>

      <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: "var(--m-border)" }}>
        <div
          className="grid grid-cols-[1.4fr_1fr_1fr_88px] gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}
        >
          <span>Vendor</span>
          <span>Category</span>
          <span className="text-right">Amount</span>
          <span className="text-center">Status</span>
        </div>
        {rows.map((r, i) => {
          const s = statusProps[r.status];
          return (
            <div
              key={i}
              className="grid grid-cols-[1.4fr_1fr_1fr_88px] gap-2 px-3 py-2.5 items-center border-t"
              style={{ borderColor: "var(--m-border)" }}
            >
              <span className="text-[12px] font-semibold truncate" style={{ color: "var(--m-text)" }}>
                {r.vendor}
              </span>
              <span className="text-[11px] truncate" style={{ color: "var(--m-text-muted)" }}>
                {r.cat}
              </span>
              <span className="text-[12px] font-bold tabular-nums text-right" style={{ color: "var(--m-text)" }}>
                {r.amount}
              </span>
              <span
                className="text-[9px] font-bold text-white text-center px-2 h-6 inline-flex items-center justify-center rounded-md"
                style={{ backgroundColor: s.bg }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Talent: Review cycle progress ─────────────────────────────────────
function MockTalent() {
  return (
    <div className="p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
          Talent
        </span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Q3 2026 cycle</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
          Performance reviews
        </p>
        <span
          className="text-[10px] font-bold uppercase tracking-[0.16em] px-2 h-5 inline-flex items-center rounded text-white"
          style={{ backgroundColor: "#d946ef" }}
        >
          closes in 4 days
        </span>
      </div>

      {/* Cycle progress */}
      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "var(--m-surface)" }}>
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold" style={{ color: "var(--m-text)" }}>
            Cycle progress
          </span>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: "#d946ef" }}>
            72% complete
          </span>
        </div>
        <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-bg)", border: "1px solid var(--m-border)" }}>
          <div className="h-full rounded-full" style={{ width: "72%", backgroundColor: "#d946ef" }} />
        </div>
      </div>

      {/* Sub-stats */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        <ReviewStat label="Self"        done={22} total={24} hue="#d946ef" />
        <ReviewStat label="Manager"     done={19} total={24} hue="#7c3aed" />
        <ReviewStat label="360° peer"   done={68} total={96} hue="#0ea5e9" />
        <ReviewStat label="Calibration" done={4}  total={9}  hue="#f59e0b" />
      </div>

      {/* People queue */}
      <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: "var(--m-border)" }}>
        <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}>
          Awaiting your sign-off
        </p>
        <ReviewQueueRow initials="PI" name="Priya Iyer"   role="COO"  score={95} hue="#0ea5e9" />
        <ReviewQueueRow initials="KP" name="Karim Patel" role="VP Ops" score={87} hue="#10b981" />
        <ReviewQueueRow initials="MC" name="Maya Chen"   role="CTO" score={92} hue="#d946ef" />
      </div>
    </div>
  );
}

function ReviewStat({
  label, done, total, hue,
}: { label: string; done: number; total: number; hue: string }) {
  const pct = (done / total) * 100;
  return (
    <div className="rounded-lg p-2.5 bg-white" style={{ border: "1px solid var(--m-border)" }}>
      <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--m-text-soft)" }}>
        {label}
      </p>
      <p className="mt-1 text-[14px] font-bold tabular-nums" style={{ color: "var(--m-text)" }}>
        {done}<span className="text-[10px] font-normal" style={{ color: "var(--m-text-soft)" }}>/{total}</span>
      </p>
      <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: hue }} />
      </div>
    </div>
  );
}

function ReviewQueueRow({
  initials, name, role, score, hue,
}: { initials: string; name: string; role: string; score: number; hue: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-t" style={{ borderColor: "var(--m-border)" }}>
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
        style={{ backgroundColor: hue }}
      >
        {initials}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold leading-tight" style={{ color: "var(--m-text)" }}>{name}</p>
        <p className="text-[10.5px] leading-tight" style={{ color: "var(--m-text-soft)" }}>{role}</p>
      </div>
      <span className="text-[12px] font-bold tabular-nums" style={{ color: hue }}>{score}</span>
      <button
        className="text-[10.5px] font-semibold px-2.5 h-6 rounded-md border whitespace-nowrap"
        style={{ borderColor: "var(--m-border-dark)", color: "var(--m-text)" }}
      >
        Sign off
      </button>
    </div>
  );
}

// ── Culture: Kudos feed ───────────────────────────────────────────────
function MockCulture() {
  const kudos = [
    { from: "Maya", fromHue: "#d946ef", to: "Karim",  toHue: "#10b981", value: "Customer first", msg: "Saved the SOC 2 audit on Friday night. Above and beyond.",      time: "2h" },
    { from: "Sarah", fromHue: "#7c3aed", to: "Priya",  toHue: "#0ea5e9", value: "Sharp thinking", msg: "Reframed the entire Q3 OKR cascade in 20 minutes.",                 time: "5h" },
    { from: "Dan",   fromHue: "#10b981", to: "Mei",    toHue: "#0ea5e9", value: "Pace",            msg: "Closed Q2 books in two days. New record.",                          time: "yesterday" },
  ];
  return (
    <div className="p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
          Culture
        </span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Kudos feed</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
          47 kudos this week
        </p>
        <p className="text-[11px]" style={{ color: "var(--m-text-soft)" }}>
          <span className="font-bold" style={{ color: "#ec4899" }}>↑ +12</span> vs last week
        </p>
      </div>

      {/* Leaderboard chip */}
      <div className="mt-3 inline-flex items-center gap-2 px-3 h-8 rounded-full" style={{ backgroundColor: "#fce7f3", border: "1px solid #fbcfe8" }}>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "#9d174d" }}>
          Top this month
        </span>
        <span className="text-[11px] font-bold" style={{ color: "#9d174d" }}>
          🥇 Maya · 47 kudos
        </span>
      </div>

      <div className="mt-4 space-y-2.5">
        {kudos.map((k, i) => (
          <div
            key={i}
            className="p-3 rounded-xl bg-white"
            style={{ border: "1px solid var(--m-border)" }}
          >
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: k.fromHue }}>
                {k.from[0]}
              </span>
              <span className="font-semibold" style={{ color: "var(--m-text)" }}>{k.from}</span>
              <ArrowRight size={11} className="opacity-50" />
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: k.toHue }}>
                {k.to[0]}
              </span>
              <span className="font-semibold" style={{ color: "var(--m-text)" }}>{k.to}</span>
              <span className="ml-auto text-[10px]" style={{ color: "var(--m-text-soft)" }}>{k.time}</span>
            </div>
            <p className="mt-2 text-[12.5px] leading-snug" style={{ color: "var(--m-text)" }}>
              {k.msg}
            </p>
            <span
              className="mt-2 inline-flex items-center text-[9px] font-bold uppercase tracking-[0.14em] px-2 h-5 rounded-full"
              style={{ backgroundColor: "#fce7f3", color: "#9d174d" }}
            >
              ★ {k.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Growth: Sales pipeline ────────────────────────────────────────────
function MockGrowth() {
  return (
    <div className="p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--m-text-soft)" }}>
          Growth
        </span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>·</span>
        <span className="text-[10px]" style={{ color: "var(--m-text-soft)" }}>Pipeline · Q3</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="font-extrabold text-lg" style={{ color: "var(--m-text)" }}>
          $2.4M forecast
        </p>
        <p className="text-[11px]" style={{ color: "var(--m-text-soft)" }}>
          <span className="font-bold" style={{ color: "#10b981" }}>92%</span> of quota
        </p>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <PipeCol stage="Discovery" count={18} value="$680k" pct={28} hue="#94a3b8" />
        <PipeCol stage="Demo"       count={9}  value="$540k" pct={48} hue="#0ea5e9" />
        <PipeCol stage="Negotiation" count={6}  value="$820k" pct={70} hue="#f59e0b" />
        <PipeCol stage="Closed won" count={4}  value="$360k" pct={100} hue="#10b981" />
      </div>

      <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: "var(--m-border)" }}>
        <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: "var(--m-surface)", color: "var(--m-text-soft)" }}>
          Closing this week
        </p>
        <DealRow customer="Helios Labs"        owner="DP" amount="$120k" stage="Negotiation" />
        <DealRow customer="Stratum Logistics" owner="MC" amount="$84k"  stage="Negotiation" />
        <DealRow customer="Quill Health"       owner="PI" amount="$95k"  stage="Negotiation" />
      </div>
    </div>
  );
}

function PipeCol({
  stage, count, value, pct, hue,
}: { stage: string; count: number; value: string; pct: number; hue: string }) {
  return (
    <div className="rounded-lg p-2.5 bg-white" style={{ border: "1px solid var(--m-border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: hue }}>
          {stage}
        </span>
        <span className="text-[9.5px] font-mono" style={{ color: "var(--m-text-soft)" }}>{count}</span>
      </div>
      <p className="mt-1 text-[14px] font-bold tabular-nums" style={{ color: "var(--m-text)" }}>{value}</p>
      <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--m-surface)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: hue }} />
      </div>
    </div>
  );
}

function DealRow({
  customer, owner, amount, stage,
}: { customer: string; owner: string; amount: string; stage: string }) {
  return (
    <div className="grid grid-cols-[1.4fr_88px_1fr_120px] gap-2 px-3 py-2.5 items-center border-t" style={{ borderColor: "var(--m-border)" }}>
      <span className="text-[12px] font-semibold truncate" style={{ color: "var(--m-text)" }}>{customer}</span>
      <span className="text-[11px]" style={{ color: "var(--m-text-muted)" }}>{owner}</span>
      <span className="text-[12px] font-bold tabular-nums text-right" style={{ color: "var(--m-text)" }}>{amount}</span>
      <span
        className="text-[9px] font-bold text-white text-center px-2 h-6 inline-flex items-center justify-center rounded-md"
        style={{ backgroundColor: "#f59e0b" }}
      >
        {stage}
      </span>
    </div>
  );
}
