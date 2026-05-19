import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Mail,
  Headphones,
  Briefcase,
  Megaphone,
  ShieldAlert,
  MapPin,
} from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H3,
  Button,
  CTABand,
  GradientText,
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Contact — WorkwrK",
  description:
    "Talk to sales, get support, partner with us, or report a security issue. Real humans, real responses, no chatbot purgatory.",
  alternates: { canonical: "https://workwrk.com/contact" },
};

const CHANNELS: readonly { hue: Hue; icon: typeof Mail; title: string; body: string; href: string; cta: string }[] = [
  { hue: "fuchsia", icon: Briefcase,   title: "Sales",         body: "Pricing, demos, procurement. We respond within 4 business hours.",          href: "mailto:sales@workwrk.com",    cta: "sales@workwrk.com"    },
  { hue: "emerald", icon: Headphones,  title: "Customer support", body: "Help with your account, billing, or product issues. 24-hour response.",   href: "mailto:support@workwrk.com",  cta: "support@workwrk.com"  },
  { hue: "amber",   icon: Megaphone,   title: "Press & media", body: "Story ideas, interviews, product launches. Our team is happy to talk.",     href: "mailto:press@workwrk.com",    cta: "press@workwrk.com"    },
  { hue: "violet",  icon: Mail,        title: "Partnerships",  body: "Integrations, agency partners, resellers, channel deals.",                  href: "mailto:partners@workwrk.com", cta: "partners@workwrk.com" },
  { hue: "rose",    icon: ShieldAlert, title: "Security & abuse", body: "Vulnerability reports, abuse complaints, legal requests. PGP available.", href: "mailto:security@workwrk.com", cta: "security@workwrk.com" },
];

const OFFICES = [
  { city: "Bengaluru",  region: "India", address: "WeWork Embassy Tech Village, Bellandur, Bengaluru 560103" },
  { city: "Dubai",      region: "UAE",   address: "DIFC Innovation Hub, Gate Avenue, Level 3, Dubai" },
  { city: "Singapore",  region: "APAC",  address: "1 Raffles Quay, North Tower, Level 25, Singapore 048583" },
];

export default function ContactPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="fuchsia" className="mb-5">Contact</Eyebrow>
            <H1>
              Real humans. <br />
              <GradientText hue="fuchsia">Real responses.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              No chatbot purgatory. Pick the channel that fits your question
              and you&apos;ll hear from someone on the team — usually within
              four hours.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/demo" variant="secondary" hue="fuchsia" size="lg" rightIcon={<ArrowRight size={15} />}>
                Book a demo instead
              </Button>
              <Button href="mailto:hello@workwrk.com" variant="outline" size="lg" leftIcon={<Mail size={15} />}>
                hello@workwrk.com
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {CHANNELS.map((c) => {
              const t = HUES[c.hue];
              return (
                <Link
                  key={c.title}
                  href={c.href}
                  className="group p-7 bg-white rounded-2xl border border-slate-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_50px_-18px_rgba(15,23,42,0.18)] transition shadow-sm"
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${t.gradVia} text-white`}>
                    <c.icon size={20} strokeWidth={2.4} />
                  </div>
                  <H3 className="mt-5">{c.title}</H3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{c.body}</p>
                  <p className={`mt-5 inline-flex items-center gap-1 text-sm font-semibold ${t.text} group-hover:gap-2 transition-all`}>
                    {c.cta} <ArrowRight size={13} />
                  </p>
                </Link>
              );
            })}
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="grid lg:grid-cols-[1fr_2fr] gap-12 items-start">
            <div>
              <Eyebrow hue="sky" className="mb-4">Offices</Eyebrow>
              <H1 className="!text-4xl">Three cities. <GradientText hue="sky">One team.</GradientText></H1>
              <p className="mt-5 text-slate-600">
                Headquartered in Bengaluru, with hubs in Dubai and Singapore so
                we&apos;re always within four hours of every customer.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              {OFFICES.map((o) => (
                <div key={o.city} className="p-5 bg-white border border-slate-200 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
                      <MapPin size={14} />
                    </span>
                    <p className="font-bold text-slate-900 text-sm">{o.city}</p>
                  </div>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-sky-700">{o.region}</p>
                  <p className="mt-2 text-xs text-slate-600 leading-relaxed">{o.address}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <CTABand
        hue="violet"
        title={<>Got a question we missed?</>}
        body="Drop us a line — hello@workwrk.com — and we'll route you to the right human."
        primary={{ label: "Email hello@workwrk.com", href: "mailto:hello@workwrk.com" }}
        secondary={{ label: "See the FAQ", href: "/faq" }}
      />
    </>
  );
}
