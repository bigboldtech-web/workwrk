import type { Metadata } from "next";
import Link from "next/link";

import { Label, Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Contact — WorkwrK",
  description:
    "Reach us — sales, security, support, partnerships. Real humans, one working-day response.",
  alternates: { canonical: "https://workwrk.com/contact" },
};

const channels = [
  {
    tone: "lime",
    label: "Sales",
    title: "hi@workwrk.com",
    body: "For demo requests, pricing questions, and plan advice. 4-hour response on working days.",
    cta: { label: "Book a demo →", href: "/demo" },
  },
  {
    tone: "pink",
    label: "Security",
    title: "security@workwrk.com",
    body: "SOC 2 reports, DPIAs, DPDPA documentation, responsible disclosure. Same-day for critical matters.",
    cta: { label: "See security posture →", href: "/security" },
  },
  {
    tone: "blue",
    label: "Support",
    title: "support@workwrk.com",
    body: "Production issues, account questions, bug reports. Scale+ customers have a private Slack channel.",
    cta: { label: "Help centre →", href: "/help-center" },
  },
  {
    tone: "amber",
    label: "Partnerships",
    title: "partners@workwrk.com",
    body: "Channel, integration, implementation, agency partnerships. We reply within two working days.",
    cta: { label: "Partner programme →", href: "/partners" },
  },
];

