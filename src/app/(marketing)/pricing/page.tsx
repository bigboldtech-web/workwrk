import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";
import { FaqClient } from "@/components/landing/faq-client";
import { PricingPlans } from "@/components/pricing/pricing-plans";

export const metadata: Metadata = {
  title: "Pricing — WorkwrK | Per-user or flat monthly, any currency",
  description:
    "Two ways to pay. Per active user from $4/month or flat monthly tiers from $50. All plans in your currency — GST / VAT handled at checkout.",
  alternates: { canonical: "https://workwrk.com/pricing" },
  openGraph: {
    title: "Pricing — WorkwrK",
    description:
      "Per-user or flat monthly. Starts free, scales to enterprise. Every currency.",
    url: "https://workwrk.com/pricing",
  },
};

const faqItems = [
  {
    q: "How is per-user pricing different from flat-tier pricing?",
    a: "Per-user ($4/user/month) is elastic — you only pay for active accounts, ideal for teams where headcount moves. Flat-tier is predictable — one fixed monthly fee per user band ($50 for 25, $150 for 100, $300 for 500). Pick whichever makes your accounting happier.",
  },
  {
    q: "Will the price change when I switch currency?",
    a: "Yes. All prices are canonically stored in USD and converted to your selected currency using our indicative rate. Finalised amount is locked at checkout. GST or VAT added where applicable.",
  },
  {
    q: "Can I switch between per-user and flat-tier later?",
    a: "Yes, any time. Upgrades prorate. Downgrades take effect at the next billing cycle. No exit fees, no penalties.",
  },
  {
    q: "What's the free tier actually include?",
    a: "Up to 10 users. People, KRAs, KPIs, Tasks, up to 10 SOPs, monthly pulse reviews, kudos feed. No credit card. No expiry. Forever free — we make our money from teams that outgrow it.",
  },
  {
    q: "GST, VAT, local invoicing — what's covered?",
    a: "Indian GST compliant with full ITC. EU VAT handled (we're VAT registered). UK VAT, Singapore GST, UAE VAT too. Ask us about your jurisdiction — we've probably done it.",
  },
  {
    q: "Do you offer annual discounts?",
    a: "Yes. Annual billing saves 2 months across all paid plans. For Scale and Enterprise annual contracts, email sales@workwrk.com for custom terms.",
  },
  {
    q: "What about education / NGO pricing?",
    a: "50% off for registered educational institutions and NGOs (80G / 12A). Email hi@workwrk.com with your registration — we reply within a working day.",
  },
  {
    q: "What happens after the 14-day trial?",
    a: "You pick a plan, or we auto-drop you to the Starter free tier. No auto-charges, ever. We don't play that game.",
  },
];

const COMPARE_ROWS: {
  category: string;
  items: { name: string; vals: (string | boolean)[] }[];
}[] = [
  {
    category: "Core",
    items: [
      { name: "People · org graph", vals: [true, true, true, true] },
      { name: "KRA / KPI tracking", vals: ["Basic", true, true, true] },
      { name: "Tasks · auto-escalation", vals: [true, true, true, true] },
      { name: "SOPs", vals: ["10", "Unlimited", "Unlimited", "Unlimited"] },
    ],
  },
  {
    category: "Performance",
    items: [
      { name: "48-hour review cycles", vals: [false, true, true, true] },
      { name: "Composite scoring", vals: [false, true, true, true] },
      { name: "Calibration σ flags", vals: [false, true, true, true] },
      { name: "Custom weight vectors", vals: [false, false, true, true] },
    ],
  },
  {
    category: "AI + integrations",
    items: [
      { name: "AI Engine (queries/mo)", vals: ["—", "500", "5,000", "Unlimited"] },
      { name: "Scribe SOP extraction", vals: [false, true, true, true] },
      { name: "40+ native integrations", vals: ["5", true, true, true] },
      { name: "Webhooks · REST API", vals: [false, true, true, true] },
    ],
  },
  {
    category: "Security + compliance",
    items: [
      { name: "SOC 2 Type II", vals: [true, true, true, true] },
      { name: "DPDPA / GDPR compliant", vals: [true, true, true, true] },
      { name: "SSO / SAML / SCIM", vals: [false, false, true, true] },
      { name: "Dedicated region / VPC", vals: [false, false, false, true] },
    ],
  },
];

