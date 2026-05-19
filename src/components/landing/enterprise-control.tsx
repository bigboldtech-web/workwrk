// Enterprise Control — Workday-grade governance section.
//
// Six-pillar grid of capabilities required by an enterprise security
// review: agent activity tracking, scoped permissions, human-in-the-
// loop, AI cost ledger, content ownership, no-data-training. Below it,
// a compliance badge strip (SOC 2 / ISO 27001 / GDPR / DPDP / HIPAA /
// PCI-DSS) — the credibility row a CISO actually scans for.

"use client";

import { motion } from "framer-motion";
import {
  Eye, Lock, UserCheck, BarChart3, FileCheck, ShieldCheck,
  ArrowRight,
} from "lucide-react";

interface Pillar {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>;
  title: string;
  body: string;
  hue: string;
}

const PILLARS: readonly Pillar[] = [
  {
    icon: Eye,
    title: "Agent activity",
    body: "Track every agent action across your org with a real-time, tamper-evident log. Searchable, exportable to your SIEM.",
    hue: "#FF3D57",
  },
  {
    icon: Lock,
    title: "Scoped permissions",
    body: "Define exactly which data each agent can access, and whether it has permission to edit, create, or only read.",
    hue: "#0073EA",
  },
  {
    icon: UserCheck,
    title: "Human in the loop",
    body: "Validate every agent action before it executes. Or graduate it to autonomous once it's earned the trust.",
    hue: "#A25DDC",
  },
  {
    icon: BarChart3,
    title: "AI cost center",
    body: "Track AI usage and spend per team, per agent. Set limits, set alerts, never wake up to a surprise bill.",
    hue: "#FDAB3D",
  },
  {
    icon: FileCheck,
    title: "Content ownership",
    body: "You retain full ownership of every input you provide and every artifact agents generate. It's yours.",
    hue: "#00C875",
  },
  {
    icon: ShieldCheck,
    title: "No data training",
    body: "Your workspace data is never used to train foundation models. What happens in your workspace stays in your workspace.",
    hue: "#14b8a6",
  },
];

const BADGES: readonly { label: string; sub: string }[] = [
  { label: "SOC 2",       sub: "Type II"  },
  { label: "ISO 27001",   sub: "Certified"  },
  { label: "GDPR",         sub: "Compliant"  },
  { label: "DPDP",         sub: "India"      },
  { label: "HIPAA",        sub: "Ready"      },
  { label: "PCI-DSS",      sub: "Compliant"  },
];

export function EnterpriseControl() {
  return (
    <section className="relative bg-white py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
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
            Full control
          </p>
          <h2
            className="mt-5 font-extrabold tracking-[-0.03em]"
            style={{
              color: "var(--m-text)",
              fontSize: "clamp(2rem, 4vw, 3.4rem)",
              lineHeight: 1.04,
            }}
          >
            Fortune 500 muscle.{" "}
            <span style={{ color: "var(--brand-red)" }}>SMB simplicity.</span>
          </h2>
          <p
            className="mt-5 text-base lg:text-lg leading-relaxed max-w-2xl"
            style={{ color: "var(--m-text-muted)" }}
          >
            Every guardrail your CISO will ask for &mdash; agent activity
            tracking, permission scoping, human-in-the-loop, content
            ownership. Built in. Not an enterprise add-on.
          </p>
        </motion.div>

        {/* Six pillars */}
        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {PILLARS.map((p, i) => (
            <PillarCard key={p.title} pillar={p} delay={i * 0.06} />
          ))}
        </div>

        {/* Compliance badges */}
        <motion.div
          className="mt-16 lg:mt-20 rounded-2xl p-7 lg:p-9"
          style={{
            backgroundColor: "var(--m-surface)",
            border: "1px solid var(--m-border)",
          }}
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-md">
              <p
                className="text-[10.5px] font-bold uppercase tracking-[0.22em] mb-2"
                style={{ color: "var(--m-text-soft)" }}
              >
                Compliance posture
              </p>
              <p
                className="font-extrabold tracking-[-0.025em]"
                style={{
                  color: "var(--m-text)",
                  fontSize: "clamp(1.4rem, 2.2vw, 1.8rem)",
                  lineHeight: 1.12,
                }}
              >
                Audited, attested, and ready for review.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--m-text-muted)" }}>
                Reports + DPAs available on request &mdash; usually one email
                to{" "}
                <a
                  href="mailto:security@workwrk.com"
                  className="font-semibold underline underline-offset-2"
                  style={{ color: "var(--m-text)" }}
                >
                  security@workwrk.com
                </a>
                .
              </p>
            </div>
            <div className="flex-1 min-w-[300px] grid grid-cols-3 md:grid-cols-6 gap-3">
              {BADGES.map((b, i) => (
                <ComplianceBadge key={b.label} label={b.label} sub={b.sub} delay={0.3 + i * 0.05} />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Bottom CTA strip */}
        <motion.div
          className="mt-10 flex flex-wrap items-center justify-between gap-4"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <p className="text-sm" style={{ color: "var(--m-text-muted)" }}>
            Need a Pen test letter or a custom MSA?{" "}
            <span style={{ color: "var(--m-text)", fontWeight: 600 }}>We&apos;ve got you.</span>
          </p>
          <a
            href="/security"
            className="inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
            style={{ color: "var(--m-text)" }}
          >
            Visit our trust portal <ArrowRight size={14} />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

// ── Pillar card ──────────────────────────────────────────────────────

function PillarCard({ pillar, delay }: { pillar: Pillar; delay: number }) {
  const Icon = pillar.icon;
  return (
    <motion.div
      className="group p-6 lg:p-7 rounded-2xl bg-white transition-all"
      style={{
        border: "1px solid var(--m-border)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
      }}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3, boxShadow: "0 14px 32px -10px rgba(15,23,42,0.14)" }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all group-hover:scale-105"
        style={{
          backgroundColor: `${pillar.hue}14`,
          border: `1px solid ${pillar.hue}33`,
        }}
      >
        <Icon size={20} strokeWidth={2.2} style={{ color: pillar.hue }} />
      </div>

      <h3
        className="mt-5 font-bold tracking-tight"
        style={{ color: "var(--m-text)", fontSize: 17, lineHeight: 1.2 }}
      >
        {pillar.title}
      </h3>
      <p
        className="mt-2.5 text-[13.5px] leading-relaxed"
        style={{ color: "var(--m-text-muted)" }}
      >
        {pillar.body}
      </p>
    </motion.div>
  );
}

// ── Compliance badge ────────────────────────────────────────────────

function ComplianceBadge({ label, sub, delay }: { label: string; sub: string; delay: number }) {
  return (
    <motion.div
      className="aspect-square rounded-xl bg-white flex flex-col items-center justify-center px-2 text-center"
      style={{
        border: "1px solid var(--m-border)",
      }}
      initial={{ opacity: 0, scale: 0.85 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <ShieldCheck size={18} style={{ color: "var(--brand-red)" }} />
      <p
        className="mt-1.5 text-[11.5px] font-bold tracking-tight tabular-nums"
        style={{ color: "var(--m-text)" }}
      >
        {label}
      </p>
      <p className="text-[9px] font-medium" style={{ color: "var(--m-text-soft)" }}>
        {sub}
      </p>
    </motion.div>
  );
}
