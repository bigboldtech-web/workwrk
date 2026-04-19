import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Partners — WorkwrK | Implementation, channel, integration programs",
  description:
    "Join the WorkwrK partner network. Implementation partners, channel resellers, integration builders, and agency programs.",
  alternates: { canonical: "https://workwrk.com/partners" },
};

const programs = [
  {
    tone: "lime",
    label: "Implementation Partners",
    title: "Deploy, train, and optimise.",
    body:
      "For operations consultancies and HR transformation firms who lead rollouts inside customer orgs. Certified delivery methodology. Referral fees + margin share.",
    bullets: [
      "20% first-year revenue share",
      "Certification + playbooks",
      "Co-branded case studies",
      "Regional territory protection",
    ],
  },
  {
    tone: "pink",
    label: "Channel Resellers",
    title: "Sell WorkwrK under your margin.",
    body:
      "For MSPs, SaaS resellers, and regional distributors. Buy at wholesale, resell to your book. We handle product, you handle the relationship.",
    bullets: [
      "30–40% partner margin",
      "Quarterly co-marketing fund",
      "Dedicated partner success manager",
      "White-label invoicing available",
    ],
  },
  {
    tone: "blue",
    label: "Integration Partners",
    title: "Build something that plugs in.",
    body:
      "For SaaS vendors whose product complements WorkwrK — HRMS, payroll, LMS, BI, help desk. Native integration, marketplace listing, co-sell.",
    bullets: [
      "Listed in the integration gallery",
      "Joint go-to-market campaigns",
      "Shared customer success program",
      "Free sandbox + engineering review",
    ],
  },
  {
    tone: "amber",
    label: "Agency + Design",
    title: "Help customers brand it right.",
    body:
      "For agencies and design studios who work with WorkwrK customers on brand systems, onboarding comms, and internal launch. Referral program.",
    bullets: [
      "Referral commission · 1-year ARR",
      "Design system access",
      "Direct Slack channel with design team",
      "Portfolio spotlight",
    ],
  },
];

const tiers = [
  {
    name: "Registered",
    price: "Free",
    desc: "Listed in our directory. Access to training portal. Monthly webinars.",
    reqs: ["Complete 3 product modules", "Sign partner MSA", "Pass certification"],
    tone: "dark",
  },
  {
    name: "Preferred",
    price: "By invitation",
    desc: "Higher revenue share. Joint marketing. Territory protection. Quarterly business reviews.",
    reqs: ["3+ customer wins", "Active for 6+ months", "CSAT ≥ 4.5/5"],
    tone: "lime",
  },
  {
    name: "Strategic",
    price: "Custom",
    desc: "Co-built roadmap input. Custom integrations. Named alliance manager. Co-GTM investment.",
    reqs: ["10+ customer wins", "Regional footprint", "Deep domain expertise"],
    tone: "dark",
  },
];

