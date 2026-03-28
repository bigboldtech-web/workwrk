import type { Metadata } from "next";
import Link from "next/link";
import {
  Rocket,
  Users,
  Target,
  CheckSquare,
  BookOpen,
  Star,
  BarChart3,
  Brain,
  Settings,
  Link2,
  Mail,
  ArrowUpRight,
} from "lucide-react";
import {
  FadeIn,
  StaggerContainer,
  StaggerItem,
} from "@/components/marketing/motion";

export const metadata: Metadata = {
  title: "Documentation — TheywrK | Help Center",
  description:
    "Browse TheywrK documentation and help guides. Learn how to set up your organization, manage people, track KPIs, run performance reviews, and more.",
  openGraph: {
    title: "Documentation — TheywrK Help Center",
    description:
      "Guides and documentation for every TheywrK module — getting started, people management, KRAs, tasks, SOPs, reviews, scoring, AI, and integrations.",
  },
};

const docCategories = [
  {
    icon: <Rocket size={28} />,
    color: "#6C5CE7",
    title: "Getting Started",
    links: [
      "Creating your account",
      "Setting up your organization",
      "Adding team members",
      "Configuring departments & roles",
    ],
  },
  {
    icon: <Users size={28} />,
    color: "#00D68F",
    title: "People Management",
    links: [
      "Managing employee profiles",
      "Org chart & hierarchy",
      "Bulk import employees",
      "Onboarding workflows",
    ],
  },
  {
    icon: <Target size={28} />,
    color: "#FF6B6B",
    title: "KRAs & KPIs",
    links: [
      "Setting up KRAs",
      "Creating KPIs & targets",
      "Assigning KRAs to employees",
      "Tracking KPI scores",
    ],
  },
  {
    icon: <CheckSquare size={28} />,
    color: "#FFA726",
    title: "Tasks",
    links: [
      "Creating & assigning tasks",
      "Priority levels (P0-P3)",
      "Task workflows",
      "Tracking completion",
    ],
  },
  {
    icon: <BookOpen size={28} />,
    color: "#26C6DA",
    title: "SOPs",
    links: [
      "Creating SOPs",
      "Assigning SOPs to teams",
      "Tracking compliance",
      "Version management",
    ],
  },
  {
    icon: <Star size={28} />,
    color: "#FFCA28",
    title: "Performance Reviews",
    links: [
      "Setting up review cycles",
      "Self-assessment flow",
      "Manager & peer reviews",
      "Calibration process",
    ],
  },
  {
    icon: <BarChart3 size={28} />,
    color: "#AB47BC",
    title: "Composite Scores",
    links: [
      "How scoring works",
      "Configuring weights",
      "Score interpretation",
      "Using scores for decisions",
    ],
  },
  {
    icon: <Brain size={28} />,
    color: "#EC407A",
    title: "AI Assistant",
    links: [
      "Asking questions",
      "Performance insights",
      "Generating reports",
      "AI-powered recommendations",
    ],
  },
  {
    icon: <Settings size={28} />,
    color: "#78909C",
    title: "Settings & Admin",
    links: [
      "Organization settings",
      "User permissions & roles",
      "Module configuration",
      "Security settings",
    ],
  },
  {
    icon: <Link2 size={28} />,
    color: "#29B6F6",
    title: "Integrations",
    links: [
      "Connecting HRMS",
      "Slack integration",
      "Google Workspace",
      "Webhooks & API",
    ],
  },
];

export default function DocsPage() {
  return (
    <div>
      {/* Hero */}
      <section className="pb-20 pt-36">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <p className="mkt-label">Help Center</p>
            <h1 className="mkt-title mb-4 text-[clamp(2.2rem,5vw,3.5rem)]">
              Documentation &<br />
              <span className="text-gradient">guides.</span>
            </h1>
            <p className="mb-8 max-w-[560px] text-lg text-[#8888A0]">
              Everything you need to get the most out of TheywrK. Browse by
              topic or search for what you need.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Doc Categories Grid */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <StaggerContainer className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {docCategories.map((cat) => (
              <StaggerItem key={cat.title}>
                <div className="mkt-card flex h-full flex-col p-6">
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: `${cat.color}15`,
                      color: cat.color,
                    }}
                  >
                    {cat.icon}
                  </div>
                  <h3 className="mb-3 text-lg font-semibold text-[#E8E8F0]">
                    {cat.title}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {cat.links.map((linkText) => (
                      <li key={linkText}>
                        <Link
                          href="#"
                          className="text-sm text-[#8888A0] transition-colors hover:text-[#E8E8F0]"
                        >
                          {linkText}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Need Help CTA */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <FadeIn>
            <div className="mkt-highlight text-center">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#6C5CE7]/10 text-[#6C5CE7]">
                <Mail size={28} />
              </div>
              <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
                Need help?
              </h2>
              <p className="mx-auto mb-8 max-w-[440px] text-base text-[#8888A0]">
                Can&apos;t find what you&apos;re looking for? Our support team
                is ready to help you out.
              </p>
              <div className="flex items-center justify-center gap-4">
                <Link
                  href="mailto:support@theywrk.com"
                  className="btn-primary px-8 py-3.5"
                >
                  support@theywrk.com <ArrowUpRight size={16} />
                </Link>
                <Link href="/faq" className="btn-outline px-8 py-3.5">
                  Browse FAQ
                </Link>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </div>
  );
}
