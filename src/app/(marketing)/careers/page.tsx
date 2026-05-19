import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin, Heart, Globe, Compass, Coffee, Briefcase } from "lucide-react";
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
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Careers — WorkwrK",
  description: "Build the operating system for the rest of the business world. Engineering, design, product, ops — open across India, UAE, and remote globally.",
  alternates: { canonical: "https://workwrk.com/careers" },
};

const PERKS: readonly { hue: Hue; icon: typeof Heart; title: string; body: string }[] = [
  { hue: "fuchsia", icon: Heart,    title: "Real ownership",           body: "Engineers ship to prod week one. Designers own surfaces, not Figma files. PMs run the org chart." },
  { hue: "emerald", icon: Globe,    title: "Remote-friendly",           body: "Offices in Bengaluru, Dubai, Singapore. Remote across IN/UAE/SEA timezones. Quarterly team gatherings." },
  { hue: "amber",   icon: Coffee,   title: "We respect Fridays",        body: "Weekend protected. We ship every Tuesday, not every Friday-night. Sustainable cadence, every week, for years." },
  { hue: "violet",  icon: Compass,  title: "Learning budget",           body: "$2,000/year per person. Books, courses, conferences. We expect you to spend it." },
];

const ROLES: readonly { hue: Hue; team: string; title: string; loc: string; type: string; id: string }[] = [
  { hue: "violet",  team: "Engineering", title: "Senior Full-Stack Engineer",       loc: "Bengaluru / Remote IN",          type: "Full-time", id: "swe-fs-01" },
  { hue: "violet",  team: "Engineering", title: "Staff Backend Engineer (AI)",      loc: "Bengaluru / Remote IN",          type: "Full-time", id: "swe-be-02" },
  { hue: "indigo",  team: "Engineering", title: "Mobile Engineer (React Native)",   loc: "Remote IN / UAE",                type: "Full-time", id: "swe-mob-03" },
  { hue: "fuchsia", team: "Design",      title: "Product Designer — Money hub",     loc: "Remote (IST/GMT)",               type: "Full-time", id: "dsg-04" },
  { hue: "emerald", team: "Product",     title: "PM — Talent hub",                   loc: "Bengaluru / Dubai",              type: "Full-time", id: "pm-tal-05" },
  { hue: "amber",   team: "GTM",         title: "Solutions Architect — UAE",        loc: "Dubai",                           type: "Full-time", id: "sa-uae-06" },
  { hue: "sky",     team: "GTM",         title: "Customer Success Manager — SEA",   loc: "Singapore / Remote SEA",          type: "Full-time", id: "csm-sea-07" },
  { hue: "rose",    team: "Operations",  title: "Head of People",                    loc: "Bengaluru",                       type: "Full-time", id: "ops-hr-08" },
];

const TEAMS = ["All", "Engineering", "Design", "Product", "GTM", "Operations"];

export default function CareersPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="fuchsia" className="mb-5">Careers</Eyebrow>
            <H1>
              Build the operating system <br />
              <GradientText hue="fuchsia">for the rest of the business world.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              We&apos;re 35 operators building workwrk for 500+ teams across 8 countries.
              If &ldquo;build something Fortune 500s wish they could buy&rdquo; is your kind of mission, read on.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="#roles" variant="secondary" hue="fuchsia" size="lg" rightIcon={<ArrowRight size={15} />}>
                See open roles ({ROLES.length})
              </Button>
              <Button href="mailto:hiring@workwrk.com" variant="outline" size="lg">Spontaneous application</Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="emerald" className="mb-4">What it&apos;s like</Eyebrow>
            <H2>Four things <GradientText hue="emerald">we care about.</GradientText></H2>
          </div>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PERKS.map((p) => {
              const t = HUES[p.hue];
              return (
                <div key={p.title} className="p-6 bg-white border border-slate-200 rounded-2xl">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.bgTint} ${t.text} border ${t.border}`}>
                    <p.icon size={18} strokeWidth={2.4} />
                  </div>
                  <p className="mt-4 font-bold text-slate-900">{p.title}</p>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{p.body}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      <section id="roles" className="scroll-mt-20 bg-slate-50 py-20 lg:py-28">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="violet" className="mb-4">Open roles</Eyebrow>
            <H2>{ROLES.length} positions <GradientText hue="violet">currently open</GradientText>.</H2>
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            {TEAMS.map((t) => (
              <button
                key={t}
                className={`inline-flex items-center text-xs font-bold uppercase tracking-[0.14em] px-3 h-8 rounded-full border transition ${
                  t === "All" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-8 space-y-3">
            {ROLES.map((r) => {
              const t = HUES[r.hue];
              return (
                <Link
                  key={r.id}
                  href={`/careers/${r.id}`}
                  className="group p-5 bg-white border border-slate-200 rounded-2xl flex flex-wrap items-center justify-between gap-4 hover:border-slate-300 hover:shadow-[0_10px_28px_-12px_rgba(15,23,42,0.12)] transition"
                >
                  <div className="flex items-start gap-4 min-w-0">
                    <span className={`w-10 h-10 rounded-xl ${t.bgTint} ${t.text} border ${t.border} flex items-center justify-center flex-shrink-0`}>
                      <Briefcase size={18} strokeWidth={2.4} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 tracking-tight">{r.title}</p>
                      <p className="text-xs text-slate-500 mt-1">{r.team} · {r.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-600">
                      <MapPin size={12} /> {r.loc}
                    </span>
                    <ArrowRight size={16} className={`${t.text} group-hover:translate-x-1 transition`} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Container>
      </section>

      <CTABand
        hue="fuchsia"
        title={<>Don&apos;t see your role <GradientText hue="amber">listed</GradientText>?</>}
        body="We're always looking. Drop us a line — hiring@workwrk.com — and tell us what you'd build."
        primary={{ label: "Email hiring@workwrk.com", href: "mailto:hiring@workwrk.com" }}
        secondary={{ label: "Read more about us",     href: "/about" }}
      />
    </>
  );
}
