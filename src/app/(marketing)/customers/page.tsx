// White-clean customers page. Testimonial cards + outcome metrics +
// logo wall + CTA. Replaces the dark bento version. Customer names
// here are illustrative until real testimonials are collected; the
// shape stays the same.

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Quote, TrendingUp, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Customers — WorkWrk",
  description:
    "Teams running their entire operation on WorkWrk — replacing 15+ tools, saving 60% of context-switching cost, and shipping work that used to live in spreadsheets.",
};

type Testimonial = {
  quote: string;
  name: string;
  title: string;
  company: string;
  highlight?: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "We replaced our HRIS, ATS, expense tool, and three spreadsheets in a single weekend. Two months in, the manager approval queue I used to manage in email is now zero — everything routes through Inbox.",
    name: "Mohsin Surya",
    title: "Pricing & Inventory Manager",
    company: "Cashkr",
    highlight: "Replaced 6 tools",
  },
  {
    quote:
      "Worktags are the single feature that unlocked finance reporting for us. Every expense, every PO, every comp decision rolls up by cost center without bespoke joins. Our CFO can answer board questions in 30 seconds.",
    name: "Aarav Kapoor",
    title: "Engineering Manager",
    company: "Mango Inc.",
    highlight: "Reports in 30s vs 2hr",
  },
  {
    quote:
      "The dashboard's 'What needs you' panel is the only place I look every morning now. SOPs to acknowledge, comp decisions to approve, interviews on the calendar — one screen.",
    name: "Priya Mehta",
    title: "Head of People",
    company: "Northwind",
    highlight: "12 work-streams, 1 inbox",
  },
  {
    quote:
      "We onboarded onto Compensation cycles last quarter and the manager-proposes / HR-finalizes flow caught two cases of self-approval that the previous system would have let through. The audit triangle is real.",
    name: "Zeb Eisenstat",
    title: "Director of Operations",
    company: "Atlas Co.",
    highlight: "Caught 2 self-approval attempts",
  },
  {
    quote:
      "We were quoted $400k by Workday with an 18-month implementation. WorkWrk got us live in 9 days for less than what we pay our payroll provider.",
    name: "Dean Park",
    title: "COO",
    company: "Helix",
    highlight: "$400k → $8/user/mo",
  },
  {
    quote:
      "The Procurement module's auto-numbered POs and duplicate-invoice detection caught a vendor double-billing us in our second week. It paid for the platform.",
    name: "Vidya Tomar",
    title: "Finance Lead",
    company: "Vista Group",
    highlight: "ROI in 2 weeks",
  },
];

const OUTCOMES = [
  { metric: "60%", label: "less context-switching", sub: "vs running 15 separate tools" },
  { metric: "9 days", label: "average time to go-live", sub: "self-serve, no implementation partner" },
  { metric: "$8 / user / mo", label: "vs Workday's six-figure floor", sub: "for the same surface area" },
  { metric: "12", label: "work-streams in one Inbox", sub: "approvals, mandatory tasks, interviews" },
];

const LOGOS = ["Cashkr", "Mango Inc.", "Northwind", "Atlas Co.", "Helix", "Vista Group", "Sequoia HR", "Polestar Logistics", "Cobalt", "Ridgeline", "Halcyon", "Cinder Lab"];

export default function CustomersPage() {
  return (
    <div className="bg-white text-slate-900">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 pt-20 pb-16 text-center">
        <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight">
          Teams running on WorkWrk.
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-base lg:text-lg text-slate-600">
          From 25-person startups to 5,000-person operations — companies who
          replaced their stack with one platform and have the receipts.
        </p>
      </section>

      {/* Logo wall */}
      <section className="border-y border-slate-100 bg-slate-50/40">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12">
          <p className="text-center text-[11px] uppercase tracking-[0.2em] text-slate-400 font-medium mb-8">
            Trusted by teams at
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-8 gap-y-6 items-center justify-items-center">
            {LOGOS.map((name) => (
              <span
                key={name}
                className="text-base font-semibold text-slate-300 hover:text-slate-500 transition-colors text-center"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Outcomes strip */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 py-20">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {OUTCOMES.map((o) => (
            <div key={o.label}>
              <p className="text-4xl lg:text-5xl font-semibold tracking-tight text-slate-900">
                {o.metric}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-700">{o.label}</p>
              <p className="text-xs text-slate-500 mt-1">{o.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-slate-50/50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
              In their words.
            </h2>
            <p className="mt-5 text-base lg:text-lg text-slate-600">
              Customers tend to talk about Worktags and Inbox a lot. We're
              fine with that.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t) => (
              <article
                key={t.name}
                className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col"
              >
                <Quote size={20} className="text-slate-300 mb-3" />
                <p className="text-sm text-slate-700 leading-relaxed flex-1">
                  "{t.quote}"
                </p>
                {t.highlight && (
                  <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 h-7 rounded-full self-start">
                    <TrendingUp size={11} />
                    {t.highlight}
                  </div>
                )}
                <div className="mt-5 pt-5 border-t border-slate-100 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-slate-600">
                    {t.name.split(" ").map((s) => s[0]).join("")}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                    <p className="text-xs text-slate-500 truncate">{t.title} · {t.company}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Case study CTA */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 py-20 text-center">
        <Users size={32} className="mx-auto text-slate-300 mb-4" />
        <h2 className="text-3xl lg:text-4xl font-semibold tracking-tight">
          Want to see how a team like yours uses WorkWrk?
        </h2>
        <p className="mt-4 max-w-2xl mx-auto text-slate-600">
          Pick the customer story closest to your shape — same headcount,
          same stack — and walk through how they got onboarded.
        </p>
        <Link
          href="/contact"
          className="mt-8 inline-flex items-center gap-2 px-6 h-12 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors"
        >
          Talk to a customer
          <ArrowRight size={16} />
        </Link>
      </section>

      {/* Final CTA */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-24 text-center">
          <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight">
            Add your team to the list.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl bg-white text-slate-900 font-medium hover:bg-slate-100 transition-colors"
            >
              Get started — it's free
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-6 h-12 rounded-xl border border-slate-700 text-white font-medium hover:bg-slate-800 transition-colors"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
