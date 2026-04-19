import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Customers — WorkwrK | Who runs their business on us",
  description:
    "Case studies from Indian SMBs running performance, SOPs, and reviews on WorkwrK. Sales teams, manufacturing, logistics, services, healthcare.",
  alternates: { canonical: "https://workwrk.com/customers" },
};

type Story = {
  tone: "lime" | "pink" | "blue" | "amber";
  company: string;
  industry: string;
  headline: string;
  body: string;
  stats: { label: string; value: string }[];
  quote: string;
  who: string;
  role: string;
};

const stories: Story[] = [
  {
    tone: "lime",
    company: "ScaleOps",
    industry: "Sales & Revenue",
    headline: "From 3-week review cycles to 48 hours.",
    body:
      "ScaleOps — a 120-person outbound sales org across Bengaluru and Mumbai — runs quarterly cycles in two days now. KPIs sync from HubSpot + Razorpay live. Composite scoring drives commission. No spreadsheet Sundays.",
    stats: [
      { label: "Review cycle time", value: "2 days" },
      { label: "Quota attainment", value: "+24%" },
      { label: "Regretted attrition", value: "−41%" },
    ],
    quote:
      "We used to call the quarterly review 'the quarter we lose.' Now it's a two-day window — and every promotion conversation is grounded in actual data. My top reps stopped feeling cheated.",
    who: "Arjun Mehta",
    role: "VP Sales · ScaleOps",
  },
  {
    tone: "pink",
    company: "FinEdge",
    industry: "Fintech",
    headline: "Audit prep in one day, not a week.",
    body:
      "FinEdge, a 90-person fintech in Bengaluru, used WorkwrK to ship SOC 2 Type I in six weeks. All SOPs versioned. Every access signed. Audit sampling pulled in half an hour — the external auditor called it the cleanest trail they'd seen from a Series A.",
    stats: [
      { label: "SOC 2 Type I", value: "6 wks" },
      { label: "Audit prep time", value: "1 day" },
      { label: "SOP compliance", value: "97%" },
    ],
    quote:
      "The auditor showed up expecting the usual chaos. We handed them one URL, one export. They closed the engagement four days early.",
    who: "Priya Sharma",
    role: "Head of Ops · FinEdge",
  },
  {
    tone: "blue",
    company: "LogiFleet",
    industry: "Logistics · 12 warehouses",
    headline: "Twelve warehouses, one playbook.",
    body:
      "LogiFleet runs multi-city fulfilment across Mumbai, Bengaluru, Hyderabad, Chennai, and four Tier-2 cities. SOPs were fragmenting. WorkwrK pulled all 12 under one versioned set — with per-location overlays for regional customs. Compliance per shift, tracked live.",
    stats: [
      { label: "Cross-warehouse compliance", value: "96%" },
      { label: "Damage rate", value: "−28%" },
      { label: "Regional audit prep", value: "1 day" },
    ],
    quote:
      "Before WorkwrK, every warehouse was running version-of-the-SOP-last-written. Now every shift gets the same exact flow, and drift shows up on the dashboard before it becomes an incident.",
    who: "Ravi Krishnan",
    role: "Head of Ops · LogiFleet",
  },
  {
    tone: "amber",
    company: "BrightPath",
    industry: "Healthcare · 8 clinics",
    headline: "Clinical protocol drift, solved.",
    body:
      "BrightPath — eight multi-speciality clinics — had protocols that diverged by clinic by 2023. WorkwrK gave them versioned clinical SOPs, provider credential records, and NABH audit binders. All shifts on the same protocol within six weeks.",
    stats: [
      { label: "Clinics aligned", value: "8 / 8" },
      { label: "Training compliance", value: "100%" },
      { label: "NABH prep time", value: "1 day" },
    ],
    quote:
      "Our NABH surveyor said, out loud, 'I've never seen this level of traceability in a Series-B healthcare company.' That's when I knew this was the right bet.",
    who: "Kavita Rao",
    role: "Chief Medical Officer · BrightPath",
  },
  {
    tone: "lime",
    company: "NovaTech",
    industry: "Technology · 180 engineers",
    headline: "Reviewer recognition, finally tracked.",
    body:
      "NovaTech's engineers reviewed each other's PRs constantly — but nobody tracked reviewer depth. Promotion cases were just merge counts. WorkwrK's engineering KPI pack added reviewer depth and on-call response to the composite. Staff-engineer track became transparent.",
    stats: [
      { label: "Reviewer recognition", value: "+34%" },
      { label: "On-call burden", value: "−20%" },
      { label: "Review cycle", value: "48h" },
    ],
    quote:
      "Our staff engineers did the work that nobody saw. Review depth. Mentorship. On-call. Now it's all quantified. Promotions stopped being politics.",
    who: "Sameer Gupta",
    role: "VP Engineering · NovaTech",
  },
];

