import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Eye,
  BarChart3,
  Users,
  Rocket,
  Quote,
} from "lucide-react";
import { FadeIn, StaggerContainer, StaggerItem, ScaleIn } from "@/components/marketing/motion";

export const metadata: Metadata = {
  title: "About — WorkwrK | The Business Operating System",
  description:
    "WorkwrK is the unified business operating system replacing 15+ disconnected tools with one platform for people, KPIs, SOPs, performance reviews, tasks, recognition, and AI intelligence. Built for growing businesses that refuse to stay small.",
  openGraph: {
    title: "About — WorkwrK | The Business Operating System",
    description:
      "We're building the operating system every growing business deserves. One platform to replace chaos with clarity, guesswork with data, and disconnected tools with unified intelligence.",
    url: "https://workwrk.com/about",
    siteName: "WorkwrK",
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
    desc: "Designed for growing businesses that refuse to stay small. From a 10-person agency to a 500-person enterprise, WorkwrK scales with your ambition.",
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


const testimonials = [
  {
    quote:
      "WorkwrK is not just a tool — it's how we run our company now.",
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
      "Our managers finally make promotion decisions backed by real data instead of gut feelings.",
    name: "Deepak Rao",
    role: "VP of HR",
    company: "TalentEdge",
    color: "#FF9F43",
  },
];

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative pb-20 pt-36">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px] px-6 text-center">
          <FadeIn>
            <p className="mkt-label">About WorkwrK</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1 className="mkt-title mx-auto mb-6 max-w-[800px] text-[clamp(2.2rem,5vw,3.5rem)]">
              We&apos;re building the operating system every growing business{" "}
              <span className="text-gradient">deserves.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto mb-8 max-w-[560px] text-lg text-muted">
              One platform to replace chaos with clarity, guesswork with data,
              and disconnected tools with unified intelligence.
            </p>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="flex items-center justify-center gap-4">
              <Link href="/register" className="btn-primary px-8 py-3.5">
                Start Free Trial <ArrowUpRight size={16} />
              </Link>
              <Link href="/features" className="btn-outline px-8 py-3.5">
                Explore Features
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Mission */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <div className="mkt-highlight text-center">
              <p className="mkt-label">Our Mission</p>
              <h2 className="mkt-title mx-auto mb-6 max-w-[800px] text-[clamp(1.6rem,3vw,2.4rem)]">
                To replace chaos with clarity. To replace guesswork with data.
              </h2>
              <p className="mx-auto max-w-[640px] text-base leading-relaxed text-muted">
                To give every business — from a 10-person agency to a 500-person
                enterprise — the tools to operate at their best. We believe that
                great businesses aren&apos;t built on gut feelings. They&apos;re built on
                clarity, accountability, and data that tells the truth.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* The Story */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <FadeIn direction="left">
              <p className="mkt-label">The Story</p>
              <h2 className="mkt-title mb-6 text-[clamp(1.8rem,3vw,2.5rem)]">
                Born from watching businesses{" "}
                <span className="text-gradient">struggle.</span>
              </h2>
              <div className="flex flex-col gap-5 text-[15px] leading-relaxed text-muted">
                <p>
                  WorkwrK was born from watching businesses drown in 15+
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
            </FadeIn>

            <FadeIn direction="right" delay={0.2}>
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
                  className="rounded-2xl border border-border bg-surface p-6"
                >
                  <h3 className="mb-4 font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-[#A29BFE]">
                    {block.label}
                  </h3>
                  <ul className="flex flex-col gap-2.5">
                    {block.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 text-sm text-muted"
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
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <div className="mb-16 text-center">
              <p className="mkt-label">Our Journey</p>
              <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
                From idea to <span className="text-gradient">impact.</span>
              </h2>
            </div>
          </FadeIn>

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

            <StaggerContainer className="flex flex-col gap-12" stagger={0.15}>
              {milestones.map((ms, i) => {
                const isLeft = i % 2 === 0;
                return (
                  <StaggerItem
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
                      <div className="rounded-2xl border border-border bg-surface p-5">
                        <span
                          className="mb-2 inline-block font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider"
                          style={{ color: ms.color }}
                        >
                          {ms.period}
                        </span>
                        <p className="text-sm leading-relaxed text-foreground">
                          {ms.title}
                        </p>
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <div className="mb-16 text-center">
              <p className="mkt-label">Our Values</p>
              <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
                What we believe in.
              </h2>
            </div>
          </FadeIn>

          <StaggerContainer className="grid gap-6 sm:grid-cols-2">
            {values.map((value) => (
              <StaggerItem key={value.title} className="mkt-card">
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
                <p className="text-sm leading-relaxed text-muted">
                  {value.desc}
                </p>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* The Team */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <div className="mb-16 text-center">
              <p className="mkt-label">The Team</p>
              <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
                The people behind the <span className="text-gradient">platform.</span>
              </h2>
            </div>
          </FadeIn>

          <StaggerContainer className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {team.map((member) => (
              <StaggerItem key={member.name} className="mkt-card text-center">
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
                  className="mb-1 text-base font-semibold text-foreground"
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
                <p className="text-sm leading-relaxed text-muted">
                  {member.bio}
                </p>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Customer Love */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <div className="mb-16 text-center">
              <p className="mkt-label">Customer Love</p>
              <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
                Don&apos;t take our word for it.
              </h2>
            </div>
          </FadeIn>

          <StaggerContainer className="grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <StaggerItem key={t.name} className="mkt-card relative">
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
                <p className="mb-6 text-[15px] leading-relaxed text-foreground">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-auto border-t border-border pt-4">
                  <p
                    className="text-sm font-semibold text-foreground"
                    style={{
                      fontFamily: "var(--font-syne), 'Syne', sans-serif",
                    }}
                  >
                    {t.name}
                  </p>
                  <p className="text-xs text-muted">
                    {t.role}, {t.company}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <ScaleIn>
            <div className="mkt-highlight text-center">
              <p className="mkt-label">Get Started</p>
              <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
                Ready to run your business better?
              </h2>
              <p className="mx-auto mb-8 max-w-[480px] text-base text-muted">
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
          </ScaleIn>
        </div>
      </section>
    </>
  );
}
