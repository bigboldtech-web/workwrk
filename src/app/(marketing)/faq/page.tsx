import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { FaqAccordion } from "@/components/marketing/faq-accordion";

export const metadata: Metadata = {
  title: "FAQ — TheywrK | Frequently Asked Questions",
  description:
    "Get answers to common questions about TheywrK — the business operating system for performance management, composite scoring, AI intelligence, SOPs, and team recognition.",
  openGraph: {
    title: "FAQ — TheywrK | Frequently Asked Questions",
    description:
      "Everything you need to know about TheywrK: setup, features, security, integrations, and more.",
  },
};

const faqCategories = [
  {
    label: "General",
    items: [
      {
        question: "What is TheywrK?",
        answer:
          "TheywrK is a business operating system that brings together 12 integrated modules — people management, KRA/KPI tracking, performance reviews, SOPs, task management, recognition, composite scoring, AI intelligence, analytics, meetings, notifications, and integrations — into one platform. Instead of juggling separate tools, everything lives in one place where data flows between modules automatically.",
      },
      {
        question: "How is TheywrK different from an HRMS?",
        answer:
          "Traditional HRMS platforms focus on administrative HR tasks like payroll, leave, and attendance. TheywrK focuses on operational performance — how well your team actually executes. We combine KPIs, task completion, SOP compliance, peer recognition, and manager reviews into a single composite score, giving you a data-driven picture of performance instead of gut feelings and annual review storytelling.",
      },
      {
        question: "Who is TheywrK for?",
        answer:
          "TheywrK is built for business owners, operations managers, and team leads who run teams of 5 to 500+ people. Whether you run a restaurant chain, a marketing agency, a retail operation, or a tech startup — if you need to know how your team is performing and want to stop relying on spreadsheets and guesswork, TheywrK is for you.",
      },
    ],
  },
  {
    label: "Features",
    items: [
      {
        question: "How does composite performance scoring work?",
        answer:
          "Every employee gets an auto-calculated score from 0 to 100 based on six weighted inputs: KPI achievement, manager ratings, peer feedback, self-assessment, SOP compliance, and task completion rate. You configure the weight of each input to match what matters most to your business. The score recalculates in real-time whenever any data point changes, so you always have a current picture.",
      },
      {
        question: "What does the AI feature do?",
        answer:
          "The AI Intelligence Layer lets you ask questions about your business in plain English. For example: 'Who are the top 5 performers in the sales team this quarter?' or 'Which employees have declining scores over the last 3 months?' It pulls real data from every module — KPIs, tasks, reviews, SOPs — to give you instant, data-backed answers rather than generic suggestions.",
      },
      {
        question: "How does the recognition/kudos system work?",
        answer:
          "Anyone in the organization can give kudos to anyone else with a personalized message and a company value tag (like Ownership, Teamwork, or Innovation). Kudos appear in a social feed visible to the whole company, show on employee profiles, and contribute a bonus to composite performance scores — up to +5 points. There is also a monthly Most Recognized leaderboard.",
      },
      {
        question: "Can I customize score weights?",
        answer:
          "Yes. Organization admins can configure the weight of each of the six scoring inputs (KPI achievement, manager rating, peer feedback, self-assessment, SOP compliance, task completion) to total 100%. For example, a sales team might weight KPI achievement at 40%, while a compliance-heavy operation might give SOP compliance 30%. Changes apply organization-wide and scores recalculate automatically.",
      },
    ],
  },
  {
    label: "Getting Started",
    items: [
      {
        question: "How long does setup take?",
        answer:
          "Most teams are up and running in under 30 minutes. Create your organization, invite your team, and start defining KRAs and KPIs. SOPs and review cycles can be added progressively — you do not need everything configured on day one. The platform guides you through onboarding with checklists and suggested next steps.",
      },
      {
        question: "Do you offer a free trial?",
        answer:
          "Yes. Every new organization gets a free trial with full access to all 12 modules. No credit card required to start. You can invite your full team and explore everything before deciding on a plan.",
      },
      {
        question: "Can I import my existing team data?",
        answer:
          "Absolutely. You can bulk-import employees via CSV upload with fields for name, email, department, role, and more. The system validates the data before import and flags any issues. You can also manually add team members one by one if you prefer.",
      },
    ],
  },
  {
    label: "Technical",
    items: [
      {
        question: "Is my data secure?",
        answer:
          "Yes. All data is encrypted in transit (TLS 1.3) and at rest (AES-256). We use role-based access control so employees only see what they are authorized to see. Soft-deleted data is retained for 30 days for recovery and then permanently purged. We follow industry-standard security practices for authentication, session management, and data isolation between organizations.",
      },
      {
        question: "Can I integrate with existing tools?",
        answer:
          "TheywrK supports webhook integrations that let you push event data (new reviews, task completions, kudos, etc.) to any external endpoint. This means you can connect to Slack, Zapier, Make, or your own internal systems. API access is available for programmatic data retrieval and updates.",
      },
      {
        question: "Do you support multi-location businesses?",
        answer:
          "Yes. You can set up branches within your organization and assign employees to specific locations. Department structures, KPIs, SOPs, and analytics all support branch-level filtering, so you can compare performance across locations while maintaining a single organizational view.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div
      itemScope
      itemType="https://schema.org/FAQPage"
    >
      {/* Hero */}
      <section className="pb-20 pt-36">
        <div className="mx-auto max-w-[1200px] px-6">
          <p className="mkt-label">Support</p>
          <h1 className="mkt-title mb-4 text-[clamp(2.2rem,5vw,3.5rem)]">
            Frequently asked<br />
            <span className="text-gradient">questions.</span>
          </h1>
          <p className="mb-8 max-w-[560px] text-lg text-[#8888A0]">
            Everything you need to know about TheywrK. Can&apos;t find the
            answer you&apos;re looking for? Reach out to our team.
          </p>
        </div>
      </section>

      {/* FAQ Accordion */}
      <section className="pb-28">
        <div className="mx-auto max-w-[800px] px-6">
          <FaqAccordion categories={faqCategories} />
        </div>
      </section>

      {/* CTA */}
      <section className="pb-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mkt-highlight text-center">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#6C5CE7]/10 text-[#6C5CE7]">
              <MessageCircle size={28} />
            </div>
            <h2 className="mkt-title mb-4 text-[clamp(1.8rem,3vw,2.5rem)]">
              Still have questions?
            </h2>
            <p className="mx-auto mb-8 max-w-[440px] text-base text-[#8888A0]">
              Our team is here to help. Start a free trial or get in touch
              and we&apos;ll walk you through everything.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/register" className="btn-primary px-8 py-3.5">
                Start Free Trial <ArrowUpRight size={16} />
              </Link>
              <Link href="/contact" className="btn-outline px-8 py-3.5">
                Contact Us
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
