// About page — rebuilt to match landing v4 aesthetic.
// Confident narrative, four values, four-year timeline, team strip,
// final CTA. No bento/CountUp imports — pure static.

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Sparkles } from "lucide-react";
import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";

export const metadata: Metadata = {
  title: "About WorkwrK — built by operators, not consultants",
  description:
    "WorkwrK was built inside a real 100-person operation that got tired of stitching 15 SaaS tools together. We ship the product we wish we had.",
  alternates: { canonical: "https://workwrk.com/about" },
};

const VALUES: { title: string; body: string }[] = [
  {
    title: "Operators built this, not consultants.",
    body: "Every module was battle-tested inside a real hundred-person operation before it shipped. If it didn't survive our own team, it didn't ship.",
  },
  {
    title: "Data over vibes.",
    body: "Composite scores exist so promotions stop being arguments. Forty-eight-hour review cycles exist because two-week reviews are theatre.",
  },
  {
    title: "Global pricing, local invoicing.",
    body: "INR, USD, AED, SGD, EUR — priced in your currency with compliant local invoicing. GST, VAT, and reverse-charge handled.",
  },
  {
    title: "Private by default.",
    body: "Your data never trains anyone's model. Region-locked storage. Field-level RBAC, audit logs for every read and write. SOC-2 Type II in progress.",
  },
];

const MILESTONES: { year: string; title: string; body: string }[] = [
  { year: "2024", title: "Founded",            body: "Built inside BigBoldTech while running a 100-person operation. Stopped stitching SaaS and started building." },
  { year: "2025", title: "First customers",    body: "Landed across sales, logistics, finance, and healthcare. Median onboarding: under an hour." },
  { year: "2026", title: "AI engine + IA revamp", body: "Claude-powered reasoning across seven hubs. Cmd-K AI search, Inbox triage, cross-module anomalies." },
  { year: "2027", title: "Scale + on-prem",    body: "SOC-2 Type II, multi-entity consolidation, on-prem deployment for regulated industries." },
];

const PRINCIPLES: { eyebrow: string; title: string; body: string }[] = [
  {
    eyebrow: "Ship the boring stuff",
    title: "Audit logs, RBAC, exports.",
    body: "Every mutation logs an actor + target + old value + new value. Tenant export is one button. GDPR org-delete has a 30-day grace. The unglamorous infrastructure is the actual product.",
  },
  {
    eyebrow: "One promise per surface",
    title: "Inbox shows what needs you.",
    body: "Not what's interesting. Not what's recent. Not what an algorithm decided. The one question the Inbox answers is: 'what needs me?' Every other module is similarly opinionated.",
  },
  {
    eyebrow: "AI that knows your company",
    title: "Cmd-K isn't a chatbot.",
    body: "It reads across people, tasks, KPIs, financials, comp, SOPs — your live data, your tenant. 'Who's overdue?' returns names. 'Show variance' returns numbers. No hallucinations, no fluff.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <MarketingTopbar />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 lg:px-10 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium px-3 h-7 rounded-full border border-border bg-surface mb-6">
          <Sparkles size={11} className="text-[color:var(--accent-strong)]" />
          About WorkwrK
        </div>
        <h1 className="text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-[1.05]">
          We got tired of stitching<br />
          <span className="text-[color:var(--accent-strong)]">fifteen SaaS tools together.</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto leading-relaxed">
          WorkwrK is a business operating system built by the people running
          the business — not by consultants who've read a Workday brochure.
          Every module has earned its place by surviving a real day in
          a real company.
        </p>
      </section>

      {/* ── Values ──────────────────────────────────────────────── */}
      <section className="border-t border-border bg-[color:var(--surface)]/40">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
              What we believe
            </p>
            <h2 className="text-4xl font-bold tracking-tight max-w-xl mx-auto leading-[1.1]">
              Four positions that show<br />up in every decision.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {VALUES.map((v) => (
              <div
                key={v.title}
                className="rounded-2xl border border-border bg-background p-7 hover:border-[color:var(--accent)]/40 transition-fast"
              >
                <h3 className="text-xl font-bold mb-3 leading-tight">{v.title}</h3>
                <p className="text-[15px] text-muted leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Principles ──────────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
              How the product is built
            </p>
            <h2 className="text-4xl font-bold tracking-tight max-w-xl mx-auto leading-[1.1]">
              Three operating principles.
            </h2>
          </div>
          <div className="space-y-12">
            {PRINCIPLES.map((p, i) => (
              <div
                key={p.title}
                className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start"
              >
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted font-bold mb-1">
                    Principle {String(i + 1).padStart(2, "0")}
                  </p>
                  <p className="text-sm text-[color:var(--accent-strong)] font-medium">{p.eyebrow}</p>
                </div>
                <div>
                  <h3 className="text-2xl font-bold tracking-tight mb-3">{p.title}</h3>
                  <p className="text-[15px] text-muted leading-relaxed max-w-2xl">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Timeline ────────────────────────────────────────────── */}
      <section className="border-t border-border bg-[color:var(--surface)]/40">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-24">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-[0.2em] text-muted font-semibold mb-3">
              Roadmap
            </p>
            <h2 className="text-4xl font-bold tracking-tight">
              The four-year arc.
            </h2>
          </div>
          <div className="space-y-4">
            {MILESTONES.map((m, i) => (
              <div
                key={m.year}
                className="grid grid-cols-[80px_1fr] gap-6 items-start rounded-2xl border border-border bg-background p-6"
              >
                <div className="text-right relative">
                  <p className="text-3xl font-bold tracking-tight text-[color:var(--accent-strong)] tabular-nums">
                    {m.year}
                  </p>
                  {i < MILESTONES.length - 1 && (
                    <div className="hidden md:block absolute top-12 left-1/2 -translate-x-1/2 h-16 w-px bg-border" aria-hidden />
                  )}
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2">{m.title}</h3>
                  <p className="text-[14px] text-muted leading-relaxed">{m.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-24 text-center">
          <h2 className="text-4xl font-bold tracking-tight mb-5 leading-tight">
            Ready to run your company<br />on one product?
          </h2>
          <p className="text-muted mb-8">
            Free under five people. No credit card. Set up in under an hour.
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
