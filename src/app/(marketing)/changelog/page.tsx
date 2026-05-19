import type { Metadata } from "next";
import { Sparkles, Zap, ShieldCheck, Bug, BookOpen, ArrowRight } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  Button,
  CTABand,
  GradientText,
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Changelog — WorkwrK",
  description: "Every Tuesday, we ship. Here's what's new — features, improvements, fixes — in chronological order.",
  alternates: { canonical: "https://workwrk.com/changelog" },
};

type EntryType = "feature" | "improvement" | "fix" | "security" | "docs";

const TYPE_META: Record<EntryType, { label: string; hue: Hue; icon: typeof Sparkles }> = {
  feature:     { label: "New",         hue: "fuchsia", icon: Sparkles    },
  improvement: { label: "Improvement", hue: "sky",     icon: Zap         },
  fix:         { label: "Fix",         hue: "amber",   icon: Bug         },
  security:    { label: "Security",    hue: "emerald", icon: ShieldCheck },
  docs:        { label: "Docs",        hue: "indigo",  icon: BookOpen    },
};

const ENTRIES: readonly { date: string; version: string; title: string; items: readonly { type: EntryType; text: string }[] }[] = [
  {
    date: "2026-05-18",
    version: "v4.2",
    title: "v4 marketing relaunch — colorful, hub-aligned, full-rainbow",
    items: [
      { type: "feature",     text: "Marketing site rebuilt with ClickUp×Workday aesthetic — every page on the new design system." },
      { type: "feature",     text: "Logo refreshed: multi-hue rainbow bento mark replaces the single-tone violet." },
      { type: "improvement", text: "Topbar gets a mega-menu for Product and Solutions; mobile drawer redesigned." },
      { type: "improvement", text: "Marketing primitives library shared across all 22+ marketing pages." },
    ],
  },
  {
    date: "2026-05-11",
    version: "v4.1",
    title: "ListPage migration: every dashboard now has a persistent rail",
    items: [
      { type: "feature",     text: "Tasks, SOPs, Recruiting, Procurement, Expenses — all migrated to the new ListPage shell." },
      { type: "feature",     text: "OKRs, Ideas, Surveys, People pages on the same shell with hub-aware quick-action rails." },
      { type: "improvement", text: "Cross-page nav latency cut by 40% via shared shell prefetching." },
    ],
  },
  {
    date: "2026-05-04",
    version: "v4.0",
    title: "Landing v4 + AI Engine GA",
    items: [
      { type: "feature",     text: "New landing — confident hero, 7-hub showcase, workflow demo, big-number stat strip." },
      { type: "feature",     text: "AI Engine GA: Cmd-K AI search, inbox triage, cross-module signals." },
      { type: "security",    text: "SOC 2 Type II report available; refresh of penetration test from Cure53." },
    ],
  },
  {
    date: "2026-04-22",
    version: "v3.9",
    title: "Comp + onboarding journeys",
    items: [
      { type: "feature",     text: "Comp band editor with per-location overrides and tenure-based bumps." },
      { type: "feature",     text: "Onboarding journeys: forkable, tied to KPI ramp, with mentor pairing." },
      { type: "improvement", text: "Composite review score now visible inline on the manager 1:1 view." },
    ],
  },
  {
    date: "2026-04-08",
    version: "v3.8",
    title: "Money hub expansion",
    items: [
      { type: "feature",     text: "Procurement: vendor scorecards, PO/GRN tracking, multi-step approvals." },
      { type: "feature",     text: "Budget vs. actual dashboards per cost center with drill-through." },
      { type: "fix",         text: "Multi-currency rollup recalculation now correctly handles mid-period FX changes." },
    ],
  },
  {
    date: "2026-03-25",
    version: "v3.7",
    title: "Kudos boosts + leaderboard",
    items: [
      { type: "feature",     text: "Monthly recognition leaderboard with company-value tagging." },
      { type: "feature",     text: "Kudos count factors into composite review score as a configurable bonus axis." },
      { type: "docs",        text: "New playbook: 'Designing a recognition system that holds up at scale.'" },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="fuchsia" className="mb-5">Changelog</Eyebrow>
            <H1>
              Every Tuesday, <GradientText hue="fuchsia">we ship.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Features, improvements, fixes — published the day they hit production. No version-number theater.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/roadmap" variant="secondary" hue="fuchsia" size="lg" rightIcon={<ArrowRight size={15} />}>
                See what&apos;s next
              </Button>
              <Button href="/signup" variant="outline" size="lg">Try it free</Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <ol className="relative space-y-12 border-l-2 border-dashed border-slate-200 pl-8 lg:pl-12">
            {ENTRIES.map((entry) => (
              <li key={entry.version} className="relative">
                <span className="absolute -left-[2.75rem] lg:-left-[3.4rem] top-0.5 w-7 h-7 rounded-full bg-white border-2 border-fuchsia-500 flex items-center justify-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
                </span>
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="font-extrabold text-2xl text-slate-900 tracking-tight">{entry.title}</h2>
                  <span className="text-xs font-mono text-slate-400">{entry.version}</span>
                </div>
                <p className="text-sm text-slate-500 mt-1">{entry.date}</p>
                <ul className="mt-5 space-y-2.5">
                  {entry.items.map((item, i) => {
                    const meta = TYPE_META[item.type];
                    const t = HUES[meta.hue];
                    const Icon = meta.icon;
                    return (
                      <li key={i} className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] px-2 h-5 rounded-full ${t.bgTint} ${t.text} border ${t.border} flex-shrink-0`}>
                          <Icon size={10} /> {meta.label}
                        </span>
                        <span className="text-[15px] text-slate-700 leading-snug">{item.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <CTABand
        hue="fuchsia"
        title={<>Want updates <GradientText hue="indigo">in your inbox</GradientText>?</>}
        body="Weekly changelog digest — every Tuesday."
        primary={{ label: "Subscribe", href: "/signup" }}
        secondary={{ label: "See roadmap", href: "/roadmap" }}
      />
    </>
  );
}
