import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Roadmap — WorkwrK | What's coming next",
  description:
    "A public roadmap of features in progress, up next, and under consideration. Vote on what we build.",
  alternates: { canonical: "https://workwrk.com/roadmap" },
};

type Item = {
  title: string;
  desc: string;
  tag?: string;
  votes?: number;
};

const columns: {
  tone: "lime" | "pink" | "blue" | "amber";
  label: string;
  heading: string;
  sub: string;
  items: Item[];
}[] = [
  {
    tone: "lime",
    label: "Now",
    heading: "Shipping this quarter",
    sub: "Q2 2026 · already in production with early customers",
    items: [
      { title: "On-prem deployment", desc: "VPC deployment with your own KMS. Available on Enterprise tier.", tag: "Enterprise" },
      { title: "Mobile PWA (iOS + Android)", desc: "Reviews, kudos, SOP reads, and tablet-mode capture — full mobile coverage." },
      { title: "Slack Workflow automations", desc: "Trigger kudos, SOP reads, and review reminders via Slack workflows natively." },
      { title: "ISO 27001 certification", desc: "Audit in progress · expected completion Q3 2026.", tag: "Compliance" },
    ],
  },
  {
    tone: "pink",
    label: "Next",
    heading: "Up next",
    sub: "Q3 2026 · scoped and staffed, starting soon",
    items: [
      { title: "Scribe for mobile", desc: "Record screen SOPs from the phone. For field ops, sales calls, clinic walkthroughs." },
      { title: "Forecasting module", desc: "AI forecasts quarterly KPI trajectory. Surfaces deviation from plan before the quarter ends." },
      { title: "Custom role-ladder builder", desc: "Define your L1–L9 ladder with competency rubrics. Map promotions to concrete rubric thresholds." },
      { title: "Public API v2", desc: "GraphQL endpoint, bulk mutations, cursor-based pagination, built-in rate limits." },
    ],
  },
  {
    tone: "blue",
    label: "Later",
    heading: "Under consideration",
    sub: "Q4 2026 and beyond · design phase or gathering signal",
    items: [
      { title: "Compensation planning", desc: "Merit-cycle planning tied to composite scores. Simulate comp spread across bands.", votes: 142 },
      { title: "Succession planning", desc: "Identify successor candidates per role using composite + readiness signals.", votes: 98 },
      { title: "Arabic + Hebrew RTL polish", desc: "Full RTL layout support for GCC + Israeli customers.", votes: 76 },
      { title: "Voice check-ins", desc: "Weekly pulse via voice note (Whisper-transcribed + structured).", votes: 54 },
      { title: "Notion + Slab embed widgets", desc: "Embed SOPs and dashboards directly in your docs tool.", votes: 39 },
    ],
  },
  {
    tone: "amber",
    label: "Backlog",
    heading: "Things we've considered",
    sub: "We hear you — but we have to say no to a lot to stay good at a few",
    items: [
      { title: "Applicant tracking (ATS)", desc: "Deliberately out of scope. Plays well with Keka, Zoho People, Lever, Greenhouse." },
      { title: "Engagement survey builder", desc: "We integrate with Culture Amp + SurveyMonkey. Building ours is low-ROI right now." },
      { title: "Video training library", desc: "Scribe handles this better than a dedicated LMS. If you need an LMS, TalentLMS / Docebo." },
      { title: "Crypto / web3 integrations", desc: "Not a category fit. Not planned." },
    ],
  },
];

