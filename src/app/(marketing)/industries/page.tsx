import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Industries — WorkwrK | For sales, ops, finance, healthcare, and more",
  description:
    "WorkwrK works across sales teams, logistics, finance, healthcare, real estate, professional services, manufacturing, and education — any team that scales past 25 people.",
  alternates: { canonical: "https://workwrk.com/industries" },
};

const industries = [
  {
    variant: "lime" as const,
    name: "Sales & Revenue",
    tag: "Pipeline · quota · commission",
    body: "Track pipeline KPIs per rep, tie commission to composite scores, 360° review cycles across sales manager, peer, and self.",
    metrics: "+22% quota attainment · 48h review cycle",
    href: "/industries/sales",
  },
  {
    variant: null,
    name: "Logistics & Warehousing",
    tag: "SOPs · compliance · drift",
    body: "Versioned SOPs across warehouses. Nightly compliance checks. Drift flagged before it becomes incident reports.",
    metrics: "95% SOP compliance · 12 locations aligned",
    href: "/industries/logistics",
  },
  {
    variant: null,
    name: "Finance & Accounting",
    tag: "Close · audit · controls",
    body: "Monthly close as a versioned SOP. Task escalation on SLA. Review cycles tied to audit calendar.",
    metrics: "Close time −40% · audit-ready by default",
    href: "/industries",
  },
  {
    variant: null,
    name: "Healthcare",
    tag: "Protocol compliance · training",
    body: "Protocol SOPs per role. Compliance tracked per shift. Training playbooks attached to roles at onboarding.",
    metrics: "Training time −50% · zero-drift protocols",
    href: "/industries/healthcare",
  },
  {
    variant: null,
    name: "Real Estate",
    tag: "Multi-site · agent scoring",
    body: "Per-project teams. Agent KPIs tied to conversion. Composite scores calibrated per city.",
    metrics: "Agent productivity +18% · fairer comp",
    href: "/industries/real-estate",
  },
  {
    variant: "blue" as const,
    name: "Professional Services",
    tag: "Utilisation · client NPS",
    body: "Consultant KPIs across utilisation and client NPS. Review cycles across delivery, peer, and client feedback.",
    metrics: "Utilisation +12% · NPS-linked bonuses",
    href: "/industries/services",
  },
  {
    variant: "amber" as const,
    name: "Manufacturing",
    tag: "SOP · shift compliance",
    body: "Shift-level SOPs. Floor-supervisor kudos feed into recognition. KPIs across safety, throughput, quality.",
    metrics: "Safety incidents −30% · throughput +8%",
    href: "/industries/manufacturing",
  },
  {
    variant: null,
    name: "Education",
    tag: "Faculty reviews · outcomes",
    body: "Faculty performance tied to student outcomes. Peer reviews across departments. Quarterly cycles instead of yearly.",
    metrics: "Quarterly cycles · department calibration",
    href: "/industries",
  },
  {
    variant: "pink" as const,
    name: "Technology & SaaS",
    tag: "Engineering · product · AI-native",
    body: "Engineering KRAs tied to PR throughput, review depth, incident response. Product KPIs across activation, retention, expansion.",
    metrics: "On-call burden −20% · review depth tracked",
    href: "/industries/technology",
  },
];

export default function IndustriesPage() {
  return (
    <>
      <HeroBlock />
      <GridBlock />
      <StoryBlock />
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
            label="Industries"
            title={
              <>
                Wherever teams <span className="hi">scale past 25.</span>
              </>
            }
            subtitle="WorkwrK is a horizontal operating system — the same spine works across very different businesses. Here's how it shows up in the ones we see most."
            aside={{
              label: "Across",
              stat: "12+",
              text: "Verticals running on workwrk in production today. One data model, many contexts.",
            }}
          />
        </Reveal>
      </div>
    </section>
  );
}

function GridBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal stagger className="ind-grid">
          {industries.map((i) => (
            <Link
              key={i.name}
              href={i.href}
              className={`ind ${i.variant ? `ind-${i.variant}` : ""}`}
              aria-label={`${i.name} — ${i.body}`}
            >
              <div>
                <span className="bento-label">{i.tag}</span>
                <h3 className="ind-name">{i.name}</h3>
                <p className="ind-body">{i.body}</p>
              </div>
              <div className="ind-metrics">{i.metrics}</div>
            </Link>
          ))}
        </Reveal>
      </div>

      <style>{`
        .ind-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
        }
        .ind {
          background: var(--b-card); border: 1px solid var(--b-line); color: var(--b-fg);
          border-radius: 24px; padding: 30px 28px;
          min-height: 300px;
          display: flex; flex-direction: column; justify-content: space-between;
          transition: all 0.3s;
          position: relative; overflow: hidden;
          text-decoration: none;
        }
        .ind:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .ind-lime { background: var(--b-lime); color: var(--b-bg); border-color: var(--b-lime); }
        .ind-lime:hover { box-shadow: var(--b-shadow-lime); background: var(--b-lime); }
        .ind-pink { background: var(--b-pink); color: var(--b-bg); border-color: var(--b-pink); }
        .ind-pink:hover { box-shadow: var(--b-shadow-pink); background: var(--b-pink); }
        .ind-blue { background: var(--b-blue); color: var(--b-bg); border-color: var(--b-blue); }
        .ind-blue:hover { box-shadow: var(--b-shadow-blue); background: var(--b-blue); }
        .ind-amber { background: var(--b-amber); color: var(--b-bg); border-color: var(--b-amber); }
        .ind-amber:hover { box-shadow: var(--b-shadow-amber); background: var(--b-amber); }
        .ind-name { font-size: 24px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.05; margin: 12px 0 10px; }
        .ind-body { font-size: 13.5px; line-height: 1.55; max-width: 320px; }
        .ind:not([class*="ind-"]) .ind-body,
        .ind:not(.ind-lime):not(.ind-pink):not(.ind-blue):not(.ind-amber) .ind-body { color: var(--b-t2); }
        .ind-metrics {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid rgba(0,0,0,0.12);
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.02em;
          font-weight: 500;
          opacity: 0.85;
        }
        .ind:not(.ind-lime):not(.ind-pink):not(.ind-blue):not(.ind-amber) .ind-metrics {
          border-top-color: var(--b-line);
          color: var(--b-lime);
          opacity: 1;
        }
        @media (max-width: 900px) { .ind-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 560px) { .ind-grid { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}

function StoryBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <article
            style={{
              background: "var(--b-lime)",
              color: "var(--b-bg)",
              borderRadius: 36,
              padding: "48px 44px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute", inset: 0,
                backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.08) 1px, transparent 0)",
                backgroundSize: "18px 18px", opacity: 0.35, pointerEvents: "none",
              }}
            />
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 40, alignItems: "center" }}>
              <div>
                <span className="bento-label" style={{ opacity: 0.75 }}>Case · LogiFleet</span>
                <h2
                  style={{
                    fontSize: "clamp(28px, 4vw, 44px)",
                    fontWeight: 600,
                    letterSpacing: "-0.025em",
                    lineHeight: 1.1,
                    margin: "14px 0 16px",
                  }}
                >
                  &ldquo;SOP compliance went from drift to 95% — across all twelve warehouses.&rdquo;
                </h2>
                <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, maxWidth: 560 }}>
                  Ravi Krishnan, COO at LogiFleet, replaced a patchwork of Google Sheets and a long-dead SharePoint with versioned SOPs, nightly compliance audits, and site-level scorecards. Shift managers now see the same numbers the head office does.
                </p>
              </div>
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, display: "flex", flexDirection: "column", gap: 10 }}>
                <div><strong style={{ fontSize: 32, display: "block", letterSpacing: "-0.04em" }}>95%</strong> compliance</div>
                <div><strong style={{ fontSize: 32, display: "block", letterSpacing: "-0.04em" }}>12</strong> locations</div>
                <div><strong style={{ fontSize: 32, display: "block", letterSpacing: "-0.04em" }}>48h</strong> review cycle</div>
              </div>
            </div>
          </article>
        </Reveal>
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
              padding: "56px 40px",
              textAlign: "center",
            }}
          >
            <h2
              style={{
                fontSize: "clamp(36px, 5vw, 60px)",
                fontWeight: 700,
                letterSpacing: "-0.035em",
                lineHeight: 1,
                marginBottom: 16,
              }}
            >
              Don&apos;t see <span style={{ color: "var(--b-lime)" }}>your industry?</span>
            </h2>
            <p style={{ color: "var(--b-t2)", maxWidth: 520, margin: "0 auto 24px" }}>
              The spine is horizontal — we&apos;ve probably worked with someone who looks like you. Email the founder with a two-line pitch.
            </p>
            <Link href="mailto:hi@workwrk.com" className="bento-btn bento-btn-lime bento-btn-lg">
              Talk to founder →
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