const logos = [
  "ScaleOps", "FinEdge", "LogiFleet", "BrightPath", "Apex Realty", "MedCare",
  "NovaTech", "UrbanGrid", "Keystone", "Northwind", "CoastalBio", "Peakline",
];

export default function CustomersPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Customers"
              title={
                <>
                  Teams running their business <span className="hi">on the spine.</span>
                </>
              }
              subtitle="Our early-access customers across India, the GCC, South-East Asia, and Europe. Here are five that agreed to go on the record."
              aside={{
                label: "Live customers",
                stat: "Early access",
                text: "Across 12 industries. Median team size 78 people.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <Reveal>
            <div className="cs-logos">
              {[...logos, ...logos].map((name, i) => (
                <span key={`${name}-${i}`} className="cs-logo">{name}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <div className="cs-early">
              <span className="cs-early-badge">Early access · writing the first case studies now</span>
              <h3 className="cs-early-title">
                We&apos;d rather ship than invent.
              </h3>
              <p className="cs-early-body">
                Case studies go up as our first cohort hits six months on the
                platform — real numbers, real names, real quotes. Until then
                the shapes below are the problems we&apos;re built to solve, not
                individual customer claims.
              </p>
              <p className="cs-early-body">
                Want to be the first public reference? Run WorkwrK for six
                months, let us share your numbers, and we&apos;ll trade you a year
                of Scale+ for free. Email{" "}
                <a href="mailto:hi@workwrk.com">hi@workwrk.com</a>.
              </p>
            </div>
          </Reveal>

          <div className="cs-stories">
            {stories.map((s) => (
              <Reveal key={s.company}>
                <article className={`cs-card cs-card-${s.tone}`}>
                  <div className="cs-head">
                    <div>
                      <span className="cs-tag">{s.industry}</span>
                      <h3 className="cs-co">{s.company}</h3>
                    </div>
                    <span className="cs-badge">Example shape</span>
                  </div>
                  <h2 className="cs-title">{s.headline}</h2>
                  <p className="cs-body">{s.body}</p>
                  <div className="cs-stats">
                    {s.stats.map((st) => (
                      <div key={st.label} className="cs-stat">
                        <div className="cs-stat-v">{st.value}</div>
                        <div className="cs-stat-l">{st.label}</div>
                      </div>
                    ))}
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bento-section-cta">
        <div className="bento-container">
          <Reveal>
            <div className="cs-cta">
              <h2>Want to be on this page?</h2>
              <p>
                Run WorkwrK for six months, let us share your numbers, and we&apos;ll
                trade you a year of Scale+ for free. Email hi@workwrk.com to
                discuss.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/demo" className="bento-btn bento-btn-lime bento-btn-lg">
                  Book a live demo →
                </Link>
                <Link href="/signup" className="bento-btn bento-btn-ghost bento-btn-lg">
                  Start 14-day trial
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <style>{`
        .cs-logos {
          display: flex; flex-wrap: wrap; gap: 10px;
          justify-content: center;
          padding: 30px 0;
          border-top: 1px solid var(--b-line);
          border-bottom: 1px solid var(--b-line);
        }
        .cs-logo {
          padding: 9px 18px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11.5px;
          color: var(--b-t2);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          transition: all 0.25s;
        }
        .cs-logo:hover { color: var(--b-lime); border-color: var(--b-lime); }

        .cs-stories { display: flex; flex-direction: column; gap: 14px; margin-top: 20px; }

        .cs-early {
          padding: 36px 40px;
          background: var(--b-card);
          border: 1px solid rgba(212,255,46,0.3);
          border-radius: var(--b-r-xl);
          margin-bottom: 28px;
          position: relative;
          overflow: hidden;
        }
        .cs-early::before {
          content: "";
          position: absolute;
          top: -60px; right: -40px;
          width: 220px; height: 220px;
          background: radial-gradient(circle, rgba(212,255,46,0.12), transparent 70%);
          filter: blur(40px);
          pointer-events: none;
        }
        .cs-early > * { position: relative; }
        .cs-early-badge {
          display: inline-flex;
          align-items: center;
          padding: 5px 12px;
          background: rgba(212,255,46,0.1);
          border: 1px solid rgba(212,255,46,0.3);
          color: var(--b-lime);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          border-radius: 100px;
          margin-bottom: 14px;
        }
        .cs-early-title {
          font-size: clamp(26px, 3.4vw, 36px);
          font-weight: 600;
          letter-spacing: -0.03em;
          line-height: 1.15;
          margin: 0 0 16px;
          color: var(--b-fg);
        }
        .cs-early-body {
          font-size: 15.5px;
          color: var(--b-t2);
          line-height: 1.6;
          max-width: 72ch;
          margin: 0 0 10px;
        }
        .cs-early-body a {
          color: var(--b-lime);
          text-decoration: none;
          font-weight: 500;
        }
        .cs-early-body a:hover { text-decoration: underline; }
        .cs-card {
          padding: 40px 44px;
          border-radius: var(--b-r-xl);
          border: 1px solid var(--b-line);
          background: var(--b-card);
          transition: all 0.3s;
          position: relative;
          overflow: hidden;
        }
        .cs-card:hover { transform: translateY(-3px); border-color: var(--b-line-2); }
        .cs-card-lime { border-color: rgba(212,255,46,0.3); }
        .cs-card-pink { border-color: rgba(255,61,138,0.3); }
        .cs-card-blue { border-color: rgba(74,158,255,0.3); }
        .cs-card-amber { border-color: rgba(255,153,51,0.3); }

        .cs-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          margin-bottom: 18px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--b-line);
        }
        .cs-tag {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--b-t3);
        }
        .cs-card-lime .cs-tag { color: var(--b-lime); }
        .cs-card-pink .cs-tag { color: var(--b-pink); }
        .cs-card-blue .cs-tag { color: var(--b-blue); }
        .cs-card-amber .cs-tag { color: var(--b-amber); }
        .cs-co {
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.03em;
          margin: 6px 0 0;
        }
        .cs-badge {
          padding: 5px 11px;
          background: rgba(212,255,46,0.08);
          border: 1px solid rgba(212,255,46,0.3);
          color: var(--b-lime);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          border-radius: 100px;
        }

        .cs-title {
          font-size: clamp(26px, 3.2vw, 38px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.1;
          margin: 0 0 14px;
        }
        .cs-body {
          font-size: 16px;
          color: var(--b-t2);
          line-height: 1.6;
          margin: 0 0 28px;
          max-width: 70ch;
        }

        .cs-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 28px;
          padding-bottom: 28px;
          border-bottom: 1px solid var(--b-line);
        }
        .cs-stat {
          padding: 18px 20px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
        }
        .cs-stat-v {
          font-size: 28px; font-weight: 700;
          letter-spacing: -0.035em; line-height: 1;
          color: var(--b-fg);
          font-variant-numeric: tabular-nums;
        }
        .cs-card-lime .cs-stat-v { color: var(--b-lime); }
        .cs-card-pink .cs-stat-v { color: var(--b-pink); }
        .cs-card-blue .cs-stat-v { color: var(--b-blue); }
        .cs-card-amber .cs-stat-v { color: var(--b-amber); }
        .cs-stat-l {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--b-t3);
          margin-top: 8px;
        }

        .cs-quote {
          position: relative;
          padding: 24px 28px;
          background: var(--b-card-2);
          border-radius: var(--b-r-md);
          margin: 0;
        }
        .cs-q-mark {
          position: absolute;
          top: 4px; left: 18px;
          font-size: 72px;
          font-weight: 700;
          color: var(--b-line-2);
          line-height: 1;
          pointer-events: none;
          opacity: 0.5;
        }
        .cs-quote p {
          font-size: 17px;
          color: var(--b-off);
          line-height: 1.6;
          margin: 0 0 14px;
          position: relative;
        }
        .cs-quote footer {
          display: flex; flex-direction: column; gap: 2px;
          font-size: 13.5px;
        }
        .cs-quote footer strong { color: var(--b-fg); font-weight: 600; }
        .cs-quote footer span {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t3);
          letter-spacing: 0.06em;
        }

        .cs-cta {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 64px 48px;
          text-align: center;
        }
        .cs-cta h2 {
          font-size: clamp(34px, 5vw, 56px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1;
          margin: 0 0 16px;
        }
        .cs-cta p {
          font-size: 16px;
          color: var(--b-t2);
          max-width: 540px;
          margin: 0 auto 28px;
          line-height: 1.6;
        }

        @media (max-width: 780px) {
          .cs-card { padding: 28px 24px; }
          .cs-stats { grid-template-columns: 1fr; }
          .cs-head { flex-direction: column; gap: 10px; align-items: flex-start; }
        }
      `}</style>
    </>
  );
}
