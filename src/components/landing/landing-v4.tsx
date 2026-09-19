// The live home page.
//
// It is reachable from src/app/(marketing)/page.tsx and from nowhere else,
// which makes src/components/landing a marketing directory under another
// name. The copy checker scans it for that reason.
//
// The nav and the footer come from the (marketing) layout. What this file
// composes is the body, and its job in the rebuild is to be the ONE place
// the truth gates are applied to it: every CTA below resolves through the
// marketing config, every number that describes the free tier comes from
// the pricing source, and a section whose content is invented is not
// rendered rather than reworded. See the note above each gate.

import Link from "next/link";
import { ArrowRight, ChevronRight, Sparkles } from "lucide-react";
import { PrimaryCta, SecondaryCta } from "@/components/marketing/cta";
import { flags, primaryCta, realQuote, secondaryCta } from "@/components/marketing/config";
import { startFreeSubline } from "@/components/marketing/data/pricing";
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
      {/* The outcomes section is three invented customers, three invented
          quotes, three invented metrics and a "12,849 teams, +47 this week"
          ticker that counts up from nothing. None of it is true, and none of
          it is a copy edit: the section IS the claim. It returns when there
          are real case studies to put in it, and the flag is what decides
          that, not a sentence someone retypes. */}
      {flags.namedCaseStudies ? <CustomerOutcomes /> : null}
      <HowItWorks freeLine={startFreeSubline()} primary={primaryCta("home-steps")} />
      <EnterpriseControl />
      <IntegrationsGrid />
      <LandingFAQ />
      {/* The closing band is a client component, so the server resolves its
          CTAs, its free-tier sentence and its certification rows here and
          passes three plain objects down. Same labels as the nav and the
          hero, because they come from the same place. */}
      <ClosingCTA
        primary={primaryCta("home-close")}
        secondary={secondaryCta("home-close")}
        freeLine={startFreeSubline()}
        certifications={CERTIFICATIONS}
      />
    </>
  );
}

/** Certifications the company actually holds. Empty until a flag says otherwise. */
const CERTIFICATIONS: string[] = [
  ...(flags.soc2 ? ["SOC 2 Type II"] : []),
  ...(flags.iso27001 ? ["ISO 27001"] : []),
];

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
        {/* `grid-cols-1` is load bearing, not decoration. Without it the
            single implicit column is an `auto` track, which sizes to the
            max-content of its widest item, which is the board mock. The
            track came out 472px wide inside a 342px container, so the
            headline beside it was laid out at 472 and ran off the right of
            a 390 phone. `grid-cols-1` is `minmax(0, 1fr)`: the track is the
            container, and the text wraps into it. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
          {/* ── Left: pitch ─────────────────────────────────────── */}
          {/* min-w-0: a grid item defaults to min-width:auto and refuses to
              shrink below its content, which put a 472px headline inside a
              342px column on a 390 phone and ran it off the right edge with
              no scrollbar to recover it. */}
          <div className="min-w-0">
            <Link
              href="/changelog"
              className="inline-flex items-center gap-2 text-[13px] font-semibold pl-2 pr-3 h-7 rounded-full border bg-white transition-colors"
              style={{
                color: "var(--m-text)",
                borderColor: "var(--m-border)",
              }}
            >
              <span
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.16em] px-2 h-5 rounded-full text-white"
                style={{ backgroundColor: "var(--brand-red)" }}
              >
                <Sparkles size={9} /> new
              </span>
              v4 marketing relaunch: read the post
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
              The operating system{" "}
              <br className="hidden sm:inline" />
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
              business: people, performance, KPIs, SOPs, spend and
              culture, with AI built in. Replace {realQuote.toolCount} tools.
            </p>

            {/* One label, one destination, one colour, for the whole site.
                These go through the shared CTA rather than being typed here,
                which is the only reason the nav and the hero cannot end up
                saying two different things about the same button. The old
                pair was a red "Get started" beside a "Watch the demo" link
                pointing at a video that does not exist. */}
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <PrimaryCta placement="home-hero" />
              <SecondaryCta placement="home-hero" />
            </div>

            <p className="mt-6 text-sm" style={{ color: "var(--m-text-soft)" }}>
              {startFreeSubline()}
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
  // What used to be here: eight invented company names under "500+ teams
  // across 8 countries". Neither the companies nor the count exist. The truth
  // gate is not a style rule, so the wall is gone and the slot is held by the
  // one customer voice the site is actually allowed to print, verbatim from
  // the login page. `flags.customerLogos` turns the wall back on the day
  // there are real names to put in it.
  if (flags.customerLogos) return null;
  return (
    <section
      className="py-14 lg:py-16 border-t"
      style={{ borderColor: "var(--m-border)" }}
    >
      <div className="max-w-3xl mx-auto px-6 lg:px-10 text-center">
        <blockquote
          className="text-[19px] lg:text-[22px] leading-[1.5] font-medium"
          style={{ color: "var(--m-text)" }}
        >
          &ldquo;{realQuote.body}&rdquo;
        </blockquote>
        <p className="mt-5 text-sm" style={{ color: "var(--m-text-soft)" }}>
          <span className="font-semibold" style={{ color: "var(--m-text-muted)" }}>
            {realQuote.name}
          </span>
          <br />
          {realQuote.title}
        </p>
      </div>
    </section>
  );
}

