import type { Metadata } from "next";
import Link from "next/link";
import {
  Briefcase,
  Building2,
  ShoppingBag,
  Factory,
  HeartPulse,
  GraduationCap,
  Truck,
  Code2,
  Landmark,
  Store,
  ShieldCheck,
  Megaphone,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  MapPin,
  Quote,
  Settings2,
  FileCheck2,
  BarChart3,
  TrendingUp,
  Users,
  Target,
  Zap,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Industries — TheywrK | Business OS for Every Industry",
  description:
    "TheywrK adapts to every industry — professional services, real estate, retail, manufacturing, healthcare, education, logistics, IT, finance, franchises, security, and media. One platform, tailored workflows, measurable outcomes.",
  openGraph: {
    title: "Industries — TheywrK | Business OS for Every Industry",
    description:
      "From professional services to manufacturing, healthcare to SaaS — see how TheywrK powers operations, people management, and performance tracking across 12+ industries worldwide.",
  },
};

const industries = [
  {
    icon: <Briefcase size={28} />,
    color: "#6C5CE7",
    title: "Professional Services",
    description:
      "Run consulting, legal, and accounting firms with clarity. TheywrK tracks billable utilization, manages client deliverables, and scores consultants on project outcomes — not timesheets.",
    useCases: [
      "Consultant utilization & KPI tracking",
      "Client deliverable SOP workflows",
      "Partner-level performance reviews",
      "Knowledge base for institutional expertise",
    ],
  },
  {
    icon: <Building2 size={28} />,
    color: "#00D68F",
    title: "Real Estate",
    description:
      "Developers, brokerages, and property management firms gain full visibility across projects, agents, and properties. Track sales pipelines, site progress, and team output in one place.",
    useCases: [
      "Agent performance scoring & leaderboards",
      "Site inspection SOP checklists",
      "Multi-project task management",
      "Brokerage branch comparison analytics",
    ],
  },
  {
    icon: <ShoppingBag size={28} />,
    color: "#A29BFE",
    title: "Retail & D2C",
    description:
      "Multi-store chains and e-commerce brands use TheywrK to standardize store operations, track per-location performance, and build consistent customer experiences at scale.",
    useCases: [
      "Store-level KPI dashboards",
      "Visual merchandising SOPs",
      "Seasonal workforce onboarding",
      "Mystery shopper score integration",
    ],
  },
  {
    icon: <Factory size={28} />,
    color: "#FF9F43",
    title: "Manufacturing",
    description:
      "Production units run tighter with SOP-driven processes, quality control tracking, and shift-level performance scoring. Reduce defects and downtime with data, not guesswork.",
    useCases: [
      "Shift supervisor KRA tracking",
      "Quality control SOP compliance",
      "Production line task workflows",
      "Safety incident & audit scoring",
    ],
  },
  {
    icon: <HeartPulse size={28} />,
    color: "#FF6B6B",
    title: "Healthcare",
    description:
      "Clinics, hospitals, and diagnostics centres manage clinical staff performance, patient care SOPs, and compliance requirements — all while maintaining audit-ready documentation.",
    useCases: [
      "Clinical staff performance reviews",
      "Patient care protocol SOPs",
      "Department-level compliance dashboards",
      "Credential & training tracking",
    ],
  },
  {
    icon: <GraduationCap size={28} />,
    color: "#6C5CE7",
    title: "Education",
    description:
      "Schools, coaching institutes, and EdTech companies use TheywrK to evaluate faculty, standardize teaching methodologies, and track student outcome metrics tied to educator KPIs.",
    useCases: [
      "Faculty KRA & student outcome KPIs",
      "Curriculum delivery SOP workflows",
      "Multi-campus performance comparison",
      "Parent feedback integration in reviews",
    ],
  },
  {
    icon: <Truck size={28} />,
    color: "#00D68F",
    title: "Logistics",
    description:
      "Warehousing, fleet management, and supply chain operations thrive on process discipline. TheywrK brings SOP compliance, driver scoring, and hub-level analytics to logistics teams.",
    useCases: [
      "Driver & warehouse staff KPIs",
      "Dispatch & loading dock SOPs",
      "Fleet utilization task tracking",
      "Hub-to-hub performance benchmarking",
    ],
  },
  {
    icon: <Code2 size={28} />,
    color: "#A29BFE",
    title: "IT & SaaS",
    description:
      "Software companies and digital agencies align engineering, product, and client teams around shared KRAs. Sprint velocity, deployment quality, and client satisfaction — all scored.",
    useCases: [
      "Engineering KPIs & sprint metrics",
      "Release management SOP checklists",
      "Cross-functional peer reviews",
      "Client project delivery scoring",
    ],
  },
  {
    icon: <Landmark size={28} />,
    color: "#FF9F43",
    title: "Financial Services",
    description:
      "Insurance, lending, and wealth management firms track advisor performance, ensure regulatory SOP compliance, and manage portfolio-level KPIs across branches.",
    useCases: [
      "Advisor AUM & conversion KPIs",
      "Regulatory compliance SOP tracking",
      "Branch-level performance analytics",
      "Audit-ready review documentation",
    ],
  },
  {
    icon: <Store size={28} />,
    color: "#6C5CE7",
    title: "Franchise Operations",
    description:
      "Multi-location franchises need consistency. TheywrK standardizes operations across every outlet with shared SOPs, franchisee scoring, and real-time cross-location dashboards.",
    useCases: [
      "Franchisee performance scorecards",
      "Brand compliance SOP enforcement",
      "Multi-location KPI benchmarking",
      "Centralized task assignment & tracking",
    ],
  },
  {
    icon: <ShieldCheck size={28} />,
    color: "#00D68F",
    title: "Security & Facilities",
    description:
      "Guard services and facilities management companies manage large distributed workforces. TheywrK tracks guard performance, site SOPs, incident reports, and client-level analytics.",
    useCases: [
      "Guard attendance & performance KPIs",
      "Site patrol & incident SOPs",
      "Client satisfaction scoring",
      "Multi-site workforce analytics",
    ],
  },
  {
    icon: <Megaphone size={28} />,
    color: "#FF6B6B",
    title: "Media & Marketing",
    description:
      "Agencies, production houses, and PR firms juggle multiple clients and creative teams. TheywrK tracks project delivery, creative output KPIs, and team utilization across accounts.",
    useCases: [
      "Account manager KRA tracking",
      "Campaign delivery SOP workflows",
      "Creative team peer reviews",
      "Client retention & NPS scoring",
    ],
  },
];