export default function RoadmapPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Roadmap"
              title={
                <>
                  What we&apos;re building <span className="hi">next.</span>
                </>
              }
              subtitle="We publish the roadmap so customers can plan and critics can hold us accountable. Vote on 'Later' items — the counts shape prioritisation, but don't override strategic judgement."
              aside={{
                label: "Updated",
                stat: "Apr '26",
                text: "Refreshed at the start of every quarter. Ship cadence monthly; roadmap cadence quarterly.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <Reveal stagger className="rm-grid">
            {columns.map((c) => (
              <div key={c.label} className={`rm-col rm-col-${c.tone}`}>
                <div className="rm-col-head">
                  <span className="rm-col-label">{c.label}</span>
                  <h3 className="rm-col-title">{c.heading}</h3>
                  <p className="rm-col-sub">{c.sub}</p>
                </div>
                <div className="rm-col-items">
                  {c.items.map((it, i) => (
                    <article key={i} className="rm-item">
                      <div className="rm-item-head">
                        <h4>{it.title}</h4>
                        {it.tag && <span className="rm-tag">{it.tag}</span>}
                        {typeof it.votes === "number" && (
                          <span className="rm-votes">↑ {it.votes}</span>
                        )}
                      </div>
                      <p>{it.desc}</p>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section-cta">
        <div className="bento-container">
          <Reveal>
            <div className="rm-cta">
              <h2>
                Have a request? <span className="hi">Tell us.</span>
              </h2>
              <p>
                We read every submission. Customers who add context about their
                use case get prioritised. Keep it specific — &quot;an ATS&quot; is easier
                to say no to than &quot;a sourcing flow for my 8-person recruiting team.&quot;
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/contact" className="bento-btn bento-btn-lime bento-btn-lg">
                  Submit a request →
                </Link>
                <Link href="/changelog" className="bento-btn bento-btn-ghost bento-btn-lg">
                  See what we shipped
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <style>{`
        .rm-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .rm-col {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          padding: 26px 22px;
          display: flex; flex-direction: column; gap: 20px;
          transition: all 0.3s;
          min-height: 520px;
        }
        .rm-col:hover { border-color: var(--b-line-2); }
        .rm-col-lime { border-top: 3px solid var(--b-lime); }
        .rm-col-pink { border-top: 3px solid var(--b-pink); }
        .rm-col-blue { border-top: 3px solid var(--b-blue); }
        .rm-col-amber { border-top: 3px solid var(--b-amber); }

        .rm-col-head { padding-bottom: 18px; border-bottom: 1px solid var(--b-line); }
        .rm-col-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--b-t3);
        }
        .rm-col-lime .rm-col-label { color: var(--b-lime); }
        .rm-col-pink .rm-col-label { color: var(--b-pink); }
        .rm-col-blue .rm-col-label { color: var(--b-blue); }
        .rm-col-amber .rm-col-label { color: var(--b-amber); }
        .rm-col-title {
          font-size: 20px;
          font-weight: 600;
          letter-spacing: -0.025em;
          line-height: 1.2;
          margin: 8px 0 6px;
        }
        .rm-col-sub {
          font-size: 12.5px;
          color: var(--b-t2);
          line-height: 1.5;
          margin: 0;
        }
        .rm-col-items { display: flex; flex-direction: column; gap: 8px; }
        .rm-item {
          padding: 14px 14px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 12px;
          transition: all 0.25s;
        }
        .rm-item:hover { background: var(--b-card-3); border-color: var(--b-line-2); }
        .rm-item-head {
          display: flex; align-items: center; gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }
        .rm-item h4 {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.015em;
          margin: 0;
          color: var(--b-fg);
        }
        .rm-tag {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9px;
          padding: 2px 7px;
          border-radius: 100px;
          border: 1px solid var(--b-line);
          color: var(--b-t3);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .rm-votes {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-lime);
          margin-left: auto;
          letter-spacing: 0.06em;
        }
        .rm-item p {
          font-size: 12.5px;
          color: var(--b-t2);
          line-height: 1.45;
          margin: 0;
        }

        .rm-cta {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 64px 48px;
          text-align: center;
        }
        .rm-cta h2 {
          font-size: clamp(34px, 5vw, 56px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin: 0 0 16px;
        }
        .rm-cta p {
          font-size: 16px;
          color: var(--b-t2);
          max-width: 580px;
          margin: 0 auto 28px;
          line-height: 1.6;
        }

        @media (max-width: 1000px) { .rm-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 580px) { .rm-grid { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
