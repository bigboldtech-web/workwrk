import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Code, Webhook, BookOpen, Terminal, GitBranch, Zap } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  Button,
  CTABand,
  FeatureCard,
  GradientText,
  HUES,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Developers — WorkwrK",
  description: "REST + GraphQL API, webhooks on every entity, type-safe SDKs in TS / Python / Go. Build automations, integrations, and extensions on top of workwrk.",
  alternates: { canonical: "https://workwrk.com/developers" },
};

const CODE_EXAMPLES = [
  {
    title: "Create a person",
    lang: "ts",
    code: `import { Workwrk } from "@workwrk/sdk";
const wwk = new Workwrk({ apiKey: process.env.WORKWRK_KEY });

await wwk.people.create({
  name: "Priya Iyer",
  email: "priya@helios.com",
  role: "Head of Ops",
  location: "Bengaluru",
});`,
  },
  {
    title: "Subscribe to KPI changes",
    lang: "ts",
    code: `// Webhook: POST /your-endpoint
{
  "event": "kpi.score_changed",
  "payload": {
    "personId": "p_abc",
    "kpiId": "k_xyz",
    "previous": 78,
    "current": 92,
    "period": "2026-05"
  }
}`,
  },
  {
    title: "Query with GraphQL",
    lang: "graphql",
    code: `query TeamPerf {
  team(id: "t_eng") {
    members {
      name
      compositeScore
      kpis { name value target }
    }
  }
}`,
  },
];

export default function DevelopersPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
            <div>
              <Eyebrow hue="indigo" className="mb-5">Developers</Eyebrow>
              <H1>
                The API the product <GradientText hue="indigo">runs on.</GradientText>
              </H1>
              <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-xl">
                Same REST + GraphQL endpoints workwrk uses internally. Type-safe
                SDKs. Webhooks on every entity. Build automations, integrations,
                or embeds — without backfilling our APIs.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="#docs" variant="secondary" hue="indigo" size="lg" rightIcon={<ArrowRight size={15} />}>
                  Read the docs
                </Button>
                <Button href="https://github.com/workwrk" variant="outline" size="lg" leftIcon={<GitBranch size={15} />}>
                  GitHub
                </Button>
              </div>
            </div>

            <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-[0_30px_80px_-20px_rgba(15,23,42,0.45)]">
              <div className="h-9 bg-slate-800 border-b border-slate-700 flex items-center gap-2 px-4">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="ml-3 text-[11px] text-slate-400 font-mono">{CODE_EXAMPLES[0].title}</span>
              </div>
              <pre className="p-5 text-[12px] leading-relaxed text-slate-200 font-mono overflow-x-auto">
                <code>{CODE_EXAMPLES[0].code}</code>
              </pre>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg" id="docs">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="emerald" className="mb-4">Capabilities</Eyebrow>
            <H2>Build <GradientText hue="emerald">on the platform</GradientText>.</H2>
          </div>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard hue="violet"  icon={Code}     title="REST + GraphQL"  body="Two ways to query. REST for simple flows; GraphQL for nested entities. Same auth, same rate limits." />
            <FeatureCard hue="emerald" icon={Webhook}  title="Webhooks"        body="Every entity emits events on create / update / delete. Signed payloads, retries with exponential backoff." />
            <FeatureCard hue="fuchsia" icon={Terminal} title="SDKs"            body="TypeScript, Python, Go. Type-safe, autocomplete-friendly, kept in sync with the API surface." />
            <FeatureCard hue="amber"   icon={BookOpen} title="Reference docs"  body="OpenAPI 3.1 spec, interactive playground, real example payloads. Built with Stoplight." />
            <FeatureCard hue="sky"     icon={Zap}      title="Rate limits"     body="Generous defaults (1000 req/min on Growth, 10,000 on Scale). Burst-tolerant. Custom quotas on Scale." />
            <FeatureCard hue="indigo"  icon={GitBranch}   title="Open SDKs"        body="SDKs are MIT-licensed and on GitHub. Issue trackers, PR-friendly maintainers." />
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="indigo" className="mb-4">Snippets</Eyebrow>
            <H2>Three lines from the docs.</H2>
          </div>
          <div className="mt-10 grid lg:grid-cols-3 gap-5">
            {CODE_EXAMPLES.map((ex) => (
              <div key={ex.title} className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
                <div className="px-4 h-9 border-b border-slate-700 flex items-center justify-between">
                  <span className="text-[11px] text-slate-300 font-semibold">{ex.title}</span>
                  <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">{ex.lang}</span>
                </div>
                <pre className="p-4 text-[11.5px] leading-relaxed text-slate-200 font-mono overflow-x-auto">
                  <code>{ex.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <CTABand
        hue="indigo"
        title={<>Build something on <GradientText hue="emerald">workwrk</GradientText>.</>}
        body="API keys live in workspace settings. Need help? developers@workwrk.com — we respond fast."
        primary={{ label: "Get an API key",  href: "/signup?source=dev" }}
        secondary={{ label: "Talk to engineering", href: "mailto:developers@workwrk.com" }}
      />
    </>
  );
}
