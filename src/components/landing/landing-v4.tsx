// Landing page — monday-style rebuild.
//
// This file is being rebuilt section-by-section per the redesign plan.
// Section 1 (Hero) and Section 2 (Trust strip) are live. The remaining
// six sections (scroll-driven product showcase, "Built for every team",
// outcomes, how-it-works, pricing preview, FAQ + CTA) will be added in
// the following BlitzIt tasks.
//
// Topbar + Footer come from the parent (marketing) layout.

import Link from "next/link";
import { ArrowRight, ChevronRight, Sparkles } from "lucide-react";
import { HeroBoardMock } from "./hero-board-mock";
import { ScrollShowcase } from "./scroll-showcase";
import { TeamWorkspaces } from "./team-workspaces";
import { CustomerOutcomes } from "./customer-outcomes";
import { HowItWorks } from "./how-it-works";
import { LandingFAQ } from "./landing-faq";
import { ClosingCTA } from "./closing-cta";
import { ProductMosaic } from "./product-mosaic";
import { AIAgents } from "./ai-agents";
import { EnterpriseControl } from "./enterprise-control";
import { IntegrationsGrid } from "./integrations-grid";

export function LandingV4() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <ScrollShowcase />
      <TeamWorkspaces />
      <ProductMosaic />
      <AIAgents />
      <CustomerOutcomes />
      <HowItWorks />
      <EnterpriseControl />
      <IntegrationsGrid />
      <LandingFAQ />
      <ClosingCTA />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. HERO
// Big confident headline + lede + two CTAs. To the right: a static
// monday-style "Tasks" board with three colored status columns. The
// goal of the hero is to communicate the product in one glance, not
// through motion.
// ════════════════════════════════════════════════════════════════════

function Hero() {
  return (
    <section className="relative bg-white pt-12 pb-20 lg:pt-20 lg:pb-28 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
          {/* ── Left: pitch ─────────────────────────────────────── */}
          <div>
            <Link
              href="/changelog"
              className="inline-flex items-center gap-2 text-[12px] font-semibold pl-2 pr-3 h-7 rounded-full border bg-white transition-colors"
              style={{
                color: "var(--m-text)",
                borderColor: "var(--m-border)",
              }}
            >
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] px-2 h-5 rounded-full text-white"
                style={{ backgroundColor: "var(--brand-red)" }}
              >
                <Sparkles size={9} /> new
              </span>
              v4 marketing relaunch — read the post
              <ArrowRight size={11} className="opacity-60" />
            </Link>

            <h1
              className="mt-8 font-extrabold tracking-[-0.04em]"
              style={{
                color: "var(--m-text)",
                fontSize: "clamp(2.7rem, 6vw, 5rem)",
                lineHeight: 0.98,
              }}
            >
              The operating system <br />
              that runs your{" "}
              <span style={{ color: "var(--brand-red)" }}>people</span>,{" "}
              <span style={{ color: "var(--brand-blue)" }}>processes</span>{" "}
              &amp;{" "}
              <span style={{ color: "var(--brand-yellow)" }}>performance</span>.
            </h1>

            <p
              className="mt-7 text-lg lg:text-[20px] leading-[1.55] max-w-xl"
              style={{ color: "var(--m-text-muted)" }}
            >
              Not a task list. Not another HR tool. WorkwrK is one
              platform that runs the entire operating layer of your
              business &mdash; people, performance, KPIs, SOPs, spend,
              culture &mdash; with AI built in. Replace 15+ tools.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 h-12 px-6 rounded-full text-white font-semibold text-[15px] shadow-[0_4px_14px_-4px_rgba(255,61,87,0.5)] hover:shadow-[0_8px_24px_-8px_rgba(255,61,87,0.55)] transition-all"
                style={{ backgroundColor: "var(--brand-red)" }}
              >
                Get started — it&apos;s free
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center gap-1.5 text-[15px] font-semibold transition-colors"
                style={{ color: "var(--m-text)" }}
              >
                Watch the demo <ArrowRight size={14} />
              </Link>
            </div>

            <p className="mt-6 text-xs" style={{ color: "var(--m-text-soft)" }}>
              Free forever for up to 5 people. No credit card.
            </p>
          </div>

          {/* ── Right: board mock ───────────────────────────────── */}
          <HeroBoardMock />
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 2. TRUST STRIP
// ════════════════════════════════════════════════════════════════════

function TrustStrip() {
  const brands = [
    "Helios Labs",
    "Nimbus Logistics",
    "Lattice & Co",
    "Quill Health",
    "Forge Capital",
    "Stratum AI",
    "Brindle Estates",
    "Crest AI",
  ];
  return (
    <section
      className="py-14 lg:py-16 border-t"
      style={{ borderColor: "var(--m-border)" }}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.22em] text-center"
          style={{ color: "var(--m-text-soft)" }}
        >
          500+ teams across 8 countries run on workwrk
        </p>
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-6 gap-y-6 items-center justify-items-center">
          {brands.map((b) => (
            <span
              key={b}
              className="font-bold text-lg lg:text-xl tracking-tight transition-colors whitespace-nowrap"
              style={{
                color: "var(--m-text-soft)",
                fontVariant: "small-caps",
                letterSpacing: "0.02em",
              }}
            >
              {b}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

