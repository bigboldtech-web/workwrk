import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles, Eye, Hammer, Rocket } from "lucide-react";
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
  title: "Roadmap — WorkwrK",
  description: "What's shipping next. Concept → Building → Shipping → Live. Public, honest, updated weekly.",
  alternates: { canonical: "https://workwrk.com/roadmap" },
};

type Stage = "concept" | "building" | "shipping" | "live";
const STAGE_META: Record<Stage, { label: string; hue: Hue; icon: typeof Eye }> = {
  concept:  { label: "Concept",  hue: "indigo",  icon: Eye      },
  building: { label: "Building", hue: "amber",   icon: Hammer   },
  shipping: { label: "Shipping", hue: "fuchsia", icon: Rocket   },
  live:     { label: "Live",     hue: "emerald", icon: Sparkles },
};

const ITEMS: readonly { stage: Stage; quarter: string; title: string; body: string }[] = [
  { stage: "shipping", quarter: "Q2 2026", title: "Workflow Builder GA",            body: "Visual no-code workflow builder spanning all hubs. Drag-and-drop triggers, conditions, actions across people / work / money." },
  { stage: "shipping", quarter: "Q2 2026", title: "Mobile native apps",              body: "iOS + Android native — offline SOP runs, KPI entry, push notifications. Beta this quarter; GA next." },
  { stage: "building", quarter: "Q3 2026", title: "Hindi + Arabic UI localization",  body: "Full UI translation for our two largest non-English markets. Then Spanish + Mandarin Q4." },
  { stage: "building", quarter: "Q3 2026", title: "Custom AI personas",              body: "Per-workspace AI personas with custom system prompts and tone. Aligns AI voice with your culture." },
  { stage: "building", quarter: "Q3 2026", title: "Advanced comp planning",          body: "Multi-cycle, multi-currency comp planning with budget-aware recommendations and approval chains." },
  { stage: "concept",  quarter: "Q4 2026", title: "Workforce planning",              body: "Headcount planning, scenario modeling, hiring plan ↔ budget reconciliation." },
  { stage: "concept",  quarter: "Q4 2026", title: "Customer 360 + onboarding journeys", body: "Bring the depth of the People profile to your customers. CSM workflows, account 360, renewals tied to KPIs." },
  { stage: "concept",  quarter: "Q1 2027", title: "Native EHR (HL7/FHIR)",            body: "First-party EHR integration for healthcare customers. Epic + Cerner + Athena out of the box." },
  { stage: "live",     quarter: "Q1 2026", title: "AI Engine GA",                     body: "Cmd-K, inbox triage, cross-module signals. Live as of v4.0." },
  { stage: "live",     quarter: "Q1 2026", title: "Procurement + vendor scorecards",   body: "Money hub expansion. Live since v3.8." },
];

export default function RoadmapPage() {
  const grouped = (["shipping", "building", "concept", "live"] as Stage[]).map((s) => ({
    stage: s,
    meta: STAGE_META[s],
    items: ITEMS.filter((i) => i.stage === s),
  }));
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="fuchsia" className="mb-5">Roadmap</Eyebrow>
            <H1>
              What we&apos;re building <br />
              <GradientText hue="fuchsia">in public.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Four stages — Concept, Building, Shipping, Live. Honest about what's
              shipping when. Updated weekly. Suggest a feature, watch it move stages.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="mailto:product@workwrk.com" variant="secondary" hue="fuchsia" size="lg" rightIcon={<ArrowRight size={15} />}>
                Suggest a feature
              </Button>
              <Button href="/changelog" variant="outline" size="lg">See what shipped</Button>
            </div>
          </div>
        </Container>
      </Section>

      {grouped.map((g, i) => {
        const t = HUES[g.meta.hue];
        const Icon = g.meta.icon;
        const altRow = i % 2 === 1;
        return (
          <section key={g.stage} className={`${altRow ? "bg-slate-50" : "bg-white"} py-16 lg:py-20`}>
            <Container>
              <div className="flex items-center gap-4 mb-10">
                <span className={`w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${t.gradVia} text-white`}>
                  <Icon size={22} strokeWidth={2.4} />
                </span>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-[0.16em] ${t.text}`}>Stage</p>
                  <H2 className="!text-3xl">{g.meta.label}</H2>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {g.items.map((item) => (
                  <div key={item.title} className="p-6 bg-white border border-slate-200 rounded-2xl">
                    <div className="flex items-center justify-between">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${t.text}`}>{item.quarter}</p>
                      <span className={`text-[10px] font-bold uppercase tracking-[0.16em] px-2 h-5 inline-flex items-center rounded-full ${t.bgTint} ${t.text} border ${t.border}`}>
                        {g.meta.label}
                      </span>
                    </div>
                    <p className="mt-3 font-bold text-slate-900 text-lg tracking-tight">{item.title}</p>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.body}</p>
                  </div>
                ))}
              </div>
            </Container>
          </section>
        );
      })}

      <CTABand
        hue="fuchsia"
        title={<>Got an idea we should be <GradientText hue="amber">building</GradientText>?</>}
        body="Drop a note — feature requests move stages quickly when they hit a real customer need."
        primary={{ label: "Suggest a feature", href: "mailto:product@workwrk.com" }}
        secondary={{ label: "See changelog",    href: "/changelog" }}
      />
    </>
  );
}
