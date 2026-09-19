// Closing CTA band: the final ask.
//
// Full-bleed brand-red panel with a single drifting yellow highlight
// blob in the corner. Faint white dot pattern adds texture. A handful
// of sparkle particles drift upward. The primary white pill is the
// focal point.
//
// This is a client component, so the CTA specs and the free-tier sentence
// arrive as PROPS from the server rather than by importing the marketing
// config here. Importing it would pull the whole Tuesday fixture and the
// pricing table into the browser bundle of every page that renders this.

"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";

export interface ClosingCtaProps {
  primary: { label: string; href: string; dataCta: string };
  secondary: { label: string; href: string; dataCta: string };
  /** "Free for up to N people. No credit card.", built from the enforced cap. */
  freeLine: string;
  /** Certification rows, already filtered by the claim flags. Usually empty. */
  certifications?: string[];
}

const PARTICLES = Array.from({ length: 6 }).map((_, i) => ({
  id: i,
  x: (i * 73) % 100,
  y: (i * 47) % 100,
  delay: (i % 6) * 0.5,
  duration: 5 + (i % 4),
  size: 2 + (i % 3),
}));

export function ClosingCTA({ primary, secondary, freeLine, certifications = [] }: ClosingCtaProps) {
  const homePrimary = primary;
  const homeSecondary = secondary;
  return (
    <section className="px-4 lg:px-6 py-12 lg:py-16">
      <div
        className="relative max-w-7xl mx-auto rounded-3xl overflow-hidden"
        style={{ backgroundColor: "var(--brand-red)" }}
      >
        {/* Single drifting yellow highlight blob */}
        <motion.div
          className="absolute -top-40 -right-32 w-[640px] h-[640px] rounded-full blur-3xl"
          style={{ backgroundColor: "var(--brand-yellow)", opacity: 0.14 }}
          animate={{ x: [0, -50, 30, 0], y: [0, 30, -20, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />

        {/* Dot pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(white 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
          aria-hidden
        />

        {/* Sparkle particles */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {PARTICLES.map((p) => (
            <motion.span
              key={p.id}
              className="absolute rounded-full"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                backgroundColor: "white",
              }}
              animate={{
                opacity: [0, 0.7, 0],
                y: [-8, -40],
                scale: [0.5, 1.1, 0.5],
              }}
              transition={{
                duration: p.duration,
                repeat: Infinity,
                delay: p.delay,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="relative px-8 lg:px-16 py-20 lg:py-28 text-center">
          <motion.span
            className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.22em] px-3 h-7 rounded-full bg-white/15 text-white backdrop-blur"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
          >
            <Sparkles size={11} /> Get started in 60 seconds
          </motion.span>

          <motion.h2
            className="mt-7 font-extrabold tracking-[-0.035em] text-white max-w-4xl mx-auto"
            style={{
              fontSize: "clamp(2.4rem, 5.4vw, 4.5rem)",
              lineHeight: 1.02,
            }}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            The operating system <br className="hidden sm:block" />
            your team{" "}
            <span style={{ color: "var(--brand-yellow)" }}>actually deserves</span>.
          </motion.h2>

          <motion.p
            className="mt-7 text-lg lg:text-[20px] leading-relaxed text-white/85 max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            {/* There is no 14-day clock: Starter is free at the cap the
                server enforces, forever, which is a better sentence anyway.
                The number comes from the pricing source, so it moves when
                PLAN_LIMITS does and a unit test fails if it does not. */}
            {freeLine} Your workspace runs the same afternoon.
          </motion.p>

          <motion.div
            className="mt-10 flex flex-wrap justify-center gap-3"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            {/* Primary: the canon's label, the canon's destination. It was
                "Get started - it's free", which naming-canon forbids in
                favour of "Start free", beside "Watch a 2-min demo" pointing
                at a video that does not exist. */}
            <Link
              href={homePrimary.href}
              data-cta={homePrimary.dataCta}
              className="relative inline-flex items-center gap-2 px-7 rounded-full bg-white font-bold text-[15px] transition-colors"
              style={{ color: "var(--brand-red)", height: 52 }}
            >
              {homePrimary.label} <ArrowRight size={15} />
            </Link>

            {/* Secondary: outlined */}
            <Link
              href={homeSecondary.href}
              data-cta={homeSecondary.dataCta}
              className="inline-flex items-center gap-2 px-7 rounded-full font-semibold text-[15px] text-white border-2 border-white/30 hover:border-white/60 hover:bg-white/10 transition-colors"
              style={{ height: 52 }}
            >
              {homeSecondary.label}
            </Link>
          </motion.div>

          {/* Reassurance row */}
          <motion.div
            className="mt-10 inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/80"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: 0.4 }}
          >
            {/* "SOC 2 + ISO 27001" was here. Neither certification is held:
                flags.soc2 and flags.iso27001 are both false, and a legal
                claim is not a reassurance row. It returns when the report
                does, through the flag, not through a typed string. */}
            <Reassurance label="Free forever" />
            <Reassurance label="No credit card" />
            <Reassurance label="Export everything, any time" />
            {certifications.map((c) => (
              <Reassurance key={c} label={c} />
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Reassurance({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
        style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 4l1.8 1.8 3.2-3.6" />
        </svg>
      </span>
      <span className="font-semibold">{label}</span>
    </span>
  );
}
