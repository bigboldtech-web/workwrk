import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
  X,
  ArrowUpRight,
  Sparkles,
  Building2,
  Rocket,
  Crown,
  Clock,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { FadeIn, StaggerContainer, StaggerItem, ScaleIn } from "@/components/marketing/motion";

export const metadata: Metadata = {
  title: "Pricing — WorkwrK | Plans for Every Business Size",
  description:
    "Transparent pricing for teams of every size. From startups with 25 users to enterprise organizations — get the business operating system that scales with you. Plans start at ₹4,999/mo.",
  openGraph: {
    title: "Pricing — WorkwrK | Plans for Every Business Size",
    description:
      "Transparent pricing for teams of every size. From startups with 25 users to enterprise organizations — get the business operating system that scales with you.",
  },
};

const tiers = [
  {
    name: "Starter",
    icon: <Sparkles size={24} />,
    price: "4,999",
    period: "/mo",
    users: "Up to 25 users",
    description: "For small teams getting started with structured operations.",
    popular: false,
    cta: "Start Free Trial",
    ctaHref: "/register",
    features: [
      "People Management",
      "Basic KRA/KPI Tracking",
      "Task Management",
      "5 SOPs",
      "Basic Analytics",
      "Email Support",
    ],
  },
  {
    name: "Growth",
    icon: <Rocket size={24} />,
    price: "14,999",
    period: "/mo",
    users: "Up to 100 users",
    description:
      "For scaling teams that need performance insights and AI power.",
    popular: true,
    cta: "Start Free Trial",
    ctaHref: "/register",
    features: [
      "Everything in Starter",
      "Performance Reviews",
      "Unlimited SOPs",
      "Recognition & Kudos",
      "Composite Scores",
      "AI — 100 queries/mo",
      "Meetings & Action Items",
      "Advanced Analytics",
      "Priority Support",
    ],
  },
  {
    name: "Scale",
    icon: <Building2 size={24} />,
    price: "29,999",
    period: "/mo",
    users: "Up to 500 users",
    description:
      "For multi-location orgs that need full control and integrations.",
    popular: false,
    cta: "Start Free Trial",
    ctaHref: "/register",
    features: [
      "Everything in Growth",
      "Unlimited AI Queries",
      "Webhooks & API Access",
      "Multi-location Support",
      "Dedicated Success Manager",
      "Custom Onboarding",
      "Advanced Data Export",
    ],
  },
  {
    name: "Enterprise",
    icon: <Crown size={24} />,
    price: "Custom",
    period: "",
    users: "Unlimited users",
    description:
      "For organizations that need dedicated infrastructure and SLAs.",
    popular: false,
    cta: "Contact Sales",
    ctaHref: "/contact",
    features: [
      "Everything in Scale",
      "Dedicated Database",
      "Custom Modules",
      "On-Premise Deployment",
      "SLA Guarantees",
      "White-labeling",
      "Custom Score Weights",
    ],
  },
];

