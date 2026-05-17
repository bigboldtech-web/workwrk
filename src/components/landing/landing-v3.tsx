"use client";

/**
 * Landing v3 — Phase E of the UX revamp.
 *
 * Replaces the 14-scene v2 carousel with a static, fast-loading shape
 * that maps 1:1 to the new IA introduced in Phase A:
 *
 *   1. Hero        — one promise, one demo image, one CTA
 *   2. Hubs        — 7 cards matching the 7 sidebar hubs
 *   3. Proof       — social-proof placeholder + outcomes
 *   4. Pricing     — three tiers, light treatment, link to /pricing
 *   5. Final CTA   — single Start free button
 *
 * Why a v3 (and not edits to v2): the scenes pattern is animation-
 * heavy and not aligned with the "one promise" design principle. Keeping
 * v2 in the repo means we can A/B or roll back without surgery. The
 * marketing/page.tsx renders v3 by default.
 *
 * Single CTA verb everywhere: "Start free". No Start / Try / Sign up
 * variants — picking one verb is the cheapest way to make the funnel
 * coherent.
 */

import Link from "next/link";
import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";
import {
  LayoutDashboard, Users, CalendarDays, DollarSign, Star, Megaphone, Wrench,
  Sparkles, ArrowRight, Check,
} from "lucide-react";

const HUBS = [
  {
    icon: LayoutDashboard,
    name: "Home",
    tagline: "What needs you, right now.",
    body: "An inbox that aggregates approvals, tasks, mandatory courses, interviews, and decisions across every module. AI triages so you act on the right things first.",
  },
  {
    icon: Users,
    name: "People",
    tagline: "The team, the org chart, the lookups.",
    body: "Profiles that go deeper than HRIS. Department + role hierarchies, location, reporting lines, and a fast lookup that's the universal entry-point into anyone's day.",
  },
  {
    icon: CalendarDays,
    name: "Work",
    tagline: "Tasks, OKRs, KPIs, SOPs in one place.",
    body: "Calendar + week + month views. KRA scoring tied to KPIs. OKRs cascade from company → team → individual. SOPs become Process Runs you can hand off.",
  },
  {
    icon: DollarSign,
    name: "Money",
    tagline: "Expenses to Financials, one ledger.",
    body: "Approve expenses + POs in seconds. Invoices route into AP queues. Full GL with statements (P&L, BS, Cash Flow), Adaptive Planning, and variance reports against actuals.",
  },
  {
    icon: Star,
    name: "Talent",
    tagline: "Reviews, comp, hiring, learning.",
    body: "Performance cycles with 360° feedback. Compensation decisions with approval chains. Recruiting pipeline. Talent grid (9-box). Mandatory learning with compliance tracking.",
  },
  {
    icon: Megaphone,
    name: "Culture",
    tagline: "Announcements, kudos, policies, signal.",
    body: "Must-acknowledge announcements with ack tracking. Kudos that build into recognition scores. Versioned policies. Pulse surveys + ideas board + manager candor.",
  },
  {
    icon: Wrench,
    name: "Platform",
    tagline: "Studio, integrations, audit, admin.",
    body: "Customer-defined workflows + custom fields. Cmd-K AI search across every entity. SCIM + SSO. Full audit log. Brand guide. Tools catalog with shared credentials.",
  },
] as const;

interface PricingTier {
  name: string;
  price: string;
  sub: string;
  features: readonly string[];
  cta: string;
  href: string;
  highlighted?: boolean;
}

const PRICING: readonly PricingTier[] = [
  {
    name: "Starter",
    price: "Free",
    sub: "Up to 5 people",
    features: ["Home, People, Work, Culture", "Inbox + AI Cmd-K", "Email support"],
    cta: "Start free",
    href: "/register",
  },
  {
    name: "Growth",
    price: "$8",
    sub: "per user / month",
    features: ["Everything in Starter", "Money + Talent hubs", "AI triage + signals", "Slack + Google integrations", "Priority support"],
    cta: "Start 14-day trial",
    href: "/register?plan=growth",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    sub: "100+ people",
    features: ["Everything in Growth", "SCIM + SSO + audit", "Studio (workflows, fields)", "BYOK / on-prem AI", "Dedicated CSM"],
    cta: "Talk to sales",
    href: "/contact",
  },
];