const geoRegions = [
  {
    region: "India",
    cities: ["Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad"],
    color: "#6C5CE7",
    businesses: "280+",
  },
  {
    region: "UAE",
    cities: ["Dubai", "Abu Dhabi"],
    color: "#00D68F",
    businesses: "90+",
  },
  {
    region: "Southeast Asia",
    cities: ["Singapore", "Kuala Lumpur", "Bangkok"],
    color: "#A29BFE",
    businesses: "75+",
  },
  {
    region: "Global",
    cities: ["Remote-first teams worldwide"],
    color: "#FF9F43",
    businesses: "55+",
  },
];

const stats = [
  { value: "12+", label: "Industries", color: "#6C5CE7" },
  { value: "4", label: "Continents", color: "#00D68F" },
  { value: "500+", label: "Businesses", color: "#A29BFE" },
  { value: "50K+", label: "Employees Managed", color: "#FF9F43" },
];

const testimonials = [
  {
    quote:
      "TheywrK transformed how we manage our 8 restaurant locations. Every store manager now follows the same SOPs, and I can compare performance across locations in seconds.",
    name: "Rahul Mehta",
    title: "Founder, FreshBite Restaurants",
    color: "#FF9F43",
    industry: "Franchise Operations",
  },
  {
    quote:
      "As a consulting firm, we needed visibility into consultant utilization and project delivery. TheywrK gave us that overnight.",
    name: "Ananya Rao",
    title: "Managing Partner, Elevate Advisory",
    color: "#6C5CE7",
    industry: "Professional Services",
  },
  {
    quote:
      "Our manufacturing plant reduced quality defects by 40% after implementing TheywrK's SOP compliance tracking.",
    name: "Vikram Singh",
    title: "Operations Head, Precision Manufacturing",
    color: "#00D68F",
    industry: "Manufacturing",
  },
];

const processSteps = [
  {
    step: "01",
    icon: <Settings2 size={28} />,
    title: "Configure your industry KPIs",
    description:
      "Choose from pre-built KPI templates for your sector or define custom metrics. Set targets, weights, and scoring logic tailored to how your industry measures success.",
    color: "#6C5CE7",
  },
  {
    step: "02",
    icon: <FileCheck2 size={28} />,
    title: "Set up department-specific SOPs",
    description:
      "Build step-by-step standard operating procedures for every department. Assign checklists, attach training materials, and enforce compliance automatically.",
    color: "#00D68F",
  },
  {
    step: "03",
    icon: <BarChart3 size={28} />,
    title: "Get performance insights in real-time",
    description:
      "Watch dashboards light up with live data. Compare locations, departments, and individuals — with alerts when metrics deviate from your benchmarks.",
    color: "#FF9F43",
  },
];