const comparisonFeatures = [
  {
    category: "Core",
    features: [
      {
        name: "People Management",
        starter: true,
        growth: true,
        scale: true,
        enterprise: true,
      },
      {
        name: "KRA/KPI Tracking",
        starter: "Basic",
        growth: true,
        scale: true,
        enterprise: true,
      },
      {
        name: "Task Management",
        starter: true,
        growth: true,
        scale: true,
        enterprise: true,
      },
      {
        name: "SOPs",
        starter: "5",
        growth: "Unlimited",
        scale: "Unlimited",
        enterprise: "Unlimited",
      },
    ],
  },
  {
    category: "Performance",
    features: [
      {
        name: "Performance Reviews",
        starter: false,
        growth: true,
        scale: true,
        enterprise: true,
      },
      {
        name: "Composite Scores",
        starter: false,
        growth: true,
        scale: true,
        enterprise: true,
      },
      {
        name: "Recognition & Kudos",
        starter: false,
        growth: true,
        scale: true,
        enterprise: true,
      },
      {
        name: "Custom Score Weights",
        starter: false,
        growth: false,
        scale: false,
        enterprise: true,
      },
    ],
  },
  {
    category: "Intelligence",
    features: [
      {
        name: "AI Queries",
        starter: false,
        growth: "100/mo",
        scale: "Unlimited",
        enterprise: "Unlimited",
      },
      {
        name: "Analytics",
        starter: "Basic",
        growth: "Advanced",
        scale: "Advanced",
        enterprise: "Advanced",
      },
      {
        name: "Data Export",
        starter: false,
        growth: "CSV",
        scale: "Advanced",
        enterprise: "Advanced",
      },
    ],
  },
  {
    category: "Collaboration",
    features: [
      {
        name: "Meetings & Action Items",
        starter: false,
        growth: true,
        scale: true,
        enterprise: true,
      },
      {
        name: "Webhooks & API",
        starter: false,
        growth: false,
        scale: true,
        enterprise: true,
      },
      {
        name: "Multi-location",
        starter: false,
        growth: false,
        scale: true,
        enterprise: true,
      },
    ],
  },
  {
    category: "Support & Infrastructure",
    features: [
      {
        name: "Support",
        starter: "Email",
        growth: "Priority",
        scale: "Dedicated Manager",
        enterprise: "Dedicated Manager",
      },
      {
        name: "Custom Onboarding",
        starter: false,
        growth: false,
        scale: true,
        enterprise: true,
      },
      {
        name: "SLA Guarantees",
        starter: false,
        growth: false,
        scale: false,
        enterprise: true,
      },
      {
        name: "Dedicated Database",
        starter: false,
        growth: false,
        scale: false,
        enterprise: true,
      },
      {
        name: "On-Premise Deployment",
        starter: false,
        growth: false,
        scale: false,
        enterprise: true,
      },
      {
        name: "White-labeling",
        starter: false,
        growth: false,
        scale: false,
        enterprise: true,
      },
      {
        name: "Custom Modules",
        starter: false,
        growth: false,
        scale: false,
        enterprise: true,
      },
    ],
  },
];

const trustBadges = [
  { icon: <Clock size={20} />, label: "14-day Free Trial" },
  { icon: <CreditCard size={20} />, label: "No Credit Card Required" },
  { icon: <RefreshCw size={20} />, label: "Cancel Anytime" },
  { icon: <ShieldCheck size={20} />, label: "SOC 2 Compliant" },
];

const faqItems = [
  {
    question: "What billing cycles do you offer?",
    answer:
      "We offer both monthly and annual billing. Annual billing saves you 20% compared to monthly payments. You can switch between billing cycles at any time from your account settings.",
  },
{
    question: "Can I upgrade or downgrade my plan?",
    answer:
      "Yes, you can change your plan at any time. When upgrading, you'll be charged the prorated difference for the remainder of your billing cycle. When downgrading, the new rate takes effect at the start of your next billing cycle. No data is lost when switching plans.",
  },
  {
    question: "Are there user limits on each plan?",
    answer:
      "Yes — Starter supports up to 25 users, Growth up to 100 users, and Scale up to 500 users. Enterprise plans have no user limits. If you need more users than your current plan allows, you can upgrade to the next tier or contact sales for a custom arrangement.",
  },
  {
    question: "What happens when my free trial ends?",
    answer:
      "At the end of your 14-day trial, you'll be prompted to choose a plan. Your data and configurations are preserved for 30 days after trial expiration, so you won't lose any work. No charges are applied until you actively select a paid plan.",
  },
];

function CellValue({ value }: { value: boolean | string }) {
  if (value === true)
    return <Check size={18} className="mx-auto text-[#00D68F]" />;
  if (value === false)
    return <X size={18} className="mx-auto text-[#3A3A4A]" />;
  return (
    <span className="text-sm text-[#E8E8F0]">{value}</span>
  );
}

