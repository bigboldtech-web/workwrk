// Pricing page — built from scratch alongside landing v4. Same visual
// language: confident large headlines, locked palette, generous spacing,
// premium tier cards, full comparison matrix, FAQ snippets for procurement.

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, Minus, Sparkles } from "lucide-react";
import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";

export const metadata: Metadata = {
  title: "Pricing — WorkwrK",
  description:
    "Free under five people. Honest above that. Three tiers — Starter, Growth, Enterprise. WorkwrK replaces 15+ tools so the math always works.",
  alternates: { canonical: "https://workwrk.com/pricing" },
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
    sub: "Up to 5 people · forever",
    description: "For founding teams and pilots. Every core hub. No time limit.",
    features: [
      "Home + People + Work + Culture hubs",
      "Inbox aggregating 12 streams",
      "Cmd-K AI search across every entity",
      "Tasks, OKRs, KPIs, SOPs, Process runs",
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
      "Money hub: Expenses, Procurement, Financials, Planning",
      "Talent hub: Reviews, Comp, Onboarding, Recruiting",
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
      "SAML SSO + SCIM provisioning",
      "Full audit log (SOC-2 Type II ready)",
      "Studio: custom workflows + fields",
      "BYOK / on-prem AI option",
      "Dedicated CSM + uptime SLA",
    ],
    cta: "Talk to sales",
    href: "/contact",
  },
];

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
      { feature: "Home (Dashboard + Inbox)",         starter: true, growth: true, enterprise: true },
      { feature: "People (Profiles + Org chart)",     starter: true, growth: true, enterprise: true },
      { feature: "Work (Tasks + OKRs + KPIs + SOPs)",  starter: true, growth: true, enterprise: true },
      { feature: "Culture (Announcements + Kudos)",   starter: true, growth: true, enterprise: true },
      { feature: "Money (Expenses → Financials)",     starter: false, growth: true, enterprise: true },
      { feature: "Talent (Reviews + Comp + Hiring)",  starter: false, growth: true, enterprise: true },
    ],
  },
  {
    section: "AI",
    rows: [
      { feature: "Cmd-K AI search",                   starter: true, growth: true, enterprise: true },
      { feature: "AI Inbox triage (per-row)",         starter: false, growth: true, enterprise: true },
      { feature: "Cross-module anomaly signals",      starter: false, growth: true, enterprise: true },
      { feature: "BYOK (your Anthropic key)",         starter: false, growth: false, enterprise: true },
    ],
  },
  {
    section: "Security + governance",
    rows: [
      { feature: "Google SSO",                        starter: true, growth: true, enterprise: true },
      { feature: "SAML SSO",                          starter: false, growth: false, enterprise: true },
      { feature: "SCIM provisioning",                 starter: false, growth: false, enterprise: true },
      { feature: "Audit log retention",               starter: "30 days", growth: "1 year", enterprise: "Unlimited" },
      { feature: "GDPR org-delete + grace period",    starter: true, growth: true, enterprise: true },
      { feature: "Region-locked storage",             starter: false, growth: false, enterprise: true },
    ],
  },
  {
    section: "Platform extensibility",
    rows: [
      { feature: "Custom fields per entity",          starter: false, growth: "Limited", enterprise: "Unlimited" },
      { feature: "Custom workflows (Studio)",         starter: false, growth: false, enterprise: true },
      { feature: "Webhook subscriptions",             starter: false, growth: "5", enterprise: "Unlimited" },
      { feature: "API rate limit",                    starter: "100/min", growth: "1k/min", enterprise: "Custom" },
    ],
  },
  {
    section: "Support",
    rows: [
      { feature: "Email support",                     starter: true, growth: true, enterprise: true },
      { feature: "Priority response (< 4h)",          starter: false, growth: true, enterprise: true },
      { feature: "Dedicated CSM",                     starter: false, growth: false, enterprise: true },
      { feature: "SLA (99.9% uptime)",                starter: false, growth: false, enterprise: true },
    ],
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true)  return <Check size={16} className="text-[color:var(--accent-strong)] mx-auto" />;
  if (value === false) return <Minus size={16} className="text-muted-2 mx-auto" />;
  return <span className="text-[12.5px] font-medium text-foreground">{value}</span>;
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "Do I need a credit card to start?",
    a: "No. Starter is free forever for teams up to 5 people. Growth is $8/user/month after a 14-day trial — credit card collected then, not now.",
  },
  {
    q: "What counts as a 'user'?",
    a: "Anyone with a sign-in account who is not in INACTIVE status. Removed people don't count. Admins, employees, contractors all count the same.",
  },
  {
    q: "Can I switch tiers mid-month?",
    a: "Yes. Upgrade is immediate, prorated to the day. Downgrade takes effect at the next billing cycle so you don't lose paid features mid-month.",
  },
  {
    q: "What happens if I exceed Starter's 5 people?",
    a: "We don't lock you out mid-week. You get a 14-day grace period to upgrade to Growth or remove users.",
  },
  {
    q: "Are there volume discounts?",
    a: "Yes — Growth tier auto-scales: 50+ users gets 10% off, 200+ gets 20% off. Enterprise pricing is fully custom and typically includes a multi-year discount.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <MarketingTopbar />

      {/* ── Header ───────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 pt-20 pb-14 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium px-3 h-7 rounded-full border border-border bg-surface mb-6">
          <Sparkles size={11} className="text-[color:var(--accent-strong)]" />
          Pricing
        </div>
        <h1 className="text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
          Free under five.<br />
          <span className="text-[color:var(--accent-strong)]">Honest above that.</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto leading-relaxed">
          One product replaces ~15 SaaS subscriptions. At our prices, you
          save more than you spend by the end of month one.
        </p>
      </section>

      {/* ── Tier cards ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 lg:px-10 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border p-7 transition-fast ${
                tier.highlighted
                  ? "border-[color:var(--accent)] bg-background shadow-[0_30px_60px_-20px_rgba(124,58,237,0.4)] ring-1 ring-[color:var(--accent)]/20"
                  : "border-border bg-background hover:border-muted-2/60"
              }`}
            >
              {tier.highlighted && (
                <span
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full"
                  style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
                >
                  Most popular
                </span>
              )}
              <h3 className="text-xl font-bold tracking-tight mb-1.5">{tier.name}</h3>
              <p className="text-sm text-muted mb-6 leading-snug">{tier.description}</p>
              <div className="mb-6">
                <span className="text-5xl font-bold tracking-tight">{tier.price}</span>
                {tier.price !== "Free" && tier.price !== "Custom" && (
                  <span className="text-sm text-muted ml-1.5">{tier.sub}</span>
                )}
                {(tier.price === "Free" || tier.price === "Custom") && (
                  <p className="text-sm text-muted mt-1">{tier.sub}</p>
                )}
              </div>
              <Link
                href={tier.href}
                className={`block text-center px-4 py-3 rounded-lg font-semibold text-sm mb-7 transition-fast ${
                  tier.highlighted
                    ? "bg-[color:var(--accent)] text-white hover:opacity-90 shadow-[0_8px_20px_-8px_rgba(124,58,237,0.5)]"
                    : "border border-border hover:bg-surface"
                }`}
              >
                {tier.cta}
              </Link>
              <ul className="space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
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
      <section className="border-t border-border bg-[color:var(--surface)]/40">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-24">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
              Compare side-by-side
            </p>
            <h2 className="text-3xl font-bold tracking-tight">
              Just the things buyers care about.
            </h2>
          </div>

          <div className="rounded-2xl border border-border bg-background overflow-hidden">
            <div className="grid grid-cols-[1.5fr_repeat(3,1fr)] gap-2 px-5 py-4 border-b border-border bg-[color:var(--surface-elevated)] sticky top-0 z-10">
              <div></div>
              {TIERS.map((tier) => (
                <div key={tier.name} className="text-center">
                  <p className="text-[11px] uppercase tracking-widest text-muted font-bold">{tier.name}</p>
                </div>
              ))}
            </div>

            {MATRIX.map((section) => (
              <div key={section.section}>
                <div className="px-5 py-3 bg-[color:var(--surface)]/40 border-b border-border">
                  <p className="text-xs font-bold text-muted uppercase tracking-wider">{section.section}</p>
                </div>
                {section.rows.map((row, i) => (
                  <div
                    key={row.feature}
                    className={`grid grid-cols-[1.5fr_repeat(3,1fr)] gap-2 px-5 py-3.5 items-center ${
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
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-center mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
            FAQ
          </p>
          <h2 className="text-3xl font-bold tracking-tight">
            About the bill.
          </h2>
        </div>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <details key={item.q} className="group rounded-xl border border-border bg-background overflow-hidden">
              <summary className="cursor-pointer px-5 py-4 flex items-center justify-between hover:bg-[color:var(--surface-elevated)] transition-fast list-none">
                <span className="text-[15px] font-semibold pr-4">{item.q}</span>
                <span className="text-muted-2 flex-shrink-0 group-open:rotate-90 transition-fast">›</span>
              </summary>
              <div className="px-5 pb-4 text-[14px] text-muted leading-relaxed">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-24 text-center">
          <h2 className="text-4xl font-bold tracking-tight mb-5">
            Start free in under a minute.
          </h2>
          <p className="text-muted mb-8">
            No credit card. Cancel any time. Free under five people, forever.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-7 h-12 rounded-xl bg-[color:var(--accent)] text-white font-semibold hover:opacity-90 transition-fast shadow-[0_8px_24px_-8px_rgba(124,58,237,0.5)]"
          >
            Start free
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
