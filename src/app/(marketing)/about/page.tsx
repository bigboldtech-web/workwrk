import type { Metadata } from "next";
import Link from "next/link";

import { Reveal, SectionHeader, CountUp } from "@/components/bento";

export const metadata: Metadata = {
  title: "About WorkwrK — The operating system for teams that mean business",
  description:
    "WorkwrK is a business operating system built for Indian SMBs. People, performance, KPIs, SOPs, and AI — in one system. Built by operators, not consultants.",
  alternates: { canonical: "https://workwrk.com/about" },
};

const values = [
  {
    variant: "lime" as const,
    title: "Operators built this, not consultants.",
    body:
      "Every module was battle-tested inside a real hundred-person operation before it shipped. If it didn't survive our own team, it didn't ship.",
  },
  {
    variant: "dark" as const,
    title: "Data over vibes.",
    body:
      "Composite scores exist so promotions stop being arguments. Forty-eight-hour review cycles exist because two-week reviews are theatre.",
  },
  {
    variant: "dark" as const,
    title: "Global pricing, local invoicing.",
    body:
      "INR, USD, AED, SGD, EUR — priced in your currency with compliant local invoicing. GST, VAT, and reverse-charge handled.",
  },
  {
    variant: "dark" as const,
    title: "Private by default.",
    body:
      "Your data never trains anyone's model. Region-locked storage. Field-level RBAC, audit logs for every read and write. SOC-2 Type II in progress.",
  },
];

const milestones = [
  { year: "2024", title: "Founded", desc: "Built inside BigBoldTech while running a 100-person operation. Stopped stitching SaaS and started building." },
  { year: "2025", title: "First 100 customers", desc: "Landed across sales, logistics, finance, and healthcare. Average onboarding: 34 minutes." },
  { year: "2026", title: "AI Engine shipped", desc: "Claude-powered reasoning layer across KRAs, SOPs, and reviews. Shipping to early-access customers." },
  { year: "2027", title: "Scale to 5,000+", desc: "On-prem deployment, SOC-2 Type II, and regional expansion across APAC." },
];

export default function AboutPage() {
  return (
    <>
      <HeroBlock />
      <ValuesBlock />
      <NumbersBlock />
      <MilestonesBlock />
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
            label="About"
            title={
              <>
                We built this because <span className="hi">we needed it.</span>
              </>
            }
            subtitle="WorkwrK is a business operating system built by operators running a hundred-person company — not consultants drawing org charts on whiteboards. We sell to growing businesses across India, the GCC, South-East Asia and Europe."
            aside={{
              label: "Built in",
              stat: "Bengaluru",
              text: "Shipping from India for growing businesses globally.",
            }}
          />
        </Reveal>
      </div>
    </section>
  );
}

function ValuesBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="What we believe"
            title={<>Four principles, <span className="hi">no slogans.</span></>}
            subtitle="We ran a business before building software for businesses. These are the convictions that survive."
          />
        </Reveal>

        <Reveal stagger className="vals-grid">
          {values.map((v) => (
            <article key={v.title} className={`vl vl-${v.variant}`}>
              <h3 className="vl-title">{v.title}</h3>
              <p className="vl-body">{v.body}</p>
            </article>
          ))}
        </Reveal>
      </div>

      <style>{`
        .vals-grid {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;
        }
        .vl {
          border-radius: 28px; padding: 36px;
          min-height: 240px;
          display: flex; flex-direction: column; justify-content: space-between;
          transition: all 0.3s;
          position: relative; overflow: hidden;
        }
        .vl:hover { transform: translateY(-4px); }
        .vl::before {
          content: ""; position: absolute; inset: 0;
          background-image: radial-gradient(circle at 1px 1px, rgba(0,0,0,0.08) 1px, transparent 0);
          background-size: 18px 18px; pointer-events: none; opacity: 0.35;
        }
        .vl > * { position: relative; }
        .vl-lime { background: var(--b-lime); color: var(--b-bg); }
        .vl-lime:hover { box-shadow: var(--b-shadow-lime); }
        .vl-dark {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          color: var(--b-fg);
        }
        .vl-dark:hover { border-color: var(--b-line-2); background: var(--b-card-2); }
        .vl-dark .vl-body { color: var(--b-t2); }
        .vl-title { font-size: 28px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 14px; }
        .vl-body { font-size: 14.5px; line-height: 1.55; font-weight: 500; max-width: 420px; }
        @media (max-width: 900px) { .vals-grid { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}

function NumbersBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="By the numbers"
            title={<>Small team. <span className="hi">Serious miles.</span></>}
            subtitle="We keep it tight. Engineering-heavy, consultant-free."
          />
        </Reveal>
        <Reveal stagger className="nums-grid">
          <div className="nc nc-lime">
            <div className="nc-val"><CountUp to={500} suffix="+" /></div>
            <div className="nc-label">Teams running on workwrk</div>
          </div>
          <div className="nc">
            <div className="nc-val"><CountUp to={15} suffix="k+" /></div>
            <div className="nc-label">Employees managed</div>
          </div>
          <div className="nc">
            <div className="nc-val"><CountUp to={40} suffix="+" /></div>
            <div className="nc-label">Native integrations</div>
          </div>
          <div className="nc">
            <div className="nc-val"><CountUp to={34} suffix=" min" /></div>
            <div className="nc-label">Median time to first useful day</div>
          </div>
        </Reveal>
      </div>

      <style>{`
        .nums-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
        }
        .nc {
          background: var(--b-card); border: 1px solid var(--b-line);
          border-radius: 20px; padding: 28px;
          min-height: 160px;
          display: flex; flex-direction: column; justify-content: center;
          transition: all 0.3s;
          color: var(--b-fg);
          position: relative; overflow: hidden;
        }
        .nc:hover { transform: translateY(-3px); border-color: var(--b-line-2); }
        .nc-lime { background: var(--b-lime); color: var(--b-bg); border-color: var(--b-lime); }
        .nc-lime:hover { box-shadow: var(--b-shadow-lime); }
        .nc-val { font-size: 52px; font-weight: 600; letter-spacing: -0.045em; line-height: 1; margin-bottom: 10px; font-variant-numeric: tabular-nums; }
        .nc-label { font-family: var(--font-geist-mono), monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.7; }
        @media (max-width: 900px) { .nums-grid { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </section>
  );
}

function MilestonesBlock() {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="Timeline"
            title={<>The <span className="hi">short version.</span></>}
            subtitle="Where we've been, where we're headed."
          />
        </Reveal>
        <Reveal stagger className="ms-grid">
          {milestones.map((m, i) => {
            const isCurrent = i === 2; // 2026
            return (
              <article key={m.year} className="ms">
                <div className="ms-year">{m.year}</div>
                <div
                  className="ms-dot"
                  style={{
                    background: isCurrent ? "var(--b-lime)" : "var(--b-t4)",
                    boxShadow: isCurrent ? "0 0 10px var(--b-lime)" : "none",
                  }}
                />
                <h3 className="ms-title">{m.title}</h3>
                <p className="ms-desc">{m.desc}</p>
              </article>
            );
          })}
        </Reveal>
      </div>

      <style>{`
        .ms-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
        .ms {
          background: var(--b-card); border: 1px solid var(--b-line);
          border-radius: 20px; padding: 24px;
          min-height: 200px;
          display: flex; flex-direction: column;
          transition: all 0.3s;
          position: relative; overflow: hidden;
        }
        .ms:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .ms-year { font-family: var(--font-geist-mono), monospace; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--b-t3); margin-bottom: 8px; }
        .ms-dot { width: 8px; height: 8px; border-radius: 50%; margin-bottom: 14px; box-shadow: 0 0 10px currentColor; }
        .ms-title { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; margin-bottom: 8px; }
        .ms-desc { font-size: 13px; color: var(--b-t2); line-height: 1.55; }
        @media (max-width: 900px) { .ms-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 560px) { .ms-grid { grid-template-columns: 1fr; } }
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
                fontSize: "clamp(36px, 5vw, 60px)",
                fontWeight: 600,
                letterSpacing: "-0.035em",
                lineHeight: 1,
                marginBottom: 16,
                color: "var(--b-fg)",
              }}
            >
              Want to talk?
            </h2>
            <p
              style={{
                fontSize: 16,
                maxWidth: 520,
                margin: "0 auto 28px",
                lineHeight: 1.55,
                color: "var(--b-t2)",
              }}
            >
              The founder reads every email. If you&apos;re scaling past fifty people, it&apos;s worth the ten minutes.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="mailto:hi@workwrk.com" className="bento-btn bento-btn-lime bento-btn-lg">
                hi@workwrk.com →
              </Link>
              <Link href="/signup" className="bento-btn bento-btn-ghost bento-btn-lg">
                Start free trial
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
