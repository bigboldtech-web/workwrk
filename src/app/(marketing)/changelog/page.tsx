import type { Metadata } from "next";

import { Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Changelog — WorkwrK | What we shipped",
  description:
    "Month-by-month log of every shipped feature, fix, and improvement. Published with each release.",
  alternates: { canonical: "https://workwrk.com/changelog" },
};

type Entry = {
  date: string;
  version: string;
  tone: "lime" | "pink" | "blue" | "amber" | "dark";
  title: string;
  items: { type: "new" | "improved" | "fixed"; text: string }[];
};

const entries: Entry[] = [
  {
    date: "April 2026",
    version: "v1.0 · launch",
    tone: "lime",
    title: "WorkwrK 1.0 — public launch.",
    items: [
      { type: "new", text: "Twelve modules on one spine — People, KRAs, KPIs, SOPs, Reviews, OKRs, Tasks, Kudos, AI Engine, Analytics, Integrations, Access — all live." },
      { type: "new", text: "AI Engine powered by Claude — reasoning across every module, signal detection (attrition risk, SOP drift, kudos decay, KPI stale)." },
      { type: "new", text: "Task SLAs + auto-escalation — set slaHours on any task; breaches route up the org with Slack + webhook notifications." },
      { type: "new", text: "Google SSO — sign in with Google Workspace (admin-enrolled users only)." },
      { type: "new", text: "Public REST API v1 — seven resource endpoints with bearer-token auth, rate limits, cursor pagination." },
      { type: "new", text: "Webhook subscriptions — HMAC-SHA256 signed, exponential-backoff retries, delivery audit log." },
      { type: "new", text: "Stripe billing — self-serve subscriptions. Per-user $4/month or flat-tier $50 / $150 / $300." },
      { type: "new", text: "Slack integration — kudos, task escalations, signal digests post to a configured incoming webhook." },
      { type: "new", text: "OpenAPI 3.1 spec — published at /api/v1/openapi.json. Drop into Postman, Insomnia, or auto-generate a client." },
    ],
  },
  {
    date: "Next — coming weeks",
    version: "roadmap",
    tone: "blue",
    title: "What&apos;s actively in build.",
    items: [
      { type: "new", text: "Razorpay connector — payroll + revenue KPI push-in." },
      { type: "new", text: "Keka + GreytHR HRMS sync — attendance, compensation, org graph updates." },
      { type: "new", text: "HubSpot connector — pipeline + deal KPIs as live readings." },
      { type: "new", text: "Scribe video recording — screen capture + AI step extraction for SOPs." },
      { type: "new", text: "SAML SSO — Okta, Azure AD, OneLogin. (Google OAuth already live.)" },
      { type: "new", text: "SOP process-flow builder — drag-and-drop branching flows with SLA timers per step." },
    ],
  },
  {
    date: "Later — quarters ahead",
    version: "roadmap",
    tone: "amber",
    title: "Under evaluation.",
    items: [
      { type: "new", text: "SOC 2 Type II attestation — audit engagement queued." },
      { type: "new", text: "ISO 27001 — targeted for 2026." },
      { type: "new", text: "Analytics warehouse — Postgres read-replica + Snowflake / BigQuery native sync." },
      { type: "new", text: "Field-level encryption at rest for PII." },
      { type: "new", text: "SCIM user provisioning for enterprise." },
    ],
  },
];

function typeStyle(type: Entry["items"][number]["type"]) {
  if (type === "new") return { label: "NEW", color: "var(--b-lime)" };
  if (type === "improved") return { label: "IMPROVED", color: "var(--b-blue)" };
  return { label: "FIXED", color: "var(--b-amber)" };
}

