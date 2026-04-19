import type { Metadata } from "next";
import Link from "next/link";

import { Label, Reveal, SectionHeader } from "@/components/bento";
import {
  IconAccess,
  IconAi,
  IconAnalytics,
  IconIntegrations,
  IconKpi,
  IconKra,
  IconKudos,
  IconOkr,
  IconPeople,
  IconReviews,
  IconSop,
  IconTask,
} from "@/components/bento/module-icons";
import type { ReactElement, SVGProps } from "react";

export const metadata: Metadata = {
  title: "Features — WorkwrK | Performance, SOPs, Reviews, AI",
  description:
    "Twelve modules, one spine. People, KPIs, KRAs, SOPs, Reviews, OKRs, Tasks, Kudos, AI Engine, Analytics, Integrations, Access — sharing one data model.",
  alternates: { canonical: "https://workwrk.com/features" },
  openGraph: {
    title: "Features — WorkwrK",
    description:
      "Twelve modules, one spine. Performance scoring, SOPs, reviews, AI intelligence — all connected.",
    url: "https://workwrk.com/features",
  },
};

const pillars = [
  {
    id: "performance",
    variant: "lime" as const,
    label: "Performance",
    title: "One composite score. Six real sources.",
    body:
      "KPI attainment, peer feedback, manager reviews, SOP compliance, recognition, and self-assessment — fused into one honest, defensible number. Scores recalculate nightly.",
    bullets: [
      "Weighted across 6 signal sources",
      "Per-role calibration · σ tolerance",
      "Auto-updates on every KRA / KPI change",
      "Drives promotions, bonuses, PIPs",
    ],
  },
  {
    id: "process",
    variant: "dark" as const,
    label: "Process",
    title: "SOPs that don't rot in a Drive folder.",
    body:
      "Versioned, assignable, nightly-audited. Let AI extract SOPs from a screen recording instead of writing them from scratch.",
    bullets: [
      "Versioning · audit trail",
      "Auto-extract from Loom / video",
      "Compliance tracked per user",
      "Auto-assign by role",
    ],
  },
  {
    id: "reviews",
    variant: "dark" as const,
    label: "Reviews",
    title: "Two-day cycle time. Pre-filled with real data.",
    body:
      "From two weeks to forty-eight hours. Manager, peer, and self-flows land pre-populated with KPIs, SOPs, and quarter-over-quarter deltas.",
    bullets: [
      "360° peer feedback",
      "Calibration across managers",
      "Self-assessment prompts · weighted",
      "Exports to PDF for HR files",
    ],
  },
  {
    id: "ai",
    variant: "dark" as const,
    label: "AI Engine",
    title: "An AI that reads your data.",
    body:
      "Not a chatbot. A reasoning layer that knows your org, KRAs, SOPs, review history — and answers questions a consultant couldn't.",
    bullets: [
      "Draft KRAs from a job description",
      "Surface attrition risk before it hits",
      "Summarise reviews, suggest kudos",
      "Claude-powered · private by default",
    ],
  },
];

type ModuleEntry = {
  n: string;
  name: string;
  meta: string;
  desc: string;
  href: string;
  icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
  color?: "hi" | "pk" | "bl" | "am";
};

