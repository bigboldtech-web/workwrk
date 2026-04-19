"use client";

import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";
import { BigNumber } from "../big-number";

const sources: Array<{
  label: string;
  weight: number;
  accent: "lime" | "pink" | "blue" | "amber" | "violet" | "mint";
}> = [
  { label: "KPI attainment", weight: 30, accent: "lime" },
  { label: "Manager reviews", weight: 25, accent: "pink" },
  { label: "Task completion", weight: 15, accent: "blue" },
  { label: "Peer reviews", weight: 10, accent: "amber" },
  { label: "Self-assessment", weight: 10, accent: "violet" },
  { label: "SOP compliance", weight: 10, accent: "mint" },
];

export function SceneScore() {
  return (
    <Scene id="score" background="linear-gradient(180deg, var(--b-bg), #050505, var(--b-bg))">
      <div className="score-stack">
        <Reveal>
          <div className="scene-kicker">One honest number</div>
        </Reveal>

        <Reveal>
          <div className="score-bignum-wrap">
            <BigNumber to={83.4} decimals={1} duration={1800} className="scene-bignum" />
          </div>
        </Reveal>

        <Reveal>
          <h2 className="scene-headline">
            Every person has <span className="hi">one score.</span>
            <br />
            Pulled from six real sources.
          </h2>
        </Reveal>

        <Reveal>
          <p className="scene-sub">
            Not a rating your manager pulls from memory. A composite, defensible number that
            recalculates the moment any input changes. The spine of every promotion, bonus,
            and PIP conversation.
          </p>
        </Reveal>

        <div className="score-sources">
          {sources.map((s) => (
            <Reveal key={s.label}>
              <div className={`score-source score-${s.accent}`}>
                <span className="score-weight">{s.weight}%</span>
                <span className="score-label">{s.label}</span>
                <span className="score-bar" aria-hidden>
                  <span
                    className="score-bar-fill"
                    style={{ ["--w" as string]: `${s.weight * 3}%` }}
                  />
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      <style jsx>{`
        .score-stack {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 22px;
        }
        .score-bignum-wrap {
          width: 100%;
          margin: 20px 0 12px;
        }
        .score-sources {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          width: 100%;
          margin-top: 40px;
        }
        .score-source {
          padding: 28px 28px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
          transition: transform 0.3s, border-color 0.3s;
        }
        .score-source:hover {
          transform: translateY(-3px);
          border-color: var(--b-line-2);
        }
        .score-weight {
          font-family: var(--font-geist), sans-serif;
          font-size: 48px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.03em;
          display: block;
          color: var(--fg);
          line-height: 1;
        }
        .score-lime .score-weight { color: var(--b-lime); }
        .score-pink .score-weight { color: var(--b-pink); }
        .score-blue .score-weight { color: var(--b-blue); }
        .score-amber .score-weight { color: var(--b-amber); }
        .score-violet .score-weight { color: var(--b-violet); }
        .score-mint .score-weight { color: var(--b-mint); }
        .score-label {
          font-size: 16px;
          color: var(--b-t2);
          display: block;
          margin-top: 8px;
        }
        .score-bar {
          display: block;
          height: 3px;
          width: 100%;
          margin-top: 14px;
          background: var(--b-line);
          border-radius: 2px;
          overflow: hidden;
        }
        .score-bar-fill {
          display: block;
          height: 100%;
          width: var(--w);
          background: currentColor;
          border-radius: inherit;
          transform-origin: left;
          animation: bentoFillIn 1.4s cubic-bezier(0.2, 0.9, 0.3, 1) 0.3s backwards;
        }
        .score-lime .score-bar-fill { background: var(--b-lime); }
        .score-pink .score-bar-fill { background: var(--b-pink); }
        .score-blue .score-bar-fill { background: var(--b-blue); }
        .score-amber .score-bar-fill { background: var(--b-amber); }
        .score-violet .score-bar-fill { background: var(--b-violet); }
        .score-mint .score-bar-fill { background: var(--b-mint); }

        @media (max-width: 900px) {
          .score-sources {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 600px) {
          .score-sources {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Scene>
  );
}
