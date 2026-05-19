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
  title: "Blog — WorkwrK",
  description: "Operator playbooks, product news, and category essays from the workwrk team.",
  alternates: { canonical: "https://workwrk.com/blog" },
};

const POSTS: readonly { slug: string; title: string; excerpt: string; date: string; readMins: number; category: string; hue: Hue }[] = [
  { slug: "why-we-built-7-hubs",      title: "Why we built 7 hubs, not 1 (or 70)",                excerpt: "The product architecture decision that defines workwrk. Why hub-orientation beats both monolithic and modular extremes.",      date: "2026-05-15", readMins: 8, category: "Product",  hue: "violet" },
  { slug: "the-kpi-engine-design",    title: "Inside the KPI engine: how composite scoring works", excerpt: "A deep technical look at how we weight KPI achievement, manager review, peer review, and kudos into a single composite.",  date: "2026-05-08", readMins: 11, category: "Engineering", hue: "sky"    },
  { slug: "smb-vs-workday",            title: "What Workday taught us — and what it got wrong",     excerpt: "Workday is a marvel of enterprise software. It's also why 90% of mid-market companies still run on spreadsheets.",          date: "2026-04-28", readMins: 14, category: "Category", hue: "fuchsia" },
  { slug: "cancel-bonusly",           title: "Why we built kudos into the perf system",            excerpt: "Bonusly is a great product. It's also the wrong shape — recognition belongs in the system that values it.",                  date: "2026-04-15", readMins: 6,  category: "Product",  hue: "pink"    },
  { slug: "ai-runtime-not-chatbot",   title: "AI as runtime, not as chatbot",                       excerpt: "The category mistake everyone is making. Why workwrk doesn't ship a 'workwrk AI' — and what it ships instead.",                date: "2026-04-02", readMins: 10, category: "AI",       hue: "indigo"  },
  { slug: "india-uae-first",          title: "Building emerging-markets-first software in 2026",    excerpt: "Why we ship INR, AED, and SGD as first-class — and what that means for product decisions every engineer should know.",         date: "2026-03-19", readMins: 9,  category: "Category", hue: "amber"   },
  { slug: "weekly-ship-cadence",      title: "Every Tuesday: how we ship a v4 marketing site",      excerpt: "How a 35-person company ships product every Tuesday without burning out or breaking customers.",                                date: "2026-03-12", readMins: 7,  category: "Engineering", hue: "emerald" },
  { slug: "perf-review-myths",        title: "Five myths about performance reviews",                 excerpt: "If your perf cycle takes 6 weeks, it's probably because you believe one of these. Here's what to do instead.",                  date: "2026-02-28", readMins: 8,  category: "People",  hue: "rose"    },
];

const CATEGORIES = ["All", "Product", "Engineering", "Category", "AI", "People"];

export default function BlogPage() {
  const featured = POSTS[0];
  const rest = POSTS.slice(1);
  const fHue = HUES[featured.hue];
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="violet" className="mb-5">Blog</Eyebrow>
            <H1>
              <GradientText hue="violet">Operator playbooks.</GradientText> Product essays. Category takes.
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Stuff worth your time, from the team building workwrk and the operators using it.
            </p>
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={`inline-flex items-center text-xs font-bold uppercase tracking-[0.14em] px-3 h-8 rounded-full border transition ${
                  c === "All" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </Container>
      </Section>

      {/* Featured */}
      <Section py="md">
        <Container>
          <Link
            href={`/blog/${featured.slug}`}
            className={`group block rounded-3xl overflow-hidden bg-gradient-to-br ${fHue.gradVia} p-1`}
          >
            <div className="bg-white rounded-[1.4rem] p-8 lg:p-12">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-[0.16em] px-3 h-7 rounded-full ${fHue.bgTint} ${fHue.text} border ${fHue.border}`}>
                  Featured · {featured.category}
                </span>
                <span className="text-xs text-slate-500">{featured.date} · {featured.readMins} min</span>
              </div>
              <h2 className="mt-5 font-extrabold tracking-[-0.025em] text-slate-900" style={{ fontSize: "clamp(1.7rem, 3.2vw, 2.4rem)", lineHeight: 1.1 }}>
                {featured.title}
              </h2>
              <p className="mt-4 text-slate-600 text-lg leading-relaxed max-w-3xl">{featured.excerpt}</p>
              <span className={`mt-6 inline-flex items-center gap-1.5 text-sm font-semibold ${fHue.text} group-hover:gap-2 transition-all`}>
                Read the essay <ArrowRight size={14} />
              </span>
            </div>
          </Link>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {rest.map((p) => {
              const t = HUES[p.hue];
              return (
                <Link
                  key={p.slug}
                  href={`/blog/${p.slug}`}
                  className="group p-7 bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-18px_rgba(15,23,42,0.18)] transition shadow-sm"
                >
                  <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-[0.16em] px-2.5 h-6 rounded-full ${t.bgTint} ${t.text} border ${t.border}`}>
                    {p.category}
                  </span>
                  <h3 className="mt-4 font-bold text-slate-900 text-xl tracking-tight leading-snug">{p.title}</h3>
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed line-clamp-3">{p.excerpt}</p>
                  <p className="mt-5 text-xs text-slate-500">{p.date} · {p.readMins} min</p>
                </Link>
              );
            })}
          </div>
        </Container>
      </Section>

      <CTABand
        hue="violet"
        title={<>Want this in your <GradientText hue="amber">inbox</GradientText>?</>}
        body="Monthly digest of essays + product news. No spam, no fluff."
        primary={{ label: "Subscribe", href: "/signup?source=blog" }}
        secondary={{ label: "All posts", href: "/blog" }}
      />
    </>
  );
}