export default function PricingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pb-20 pt-36">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="relative mx-auto max-w-[1200px] px-6 text-center">
          <FadeIn delay={0}>
            <p className="mkt-label animate-fade-in">Pricing</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1 className="mkt-title mx-auto mb-4 max-w-[700px] text-[clamp(2.2rem,5vw,3.5rem)] animate-fade-in-1">
              Simple pricing.{" "}
              <span className="text-gradient">No surprises.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto mb-2 max-w-[560px] text-lg text-[#8888A0] animate-fade-in-2">
              Start free for 14 days. Pick the plan that fits your team size and
              upgrade as you grow.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Trust badges */}
      <section className="pb-16">
        <div className="mx-auto max-w-[1200px] px-6">
          <StaggerContainer className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
            {trustBadges.map((badge) => (
              <StaggerItem key={badge.label}>
                <div
                  className="flex items-center gap-2.5 rounded-full border border-[#2A2A3A] bg-[#12121A] px-5 py-2.5"
                >
                  <span className="text-[#00D68F]">{badge.icon}</span>
                  <span className="font-[family-name:var(--font-mono)] text-xs tracking-wide text-[#E8E8F0]">
                    {badge.label}
                  </span>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Annual billing badge + Pricing cards */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          {/* Save 20% badge */}
          <div className="mb-10 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#6C5CE7]/30 bg-[#6C5CE7]/10 px-5 py-2.5">
              <Zap size={16} className="text-[#FF9F43]" />
              <span className="font-[family-name:var(--font-mono)] text-sm font-semibold tracking-wide text-[#A29BFE]">
                Save 20% with annual billing
              </span>
            </div>
          </div>

          <StaggerContainer className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {tiers.map((tier) => (
              <StaggerItem key={tier.name}>
              <div
                className={`price-card flex flex-col transition-all duration-300 hover:-translate-y-1 ${tier.popular ? "popular" : ""}`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-block rounded-full bg-[#6C5CE7] px-4 py-1 font-[family-name:var(--font-mono)] text-[0.65rem] font-bold uppercase tracking-widest text-white">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6 flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{
                      background: tier.popular
                        ? "rgba(108, 92, 231, 0.15)"
                        : "rgba(136, 136, 160, 0.1)",
                      color: tier.popular ? "#A29BFE" : "#8888A0",
                    }}
                  >
                    {tier.icon}
                  </div>
                  <h3 className="font-[family-name:var(--font-syne)] text-lg font-bold text-[#E8E8F0]">
                    {tier.name}
                  </h3>
                </div>

                <div className="mb-2">
                  {tier.price === "Custom" ? (
                    <span className="font-[family-name:var(--font-syne)] text-3xl font-bold text-[#E8E8F0]">
                      Custom
                    </span>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="font-[family-name:var(--font-mono)] text-sm text-[#8888A0]">
                        ₹
                      </span>
                      <span className="font-[family-name:var(--font-syne)] text-3xl font-bold text-[#E8E8F0]">
                        {tier.price}
                      </span>
                      <span className="text-sm text-[#8888A0]">
                        {tier.period}
                      </span>
                    </div>
                  )}
                </div>

                <p className="mb-4 font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-[#6C5CE7]">
                  {tier.users}
                </p>

                <p className="mb-6 text-sm leading-relaxed text-[#8888A0]">
                  {tier.description}
                </p>

                <Link
                  href={tier.ctaHref}
                  className={`mb-6 w-full justify-center py-3 ${tier.popular ? "btn-primary" : "btn-outline"}`}
                >
                  {tier.cta}
                  <ArrowUpRight size={15} />
                </Link>

                <div className="mt-auto border-t border-[#2A2A3A] pt-6">
                  <p className="mb-3 font-[family-name:var(--font-mono)] text-[0.65rem] uppercase tracking-widest text-[#8888A0]">
                    What&apos;s included
                  </p>
                  <ul className="flex flex-col gap-2.5">
                    {tier.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2.5 text-sm text-[#8888A0]"
                      >
                        <Check
                          size={15}
                          className="mt-0.5 flex-shrink-0 text-[#00D68F]"
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Comparison table */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mb-12 text-center">
            <p className="mkt-label">Compare</p>
            <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
              Full feature comparison
            </h2>
          </div>

          <FadeIn>
          <div className="overflow-x-auto rounded-2xl border border-[#2A2A3A] bg-[#12121A]">
            <table className="w-full min-w-[700px] text-left">
              <thead>
                <tr className="border-b border-[#2A2A3A]">
                  <th className="px-6 py-5 font-[family-name:var(--font-syne)] text-sm font-bold text-[#E8E8F0]">
                    Feature
                  </th>
                  <th className="px-4 py-5 text-center font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-[#8888A0]">
                    Starter
                  </th>
                  <th className="px-4 py-5 text-center font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-[#6C5CE7]">
                    Growth
                  </th>
                  <th className="px-4 py-5 text-center font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-[#8888A0]">
                    Scale
                  </th>
                  <th className="px-4 py-5 text-center font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-[#8888A0]">
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((category) => (
                  <>
                    <tr key={category.category}>
                      <td
                        colSpan={5}
                        className="bg-[#0E0E16] px-6 py-3 font-[family-name:var(--font-mono)] text-[0.65rem] uppercase tracking-[4px] text-[#6C5CE7]"
                      >
                        {category.category}
                      </td>
                    </tr>
                    {category.features.map((feature) => (
                      <tr
                        key={feature.name}
                        className="border-b border-[#2A2A3A]/40 transition-colors hover:bg-[#16161F]"
                      >
                        <td className="px-6 py-3.5 text-sm text-[#E8E8F0]">
                          {feature.name}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <CellValue value={feature.starter} />
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <CellValue value={feature.growth} />
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <CellValue value={feature.scale} />
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <CellValue value={feature.enterprise} />
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          </FadeIn>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section className="pb-28">
        <div className="mx-auto max-w-[800px] px-6">
          <FadeIn>
            <div className="mb-12 text-center">
              <p className="mkt-label">FAQ</p>
              <h2 className="mkt-title text-[clamp(1.8rem,3vw,2.5rem)]">
                Pricing questions, answered
              </h2>
            </div>
          </FadeIn>

          <StaggerContainer className="flex flex-col gap-4">
            {faqItems.map((item) => (
              <StaggerItem key={item.question}>
                <details
                  className="group rounded-xl border border-[#2A2A3A] bg-[#12121A] transition-colors open:border-[#6C5CE7]/30"
                >
                  <summary className="flex cursor-pointer items-center justify-between px-6 py-5 font-[family-name:var(--font-syne)] text-base font-semibold text-[#E8E8F0] marker:[font-size:0] [&::-webkit-details-marker]:hidden">
                    <span>{item.question}</span>
                    <span className="ml-4 flex-shrink-0 text-[#8888A0] transition-transform group-open:rotate-45">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 20 20"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M10 4V16M4 10H16"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                  </summary>
                  <div className="px-6 pb-5 text-sm leading-relaxed text-[#8888A0]">
                    {item.answer}
                  </div>
                </details>
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
              <FadeIn delay={0.15}>
                <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
                  Not sure which plan is right?
                </h2>
                <p className="mx-auto mb-8 max-w-[480px] text-base text-[#8888A0]">
                  Start with a 14-day free trial on any plan. No credit card
                  required. Upgrade, downgrade, or cancel anytime.
                </p>
                <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                  <Link href="/register" className="btn-primary px-8 py-3.5">
                    Start Free Trial <ArrowUpRight size={16} />
                  </Link>
                  <Link href="/contact" className="btn-outline px-8 py-3.5">
                    Talk to Sales
                  </Link>
                </div>
              </FadeIn>
            </div>
          </ScaleIn>
        </div>
      </section>
    </>
  );
}
