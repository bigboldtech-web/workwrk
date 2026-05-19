import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  Minus,
  Sparkles,
  Shield,
  Zap,
  Building2,
} from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  H3,
  Lede,
  Button,
  CTABand,
  FAQ,
  GradientText,
  CheckList,
  HUES,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Pricing — WorkwrK",
  description:
    "Free under five people. $8/user thereafter. Three tiers — Starter, Growth, Scale. WorkwrK replaces 15+ tools so the math always works.",
  alternates: { canonical: "https://workwrk.com/pricing" },
};

const TIERS = [
  {
    name: "Starter",
    price: "Free",
    sub: "Up to 5 people · forever",
    description: "For founding teams and pilots. Every core hub. No time limit.",
    hue: "indigo" as const,
    icon: Sparkles,
    features: [
      "All 7 hubs unlocked",
      "Inbox aggregating 12 streams",
      "Cmd-K AI search across every entity",
      "Tasks, OKRs, KPIs, SOPs, processes",
      "Announcements, kudos, ideas, surveys",
      "Email support · 24h",
    ],
    cta: { label: "Start free", href: "/signup" },
  },
  {
    name: "Growth",
    price: "$8",
    priceSuffix: "/user/mo",
    sub: "14-day trial · no credit card",
    description: "Everything most SMB → mid-market companies actually need.",
    hue: "fuchsia" as const,
    icon: Zap,
    featured: true,
    features: [
      "Everything in Starter",
      "Money + Talent + Growth hubs",
      "AI Inbox triage + cross-module signals",
      "Slack + Google Workspace + Microsoft 365",
      "Custom KPI weights + composite scores",
      "Priority support · 4h SLA",
    ],
    cta: { label: "Start 14-day trial", href: "/signup?plan=growth" },
  },
  {
    name: "Scale",
    price: "Custom",
    sub: "From $29,999 / year",
    description: "For 250+ seat operators who need controls, SLAs, and a CSM.",
    hue: "emerald" as const,
    icon: Building2,
    features: [
      "Everything in Growth",
      "Unlimited AI usage",
      "SSO (SAML) + SCIM provisioning",
      "Audit log + retention controls",
      "Custom integrations + API quota",
      "Dedicated CSM · 1h SLA · 99.95% uptime",
    ],
    cta: { label: "Talk to sales", href: "/demo" },
  },
];

const COMPARE_GROUPS = [
  {
    name: "Core hubs",
    rows: [
      ["Home (inbox + Cmd-K)", true, true, true],
      ["People (org + performance)", true, true, true],
      ["Work (tasks + OKRs + KPIs + SOPs)", true, true, true],
      ["Culture (kudos + ideas + surveys)", true, true, true],
      ["Money (spend + procurement + financials)", false, true, true],
      ["Talent (reviews + comp + onboarding)", false, true, true],
      ["Growth (pipeline + customers)", false, true, true],
    ],
  },
  {
    name: "AI & intelligence",
    rows: [
      ["Cmd-K AI search", true, true, true],
      ["Inbox AI triage", false, true, true],
      ["Cross-module signals & alerts", false, true, true],
      ["AI promotion / comp recommendations", false, false, true],
      ["Unlimited AI usage", false, "Capped", true],
    ],
  },
  {
    name: "Integrations",
    rows: [
      ["Slack + Google Workspace", false, true, true],
      ["Microsoft 365 + Teams", false, true, true],
      ["Zapier / webhook events", false, true, true],
      ["Custom integrations + API quota", false, false, true],
    ],
  },
  {
    name: "Admin & security",
    rows: [
      ["SSO via Google / Microsoft", true, true, true],
      ["SAML SSO + SCIM provisioning", false, false, true],
      ["Audit log & retention controls", false, false, true],
      ["EU / India data residency", false, false, true],
      ["99.95% uptime SLA", false, false, true],
    ],
  },
  {
    name: "Support",
    rows: [
      ["Email support · 24h", true, true, true],
      ["Priority chat · 4h SLA", false, true, true],
      ["Dedicated CSM · 1h SLA", false, false, true],
    ],
  },
];

