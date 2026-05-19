import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Inbox,
  Users,
  CheckCircle2,
  DollarSign,
  Crosshair,
  Star,
  Megaphone,
  Sparkles,
} from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  Button,
  CTABand,
  GradientText,
  HUBS,
  HUES,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Features — WorkwrK",
  description:
    "Every feature in workwrk, organized by the 7 hubs. People, Work, Money, Talent, Culture, Growth — and Home that ties them all together.",
  alternates: { canonical: "https://workwrk.com/features" },
};

const HUB_PAGES = {
  home: {
    description: "The morning command center. Inbox aggregates 12 streams, Cmd-K AI searches every entity, dashboards summarize where the business stands at a glance.",
    features: ["Unified Inbox (12 streams)", "Cmd-K AI search", "Live dashboards by role"],
    subFeatures: [
      { slug: "ai-engine", title: "AI Engine", body: "Cmd-K search, inbox triage, cross-module signals." },
      { slug: "analytics", title: "Analytics", body: "Role-aware dashboards and rolling KPI windows." },
    ],
  },
  people: {
    description: "The org, the roles, the performance signal. A profile is a 360 degree dossier — perf, comp, history, kudos count, all in one row.",
    features: ["Org chart + roles", "Composite performance scores", "Profile = 360 degree dossier"],
    subFeatures: [
      { slug: "people",  title: "People",        body: "Org charts, roles, locations — the source of truth for who's who." },
      { slug: "reviews", title: "Reviews",       body: "Cycles, manager + 360 + self-assessment, all weighted to a score." },
      { slug: "access",  title: "Access & roles", body: "Role-based permissions, audit log, scoped sharing." },
    ],
  },
  work: {
    description: "Where work actually happens — tasks, OKRs, KPIs, SOPs, processes, calendars. The execution layer of the business.",
    features: ["KPI engine with auto-scoring", "OKR cascade across teams", "SOPs with compliance tracking"],
    subFeatures: [
      { slug: "tasks", title: "Tasks", body: "Personal + team + cross-functional. Auto-escalate when overdue." },
      { slug: "okrs",  title: "OKRs",  body: "Cascade objectives top-down with auto-rollup." },
      { slug: "kpis",  title: "KPIs",  body: "Track, weight, score. Tie KPI achievement to performance." },
      { slug: "kras",  title: "KRAs",  body: "Key result areas linked to roles, surfaced in reviews." },
      { slug: "sops",  title: "SOPs",  body: "Process documents with compliance runs and audit trail." },
    ],
  },
  money: {
    description: "Spend, vendors, financials, planning. The CFO surface of workwrk — built around the same people and processes.",
    features: ["Expense approvals", "Vendor + procurement", "Budgets vs. actuals"],
    subFeatures: [
      { slug: "integrations", title: "Integrations", body: "Slack, Google, Microsoft, Stripe, Razorpay, QuickBooks." },
    ],
  },
  talent: {
    description: "Reviews, comp, onboarding, recruiting — the lifecycle of every team member, end to end.",
    features: ["Review cycles", "Comp bands + raises", "Onboarding journeys"],
    subFeatures: [
      { slug: "reviews", title: "Reviews", body: "Quarterly + annual cycles with 360 feedback." },
    ],
  },
  culture: {
    description: "Kudos, ideas, surveys, announcements. The social layer of work — recognition factors into the performance score.",
    features: ["Kudos with company values", "Idea boards", "Pulse surveys + eNPS"],
    subFeatures: [
      { slug: "kudos", title: "Kudos", body: "Recognition with company values, factored into performance scores." },
    ],
  },
  growth: {
    description: "Pipeline, deals, customers — revenue alongside the people and operational data.",
    features: ["Sales pipeline", "Customer 360", "Pipeline-to-people analytics"],
    subFeatures: [
      { slug: "analytics", title: "Analytics", body: "Pipeline analytics tied to who closed what." },
    ],
  },
} as const;

const HUB_ICONS = {
  home: Inbox,
  people: Users,
  work: CheckCircle2,
  money: DollarSign,
  talent: Crosshair,
  culture: Star,
  growth: Megaphone,
} as const;

export default function FeaturesPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="violet" className="mb-5">Features</Eyebrow>
            <H1>
              <GradientText hue="violet">Every capability</GradientText>, organized by hub.
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Seven hubs. One data model. Each hub is fully featured on its own — together they replace 15+ tools and operate as a single product.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/signup" variant="secondary" hue="violet" size="lg" rightIcon={<ArrowRight size={15} />}>
                Try every feature free
              </Button>
              <Button href="/demo" variant="outline" size="lg">
                Get a guided tour
              </Button>
            </div>
          </div>

          <div className="mt-12 flex flex-wrap gap-2">
            {HUBS.map((hub) => {
              const t = HUES[hub.hue];
              return (
                <a
                  key={hub.slug}
                  href={`#${hub.slug}`}
                  className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] px-3 h-8 rounded-full bg-white border ${t.border} ${t.text} hover:scale-105 transition`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.hex }} />
                  {hub.name}
                </a>
              );
            })}
          </div>
        </Container>
      </Section>

      {HUBS.map((hub, i) => {
        const t = HUES[hub.hue];
        const detail = HUB_PAGES[hub.slug as keyof typeof HUB_PAGES];
        const Icon = HUB_ICONS[hub.slug as keyof typeof HUB_ICONS];
        const altRow = i % 2 === 1;
        return (
          <section
            key={hub.slug}
            id={hub.slug}
            className={`scroll-mt-20 ${altRow ? "bg-slate-50" : "bg-white"} py-20 lg:py-28`}
          >
            <Container>
              <div className="grid lg:grid-cols-[1.05fr_1.15fr] gap-12 lg:gap-16 items-start">
                <div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br ${t.gradVia} text-white shadow-[0_12px_36px_-12px_var(--hub-glow)]`}
                      style={{ ["--hub-glow" as string]: `${t.hex}88` } as React.CSSProperties}
                    >
                      <Icon size={22} strokeWidth={2.4} />
                    </span>
                    <Eyebrow hue={hub.hue}>Hub · {String(i + 1).padStart(2, "0")}</Eyebrow>
                  </div>
                  <H2 className="mt-5">{hub.name}</H2>
                  <p className="mt-5 text-slate-600 text-lg leading-relaxed">{detail.description}</p>
                  <ul className="mt-7 space-y-2">
                    {detail.features.map((f) => (
                      <li key={f} className="flex items-start gap-3 text-[15px] text-slate-700">
                        <span className={`mt-1 w-5 h-5 rounded-full ${t.bgTint} ${t.text} border ${t.border} flex items-center justify-center`}>
                          <Sparkles size={11} />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {detail.subFeatures.map((sub) => (
                    <Link
                      key={sub.slug}
                      href={`/features/${sub.slug}`}
                      className={`group p-5 bg-white border ${t.border} rounded-2xl hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-18px_rgba(15,23,42,0.18)] transition`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-900 tracking-tight">{sub.title}</p>
                        <ArrowRight size={14} className={`${t.text} opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition`} />
                      </div>
                      <p className="mt-2 text-sm text-slate-600 leading-relaxed">{sub.body}</p>
                    </Link>
                  ))}
                </div>
              </div>
            </Container>
          </section>
        );
      })}

      <CTABand hue="violet" />
    </>
  );
}
