import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";
import { FaqClient } from "@/components/landing/faq-client";

export const metadata: Metadata = {
  title: "FAQ — WorkwrK | Answers to every common question",
  description:
    "Answers to the questions every team asks before signing up: what it replaces, setup time, data privacy, AI, adoption, data export, on-premise.",
  alternates: { canonical: "https://workwrk.com/faq" },
};

const SECTIONS: { heading: string; items: { q: string; a: string }[] }[] = [
  {
    heading: "Product",
    items: [
      {
        q: "What exactly does WorkwrK replace?",
        a: "In the first 60 days most teams cancel: a performance/review tool, an SOP repository, a task manager, a recognition app, an OKR tracker, and a stack of Google Sheets. Typically 5–9 tools replaced outright; Slack, Gmail, and Google Drive get integrated rather than replaced.",
      },
      {
        q: "How is WorkwrK different from an HRMS?",
        a: "HRMS tools focus on HR administration — payroll, leave, attendance. WorkwrK focuses on operational excellence — KPIs, SOPs, performance, tasks, AI. We integrate with HRMSes (Keka, Zoho People); we don't replace them.",
      },
      {
        q: "Is WorkwrK for small teams or enterprises?",
        a: "Both. Starter tier works for 10-person teams. Growth fits 25–100. Scale and Enterprise cover 100–500. Our sweet spot is 50–300 people, where process pain peaks.",
      },
    ],
  },
  {
    heading: "Setup & adoption",
    items: [
      {
        q: "How long until something useful runs?",
        a: "Under 30 minutes to first useful day. Bulk-import your team (CSV or Google Workspace), let AI draft KRAs per role, assign a starter SOP set. You'll iterate for weeks, but you'll have live data from the first sitting.",
      },
      {
        q: "What if my team won't adopt a new tool?",
        a: "WorkwrK shows up inside Slack, email, and WhatsApp where your team already works. About 80% of interactions don't need a new app. Median 30-day adoption strong across the early-access cohort.",
      },
      {
        q: "Do you do onboarding for us?",
        a: "Starter and Growth are self-serve. Scale includes a dedicated success manager. Enterprise includes a full custom onboarding with your data imported by our team.",
      },
    ],
  },
  {
    heading: "AI",
    items: [
      {
        q: "Does AI generation actually work, or is it demo-ware?",
        a: "Real. Powered by Claude. Paste a job description — 5 KRAs, 14 KPIs, and a 90-day ramp plan in under 15 seconds. Humans approve every output before it goes live.",
      },
      {
        q: "Will my data train AI models?",
        a: "Never. Private-by-default architecture. Your data is not used for training. Region-locked to India or EU as you prefer.",
      },
    ],
  },
  {
    heading: "Data & compliance",
    items: [
      {
        q: "Can I export my data if I leave?",
        a: "Yes. One-click JSON or CSV exports. We don't hold your data hostage. If you leave, you leave with everything.",
      },
      {
        q: "Is there an on-premise option?",
        a: "Yes, on Enterprise. Self-hosted on your infrastructure with the same functionality. Typical deployment uses Kubernetes on AWS, GCP, Azure, or bare-metal Linux.",
      },
      {
        q: "What's your security posture?",
        a: "SOC-2 Type II in progress. Field-level RBAC. Audit logs for every read and write. Region-locked storage. SSO/SAML on Scale and Enterprise.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <HeroBlock />
      {SECTIONS.map((s) => (
        <SectionBlock key={s.heading} heading={s.heading} items={s.items} />
      ))}
      <CtaBlock />
    </>
  );
}

function HeroBlock() {
  return (
    <section className="bento-section" style={{ paddingTop: 40 }}>
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="FAQ"
            title={
              <>
                Every question we <span className="hi">keep getting.</span>
              </>
            }
            subtitle="Grouped by what teams actually ask. If it's not here, hi@workwrk.com — the founder reads every email."
            aside={{
              label: "Reply time",
              stat: "<1d",
              text: "Median founder reply time on customer emails. Ask anything.",
            }}
          />
        </Reveal>
      </div>
    </section>
  );
}

function SectionBlock({ heading, items }: { heading: string; items: { q: string; a: string }[] }) {
  return (
    <section className="bento-section" style={{ paddingTop: 28, paddingBottom: 28 }}>
      <div className="bento-container">
        <Reveal>
          <div
            className="bento-label"
            style={{ color: "var(--b-lime)", marginBottom: 14 }}
          >
            {heading}
          </div>
        </Reveal>
        <FaqClient items={items} />
      </div>
    </section>
  );
}

function CtaBlock() {
  return (
    <section className="bento-section-cta">
      <div className="bento-container">
        <Reveal>
          <div
            style={{
              background: "var(--b-card)",
              border: "1px solid var(--b-line)",
              borderRadius: 36,
              padding: "56px 40px",
              textAlign: "center",
            }}
          >
            <h2
              style={{
                fontSize: "clamp(36px, 5vw, 56px)",
                fontWeight: 700,
                letterSpacing: "-0.035em",
                lineHeight: 1,
                marginBottom: 16,
              }}
            >
              Didn&apos;t find it here?
            </h2>
            <p style={{ color: "var(--b-t2)", maxWidth: 440, margin: "0 auto 24px" }}>
              Email the founder. Answered same day, usually same hour.
            </p>
            <Link href="mailto:hi@workwrk.com" className="bento-btn bento-btn-lime bento-btn-lg">
              hi@workwrk.com →
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