export default function ChangelogPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Changelog"
              title={
                <>
                  Every release, <span className="hi">logged honestly.</span>
                </>
              }
              subtitle="We ship every month. New features, bug fixes, performance improvements. Subscribe via RSS or follow our changelog email digest — one per release, no fluff."
              aside={{
                label: "Latest",
                stat: "v26.4",
                text: "Shipped April 2026 · Process Flows + AI Engine v2 highlighted.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <div className="cl-timeline">
            {entries.map((e) => (
              <Reveal key={e.version}>
                <article className={`cl-entry cl-entry-${e.tone}`}>
                  <div className="cl-side">
                    <div className="cl-date">{e.date}</div>
                    <div className="cl-version">{e.version}</div>
                    <div className="cl-dot" aria-hidden />
                  </div>
                  <div className="cl-main">
                    <h2 className="cl-title">{e.title}</h2>
                    <ul className="cl-items">
                      {e.items.map((it, i) => {
                        const ts = typeStyle(it.type);
                        return (
                          <li key={i}>
                            <span
                              className="cl-type"
                              style={{ color: ts.color, borderColor: ts.color }}
                            >
                              {ts.label}
                            </span>
                            <span className="cl-text">{it.text}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <div className="cl-sub">
              <h2>Get every release in your inbox.</h2>
              <p>One email per release. Direct from the product team. Zero marketing copy.</p>
              <form className="cl-form" action="/api/changelog-subscribe" method="post">
                <input
                  type="email"
                  name="email"
                  placeholder="priya@company.in"
                  className="cl-input"
                  required
                />
                <button type="submit" className="bento-btn bento-btn-lime">
                  Subscribe <span className="arr">→</span>
                </button>
              </form>
            </div>
          </Reveal>
        </div>
      </section>

      <style>{`
        .cl-timeline {
          display: flex; flex-direction: column; gap: 14px;
          position: relative;
        }
        .cl-entry {
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 32px;
          padding: 30px 32px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          transition: all 0.3s;
          position: relative;
        }
        .cl-entry:hover { transform: translateY(-2px); border-color: var(--b-line-2); }
        .cl-entry-lime { border-left: 3px solid var(--b-lime); }
        .cl-entry-pink { border-left: 3px solid var(--b-pink); }
        .cl-entry-blue { border-left: 3px solid var(--b-blue); }
        .cl-entry-amber { border-left: 3px solid var(--b-amber); }
        .cl-side { position: relative; }
        .cl-date {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--b-t3);
          margin-bottom: 6px;
        }
        .cl-version {
          font-family: var(--font-geist-mono), monospace;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: -0.03em;
          color: var(--b-fg);
        }
        .cl-entry-lime .cl-version { color: var(--b-lime); }
        .cl-entry-pink .cl-version { color: var(--b-pink); }
        .cl-entry-blue .cl-version { color: var(--b-blue); }
        .cl-entry-amber .cl-version { color: var(--b-amber); }

        .cl-title {
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.028em;
          line-height: 1.15;
          margin: 0 0 20px;
        }
        .cl-items {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-direction: column; gap: 12px;
        }
        .cl-items li {
          display: grid;
          grid-template-columns: 90px 1fr;
          gap: 14px;
          align-items: start;
          padding: 12px 14px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 10px;
          font-size: 14px;
          line-height: 1.5;
        }
        .cl-type {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.14em;
          padding: 3px 8px;
          border: 1px solid currentColor;
          border-radius: 100px;
          text-align: center;
          height: max-content;
          white-space: nowrap;
          background: rgba(255, 255, 255, 0.02);
        }
        .cl-text { color: var(--b-off); }

        .cl-sub {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 48px;
          text-align: center;
        }
        .cl-sub h2 {
          font-size: clamp(28px, 3.6vw, 40px);
          font-weight: 600;
          letter-spacing: -0.03em;
          margin: 0 0 10px;
        }
        .cl-sub p {
          font-size: 15px;
          color: var(--b-t2);
          max-width: 48ch;
          margin: 0 auto 24px;
        }
        .cl-form {
          display: inline-flex; gap: 10px;
          max-width: 420px;
          width: 100%;
        }
        .cl-input {
          flex: 1;
          padding: 13px 16px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          color: var(--b-fg);
          font-family: inherit;
          font-size: 14.5px;
        }
        .cl-input:focus {
          outline: none;
          border-color: var(--b-lime);
          background: var(--b-card-3);
        }

        @media (max-width: 780px) {
          .cl-entry { grid-template-columns: 1fr; padding: 24px; }
          .cl-items li { grid-template-columns: 1fr; gap: 6px; }
          .cl-type { width: max-content; }
          .cl-form { flex-direction: column; }
        }
      `}</style>
    </>
  );
}
