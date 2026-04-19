import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Help Center — WorkwrK",
  description:
    "Guides, how-tos, and answers for every module of WorkwrK. Setup, onboarding, AI, integrations, security.",
  alternates: { canonical: "https://workwrk.com/help-center" },
};

const SECTIONS = [
  {
    variant: "lime" as const,
    title: "Getting started",
    desc: "From signup to first useful day in thirty minutes.",
    links: [
      { label: "Bulk-import your team", href: "/features/people#lifecycle" },
      { label: "First SOPs to assign", href: "/features/sops#written" },
      { label: "AI-drafted KRAs walkthrough", href: "/features/kras" },
      { label: "Inviting managers", href: "/features/people#access" },
    ],
  },
  {
    variant: "dark" as const,
    title: "Performance",
    desc: "Composite scoring, review cycles, and calibration.",
    links: [
      { label: "How composite scores work", href: "/features/reviews" },
      { label: "Setting up a review cycle", href: "/features/reviews" },
      { label: "Calibration across managers", href: "/features/reviews" },
      { label: "Exporting HR-ready PDFs", href: "/features/reviews" },
    ],
  },
  {
    variant: "dark" as const,
    title: "SOPs & tasks",
    desc: "Playbooks, compliance, and auto-escalation.",
    links: [
      { label: "Video → SOP extraction (Scribe)", href: "/features/sops#scribe" },
      { label: "Versioning and audit trail", href: "/features/sops#written" },
      { label: "Task SLAs and escalation", href: "/features/tasks" },
      { label: "Nightly compliance jobs", href: "/features/sops" },
    ],
  },
  {
    variant: "dark" as const,
    title: "AI Engine",
    desc: "Private-by-default reasoning across your data.",
    links: [
      { label: "What the AI can and can't do", href: "/features/ai-engine#prompts" },
      { label: "Drafting KRAs from job descriptions", href: "/features/kras" },
      { label: "Attrition-risk predictions", href: "/features/ai-engine#signals" },
      { label: "Data privacy & training", href: "/security" },
    ],
  },
  {
    variant: "dark" as const,
    title: "Developers & integrations",
    desc: "API, webhooks, and the OpenAPI spec.",
    links: [
      { label: "Public API reference", href: "/developers" },
      { label: "Webhook signatures (HMAC-SHA256)", href: "/developers#events" },
      { label: "OpenAPI 3.1 spec", href: "/api/v1/openapi.json" },
      { label: "Available integrations", href: "/features/integrations" },
    ],
  },
  {
    variant: "dark" as const,
    title: "Security & billing",
    desc: "Access control, compliance, and subscriptions.",
    links: [
      { label: "RBAC + field-level permissions", href: "/features/access" },
      { label: "SOC 2, DPDPA, data residency", href: "/security" },
      { label: "Pricing & plan caps", href: "/pricing" },
      { label: "Contact support", href: "/contact" },
    ],
  },
];

export default function HelpCenterPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 40 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Help center"
              title={<>Short answers. <span className="hi">Zero fluff.</span></>}
              subtitle="Grouped by module. If you can't find it, email hi@workwrk.com — we'll write it up and publish it."
              aside={{
                label: "Response",
                stat: "<24h",
                text: "Median first-response on support tickets. Same day, usually same hour.",
              }}
            />
          </Reveal>

          <Reveal stagger className="hc-grid">
            {SECTIONS.map((s) => (
              <article key={s.title} className={`hc hc-${s.variant}`}>
                <div>
                  <h3 className="hc-title">{s.title}</h3>
                  <p className="hc-desc">{s.desc}</p>
                </div>
                <ul className="hc-links">
                  {s.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href}>{l.label} <span className="arr">→</span></Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </Reveal>
        </div>

        <style>{`
          .hc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
          .hc {
            border-radius: 28px; padding: 32px;
            min-height: 320px;
            display: flex; flex-direction: column; justify-content: space-between;
            transition: all 0.3s;
            position: relative; overflow: hidden;
          }
          .hc:hover { transform: translateY(-4px); }
          .hc::before {
            content: ""; position: absolute; inset: 0;
            background-image: radial-gradient(circle at 1px 1px, rgba(0,0,0,0.08) 1px, transparent 0);
            background-size: 18px 18px; pointer-events: none; opacity: 0.35;
          }
          .hc > * { position: relative; }
          .hc-lime { background: var(--b-lime); color: var(--b-bg); }
          .hc-lime:hover { box-shadow: var(--b-shadow-lime); }
          .hc-dark {
            background: var(--b-card);
            border: 1px solid var(--b-line);
            color: var(--b-fg);
          }
          .hc-dark:hover { border-color: var(--b-line-2); background: var(--b-card-2); }
          .hc-dark .hc-desc { color: var(--b-t2); }
          .hc-dark .hc-links { border-top-color: var(--b-line) !important; }
          .hc-dark .hc-links a { color: var(--b-off); }
          .hc-dark .hc-links a:hover { color: var(--b-lime); }
          .hc-title { font-size: 28px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.1; margin-bottom: 10px; }
          .hc-desc { font-size: 14px; line-height: 1.55; font-weight: 500; max-width: 380px; }
          .hc-links {
            list-style: none; padding: 20px 0 0;
            border-top: 1px solid rgba(0,0,0,0.15);
            display: flex; flex-direction: column; gap: 9px;
            margin-top: 20px;
          }
          .hc-links a {
            display: flex; justify-content: space-between;
            font-size: 13.5px; font-weight: 500;
            padding: 4px 0;
            color: inherit; text-decoration: none;
            transition: transform 0.2s;
          }
          .hc-links a:hover { transform: translateX(3px); }
          .hc-links .arr { opacity: 0.6; transition: transform 0.2s; }
          .hc-links a:hover .arr { transform: translateX(3px); opacity: 1; }
          @media (max-width: 900px) { .hc-grid { grid-template-columns: 1fr; } }
        `}</style>
      </section>
    </>
  );
}