const spotlightMetrics = [
  {
    value: "35%",
    label: "increase in SOP compliance",
    color: "#6C5CE7",
    icon: <TrendingUp size={22} />,
  },
  {
    value: "2x",
    label: "faster onboarding",
    color: "#00D68F",
    icon: <Zap size={22} />,
  },
  {
    value: "60%",
    label: "reduction in store-level performance gaps",
    color: "#FF9F43",
    icon: <Target size={22} />,
  },
];

export default function IndustriesPage() {
  return (
    <>
      {/* Hero */}
      <section className="pb-20 pt-36">
        <div className="mx-auto max-w-[1200px] px-6">
          <p className="mkt-label">Industries</p>
          <h1 className="mkt-title mb-4 text-[clamp(2.2rem,5vw,3.5rem)]">
            Built for how <em>your</em> industry works.<br />
            <span className="text-gradient">Not the other way around.</span>
          </h1>
          <p className="mb-8 max-w-[600px] text-lg text-[#8888A0]">
            TheywrK adapts to the workflows, KPIs, and compliance needs of your
            sector. One platform — configured for professional services,
            manufacturing, healthcare, SaaS, and everything in between.
          </p>
          <Link href="/register" className="btn-primary">
            Start Free Trial <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>

      {/* Stats bar */}
      <section className="pb-20">
        <div className="mx-auto max-w-[1200px] px-6">
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-4 rounded-2xl border border-[#2A2A3A] bg-[#12121A] p-6 sm:p-8"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p
                  className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold"
                  style={{
                    fontFamily: "var(--font-syne), sans-serif",
                    color: stat.color,
                  }}
                >
                  {stat.value}
                </p>
                <p
                  className="mt-1 text-sm text-[#8888A0]"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industry grid */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((ind) => (
              <article key={ind.title} className="mkt-card flex flex-col p-6">
                <div
                  className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{
                    background: `${ind.color}15`,
                    border: `1px solid ${ind.color}30`,
                    color: ind.color,
                  }}
                >
                  {ind.icon}
                </div>

                <h2
                  className="mb-2 text-lg font-semibold text-[#E8E8F0]"
                  style={{ fontFamily: "var(--font-syne), sans-serif" }}
                >
                  {ind.title}
                </h2>

                <p className="mb-4 text-sm leading-relaxed text-[#8888A0]">
                  {ind.description}
                </p>

                <ul className="mt-auto flex flex-col gap-2">
                  {ind.useCases.map((uc) => (
                    <li
                      key={uc}
                      className="flex items-start gap-2 text-xs text-[#8888A0]"
                    >
                      <CheckCircle2
                        size={14}
                        className="mt-0.5 flex-shrink-0"
                        style={{ color: ind.color }}
                      />
                      {uc}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="text-center">
            <p className="mkt-label">Testimonials</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Trusted by leaders across{" "}
              <span className="text-gradient">every sector.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-[520px] text-base text-[#8888A0]">
              Hear from founders, partners, and operations heads who transformed
              their businesses with TheywrK.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="mkt-card relative flex flex-col p-6"
              >
                <div
                  className="absolute right-6 top-6 opacity-15"
                  style={{ color: t.color }}
                >
                  <Quote size={40} />
                </div>

                <span
                  className="mb-4 inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    background: `${t.color}15`,
                    border: `1px solid ${t.color}30`,
                    color: t.color,
                  }}
                >
                  {t.industry}
                </span>

                <p className="mb-6 flex-1 text-sm leading-relaxed text-[#E8E8F0]">
                  &ldquo;{t.quote}&rdquo;
                </p>

                <div className="border-t border-[#2A2A3A] pt-4">
                  <p
                    className="text-sm font-semibold text-[#E8E8F0]"
                    style={{ fontFamily: "var(--font-syne), sans-serif" }}
                  >
                    {t.name}
                  </p>
                  <p className="text-xs text-[#8888A0]">{t.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works for Your Industry */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="text-center">
            <p className="mkt-label">How It Works</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Three steps to{" "}
              <span className="text-gradient">industry-ready operations.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-[520px] text-base text-[#8888A0]">
              TheywrK configures to your industry in minutes. No custom
              development. No consultants. Just results.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {processSteps.map((step, idx) => (
              <div key={step.step} className="mkt-card relative p-6">
                {/* Connector line between cards */}
                {idx < processSteps.length - 1 && (
                  <div className="absolute -right-3 top-1/2 hidden h-px w-6 bg-[#2A2A3A] sm:block" />
                )}

                <span
                  className="mb-4 block text-xs font-bold tracking-[4px]"
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    color: step.color,
                  }}
                >
                  STEP {step.step}
                </span>

                <div
                  className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{
                    background: `${step.color}15`,
                    border: `1px solid ${step.color}30`,
                    color: step.color,
                  }}
                >
                  {step.icon}
                </div>

                <h3
                  className="mb-2 text-lg font-semibold text-[#E8E8F0]"
                  style={{ fontFamily: "var(--font-syne), sans-serif" }}
                >
                  {step.title}
                </h3>

                <p className="text-sm leading-relaxed text-[#8888A0]">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industry Spotlight: Retail & D2C */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="text-center">
            <p className="mkt-label">Industry Spotlight</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              How Retail & D2C brands{" "}
              <span className="text-gradient">win with TheywrK.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-[520px] text-base text-[#8888A0]">
              A look at how multi-store retail operations transform with
              standardized SOPs and real-time performance tracking.
            </p>
          </div>

          <div className="mkt-highlight p-8 sm:p-12">
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Left: Challenge, Solution, Results */}
              <div className="flex flex-col gap-8">
                {/* Challenge */}
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
                      style={{
                        background: "#FF6B6B15",
                        border: "1px solid #FF6B6B30",
                        color: "#FF6B6B",
                        fontFamily: "var(--font-mono), monospace",
                      }}
                    >
                      !
                    </span>
                    <h3
                      className="text-base font-semibold text-[#FF6B6B]"
                      style={{ fontFamily: "var(--font-syne), sans-serif" }}
                    >
                      The Challenge
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-[#8888A0]">
                    A 15-store D2C brand struggled with inconsistent customer
                    experiences across locations. Store managers followed
                    different processes, new hires took 3+ weeks to onboard, and
                    HQ had zero visibility into per-store performance metrics.
                  </p>
                </div>

                {/* Solution */}
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
                      style={{
                        background: "#6C5CE715",
                        border: "1px solid #6C5CE730",
                        color: "#6C5CE7",
                        fontFamily: "var(--font-mono), monospace",
                      }}
                    >
                      *
                    </span>
                    <h3
                      className="text-base font-semibold text-[#6C5CE7]"
                      style={{ fontFamily: "var(--font-syne), sans-serif" }}
                    >
                      The Solution
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-[#8888A0]">
                    TheywrK deployed industry-specific SOP templates for visual
                    merchandising, daily store opening/closing, and customer
                    interaction scripts. Each store manager received a KPI
                    dashboard with conversion rate, average basket size, and
                    mystery shopper scores. Onboarding was digitized with
                    step-by-step checklists.
                  </p>
                </div>

                {/* Results */}
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
                      style={{
                        background: "#00D68F15",
                        border: "1px solid #00D68F30",
                        color: "#00D68F",
                        fontFamily: "var(--font-mono), monospace",
                      }}
                    >
                      ^
                    </span>
                    <h3
                      className="text-base font-semibold text-[#00D68F]"
                      style={{ fontFamily: "var(--font-syne), sans-serif" }}
                    >
                      The Results
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-[#8888A0]">
                    Within 90 days, the brand achieved measurable improvements
                    across every location — from compliance rates to new hire
                    ramp-up time to closing the gap between best and
                    worst-performing stores.
                  </p>
                </div>
              </div>

              {/* Right: Metric cards */}
              <div className="flex flex-col gap-4">
                {spotlightMetrics.map((m) => (
                  <div
                    key={m.label}
                    className="flex items-center gap-5 rounded-2xl border border-[#2A2A3A] bg-[#0A0A0F] p-6"
                  >
                    <div
                      className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl"
                      style={{
                        background: `${m.color}15`,
                        border: `1px solid ${m.color}30`,
                        color: m.color,
                      }}
                    >
                      {m.icon}
                    </div>
                    <div>
                      <p
                        className="text-2xl font-bold"
                        style={{
                          fontFamily: "var(--font-syne), sans-serif",
                          color: m.color,
                        }}
                      >
                        {m.value}
                      </p>
                      <p className="text-sm text-[#8888A0]">{m.label}</p>
                    </div>
                  </div>
                ))}

                <Link
                  href="/register"
                  className="btn-primary mt-2 w-fit self-start px-6 py-3"
                >
                  Get Similar Results <ArrowUpRight size={16} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Enhanced GEO reach */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="text-center">
            <p className="mkt-label">Global Reach</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Powering businesses across{" "}
              <span className="text-gradient">four continents.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-[520px] text-base text-[#8888A0]">
              From Mumbai to Dubai, Singapore to San Francisco — TheywrK runs
              wherever your teams operate.
            </p>
          </div>

          {/* Globe visual */}
          <div className="mx-auto mb-12 flex items-center justify-center">
            <div
              className="relative flex h-48 w-48 items-center justify-center sm:h-64 sm:w-64"
            >
              {/* Outer ring */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  border: "1px solid #2A2A3A",
                  background: "radial-gradient(circle at 30% 30%, #12121A 0%, #0A0A0F 100%)",
                }}
              />
              {/* Grid lines - horizontal */}
              <div
                className="absolute inset-4 rounded-full"
                style={{
                  border: "1px dashed #2A2A3A",
                }}
              />
              <div
                className="absolute inset-10 rounded-full"
                style={{
                  border: "1px dashed #2A2A3A",
                }}
              />
              {/* Vertical arc line */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  border: "1px dashed #2A2A3A",
                  transform: "scaleX(0.5)",
                }}
              />
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  border: "1px dashed #2A2A3A",
                  transform: "scaleX(0.25)",
                }}
              />
              {/* Glow */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: "radial-gradient(circle at 50% 50%, rgba(108, 92, 231, 0.12) 0%, transparent 70%)",
                }}
              />
              {/* Dot markers */}
              {/* India */}
              <div
                className="absolute h-3 w-3 rounded-full"
                style={{
                  background: "#6C5CE7",
                  boxShadow: "0 0 12px rgba(108, 92, 231, 0.6)",
                  top: "38%",
                  left: "62%",
                }}
              />
              {/* UAE */}
              <div
                className="absolute h-2.5 w-2.5 rounded-full"
                style={{
                  background: "#00D68F",
                  boxShadow: "0 0 12px rgba(0, 214, 143, 0.6)",
                  top: "40%",
                  left: "52%",
                }}
              />
              {/* SEA */}
              <div
                className="absolute h-2.5 w-2.5 rounded-full"
                style={{
                  background: "#A29BFE",
                  boxShadow: "0 0 12px rgba(162, 155, 254, 0.6)",
                  top: "50%",
                  left: "70%",
                }}
              />
              {/* Global */}
              <div
                className="absolute h-2.5 w-2.5 rounded-full"
                style={{
                  background: "#FF9F43",
                  boxShadow: "0 0 12px rgba(255, 159, 67, 0.6)",
                  top: "32%",
                  left: "30%",
                }}
              />
              {/* Center icon */}
              <Globe size={32} className="relative z-10 text-[#8888A0] opacity-30" />
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {geoRegions.map((geo) => (
              <div
                key={geo.region}
                className="mkt-card p-6 text-center"
              >
                <div
                  className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{
                    background: `${geo.color}15`,
                    border: `1px solid ${geo.color}30`,
                    color: geo.color,
                  }}
                >
                  {geo.region === "Global" ? (
                    <Globe size={24} />
                  ) : (
                    <MapPin size={24} />
                  )}
                </div>

                <h3
                  className="mb-1 text-lg font-semibold text-[#E8E8F0]"
                  style={{ fontFamily: "var(--font-syne), sans-serif" }}
                >
                  {geo.region}
                </h3>

                <p
                  className="mb-3 text-sm font-semibold"
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    color: geo.color,
                  }}
                >
                  {geo.businesses} businesses
                </p>

                <div className="flex flex-wrap justify-center gap-2">
                  {geo.cities.map((city) => (
                    <span
                      key={city}
                      className="rounded-full border border-[#2A2A3A] bg-[#0A0A0F] px-3 py-1 font-[family-name:var(--font-mono)] text-xs text-[#8888A0]"
                    >
                      {city}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mkt-highlight text-center">
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Your industry. Your workflows.{" "}
              <span className="text-gradient">Your OS.</span>
            </h2>
            <p className="mx-auto mb-8 max-w-[480px] text-base text-[#8888A0]">
              Start your free trial and configure TheywrK for your industry in
              minutes — not months.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/register" className="btn-primary px-8 py-3.5">
                Start Free Trial
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