export default function PricingPage() {
  return (
    <>
      <HeroBlock />
      <PlansBlock />
      <ComparisonBlock />
      <FaqBlock items={faqItems} />
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
            label="Pricing"
            title={
              <>
                Two ways to pay. <span className="hi">Your currency.</span>
              </>
            }
            subtitle="Per active user for elastic teams, or flat monthly tiers for predictable budgeting. Prices shown in your selected currency — switch it from the globe in the nav."
            aside={{
              label: "Starts",
              stat: "Free",
              text: "Up to 10 users on the Starter tier · no expiry, no credit card.",
            }}
          />
        </Reveal>
      </div>
    </section>
  );
}

function PlansBlock() {
  return (
    <section className="bento-section" style={{ paddingTop: 0 }}>
      <div className="bento-container">
        <PricingPlans defaultMode="flat" />
      </div>
    </section>
  );
}

function renderVal(v: string | boolean) {
  if (v === true) return <span className="cp-tick">✓</span>;
  if (v === false) return <span className="cp-x">—</span>;
  return <span className="cp-val">{v}</span>;
}

function ComparisonBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="Compare"
            title={
              <>
                What&apos;s in each <span className="hi">tier, row by row.</span>
              </>
            }
            subtitle="The flat-tier columns below are what you get. Per-user pricing gets the same feature set as the tier at your usage band."
            aside={{
              label: "No overages",
              stat: "0",
              text: "We never bill for surprise usage. You move up a tier — that's it.",
            }}
          />
        </Reveal>

        <Reveal>
          <div className="cp-card">
            <div className="cp-head">
              <div>Feature</div>
              <div>Starter</div>
              <div>Team</div>
              <div>
                Growth <span className="cp-pop">Popular</span>
              </div>
              <div>Scale</div>
            </div>
            {COMPARE_ROWS.map((c) => (
              <div key={c.category}>
                <div className="cp-cat">{c.category}</div>
                {c.items.map((r) => (
                  <div key={r.name} className="cp-row">
                    <div className="cp-name">{r.name}</div>
                    {r.vals.map((v, i) => (
                      <div key={i}>{renderVal(v)}</div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      <style>{`
        .cp-card {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 28px;
          padding: 12px 6px;
          overflow: hidden;
        }
        .cp-head, .cp-row {
          display: grid;
          grid-template-columns: 1.6fr repeat(4, 1fr);
          align-items: center;
          padding: 14px 20px;
          font-size: 13px;
        }
        .cp-head {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--b-t3);
          border-bottom: 1px solid var(--b-line-2);
        }
        .cp-pop {
          display: inline-block;
          margin-left: 6px;
          padding: 2px 7px;
          background: var(--b-lime);
          color: var(--b-bg);
          border-radius: 100px;
          font-size: 8.5px;
          letter-spacing: 0.12em;
        }
        .cp-cat {
          padding: 18px 20px 6px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: var(--b-lime);
        }
        .cp-row { border-bottom: 1px dashed var(--b-line); }
        .cp-row:last-child { border-bottom: none; }
        .cp-name { color: var(--b-off); font-size: 13.5px; }
        .cp-tick { color: var(--b-lime); font-weight: 700; }
        .cp-x { color: var(--b-t4); }
        .cp-val { font-family: var(--font-geist-mono), monospace; font-size: 12.5px; color: var(--b-t2); }

        @media (max-width: 800px) {
          .cp-head, .cp-row { grid-template-columns: 1.4fr 1fr 1fr; }
          .cp-head > *:nth-child(4), .cp-head > *:nth-child(5),
          .cp-row > *:nth-child(4), .cp-row > *:nth-child(5) { display: none; }
        }
      `}</style>
    </section>
  );
}

function FaqBlock({ items }: { items: { q: string; a: string }[] }) {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="Pricing FAQ"
            title={
              <>
                Every money question <span className="hi">we keep getting.</span>
              </>
            }
            subtitle="If it's about money, it's here. Anything else, hi@workwrk.com."
          />
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
              padding: "64px 48px",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <h2
              style={{
                fontSize: "clamp(40px, 6vw, 72px)",
                fontWeight: 600,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                marginBottom: 18,
                color: "var(--b-fg)",
              }}
            >
              Try it free for{" "}
              <span style={{ color: "var(--b-lime)" }}>fourteen days.</span>
            </h2>
            <p
              style={{
                fontSize: 16,
                color: "var(--b-t2)",
                maxWidth: 520,
                margin: "0 auto 28px",
                lineHeight: 1.55,
              }}
            >
              No credit card. Full product access. Your data in the system by
              end of day one.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/signup" className="bento-btn bento-btn-lime bento-btn-lg">
                Start free trial →
              </Link>
              <Link href="/demo" className="bento-btn bento-btn-ghost bento-btn-lg">
                Book a live walkthrough
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
