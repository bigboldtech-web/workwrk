// Pricing preview — section 7.
//
// Three tier cards: Starter (free) / Growth ($8/user/mo, featured) / Scale (custom).
// Featured tier has a colored border, a "Most chosen" pill, and a soft
// continuous glow pulse so it draws the eye. All three reveal with
// stagger on scroll and lift on hover.

"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check, ChevronRight, Sparkles } from "lucide-react";

interface Tier {
  name: string;
  price: string;
  priceSuffix?: string;
  sub: string;
  description: string;
  features: readonly string[];
  cta: { label: string; href: string };
  featured?: boolean;
  hue: string;
  hueSoft: string;
}

const TIERS: readonly Tier[] = [
  {
    name: "Starter",
    price: "Free",
    sub: "Up to 5 people, forever",
    description: "All seven hubs unlocked for founding teams and pilots.",
    hue: "var(--m-text)",
    hueSoft: "var(--m-surface)",
    features: [
      "All 7 hubs unlocked",
      "Inbox + Cmd-K AI search",
      "Tasks, OKRs, KPIs, SOPs",
      "Kudos, ideas, surveys",
      "Email support · 24h",
    ],
    cta: { label: "Start free", href: "/signup" },
  },
  {
    name: "Growth",
    price: "$8",
    priceSuffix: "/user / mo",
    sub: "14-day trial · no credit card",
    description: "Everything most SMB to mid-market teams actually need.",
    featured: true,
    hue: "var(--brand-red)",
    hueSoft: "var(--brand-red-soft)",
    features: [
      "Everything in Starter",
      "Money + Talent + Growth hubs",
      "AI Inbox triage + signals",
      "Slack + Google Workspace",
      "Custom KPI weights + composite scores",
      "Priority support · 4h SLA",
    ],
    cta: { label: "Start 14-day trial", href: "/signup?plan=growth" },
  },
  {
    name: "Scale",
    price: "Custom",
    sub: "From $29,999 / year",
    description: "For 250+ seat operators who need SLAs and a named CSM.",
    hue: "var(--m-text)",
    hueSoft: "var(--m-surface)",
    features: [
      "Everything in Growth",
      "Unlimited AI usage",
      "SSO (SAML) + SCIM provisioning",
      "Audit log + retention controls",
      "Custom integrations + API quota",
      "Dedicated CSM · 1h SLA",
    ],
    cta: { label: "Talk to sales", href: "/demo" },
  },
];

export function PricingPreview() {
  return (
    <section
      className="py-24 lg:py-32"
      style={{ backgroundColor: "var(--m-surface)" }}
    >
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
            Pricing
          </p>
          <h2
            className="mt-5 font-extrabold tracking-[-0.03em]"
            style={{
              color: "var(--m-text)",
              fontSize: "clamp(2rem, 4vw, 3.4rem)",
              lineHeight: 1.04,
            }}
          >
            Honest pricing that{" "}
            <span style={{ color: "var(--brand-red)" }}>makes the math work.</span>
          </h2>
          <p
            className="mt-5 text-base lg:text-lg leading-relaxed max-w-2xl"
            style={{ color: "var(--m-text-muted)" }}
          >
            Free forever under five people. $8/user thereafter. No per-module
            surcharges, no surprise tiers, no quote-only marketing nonsense.
          </p>
        </motion.div>

        {/* Tier cards */}
        <div className="mt-14 grid md:grid-cols-3 gap-5 lg:gap-6">
          {TIERS.map((tier, i) => (
            <TierCard key={tier.name} tier={tier} delay={0.1 + i * 0.1} />
          ))}
        </div>

        {/* Bottom link */}
        <motion.div
          className="mt-10 text-center"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1 text-sm font-semibold transition-colors"
            style={{ color: "var(--m-text)" }}
          >
            See the full pricing matrix <ChevronRight size={14} />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

function TierCard({ tier, delay }: { tier: Tier; delay: number }) {
  return (
    <motion.div
      className="relative rounded-2xl p-7 lg:p-8 bg-white overflow-hidden"
      style={{
        border: tier.featured
          ? `2px solid ${tier.hue}`
          : "1px solid var(--m-border)",
      }}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -6 }}
    >
      {/* Soft glow pulse for featured tier */}
      {tier.featured && (
        <motion.div
          className="absolute -inset-1 rounded-2xl pointer-events-none -z-10"
          style={{ backgroundColor: tier.hue, opacity: 0.18 }}
          animate={{ opacity: [0.12, 0.28, 0.12] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      )}

      {/* "Most chosen" pill */}
      {tier.featured && (
        <span
          className="absolute -top-3 left-7 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 h-6 rounded-full text-white"
          style={{ backgroundColor: tier.hue }}
        >
          <Sparkles size={9} /> Most chosen
        </span>
      )}

      {/* Top color stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ backgroundColor: tier.hue }}
        aria-hidden
      />

      {/* Name */}
      <p
        className="text-xs font-bold uppercase tracking-[0.18em]"
        style={{ color: tier.hue }}
      >
        {tier.name}
      </p>

      {/* Price */}
      <p className="mt-4 flex items-baseline gap-1.5">
        <span
          className="font-extrabold tabular-nums tracking-[-0.04em]"
          style={{
            color: "var(--m-text)",
            fontSize: "clamp(2.6rem, 4vw, 3.4rem)",
            lineHeight: 1,
          }}
        >
          {tier.price}
        </span>
        {tier.priceSuffix && (
          <span
            className="text-[13px] font-medium"
            style={{ color: "var(--m-text-soft)" }}
          >
            {tier.priceSuffix}
          </span>
        )}
      </p>

      <p
        className="mt-1.5 text-[12.5px]"
        style={{ color: "var(--m-text-soft)" }}
      >
        {tier.sub}
      </p>

      <p
        className="mt-3 text-[13.5px] leading-relaxed"
        style={{ color: "var(--m-text-muted)" }}
      >
        {tier.description}
      </p>

      {/* CTA */}
      <Link
        href={tier.cta.href}
        className="mt-6 inline-flex items-center justify-center gap-1.5 w-full h-12 rounded-full font-semibold text-sm transition-all"
        style={{
          backgroundColor: tier.featured ? tier.hue : "var(--m-text)",
          color: "white",
        }}
      >
        {tier.cta.label} <ArrowRight size={14} />
      </Link>

      {/* Feature checklist */}
      <ul className="mt-7 space-y-2.5">
        {tier.features.map((f, i) => (
          <motion.li
            key={f}
            className="flex items-start gap-2.5 text-[13.5px]"
            style={{ color: "var(--m-text)" }}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: delay + 0.3 + i * 0.05 }}
          >
            <span
              className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: tier.hueSoft }}
            >
              <Check size={9} strokeWidth={3} style={{ color: tier.hue }} />
            </span>
            <span>{f}</span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}
