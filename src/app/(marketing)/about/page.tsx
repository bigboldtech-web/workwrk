// About page — Phase H revamp.
// Replaces the bento-styled v2 about with a static, v3-aligned shape:
// single confident narrative, four values, four milestones, single CTA.
// Same visual rhythm as landing v3 + pricing.

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
  { year: "2024", title: "Founded",         body: "Built inside BigBoldTech while running a 100-person operation. Stopped stitching SaaS and started building." },
  { year: "2025", title: "First customers", body: "Landed across sales, logistics, finance, and healthcare. Median onboarding: under an hour." },
  { year: "2026", title: "AI engine",        body: "Claude-powered reasoning across the seven hubs — Cmd-K AI search, Inbox triage, cross-module anomalies." },
  { year: "2027", title: "Scale + on-prem",  body: "SOC-2 Type II, multi-entity consolidation, on-prem deployment for regulated industries." },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingTopbar />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="px-6 pt-20 pb-12 max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-border bg-surface mb-6 text-muted">
          <Sparkles size={12} className="text-[color:var(--accent-strong)]" />
          About WorkwrK
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-6 leading-[1.1]">
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
      <section className="px-6 py-20 border-t border-border bg-surface/50">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3 text-center">
            What we believe
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12 max-w-xl mx-auto">
            Four positions that show up in every product decision.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {VALUES.map((v) => (
              <div
                key={v.title}
                className="rounded-xl border border-border bg-background p-6 hover:border-[color:var(--accent)]/40 transition-fast"
              >
                <h3 className="text-lg font-semibold mb-2.5 leading-tight">{v.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Timeline ────────────────────────────────────────────── */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3 text-center">
          Roadmap
        </p>
        <h2 className="text-3xl font-bold tracking-tight text-center mb-12">
          The four-year arc.
        </h2>
        <div className="space-y-4">
          {MILESTONES.map((m, i) => (
            <div
              key={m.year}
              className="grid grid-cols-[80px_1fr] gap-6 items-start rounded-xl border border-border bg-surface/30 p-6"
            >
              <div className="text-right">
                <p className="text-2xl font-bold tracking-tight text-[color:var(--accent-strong)] tabular-nums">{m.year}</p>
                {i < MILESTONES.length - 1 && (
                  <div className="hidden md:block h-12 w-px bg-border mx-auto mt-3" aria-hidden />
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1.5">{m.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{m.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────── */}
      <section className="px-6 py-24 border-t border-border text-center max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          Ready to run your company on one product?
        </h2>
        <p className="text-muted mb-8">
          Free under five people. No credit card. Set up in under an hour.
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
