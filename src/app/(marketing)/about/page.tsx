import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Eye,
  BarChart3,
  Users,
  Rocket,
  Layers,
  Database,
  Brain,
  MapPin,
  Quote,
} from "lucide-react";

export const metadata: Metadata = {
  title: "About — TheywrK | The Business Operating System",
  description:
    "TheywrK is the unified business operating system replacing 15+ disconnected tools with one platform for people, KPIs, SOPs, performance reviews, tasks, recognition, and AI intelligence. Built for growing businesses that refuse to stay small.",
  openGraph: {
    title: "About — TheywrK | The Business Operating System",
    description:
      "We're building the operating system every growing business deserves. One platform to replace chaos with clarity, guesswork with data, and disconnected tools with unified intelligence.",
    url: "https://theywrk.com/about",
    siteName: "TheywrK",
    type: "website",
  },
};

const values = [
  {
    icon: <Eye size={28} />,
    color: "#6C5CE7",
    title: "Clarity Over Complexity",
    desc: "Simple tools that surface real insights. No bloated dashboards, no feature overload — just what you need to make better decisions, faster.",
  },
  {
    icon: <BarChart3 size={28} />,
    color: "#00D68F",
    title: "Data Over Gut Feelings",
    desc: "Every decision backed by real performance data. Promotions, PIPs, recognition — all grounded in composite scores from 6 verified sources, not office politics.",
  },
  {
    icon: <Users size={28} />,
    color: "#A29BFE",
    title: "People First",
    desc: "Technology should empower teams, not replace them. We build tools that make managers better coaches, employees more visible, and teams more aligned.",
  },
  {
    icon: <Rocket size={28} />,
    color: "#FF9F43",
    title: "Built for Builders",
    desc: "Designed for growing businesses that refuse to stay small. From a 10-person agency to a 500-person enterprise, TheywrK scales with your ambition.",
  },
];

const stats = [
  {
    icon: <Layers size={24} />,
    value: "12+",
    label: "Integrated Modules",
    desc: "People, KPIs, SOPs, reviews, tasks, kudos, AI, analytics, and more — all connected.",
  },
  {
    icon: <Database size={24} />,
    value: "6",
    label: "Performance Data Sources",
    desc: "KPI scores, manager reviews, peer feedback, self-assessments, SOP compliance, and task completion.",
  },
  {
    icon: <Brain size={24} />,
    value: "Real-time",
    label: "AI Intelligence",
    desc: "Ask your business anything in plain English. Get instant, data-backed answers — not generic suggestions.",
  },
  {
    icon: <MapPin size={24} />,
    value: "Multi-location",
    label: "Support",
    desc: "Branch comparisons, department hierarchies, and cross-location analytics built in from day one.",
  },
];

const milestones = [
  {
    period: "2024 Q1",
    title: "Idea born from frustration with disconnected tools",
    color: "#FF6B6B",
  },
  {
    period: "2024 Q2",
    title: "First prototype with 3 core modules",
    color: "#FF9F43",
  },
  {
    period: "2024 Q4",
    title: "Beta launch with 50 businesses",
    color: "#A29BFE",
  },
  {
    period: "2025 Q2",
    title: "Full platform launch with 12 modules",
    color: "#6C5CE7",
  },
  {
    period: "2025 Q4",
    title: "500+ businesses, AI Intelligence Layer shipped",
    color: "#00D68F",
  },
];

const team = [
  {
    name: "Arjun Kapoor",
    role: "Co-founder & CEO",
    initials: "AK",
    color: "#6C5CE7",
    bio: "Ex-McKinsey. Spent 8 years watching businesses run on broken processes.",
  },
  {
    name: "Meera Iyer",
    role: "Co-founder & CTO",
    initials: "MI",
    color: "#00D68F",
    bio: "15 years in enterprise SaaS. Built platforms that scaled to millions.",
  },
  {
    name: "Ravi Patel",
    role: "Head of Product",
    initials: "RP",
    color: "#FF9F43",
    bio: "Product leader who believes software should be invisible.",
  },
  {
    name: "Sneha Nair",
    role: "Head of Customer Success",
    initials: "SN",
    color: "#A29BFE",
    bio: "Customer-obsessed. Previously scaled support at a unicorn.",
  },
];

