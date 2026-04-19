"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Scene } from "../scene";
import { BigNumber } from "../big-number";

const aiResponse = [
  "Three people I'd watch this week:",
  "Priya S. — kudos down 70%, no 1:1 in 37 days",
  "Ravi K. — SOP compliance 61% vs. team avg 88%",
  "Kavita R. — KPI trend −18% QoQ, no promo since 2024",
];

const outcomes = [
  { num: 500, suffix: "+", label: "teams running on workwrk" },
  { num: 48, suffix: "h", label: "review cycle, start to finish" },
  { num: 95, suffix: "%", label: "SOP compliance across teams" },
  { num: 15, suffix: "", label: "tools replaced, on average" },
];

export function SceneOpening() {
  const titleRef = useRef<HTMLDivElement>(null);
  const [aiLines, setAiLines] = useState(0);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      let i = 0;
      const iv = window.setInterval(() => {
        i += 1;
        setAiLines(i);
        if (i >= aiResponse.length) window.clearInterval(iv);
      }, 600);
    }, 1200);
    return () => window.clearTimeout(start);
  }, []);

  return (
    <Scene id="home" compact className="scene-opening">
      <div className="opening-grid" ref={titleRef}>
        <div className="opening-left">
          <div className="op-kicker">
            <span className="op-kicker-dot" />
            The Business Operating System
          </div>
          <h1 className="op-headline">
            If you run a business,
            <br />
            <span className="hi">you need this.</span>
          </h1>
          <p className="op-sub">
            The operating system for everything your company actually does — people,
            performance, KPIs, SOPs, reviews, and AI. Skip the fifteen-tool chaos. Start
            running your business on one system that tells you the truth.
          </p>
          <div className="opening-cta">
            <Link href="/signup" className="bento-btn bento-btn-lime bento-btn-lg">
              Start free · 14 days <span className="arr">→</span>
            </Link>
            <Link href="#score" className="bento-btn bento-btn-ghost bento-btn-lg">
              ▸ See the product
            </Link>
          </div>
          <div className="opening-trust">
            <span className="opening-stars">★★★★★</span>
            <span>4.8 on G2</span>
            <span className="sep">·</span>
            <span>No credit card</span>
            <span className="sep">·</span>
            <span>30-min setup</span>
            <span className="sep">·</span>
            <span>500+ teams</span>
          </div>
        </div>

        <aside className="opening-stage" aria-label="Live product preview">
          {/* AI conversation — primary card */}
          <div className="op-card op-card-ai">
            <div className="op-card-head">
              <span className="op-live-dot" />
              <span className="op-card-label">AI · this week</span>
            </div>
            <div className="op-ai-q">Who&apos;s at risk of leaving this quarter?</div>
            <ol className="op-ai-a">
              {aiResponse.map((line, i) => (
                <li
                  key={i}
                  className={`op-ai-line${i < aiLines ? " is-in" : ""}`}
                  style={{
                    transitionDelay: `${i * 60}ms`,
                    ["--accent" as string]:
                      i === 0 ? "var(--b-lime)" : "var(--b-pink)",
                  }}
                >
                  {i === 0 ? (
                    <span className="op-ai-intro">{line}</span>
                  ) : (
                    <>
                      <span className="op-ai-bullet" />
                      <span>{line}</span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Composite score — secondary, floating back */}
          <div className="op-card op-card-score">
            <div className="op-score-tag">Composite score · Priya S.</div>
            <div className="op-score-num">92.1</div>
            <div className="op-score-bars">
              <span className="op-score-bar" style={{ ["--w" as string]: "94%" }}>
                <b>94%</b> KPI
              </span>
              <span className="op-score-bar" style={{ ["--w" as string]: "96%" }}>
                <b>96%</b> SOP
              </span>
              <span className="op-score-bar" style={{ ["--w" as string]: "86%" }}>
                <b>4.7</b> Peer
              </span>
            </div>
          </div>

          {/* Ticker — small floating card front */}
          <div className="op-card op-card-ticker">
            <div className="op-ticker-head">
              <span className="op-ticker-dot" />
              <span>Live activity</span>
            </div>
            <div className="op-ticker-row">
              <strong>Arjun</strong> → <strong>Priya</strong> · kudos
              <span className="op-ticker-tag">Customer Obsession</span>
            </div>
            <div className="op-ticker-row">
              SOP drift flagged · <strong>Warehouse&nbsp;3</strong>
              <span className="op-ticker-tag op-tag-pink">Action</span>
            </div>
          </div>
        </aside>
      </div>

      <div className="opening-outcomes">
        {outcomes.map((o) => (
          <div key={o.label} className="op-outcome">
            <span className="op-outcome-num">
              <BigNumber to={o.num} suffix={o.suffix} duration={1400} />
            </span>
            <span className="op-outcome-label">{o.label}</span>
          </div>
        ))}
      </div>

      <style jsx>{`
        .opening-grid {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
          gap: 48px;
          align-items: center;
          padding: 56px 48px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          overflow: hidden;
          isolation: isolate;
        }
        .opening-grid::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(
            720px circle at var(--mx, 15%) var(--my, 35%),
            rgba(212, 255, 46, 0.08),
            transparent 45%
          );
          z-index: 0;
        }
        .opening-grid > * {
          position: relative;
          z-index: 1;
        }
        .opening-left {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 0;
        }
        .op-kicker {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--b-t2);
          padding: 8px 14px;
          background: var(--b-card-3);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          align-self: flex-start;
          margin-bottom: 28px;
        }
        .op-kicker-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--b-lime);
          box-shadow: 0 0 10px var(--b-lime);
        }
        .op-headline {
          font-size: clamp(40px, 4.4vw, 72px);
          line-height: 1.05;
          letter-spacing: -0.04em;
          font-weight: 600;
          color: var(--b-fg);
          margin: 0;
          max-width: 14ch;
        }
        .op-headline .hi {
          color: var(--b-lime);
        }
        .op-sub {
          font-size: 18px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 24px 0 0;
          max-width: 54ch;
        }
        .opening-cta {
          display: flex;
          gap: 12px;
          margin-top: 36px;
          flex-wrap: wrap;
        }
        .opening-trust {
          margin-top: 24px;
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          font-size: 13px;
          color: var(--b-t2);
          font-family: var(--font-geist-mono), monospace;
          font-variant-numeric: tabular-nums;
        }
        .opening-stars {
          color: var(--b-lime);
          letter-spacing: 0.05em;
        }
        .sep {
          color: var(--b-t4);
        }

        /* ===== Stage (right side with stacked cards) ===== */
        .opening-stage {
          position: relative;
          min-height: 480px;
        }
        .op-card {
          position: absolute;
          background: var(--b-card-2);
          border: 1px solid var(--b-line-2);
          border-radius: 20px;
          box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.7),
            0 0 0 1px rgba(255, 255, 255, 0.02) inset;
          backdrop-filter: blur(10px);
          transition: transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1);
        }

        /* AI card — primary, center-right */
        .op-card-ai {
          top: 20px;
          right: 0;
          width: 92%;
          padding: 22px 24px;
          z-index: 3;
          background: var(--b-card);
        }
        .op-card-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
        }
        .op-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--b-lime);
          box-shadow: 0 0 10px var(--b-lime);
          animation: bentoPulse 1.6s ease-in-out infinite;
        }
        .op-card-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--b-lime);
        }
        .op-ai-q {
          font-size: 20px;
          font-weight: 600;
          color: var(--b-fg);
          letter-spacing: -0.02em;
          margin-bottom: 14px;
          line-height: 1.3;
        }
        .op-ai-a {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .op-ai-line {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 13.5px;
          line-height: 1.5;
          color: var(--b-fg-off);
          opacity: 0;
          transform: translateY(4px);
          transition:
            opacity 0.5s cubic-bezier(0.2, 0.9, 0.3, 1),
            transform 0.5s cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        .op-ai-line.is-in {
          opacity: 1;
          transform: translateY(0);
        }
        .op-ai-intro {
          color: var(--b-t2);
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          letter-spacing: 0.04em;
        }
        .op-ai-bullet {
          flex-shrink: 0;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--accent, var(--b-pink));
          margin-top: 8px;
        }

        /* Score card — floats back-left */
        .op-card-score {
          bottom: 14px;
          left: 0;
          width: 46%;
          padding: 20px 22px;
          transform: rotate(-2deg);
          z-index: 2;
        }
        .op-card-score:hover {
          transform: rotate(-2deg) translateY(-4px);
        }
        .op-score-tag {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--b-t3);
          margin-bottom: 6px;
        }
        .op-score-num {
          font-family: var(--font-geist), sans-serif;
          font-size: 52px;
          line-height: 1;
          font-weight: 700;
          letter-spacing: -0.04em;
          color: var(--b-lime);
          font-variant-numeric: tabular-nums;
          text-shadow: 0 0 30px rgba(212, 255, 46, 0.25);
        }
        .op-score-bars {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 14px;
        }
        .op-score-bar {
          position: relative;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t2);
          padding: 5px 10px;
          background: var(--b-card-3);
          border-radius: 6px;
          letter-spacing: 0.02em;
          overflow: hidden;
        }
        .op-score-bar b {
          color: var(--b-lime);
          margin-right: 6px;
          font-family: inherit;
        }
        .op-score-bar::before {
          content: "";
          position: absolute;
          inset: 0;
          width: var(--w);
          background: linear-gradient(
            90deg,
            rgba(212, 255, 46, 0.14),
            rgba(212, 255, 46, 0.02)
          );
          z-index: 0;
          transform-origin: left;
          animation: bentoFillIn 1.2s cubic-bezier(0.2, 0.9, 0.3, 1) 0.4s backwards;
        }
        .op-score-bar > * {
          position: relative;
          z-index: 1;
        }

        /* Ticker card — floats front-right */
        .op-card-ticker {
          bottom: 30px;
          right: -20px;
          width: 54%;
          padding: 16px 18px;
          transform: rotate(2deg);
          z-index: 4;
        }
        .op-card-ticker:hover {
          transform: rotate(2deg) translateY(-4px);
        }
        .op-ticker-head {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--b-t3);
          margin-bottom: 12px;
        }
        .op-ticker-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--b-lime);
          box-shadow: 0 0 8px var(--b-lime);
        }
        .op-ticker-row {
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--b-fg-off);
          padding: 8px 0;
          border-bottom: 1px solid var(--b-line);
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .op-ticker-row:last-child {
          border-bottom: 0;
        }
        .op-ticker-row strong {
          color: var(--b-fg);
          font-weight: 600;
        }
        .op-ticker-tag {
          margin-left: auto;
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--b-lime);
          padding: 3px 8px;
          border-radius: 100px;
          background: rgba(212, 255, 46, 0.1);
          border: 1px solid rgba(212, 255, 46, 0.25);
        }
        .op-tag-pink {
          color: var(--b-pink);
          background: rgba(255, 61, 138, 0.1);
          border-color: rgba(255, 61, 138, 0.25);
        }

        /* ===== Outcomes strip ===== */
        .opening-outcomes {
          margin-top: 20px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0;
          padding: 28px 40px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
        }
        .op-outcome {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 0 20px;
          border-right: 1px solid var(--b-line);
        }
        .op-outcome:first-child {
          padding-left: 0;
        }
        .op-outcome:last-child {
          border-right: 0;
          padding-right: 0;
        }
        .op-outcome-num {
          font-family: var(--font-geist), sans-serif;
          font-size: 36px;
          line-height: 1;
          font-weight: 700;
          letter-spacing: -0.035em;
          color: var(--b-lime);
          font-variant-numeric: tabular-nums;
        }
        .op-outcome-label {
          font-size: 13px;
          color: var(--b-t2);
          line-height: 1.45;
        }

        @media (max-width: 1100px) {
          .opening-grid {
            grid-template-columns: 1fr;
            padding: 56px 36px;
            gap: 40px;
          }
          .opening-stage {
            min-height: 520px;
          }
          .opening-outcomes {
            grid-template-columns: repeat(2, 1fr);
          }
          .op-outcome:nth-child(2) {
            border-right: 0;
          }
          .op-outcome:nth-child(3) {
            padding-left: 0;
            padding-top: 20px;
            border-top: 1px solid var(--b-line);
          }
          .op-outcome:nth-child(4) {
            padding-top: 20px;
            border-top: 1px solid var(--b-line);
          }
        }
        @media (max-width: 640px) {
          .opening-grid {
            padding: 40px 22px;
          }
          .opening-stage {
            min-height: 560px;
          }
          .op-card-ai {
            width: 100%;
          }
          .op-card-score {
            width: 58%;
            bottom: 10px;
          }
          .op-card-ticker {
            width: 66%;
            right: -10px;
            bottom: 40px;
          }
          .op-score-num {
            font-size: 44px;
          }
          .opening-outcomes {
            grid-template-columns: 1fr;
            padding: 24px;
          }
          .op-outcome {
            border-right: 0;
            border-top: 1px solid var(--b-line);
            padding: 16px 0 0;
          }
          .op-outcome:first-child {
            border-top: 0;
            padding-top: 0;
          }
          .op-outcome:nth-child(3),
          .op-outcome:nth-child(4) {
            border-top: 1px solid var(--b-line);
            padding-left: 0;
            padding-top: 16px;
          }
          .op-outcome-num {
            font-size: 32px;
          }
        }
      `}</style>
    </Scene>
  );
}
