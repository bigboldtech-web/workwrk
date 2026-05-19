"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight, ShieldCheck } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  H3,
  Button,
  CTABand,
  GradientText,
  HUES,
} from "@/components/marketing/primitives";

export default function DoNotSellPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="rose" className="mb-5">CCPA · CPRA</Eyebrow>
            <H1>
              Do Not Sell or Share <br />
              <GradientText hue="rose">My Personal Information.</GradientText>
            </H1>
            <p className="mt-5 text-base text-slate-600">
              Last updated: <span className="font-semibold text-slate-900">May 18, 2026</span>
            </p>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-2xl">
              California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA)
              give California residents the right to opt out of the sale or sharing of personal
              information.
            </p>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 items-start">
            <div>
              <Eyebrow hue="emerald" className="mb-4">Our position</Eyebrow>
              <H2>We don&apos;t sell <GradientText hue="emerald">your data.</GradientText></H2>
              <p className="mt-5 text-slate-700 text-[15.5px] leading-relaxed">
                WorkwrK does not sell personal information. We do not exchange your data for
                money or other valuable consideration with third parties for their independent use.
              </p>
              <p className="mt-4 text-slate-700 text-[15.5px] leading-relaxed">
                We use a small number of sub-processors (AWS, Stripe, Anthropic, Datadog) under
                strict data processing agreements that prohibit them from using your data for
                their own purposes. See <Link href="/privacy" className="text-emerald-700 underline underline-offset-2">our Privacy Policy</Link> for the full list.
              </p>
              <div className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <ShieldCheck size={16} /> Verified by Cure53 (annual audit)
              </div>
            </div>

            {/* Opt-out form */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 lg:p-10">
              <H3>File an opt-out request</H3>
              <p className="mt-2 text-sm text-slate-600">
                If we ever change our practice, this form ensures you&apos;re excluded. We respond
                within 15 business days.
              </p>
              {submitted ? (
                <div className="mt-7 p-6 rounded-2xl bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 className="text-emerald-600" size={28} />
                  <p className="mt-3 font-bold text-emerald-900">Request received.</p>
                  <p className="mt-2 text-sm text-emerald-800">
                    We&apos;ll email you a confirmation at the address you provided within 15 business days.
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
                  className="mt-7 space-y-4"
                >
                  <Field label="Full name *"   name="name"  placeholder="Jordan Park" required />
                  <Field label="Email *"        name="email" placeholder="jordan@example.com" required type="email" />
                  <Field
                    label="California resident? *"
                    name="state"
                    as="select"
                    options={["I am a California resident", "I am authorized to submit this on behalf of a California resident"]}
                  />
                  <Field
                    label="Anything else we should know?"
                    name="notes"
                    as="textarea"
                    placeholder="(Optional) Details about your request..."
                  />
                  <button
                    type="submit"
                    className="w-full h-12 mt-2 rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition"
                  >
                    Submit request <ArrowRight size={15} />
                  </button>
                </form>
              )}
            </div>
          </div>
        </Container>
      </Section>

      <CTABand hue="rose" />
    </>
  );
}

function Field({
  label, name, type = "text", placeholder, as = "input", options, required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  as?: "input" | "textarea" | "select";
  options?: readonly string[];
  required?: boolean;
}) {
  const base = "w-full px-3.5 h-11 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition";
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-700 mb-1.5">{label}</span>
      {as === "textarea" ? (
        <textarea name={name} rows={3} placeholder={placeholder} className={`${base} h-auto py-3`} />
      ) : as === "select" ? (
        <select name={name} className={base} required={required} defaultValue="">
          <option value="" disabled>Select</option>
          {options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} name={name} placeholder={placeholder} required={required} className={base} />
      )}
    </label>
  );
}
