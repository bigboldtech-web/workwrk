"use client";

import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";

const stories = [
  {
    industry: "Logistics",
    customer: "LogiFleet",
    size: "430 people · 12 warehouses",
    outcome: {
      stat: "95%",
      label: "SOP compliance, measured nightly",
    },
    quote:
      "Every warehouse runs the same playbook. Every shift. We stopped finding drift after it caused an incident — we find it before.",
    who: "Ravi K. · Head of Operations",
    accent: "lime" as const,
  },
  {
    industry: "Finance",
    customer: "FinEdge",
    size: "180 people · 4 cities",
    outcome: {
      stat: "-40%",
      label: "monthly close time · audit-ready",
    },
    quote:
      "The close is a versioned SOP now. Tasks escalate automatically. Our auditor got every artefact she needed on day one.",
    who: "Priya S. · Controller",
    accent: "blue" as const,
  },
  {
    industry: "SaaS",
    customer: "ScaleOps",
    size: "95 people · remote",
    outcome: {
      stat: "2d",
      label: "review cycles · up from 2 weeks",
    },
    quote:
      "Reviews show up pre-filled. Managers stopped guessing. Our calibration meeting is a 30-minute conversation instead of a day.",
    who: "Arjun M. · VP Engineering",
    accent: "pink" as const,
  },
];

export function SceneIndustries() {
  return (
    <Scene id="industries">
      <Reveal>
        <div className="scene-kicker">Proof · named customers · real numbers</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          It works where <span className="hi">operations are complicated.</span>
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub">
          Three teams, three industries, three kinds of pain. Same spine underneath — one
          composite score, one SOP library, one place to look.
        </p>
      </Reveal>

      <div className="ind-stack">
        {stories.map((s) => (
          <Reveal key={s.customer}>
            <article className={`ind-card ind-${s.accent}`}>
              <div className="ind-card-left">
                <span className="ind-kicker">{s.industry}</span>
                <h3 className="ind-customer">{s.customer}</h3>
                <span className="ind-size">{s.size}</span>
              </div>
              <div className="ind-card-mid">
                <blockquote className="ind-quote">&ldquo;{s.quote}&rdquo;</blockquote>
                <cite className="ind-who">{s.who}</cite>
              </div>
              <div className="ind-card-right">
                <span className="ind-stat">{s.outcome.stat}</span>
                <span className="ind-stat-label">{s.outcome.label}</span>
              </div>
            </article>
          </Reveal>
        ))}
      </div>

      <style jsx>{`
        .ind-stack {
          margin-top: 56px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ind-card {
          display: grid;
          grid-template-columns: 1fr 2fr 1fr;
          gap: 32px;
          padding: 32px 36px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          align-items: center;
          transition: transform 0.3s, border-color 0.3s, box-shadow 0.3s;
        }
        .ind-card:hover {
          transform: translateY(-3px);
          border-color: var(--b-line-2);
        }
        .ind-card-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ind-kicker {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: var(--b-t2);
        }
        .ind-customer {
          font-size: 30px;
          font-weight: 600;
          letter-spacing: -0.02em;
          margin: 4px 0;
          line-height: 1.15;
        }
        .ind-size {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          color: var(--b-t2);
          letter-spacing: 0.03em;
        }
        .ind-quote {
          font-size: 22px;
          line-height: 1.5;
          color: var(--b-fg-off);
          margin: 0 0 16px;
          font-style: italic;
          letter-spacing: -0.01em;
        }
        .ind-who {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          color: var(--b-t2);
          letter-spacing: 0.04em;
          font-style: normal;
        }
        .ind-card-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }
        .ind-stat {
          font-family: var(--font-geist), sans-serif;
          font-size: 72px;
          line-height: 1;
          font-weight: 700;
          letter-spacing: -0.04em;
          font-variant-numeric: tabular-nums;
          color: var(--b-lime);
        }
        .ind-blue .ind-stat { color: var(--b-blue); }
        .ind-pink .ind-stat { color: var(--b-pink); }
        .ind-stat-label {
          font-size: 14px;
          color: var(--b-t2);
          margin-top: 10px;
          max-width: 22ch;
          line-height: 1.45;
        }
        @media (max-width: 900px) {
          .ind-card {
            grid-template-columns: 1fr;
            gap: 18px;
          }
          .ind-card-right {
            align-items: flex-start;
            text-align: left;
          }
        }
      `}</style>
    </Scene>
  );
}
