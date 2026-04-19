import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Compare — WorkwrK vs Lattice, Leapsome, 15Five, and spreadsheets",
  description:
    "How WorkwrK compares to standalone review tools (Lattice, Leapsome, 15Five) and to spreadsheets. One spine vs stitched software.",
  alternates: { canonical: "https://workwrk.com/compare" },
};

type Row = {
  capability: string;
  workwrk: string | boolean;
  lattice: string | boolean;
  leapsome: string | boolean;
  fiveteen: string | boolean;
  sheets: string | boolean;
};

const rows: { category: string; items: Row[] }[] = [
  {
    category: "Core",
    items: [
      { capability: "People · org graph", workwrk: true, lattice: "Basic", leapsome: "Basic", fiveteen: false, sheets: "Manual" },
      { capability: "KPIs · live from tools", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
      { capability: "KRAs · per-role, AI-drafted", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: "Manual" },
      { capability: "Tasks · auto-escalating", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
    ],
  },
  {
    category: "Performance",
    items: [
      { capability: "Composite scoring", workwrk: true, lattice: "Limited", leapsome: "Limited", fiveteen: false, sheets: "DIY" },
      { capability: "48-hour review cycle", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
      { capability: "Calibration σ · auto-flag", workwrk: true, lattice: "Limited", leapsome: "Limited", fiveteen: false, sheets: false },
      { capability: "Pre-filled from live KPIs", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
    ],
  },
  {
    category: "Process",
    items: [
      { capability: "Versioned SOPs", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
      { capability: "Scribe screen-recording → SOP", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
      { capability: "Process flows · branching", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
      { capability: "Compliance tracking per user", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
    ],
  },
  {
    category: "Recognition",
    items: [
      { capability: "Values-tagged kudos", workwrk: true, lattice: "Limited", leapsome: "Limited", fiveteen: "Limited", sheets: false },
      { capability: "Kudos feeds scoring", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
      { capability: "Decay alerts (60-day silence)", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
    ],
  },
  {
    category: "AI",
    items: [
      { capability: "Reasoning across modules", workwrk: true, lattice: false, leapsome: "Chat", fiveteen: "Chat", sheets: false },
      { capability: "AI-drafted KRAs with citations", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: false },
      { capability: "Attrition risk · 27-day lead", workwrk: true, lattice: "Surveys", leapsome: "Surveys", fiveteen: "Surveys", sheets: false },
      { capability: "Private by default (no training)", workwrk: true, lattice: "Varies", leapsome: "Varies", fiveteen: "Varies", sheets: "—" },
    ],
  },
  {
    category: "Data + integrations",
    items: [
      { capability: "40+ native connectors", workwrk: true, lattice: "Some", leapsome: "Some", fiveteen: "Some", sheets: "Zapier" },
      { capability: "SQL-friendly warehouse", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: "Is the sheet" },
      { capability: "REST + webhooks API", workwrk: true, lattice: "Limited", leapsome: "Limited", fiveteen: "Limited", sheets: false },
    ],
  },
  {
    category: "Compliance",
    items: [
      { capability: "SOC 2 Type II", workwrk: true, lattice: true, leapsome: true, fiveteen: true, sheets: "N/A" },
      { capability: "DPDPA (India) native", workwrk: true, lattice: false, leapsome: false, fiveteen: false, sheets: "N/A" },
      { capability: "GST / VAT local invoicing", workwrk: true, lattice: "US/EU first", leapsome: "US/EU first", fiveteen: "US/EU first", sheets: "N/A" },
      { capability: "Signed audit log, verifiable offline", workwrk: true, lattice: "Limited", leapsome: "Limited", fiveteen: "Limited", sheets: false },
    ],
  },
];

const qualitatives = [
  {
    tone: "lime",
    vs: "vs spreadsheets",
    title: "Spreadsheets are where data goes to die.",
    body: "The macro you built works — until the person who built it leaves. Formulas silently break. Version history is whichever tab is 'final (v14)'. WorkwrK gives you the same flexibility, with a real data model underneath.",
  },
  {
    tone: "pink",
    vs: "vs Lattice",
    title: "Lattice is a review tool. You need a spine.",
    body: "Lattice is a great review product — for US-first mid-market teams. What's missing is everything around it: SOPs, tasks, KPI connectors for Indian tools (Razorpay, Keka), and an AI that knows your org. We add the plumbing Lattice assumes your BI team already built.",
  },
  {
    tone: "blue",
    vs: "vs Leapsome",
    title: "Leapsome's feature-checklist is similar. Depth isn't.",
    body: "Both run reviews, OKRs, and learning. Leapsome stops at the boundary of 'people ops software.' WorkwrK keeps going — into SOPs, into live KPIs from your stack, into AI that reasons across all of it. The checklist looks similar. The depth compounds very differently.",
  },
  {
    tone: "amber",
    vs: "vs 15Five",
    title: "15Five is a pulse-survey tool with review features bolted on.",
    body: "Weekly check-ins, OKRs, light performance. Works great for 50-person tech startups that want lightweight touch. Falls apart when you need SOPs across 12 warehouses or provider protocol tracking across 8 clinics. Different tool for a different shape of problem.",
  },
];

function renderCell(v: string | boolean) {
  if (v === true) return <span className="cm-tick">✓</span>;
  if (v === false) return <span className="cm-x">—</span>;
  return <span className="cm-val">{v}</span>;
}

export default function ComparePage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Compare"
              title={
                <>
                  How WorkwrK stacks up against <span className="hi">the usual suspects.</span>
                </>
              }
              subtitle="If you're currently using Lattice, Leapsome, 15Five, or a stack of spreadsheets — this is an honest row-by-row comparison. Pick the one that fits your shape of problem."
              aside={{
                label: "Honest take",
                stat: "4",
                text: "We don't tell you we're better at everything. We tell you where each tool actually shines.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <Reveal>
            <div className="cm-card">
              <div className="cm-head">
                <div>Capability</div>
                <div className="cm-us">WorkwrK</div>
                <div>Lattice</div>
                <div>Leapsome</div>
                <div>15Five</div>
                <div>Sheets</div>
              </div>
              {rows.map((c) => (
                <div key={c.category}>
                  <div className="cm-cat">{c.category}</div>
                  {c.items.map((r) => (
                    <div key={r.capability} className="cm-row">
                      <div className="cm-name">{r.capability}</div>
                      <div className="cm-cell cm-us-cell">{renderCell(r.workwrk)}</div>
                      <div className="cm-cell">{renderCell(r.lattice)}</div>
                      <div className="cm-cell">{renderCell(r.leapsome)}</div>
                      <div className="cm-cell">{renderCell(r.fiveteen)}</div>
                      <div className="cm-cell">{renderCell(r.sheets)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="The honest take"
              title={
                <>
                  Not every team needs <span className="hi">a spine.</span>
                </>
              }
              subtitle="Sometimes a focused tool is the right answer. Here's when we think each of these is the smart choice."
            />
          </Reveal>
          <Reveal stagger className="cm-qgrid">
            {qualitatives.map((q) => (
              <article key={q.vs} className={`cm-q cm-q-${q.tone}`}>
                <span className="cm-q-tag">{q.vs}</span>
                <h3>{q.title}</h3>
                <p>{q.body}</p>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section-cta">
        <div className="bento-container">
          <Reveal>
            <div className="cm-cta">
              <h2>
                Migrating from one of these? <span className="hi">We&apos;ll help.</span>
              </h2>
              <p>
                Free migration support on Growth and Scale plans. We import your
                existing review history, KRAs, and SOPs in one working day.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/demo" className="bento-btn bento-btn-lime bento-btn-lg">
                  Book a migration call →
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
        .cm-card {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 28px;
          padding: 12px 6px;
          overflow: hidden;
        }
        .cm-head, .cm-row {
          display: grid;
          grid-template-columns: 2fr repeat(5, 1fr);
          align-items: center;
          padding: 14px 20px;
          font-size: 13px;
        }
        .cm-head {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--b-t3);
          border-bottom: 1px solid var(--b-line-2);
        }
        .cm-us { color: var(--b-lime); }
        .cm-cat {
          padding: 18px 20px 6px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: var(--b-lime);
        }
        .cm-row { border-bottom: 1px dashed var(--b-line); }
        .cm-row:last-child { border-bottom: none; }
        .cm-name { color: var(--b-off); font-size: 13.5px; }
        .cm-cell { text-align: center; }
        .cm-us-cell { background: rgba(212,255,46,0.05); border-radius: 4px; }
        .cm-tick { color: var(--b-lime); font-weight: 700; }
        .cm-x { color: var(--b-t4); }
        .cm-val { font-family: var(--font-geist-mono), monospace; font-size: 11.5px; color: var(--b-t2); }

        .cm-qgrid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
          margin-top: 32px;
        }
        .cm-q {
          padding: 32px 30px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          transition: all 0.3s;
        }
        .cm-q:hover { transform: translateY(-3px); border-color: var(--b-line-2); }
        .cm-q-lime { border-color: rgba(212,255,46,0.3); }
        .cm-q-pink { border-color: rgba(255,61,138,0.3); }
        .cm-q-blue { border-color: rgba(74,158,255,0.3); }
        .cm-q-amber { border-color: rgba(255,153,51,0.3); }
        .cm-q-tag {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          display: block;
          margin-bottom: 12px;
        }
        .cm-q-lime .cm-q-tag { color: var(--b-lime); }
        .cm-q-pink .cm-q-tag { color: var(--b-pink); }
        .cm-q-blue .cm-q-tag { color: var(--b-blue); }
        .cm-q-amber .cm-q-tag { color: var(--b-amber); }
        .cm-q h3 {
          font-size: 24px;
          font-weight: 600;
          letter-spacing: -0.025em;
          line-height: 1.2;
          margin: 0 0 12px;
        }
        .cm-q p {
          font-size: 14.5px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
        }

        .cm-cta {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 64px 48px;
          text-align: center;
        }
        .cm-cta h2 {
          font-size: clamp(34px, 5vw, 56px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin: 0 0 16px;
        }
        .cm-cta p {
          font-size: 16px;
          color: var(--b-t2);
          max-width: 520px;
          margin: 0 auto 28px;
          line-height: 1.6;
        }

        @media (max-width: 960px) {
          .cm-head, .cm-row { font-size: 11.5px; grid-template-columns: 1.6fr repeat(5, 1fr); padding: 10px 12px; }
          .cm-qgrid { grid-template-columns: 1fr; }
        }
        @media (max-width: 700px) {
          .cm-head, .cm-row { grid-template-columns: 1.4fr 0.8fr 0.8fr 0.8fr; }
          .cm-head > *:nth-child(5), .cm-head > *:nth-child(6),
          .cm-row > *:nth-child(5), .cm-row > *:nth-child(6) { display: none; }
        }
      `}</style>
    </>
  );
}
