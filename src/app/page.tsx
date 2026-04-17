import { LandingPage } from "@/components/landing/landing-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WorkwrK — Business Operating System | People, Performance, KPIs, SOPs & AI",
  description:
    "WorkwrK is the all-in-one business operating system that unifies people management, KPI tracking, performance reviews, SOPs, task management, recognition, and AI intelligence. Replace 15 disconnected tools with one platform. Built for growing businesses in India, UAE, Southeast Asia & beyond.",
  keywords: [
    "business operating system",
    "employee performance management software",
    "KPI tracking tool",
    "SOP management software",
    "performance review platform",
    "360 degree feedback software",
    "task management for teams",
    "HR management software",
    "people management platform",
    "employee recognition software",
    "kudos platform",
    "AI business intelligence",
    "OKR tracking software",
    "workforce management",
    "business process management",
    "team performance analytics",
    "employee onboarding software",
    "meeting notes software",
    "HRMS India",
    "business software UAE",
    "SaaS for SMBs",
    "workwrk",
  ],
  authors: [{ name: "WorkwrK" }],
  creator: "WorkwrK",
  publisher: "WorkwrK",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "WorkwrK",
    title: "WorkwrK — The Business Operating System Your Team Deserves",
    description:
      "Unify people, KPIs, SOPs, performance reviews, tasks, recognition, and AI intelligence into one platform. Stop managing chaos — start operating your business.",
    url: "https://workwrk.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "WorkwrK — Business Operating System",
    description:
      "One platform for people, performance, KPIs, SOPs, tasks, recognition & AI. Replace 15 tools with one.",
    creator: "@workwrk",
  },
  alternates: {
    canonical: "https://workwrk.com",
  },
  category: "Business Software",
};

export default async function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "WorkwrK",
        url: "https://workwrk.com",
        description:
          "All-in-one business operating system for people, performance, KPIs, SOPs, and AI intelligence.",
        potentialAction: {
          "@type": "SearchAction",
          target: "https://workwrk.com/search?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "SoftwareApplication",
        name: "WorkwrK",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "Business operating system that unifies people management, KPI tracking, performance reviews, SOPs, task management, employee recognition, and AI-powered analytics into one seamless platform.",
        offers: [
          {
            "@type": "Offer",
            name: "Starter",
            price: "4999",
            priceCurrency: "INR",
            priceValidUntil: "2027-12-31",
            description: "Up to 25 users. Core modules.",
          },
          {
            "@type": "Offer",
            name: "Growth",
            price: "14999",
            priceCurrency: "INR",
            priceValidUntil: "2027-12-31",
            description: "Up to 100 users. Full suite with AI.",
          },
          {
            "@type": "Offer",
            name: "Scale",
            price: "29999",
            priceCurrency: "INR",
            priceValidUntil: "2027-12-31",
            description: "Up to 500 users. Unlimited AI. Custom integrations.",
          },
        ],
        featureList: [
          "People Management & Org Chart",
          "KRA/KPI Engine with Auto-Scoring",
          "Performance Review Engine with 360° Feedback",
          "SOP Playbook with Compliance Tracking",
          "Task Management with Auto-Escalation",
          "Employee Recognition & Kudos",
          "Composite Performance Scores",
          "AI-Powered Business Intelligence",
          "Meeting Notes & Action Items",
          "Analytics & Reporting Dashboard",
          "Employee Onboarding System",
          "Data Export & Integrations",
        ],
      },
      {
        "@type": "Organization",
        name: "WorkwrK",
        url: "https://workwrk.com",
        sameAs: [
          "https://twitter.com/workwrk",
          "https://linkedin.com/company/workwrk",
        ],
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "sales",
          email: "hello@workwrk.com",
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "What is WorkwrK?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "WorkwrK is an all-in-one business operating system that replaces 15+ disconnected tools. It unifies people management, KPI tracking, performance reviews, SOPs, task management, employee recognition, and AI intelligence into one seamless platform — from the CEO to the last field agent.",
            },
          },
          {
            "@type": "Question",
            name: "How does WorkwrK calculate performance scores?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "WorkwrK uses a weighted composite scoring engine that combines 6 data sources: KPI achievement (30%), manager review ratings (25%), task completion rate (15%), peer review ratings (10%), self-assessment (10%), and SOP compliance (10%). Scores auto-recalculate whenever any input changes. Organizations can customize the weight distribution.",
            },
          },
          {
            "@type": "Question",
            name: "Can I use WorkwrK for my business in India?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. WorkwrK is built for growing businesses across India, UAE, Southeast Asia, and globally. It supports INR pricing, multi-location organizations, and is designed for the operational realities of businesses scaling from 10 to 500+ employees.",
            },
          },
          {
            "@type": "Question",
            name: "Does WorkwrK have AI features?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. WorkwrK includes an AI intelligence layer that lets you ask your business anything in plain English — 'Who should I promote?', 'Which SOPs have lowest compliance?', 'Compare branch performance'. AI uses real data from all modules to give instant, data-backed answers.",
            },
          },
          {
            "@type": "Question",
            name: "How is WorkwrK different from an HRMS?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Traditional HRMS tools focus on HR administration (payroll, leave, attendance). WorkwrK is a business operating system that focuses on operational excellence — KPIs, SOPs, performance, tasks, and AI intelligence. It helps you run your business better, not just manage HR paperwork.",
            },
          },
          {
            "@type": "Question",
            name: "What is the employee recognition/kudos feature?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "WorkwrK's recognition system lets anyone give kudos to colleagues with messages and company value tags. Kudos appear in a social feed, count on profiles, factor into performance scores as a bonus, and drive a monthly 'Most Recognized' leaderboard — building a culture of appreciation.",
            },
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingPage />
    </>
  );
}
