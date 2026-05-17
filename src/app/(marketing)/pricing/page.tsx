// White-clean pricing page. Three tiers + Enterprise contact CTA.
// Mirrors the landing-v2 aesthetic — white surfaces, single dark
// CTA strip at the bottom, no dark bento chrome.

import Link from "next/link";
import type { Metadata } from "next";
import { Fragment } from "react";
import { ArrowRight, Check, X } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing — WorkWrk",
  description:
    "Simple, transparent pricing for teams of every size. Free forever for teams under 25. WorkWrk replaces 15+ tools so you save more than you spend.",
};

type Plan = {
  name: string;
  tagline: string;
  price: string;
  priceSuffix?: string;
  badge?: string;
  cta: string;
  ctaHref: string;
  highlight?: boolean;
  features: string[];
  notIncluded?: string[];
};

const PLANS: Plan[] = [
  {
    name: "Starter",
    tagline: "Everything to run a small team.",
    price: "Free",
    priceSuffix: "forever",
    cta: "Get started",
    ctaHref: "/signup",
    features: [
      "Up to 25 employees",
      "All core modules: People, Tasks, SOPs, OKRs, Reviews",
      "Inbox aggregating 12 work-streams",
      "Cmd-K palette + global search",
      "Expenses & Time off",
      "1 GB file storage",
      "18+ languages",
      "Email support",
    ],
    notIncluded: [
      "Procurement & Compensation cycles",
      "Recruiting & ATS",
      "SSO / SCIM",
      "Audit trail viewer",
    ],
  },
  {
    name: "Growth",
    tagline: "For teams scaling past 50.",
    price: "$8",
    priceSuffix: "/user/month",
    badge: "Most popular",
    highlight: true,
    cta: "Start 14-day trial",
    ctaHref: "/signup",
    features: [
      "Everything in Starter",
      "Unlimited employees",
      "Procurement (POs + Invoices + Vendors)",
      "Compensation cycles",
      "Recruiting + Interview scheduling",
      "Learning / LMS",
      "Workforce planning",
      "Worktags (cost-center / business-unit / region)",
      "Bulk approve across all queues",
      "CSV export across all modules",
      "100 GB file storage",
      "Priority support",
    ],
    notIncluded: [
      "SSO / SCIM",
      "Custom domains",
      "SLA",
    ],
  },
  {
    name: "Scale",
    tagline: "For Fortune-500 / 500K-employee orgs.",
    price: "$16",
    priceSuffix: "/user/month",
    cta: "Talk to sales",
    ctaHref: "/contact",
    features: [
      "Everything in Growth",
      "SAML SSO + SCIM 2.0 directory sync",
      "Audit trail viewer + field-level diffs",
      "Custom domains + white-label branding",
      "10-tier RBAC + permission matrix",
      "Field-level access controls",
      "Data residency options",
      "Dedicated CSM",
      "99.9% uptime SLA",
      "Unlimited storage",
      "24/7 support",
    ],
  },
];

type ComparisonRow = {
  feature: string;
  starter: boolean | string;
  growth: boolean | string;
  scale: boolean | string;
};

