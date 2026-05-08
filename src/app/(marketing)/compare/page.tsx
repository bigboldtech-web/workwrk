// White-clean compare page. Side-by-side vs Workday / BambooHR /
// Rippling, with honest caveats. Strategy is segment-clarity, not
// FUD — we genuinely lose to Workday on regulated payroll and to
// Rippling on global EOR; we say so.

import Link from "next/link";
import type { Metadata } from "next";
import { Fragment } from "react";
import { ArrowRight, Check, Minus, X } from "lucide-react";

export const metadata: Metadata = {
  title: "Compare WorkWrk vs Workday, BambooHR, Rippling — WorkWrk",
  description:
    "Honest, line-by-line comparison of WorkWrk vs Workday, BambooHR, and Rippling. Where we win, where we don't, and which competitor is right for which segment.",
};

type Cell = boolean | "partial" | string;
type Row = { feature: string; workwrk: Cell; workday: Cell; bamboo: Cell; rippling: Cell; note?: string };

const ROWS: Array<{ section: string; rows: Row[] }> = [
  {
    section: "Pricing & onboarding",
    rows: [
      { feature: "Free tier", workwrk: "Up to 25 users", workday: false, bamboo: false, rippling: false },
      { feature: "Time to go live", workwrk: "9 days median", workday: "12–18 months", bamboo: "2–4 weeks", rippling: "1–3 weeks" },
      { feature: "Self-serve setup", workwrk: true, workday: false, bamboo: true, rippling: "partial" },
      { feature: "Per-user price (mid-market)", workwrk: "$8/mo", workday: "$50–120/mo", bamboo: "$8–15/mo", rippling: "$12–35/mo" },
      { feature: "Implementation partner required", workwrk: false, workday: true, bamboo: false, rippling: false },
    ],
  },
  {
    section: "Core HR",
    rows: [
      { feature: "People + org chart", workwrk: true, workday: true, bamboo: true, rippling: true },
      { feature: "Onboarding workflows", workwrk: true, workday: true, bamboo: true, rippling: true },
      { feature: "Custom RBAC tiers", workwrk: "10 tiers + matrix", workday: "Unlimited", bamboo: "5 roles", rippling: "Unlimited" },
      { feature: "Multi-country payroll", workwrk: "via partners", workday: true, bamboo: false, rippling: true },
      { feature: "Global EOR / contractors", workwrk: false, workday: "partial", bamboo: false, rippling: true, note: "Rippling wins here" },
    ],
  },
  {
    section: "Performance & process",
    rows: [
      { feature: "OKRs + check-ins", workwrk: true, workday: true, bamboo: false, rippling: false },
      { feature: "Performance reviews + 360", workwrk: true, workday: true, bamboo: true, rippling: "partial" },
      { feature: "SOPs with versioning", workwrk: true, workday: false, bamboo: false, rippling: false, note: "Unique to WorkWrk" },
      { feature: "Process compliance tracking", workwrk: true, workday: "partial", bamboo: false, rippling: false },
      { feature: "AI content generation", workwrk: true, workday: "partial (Illuminate)", bamboo: false, rippling: false },
    ],
  },
  {
    section: "Spend & procurement",
    rows: [
      { feature: "Expenses module", workwrk: true, workday: true, bamboo: false, rippling: true },
      { feature: "Compensation cycles", workwrk: true, workday: true, bamboo: "partial", rippling: "partial" },
      { feature: "Procurement (PO + Invoice)", workwrk: true, workday: true, bamboo: false, rippling: false },
      { feature: "Worktags / dimensional tagging", workwrk: true, workday: true, bamboo: false, rippling: false },
      { feature: "Time off + timesheets", workwrk: true, workday: true, bamboo: true, rippling: true },
    ],
  },
  {
    section: "Talent",
    rows: [
      { feature: "Recruiting / ATS", workwrk: true, workday: true, bamboo: true, rippling: false },
      { feature: "Interview scheduling", workwrk: true, workday: true, bamboo: true, rippling: false },
      { feature: "Learning / LMS", workwrk: true, workday: true, bamboo: false, rippling: false },
      { feature: "Workforce planning", workwrk: true, workday: true, bamboo: false, rippling: false },
    ],
  },
  {
    section: "Platform",
    rows: [
      { feature: "Unified Inbox (cross-module approvals)", workwrk: "12 work-streams", workday: "partial (My Tasks)", bamboo: false, rippling: false, note: "WorkWrk's #1 daily-use surface" },
      { feature: "Cmd-K global search", workwrk: true, workday: true, bamboo: false, rippling: "partial" },
      { feature: "Bulk approve across queues", workwrk: true, workday: true, bamboo: "partial", rippling: "partial" },
      { feature: "CSV export everywhere", workwrk: true, workday: true, bamboo: true, rippling: true },
      { feature: "Public API + webhooks", workwrk: true, workday: true, bamboo: "partial", rippling: true },
    ],
  },
  {
    section: "Enterprise",
    rows: [
      { feature: "SAML SSO + SCIM 2.0", workwrk: "Scale tier", workday: true, bamboo: "Advantage tier", rippling: true },
      { feature: "Field-level audit trail", workwrk: "Scale tier", workday: true, bamboo: "partial", rippling: "partial" },
      { feature: "Custom domains + white label", workwrk: "Scale tier", workday: false, bamboo: false, rippling: false },
      { feature: "Data residency (EU / US / IN)", workwrk: "Scale tier", workday: true, bamboo: "partial", rippling: "partial" },
    ],
  },
];

