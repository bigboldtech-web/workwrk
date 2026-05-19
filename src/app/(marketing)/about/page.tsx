import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, Heart, Wrench, Globe } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  H3,
  Button,
  FeatureCard,
  CTABand,
  Quote,
  StatCard,
  GradientText,
  HUES,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "About — WorkwrK",
  description:
    "WorkwrK is the business operating system for teams who outgrew spreadsheets but can't afford Workday. Built in India + UAE, for SMBs and the mid-market.",
  alternates: { canonical: "https://workwrk.com/about" },
};

const VALUES = [
  { hue: "violet"  as const, icon: Compass, title: "Operators first",      body: "Built by operators, not by ex-Workday product managers. Every screen serves a daily job." },
  { hue: "emerald" as const, icon: Heart,   title: "Honest math",          body: "Free under five. $8 thereafter. No quote-only nonsense. The math should work on day one." },
  { hue: "fuchsia" as const, icon: Wrench,  title: "Boringly reliable",    body: "We ship every Tuesday. Uptime is a 99.95% number, not a promise. The platform fades into the background." },
  { hue: "amber"   as const, icon: Globe,   title: "Built for emerging markets", body: "India, UAE, Southeast Asia — first-class, not afterthoughts. INR/AED/SGD, multi-location, IST timing." },
];

const TIMELINE = [
  ["2023", "Founded", "Two cofounders, one whiteboard, one observation: SMBs run on 15 tools and zero data integration."],
  ["2024", "First 100 customers", "Free tier launched. People + Work hubs go GA. India / UAE early-adopter wave."],
  ["2025", "AI as runtime", "Cmd-K, inbox triage, cross-module signals ship. Money + Talent hubs added."],
  ["2026", "Now", "All 7 hubs live. v4 marketing relaunch. 500+ customers across 8 countries. Growth hub in beta."],
];

export default function AboutPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="fuchsia" className="mb-5">About workwrk</Eyebrow>
            <H1>
              We build the operating system <br />
              <GradientText hue="fuchsia">for the rest of the business world.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Workday is for Fortune 500s with eight-figure rollout budgets.
              Spreadsheets are for the first ten employees. Everyone in
              between has been ignored. workwrk is for them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/careers" variant="secondary" hue="fuchsia" size="lg" rightIcon={<ArrowRight size={15} />}>
                Join the team
              </Button>
              <Button href="/contact" variant="outline" size="lg">Get in touch</Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="text-center max-w-2xl mx-auto">
            <Eyebrow hue="violet" className="mb-4">Our values</Eyebrow>
            <H2>Four ideas <GradientText hue="violet">non-negotiable</GradientText>.</H2>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {VALUES.map((v) => (
              <FeatureCard key={v.title} hue={v.hue} icon={v.icon} title={v.title} body={v.body} />
            ))}
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="grid lg:grid-cols-[1fr_1.5fr] gap-12 items-start">
            <div>
              <Eyebrow hue="emerald" className="mb-4">The story</Eyebrow>
              <H2>Built in <GradientText hue="emerald">public</GradientText>.</H2>
              <p className="mt-5 text-slate-600 text-lg leading-relaxed">
                Three years from whiteboard to operating system. We shipped
                every Tuesday in between.
              </p>
            </div>
            <ol className="relative space-y-6 border-l-2 border-dashed border-slate-300 pl-8">
              {TIMELINE.map(([year, title, body]) => (
                <li key={year} className="relative">
                  <span className="absolute -left-[2.4rem] top-0.5 w-6 h-6 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  </span>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">{year}</p>
                  <H3 className="mt-1">{title}</H3>
                  <p className="mt-2 text-slate-600 text-[15px] leading-relaxed">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      <Section py="md">
        <Container>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard hue="violet"   value="500+"  label="Customers across 8 countries" />
            <StatCard hue="emerald"  value="35"    label="Operators on the team" />
            <StatCard hue="fuchsia"  value="$12M"  label="Series A from operator funds" />
            <StatCard hue="amber"    value="3 yr"  label="From idea to all-hubs-live" />
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <Quote
            hue="violet"
            quote="They built the platform we'd have built ourselves if we had the time. Now we don't have to."
            author="Daniel Park"
            role="CEO"
            company="Forge Capital"
          />
        </Container>
      </Section>

      <CTABand
        hue="fuchsia"
        title={<>Want to <GradientText hue="amber">build with us</GradientText>?</>}
        body="We're hiring engineers, designers, and operators across India, UAE, and remote globally."
        primary={{ label: "See open roles", href: "/careers" }}
        secondary={{ label: "Get in touch",  href: "/contact" }}
      />
    </>
  );
}