export default function PartnersPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Partners"
              title={
                <>
                  Scale with us. <span className="hi">On margin, not marketing.</span>
                </>
              }
              subtitle="WorkwrK grows on the backs of partners who already own customer trust in their markets. Four programs across implementation, resale, integration, and agency."
              aside={{
                label: "Active partners",
                stat: "48",
                text: "Across India, GCC, South-East Asia, and the EU. Growing 20% quarter on quarter.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <Reveal stagger className="pr-grid">
            {programs.map((p) => (
              <article key={p.label} className={`pr-card pr-card-${p.tone}`}>
                <span className="pr-label">{p.label}</span>
                <h2 className="pr-title">{p.title}</h2>
                <p className="pr-body">{p.body}</p>
                <ul>
                  {p.bullets.map((b) => <li key={b}><span className="tick">✓</span>{b}</li>)}
                </ul>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Partner tiers"
              title={
                <>
                  Start somewhere. <span className="hi">Grow on merit.</span>
                </>
              }
              subtitle="Three tiers based on customer wins + CSAT. No quotas, no politics — you move up when the numbers say so."
            />
          </Reveal>
          <Reveal stagger className="pt-grid">
            {tiers.map((t) => (
              <article key={t.name} className={`pt-card pt-card-${t.tone}`}>
                <div className="pt-head">
                  <span className="pt-name">{t.name}</span>
                  <span className="pt-price">{t.price}</span>
                </div>
                <p className="pt-desc">{t.desc}</p>
                <div className="pt-reqs">
                  <span className="pt-reqs-label">Requirements</span>
                  <ul>{t.reqs.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section-cta">
        <div className="bento-container">
          <Reveal>
            <div className="pn-cta">
              <h2>
                Ready to <span className="hi">partner with us?</span>
              </h2>
              <p>
                Fill the partner interest form. We reply within two working days
                with a 30-minute intro call to scope fit.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <a href="mailto:partners@workwrk.com?subject=Partner%20Interest" className="bento-btn bento-btn-lime bento-btn-lg">
                  partners@workwrk.com →
                </a>
                <Link href="/contact" className="bento-btn bento-btn-ghost bento-btn-lg">
                  General contact
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <style>{`
        .pr-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }
        .pr-card {
          padding: 36px 34px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          transition: all 0.3s;
        }
        .pr-card:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .pr-card-lime { border-top: 3px solid var(--b-lime); }
        .pr-card-pink { border-top: 3px solid var(--b-pink); }
        .pr-card-blue { border-top: 3px solid var(--b-blue); }
        .pr-card-amber { border-top: 3px solid var(--b-amber); }
        .pr-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .pr-card-lime .pr-label { color: var(--b-lime); }
        .pr-card-pink .pr-label { color: var(--b-pink); }
        .pr-card-blue .pr-label { color: var(--b-blue); }
        .pr-card-amber .pr-label { color: var(--b-amber); }
        .pr-title {
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.03em;
          line-height: 1.15;
          margin: 12px 0 12px;
        }
        .pr-body {
          font-size: 15px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0 0 20px;
        }
        .pr-card ul {
          list-style: none; padding: 16px 0 0;
          border-top: 1px solid var(--b-line);
          display: flex; flex-direction: column; gap: 8px;
        }
        .pr-card ul li {
          font-size: 13.5px;
          color: var(--b-off);
          display: inline-flex; align-items: center; gap: 10px;
        }
        .pr-card .tick {
          font-weight: 700;
        }
        .pr-card-lime .tick { color: var(--b-lime); }
        .pr-card-pink .tick { color: var(--b-pink); }
        .pr-card-blue .tick { color: var(--b-blue); }
        .pr-card-amber .tick { color: var(--b-amber); }

        .pt-grid {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 14px; margin-top: 32px;
        }
        .pt-card {
          padding: 32px 30px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          min-height: 340px;
          display: flex; flex-direction: column;
          transition: all 0.3s;
        }
        .pt-card:hover { transform: translateY(-3px); border-color: var(--b-line-2); }
        .pt-card-lime {
          background: var(--b-lime);
          color: var(--b-bg);
          border-color: var(--b-lime);
        }
        .pt-card-lime:hover { box-shadow: var(--b-shadow-lime); }
        .pt-head { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .pt-name {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .pt-card-lime .pt-name { color: rgba(0,0,0,0.65); }
        .pt-price {
          font-size: 36px;
          font-weight: 700;
          letter-spacing: -0.035em;
          color: var(--b-fg);
        }
        .pt-card-lime .pt-price { color: var(--b-bg); }
        .pt-desc {
          font-size: 14.5px;
          color: var(--b-t2);
          line-height: 1.55;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--b-line);
          margin: 0 0 20px;
        }
        .pt-card-lime .pt-desc { color: rgba(0,0,0,0.85); border-bottom-color: rgba(0,0,0,0.15); }
        .pt-reqs { margin-top: auto; }
        .pt-reqs-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--b-t3);
          display: block;
          margin-bottom: 10px;
        }
        .pt-card-lime .pt-reqs-label { color: rgba(0,0,0,0.65); }
        .pt-reqs ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .pt-reqs li {
          font-size: 13.5px;
          color: var(--b-off);
          padding-left: 18px;
          position: relative;
        }
        .pt-card-lime .pt-reqs li { color: var(--b-bg); }
        .pt-reqs li::before {
          content: "✓"; position: absolute; left: 0;
          color: var(--b-lime); font-weight: 700;
        }
        .pt-card-lime .pt-reqs li::before { color: var(--b-bg); }

        .pn-cta {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 64px 48px;
          text-align: center;
        }
        .pn-cta h2 {
          font-size: clamp(34px, 5vw, 56px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin: 0 0 16px;
        }
        .pn-cta p {
          font-size: 16px;
          color: var(--b-t2);
          max-width: 520px;
          margin: 0 auto 28px;
          line-height: 1.6;
        }

        @media (max-width: 900px) {
          .pr-grid { grid-template-columns: 1fr; }
          .pt-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
