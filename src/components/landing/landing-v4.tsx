// Landing page — ClickUp / Linear / Workday restraint.
//
// White is the canvas. Black is the ink. Color appears only in product
// visuals (the mock, hub icons) and in the strategically dark sections
// (AI moment) — never in chrome.
//
// Sections, top to bottom:
//   1. Hero            — confident black headline + clean product mock
//   2. Trust strip     — quiet logo cloud
//   3. Pillars         — three reasons, neutral feature cards
//   4. Seven hubs      — clean tiles, single-tint icon, no rainbow rim
//   5. Workflow demo   — numbered steps, neutral chrome
//   6. AI section      — DARK slate-950, ClickUp-style product moment
//   7. Stat strip      — big black numbers, tiny purple eyebrow labels
//   8. Replaces strip  — quiet "we replace X" plaque
//   9. Quote           — editorial pull-quote
//   10. Pricing preview — three tiers, clean cards
//   11. FAQ
//   12. CTA band (dark)
//
// Topbar + Footer come from the parent layout.

import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  Layers,
  Bot,
  TrendingUp,
  Inbox,
  Users,
  CheckCircle2,
  Crosshair,
  DollarSign,
  Star,
  Megaphone,
  ChevronRight,
  Search,
  Zap,
  Brain,
} from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  Lede,
  Button,
  HubCard,
  FeatureCard,
  StatCard,
  CTABand,
  FAQ,
  LogoCloud,
  Quote,
  CheckList,
  HUBS,
  HUES,
} from "@/components/marketing/primitives";

export function LandingV4() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <Pillars />
      <HubsGrid />
      <WorkflowDemo />
      <AIMoment />
      <StatStrip />
      <ReplacesStrip />
      <QuoteSection />
      <PricingPreview />
      <LandingFAQ />
      <CTABand
        body="14-day free trial. No credit card. Free forever under 5 people."
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. HERO
// ════════════════════════════════════════════════════════════════════

function Hero() {
  return (
    <Section variant="mesh" py="lg" className="pt-10 lg:pt-16">
      <Container>
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-20 items-center">
          <div>
            <Link
              href="/changelog"
              className="inline-flex items-center gap-2 text-[12px] font-semibold px-3.5 h-7 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <span className="text-slate-500">New</span>
              <span className="w-1 h-1 rounded-full bg-slate-400" />
              v4 marketing refresh
              <ArrowRight size={11} className="opacity-60" />
            </Link>

            <h1
              className="mt-7 font-bold tracking-[-0.04em] text-slate-900"
              style={{ fontSize: "clamp(2.6rem, 6.2vw, 5rem)", lineHeight: 1.0 }}
            >
              The operating system <br />
              for the whole business.
            </h1>

            <p className="mt-6 text-lg lg:text-[20px] text-slate-600 leading-[1.55] max-w-xl">
              WorkwrK replaces 15+ tools with one platform &mdash; people, work,
              money, talent, culture, growth. Built for teams who outgrew
              spreadsheets but can&apos;t afford a Workday rollout.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-slate-900 text-white font-semibold text-[15px] hover:bg-slate-800 transition-colors"
              >
                Get started &middot; It&apos;s free
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center gap-1.5 h-12 px-5 rounded-full text-slate-700 font-semibold text-[15px] hover:text-slate-900 transition-colors"
              >
                Get a demo <ArrowRight size={14} />
              </Link>
            </div>

            <p className="mt-6 text-xs text-slate-500">
              Free forever. No credit card.
            </p>
          </div>

          <HeroMock />
        </div>
      </Container>
    </Section>
  );
}

