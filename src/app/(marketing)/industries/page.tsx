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
} from "lucide-react";
import { FadeIn, StaggerContainer, StaggerItem, ScaleIn } from "@/components/marketing/motion";

export const metadata: Metadata = {
  title: "Industries — WorkwrK | Business OS for Every Industry",
  description:
    "WorkwrK adapts to every industry — professional services, real estate, retail, manufacturing, healthcare, education, logistics, IT, finance, franchises, security, and media. One platform, tailored workflows, measurable outcomes.",
  openGraph: {
    title: "Industries — WorkwrK | Business OS for Every Industry",
    description:
      "From professional services to manufacturing, healthcare to SaaS — see how WorkwrK powers operations, people management, and performance tracking across 12+ industries worldwide.",
  },
};

const industries = [
  {
    icon: <Briefcase size={28} />,
    color: "#6C5CE7",
    title: "Professional Services",
    description:
      "Run consulting, legal, and accounting firms with clarity. WorkwrK tracks billable utilization, manages client deliverables, and scores consultants on project outcomes — not timesheets.",
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
      "Multi-store chains and e-commerce brands use WorkwrK to standardize store operations, track per-location performance, and build consistent customer experiences at scale.",
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
      "Schools, coaching institutes, and EdTech companies use WorkwrK to evaluate faculty, standardize teaching methodologies, and track student outcome metrics tied to educator KPIs.",
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
      "Warehousing, fleet management, and supply chain operations thrive on process discipline. WorkwrK brings SOP compliance, driver scoring, and hub-level analytics to logistics teams.",
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
      "Multi-location franchises need consistency. WorkwrK standardizes operations across every outlet with shared SOPs, franchisee scoring, and real-time cross-location dashboards.",
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
      "Guard services and facilities management companies manage large distributed workforces. WorkwrK tracks guard performance, site SOPs, incident reports, and client-level analytics.",
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
      "Agencies, production houses, and PR firms juggle multiple clients and creative teams. WorkwrK tracks project delivery, creative output KPIs, and team utilization across accounts.",
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
      "WorkwrK transformed how we manage our 8 restaurant locations. Every store manager now follows the same SOPs, and I can compare performance across locations in seconds.",
    name: "Rahul Mehta",
    title: "Founder, FreshBite Restaurants",
    color: "#FF9F43",
    industry: "Franchise Operations",
  },
  {
    quote:
      "As a consulting firm, we needed visibility into consultant utilization and project delivery. WorkwrK gave us that overnight.",
    name: "Ananya Rao",
    title: "Managing Partner, Elevate Advisory",
    color: "#6C5CE7",
    industry: "Professional Services",
  },
];


export default function IndustriesPage() {
  return (
    <>
      {/* Hero */}
      <section className="pb-20 pt-36">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <p className="mkt-label">Industries</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1 className="mkt-title mb-4 text-[clamp(2.2rem,5vw,3.5rem)]">
              Built for how <em>your</em> industry works.<br />
              <span className="text-gradient">Not the other way around.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mb-8 max-w-[600px] text-lg text-muted">
              WorkwrK adapts to the workflows, KPIs, and compliance needs of your
              sector. One platform — configured for professional services,
              manufacturing, healthcare, SaaS, and everything in between.
            </p>
          </FadeIn>
          <FadeIn delay={0.3}>
            <Link href="/register" className="btn-primary">
              Start Free Trial <ArrowUpRight size={16} />
            </Link>
          </FadeIn>
        </div>
      </section>

      {/* Stats bar */}
      <section className="pb-20">
        <div className="mx-auto max-w-[1200px] px-6">
          <StaggerContainer
            className="grid grid-cols-2 gap-4 sm:grid-cols-4 rounded-2xl border border-border bg-surface p-6 sm:p-8"
          >
            {stats.map((stat) => (
              <StaggerItem key={stat.label} className="text-center">
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
                  className="mt-1 text-sm text-muted"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {stat.label}
                </p>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Industry grid */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <StaggerContainer className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((ind) => (
              <StaggerItem key={ind.title}>
              <article className="mkt-card flex flex-col p-6 h-full">
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
                  className="mb-2 text-lg font-semibold text-foreground"
                  style={{ fontFamily: "var(--font-syne), sans-serif" }}
                >
                  {ind.title}
                </h2>

                <p className="mb-4 text-sm leading-relaxed text-muted">
                  {ind.description}
                </p>

                <ul className="mt-auto flex flex-col gap-2">
                  {ind.useCases.map((uc) => (
                    <li
                      key={uc}
                      className="flex items-start gap-2 text-xs text-muted"
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
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Testimonials */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn className="text-center">
            <p className="mkt-label">Testimonials</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Trusted by leaders across{" "}
              <span className="text-gradient">every sector.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-[520px] text-base text-muted">
              Hear from founders, partners, and operations heads who transformed
              their businesses with WorkwrK.
            </p>
          </FadeIn>

          <StaggerContainer className="grid gap-6 sm:grid-cols-2">
            {testimonials.map((t) => (
              <StaggerItem key={t.name}>
              <div
                className="mkt-card relative flex flex-col p-6 h-full"
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

                <p className="mb-6 flex-1 text-sm leading-relaxed text-foreground">
                  &ldquo;{t.quote}&rdquo;
                </p>

                <div className="border-t border-border pt-4">
                  <p
                    className="text-sm font-semibold text-foreground"
                    style={{ fontFamily: "var(--font-syne), sans-serif" }}
                  >
                    {t.name}
                  </p>
                  <p className="text-xs text-muted">{t.title}</p>
                </div>
              </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Enhanced GEO reach */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn className="text-center">
            <p className="mkt-label">Global Reach</p>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Powering businesses across{" "}
              <span className="text-gradient">four continents.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-[520px] text-base text-muted">
              From Mumbai to Dubai, Singapore to San Francisco — WorkwrK runs
              wherever your teams operate.
            </p>
          </FadeIn>

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
              <Globe size={32} className="relative z-10 text-muted opacity-30" />
            </div>
          </div>

          <StaggerContainer className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {geoRegions.map((geo) => (
              <StaggerItem key={geo.region}>
              <div
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
                  className="mb-1 text-lg font-semibold text-foreground"
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
                      className="rounded-full border border-border bg-background px-3 py-1 font-[family-name:var(--font-mono)] text-xs text-muted"
                    >
                      {city}
                    </span>
                  ))}
                </div>
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
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Your industry. Your workflows.{" "}
              <span className="text-gradient">Your OS.</span>
            </h2>
            <p className="mx-auto mb-8 max-w-[480px] text-base text-muted">
              Start your free trial and configure WorkwrK for your industry in
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
          </ScaleIn>
        </div>
      </section>
    </>
  );
}
