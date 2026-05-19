import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Users, Mail, Sparkles } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  H3,
  Button,
  CTABand,
  Quote,
  GradientText,
  CheckList,
  HUES,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Book a Demo — WorkwrK",
  description:
    "Get a 20-minute personalized walkthrough of workwrk. We'll show you the hubs that matter for your industry and team size, and answer every question.",
  alternates: { canonical: "https://workwrk.com/demo" },
};

export default function DemoPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-start">
            <div>
              <Eyebrow hue="fuchsia" className="mb-5">Book a Demo</Eyebrow>
              <H1>
                20 minutes. <br />
                <GradientText hue="fuchsia">Tailored to your team.</GradientText>
              </H1>
              <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed">
                We won&apos;t show you 90 slides. We&apos;ll log into a sandbox
                modelled on your industry, walk through the hubs that matter
                to your size, and answer every question you bring.
              </p>

              <div className="mt-9 grid sm:grid-cols-2 gap-4">
                <DemoFacet hue="violet"  icon={Clock}    title="20 mins" body="No long pitch decks. Real product, real workflows." />
                <DemoFacet hue="emerald" icon={Users}    title="Your team" body="Bring 1–5 stakeholders. We tailor the walkthrough to each." />
                <DemoFacet hue="amber"   icon={Sparkles} title="Live sandbox" body="See your industry's templates running on real data." />
                <DemoFacet hue="sky"     icon={Mail}     title="Follow-up notes" body="You leave with a one-page summary and a sandbox login." />
              </div>

              <div className="mt-9">
                <p className="text-sm font-bold text-slate-900 mb-3">What we&apos;ll cover</p>
                <CheckList
                  hue="emerald"
                  items={[
                    "Hubs relevant to your industry (we ask first)",
                    "Migration path from your current stack",
                    "Custom KPIs, SOPs, and review cycles",
                    "Pricing for your specific team size",
                    "AI features and the underlying data model",
                  ]}
                />
              </div>
            </div>

            <DemoFormCard />
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <Quote
            hue="violet"
            quote="They asked five questions, then ran the demo in our actual industry's template. We knew within 10 minutes this was the right call."
            author="Mei Tanaka"
            role="Head of Ops"
            company="Lattice & Co"
          />
        </Container>
      </Section>

      <CTABand
        hue="fuchsia"
        title={<>Prefer to <GradientText hue="emerald">try it yourself</GradientText>?</>}
        body="Sign up free. No credit card. All 7 hubs unlocked under 5 people."
        primary={{ label: "Start free instead", href: "/signup" }}
        secondary={{ label: "Talk to sales",   href: "/contact" }}
      />
    </>
  );
}

function DemoFacet({
  hue,
  icon: Icon,
  title,
  body,
}: {
  hue: keyof typeof HUES;
  icon: typeof Clock;
  title: string;
  body: string;
}) {
  const t = HUES[hue];
  return (
    <div className="p-5 bg-white border border-slate-200 rounded-2xl">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${t.bgTint} ${t.text} border ${t.border}`}>
        <Icon size={17} strokeWidth={2.4} />
      </div>
      <p className="mt-3 font-bold text-slate-900 text-sm">{title}</p>
      <p className="mt-1 text-xs text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}

function DemoFormCard() {
  return (
    <div className="sticky top-24 bg-white rounded-3xl border border-slate-200 shadow-[0_30px_80px_-20px_rgba(15,23,42,0.18)] overflow-hidden">
      <div className="bg-slate-950 px-8 py-7 text-white">
        <H3 className="text-white">Book your demo</H3>
        <p className="mt-2 text-sm text-white/80">We respond within 4 business hours.</p>
      </div>
      <form className="p-7 space-y-4" action="#" method="post">
        <Field label="Full name *" name="name" placeholder="Priya Iyer" required />
        <Field label="Work email *" name="email" type="email" placeholder="priya@helios.com" required />
        <Field label="Company *" name="company" placeholder="Helios Labs" required />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Team size" name="size" as="select" options={["1–10", "11–50", "51–200", "201–500", "500+"]} />
          <Field label="Industry"  name="industry" as="select" options={["Technology", "Healthcare", "Manufacturing", "Logistics", "Services", "Sales", "Real Estate", "Other"]} />
        </div>
        <Field label="What do you want to see?" name="notes" as="textarea" placeholder="We're evaluating workwrk for performance reviews + KPIs..." />
        <button
          type="submit"
          className="w-full h-12 mt-2 rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition"
        >
          Request demo <ArrowRight size={15} />
        </button>
        <p className="text-xs text-slate-500 text-center">
          We&apos;ll never share your details. Read our <Link href="/privacy" className="text-slate-700 underline underline-offset-2">privacy policy</Link>.
        </p>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  as = "input",
  options,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  as?: "input" | "textarea" | "select";
  options?: readonly string[];
  required?: boolean;
}) {
  const base =
    "w-full px-3.5 h-11 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100 transition";
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-700 mb-1.5">{label}</span>
      {as === "textarea" ? (
        <textarea
          name={name}
          rows={4}
          placeholder={placeholder}
          className={`${base} h-auto py-3`}
        />
      ) : as === "select" ? (
        <select name={name} className={base} defaultValue="">
          <option value="" disabled>Select</option>
          {options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          placeholder={placeholder}
          required={required}
          className={base}
        />
      )}
    </label>
  );
}
