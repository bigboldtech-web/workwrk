import type { Metadata } from "next";
import Link from "next/link";

import { Label, Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Security — WorkwrK | SOC 2 Type II · DPDPA · encrypted at rest",
  description:
    "SOC 2 Type II. DPDPA / GDPR compliant. Field-level RBAC. Signed audit trail. Data residency in Mumbai / Singapore / your VPC.",
  alternates: { canonical: "https://workwrk.com/security" },
};

const pillars = [
  {
    label: "Encryption",
    tone: "lime",
    title: "In transit + at rest · always.",
    body: "TLS 1.3 in transit. AES-256 at rest. Database-level encryption with keys rotated every 90 days. Backups encrypted with a separate key hierarchy.",
    bullets: [
      "TLS 1.3 · forward secrecy",
      "AES-256 at rest · per-column",
      "Keys rotated every 90 days",
      "KMS: AWS KMS or your own (Scale+)",
    ],
  },
  {
    label: "Data residency",
    tone: "blue",
    title: "Your data stays where you choose.",
    body: "Default region Mumbai (AWS ap-south-1). Singapore on request. Your own VPC on Enterprise tier. No cross-border replication unless you explicitly opt in.",
    bullets: [
      "Mumbai (default) · ap-south-1",
      "Singapore optional",
      "Your VPC (Enterprise)",
      "Cross-border replication opt-in",
    ],
  },
  {
    label: "Access control",
    tone: "pink",
    title: "RBAC on the role, not the user.",
    body: "Field-level RBAC that follows the org graph. SSO / SAML on Scale+. SCIM provisioning. Every access event cryptographically signed.",
    bullets: [
      "Field-level RBAC",
      "SSO / SAML / SCIM",
      "Org-wide kill-switch",
      "Time-to-revoke < 60s median",
    ],
  },
  {
    label: "Audit + compliance",
    tone: "amber",
    title: "Auditors get a clean trail.",
    body: "SOC 2 Type II. DPDPA compliant from day one. Signed audit log exportable any time. SOC 2 report available under NDA.",
    bullets: [
      "SOC 2 Type II · annual attestation",
      "DPDPA (India) · GDPR-aligned",
      "HMAC-SHA256 signed audit log",
      "Hash-chain tamper-evident",
    ],
  },
];

const certs = [
  { badge: "SOC 2", label: "Type II", tone: "lime" },
  { badge: "DPDPA", label: "India data law", tone: "pink" },
  { badge: "ISO 27001", label: "In progress · Q3 2026", tone: "blue" },
  { badge: "GDPR", label: "Data-processor agreement", tone: "amber" },
];