const press = [
  "TechCrunch",
  "YourStory",
  "Inc42",
  "Nasscom",
  "ProductHunt #1",
];

const testimonials = [
  {
    quote:
      "TheywrK is not just a tool — it's how we run our company now.",
    name: "Aditya Sharma",
    role: "CEO",
    company: "GrowthForce",
    color: "#6C5CE7",
  },
  {
    quote:
      "We went from zero visibility into performance to complete clarity in 2 weeks.",
    name: "Kavitha Rajan",
    role: "COO",
    company: "ServiceFirst",
    color: "#00D68F",
  },
  {
    quote:
      "The composite scoring changed everything. Promotions are now based on data, not politics.",
    name: "Deepak Rao",
    role: "VP HR",
    company: "TalentEdge",
    color: "#FF9F43",
  },
];

const investors = [
  { name: "Kunal Shah", note: "Founder, CRED" },
  { name: "Sanjeev Bikhchandani", note: "Founder, Info Edge" },
  { name: "Vani Kola", note: "MD, Kalaari Capital" },
];

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative pb-20 pt-36">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px] px-6 text-center">
          <p className="mkt-label animate-fade-in">About TheywrK</p>
          <h1 className="mkt-title mx-auto mb-6 max-w-[800px] text-[clamp(2.2rem,5vw,3.5rem)] animate-fade-in-1">
            We&apos;re building the operating system every growing business{" "}
            <span className="text-gradient">deserves.</span>
          </h1>
          <p className="mx-auto mb-8 max-w-[560px] text-lg text-[#8888A0] animate-fade-in-2">
            One platform to replace chaos with clarity, guesswork with data,
            and disconnected tools with unified intelligence.
          </p>
          <div className="flex items-center justify-center gap-4 animate-fade-in-3">
            <Link href="/register" className="btn-primary px-8 py-3.5">
              Start Free Trial <ArrowUpRight size={16} />
            </Link>
            <Link href="/features" className="btn-outline px-8 py-3.5">
              Explore Features
            </Link>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mkt-highlight text-center">
            <p className="mkt-label">Our Mission</p>
            <h2 className="mkt-title mx-auto mb-6 max-w-[800px] text-[clamp(1.6rem,3vw,2.4rem)]">
              To replace chaos with clarity. To replace guesswork with data.
            </h2>
            <p className="mx-auto max-w-[640px] text-base leading-relaxed text-[#8888A0]">
              To give every business — from a 10-person agency to a 500-person
              enterprise — the tools to operate at their best. We believe that
              great businesses aren&apos;t built on gut feelings. They&apos;re built on
              clarity, accountability, and data that tells the truth.
            </p>
          </div>
        </div>
      </section>

      {/* The Story */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div>
              <p className="mkt-label">The Story</p>
              <h2 className="mkt-title mb-6 text-[clamp(1.8rem,3vw,2.5rem)]">
                Born from watching businesses{" "}
                <span className="text-gradient">struggle.</span>
              </h2>
              <div className="flex flex-col gap-5 text-[15px] leading-relaxed text-[#8888A0]">
                <p>
                  TheywrK was born from watching businesses drown in 15+
                  disconnected tools. HR data in one system, KPIs in a
                  spreadsheet, SOPs in a Google Doc that nobody reads, task
                  management on WhatsApp, and performance reviews that
                  devolve into storytelling sessions.
                </p>
                <p>
                  We saw promotion decisions based on politics instead of
                  performance. We saw managers flying blind without real data
                  on their teams. We saw employees who had no idea where they
                  stood or how to grow.
                </p>
                <p>
                  So we built one unified platform to fix all of it. A single
                  operating system where every data point connects — where KPI
                  scores, review ratings, task completion, SOP compliance, and
                  peer feedback all flow into one composite truth.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {[
                {
                  label: "The Problem",
                  items: [
                    "15+ disconnected tools with no data flow",
                    "WhatsApp-based task management",
                    "KPIs tracked in spreadsheets",
                    "SOPs that nobody reads or follows",
                    "Promotion decisions based on politics",
                  ],
                },
                {
                  label: "The Solution",
                  items: [
                    "One unified platform for everything",
                    "Structured task management with deadlines",
                    "Auto-scored KPIs with real-time tracking",
                    "SOP playbook with compliance monitoring",
                    "Composite scores from 6 data sources",
                  ],
                },
              ].map((block) => (
                <div
                  key={block.label}
                  className="rounded-2xl border border-[#2A2A3A] bg-[#12121A] p-6"
                >
                  <h3 className="mb-4 font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-[#A29BFE]">
                    {block.label}
                  </h3>
                  <ul className="flex flex-col gap-2.5">
                    {block.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 text-sm text-[#8888A0]"
                      >
                        <span
                          className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          style={{
                            background:
                              block.label === "The Problem"
                                ? "#FF6B6B"
                                : "#00D68F",
                          }}
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mb-16 text-center">
            <p className="mkt-label">Our Journey</p>
            <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
              From idea to <span className="text-gradient">impact.</span>
            </h2>
          </div>

          <div className="relative mx-auto max-w-[800px]">
            {/* Vertical line */}
            <div
              className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 md:block"
              style={{
                background:
                  "linear-gradient(to bottom, transparent, #2A2A3A 10%, #2A2A3A 90%, transparent)",
              }}
            />
            {/* Mobile vertical line */}
            <div
              className="absolute left-6 top-0 block h-full w-px md:hidden"
              style={{
                background:
                  "linear-gradient(to bottom, transparent, #2A2A3A 10%, #2A2A3A 90%, transparent)",
              }}
            />

            <div className="flex flex-col gap-12">
              {milestones.map((ms, i) => {
                const isLeft = i % 2 === 0;
                return (
                  <div
                    key={ms.period}
                    className="relative flex items-center md:justify-center"
                  >
                    {/* Dot */}
                    <div
                      className="absolute left-6 z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full md:left-1/2"
                      style={{
                        background: ms.color,
                        boxShadow: `0 0 12px ${ms.color}60`,
                      }}
                    />

                    {/* Card — desktop alternating, mobile always right */}
                    <div
                      className={`ml-12 w-full md:ml-0 md:w-[calc(50%-2rem)] ${
                        isLeft
                          ? "md:mr-auto md:pr-0 md:text-right"
                          : "md:ml-auto md:pl-0 md:text-left"
                      }`}
                    >
                      <div className="rounded-2xl border border-[#2A2A3A] bg-[#12121A] p-5">
                        <span
                          className="mb-2 inline-block font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider"
                          style={{ color: ms.color }}
                        >
                          {ms.period}
                        </span>
                        <p className="text-sm leading-relaxed text-[#E8E8F0]">
                          {ms.title}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mb-16 text-center">
            <p className="mkt-label">Our Values</p>
            <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
              What we believe in.
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {values.map((value) => (
              <div key={value.title} className="mkt-card">
                <div
                  className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{
                    background: `${value.color}15`,
                    border: `1px solid ${value.color}30`,
                    color: value.color,
                  }}
                >
                  {value.icon}
                </div>
                <h3
                  className="mb-2 text-lg font-semibold"
                  style={{ fontFamily: "var(--font-syne), 'Syne', sans-serif" }}
                >
                  {value.title}
                </h3>
                <p className="text-sm leading-relaxed text-[#8888A0]">
                  {value.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* By the Numbers */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mb-16 text-center">
            <p className="mkt-label">By the Numbers</p>
            <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
              Built to be <span className="text-gradient">comprehensive.</span>
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="mkt-card text-center">
                <div
                  className="mx-auto mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#6C5CE7]"
                  style={{
                    background: "rgba(108, 92, 231, 0.1)",
                    border: "1px solid rgba(108, 92, 231, 0.2)",
                  }}
                >
                  {stat.icon}
                </div>
                <p
                  className="mb-1 text-3xl font-bold text-gradient"
                  style={{ fontFamily: "var(--font-syne), 'Syne', sans-serif" }}
                >
                  {stat.value}
                </p>
                <p className="mb-2 text-sm font-semibold text-[#E8E8F0]">
                  {stat.label}
                </p>
                <p className="text-xs leading-relaxed text-[#8888A0]">
                  {stat.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Team */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mb-16 text-center">
            <p className="mkt-label">The Team</p>
            <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
              The people behind the <span className="text-gradient">platform.</span>
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {team.map((member) => (
              <div key={member.name} className="mkt-card text-center">
                <div
                  className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold"
                  style={{
                    background: `${member.color}15`,
                    border: `1px solid ${member.color}30`,
                    color: member.color,
                    fontFamily: "var(--font-syne), 'Syne', sans-serif",
                  }}
                >
                  {member.initials}
                </div>
                <h3
                  className="mb-1 text-base font-semibold text-[#E8E8F0]"
                  style={{ fontFamily: "var(--font-syne), 'Syne', sans-serif" }}
                >
                  {member.name}
                </h3>
                <p
                  className="mb-3 font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider"
                  style={{ color: member.color }}
                >
                  {member.role}
                </p>
                <p className="text-sm leading-relaxed text-[#8888A0]">
                  {member.bio}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Customer Love */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mb-16 text-center">
            <p className="mkt-label">Customer Love</p>
            <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
              Don&apos;t take our word for it.
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <div key={t.name} className="mkt-card relative">
                <div
                  className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: `${t.color}15`,
                    border: `1px solid ${t.color}30`,
                    color: t.color,
                  }}
                >
                  <Quote size={16} />
                </div>
                <p className="mb-6 text-[15px] leading-relaxed text-[#E8E8F0]">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-auto border-t border-[#2A2A3A] pt-4">
                  <p
                    className="text-sm font-semibold text-[#E8E8F0]"
                    style={{
                      fontFamily: "var(--font-syne), 'Syne', sans-serif",
                    }}
                  >
                    {t.name}
                  </p>
                  <p className="text-xs text-[#8888A0]">
                    {t.role}, {t.company}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recognized By */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mb-12 text-center">
            <p className="mkt-label">Recognized By</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6">
            {press.map((name) => (
              <div
                key={name}
                className="flex items-center justify-center rounded-2xl border border-[#2A2A3A] bg-[#12121A] px-8 py-4"
              >
                <span
                  className="text-lg font-bold tracking-tight text-[#8888A0]"
                  style={{ fontFamily: "var(--font-syne), 'Syne', sans-serif" }}
                >
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Backed By */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mkt-highlight text-center">
            <p className="mkt-label">Our Backers</p>
            <h2 className="mkt-title mx-auto mb-8 max-w-[640px] text-[clamp(1.4rem,2.5vw,2rem)]">
              Backed by entrepreneurs who&apos;ve built{" "}
              <span className="text-gradient">billion-dollar companies.</span>
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-8">
              {investors.map((inv) => (
                <div key={inv.name} className="text-center">
                  <p
                    className="text-base font-semibold text-[#E8E8F0]"
                    style={{
                      fontFamily: "var(--font-syne), 'Syne', sans-serif",
                    }}
                  >
                    {inv.name}
                  </p>
                  <p className="font-[family-name:var(--font-mono)] text-xs text-[#8888A0]">
                    {inv.note}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mkt-highlight text-center">
            <p className="mkt-label">Get Started</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Ready to run your business better?
            </h2>
            <p className="mx-auto mb-8 max-w-[480px] text-base text-[#8888A0]">
              Join the businesses replacing chaos with clarity. Start your free
              trial and experience every module working together.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/register" className="btn-primary px-8 py-3.5">
                Start Free Trial <ArrowUpRight size={16} />
              </Link>
              <Link href="/pricing" className="btn-outline px-8 py-3.5">
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
