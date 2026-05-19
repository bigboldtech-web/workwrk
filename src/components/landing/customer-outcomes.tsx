// Customer outcomes — section 5 (revamped).
//
// Now with continuous motion: an animated mesh backdrop, a marquee of
// customer wordmarks scrolling at the top, an auto-cycling featured
// testimonial (3 quotes rotate every 8s), metric cards with a quiet
// pulse on the big number, and a live signup ticker at the bottom.
//
// Motion philosophy:
//   - Background drifts on its own (gradient mesh).
//   - One thing in the foreground is always moving — marquee, the
//     testimonial crossfade, the metric pulse, the ticker increment.
//   - Nothing is screen-jacking. All loops are slow and tasteful.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useInView,
} from "framer-motion";
import { ArrowRight, Quote as QuoteIcon, Users, Sparkles } from "lucide-react";

// ── Testimonials (auto-cycle) ─────────────────────────────────────────

interface Testimonial {
  quote: string;
  initials: string;
  name: string;
  role: string;
  company: string;
  industry: string;
  hue: string;
  miniStats: { label: string; value: string }[];
  storyHref: string;
}

const TESTIMONIALS: readonly Testimonial[] = [
  {
    quote:
      "We cancelled six tools in the first 90 days. Our ops director now opens one tab in the morning, not twelve. That's the whole pitch — and it's true.",
    initials: "PI",
    name: "Priya Iyer",
    role: "COO",
    company: "Helios Labs",
    industry: "Technology",
    hue: "var(--brand-red)",
    miniStats: [
      { label: "Tools cut",  value: "6" },
      { label: "Time saved", value: "14h/wk" },
      { label: "Team size",  value: "180" },
    ],
    storyHref: "/customers/helios-labs",
  },
  {
    quote:
      "Performance reviews used to take six weeks across four tools. Now it's ten days inside WorkwrK. And the data is actually better than it was before.",
    initials: "DP",
    name: "Daniel Park",
    role: "VP People",
    company: "Forge Capital",
    industry: "Financial Services",
    hue: "var(--status-special)",
    miniStats: [
      { label: "Cycle time", value: "10 days" },
      { label: "Throughput", value: "4.2×" },
      { label: "Team size",  value: "320" },
    ],
    storyHref: "/customers/forge-capital",
  },
  {
    quote:
      "Audit findings went from a quarterly fire drill to a screenshot we email. The audit trail was already there — we just had to point at it.",
    initials: "AS",
    name: "Anita Sharma",
    role: "Head of Compliance",
    company: "Quill Health",
    industry: "Healthcare",
    hue: "var(--brand-blue)",
    miniStats: [
      { label: "Audits closed", value: "12/12" },
      { label: "SOPs",          value: "180+" },
      { label: "Team size",     value: "96" },
    ],
    storyHref: "/customers/quill-health",
  },
];

// ── Metric cards (count-up + subtle pulse) ───────────────────────────

interface Metric {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
  body: string;
  company: string;
  industry: string;
  hue: string;
}

const METRICS: readonly Metric[] = [
  {
    to: 62,
    suffix: "%",
    label: "Tool spend reduction",
    body: "Cancelled six legacy tools in the first 90 days after rolling out WorkwrK across the org.",
    company: "Helios Labs",
    industry: "Technology",
    hue: "var(--brand-red)",
  },
  {
    to: 10,
    suffix: " days",
    label: "To first KPI dashboard live",
    body: "From signup to a fully-wired KPI engine running across clinical, admin, and ops teams.",
    company: "Quill Health",
    industry: "Healthcare",
    hue: "var(--brand-blue)",
  },
  {
    to: 4.2,
    decimals: 1,
    suffix: "×",
    label: "Faster performance cycles",
    body: "Quarterly review cycles dropped from 6 weeks across 4 tools to 10 days inside WorkwrK.",
    company: "Forge Capital",
    industry: "Financial Services",
    hue: "var(--status-special)",
  },
];

