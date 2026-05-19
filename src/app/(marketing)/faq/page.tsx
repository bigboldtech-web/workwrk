import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
  title: "FAQ — WorkwrK",
  description: "Frequently asked questions about workwrk — the product, pricing, security, AI, integrations, and more.",
  alternates: { canonical: "https://workwrk.com/faq" },
};

const GROUPS: readonly { name: string; hue: Hue; items: readonly { q: string; a: string }[] }[] = [
  {
    name: "Product",
    hue: "violet",
    items: [
      { q: "What is workwrk?",                          a: "An all-in-one business operating system. 7 hubs (Home, People, Work, Money, Talent, Culture, Growth) on one data model. Replaces 15+ disconnected SaaS tools." },
      { q: "How is workwrk different from an HRMS?",    a: "An HRMS handles payroll, leave, attendance. workwrk handles the operational layer above that — KPIs, OKRs, SOPs, performance, recognition, AI. They're complementary, but workwrk is the system most teams find more valuable." },
      { q: "What does 'business operating system' mean?", a: "A single platform that runs the people, processes, performance, money, and recognition of your business — instead of fragmented apps stitched together by spreadsheets and Slack." },
      { q: "Is workwrk a single product or a suite?",   a: "Single product, multiple hubs. Same data model, same UX, one bill. Hubs are surfaces of the same software." },
    ],
  },
  {
    name: "Pricing",
    hue: "emerald",
    items: [
      { q: "Is the free plan really forever?",          a: "Yes — under 5 people, no time limit, all hubs unlocked. Roughly 40% of paid customers spent 6+ months on free before upgrading." },
      { q: "What's the paid price?",                     a: "$8 per user / month on Growth. Annual saves 18%. Scale is custom from $29,999/year." },
      { q: "Do I pay for contractors or guests?",        a: "No. Guests, contractors with view-only, and external auditors are free." },
      { q: "Hidden fees, upsells, surcharges?",          a: "None. Per-module pricing doesn't exist at workwrk; everything is bundled. Add-ons (implementation help, on-prem, etc.) are clearly priced on the pricing page." },
    ],
  },
  {
    name: "AI",
    hue: "indigo",
    items: [
      { q: "What AI features are included?",            a: "Cmd-K AI search, inbox triage, cross-module signals, reviewer copilot, plain-English business questions over your data." },
      { q: "Is my data used to train the model?",        a: "No. Per-workspace embeddings, encrypted at rest, deleted when you leave. Your data is never used to train a foundation model." },
      { q: "Which model powers workwrk AI?",             a: "Claude 4.7 as the primary model. Some structured tasks use smaller specialized models. Per-customer model pinning available on Scale." },
    ],
  },
  {
    name: "Security",
    hue: "rose",
    items: [
      { q: "What certs do you hold?",                   a: "SOC 2 Type II, ISO 27001, GDPR + DPDP (India). HIPAA available for Scale customers." },
      { q: "Where is my data stored?",                   a: "US, EU, or India residency. Pinned at workspace creation. End-to-end honored for storage, AI retrieval, and backups." },
      { q: "Do you offer SSO and SCIM?",                 a: "Yes — SAML SSO and SCIM included on Scale. Google Workspace SSO included on every paid plan." },
    ],
  },
  {
    name: "Migrations",
    hue: "amber",
    items: [
      { q: "Can I import from existing tools?",         a: "Yes — one-click importers for BambooHR, Workday, Rippling, Justworks, Asana, Monday, Lattice, Bonusly. CSV import for anything else." },
      { q: "How long does a migration take?",            a: "Most teams under 50 people: 1 week. 50-250: 2-3 weeks. 250+: 4-6 weeks with implementation help (optional add-on)." },
      { q: "Do you preserve historical perf data?",       a: "Yes — we can import historical review cycles, KPI history, and tenure data so reports stay accurate." },
    ],
  },
  {
    name: "Geography",
    hue: "sky",
    items: [
      { q: "Is workwrk built for India / UAE / SEA?",   a: "Yes — first-class. INR/AED/SGD pricing, multi-currency, multi-location org charts, IST-friendly workflow engine. We have offices in Bengaluru, Dubai, and Singapore." },
      { q: "Do you serve customers in the US / EU?",     a: "Yes — globally. EU customers get EU data residency. US customers can opt for US-only deployments on Scale." },
      { q: "Multi-language support?",                     a: "UI in English currently; Hindi, Arabic, Mandarin, Spanish in beta. Roadmap on /roadmap." },
    ],
  },
];

export default function FAQPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="violet" className="mb-5">FAQ</Eyebrow>
            <H1>
              Quick answers. <GradientText hue="violet">No corporate fog.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              If your question isn&apos;t answered here, the team responds to{" "}
              <Link href="mailto:hello@workwrk.com" className="font-semibold text-slate-900 underline underline-offset-2">
                hello@workwrk.com
              </Link>{" "}
              within 4 business hours.
            </p>
          </div>

          {/* Jump nav */}
          <div className="mt-10 flex flex-wrap gap-2">
            {GROUPS.map((g) => {
              const t = HUES[g.hue];
              return (
                <a
                  key={g.name}
                  href={`#${g.name.toLowerCase()}`}
                  className={`inline-flex items-center text-xs font-bold uppercase tracking-[0.14em] px-3 h-8 rounded-full bg-white border ${t.border} ${t.text} hover:scale-105 transition`}
                >
                  {g.name}
                </a>
              );
            })}
          </div>
        </Container>
      </Section>

      {GROUPS.map((g, i) => {
        const t = HUES[g.hue];
        const altRow = i % 2 === 1;
        return (
          <section key={g.name} id={g.name.toLowerCase()} className={`scroll-mt-20 ${altRow ? "bg-slate-50" : "bg-white"} py-16 lg:py-20`}>
            <Container>
              <div className="grid lg:grid-cols-[1fr_2fr] gap-12 items-start">
                <div>
                  <Eyebrow hue={g.hue}>{g.name}</Eyebrow>
                  <H2 className="mt-5">{g.name}</H2>
                </div>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-white">
                  {g.items.map((it, ii) => (
                    <details key={ii} className="group p-6 lg:p-7 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex items-center justify-between gap-6 cursor-pointer list-none">
                        <span className="font-semibold text-slate-900 text-base">{it.q}</span>
                        <span className={`w-8 h-8 rounded-full ${t.bgTint} ${t.text} flex items-center justify-center transition group-open:rotate-45`}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 1v12M1 7h12" /></svg>
                        </span>
                      </summary>
                      <div className="mt-4 text-slate-600 leading-relaxed text-[15px]">{it.a}</div>
                    </details>
                  ))}
                </div>
              </div>
            </Container>
          </section>
        );
      })}

      <CTABand
        hue="violet"
        title="Still have a question?"
        body="We'll get you an answer within 4 business hours."
        primary={{ label: "Email hello@workwrk.com", href: "mailto:hello@workwrk.com" }}
        secondary={{ label: "Book a demo", href: "/demo" }}
      />
    </>
  );
}
