import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Handshake, Wrench, Code, BarChart3, DollarSign, Globe } from "lucide-react";
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
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Partners — WorkwrK",
  description: "Build with us. Three partner tracks: implementation, integration, and resell. Generous economics, real co-marketing, no lock-in.",
  alternates: { canonical: "https://workwrk.com/partners" },
};

const PROGRAMS: readonly { hue: Hue; icon: typeof Wrench; title: string; body: string; reward: string }[] = [
  {
    hue: "violet",  icon: Wrench, title: "Implementation Partners",
    body: "Consulting firms, agencies, and operators who help customers roll out workwrk. Get certified, get qualified leads.",
    reward: "20% rev share for the first year",
  },
  {
    hue: "emerald", icon: Code, title: "Integration Partners",
    body: "Software companies whose product belongs next to workwrk. Build a native integration, get featured, drive mutual adoption.",
    reward: "Co-marketing + GTM support",
  },
  {
    hue: "fuchsia", icon: DollarSign, title: "Reseller Partners",
    body: "Distributors and VARs in India, UAE, SEA who sell workwrk to their book of business. Generous economics, full GTM enablement.",
    reward: "30% margin on first-year ACV",
  },
];

const PARTNERS_PREVIEW = ["Brindle Consulting", "Quartz Implementation", "Apex Cloud Group", "Helix Advisors", "Stratus Partners", "Numero One", "Edge Catalyst", "Flux GTM"];

export default function PartnersPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="emerald" className="mb-5">Partners</Eyebrow>
            <H1>
              Build with us. <br />
              <GradientText hue="emerald">Grow with us.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Three partner tracks, generous economics, real co-marketing, and a
              support team that actually picks up the phone. No lock-in, no
              exclusivity, no NDA-only nonsense.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="mailto:partners@workwrk.com" variant="secondary" hue="emerald" size="lg" rightIcon={<ArrowRight size={15} />}>
                Become a partner
              </Button>
              <Button href="/developers" variant="outline" size="lg">For developers</Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="fuchsia" className="mb-4">Three tracks</Eyebrow>
            <H2>Pick the partner program <GradientText hue="fuchsia">that fits.</GradientText></H2>
          </div>
          <div className="mt-10 grid md:grid-cols-3 gap-5">
            {PROGRAMS.map((p) => {
              const t = HUES[p.hue];
              return (
                <div key={p.title} className="relative p-7 bg-white border border-slate-200 rounded-2xl">
                  <div className={`absolute inset-x-0 -top-px h-[3px] bg-gradient-to-r ${t.gradVia}`} aria-hidden />
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${t.gradVia} text-white`}>
                    <p.icon size={20} strokeWidth={2.4} />
                  </div>
                  <p className="mt-5 font-bold text-slate-900 text-lg tracking-tight">{p.title}</p>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{p.body}</p>
                  <div className={`mt-5 inline-flex items-center text-xs font-bold uppercase tracking-[0.14em] px-3 h-7 rounded-full ${t.bgTint} ${t.text} border ${t.border}`}>
                    {p.reward}
                  </div>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
            <div>
              <Eyebrow hue="violet" className="mb-4">What you get</Eyebrow>
              <H2>Everything to land + grow.</H2>
              <p className="mt-4 text-slate-600">No bait-and-switch. The same things our own GTM team gets.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <FeatureCard hue="violet" icon={Handshake}  title="Qualified pipeline"   body="Pre-vetted leads from our inbound funnel routed to certified partners." />
              <FeatureCard hue="emerald" icon={BarChart3} title="Partner portal"        body="Real-time pipeline, commission tracking, marketing collateral, certification." />
              <FeatureCard hue="amber"  icon={Globe}      title="Co-marketing"           body="Featured logos, joint webinars, customer story development, conference sponsorships." />
              <FeatureCard hue="fuchsia" icon={DollarSign} title="Generous economics"   body="20–30% revenue share. Stacks across multi-year deals. Pays within 30 days of customer pay." />
            </div>
          </div>
        </Container>
      </Section>

      <Section py="md">
        <Container>
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Active partners</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {PARTNERS_PREVIEW.map((p) => (
                <span key={p} className="text-slate-400 font-bold text-lg tracking-tight">{p}</span>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <CTABand
        hue="emerald"
        title={<>Ready to <GradientText hue="amber">partner</GradientText>?</>}
        body="Fill out a short form. We'll get back to you within 3 business days."
        primary={{ label: "Apply to partner program", href: "mailto:partners@workwrk.com" }}
        secondary={{ label: "Talk to our team",        href: "/contact" }}
      />
    </>
  );
}