const HONEST = [
  {
    when: "Pick Workday if",
    why: "You're 5,000+ employees with a global payroll footprint and a six-figure budget for an 18-month implementation. Workday's GL + Adaptive Planning + global payroll surface area is genuinely deeper than ours — they've built it for two decades.",
  },
  {
    when: "Pick Rippling if",
    why: "You need a global EOR / international contractor management platform. Their hire-anywhere infrastructure is unmatched, and their device management for IT is a real differentiator. We don't compete on EOR.",
  },
  {
    when: "Pick BambooHR if",
    why: "You're under 100 employees, you only need core HR + time off + onboarding, and you don't care about OKRs / SOPs / Procurement / Cmd-K. BambooHR is simpler than us at the very low end.",
  },
  {
    when: "Pick WorkWrk if",
    why: "You're 50–500 people, outgrew BambooHR-shaped tools, can't justify Workday's price floor, and want one platform that covers HR + Performance + Spend + Procurement + Recruiting + Learning with AI agents and Worktag-driven reporting baked in.",
  },
];

export default function ComparePage() {
  return (
    <div className="bg-white text-slate-900">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 pt-20 pb-12 text-center">
        <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight">
          Honest comparison.{" "}
          <span className="text-slate-400">Pick the right tool.</span>
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-base lg:text-lg text-slate-600">
          We genuinely lose on a few things — global EOR, full Adaptive Planning,
          deep multi-country payroll. We say so up front instead of pretending
          otherwise. Here's where each platform actually wins.
        </p>
      </section>

      {/* Comparison table */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 pb-24">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/40 text-xs font-semibold">
                <th className="text-left text-slate-500 px-4 sm:px-6 py-4 sticky left-0 bg-slate-50/40">
                  Feature
                </th>
                <th className="text-center text-slate-900 px-3 sm:px-6 py-4 w-32 sm:w-36 bg-emerald-50/40 border-l border-slate-200">
                  WorkWrk
                </th>
                <th className="text-center text-slate-700 px-3 sm:px-6 py-4 w-32 sm:w-36 border-l border-slate-200">
                  Workday
                </th>
                <th className="text-center text-slate-700 px-3 sm:px-6 py-4 w-32 sm:w-36 border-l border-slate-200">
                  BambooHR
                </th>
                <th className="text-center text-slate-700 px-3 sm:px-6 py-4 w-32 sm:w-36 border-l border-slate-200">
                  Rippling
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((section, si) => (
                <Fragment key={`section-${si}`}>
                  <tr className="bg-slate-50/40 border-y border-slate-100">
                    <td colSpan={5} className="px-4 sm:px-6 py-2 text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500">
                      {section.section}
                    </td>
                  </tr>
                  {section.rows.map((row, ri) => (
                    <tr key={`row-${si}-${ri}`} className="border-b border-slate-100 hover:bg-slate-50/30">
                      <td className="px-4 sm:px-6 py-3.5 text-slate-700 sticky left-0 bg-white">
                        <div>{row.feature}</div>
                        {row.note && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{row.note}</div>
                        )}
                      </td>
                      <CompareCell value={row.workwrk} highlight />
                      <CompareCell value={row.workday} />
                      <CompareCell value={row.bamboo} />
                      <CompareCell value={row.rippling} />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Honest "pick X if" cards */}
      <section className="bg-slate-50/50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
              Which tool's actually right for you.
            </h2>
            <p className="mt-5 text-base lg:text-lg text-slate-600">
              Segment honesty over salesmanship. The right tool depends on
              your size, geography, and which problems matter most.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {HONEST.map((card, i) => (
              <div
                key={card.when}
                className={`rounded-xl border p-6 ${
                  i === 3
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white border-slate-200"
                }`}
              >
                <p className={`text-xs uppercase tracking-[0.18em] font-semibold mb-3 ${
                  i === 3 ? "text-slate-400" : "text-slate-500"
                }`}>
                  {card.when}
                </p>
                <p className={`text-sm leading-relaxed ${i === 3 ? "text-slate-200" : "text-slate-700"}`}>
                  {card.why}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-24 text-center">
          <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
            Try the one that actually fits.
          </h2>
          <p className="mt-5 text-slate-300 max-w-xl mx-auto">
            Start free, no credit card. Self-migrate from your current tool in
            a weekend.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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

function CompareCell({ value, highlight }: { value: Cell; highlight?: boolean }) {
  return (
    <td
      className={`text-center px-3 sm:px-6 py-3.5 border-l border-slate-100 ${
        highlight ? "bg-emerald-50/30" : ""
      }`}
    >
      {typeof value === "string" ? (
        <span className="text-xs font-medium text-slate-700">{value}</span>
      ) : value === true ? (
        <Check size={16} className="text-emerald-600 inline" />
      ) : value === "partial" ? (
        <Minus size={16} className="text-amber-500 inline" />
      ) : (
        <X size={16} className="text-slate-300 inline" />
      )}
    </td>
  );
}