export default function ContactPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Contact · real humans"
              title={
                <>
                  No bots. <span className="hi">No ticket queues.</span>
                </>
              }
              subtitle="Our team is in Bengaluru. Small enough that you can get a real answer from a real person within a working day. Four inboxes, depending on why you're writing."
              aside={{
                label: "Average reply time",
                stat: "4h",
                text: "On working days. Security + production issues faster.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <Reveal stagger className="ct-grid">
            {channels.map((c) => (
              <article key={c.label} className={`ct-card ct-card-${c.tone}`}>
                <Label>{c.label}</Label>
                <h3 className="ct-title">
                  <a href={`mailto:${c.title}`}>{c.title}</a>
                </h3>
                <p className="ct-body">{c.body}</p>
                <Link href={c.cta.href} className="ct-cta">
                  {c.cta.label}
                </Link>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <div className="ct-grid-2">
            <Reveal>
              <div className="ct-form-card">
                <Label>Anything else</Label>
                <h2 className="ct-form-title">
                  A catch-all form if you&apos;re unsure.
                </h2>
                <form className="ct-form">
                  <div className="ct-field">
                    <label htmlFor="ct-name">Your name</label>
                    <input id="ct-name" type="text" placeholder="Priya Sharma" />
                  </div>
                  <div className="ct-field">
                    <label htmlFor="ct-email">Email</label>
                    <input id="ct-email" type="email" placeholder="priya@company.in" />
                  </div>
                  <div className="ct-field">
                    <label htmlFor="ct-topic">Topic</label>
                    <select id="ct-topic" defaultValue="">
                      <option value="" disabled>Select</option>
                      <option>Sales / pricing</option>
                      <option>Security / compliance</option>
                      <option>Support / bug</option>
                      <option>Partnership</option>
                      <option>Media / press</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div className="ct-field">
                    <label htmlFor="ct-msg">Message</label>
                    <textarea id="ct-msg" rows={5} placeholder="Tell us what you need — be specific, we like that." />
                  </div>
                  <button type="button" className="bento-btn bento-btn-lime bento-btn-lg">
                    Send →
                  </button>
                </form>
              </div>
            </Reveal>
            <Reveal>
              <div className="ct-office">
                <Label>Office</Label>
                <h3 className="ct-office-title">Bengaluru, India</h3>
                <address className="ct-addr">
                  WorkwrK Technologies Pvt. Ltd.
                  <br />
                  Indiranagar, Bengaluru 560038
                  <br />
                  Karnataka, India
                </address>
                <div className="ct-meta">
                  <div>
                    <span className="ct-meta-label">Legal entity</span>
                    <span className="ct-meta-val">WorkwrK Technologies Pvt. Ltd.</span>
                  </div>
                  <div>
                    <span className="ct-meta-label">GSTIN</span>
                    <span className="ct-meta-val">29AAAAA0000A0Z0</span>
                  </div>
                  <div>
                    <span className="ct-meta-label">Data residency</span>
                    <span className="ct-meta-val">AWS Mumbai · ap-south-1</span>
                  </div>
                  <div>
                    <span className="ct-meta-label">Working hours</span>
                    <span className="ct-meta-val">Mon–Fri · 10am – 7pm IST</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <style>{`
        .ct-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }
        .ct-card {
          padding: 36px 32px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          min-height: 240px;
          display: flex; flex-direction: column;
          transition: all 0.3s;
        }
        .ct-card:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .ct-card-lime .bento-label { color: var(--b-lime); opacity: 1; }
        .ct-card-pink .bento-label { color: var(--b-pink); opacity: 1; }
        .ct-card-blue .bento-label { color: var(--b-blue); opacity: 1; }
        .ct-card-amber .bento-label { color: var(--b-amber); opacity: 1; }
        .ct-title {
          font-family: var(--font-geist-mono), monospace;
          font-size: clamp(24px, 2.6vw, 32px);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1;
          margin: 14px 0 12px;
        }
        .ct-card-lime .ct-title a { color: var(--b-lime); }
        .ct-card-pink .ct-title a { color: var(--b-pink); }
        .ct-card-blue .ct-title a { color: var(--b-blue); }
        .ct-card-amber .ct-title a { color: var(--b-amber); }
        .ct-title a { text-decoration: none; }
        .ct-title a:hover { text-decoration: underline; }
        .ct-body {
          font-size: 15px;
          color: var(--b-t2);
          line-height: 1.55;
          flex: 1;
          margin: 0 0 20px;
        }
        .ct-cta {
          font-size: 13.5px;
          color: var(--b-fg);
          font-weight: 500;
          text-decoration: none;
          letter-spacing: -0.01em;
          display: inline-flex; align-items: center; gap: 6px;
          transition: gap 0.2s;
        }
        .ct-cta:hover { gap: 10px; color: var(--b-lime); }

        .ct-grid-2 {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 14px;
        }
        .ct-form-card, .ct-office {
          padding: 40px 36px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
        }
        .ct-form-title {
          font-size: 30px;
          font-weight: 600;
          letter-spacing: -0.03em;
          line-height: 1.05;
          margin: 14px 0 28px;
        }
        .ct-form { display: flex; flex-direction: column; gap: 16px; }
        .ct-field { display: flex; flex-direction: column; gap: 6px; }
        .ct-field label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--b-t3);
        }
        .ct-field input, .ct-field select, .ct-field textarea {
          padding: 14px 16px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 12px;
          color: var(--b-fg);
          font-family: inherit;
          font-size: 14.5px;
          resize: vertical;
        }
        .ct-field input:focus, .ct-field select:focus, .ct-field textarea:focus {
          outline: none;
          border-color: var(--b-lime);
          background: var(--b-card-3);
        }

        .ct-office-title {
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.03em;
          margin: 14px 0 18px;
        }
        .ct-addr {
          font-size: 15px;
          color: var(--b-off);
          line-height: 1.6;
          font-style: normal;
          margin: 0 0 28px;
        }
        .ct-meta { display: flex; flex-direction: column; gap: 14px; padding-top: 24px; border-top: 1px solid var(--b-line); }
        .ct-meta > div { display: flex; flex-direction: column; gap: 3px; }
        .ct-meta-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--b-t3);
        }
        .ct-meta-val { font-size: 14px; color: var(--b-off); }

        @media (max-width: 900px) {
          .ct-grid { grid-template-columns: 1fr; }
          .ct-grid-2 { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
