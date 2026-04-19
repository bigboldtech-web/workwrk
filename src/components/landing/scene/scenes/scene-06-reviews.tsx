"use client";

import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";
import { BigNumber } from "../big-number";

export function SceneReviews() {
  return (
    <Scene id="reviews">
      <Reveal>
        <div className="scene-kicker">Review cycles, without the dread</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Two weeks <span className="pk">of form-filling</span> →<br />
          <span className="hi">two days</span> of real conversations.
        </h2>
      </Reveal>

      <div className="rev-grid">
        <div>
          <Reveal>
            <p className="scene-sub">
              Forms arrive pre-filled with live data: KPIs this cycle, SOP compliance, peer
              feedback trends, quarter-over-quarter deltas, kudos received. Managers show up
              with context instead of excuses. Cycles close in 48 hours.
            </p>
          </Reveal>

          <Reveal>
            <div className="rev-metrics">
              <div className="rev-metric">
                <span className="rev-metric-num">
                  <BigNumber to={48} suffix="h" duration={1400} />
                </span>
                <span className="rev-metric-label">cycle time</span>
              </div>
              <div className="rev-metric">
                <span className="rev-metric-num rev-pink">
                  <BigNumber to={100} suffix="%" duration={1400} />
                </span>
                <span className="rev-metric-label">pre-filled</span>
              </div>
              <div className="rev-metric">
                <span className="rev-metric-num rev-blue">
                  <BigNumber to={6} duration={1400} />
                </span>
                <span className="rev-metric-label">review types</span>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal>
          <div className="rev-card">
            <div className="rev-card-head">
              <span className="rev-card-title">Q3 Review · Priya S.</span>
              <span className="rev-card-status">IN REVIEW</span>
            </div>
            <div className="rev-rows">
              <div className="rev-row">
                <span className="rev-row-label">KPI attainment</span>
                <span className="rev-row-val">
                  94% <span className="rev-delta rev-up">▲ 11%</span>
                </span>
              </div>
              <div className="rev-row">
                <span className="rev-row-label">SOP compliance</span>
                <span className="rev-row-val">
                  96% <span className="rev-delta rev-up">▲ 4%</span>
                </span>
              </div>
              <div className="rev-row">
                <span className="rev-row-label">Peer review (8)</span>
                <span className="rev-row-val">
                  4.7/5 <span className="rev-delta rev-up">▲ 0.3</span>
                </span>
              </div>
              <div className="rev-row">
                <span className="rev-row-label">Kudos received</span>
                <span className="rev-row-val">
                  17 <span className="rev-delta rev-up">▲ 5</span>
                </span>
              </div>
              <div className="rev-row rev-row-highlight">
                <span className="rev-row-label">Composite score</span>
                <span className="rev-row-val rev-row-big">92.1</span>
              </div>
            </div>
            <div className="rev-card-footer">
              Outcome suggestion · <strong className="rev-outcome">Promotion eligible</strong>
            </div>
          </div>
        </Reveal>
      </div>

      <style jsx>{`
        .rev-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 48px;
          align-items: start;
          margin-top: 40px;
        }
        .rev-metrics {
          display: flex;
          gap: 40px;
          margin-top: 32px;
        }
        .rev-metric {
          display: flex;
          flex-direction: column;
        }
        .rev-metric-num {
          font-family: var(--font-geist), sans-serif;
          font-size: 56px;
          font-weight: 600;
          letter-spacing: -0.04em;
          color: var(--b-lime);
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .rev-pink { color: var(--b-pink); }
        .rev-blue { color: var(--b-blue); }
        .rev-metric-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--b-t2);
          margin-top: 8px;
        }
        .rev-card {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          padding: 24px 26px;
        }
        .rev-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--b-line);
        }
        .rev-card-title {
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .rev-card-status {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          padding: 5px 10px;
          border-radius: 100px;
          background: var(--b-amber);
          color: var(--b-bg);
          font-weight: 600;
        }
        .rev-rows {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-top: 12px;
        }
        .rev-row {
          display: flex;
          justify-content: space-between;
          padding: 14px 0;
          border-bottom: 1px solid var(--b-line);
          font-size: 15px;
        }
        .rev-row-label {
          color: var(--b-t2);
        }
        .rev-row-val {
          color: var(--b-fg);
          font-variant-numeric: tabular-nums;
          font-family: var(--font-geist-mono), monospace;
        }
        .rev-delta {
          margin-left: 10px;
          font-size: 13px;
        }
        .rev-up {
          color: var(--b-lime);
        }
        .rev-row-highlight {
          border-bottom: 0;
          padding-top: 16px;
          font-weight: 600;
        }
        .rev-row-big {
          font-size: 28px;
          color: var(--b-lime);
          letter-spacing: -0.02em;
        }
        .rev-card-footer {
          margin-top: 12px;
          padding-top: 20px;
          border-top: 1px solid var(--b-line);
          font-size: 15px;
          color: var(--b-t2);
        }
        .rev-outcome {
          color: var(--b-lime);
          font-weight: 600;
        }
        @media (max-width: 1000px) {
          .rev-grid {
            grid-template-columns: 1fr;
            gap: 40px;
          }
        }
      `}</style>
    </Scene>
  );
}
