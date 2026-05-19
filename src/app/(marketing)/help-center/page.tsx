import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  Users,
  CheckCircle2,
  DollarSign,
  Crosshair,
  Star,
  Megaphone,
  Inbox,
  Search,
  BookOpen,
  Settings,
  ShieldCheck,
} from "lucide-react";
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
  HUBS,
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Help Center — WorkwrK",
  description: "Guides, troubleshooting, and onboarding documentation. Self-serve everything — and chat with a human when you need one.",
  alternates: { canonical: "https://workwrk.com/help-center" },
};

const TOP_GUIDES: readonly { title: string; mins: number; hue: Hue; icon: typeof BookOpen }[] = [
  { title: "Quickstart: your first 30 minutes in workwrk", mins: 8, hue: "violet",  icon: Sparkles  },
  { title: "Setting up your first KPI engine",              mins: 12, hue: "sky",     icon: CheckCircle2 },
  { title: "Running your first 360 review cycle",           mins: 14, hue: "fuchsia", icon: Users     },
  { title: "Migrating from BambooHR / Workday / Rippling",  mins: 16, hue: "emerald", icon: Settings  },
  { title: "Configuring SSO and SCIM provisioning",         mins: 10, hue: "rose",    icon: ShieldCheck },
  { title: "Building a custom dashboard with Cmd-K AI",     mins: 7,  hue: "indigo",  icon: Search    },
];

const HUB_ICONS = {
  home: Inbox,
  people: Users,
  work: CheckCircle2,
  money: DollarSign,
  talent: Crosshair,
  culture: Star,
  growth: Megaphone,
} as const;

export default function HelpCenterPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="violet" className="mb-5">Help Center</Eyebrow>
            <H1>
              <GradientText hue="violet">Self-serve everything.</GradientText> Talk to a human when you need to.
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              200+ guides, organized by hub. Searchable. Updated weekly. With a real chat button when you can&apos;t find what you need.
            </p>

            {/* Search */}
            <div className="mt-9 relative max-w-xl">
              <input
                type="search"
                placeholder="Search for a guide, a feature, an error message..."
                className="w-full pl-12 pr-4 h-14 rounded-2xl bg-white border border-slate-200 text-base placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 transition shadow-sm"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>
          </div>
        </Container>
      </Section>

      {/* Top guides */}
      <Section py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="fuchsia" className="mb-4">Most read</Eyebrow>
            <H2>Top guides this month.</H2>
          </div>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TOP_GUIDES.map((g) => {
              const t = HUES[g.hue];
              const Icon = g.icon;
              return (
                <Link
                  key={g.title}
                  href="#"
                  className="group p-5 bg-white border border-slate-200 rounded-2xl hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_50px_-18px_rgba(15,23,42,0.18)] transition shadow-sm"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.bgTint} ${t.text} border ${t.border}`}>
                    <Icon size={18} strokeWidth={2.4} />
                  </div>
                  <p className="mt-4 font-bold text-slate-900 tracking-tight">{g.title}</p>
                  <p className="mt-2 text-xs text-slate-500">{g.mins} min read</p>
                </Link>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* By hub */}
      <Section variant="tint" py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="emerald" className="mb-4">Browse by hub</Eyebrow>
            <H2>Find guides <GradientText hue="emerald">where you work.</GradientText></H2>
          </div>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {HUBS.map((hub) => {
              const t = HUES[hub.hue];
              const Icon = HUB_ICONS[hub.slug as keyof typeof HUB_ICONS];
              return (
                <Link
                  key={hub.slug}
                  href={`#${hub.slug}`}
                  className="group p-5 bg-white border border-slate-200 rounded-2xl hover:-translate-y-0.5 hover:border-slate-300 transition shadow-sm"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${t.gradVia} text-white`}>
                    <Icon size={18} strokeWidth={2.4} />
                  </div>
                  <p className="mt-4 font-bold text-slate-900">{hub.name}</p>
                  <p className="mt-1 text-xs text-slate-500">~25 guides</p>
                  <p className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${t.text} group-hover:gap-2 transition-all`}>
                    Browse <ArrowRight size={11} />
                  </p>
                </Link>
              );
            })}
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="grid lg:grid-cols-3 gap-5">
            <Link href="/blog" className="p-7 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 transition">
              <H3>Read essays</H3>
              <p className="mt-3 text-sm text-slate-600">Operator playbooks and category essays from the team and our customers.</p>
              <p className="mt-5 text-sm font-semibold text-violet-700 inline-flex items-center gap-1">Go to blog <ArrowRight size={13} /></p>
            </Link>
            <Link href="/changelog" className="p-7 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 transition">
              <H3>What&apos;s new</H3>
              <p className="mt-3 text-sm text-slate-600">Every shipped feature, every Tuesday. Years of context at a glance.</p>
              <p className="mt-5 text-sm font-semibold text-fuchsia-700 inline-flex items-center gap-1">See changelog <ArrowRight size={13} /></p>
            </Link>
            <Link href="/developers" className="p-7 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 transition">
              <H3>For developers</H3>
              <p className="mt-3 text-sm text-slate-600">API reference, SDKs, webhooks, embeds — everything to extend workwrk.</p>
              <p className="mt-5 text-sm font-semibold text-emerald-700 inline-flex items-center gap-1">Developer docs <ArrowRight size={13} /></p>
            </Link>
          </div>
        </Container>
      </Section>

      <CTABand
        hue="violet"
        title="Stuck on something?"
        body="Real humans on chat 09:00–20:00 IST / GMT. Email any time."
        primary={{ label: "Chat with us", href: "mailto:support@workwrk.com" }}
        secondary={{ label: "Read the FAQ", href: "/faq" }}
      />
    </>
  );
}