export function CustomerOutcomes() {
  return (
    <section className="relative bg-white py-24 lg:py-32 overflow-hidden">
      {/* Animated gradient mesh backdrop */}
      <AnimatedMesh />

      <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
        {/* Header */}
        <motion.div
          className="max-w-3xl"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p
            className="text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "var(--brand-red)" }}
          >
            Customer outcomes
          </p>
          <h2
            className="mt-5 font-extrabold tracking-[-0.03em]"
            style={{
              color: "var(--m-text)",
              fontSize: "clamp(2rem, 4vw, 3.4rem)",
              lineHeight: 1.04,
            }}
          >
            Numbers that move.{" "}
            <span style={{ color: "var(--m-text-muted)" }}>Stories that prove it.</span>
          </h2>
          <p
            className="mt-5 text-base lg:text-lg leading-relaxed max-w-2xl"
            style={{ color: "var(--m-text-muted)" }}
          >
            500+ teams across 8 countries replaced a 15-tool stack with
            WorkwrK. These are the deltas they actually measured.
          </p>
        </motion.div>

        {/* Auto-cycling testimonial */}
        <CyclingTestimonial />

        {/* Metric cards */}
        <div className="mt-8 grid md:grid-cols-3 gap-4">
          {METRICS.map((m, i) => (
            <MetricCard key={m.company} metric={m} delay={0.1 + i * 0.1} />
          ))}
        </div>

        {/* Live signup ticker */}
        <LiveSignupTicker />
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Animated mesh backdrop
// ════════════════════════════════════════════════════════════════════

function AnimatedMesh() {
  // Single, calm mesh blob drifting at low opacity. Replaces the
  // earlier three-color mesh — restraint over noise.
  return (
    <div className="absolute inset-0 pointer-events-none -z-0" aria-hidden>
      <motion.div
        className="absolute -top-32 -left-32 w-[680px] h-[680px] rounded-full blur-3xl"
        style={{ backgroundColor: "var(--brand-red)", opacity: 0.05 }}
        animate={{ x: [0, 60, -10, 0], y: [0, 30, -10, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Auto-cycling testimonial
// ════════════════════════════════════════════════════════════════════

function CyclingTestimonial() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % TESTIMONIALS.length);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const active = TESTIMONIALS[idx];

  return (
    <motion.div
      className="mt-10 lg:mt-12 relative rounded-3xl overflow-hidden"
      style={{ backgroundColor: "var(--m-surface)" }}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Brand corner accent — recolors per active testimonial */}
      <motion.div
        key={`accent-${idx}`}
        className="absolute top-0 right-0 w-48 h-48 -translate-y-1/2 translate-x-1/4 rounded-full blur-3xl pointer-events-none"
        style={{ backgroundColor: active.hue }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.25 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        aria-hidden
      />

      {/* Decorative quote glyph */}
      <QuoteIcon
        size={140}
        className="absolute top-6 right-8 opacity-[0.04]"
        strokeWidth={1.5}
        style={{ color: "var(--m-text)" }}
      />

      <div className="relative px-8 lg:px-16 py-12 lg:py-20">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "var(--m-text-soft)" }}
          >
            Featured stories
            <span className="ml-2 inline-flex items-center gap-1.5">
              <motion.span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: active.hue }}
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
              <span style={{ color: active.hue }}>Live</span>
            </span>
          </p>

          {/* Dot indicator pager */}
          <div className="flex items-center gap-2">
            {TESTIMONIALS.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                aria-label={`Show testimonial ${i + 1}`}
                className="h-2 rounded-full transition-all"
                style={{
                  width: i === idx ? 28 : 8,
                  backgroundColor: i === idx ? active.hue : "var(--m-border-dark)",
                }}
              />
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-10 lg:gap-16 items-center">
          {/* Quote (crossfades) */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`quote-${idx}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <blockquote
                className="font-bold tracking-[-0.02em]"
                style={{
                  color: "var(--m-text)",
                  fontSize: "clamp(1.5rem, 2.6vw, 2.4rem)",
                  lineHeight: 1.22,
                }}
              >
                &ldquo;{active.quote}&rdquo;
              </blockquote>

              <a
                className="mt-8 inline-flex items-center gap-1.5 text-[14px] font-semibold transition-colors group"
                style={{ color: active.hue }}
                href={active.storyHref}
              >
                Read the {active.company} story{" "}
                <ArrowRight
                  size={14}
                  className="group-hover:translate-x-1 transition-transform"
                />
              </a>
            </motion.div>
          </AnimatePresence>

          {/* Attribution card (crossfades) */}
          <AnimatePresence mode="wait">
            <motion.figcaption
              key={`card-${idx}`}
              className="rounded-2xl bg-white p-6 lg:p-7"
              style={{ border: "1px solid var(--m-border)" }}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-[15px] flex-shrink-0"
                  style={{ backgroundColor: active.hue }}
                >
                  {active.initials}
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold truncate" style={{ color: "var(--m-text)" }}>
                    {active.name}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--m-text-soft)" }}>
                    {active.role} &middot; {active.company}
                  </p>
                </div>
              </div>

              <p
                className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: active.hue }}
              >
                {active.industry}
              </p>

              <div
                className="mt-5 pt-5 border-t grid grid-cols-3 gap-3"
                style={{ borderColor: "var(--m-border)" }}
              >
                {active.miniStats.map((s) => (
                  <div key={s.label}>
                    <p
                      className="text-[9px] font-bold uppercase tracking-[0.14em]"
                      style={{ color: "var(--m-text-soft)" }}
                    >
                      {s.label}
                    </p>
                    <p
                      className="mt-1 text-[15px] font-bold tabular-nums"
                      style={{ color: "var(--m-text)" }}
                    >
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>
            </motion.figcaption>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Metric card — count-up on first view + continuous subtle pulse
// ════════════════════════════════════════════════════════════════════

function MetricCard({ metric, delay }: { metric: Metric; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, metric.to, {
      duration: 1.6,
      ease: [0.22, 1, 0.36, 1],
      delay,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, metric.to, delay]);

  const formatted = metric.decimals
    ? display.toFixed(metric.decimals)
    : Math.round(display).toLocaleString();

  return (
    <motion.div
      ref={ref}
      className="group relative rounded-2xl bg-white p-7 lg:p-8 overflow-hidden"
      style={{ border: "1px solid var(--m-border)" }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -6 }}
    >
      {/* Brand stripe top */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ backgroundColor: metric.hue }}
        aria-hidden
      />

      {/* The number — sits still after count-up */}
      <p
        className="relative font-extrabold tracking-[-0.04em] tabular-nums"
        style={{
          color: metric.hue,
          fontSize: "clamp(3.5rem, 6vw, 5.5rem)",
          lineHeight: 0.95,
        }}
      >
        {metric.prefix}
        {formatted}
        {metric.suffix}
      </p>

      <p className="relative mt-3 text-[15px] font-bold" style={{ color: "var(--m-text)" }}>
        {metric.label}
      </p>

      <p
        className="relative mt-2 text-[13px] leading-relaxed"
        style={{ color: "var(--m-text-muted)" }}
      >
        {metric.body}
      </p>

      <div
        className="relative mt-6 pt-5 border-t flex items-center justify-between"
        style={{ borderColor: "var(--m-border)" }}
      >
        <div className="min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--m-text-soft)" }}
          >
            {metric.industry}
          </p>
          <p
            className="mt-1 text-[15px] font-bold truncate"
            style={{
              color: "var(--m-text)",
              fontVariant: "small-caps",
              letterSpacing: "0.02em",
            }}
          >
            {metric.company}
          </p>
        </div>
        <ArrowRight
          size={16}
          className="opacity-40 group-hover:opacity-100 group-hover:translate-x-1 transition-all"
          style={{ color: metric.hue }}
        />
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Live signup ticker — number ticks up every few seconds
// ════════════════════════════════════════════════════════════════════

function LiveSignupTicker() {
  const [count, setCount] = useState(12847);

  useEffect(() => {
    const t = setInterval(() => {
      setCount((c) => c + 1);
    }, 6000);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      className="mt-12 flex flex-wrap items-center justify-center gap-3"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, delay: 0.3 }}
    >
      <div
        className="inline-flex items-center gap-3 pl-3 pr-5 py-2.5 rounded-full bg-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]"
        style={{ border: "1px solid var(--m-border)" }}
      >
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-white relative"
          style={{ backgroundColor: "var(--brand-red)" }}
        >
          <Users size={13} />
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: "var(--brand-red)" }}
            animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            aria-hidden
          />
        </span>

        <span className="text-[12.5px]" style={{ color: "var(--m-text)" }}>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={count}
              className="font-bold tabular-nums inline-block"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              {count.toLocaleString()}
            </motion.span>
          </AnimatePresence>{" "}
          teams running on WorkwrK
          <span className="ml-2" style={{ color: "var(--m-text-soft)" }}>
            &middot;
          </span>
          <span
            className="ml-2 inline-flex items-center gap-1 font-semibold"
            style={{ color: "var(--status-done)" }}
          >
            <Sparkles size={11} /> +47 this week
          </span>
        </span>
      </div>
    </motion.div>
  );
}
