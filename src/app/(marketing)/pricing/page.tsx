// Pricing page — Phase G17 revamp.
//
// Matches landing v3's three-tier shape (Starter / Growth / Enterprise),
// then adds a comparison matrix below for procurement readers. Single
// CTA verb everywhere — "Start free" / "Start trial" / "Talk to sales".

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, Minus } from "lucide-react";
import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";

export const metadata: Metadata = {
  title: "Pricing — WorkwrK",
  description:
    "Free under five people. Honest above that. Three tiers — Starter, Growth, Enterprise. WorkwrK replaces 15+ tools so the math always works.",
};

interface Tier {
  name: string;
  price: string;
  sub: string;
  description: string;
  features: readonly string[];
  cta: string;
  href: string;
  highlighted?: boolean;
}

const TIERS: readonly Tier[] = [
  {
    name: "Starter",
    price: "Free",
    sub: "Up to 5 people",
    description: "For founding teams and pilots. Every core hub, no time limit.",
    features: [
      "Home, People, Work, Culture hubs",
      "Inbox + Cmd-K AI search",
      "Tasks, OKRs, KPIs, SOPs",
      "Announcements, Kudos, Ideas, Surveys",
      "Email support",
    ],
    cta: "Start free",
    href: "/register",
  },
  {
    name: "Growth",
    price: "$8",
    sub: "per user / month",
    description: "Everything most SMB → mid-market companies actually need.",
    features: [
      "Everything in Starter",
      "Money hub (Expenses, Procurement, Financials, Planning)",
      "Talent hub (Reviews, Comp, Onboarding, Recruiting)",
      "AI Inbox triage + cross-module signals",
      "Slack + Google Workspace integrations",
      "Priority support · response < 4h",
    ],
    cta: "Start 14-day trial",
    href: "/register?plan=growth",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    sub: "100+ people",
    description: "For larger orgs with compliance, security, and customization needs.",
    features: [
      "Everything in Growth",
      "SCIM + SAML SSO",
      "Full audit log (SOC 2 ready)",
      "Studio: custom workflows + fields",
      "BYOK / on-prem AI option",
      "Dedicated CSM + SLA",
    ],
    cta: "Talk to sales",
    href: "/contact",
  },
];

// Comparison matrix — collapsed to the things buyers actually care
// about. No "✓ login screen ✓ logout button" noise.
interface MatrixRow {
  feature: string;
  starter: boolean | string;
  growth: boolean | string;
  enterprise: boolean | string;
}