const COMPARISON: Array<{ section: string; rows: ComparisonRow[] }> = [
  {
    section: "Core HR & Performance",
    rows: [
      { feature: "People directory + org chart", starter: true, growth: true, scale: true },
      { feature: "OKRs + KRA/KPI engine", starter: true, growth: true, scale: true },
      { feature: "Performance reviews + 360 feedback", starter: true, growth: true, scale: true },
      { feature: "SOPs + compliance tracking", starter: true, growth: true, scale: true },
      { feature: "Tasks + Gantt + calendar sync", starter: true, growth: true, scale: true },
      { feature: "Onboarding workflows", starter: true, growth: true, scale: true },
    ],
  },
  {
    section: "Spend & Operations",
    rows: [
      { feature: "Expenses + approval flow", starter: true, growth: true, scale: true },
      { feature: "Time off + leave policies", starter: true, growth: true, scale: true },
      { feature: "Timesheets + clock punch", starter: true, growth: true, scale: true },
      { feature: "Compensation cycles", starter: false, growth: true, scale: true },
      { feature: "Procurement (POs + Invoices)", starter: false, growth: true, scale: true },
      { feature: "Vendor management", starter: false, growth: true, scale: true },
    ],
  },
  {
    section: "Talent",
    rows: [
      { feature: "Recruiting + ATS pipeline", starter: false, growth: true, scale: true },
      { feature: "Interview scheduling + scorecards", starter: false, growth: true, scale: true },
      { feature: "Learning / LMS", starter: false, growth: true, scale: true },
      { feature: "Workforce planning", starter: false, growth: true, scale: true },
    ],
  },
  {
    section: "Platform",
    rows: [
      { feature: "Inbox (12 work-streams)", starter: true, growth: true, scale: true },
      { feature: "Cmd-K palette", starter: true, growth: true, scale: true },
      { feature: "Worktags / dimensional tagging", starter: false, growth: true, scale: true },
      { feature: "AI agents + content generation", starter: true, growth: true, scale: true },
      { feature: "Bulk approve + CSV export", starter: false, growth: true, scale: true },
      { feature: "API + webhooks", starter: "Read only", growth: true, scale: true },
    ],
  },
  {
    section: "Enterprise",
    rows: [
      { feature: "SAML SSO", starter: false, growth: false, scale: true },
      { feature: "SCIM 2.0 directory sync", starter: false, growth: false, scale: true },
      { feature: "Audit trail viewer", starter: false, growth: false, scale: true },
      { feature: "Custom domains + white label", starter: false, growth: false, scale: true },
      { feature: "Field-level access controls", starter: false, growth: false, scale: true },
      { feature: "Data residency (EU / US / IN)", starter: false, growth: false, scale: true },
      { feature: "99.9% uptime SLA", starter: false, growth: false, scale: true },
      { feature: "Dedicated CSM", starter: false, growth: false, scale: true },
    ],
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Is Starter actually free forever?",
    a: "Yes. Up to 25 employees, all core HR + performance + tasks + SOPs + Inbox + Cmd-K, no credit card required. No surprise upgrade walls. We earn money when you grow past 25 people or want Procurement / Comp / Recruiting / SSO.",
  },
  {
    q: "Can I switch from Workday or BambooHR or Rippling?",
    a: "Yes. Importer ingests CSV exports from any HRIS. Most teams migrate in a weekend; the platform layout maps cleanly to people / departments / roles, and Worktags handle whatever cost-center scheme you had. We help with the migration on Growth and Scale tiers.",
  },
  {
    q: "Why is per-user pricing reasonable but Workday isn't?",
    a: "Workday is built for global enterprise sales motions — six-figure floors, 18-month implementations, dedicated implementation partners. We're built for self-serve. You spin up an org in a weekend, configure it through the admin UI, and the whole platform pays for itself by replacing 15 fragmented tools.",
  },
  {
    q: "Do you support Payroll and Benefits?",
    a: "Payroll integrates with CheckHQ (US), Razorpay Payroll (IN), and Sequoia (US benefits). We don't process payroll directly — that's a regulated, jurisdiction-specific space best served by specialists. Our employees + comp + time off data flows into them.",
  },
  {
    q: "What happens if I outgrow Growth?",
    a: "Scale unlocks SSO / SCIM / Audit / SLA — the things Fortune-500 IT requires before they sign. You can self-serve upgrade in Settings, no contract renegotiation. Most customers at ~250 employees move up.",
  },
];