// CSS-only product mock — single accent (violet) on a clean white surface,
// with a few quiet hue dots in the sidebar nav. No rainbow gradients.
function HeroMock() {
  return (
    <div className="relative">
      <div className="relative bg-white rounded-2xl border border-slate-200 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.18)] overflow-hidden">
        {/* mock chrome */}
        <div className="h-8 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 px-3.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          <span className="ml-3 text-[10px] text-slate-400 font-mono">workwrk.com</span>
        </div>

        <div className="p-5 grid grid-cols-12 gap-4">
          {/* sidebar */}
          <div className="col-span-3 space-y-1.5">
            {HUBS.slice(0, 6).map((hub, i) => {
              const t = HUES[hub.hue];
              const active = i === 0;
              return (
                <div
                  key={hub.slug}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${active ? "bg-slate-100" : ""}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full`} style={{ backgroundColor: t.hex }} />
                  <span className="text-[11px] text-slate-700 font-medium truncate">{hub.name}</span>
                </div>
              );
            })}
          </div>

          {/* main content */}
          <div className="col-span-9 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <MiniKPI label="Active people" value="248" trend="+12" />
              <MiniKPI label="On-track OKRs" value="86%" trend="+4" />
              <MiniKPI label="Open tasks" value="412" trend="-9" />
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Performance &middot; 30d
                </p>
                <span className="text-[10px] text-emerald-600 font-bold">+8.2%</span>
              </div>
              <svg viewBox="0 0 240 56" className="mt-2 w-full" preserveAspectRatio="none">
                <path
                  d="M0 42 L20 38 L40 40 L60 30 L80 33 L100 25 L120 28 L140 18 L160 22 L180 12 L200 16 L220 8 L240 6 L240 56 L0 56 Z"
                  fill="rgba(124, 58, 237, 0.08)"
                />
                <path
                  d="M0 42 L20 38 L40 40 L60 30 L80 33 L100 25 L120 28 L140 18 L160 22 L180 12 L200 16 L220 8 L240 6"
                  stroke="#7c3aed"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              <MockRow status="violet"  label="Review Q3 OKRs"              meta="Priya &middot; Today" />
              <MockRow status="emerald" label="Approve vendor: Helios Labs" meta="$3,200 &middot; 2h" />
              <MockRow status="amber"   label="Sign-off SOP-141"            meta="Ops &middot; tomorrow" />
              <MockRow status="slate"   label="Send kudos to Maya"          meta="Culture &middot; 1m" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniKPI({ label, value, trend }: { label: string; value: string; trend: string }) {
  const up = !trend.startsWith("-");
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[15px] font-bold text-slate-900">{value}</span>
        <span className={`text-[9px] font-bold ${up ? "text-emerald-600" : "text-rose-600"}`}>
          {trend}
        </span>
      </div>
    </div>
  );
}

function MockRow({
  status, label, meta,
}: { status: "violet" | "emerald" | "amber" | "slate"; label: string; meta: string }) {
  const color = status === "slate" ? "#94a3b8" : HUES[status as keyof typeof HUES].hex;
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[11px] text-slate-700 truncate">{label}</span>
      </div>
      <span className="text-[10px] text-slate-400 flex-shrink-0">{meta}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 2. TRUST STRIP
// ════════════════════════════════════════════════════════════════════

function TrustStrip() {
  return (
    <Section py="md" className="border-t border-slate-100">
      <Container>
        <LogoCloud />
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 3. PILLARS
// ════════════════════════════════════════════════════════════════════

function Pillars() {
  return (
    <Section py="lg">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow className="mb-4">Why workwrk</Eyebrow>
          <H2>One platform for the work you already do.</H2>
          <p className="mt-5 text-slate-600 text-lg leading-relaxed">
            Built from a single data model. Priced so the math works.
            Designed for the way SMBs actually run.
          </p>
        </div>

        <div className="mt-14 grid md:grid-cols-3 gap-5">
          <FeatureCard
            hue="violet"
            icon={Layers}
            title="One stack, one bill"
            body="Stop paying for 15 tools that don't talk. People, work, money, talent, culture, growth — one model, one platform, one invoice."
          />
          <FeatureCard
            hue="indigo"
            icon={Bot}
            title="AI is the runtime"
            body="Cmd-K searches every entity. Inbox triage is auto. Promotions, KPIs, SOP drift — surfaced by the model, not by you."
          />
          <FeatureCard
            hue="emerald"
            icon={TrendingUp}
            title="Scales 5 to 5,000"
            body="Free under five. $8/user thereafter. Same product on day one and at 5,000 seats — you grow into it, never out of it."
          />
        </div>
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 4. HUBS GRID
// ════════════════════════════════════════════════════════════════════

const HUB_DETAILS: Record<string, { icon: any; description: string; features: readonly string[] }> = {
  home: {
    icon: Inbox,
    description: "The morning command center — every signal from every hub, aggregated and triaged.",
    features: ["Inbox of 12 streams", "Cmd-K AI search", "Day-one snapshot for execs"],
  },
  people: {
    icon: Users,
    description: "The org, the roles, the performance signal. Everyone's profile is a 360° dossier.",
    features: ["Org chart + roles", "Composite performance scores", "Reviews + 360 + self-assessment"],
  },
  work: {
    icon: CheckCircle2,
    description: "Where work actually happens — tasks, OKRs, KPIs, SOPs, processes, calendars.",
    features: ["KPI engine with auto-scoring", "OKR cascade across teams", "SOP runs with compliance tracking"],
  },
  money: {
    icon: DollarSign,
    description: "Spend, vendors, financials, planning — the side of the business spreadsheets used to own.",
    features: ["Expense approvals", "Vendor + procurement", "Budgets vs. actuals"],
  },
  talent: {
    icon: Crosshair,
    description: "Reviews, comp, onboarding, recruiting — the lifecycle of every team member.",
    features: ["Review cycles", "Comp bands + raises", "Onboarding journeys"],
  },
  culture: {
    icon: Star,
    description: "Kudos, ideas, surveys, announcements — the social layer of work, in your own product.",
    features: ["Kudos with company values", "Idea boards", "Pulse surveys + eNPS"],
  },
  growth: {
    icon: Megaphone,
    description: "Pipeline, deals, customers — the revenue side of the same data model.",
    features: ["Sales pipeline", "Customer 360", "Pipeline-to-people analytics"],
  },
};

function HubsGrid() {
  return (
    <Section variant="tint" py="lg">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow className="mb-4">The 7 hubs</Eyebrow>
          <H2>One platform. Seven hubs. Endless workflows.</H2>
          <p className="mt-5 text-slate-600 text-lg leading-relaxed">
            Each hub is a fully-featured product on its own. Together they
            replace 15+ tools and share the same data model &mdash; a hire in
            People is a row in Money, a task in Work, and a kudos count in Culture.
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {HUBS.map((hub) => {
            const d = HUB_DETAILS[hub.slug];
            return (
              <HubCard
                key={hub.slug}
                hub={hub}
                icon={d.icon}
                description={d.description}
                features={d.features}
                href={`/features#${hub.slug}`}
              />
            );
          })}
        </div>
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 5. WORKFLOW DEMO
// ════════════════════════════════════════════════════════════════════

function WorkflowDemo() {
  const steps = [
    { hub: "Home",    label: "Sales rep flags a deal-blocking task in Inbox" },
    { hub: "Work",    label: "Auto-routed to Procurement; SOP-141 triggers" },
    { hub: "Money",   label: "Vendor approval kicks the spend workflow" },
    { hub: "People",  label: "Manager review fires when SLA breaches" },
    { hub: "Culture", label: "Resolution sends a kudos chain across teams" },
  ];

  return (
    <Section py="lg">
      <Container>
        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 lg:gap-20 items-start">
          <div>
            <Eyebrow className="mb-4">How it flows</Eyebrow>
            <H2>One signal. Five hubs. Zero context-switching.</H2>
            <p className="mt-5 text-slate-600 text-lg leading-relaxed">
              Watch how a single field signal &mdash; a stuck deal &mdash; moves
              through the platform without anyone copying data, opening
              another tab, or chasing a manager on Slack.
            </p>
            <Button href="/features" variant="outline" size="md" className="mt-7" rightIcon={<ArrowRight size={14} />}>
              See every feature
            </Button>
          </div>

          <ol className="space-y-2.5">
            {steps.map((s, i) => (
              <li
                key={s.label}
                className="relative pl-14 pr-5 py-4 bg-white border border-slate-200 rounded-xl flex items-center gap-4"
              >
                <span className="absolute left-4 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center bg-slate-900 text-white text-xs font-bold">
                  {i + 1}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  {s.hub}
                </span>
                <span className="text-sm text-slate-700 flex-1">{s.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 6. AI MOMENT — dark slate-950 section (ClickUp Brain style)
// ════════════════════════════════════════════════════════════════════

function AIMoment() {
  return (
    <section className="bg-slate-950 text-white">
      <Container className="py-24 lg:py-32">
        <div className="max-w-3xl mx-auto text-center">
          <Eyebrow invert className="mb-5">workwrk AI</Eyebrow>
          <h2
            className="font-bold tracking-[-0.035em] text-white"
            style={{ fontSize: "clamp(2.2rem, 4.6vw, 3.6rem)", lineHeight: 1.05 }}
          >
            The only AI that works where you work.
          </h2>
          <p className="mt-6 text-white/70 text-lg leading-relaxed max-w-xl mx-auto">
            Not a chatbot bolted on. Cmd-K searches every entity. Inbox triage
            decides what matters. Cross-module signals surface anomalies before
            you ask.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button href="/features/ai-engine" variant="invert" size="lg" rightIcon={<ArrowRight size={15} />}>
              Try workwrk AI
            </Button>
          </div>
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          <DarkFeatureCard
            icon={Search}
            title="Cmd-K AI search"
            body="Hit Cmd-K, type anything. Find a person, a SOP, an open task, a vendor invoice — across every hub, in one box."
          />
          <DarkFeatureCard
            icon={Brain}
            title="Cross-module signals"
            body="KPI drift in Work + low kudos in Culture + slipping OKR? Surfaced as an early warning, not after the fact."
          />
          <DarkFeatureCard
            icon={Zap}
            title="Reviewer copilot"
            body="Drafts review summaries from KPI + task + kudos data. Reviewers edit, don't write from blank."
          />
        </div>
      </Container>
    </section>
  );
}

function DarkFeatureCard({
  icon: Icon, title, body,
}: { icon: any; title: string; body: string }) {
  return (
    <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/10 text-white">
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <h3 className="mt-4 font-bold text-white text-lg tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-white/65 leading-relaxed">{body}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 7. STAT STRIP — black numbers, small tinted labels (ClickUp style)
// ════════════════════════════════════════════════════════════════════

function StatStrip() {
  return (
    <Section py="lg">
      <Container>
        <div className="max-w-2xl mb-12">
          <Eyebrow className="mb-4">By the numbers</Eyebrow>
          <H2>It&apos;s like adding 15 full-time employees.</H2>
          <p className="mt-5 text-slate-600 text-lg leading-relaxed">
            From a 2026 Total Economic Impact™ report. workwrk customers see
            measurable, industry-leading return on the investment within 6 months.
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          <StatCard hue="violet"  label="ROI"               value="384%"   body="Over three years, helping organizations unlock significant efficiency gains." />
          <StatCard hue="violet"  label="Revenue increase"  value="$3.9M"  body="From streamlining work, consolidating tools, and scaling faster." />
          <StatCard hue="violet"  label="Hours saved"       value="92,400" body="Reducing manual work and recapturing productivity at scale." />
          <StatCard hue="violet"  label="Payback"           value="<6 mo"  body="Customers reached payback in under six months, with rapid returns." />
        </div>
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 8. REPLACES STRIP
// ════════════════════════════════════════════════════════════════════

function ReplacesStrip() {
  const tools: readonly { name: string; replaces: string }[] = [
    { name: "Asana / Monday",   replaces: "Tasks + projects"    },
    { name: "Lattice / 15Five", replaces: "Performance + reviews" },
    { name: "BambooHR",         replaces: "People + onboarding" },
    { name: "Trainual",         replaces: "SOPs + playbooks"    },
    { name: "Bonusly",          replaces: "Kudos + recognition" },
    { name: "Officevibe",       replaces: "Surveys + pulse"     },
    { name: "Spendesk",         replaces: "Spend + expenses"    },
    { name: "HubSpot CRM",      replaces: "Pipeline + customers" },
    { name: "Notion",           replaces: "Docs + processes"    },
    { name: "Confluence",       replaces: "Knowledge base"      },
  ];

  return (
    <Section variant="tint" py="lg">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow className="mb-4">Replaces</Eyebrow>
          <H2>Cancel 15 subscriptions this quarter.</H2>
          <p className="mt-5 text-slate-600 text-lg leading-relaxed">
            workwrk consolidates the modern SMB tool stack. Same job, one product, one bill.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="p-4 rounded-xl bg-white border border-slate-200 text-center"
            >
              <p className="font-bold text-sm text-slate-900">{tool.name}</p>
              <p className="text-[11px] text-slate-500 mt-1">{tool.replaces}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 9. QUOTE
// ════════════════════════════════════════════════════════════════════

function QuoteSection() {
  return (
    <Section py="lg">
      <Container>
        <Quote
          quote="We cancelled six tools in the first 90 days. Our ops director now opens one tab in the morning, not twelve. That's the whole pitch — and it's true."
          author="Priya Iyer"
          role="COO"
          company="Helios Labs"
        />
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 10. PRICING PREVIEW
// ════════════════════════════════════════════════════════════════════

function PricingPreview() {
  const tiers = [
    {
      name: "Starter",
      price: "Free",
      sub: "Up to 5 people · forever",
      features: [
        "All 7 hubs unlocked",
        "Inbox + Cmd-K AI search",
        "Tasks, OKRs, KPIs, SOPs",
        "Kudos, ideas, surveys",
        "Email support",
      ],
      cta: { label: "Start free", href: "/signup" },
    },
    {
      name: "Growth",
      price: "$8",
      priceSuffix: "/user/mo",
      sub: "14-day trial · no credit card",
      featured: true,
      features: [
        "Everything in Starter",
        "Money + Talent + Growth hubs",
        "AI Inbox triage + signals",
        "Slack + Google Workspace",
        "Priority support · 4h SLA",
      ],
      cta: { label: "Start 14-day trial", href: "/signup?plan=growth" },
    },
    {
      name: "Scale",
      price: "Custom",
      sub: "From $29,999 / yr",
      features: [
        "Everything in Growth",
        "Unlimited AI usage",
        "SSO + SCIM + audit log",
        "Custom integrations",
        "Dedicated CSM · 1h SLA",
      ],
      cta: { label: "Talk to sales", href: "/demo" },
    },
  ];

  return (
    <Section variant="tint" py="lg">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow className="mb-4">Pricing</Eyebrow>
          <H2>Honest pricing that makes the math work.</H2>
          <p className="mt-5 text-slate-600 text-lg leading-relaxed">
            Free forever under five. $8/user thereafter. No per-module surcharges. No surprise tiers.
          </p>
        </div>

        <div className="mt-14 grid md:grid-cols-3 gap-5">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl p-7 bg-white border ${
                tier.featured ? "border-slate-900 shadow-[0_18px_50px_-20px_rgba(15,23,42,0.25)]" : "border-slate-200"
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-3 left-7 inline-flex items-center text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 h-6 rounded-full bg-slate-900 text-white">
                  Most chosen
                </span>
              )}
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-700">{tier.name}</p>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-5xl font-bold text-slate-900 tracking-tight">{tier.price}</span>
                {tier.priceSuffix && (
                  <span className="text-sm text-slate-500 font-medium">{tier.priceSuffix}</span>
                )}
              </p>
              <p className="mt-1.5 text-sm text-slate-500">{tier.sub}</p>
              <Link
                href={tier.cta.href}
                className={`mt-6 inline-flex items-center justify-center w-full h-11 rounded-full font-semibold text-sm transition-colors ${
                  tier.featured
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "bg-white border border-slate-200 text-slate-900 hover:bg-slate-50"
                }`}
              >
                {tier.cta.label}
              </Link>
              <CheckList items={tier.features} className="mt-7" />
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            See full pricing comparison <ChevronRight size={14} />
          </Link>
        </div>
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// 11. FAQ
// ════════════════════════════════════════════════════════════════════

function LandingFAQ() {
  const items = [
    {
      q: "How is this different from an HRMS?",
      a: "HRMS tools focus on HR administration — payroll, leave, attendance. workwrk is the business operating system: KPIs, SOPs, performance, tasks, money, culture, and AI. You'd put workwrk over (or instead of) an HRMS, not next to one.",
    },
    {
      q: "Do I have to migrate everything at once?",
      a: "No. The hubs are independent. Most customers start with Work (tasks + OKRs + KPIs) or Culture (kudos + surveys), see the wins, then expand. We have a one-click importer for the top 12 SaaS tools.",
    },
    {
      q: "What about AI — is it just a chatbot?",
      a: "It's the runtime. AI triages your inbox, surfaces SOP drift, recommends promotions, flags KPI risk, and answers business questions in plain English over your real data — not a generic LLM. Cmd-K searches every entity.",
    },
    {
      q: "How does workwrk price compare?",
      a: "Free under 5 people. $8/user above that. A typical 50-person company replaces ~$12k/mo of disconnected tools with ~$400/mo of workwrk. The math works on day one.",
    },
    {
      q: "Is it built for India / UAE / Southeast Asia?",
      a: "Yes — INR/AED/SGD pricing, multi-currency, multi-location org charts, IST/Asia time zones across the workflow engine. We're built for the operational reality of fast-growing companies in those markets.",
    },
    {
      q: "What about data security?",
      a: "SOC 2 Type II, ISO 27001, GDPR + DPDP-compliant. SSO + SCIM on Scale. Encryption at rest and in transit. EU and India data residency options. See /security for the full deck.",
    },
  ];

  return <FAQ items={items} />;
}