const MATRIX: { section: string; rows: readonly MatrixRow[] }[] = [
  {
    section: "Core hubs",
    rows: [
      { feature: "Home (Dashboard + Inbox)", starter: true, growth: true, enterprise: true },
      { feature: "People (Profiles + Org chart)", starter: true, growth: true, enterprise: true },
      { feature: "Work (Tasks + OKRs + KPIs + SOPs)", starter: true, growth: true, enterprise: true },
      { feature: "Culture (Announcements + Kudos + Policies)", starter: true, growth: true, enterprise: true },
      { feature: "Money (Expenses + Procurement + Financials)", starter: false, growth: true, enterprise: true },
      { feature: "Talent (Reviews + Comp + Recruiting)", starter: false, growth: true, enterprise: true },
    ],
  },
  {
    section: "AI",
    rows: [
      { feature: "Cmd-K AI search (cross-module)", starter: true, growth: true, enterprise: true },
      { feature: "AI Inbox triage (per-row suggestions)", starter: false, growth: true, enterprise: true },
      { feature: "Cross-module anomaly signals", starter: false, growth: true, enterprise: true },
      { feature: "BYOK (your own Anthropic key)", starter: false, growth: false, enterprise: true },
    ],
  },
  {
    section: "Security + governance",
    rows: [
      { feature: "SSO via Google", starter: true, growth: true, enterprise: true },
      { feature: "SAML SSO", starter: false, growth: false, enterprise: true },
      { feature: "SCIM user provisioning", starter: false, growth: false, enterprise: true },
      { feature: "Audit log retention", starter: "30 days", growth: "1 year", enterprise: "Unlimited" },
      { feature: "GDPR org-delete + grace period", starter: true, growth: true, enterprise: true },
    ],
  },
  {
    section: "Platform extensibility",
    rows: [
      { feature: "Custom fields per entity", starter: false, growth: "Limited", enterprise: "Unlimited" },
      { feature: "Custom workflows (Studio)", starter: false, growth: false, enterprise: true },
      { feature: "Webhook subscriptions", starter: false, growth: "5", enterprise: "Unlimited" },
      { feature: "API rate limit", starter: "100/min", growth: "1k/min", enterprise: "Custom" },
    ],
  },
  {
    section: "Support",
    rows: [
      { feature: "Email support", starter: true, growth: true, enterprise: true },
      { feature: "Priority response (< 4h)", starter: false, growth: true, enterprise: true },
      { feature: "Dedicated CSM", starter: false, growth: false, enterprise: true },
      { feature: "SLA (99.9% uptime)", starter: false, growth: false, enterprise: true },
    ],
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check size={16} className="text-[color:var(--accent-strong)] mx-auto" />;
  if (value === false) return <Minus size={16} className="text-muted-2 mx-auto" />;
  return <span className="text-[12.5px] font-medium text-foreground">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingTopbar />

      {/* ── Header ───────────────────────────────────────────────── */}
      <section className="px-6 pt-20 pb-12 max-w-5xl mx-auto text-center">
        <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3">
          Pricing
        </p>
        <h1 className="text-5xl font-bold tracking-tight mb-5 leading-[1.1]">
          Free under five.<br />
          <span className="text-[color:var(--accent-strong)]">Honest above that.</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto leading-relaxed">
          One product replaces ~15 SaaS subscriptions. The math works out
          even before you hit Growth — at our prices, you save more than
          you spend by month one.
        </p>
      </section>

      {/* ── Tier cards ───────────────────────────────────────────── */}
      <section className="px-6 pb-20 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border p-6 transition-fast ${
                tier.highlighted
                  ? "border-[color:var(--accent)] bg-background shadow-[0_20px_50px_-20px_rgba(124,58,237,0.4)] ring-1 ring-[color:var(--accent)]/20"
                  : "border-border bg-background hover:border-muted-2/60"
              }`}
            >
              {tier.highlighted && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <span
                    className="text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full"
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-contrast)",
                    }}
                  >
                    Most popular
                  </span>
                </div>
              )}
              <h3 className="text-lg font-semibold mb-1">{tier.name}</h3>
              <p className="text-sm text-muted mb-5 leading-snug">{tier.description}</p>
              <div className="mb-5">
                <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
                {tier.price !== "Free" && tier.price !== "Custom" && (
                  <span className="text-sm text-muted ml-1.5">{tier.sub}</span>
                )}
                {(tier.price === "Free" || tier.price === "Custom") && (
                  <p className="text-sm text-muted mt-1">{tier.sub}</p>
                )}
              </div>
              <Link
                href={tier.href}
                className={`block text-center px-4 py-2.5 rounded-lg font-semibold text-sm mb-6 transition-fast ${
                  tier.highlighted
                    ? "bg-[color:var(--accent)] text-white hover:opacity-90"
                    : "border border-border hover:bg-surface"
                }`}
              >
                {tier.cta}
              </Link>
              <ul className="space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check size={14} className="text-[color:var(--accent-strong)] flex-shrink-0 mt-0.5" />
                    <span className="leading-snug">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Comparison matrix ───────────────────────────────────── */}
      <section className="px-6 pb-24 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold tracking-tight text-center mb-2">
          Compare side-by-side
        </h2>
        <p className="text-sm text-muted text-center mb-10">
          Just the things buyers actually care about. No filler.
        </p>

        <div className="rounded-2xl border border-border bg-surface/30 overflow-hidden">
          {/* Sticky tier headers */}
          <div className="grid grid-cols-[1.5fr_repeat(3,1fr)] gap-2 px-5 py-4 border-b border-border bg-surface/60 sticky top-0">
            <div></div>
            {TIERS.map((tier) => (
              <div key={tier.name} className="text-center">
                <p className="text-[11px] uppercase tracking-widest text-muted font-semibold">{tier.name}</p>
              </div>
            ))}
          </div>

          {MATRIX.map((section) => (
            <div key={section.section}>
              <div className="px-5 py-3 bg-surface/40 border-b border-border">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">{section.section}</p>
              </div>
              {section.rows.map((row, i) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-[1.5fr_repeat(3,1fr)] gap-2 px-5 py-3 items-center ${
                    i < section.rows.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <div className="text-[13px] text-foreground">{row.feature}</div>
                  <div className="text-center"><Cell value={row.starter} /></div>
                  <div className="text-center"><Cell value={row.growth} /></div>
                  <div className="text-center"><Cell value={row.enterprise} /></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────── */}
      <section className="px-6 py-24 border-t border-border text-center max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          Start free in under a minute.
        </h2>
        <p className="text-muted mb-8">
          No credit card. Cancel any time. Free under five people, forever.
        </p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg bg-[color:var(--accent)] text-white font-semibold hover:opacity-90 transition-fast"
        >
          Start free
          <ArrowRight size={16} />
        </Link>
      </section>

      <MarketingFooter />
    </div>
  );
}