export default function PricingPage() {
  return (
    <div className="bg-white text-slate-900">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 pt-20 pb-12 text-center">
        <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight">
          Simple pricing.{" "}
          <span className="text-slate-400">Every tool in one bill.</span>
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-base lg:text-lg text-slate-600">
          You're already paying for an HRIS, an ATS, a spend tool, a learning
          platform, and 11 spreadsheets. WorkWrk replaces all of it for less
          than what you pay for any one of them.
        </p>
      </section>

      {/* Plan cards */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 pb-24">
        <div className="grid lg:grid-cols-3 gap-6">
          {PLANS.map((p) => (
            <PlanCard key={p.name} plan={p} />
          ))}
        </div>
        <p className="text-center text-sm text-slate-500 mt-10">
          Prices in USD. INR / EUR / AED billed in local currency at sign-up.
          {" "}
          <Link href="/contact" className="text-slate-900 underline hover:no-underline">
            Need a custom contract?
          </Link>
        </p>
      </section>

      {/* Comparison table */}
      <section className="bg-slate-50/50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
              Compare every feature.
            </h2>
            <p className="mt-5 text-base lg:text-lg text-slate-600">
              No fine print. The Starter tier really does include the whole
              core platform — Growth and Scale add modules on top.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/40">
                  <th className="text-left text-xs font-semibold text-slate-500 px-6 py-3">
                    Feature
                  </th>
                  <th className="text-center text-xs font-semibold text-slate-700 px-6 py-3 w-32">
                    Starter
                  </th>
                  <th className="text-center text-xs font-semibold text-slate-900 px-6 py-3 w-32">
                    Growth
                  </th>
                  <th className="text-center text-xs font-semibold text-slate-700 px-6 py-3 w-32">
                    Scale
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((section, si) => (
                  <Fragment key={`section-${si}`}>
                    <tr className="bg-slate-50/40 border-y border-slate-100">
                      <td colSpan={4} className="px-6 py-2 text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500">
                        {section.section}
                      </td>
                    </tr>
                    {section.rows.map((row, ri) => (
                      <tr key={`row-${si}-${ri}`} className="border-b border-slate-100">
                        <td className="px-6 py-3 text-slate-700">{row.feature}</td>
                        <ComparisonCell value={row.starter} />
                        <ComparisonCell value={row.growth} highlight />
                        <ComparisonCell value={row.scale} />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 lg:px-10 py-24">
        <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight text-center">
          Questions, answered.
        </h2>
        <div className="mt-12 space-y-2">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-slate-200 bg-white open:bg-slate-50/50 transition-colors"
            >
              <summary className="cursor-pointer list-none px-6 py-4 flex items-center justify-between">
                <span className="font-medium text-slate-900">{item.q}</span>
                <span className="text-slate-400 group-open:rotate-45 transition-transform text-2xl leading-none">
                  +
                </span>
              </summary>
              <div className="px-6 pb-5 text-slate-600">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-24 lg:py-32 text-center">
          <h2 className="text-4xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
            Start free.
            <br />
            <span className="text-slate-400">Upgrade when you need to.</span>
          </h2>
          <p className="mt-6 max-w-2xl mx-auto text-base lg:text-lg text-slate-300">
            No demo gating. No "talk to sales" walls on Starter or Growth.
            Self-serve in 7 days, not 7 months.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl bg-white text-slate-900 font-medium hover:bg-slate-100 transition-colors"
            >
              Get started — it's free
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl border border-slate-700 text-white font-medium hover:bg-slate-800 transition-colors"
            >
              Talk to sales
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={`relative rounded-2xl p-8 ${
        plan.highlight
          ? "bg-slate-900 text-white border border-slate-900 shadow-2xl shadow-slate-300/40"
          : "bg-white border border-slate-200"
      }`}
    >
      {plan.badge && (
        <span
          className={`absolute -top-3 right-6 px-3 h-6 inline-flex items-center text-[11px] font-semibold rounded-full ${
            plan.highlight ? "bg-[#d4ff2e] text-slate-900" : "bg-slate-900 text-white"
          }`}
        >
          {plan.badge}
        </span>
      )}
      <h3 className={`text-lg font-semibold ${plan.highlight ? "text-white" : "text-slate-900"}`}>
        {plan.name}
      </h3>
      <p className={`text-sm mt-1 ${plan.highlight ? "text-slate-300" : "text-slate-500"}`}>
        {plan.tagline}
      </p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className={`text-5xl font-semibold ${plan.highlight ? "text-white" : "text-slate-900"}`}>
          {plan.price}
        </span>
        {plan.priceSuffix && (
          <span className={`text-sm ${plan.highlight ? "text-slate-400" : "text-slate-500"}`}>
            {plan.priceSuffix}
          </span>
        )}
      </div>

      <Link
        href={plan.ctaHref}
        className={`mt-6 inline-flex items-center justify-center w-full h-11 rounded-lg font-medium transition-colors ${
          plan.highlight
            ? "bg-[#d4ff2e] text-slate-900 hover:bg-[#c5ee20]"
            : "bg-slate-900 text-white hover:bg-slate-800"
        }`}
      >
        {plan.cta}
      </Link>

      <ul className={`mt-8 space-y-2.5 text-sm ${plan.highlight ? "text-slate-200" : "text-slate-700"}`}>
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check
              size={16}
              className={`flex-shrink-0 mt-0.5 ${plan.highlight ? "text-[#d4ff2e]" : "text-emerald-600"}`}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {plan.notIncluded && plan.notIncluded.length > 0 && (
        <ul className={`mt-4 pt-4 border-t space-y-2 text-sm ${plan.highlight ? "border-slate-700 text-slate-500" : "border-slate-100 text-slate-400"}`}>
          {plan.notIncluded.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <X size={16} className="flex-shrink-0 mt-0.5 opacity-60" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ComparisonCell({ value, highlight }: { value: boolean | string; highlight?: boolean }) {
  return (
    <td
      className={`text-center px-6 py-3 ${
        highlight ? "bg-slate-50/40" : ""
      }`}
    >
      {typeof value === "string" ? (
        <span className="text-xs text-slate-500">{value}</span>
      ) : value ? (
        <Check size={16} className="text-emerald-600 inline" />
      ) : (
        <span className="text-slate-300 text-sm">—</span>
      )}
    </td>
  );
}
