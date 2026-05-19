import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Cpu,
  Stethoscope,
  Factory,
  Truck,
  Briefcase,
  TrendingUp,
  Home,
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
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Industries — WorkwrK",
  description:
    "WorkwrK adapts to your industry. Technology, healthcare, manufacturing, logistics, services, sales, real estate — one platform, sector-specific workflows.",
  alternates: { canonical: "https://workwrk.com/industries" },
};

const INDUSTRIES: readonly { slug: string; name: string; hue: Hue; tagline: string; body: string; icon: typeof Cpu }[] = [
  { slug: "technology",    name: "Technology",    hue: "violet",   icon: Cpu,         tagline: "Engineering + GTM under one OS",        body: "Tickets, sprints, OKRs, perf, kudos — and a pipeline that ties revenue back to the people who built it." },
  { slug: "healthcare",    name: "Healthcare",    hue: "sky",      icon: Stethoscope, tagline: "Compliance-grade workflows",            body: "SOPs with audit trail, scoped access, training compliance, and the people layer to back it all up." },
  { slug: "manufacturing", name: "Manufacturing", hue: "emerald",  icon: Factory,     tagline: "Shop floor + SOPs + KPIs",              body: "Per-shift KPIs, vendor + procurement, SOP runs, daily standups — built for plants and multi-site ops." },
  { slug: "logistics",     name: "Logistics",     hue: "amber",    icon: Truck,       tagline: "Fleet, hubs, daily routes",             body: "Route SLAs as KPIs, hub-level performance dashboards, driver onboarding, and field-team scheduling." },
  { slug: "services",      name: "Services",      hue: "pink",     icon: Briefcase,   tagline: "Projects, billables, capacity",         body: "Project P&L, capacity by role, billable utilization tied to performance, client portals on top." },
  { slug: "sales",         name: "Sales",         hue: "fuchsia",  icon: TrendingUp,  tagline: "Pipeline + people in one",              body: "Forecasting, quotas as KPIs, pipeline reviews as cadence, rep onboarding and ramp — all under one roof." },
  { slug: "real-estate",   name: "Real Estate",   hue: "rose",     icon: Home,        tagline: "Listings, leads, deals",                body: "Listing inventory, lead pipelines per agent, deal stages, commissions and comp bands — all in workwrk." },
];

export default function IndustriesPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="sky" className="mb-5">Industries</Eyebrow>
            <H1>
              One platform. <br />
              <GradientText hue="sky">Built for your sector.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              workwrk ships with sector-specific templates — KPIs, SOPs, review
              cycles, comp bands — so your team is operational the same week
              you sign up.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/signup" variant="secondary" hue="sky" size="lg" rightIcon={<ArrowRight size={15} />}>
                Start with templates
              </Button>
              <Button href="/demo" variant="outline" size="lg">Talk to an expert</Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {INDUSTRIES.map((ind) => {
              const t = HUES[ind.hue];
              const Icon = ind.icon;
              return (
                <Link
                  key={ind.slug}
                  href={`/industries/${ind.slug}`}
                  className="group relative p-7 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 hover:-translate-y-0.5 transition shadow-sm hover:shadow-[0_18px_50px_-18px_rgba(15,23,42,0.18)] overflow-hidden"
                >
                  <div className={`absolute inset-x-0 -top-px h-[3px] bg-gradient-to-r ${t.gradVia}`} aria-hidden />
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${t.gradVia} text-white`}>
                    <Icon size={22} strokeWidth={2.4} />
                  </div>
                  <p className="mt-5 font-extrabold text-slate-900 text-xl tracking-tight">{ind.name}</p>
                  <p className={`mt-1 text-xs font-bold uppercase tracking-[0.14em] ${t.text}`}>{ind.tagline}</p>
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed">{ind.body}</p>
                  <span className={`mt-5 inline-flex items-center gap-1 text-sm font-semibold ${t.text} group-hover:gap-2 transition-all`}>
                    See how → <ArrowRight size={13} />
                  </span>
                </Link>
              );
            })}
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
            <div>
              <Eyebrow hue="emerald" className="mb-4">Why sector matters</Eyebrow>
              <H2>Templates first, customization second.</H2>
              <p className="mt-5 text-slate-600 text-lg leading-relaxed">
                Generic platforms make you build everything from scratch.
                workwrk ships with the patterns your industry already runs on
                — then lets you customize where it actually matters.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                ["KPI templates",   "Pre-built per sector. Tweak weights, not the math.", "violet"],
                ["SOP libraries",   "Reference SOPs you can fork. Ship audit-ready in days.", "emerald"],
                ["Review cycles",   "Cadence and competency models that match your industry.", "fuchsia"],
                ["Role + comp bands", "Sector-typical role ladders and comp bands.", "amber"],
              ].map(([title, body, hue]) => {
                const t = HUES[hue as Hue];
                return (
                  <div key={title} className={`p-5 bg-white rounded-2xl border ${t.border}`}>
                    <p className={`font-bold text-sm ${t.textStrong}`}>{title}</p>
                    <p className="mt-1.5 text-sm text-slate-600">{body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </Container>
      </Section>

      <CTABand hue="sky" />
    </>
  );
}
