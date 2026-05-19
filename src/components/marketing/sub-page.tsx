// Shared shells for feature + industry sub-pages. Both follow a tight
// pattern (hero, capability grid, "fits in the platform" cross-links,
// FAQ, CTA), so we abstract them into two functions so each sub-page
// file is ~50 lines of data instead of 200 lines of layout.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  H3,
  Lede,
  Button,
  FeatureCard,
  FAQ,
  CTABand,
  Quote,
  GradientText,
  CheckList,
  HUES,
  HUBS,
  type Hue,
} from "@/components/marketing/primitives";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface Capability {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface FAQItem {
  q: string;
  a: ReactNode;
}

export interface FeatureSubPageProps {
  hubSlug: string;
  hue: Hue;
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  capabilities: readonly Capability[];
  workflowTitle?: string;
  workflowSteps?: readonly string[];
  testimonial?: { quote: string; author: string; role: string; company: string };
  faq?: readonly FAQItem[];
  relatedSlugs?: readonly string[];
  // Optional extra section rendered just before the closing CTA band.
  bottomSlot?: ReactNode;
}

const ALL_FEATURE_LINKS: Record<string, { title: string; body: string; hue: Hue }> = {
  kpis:        { title: "KPIs",          body: "Track, weight, score — tied to performance.",   hue: "sky" },
  kras:        { title: "KRAs",          body: "Key result areas linked to roles.",              hue: "sky" },
  tasks:       { title: "Tasks",         body: "Auto-escalation when overdue.",                  hue: "sky" },
  sops:        { title: "SOPs",          body: "Process docs with compliance runs.",             hue: "sky" },
  okrs:        { title: "OKRs",          body: "Cascade with auto-rollup.",                      hue: "sky" },
  reviews:     { title: "Reviews",       body: "360° cycles with weighted scoring.",             hue: "violet" },
  people:      { title: "People",        body: "Org chart + roles + history.",                   hue: "violet" },
  access:      { title: "Access",        body: "Roles, audit log, scoped sharing.",              hue: "violet" },
  kudos:       { title: "Kudos",         body: "Recognition tied to performance.",               hue: "pink" },
  "ai-engine": { title: "AI Engine",     body: "Cmd-K, inbox triage, signals.",                  hue: "indigo" },
  analytics:   { title: "Analytics",     body: "Role-aware dashboards.",                         hue: "indigo" },
  integrations:{ title: "Integrations",  body: "Slack, Google, Microsoft, more.",                hue: "emerald" },
};

export function FeatureSubPage({
  hubSlug,
  hue,
  eyebrow,
  title,
  lede,
  capabilities,
  workflowTitle,
  workflowSteps,
  testimonial,
  faq,
  relatedSlugs,
  bottomSlot,
}: FeatureSubPageProps) {
  const hub = HUBS.find((h) => h.slug === hubSlug);
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue={hue} className="mb-5">{eyebrow}</Eyebrow>
            <H1>{title}</H1>
            <div className="mt-6">
              <Lede>{lede}</Lede>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/signup" variant="secondary" hue={hue} size="lg" rightIcon={<ArrowRight size={15} />}>
                Try it free
              </Button>
              <Button href="/demo" variant="outline" size="lg">Get a tour</Button>
            </div>
            {hub && (
              <p className="mt-7 text-sm text-slate-500">
                Part of the <Link href={`/features#${hub.slug}`} className={`font-semibold ${HUES[hue].text} underline-offset-2 hover:underline`}>{hub.name}</Link> hub.
              </p>
            )}
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue={hue} className="mb-4">What you get</Eyebrow>
            <H2>Core capabilities.</H2>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {capabilities.map((c) => (
              <FeatureCard key={c.title} hue={hue} icon={c.icon} title={c.title} body={c.body} />
            ))}
          </div>
        </Container>
      </Section>

      {workflowSteps && workflowSteps.length > 0 && (
        <Section variant="tint" py="lg">
          <Container>
            <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
              <div>
                <Eyebrow hue={hue} className="mb-4">How it works</Eyebrow>
                <H2>{workflowTitle ?? "One workflow, zero context-switching."}</H2>
              </div>
              <ol className="space-y-3">
                {workflowSteps.map((step, i) => {
                  const t = HUES[hue];
                  return (
                    <li
                      key={step}
                      className="relative pl-14 pr-5 py-4 bg-white border border-slate-200 rounded-2xl flex items-center gap-4"
                    >
                      <span
                        className={`absolute left-4 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-extrabold bg-gradient-to-br ${t.gradVia}`}
                      >
                        {i + 1}
                      </span>
                      <span className="text-sm text-slate-700">{step}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Container>
        </Section>
      )}

      {relatedSlugs && relatedSlugs.length > 0 && (
        <Section py="lg">
          <Container>
            <div className="max-w-2xl">
              <Eyebrow hue="violet" className="mb-4">Plays well with</Eyebrow>
              <H2>One platform. <GradientText hue="violet">Many surfaces.</GradientText></H2>
            </div>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {relatedSlugs.map((slug) => {
                const r = ALL_FEATURE_LINKS[slug];
                if (!r) return null;
                const t = HUES[r.hue];
                return (
                  <Link
                    key={slug}
                    href={`/features/${slug}`}
                    className="group p-5 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 hover:-translate-y-0.5 transition shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <p className={`font-bold text-slate-900 tracking-tight`}>{r.title}</p>
                      <ArrowRight size={14} className={`${t.text} group-hover:translate-x-0.5 transition`} />
                    </div>
                    <p className="mt-1.5 text-sm text-slate-600">{r.body}</p>
                  </Link>
                );
              })}
            </div>
          </Container>
        </Section>
      )}

      {testimonial && (
        <Section variant="tint" py="lg">
          <Container>
            <Quote hue={hue} {...testimonial} />
          </Container>
        </Section>
      )}

      {faq && faq.length > 0 && <FAQ items={faq} hue={hue} eyebrow="Common questions" title="Frequently asked." />}

      {bottomSlot}

      <CTABand hue={hue} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Industry sub-page shell
// ════════════════════════════════════════════════════════════════════

export interface IndustrySubPageProps {
  hue: Hue;
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  pains: readonly string[];
  capabilities: readonly Capability[];
  kpisLabel?: string;
  kpis?: readonly string[];
  testimonial?: { quote: string; author: string; role: string; company: string };
  faq?: readonly FAQItem[];
}

export function IndustrySubPage({
  hue,
  eyebrow,
  title,
  lede,
  pains,
  capabilities,
  kpisLabel = "Templates ready for day one",
  kpis,
  testimonial,
  faq,
}: IndustrySubPageProps) {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue={hue} className="mb-5">Industries · {eyebrow}</Eyebrow>
            <H1>{title}</H1>
            <div className="mt-6"><Lede>{lede}</Lede></div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/signup" variant="secondary" hue={hue} size="lg" rightIcon={<ArrowRight size={15} />}>
                Start with templates
              </Button>
              <Button href="/demo" variant="outline" size="lg">Talk to a specialist</Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
            <div>
              <Eyebrow hue={hue} className="mb-4">The problems</Eyebrow>
              <H2>Sound familiar?</H2>
              <p className="mt-4 text-slate-600">If any of these are you, workwrk was built for you.</p>
            </div>
            <ul className="space-y-2.5">
              {pains.map((p, i) => {
                const t = HUES[hue];
                return (
                  <li key={i} className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3">
                    <span className={`mt-0.5 w-7 h-7 rounded-lg ${t.bgTint} ${t.text} border ${t.border} flex items-center justify-center text-xs font-extrabold flex-shrink-0`}>
                      {i + 1}
                    </span>
                    <span className="text-[15px] text-slate-700 leading-snug">{p}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue={hue} className="mb-4">What you get</Eyebrow>
            <H2>Sector-specific capabilities.</H2>
          </div>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {capabilities.map((c) => (
              <FeatureCard key={c.title} hue={hue} icon={c.icon} title={c.title} body={c.body} />
            ))}
          </div>
        </Container>
      </Section>

      {kpis && kpis.length > 0 && (
        <Section py="md">
          <Container>
            <div className="grid lg:grid-cols-[1fr_2fr] gap-12 items-start">
              <div>
                <Eyebrow hue={hue} className="mb-4">Templates</Eyebrow>
                <H3>{kpisLabel}</H3>
              </div>
              <div className="flex flex-wrap gap-2">
                {kpis.map((k) => {
                  const t = HUES[hue];
                  return (
                    <span key={k} className={`inline-flex items-center text-xs font-bold px-3 h-8 rounded-full bg-white border ${t.border} ${t.textStrong}`}>
                      {k}
                    </span>
                  );
                })}
              </div>
            </div>
          </Container>
        </Section>
      )}

      {testimonial && (
        <Section py="lg">
          <Container>
            <Quote hue={hue} {...testimonial} />
          </Container>
        </Section>
      )}

      {faq && faq.length > 0 && <FAQ items={faq} hue={hue} eyebrow="Common questions" title="Frequently asked." />}

      <CTABand hue={hue} />
    </>
  );
}