export function LandingV3() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingTopbar />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="px-6 pt-20 pb-24 max-w-6xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-border bg-surface mb-6 text-muted">
          <Sparkles size={12} className="text-[color:var(--accent-strong)]" />
          The operating system for SMB → mid-market
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6 max-w-3xl mx-auto leading-tight">
          Run your company<br />
          <span className="text-[color:var(--accent-strong)]">on one product.</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
          WorkwrK unifies people, performance, finance, talent, and platform tooling
          into a single system. Replace 15 disconnected SaaS tools with one place
          that actually knows your company.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[color:var(--accent)] text-white font-semibold hover:opacity-90 transition-fast"
          >
            Start free
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border font-semibold hover:bg-surface transition-fast"
          >
            See a demo
          </Link>
        </div>
        <p className="text-xs text-muted-2 mt-4">Free for teams up to 5. No credit card.</p>
      </section>

      {/* ── Hubs grid ───────────────────────────────────────────── */}
      <section className="px-6 py-24 border-t border-border bg-surface/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3">
              Seven hubs · one product
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mx-auto">
              Built around how teams actually work — not how vendors sell.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {HUBS.map((hub) => {
              const Icon = hub.icon;
              return (
                <div
                  key={hub.name}
                  className="rounded-xl border border-border bg-background p-6 hover:border-[color:var(--accent)] transition-fast"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className="h-8 w-8 rounded-lg flex items-center justify-center"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent-strong)",
                      }}
                    >
                      <Icon size={16} />
                    </span>
                    <h3 className="text-lg font-semibold">{hub.name}</h3>
                  </div>
                  <p className="text-sm font-medium text-foreground mb-2">{hub.tagline}</p>
                  <p className="text-sm text-muted leading-relaxed">{hub.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Outcome cards (replaces the social-proof carousel) ─── */}
      <section className="px-6 py-24 max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3">
            Why teams move
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mx-auto">
            One product, not fifteen subscriptions.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <OutcomeCard
            title="One sign-in. One inbox. One source of truth."
            body="Stop paying for Asana + Notion + Lattice + Bill.com + Bamboo + Carta + Slack + Linear. One product that knows your team, your money, and your work."
          />
          <OutcomeCard
            title="AI that actually knows your company."
            body="Cmd-K opens an assistant that reads across every module. 'Who's overdue on reviews?' 'What expenses are pending?' 'Show me variance for last quarter.'"
          />
          <OutcomeCard
            title="Built for SMB → mid-market scale."
            body="From 5 people to 500. The schema scales — financials, multi-entity, SCIM, audit — without making 10-person teams pay enterprise prices."
          />
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 border-t border-border bg-surface/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3">
              Pricing
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mx-auto">
              Free under five. Honest above that.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {PRICING.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl border p-6 ${
                  tier.highlighted
                    ? "border-[color:var(--accent)] bg-background shadow-lg ring-1 ring-[color:var(--accent)]/20"
                    : "border-border bg-background"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold">{tier.name}</h3>
                  {tier.highlighted && (
                    <span
                      className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent-strong)",
                      }}
                    >
                      Popular
                    </span>
                  )}
                </div>
                <div className="mb-1">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  {tier.price !== "Free" && tier.price !== "Custom" && (
                    <span className="text-sm text-muted ml-1">{tier.sub}</span>
                  )}
                </div>
                {(tier.price === "Free" || tier.price === "Custom") && (
                  <p className="text-sm text-muted mb-5">{tier.sub}</p>
                )}
                <ul className="space-y-2 my-6">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={14} className="text-[color:var(--accent-strong)] flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={tier.href}
                  className={`block text-center px-4 py-2.5 rounded-lg font-semibold text-sm transition-fast ${
                    tier.highlighted
                      ? "bg-[color:var(--accent)] text-white hover:opacity-90"
                      : "border border-border hover:bg-surface"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted mt-8">
            Full feature matrix at <Link href="/pricing" className="underline">workwrk.com/pricing</Link>
          </p>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────── */}
      <section className="px-6 py-32 text-center max-w-3xl mx-auto">
        <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6">
          Replace fifteen tools with one.
        </h2>
        <p className="text-lg text-muted mb-10">
          Free under five people. Set up in under an hour. Cancel any time.
        </p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-lg bg-[color:var(--accent)] text-white font-semibold text-lg hover:opacity-90 transition-fast"
        >
          Start free
          <ArrowRight size={18} />
        </Link>
      </section>

      <MarketingFooter />
    </div>
  );
}

function OutcomeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/30 p-6">
      <h3 className="text-base font-semibold mb-2 leading-tight">{title}</h3>
      <p className="text-sm text-muted leading-relaxed">{body}</p>
    </div>
  );
}