const practices = [
  {
    n: "01",
    title: "Least privilege by default",
    body: "Every internal role has the narrowest possible scope. Only three engineers can touch production directly — all changes logged.",
  },
  {
    n: "02",
    title: "Zero-training for AI Engine",
    body: "Enterprise agreement with Anthropic: your data is never used to train models. Every prompt stays in your region.",
  },
  {
    n: "03",
    title: "Sub-processors published",
    body: "Every vendor in our chain (AWS, Anthropic, Sentry, Stripe) is listed with purpose + data-handling. Updated on change.",
  },
  {
    n: "04",
    title: "Signed audit log exports",
    body: "Every read and write logged with timestamp, actor, before/after. HMAC-signed with your org key. Exportable to SIEM.",
  },
  {
    n: "05",
    title: "Right-to-erasure · one click",
    body: "DPDPA / GDPR requests handled in the product UI. Signed receipt returned for the regulator.",
  },
  {
    n: "06",
    title: "Incident response · 4-hour SLA",
    body: "Security incidents trigger a 4-hour acknowledgement SLA. Critical customers paged immediately. Post-mortem within 5 days.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Security · trust"
              title={
                <>
                  Built assuming <span className="hi">auditors will come.</span>
                </>
              }
              subtitle="Indian SMBs increasingly sell into regulated buyers — BFSI, healthcare, public sector. We built the security posture you'll need from day one, so you don't retrofit when a big deal asks for it."
              aside={{
                label: "Compliance status",
                stat: "SOC 2",
                text: "Type II report available under NDA. DPDPA-compliant from day one.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <Reveal stagger className="sec-certs">
            {certs.map((c) => (
              <div key={c.badge} className={`sec-cert sec-cert-${c.tone}`}>
                <div className="sec-cert-badge">{c.badge}</div>
                <div className="sec-cert-label">{c.label}</div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <Label>Four pillars</Label>
            <h2 className="sec-title">
              Security isn&apos;t a layer. <span className="hi">It&apos;s a default.</span>
            </h2>
          </Reveal>
          <Reveal stagger className="sec-pillars">
            {pillars.map((p) => (
              <article key={p.label} className={`sec-pillar sec-pillar-${p.tone}`}>
                <span className="bento-label">{p.label}</span>
                <h3 className="sec-pillar-title">{p.title}</h3>
                <p className="sec-pillar-body">{p.body}</p>
                <ul>
                  {p.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
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
              label="How we practice it"
              title={
                <>
                  Six practices that <span className="hi">actually matter.</span>
                </>
              }
              subtitle="Not every vendor lets you see behind the badge. Here are the operational discipline points we publish."
            />
          </Reveal>
          <Reveal stagger className="sec-practices">
            {practices.map((p) => (
              <article key={p.n} className="sec-practice">
                <span className="sec-practice-n">{p.n}</span>
                <h3 className="sec-practice-title">{p.title}</h3>
                <p className="sec-practice-body">{p.body}</p>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section-cta">
        <div className="bento-container">
          <Reveal>
            <div className="sec-contact">
              <span className="bento-label">Security contact</span>
              <h2>security@workwrk.com</h2>
              <p>
                Responsible disclosure welcomed. Bug bounty program details on
                request under NDA. SOC 2 Type II report, DPDPA DPIA, and
                sub-processor list available under NDA from security@workwrk.com.
              </p>
              <div className="sec-contact-ctas">
                <Link href="/contact" className="bento-btn bento-btn-lime bento-btn-lg">
                  Request security pack →
                </Link>
                <a href="mailto:security@workwrk.com" className="bento-btn bento-btn-ghost bento-btn-lg">
                  Email security team
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <style>{`
        .sec-title {
          font-size: clamp(36px, 5vw, 64px);
          font-weight: 600;
          letter-spacing: -0.04em;
          line-height: 1;
          margin: 14px 0 40px;
        }
        .sec-title .hi { color: var(--b-lime); }

        .sec-certs {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .sec-cert {
          padding: 24px;
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
          background: var(--b-card);
          transition: all 0.3s;
          min-height: 120px;
          display: flex; flex-direction: column; justify-content: space-between;
        }
        .sec-cert:hover { transform: translateY(-3px); }
        .sec-cert-lime { border-color: var(--b-lime); }
        .sec-cert-lime:hover { box-shadow: var(--b-shadow-lime); }
        .sec-cert-pink { border-color: var(--b-pink); }
        .sec-cert-pink:hover { box-shadow: var(--b-shadow-pink); }
        .sec-cert-blue { border-color: var(--b-blue); }
        .sec-cert-blue:hover { box-shadow: var(--b-shadow-blue); }
        .sec-cert-amber { border-color: var(--b-amber); }
        .sec-cert-amber:hover { box-shadow: var(--b-shadow-amber); }
        .sec-cert-badge {
          font-size: 32px; font-weight: 700;
          letter-spacing: -0.03em;
          font-family: var(--font-geist-mono), monospace;
        }
        .sec-cert-lime .sec-cert-badge { color: var(--b-lime); }
        .sec-cert-pink .sec-cert-badge { color: var(--b-pink); }
        .sec-cert-blue .sec-cert-badge { color: var(--b-blue); }
        .sec-cert-amber .sec-cert-badge { color: var(--b-amber); }
        .sec-cert-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--b-t3);
        }

        .sec-pillars {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }
        .sec-pillar {
          padding: 30px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          transition: all 0.3s;
          min-height: 280px;
          display: flex; flex-direction: column;
        }
        .sec-pillar:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .sec-pillar .bento-label { color: inherit; opacity: 1; }
        .sec-pillar-lime .bento-label { color: var(--b-lime); }
        .sec-pillar-pink .bento-label { color: var(--b-pink); }
        .sec-pillar-blue .bento-label { color: var(--b-blue); }
        .sec-pillar-amber .bento-label { color: var(--b-amber); }
        .sec-pillar-title {
          font-size: 26px; font-weight: 600;
          letter-spacing: -0.025em; line-height: 1.1;
          margin: 14px 0 12px;
        }
        .sec-pillar-body {
          font-size: 14.5px;
          color: var(--b-t2);
          line-height: 1.55;
        }
        .sec-pillar ul {
          list-style: none;
          margin: 18px 0 0;
          padding: 16px 0 0;
          border-top: 1px solid var(--b-line);
          display: flex; flex-direction: column; gap: 5px;
        }
        .sec-pillar ul li {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11.5px;
          color: var(--b-off);
          letter-spacing: 0.03em;
          padding-left: 16px;
          position: relative;
        }
        .sec-pillar ul li::before {
          content: "✓";
          position: absolute; left: 0;
          font-weight: 700;
        }
        .sec-pillar-lime ul li::before { color: var(--b-lime); }
        .sec-pillar-pink ul li::before { color: var(--b-pink); }
        .sec-pillar-blue ul li::before { color: var(--b-blue); }
        .sec-pillar-amber ul li::before { color: var(--b-amber); }

        .sec-practices {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-top: 32px;
        }
        .sec-practice {
          padding: 26px 24px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
          min-height: 180px;
          transition: all 0.3s;
          display: flex; flex-direction: column;
        }
        .sec-practice:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .sec-practice-n {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-lime);
          letter-spacing: 0.12em;
          margin-bottom: 10px;
        }
        .sec-practice-title {
          font-size: 18px; font-weight: 600;
          letter-spacing: -0.02em; line-height: 1.2;
          margin: 4px 0 10px;
        }
        .sec-practice-body {
          font-size: 13.5px;
          color: var(--b-t2);
          line-height: 1.55;
        }

        .sec-contact {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 56px 48px;
          text-align: center;
        }
        .sec-contact h2 {
          font-family: var(--font-geist-mono), monospace;
          font-size: clamp(32px, 4vw, 48px);
          font-weight: 700;
          letter-spacing: -0.04em;
          margin: 16px 0 16px;
          color: var(--b-lime);
        }
        .sec-contact p {
          font-size: 15.5px;
          color: var(--b-t2);
          line-height: 1.6;
          max-width: 60ch;
          margin: 0 auto 32px;
        }
        .sec-contact-ctas { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

        @media (max-width: 900px) {
          .sec-certs { grid-template-columns: 1fr 1fr; }
          .sec-pillars { grid-template-columns: 1fr; }
          .sec-practices { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 600px) {
          .sec-certs, .sec-practices { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