export default function PricingPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-2xl mx-auto text-center">
            <Eyebrow hue="emerald" className="mb-5">Pricing</Eyebrow>
            <H1>
              Honest pricing. <br />
              <GradientText hue="emerald">The math always works.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed">
              Free forever under five people. $8/user thereafter. No per-module
              surcharges, no surprise tiers, no quote-only marketing nonsense.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-5">
            {TIERS.map((tier) => {
              const t = HUES[tier.hue];
              return (
                <div
                  key={tier.name}
                  className={`relative rounded-2xl p-7 bg-white border ${
                    tier.featured
                      ? "border-slate-900 shadow-[0_18px_50px_-20px_rgba(15,23,42,0.25)]"
                      : "border-slate-200"
                  }`}
                >
                  {tier.featured && (
                    <span className="absolute -top-3 left-7 inline-flex items-center text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 h-6 rounded-full bg-slate-900 text-white">
                      Most chosen
                    </span>
                  )}
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.bgTint} ${t.text}`}
                    >
                      <tier.icon size={18} strokeWidth={2.2} />
                    </span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-700">
                        {tier.name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{tier.sub}</p>
                    </div>
                  </div>
                  <p className="mt-5 flex items-baseline gap-1.5">
                    <span className="text-5xl font-bold text-slate-900 tracking-tight">
                      {tier.price}
                    </span>
                    {tier.priceSuffix && (
                      <span className="text-sm text-slate-500 font-medium">{tier.priceSuffix}</span>
                    )}
                  </p>
                  <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">{tier.description}</p>
                  <Link
                    href={tier.cta.href}
                    className={`mt-6 inline-flex items-center justify-center gap-1.5 w-full h-11 rounded-full font-semibold text-sm transition-colors ${
                      tier.featured
                        ? "bg-slate-900 text-white hover:bg-slate-800"
                        : "bg-white border border-slate-200 text-slate-900 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {tier.cta.label} <ArrowRight size={14} />
                  </Link>
                  <CheckList hue={tier.hue} items={tier.features} className="mt-7" />
                </div>
              );
            })}
          </div>

          <p className="mt-10 text-center text-sm text-slate-500">
            All plans include unlimited storage, 99.9% uptime, daily backups, and email support.
          </p>
        </Container>
      </Section>

      {/* Comparison table */}
      <Section variant="tint" py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="violet" className="mb-4">Compare plans</Eyebrow>
            <H2>The full plan comparison.</H2>
            <p className="mt-4 text-slate-600">Every capability, side by side.</p>
          </div>

          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-4 font-bold text-slate-900 w-2/5">Feature</th>
                  {TIERS.map((t) => (
                    <th key={t.name} className="text-center p-4">
                      <span className={`block text-xs font-bold uppercase tracking-[0.16em] ${HUES[t.hue].text}`}>
                        {t.name}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">{t.price}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_GROUPS.flatMap((group) => [
                  <tr key={`g-${group.name}`}>
                    <td colSpan={4} className="pt-8 pb-3 px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      {group.name}
                    </td>
                  </tr>,
                  ...group.rows.map(([label, ...vals]) => (
                    <tr key={`${group.name}-${String(label)}`} className="border-b border-slate-100">
                      <td className="p-4 text-slate-700">{label}</td>
                      {vals.map((v, i) => (
                        <td key={i} className="p-4 text-center">
                          {v === true ? (
                            <Check size={16} className="inline text-emerald-600" />
                          ) : v === false ? (
                            <Minus size={16} className="inline text-slate-300" />
                          ) : (
                            <span className="text-xs text-slate-600">{v as string}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {/* Add-ons */}
      <Section py="md">
        <Container>
          <div className="grid lg:grid-cols-[1fr_2fr] gap-10 items-start">
            <div>
              <Eyebrow hue="amber" className="mb-4">Add-ons</Eyebrow>
              <H3>Optional, when you need them.</H3>
              <p className="mt-4 text-slate-600 text-sm">
                Most teams never need these. They&apos;re available a-la-carte
                for the edge cases — and they never gate the core product.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <AddonCard hue="violet"  title="Implementation help"     price="$3,500 / one-time" body="Two-week white-glove rollout with a workwrk solutions architect."/>
              <AddonCard hue="emerald" title="Custom integration"      price="$7,500 / connector" body="We build a connector to your internal/legacy system you can't get off."/>
              <AddonCard hue="sky"     title="On-prem / VPC deployment" price="From $50k / yr"     body="Run workwrk inside your own AWS / GCP. Available on Scale only."/>
              <AddonCard hue="fuchsia" title="Premium support · 1h"     price="$2,500 / mo"        body="Globally-distributed 24×7 chat with a named pod of three engineers."/>
            </div>
          </div>
        </Container>
      </Section>

      {/* FAQ */}
      <FAQ
        hue="emerald"
        eyebrow="Pricing FAQ"
        title="Common pricing questions."
        items={[
          { q: "Is the free plan really forever?",            a: "Yes. Up to five people, all 7 hubs unlocked, no time limit. We don't believe in 14-day clocks that pressure you into paying before you've decided. About 40% of our paid customers spent 6+ months on free." },
          { q: "How does per-user billing work?",              a: "Monthly or annual (annual saves 18%). New seats are pro-rated on the day they're added. Deactivated seats free up immediately and credit to your next invoice. There's no annual-commitment trap." },
          { q: "Do you charge for guests or read-only users?", a: "No. Guests, contractors with view-only roles, and external auditors are free. We only charge for full members who can create or edit." },
          { q: "What payment methods do you accept?",          a: "All major cards (Stripe), ACH/SEPA bank transfers on annual, wire transfers for Scale plans, and INR via Razorpay for Indian customers." },
          { q: "Can I get a discount?",                        a: "Annual billing saves 18%. We have NGO / nonprofit / education discounts (40% off) — email hello@workwrk.com with your details. We don't do 'first 100 customers' or other artificial scarcity." },
          { q: "What about a free trial of Scale?",            a: "Scale includes a 30-day pilot with implementation help included. Talk to sales to set it up." },
        ]}
      />

      <CTABand
        title={<>Free to start. <GradientText hue="emerald">Honest to grow.</GradientText></>}
        body="No credit card. No demo gate. No quote-only games. Just sign up."
        hue="emerald"
      />
    </>
  );
}

function AddonCard({
  hue,
  title,
  price,
  body,
}: {
  hue: keyof typeof HUES;
  title: string;
  price: string;
  body: string;
}) {
  const t = HUES[hue];
  return (
    <div className="p-5 bg-white border border-slate-200 rounded-2xl">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-slate-900 text-sm">{title}</p>
        <span className={`text-xs font-bold ${t.text}`}>{price}</span>
      </div>
      <p className="mt-2 text-xs text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}