const modules: ModuleEntry[] = [
  { n: "01", name: "People", meta: "Org · roles", desc: "Canonical team graph. Bulk-import from CSV or Google Workspace.", href: "/features/people", icon: IconPeople, color: "hi" },
  { n: "02", name: "KPIs", meta: "Live metrics", desc: "Per-role KPIs with live targets. Scores pull from connected tools.", href: "/features/kpis", icon: IconKpi },
  { n: "03", name: "KRAs", meta: "Per-role · AI", desc: "AI-drafted, human-approved. Map KPIs to KRAs to roles.", href: "/features/kras", icon: IconKra },
  { n: "04", name: "SOPs", meta: "Playbooks", desc: "Versioned, assignable, audited. Video → SOP extraction saves weeks.", href: "/features/sops", icon: IconSop, color: "pk" },
  { n: "05", name: "Reviews", meta: "Composite", desc: "48-hour cycle. Manager + peer + self. Pre-filled with real data.", href: "/features/reviews", icon: IconReviews },
  { n: "06", name: "OKRs", meta: "Cascaded", desc: "Company → team → individual. Lightweight enough to actually use.", href: "/features/okrs", icon: IconOkr },
  { n: "07", name: "Tasks", meta: "Auto-escalate", desc: "Tasks born from reviews, SOPs, meetings. Escalate on SLA.", href: "/features/tasks", icon: IconTask, color: "bl" },
  { n: "08", name: "Kudos", meta: "Recognition", desc: "Peer recognition tagged to company values. Feeds scoring.", href: "/features/kudos", icon: IconKudos },
  { n: "09", name: "AI Engine", meta: "Claude · private", desc: "Ask your business anything. Drafts, surfaces risk, summarises.", href: "/features/ai-engine", icon: IconAi },
  { n: "10", name: "Analytics", meta: "SQL layer", desc: "Every number exportable. BI-friendly schema, REST API on Scale+.", href: "/features/analytics", icon: IconAnalytics, color: "am" },
  { n: "11", name: "Integrations", meta: "40+ native", desc: "Slack, Gmail, Drive, Linear, Razorpay. Webhooks for the rest.", href: "/features/integrations", icon: IconIntegrations },
  { n: "12", name: "Access", meta: "RBAC · audit", desc: "Field-level RBAC. Every read/write audited. SSO/SAML on Scale+.", href: "/features/access", icon: IconAccess },
];

const howSteps = [
  { n: 1, color: "lime", step: "Import", title: "Bulk-import your team", desc: "Drop a CSV or sync from Google Workspace. Roles, reporting lines, and access permissions auto-populate.", time: "Takes ~3 minutes" },
  { n: 2, color: "pink", step: "Generate", title: "AI drafts your KRAs", desc: "For every role, AI drafts 5 KRAs, 14 KPIs, and a 90-day ramp plan. You approve.", time: "Takes ~10 minutes" },
  { n: 3, color: "blue", step: "Assign", title: "Connect SOPs & tasks", desc: "Pull in existing playbooks — or let AI extract SOPs from screen recordings. Assign to roles.", time: "Takes ~12 minutes" },
  { n: 4, color: "amber", step: "Run", title: "Go live & iterate", desc: "Your team gets Slack pings, managers get digests, scores update nightly. Tweak as you learn.", time: "Live forever" },
];

export default function FeaturesPage() {
  return (
    <>
      <HeroBlock />
      <PillarsBlock />
      <HowItWorksBlock />
      <ProductMockupBlock />
      <ModulesBlock />
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
            label="Features"
            title={<>Not a dashboard. <span className="hi">A system.</span></>}
            subtitle="Twelve modules, one shared data model. Change a KRA — the KPI updates. Update an SOP — the task list refreshes. Nothing is glued together with Zapier."
            aside={{
              label: "Shared spine",
              stat: "1",
              text: "A single canonical data model across every module. No sync lag.",
            }}
          />
        </Reveal>
      </div>
    </section>
  );
}

function PillarsBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal stagger className="pillars-grid">
          {pillars.map((p) => (
            <article key={p.label} id={p.id} className={`pl pl-${p.variant}`}>
              <div>
                <span className="bento-label">{p.label}</span>
                <h3 className="pl-title">{p.title}</h3>
                <p className="pl-body">{p.body}</p>
              </div>
              <ul className="pl-feats">
                {p.bullets.map((b) => (
                  <li key={b}>
                    <span className="c">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </Reveal>
      </div>

      <style>{`
        .pillars-grid {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;
        }
        .pl {
          border-radius: 28px; padding: 36px;
          display: flex; flex-direction: column; justify-content: space-between;
          min-height: 380px;
          transition: all 0.3s;
          position: relative; overflow: hidden;
          scroll-margin-top: 90px;
        }
        .pl:hover { transform: translateY(-4px); }
        .pl::before {
          content: ""; position: absolute; inset: 0;
          background-image: radial-gradient(circle at 1px 1px, rgba(0,0,0,0.08) 1px, transparent 0);
          background-size: 18px 18px; pointer-events: none; opacity: 0.35;
        }
        .pl > * { position: relative; }
        .pl-lime { background: var(--b-lime); color: var(--b-bg); }
        .pl-lime:hover { box-shadow: var(--b-shadow-lime); }
        .pl-dark {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          color: var(--b-fg);
        }
        .pl-dark:hover { border-color: var(--b-line-2); background: var(--b-card-2); }
        .pl-dark .bento-label { color: var(--b-lime); opacity: 1; }
        .pl-dark .pl-body { color: var(--b-t2); }
        .pl-dark .pl-feats { border-top-color: var(--b-line) !important; }
        .pl-title { font-size: 32px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.05; margin: 14px 0 12px; }
        .pl-body { font-size: 14.5px; line-height: 1.55; font-weight: 500; max-width: 420px; }
        .pl-feats {
          list-style: none; padding: 20px 0 0;
          border-top: 1px solid rgba(0,0,0,0.15);
          display: flex; flex-direction: column; gap: 8px;
          margin-top: 20px;
        }
        .pl-feats li { display: grid; grid-template-columns: 16px 1fr; gap: 8px; font-size: 13px; font-weight: 500; line-height: 1.4; }
        .pl-feats .c { font-weight: 700; }
        @media (max-width: 900px) { .pillars-grid { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}

function HowItWorksBlock() {
  const colorMap: Record<string, string> = {
    lime: "var(--b-lime)",
    pink: "var(--b-pink)",
    blue: "var(--b-blue)",
    amber: "var(--b-amber)",
  };
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="How it works"
            title={<>From signup to <span className="hi">live data</span> in thirty minutes.</>}
            subtitle="No implementation consultants. No six-week rollouts. Bulk-import your team and you're running live before lunch."
            aside={{
              label: "Time to live",
              stat: <>30<span style={{ fontSize: 40 }}>min</span></>,
              text: "Median first-useful-day across early-access teams.",
            }}
          />
        </Reveal>

        <Reveal stagger className="how-grid">
          {howSteps.map((s) => (
            <article key={s.n} className="how" style={{ ["--c" as string]: colorMap[s.color] } as React.CSSProperties}>
              <div className="how-step">
                <span className="how-step-num">{s.n}</span>
                {s.step}
              </div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              <div className="how-time">{s.time}</div>
            </article>
          ))}
        </Reveal>
      </div>

      <style>{`
        .how-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; }
        .how {
          grid-column: span 3;
          background: var(--b-card); border: 1px solid var(--b-line);
          border-radius: 20px;
          padding: 28px 24px 24px;
          min-height: 240px;
          display: flex; flex-direction: column;
          position: relative; overflow: hidden;
          transition: all 0.3s;
        }
        .how:hover { transform: translateY(-4px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .how-step {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-t3);
          text-transform: uppercase; letter-spacing: 0.14em;
          margin-bottom: 10px;
          display: flex; align-items: center; gap: 10px;
        }
        .how-step-num {
          width: 22px; height: 22px;
          border-radius: 6px;
          background: var(--c);
          color: var(--b-bg);
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700;
          font-family: var(--font-geist), sans-serif;
        }
        .how h3 { font-size: 22px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.1; margin: 10px 0; }
        .how p { font-size: 13px; color: var(--b-t2); line-height: 1.5; flex: 1; }
        .how-time {
          margin-top: 16px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--c);
          letter-spacing: 0.04em;
          display: flex; align-items: center; gap: 6px;
        }
        .how-time::before {
          content: ""; width: 5px; height: 5px;
          border-radius: 50%; background: currentColor;
          box-shadow: 0 0 6px currentColor;
        }
        @media (max-width: 900px) { .how { grid-column: span 6; } }
        @media (max-width: 560px) { .how { grid-column: span 12; min-height: auto; } }
      `}</style>
    </section>
  );
}

function ProductMockupBlock() {
  const rows = [
    { ini: "PS", name: "Priya Sharma", team: "head of sales · L5", score: "92", delta: "+4", up: true, w: 92, bg: "var(--b-lime)" },
    { ini: "AJ", name: "Amit Joshi", team: "account exec · L4", score: "87", delta: "+2", up: true, w: 87, bg: "var(--b-blue)" },
    { ini: "RK", name: "Ravi Kumar", team: "account exec · L4", score: "78", delta: "−5", up: false, w: 78, bg: "var(--b-t2)" },
    { ini: "NM", name: "Neha Mehta", team: "sdr · L3", score: "71", delta: "+1", up: true, w: 71, bg: "var(--b-amber)" },
    { ini: "SR", name: "Sanjay Rao", team: "sdr · L2", score: "45", delta: "−8", up: false, w: 45, bg: "var(--b-pink)" },
  ];
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <div className="product-card">
            <div className="prod-glow" aria-hidden />
            <div className="prod-intro">
              <Label>The product</Label>
              <h2 className="prod-intro-title">
                The system, <span className="hi">as it runs today.</span>
              </h2>
              <p className="prod-intro-sub">
                A real extract from the performance module of a 142-person
                operation across four Indian cities.
              </p>
            </div>

            <div className="prod-app">
              <div className="prod-chrome">
                <div className="prod-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
                <div className="prod-url">
                  app.workwrk.com / teams / sales / performance
                </div>
                <div style={{ width: 52 }} />
              </div>
              <div className="prod-body">
                <aside className="prod-side">
                  <div className="side-label">Workspace</div>
                  <div className="side-item">People<span className="sb">142</span></div>
                  <div className="side-item active">Performance<span className="sb">→</span></div>
                  <div className="side-item">Reviews<span className="sb">→</span></div>
                  <div className="side-item">SOPs<span className="sb">46</span></div>
                  <div className="side-item">AI Engine<span className="sb">✦</span></div>
                  <div className="side-label">Teams</div>
                  <div className="side-item">Sales</div>
                  <div className="side-item">Engineering</div>
                </aside>
                <div className="prod-main">
                  <div className="prod-head">
                    <div>
                      <div className="prod-title">
                        <span className="hi">Composite</span> performance · Sales
                      </div>
                      <div className="prod-meta">
                        6 weighted sources · auto-calc · 2m ago
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span className="prod-chip">Q1 2026</span>
                      <span className="prod-chip live">● Live</span>
                    </div>
                  </div>

                  <div className="prod-stats">
                    <div className="prod-stat">
                      <div className="prod-stat-label">Team median</div>
                      <div className="prod-stat-val">78<span className="u">/100</span></div>
                      <div className="prod-stat-del up">+4 vs Q4</div>
                    </div>
                    <div className="prod-stat">
                      <div className="prod-stat-label">Review completion</div>
                      <div className="prod-stat-val">94<span className="u">%</span></div>
                      <div className="prod-stat-del up">+22</div>
                    </div>
                    <div className="prod-stat">
                      <div className="prod-stat-label">Calibration σ</div>
                      <div className="prod-stat-val">0.3</div>
                      <div className="prod-stat-del up">In tolerance</div>
                    </div>
                  </div>

                  <div className="prod-table-head">
                    <div />
                    <div>Employee · role</div>
                    <div style={{ textAlign: "right" }}>Score</div>
                    <div style={{ textAlign: "right" }} className="hm">Δ</div>
                    <div className="hm">Progress</div>
                  </div>
                  {rows.map((r) => (
                    <div key={r.ini} className="prod-row">
                      <div className="prod-ava" style={{ background: r.bg }}>{r.ini}</div>
                      <div>
                        <div className="prod-name">{r.name}</div>
                        <div className="prod-team">{r.team}</div>
                      </div>
                      <div className="prod-score">{r.score}</div>
                      <div className={`prod-del hm ${r.up ? "up" : "down"}`}>{r.delta}</div>
                      <div className="prod-bar hm"><span style={{ width: `${r.w}%`, background: r.up ? "var(--b-lime)" : "var(--b-pink)" }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      <style>{`
        .product-card {
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 36px;
          padding: 20px 20px 0;
          overflow: hidden;
          position: relative;
        }
        .prod-glow {
          position: absolute;
          top: -100px; left: 50%;
          transform: translateX(-50%);
          width: 800px; height: 300px;
          background: radial-gradient(ellipse, rgba(212,255,46,0.14), transparent 60%);
          pointer-events: none;
        }
        .prod-intro { text-align: center; padding: 40px 24px 28px; position: relative; z-index: 1; }
        .prod-intro-title { font-size: clamp(36px, 5vw, 60px); font-weight: 600; letter-spacing: -0.035em; line-height: 1; margin: 14px 0 12px; }
        .prod-intro-title .hi { color: var(--b-lime); }
        .prod-intro-sub { font-size: 16px; color: var(--b-t2); max-width: 540px; margin: 0 auto; line-height: 1.55; }

        .prod-app {
          max-width: 1100px;
          margin: 0 auto;
          background: var(--b-bg);
          border: 1px solid var(--b-line-2);
          border-radius: 28px 28px 0 0;
          overflow: hidden;
          position: relative;
          z-index: 1;
          box-shadow: 0 -30px 80px -20px rgba(212,255,46,0.12);
        }
        .prod-chrome {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--b-line);
          background: var(--b-card);
        }
        .prod-dots { display: flex; gap: 5px; }
        .prod-dots span { width: 10px; height: 10px; border-radius: 50%; }
        .prod-dots span:nth-child(1) { background: #ff5e5b; }
        .prod-dots span:nth-child(2) { background: #ffba49; }
        .prod-dots span:nth-child(3) { background: var(--b-lime); }
        .prod-url {
          flex: 1;
          padding: 4px 10px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 6px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t3);
          max-width: 380px;
          margin: 0 auto;
          text-align: center;
        }
        .prod-url::before { content: "🔒 "; color: var(--b-lime); opacity: 0.7; font-size: 9px; }

        .prod-body { display: grid; grid-template-columns: 220px 1fr; min-height: 460px; }
        .prod-side { background: var(--b-card); border-right: 1px solid var(--b-line); padding: 16px 10px; }
        .side-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px;
          color: var(--b-t3);
          text-transform: uppercase;
          letter-spacing: 0.14em;
          padding: 6px 10px;
          margin-top: 8px;
        }
        .side-label:first-child { margin-top: 0; }
        .side-item {
          padding: 7px 10px;
          font-size: 12.5px;
          color: var(--b-t2);
          border-radius: 6px;
          display: flex; align-items: center; gap: 10px;
          transition: background 0.15s;
        }
        .side-item:hover { background: var(--b-card-2); }
        .side-item.active { background: var(--b-card-3); color: var(--b-fg); }
        .side-item .sb {
          margin-left: auto;
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px;
          color: var(--b-t3);
          font-variant-numeric: tabular-nums;
        }
        .side-item.active .sb { color: var(--b-lime); }

        .prod-main { padding: 22px 26px; }
        .prod-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--b-line); }
        .prod-title { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
        .prod-title .hi { color: var(--b-lime); }
        .prod-meta { font-family: var(--font-geist-mono), monospace; font-size: 10.5px; color: var(--b-t3); margin-top: 4px; }
        .prod-chip {
          padding: 4px 9px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
          border: 1px solid var(--b-line);
          border-radius: 5px;
          color: var(--b-t2);
          text-transform: uppercase;
        }
        .prod-chip.live { background: rgba(212,255,46,0.08); border-color: rgba(212,255,46,0.3); color: var(--b-lime); }

        .prod-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
        .prod-stat { padding: 14px 16px; background: var(--b-card); border: 1px solid var(--b-line); border-radius: 10px; transition: all 0.2s; }
        .prod-stat:hover { border-color: var(--b-line-2); transform: translateY(-2px); }
        .prod-stat-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px; color: var(--b-t3);
          text-transform: uppercase; letter-spacing: 0.12em;
          margin-bottom: 8px;
        }
        .prod-stat-val {
          font-size: 24px; font-weight: 600; letter-spacing: -0.03em; line-height: 1;
          display: flex; align-items: baseline; gap: 4px;
          font-variant-numeric: tabular-nums;
        }
        .prod-stat-val .u { font-size: 13px; color: var(--b-t3); font-weight: 400; }
        .prod-stat-del { font-family: var(--font-geist-mono), monospace; font-size: 10px; margin-top: 6px; }
        .prod-stat-del.up { color: var(--b-lime); }
        .prod-stat-del.down { color: var(--b-pink); }

        .prod-table-head, .prod-row {
          display: grid;
          grid-template-columns: 26px 1fr 50px 40px 100px;
          gap: 12px;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--b-line);
          font-size: 12.5px;
          transition: background 0.15s;
        }
        .prod-row:hover { background: var(--b-card); }
        .prod-table-head {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px; color: var(--b-t3);
          text-transform: uppercase; letter-spacing: 0.12em;
          border-bottom: 1px solid var(--b-line-2);
        }
        .prod-ava {
          width: 24px; height: 24px;
          border-radius: 6px;
          font-size: 10px; font-weight: 700;
          color: var(--b-bg);
          display: flex; align-items: center; justify-content: center;
        }
        .prod-name { font-size: 13px; font-weight: 500; }
        .prod-team { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: var(--b-t3); }
        .prod-score { font-family: var(--font-geist-mono), monospace; font-size: 18px; font-weight: 600; text-align: right; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
        .prod-del { font-family: var(--font-geist-mono), monospace; font-size: 10.5px; text-align: right; }
        .prod-del.up { color: var(--b-lime); }
        .prod-del.down { color: var(--b-pink); }
        .prod-bar { height: 3px; background: #2a2a2a; border-radius: 2px; position: relative; overflow: hidden; }
        .prod-bar span { position: absolute; inset: 0 auto 0 0; border-radius: 2px; animation: bentoFillIn 1.5s cubic-bezier(0.2,0.9,0.3,1) forwards; transform-origin: left; }

        @media (max-width: 820px) {
          .prod-body { grid-template-columns: 1fr; }
          .prod-side { display: none; }
          .prod-table-head, .prod-row { grid-template-columns: 26px 1fr 50px 50px; }
          .prod-row .hm, .prod-table-head .hm { display: none; }
          .prod-stats { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </section>
  );
}

function ModulesBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="All modules"
            title={<>Twelve modules. <span className="hi">One spine.</span></>}
            subtitle="Each module reads the same canonical data model. No syncing, no stitching, no lag."
            aside={{
              label: "Quarterly releases",
              stat: "4",
              text: "New capabilities ship every quarter. Each composable, each connected.",
            }}
          />
        </Reveal>

        <Reveal stagger className="mod-grid">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.name} href={m.href} className={`mod ${m.color ?? ""}`} aria-label={`${m.name} — ${m.desc}`}>
                <div className="mod-ico" aria-hidden>
                  <Icon />
                </div>
                <div>
                  <div className="mod-name">{m.name}</div>
                  <div className="mod-meta">{m.meta}</div>
                  <div className="mod-desc">{m.desc}</div>
                </div>
                <div className="mod-num">{m.n}</div>
              </Link>
            );
          })}
        </Reveal>
      </div>

      <style>{`
        .mod-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .mod {
          min-height: 220px;
          border-radius: 20px;
          padding: 22px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          display: flex; flex-direction: column; justify-content: space-between;
          transition: all 0.25s cubic-bezier(0.2,0.9,0.3,1);
          position: relative; overflow: hidden;
          text-decoration: none;
          color: inherit;
        }
        .mod:hover {
          transform: translateY(-3px);
          background: var(--b-card-2);
          border-color: var(--b-line-2);
        }
        .mod-ico {
          width: 36px; height: 36px;
          border-radius: 8px;
          background: var(--b-card-3);
          border: 1px solid var(--b-line);
          display: flex; align-items: center; justify-content: center;
          color: var(--b-t2);
          transition: all 0.25s cubic-bezier(0.2,0.9,0.3,1);
        }
        .mod:hover .mod-ico { border-color: var(--b-line-2); color: var(--b-fg); transform: scale(1.05); }
        .mod.hi { background: var(--b-lime); color: var(--b-bg); border-color: var(--b-lime); }
        .mod.hi:hover { box-shadow: var(--b-shadow-lime); }
        .mod.hi .mod-ico { background: var(--b-bg); border-color: var(--b-bg); color: var(--b-lime); }
        .mod.pk { background: var(--b-pink); color: var(--b-bg); border-color: var(--b-pink); }
        .mod.pk:hover { box-shadow: var(--b-shadow-pink); }
        .mod.pk .mod-ico { background: var(--b-bg); border-color: var(--b-bg); color: var(--b-pink); }
        .mod.bl { background: var(--b-blue); color: var(--b-bg); border-color: var(--b-blue); }
        .mod.bl:hover { box-shadow: var(--b-shadow-blue); }
        .mod.bl .mod-ico { background: var(--b-bg); border-color: var(--b-bg); color: var(--b-blue); }
        .mod.am { background: var(--b-amber); color: var(--b-bg); border-color: var(--b-amber); }
        .mod.am:hover { box-shadow: var(--b-shadow-amber); }
        .mod.am .mod-ico { background: var(--b-bg); border-color: var(--b-bg); color: var(--b-amber); }
        .mod-name { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; }
        .mod-meta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-t3);
          text-transform: uppercase; letter-spacing: 0.08em;
          margin-top: 3px; margin-bottom: 8px;
        }
        .mod.hi .mod-meta, .mod.pk .mod-meta, .mod.bl .mod-meta, .mod.am .mod-meta {
          color: rgba(0,0,0,0.55);
        }
        .mod-desc {
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--b-t2);
        }
        .mod.hi .mod-desc, .mod.pk .mod-desc, .mod.bl .mod-desc, .mod.am .mod-desc {
          color: rgba(0,0,0,0.75);
        }
        .mod-num {
          position: absolute; top: 18px; right: 18px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-t3);
          letter-spacing: 0.04em;
        }
        .mod.hi .mod-num, .mod.pk .mod-num, .mod.bl .mod-num, .mod.am .mod-num {
          color: rgba(0,0,0,0.55);
        }
        @media (max-width: 900px) { .mod-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 560px) { .mod-grid { grid-template-columns: 1fr; } }
      `}</style>
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
                fontWeight: 700,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                marginBottom: 20,
              }}
            >
              See the <span style={{ color: "var(--b-lime)" }}>whole system</span>
              <br />
              in thirty minutes.
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
              Live product walkthrough. No slides. Your data by the end of the call.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/signup" className="bento-btn bento-btn-lime bento-btn-lg">
                Start free trial →
              </Link>
              <Link href="/pricing" className="bento-btn bento-btn-ghost bento-btn-lg">
                See pricing
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
