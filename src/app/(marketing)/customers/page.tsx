import type { Metadata } from "next";
import { ArrowRight, Quote as QuoteIcon } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  Button,
  CTABand,
  StatCard,
  Quote,
  GradientText,
  LogoCloud,
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Customers — WorkwrK",
  description:
    "How real operators run their businesses on workwrk. 500+ teams, 8 countries, every industry from manufacturing to AI labs.",
  alternates: { canonical: "https://workwrk.com/customers" },
};

const CASE_STUDIES: readonly { hue: Hue; metric: string; metricLabel: string; quote: string; author: string; role: string; company: string; industry: string }[] = [
  { hue: "violet",  metric: "62%",  metricLabel: "tool spend reduction",    quote: "We cancelled six tools in 90 days. Our ops director now opens one tab in the morning, not twelve.",                                          author: "Priya Iyer",     role: "COO",           company: "Helios Labs",       industry: "Technology" },
  { hue: "emerald", metric: "4.2x", metricLabel: "faster perf cycles",      quote: "Performance reviews used to take 6 weeks across 4 tools. Now it's 10 days, all in workwrk, with better data.",                              author: "Daniel Park",    role: "VP People",     company: "Forge Capital",     industry: "Financial Services" },
  { hue: "fuchsia", metric: "92",   metricLabel: "internal NPS",            quote: "The team actually likes the tool. That sounds trite. After three failed HRMS rollouts, it really isn't.",                                    author: "Anita Sharma",   role: "Head of HR",    company: "Quill Health",      industry: "Healthcare" },
  { hue: "amber",   metric: "100%", metricLabel: "SOP compliance",          quote: "Audit went from a quarterly nightmare to a screenshot. SOPs run inside workwrk, the audit trail is automatic.",                              author: "Karim Al-Saadi", role: "VP Ops",        company: "Stratum Logistics", industry: "Logistics" },
];

const OUTCOMES = [
  { label: "Avg tools replaced",          value: "15+",  hue: "violet"  as const },
  { label: "Time to first KPI dashboard", value: "2 days", hue: "emerald" as const },
  { label: "Customers across geos",       value: "8 countries", hue: "fuchsia" as const },
  { label: "Industry verticals served",   value: "7+",  hue: "amber"   as const },
];

export default function CustomersPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="violet" className="mb-5">Customers</Eyebrow>
            <H1>
              The operators who replaced <br />
              <GradientText hue="violet">their tool stack with workwrk.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              500+ teams across 8 countries run their business on one platform.
              Here&apos;s what changed when they made the switch.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/signup" variant="secondary" hue="violet" size="lg" rightIcon={<ArrowRight size={15} />}>
                Join them — start free
              </Button>
              <Button href="/demo" variant="outline" size="lg">Talk to a customer</Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="md">
        <Container>
          <LogoCloud title="500+ teams across" brands={["Helios Labs", "Forge Capital", "Quill Health", "Stratum Logistics", "Nimbus Manufacturing", "Lattice & Co", "Brindle Estates", "Crest AI"]} />
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="emerald" className="mb-4">Outcomes</Eyebrow>
            <H2>Four numbers <GradientText hue="emerald">that move</GradientText>.</H2>
          </div>
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {OUTCOMES.map((o) => (
              <StatCard key={o.label} hue={o.hue} value={o.value} label={o.label} />
            ))}
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="fuchsia" className="mb-4">Case studies</Eyebrow>
            <H2>Real operators. <GradientText hue="fuchsia">Real numbers.</GradientText></H2>
          </div>
          <div className="mt-12 grid md:grid-cols-2 gap-5">
            {CASE_STUDIES.map((c) => {
              const t = HUES[c.hue];
              return (
                <article
                  key={c.author}
                  className={`relative p-8 bg-white rounded-3xl border ${t.border} overflow-hidden`}
                >
                  <div className={`absolute -top-12 -right-8 w-48 h-48 rounded-full bg-gradient-to-br ${t.gradVia} opacity-20 blur-2xl pointer-events-none`} aria-hidden />
                  <div className="relative">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] px-3 h-7 rounded-full ${t.bgTint} ${t.text} border ${t.border}`}>
                      {c.industry}
                    </span>
                    <p className={`mt-5 text-5xl font-extrabold bg-gradient-to-br ${t.gradVia} bg-clip-text text-transparent`}>
                      {c.metric}
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-600">{c.metricLabel}</p>
                    <blockquote className="mt-6 text-lg text-slate-800 leading-snug font-medium">
                      <QuoteIcon size={20} className={`${t.text} opacity-40 inline -mt-3 mr-1`} />
                      {c.quote}
                    </blockquote>
                    <figcaption className="mt-6 pt-6 border-t border-slate-100 text-sm">
                      <span className="font-bold text-slate-900">{c.author}</span>
                      <span className="text-slate-500"> · {c.role}, {c.company}</span>
                    </figcaption>
                  </div>
                </article>
              );
            })}
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <Quote
            hue="amber"
            quote="The pitch is simple — one platform, one bill, one tab. The proof is that we never miss a Tuesday standup anymore because the inbox does the chasing for us."
            author="Sarah Chen"
            role="Founder + CEO"
            company="Crest AI"
          />
        </Container>
      </Section>

      <CTABand
        hue="violet"
        title={<>Your story <GradientText hue="amber">next</GradientText>?</>}
        body="Start free under five people. Scale into a full deployment when you're ready."
      />
    </>
  );
}
