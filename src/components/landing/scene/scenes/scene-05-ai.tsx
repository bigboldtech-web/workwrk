"use client";

import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";
import { TypedQuery } from "../typed-query";

const risks = [
  { name: "Priya S.", role: "Senior Engineer · Platform", signal: "Kudos dropped 70% this quarter; no 1:1 in 37 days" },
  { name: "Ravi K.", role: "Ops Lead · Mumbai", signal: "SOP compliance at 61% vs. team avg 88%; review overdue" },
  { name: "Kavita R.", role: "Account Manager · APAC", signal: "KPI trend -18% QoQ; no promotion since 2024" },
];

export function SceneAi() {
  return (
    <Scene id="ai">
      <Reveal>
        <div className="scene-kicker">AI Engine · not a chatbot, a reasoner</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Ask your company <span className="hi">anything.</span>
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub">
          It reads your live org data — KPIs, SOPs, reviews, meetings, activity — and answers
          with real names, real numbers, and the evidence behind each answer.
        </p>
      </Reveal>

      <div className="ai-window">
        <div className="ai-chrome">
          <span className="ai-dot ai-dot-red" />
          <span className="ai-dot ai-dot-amber" />
          <span className="ai-dot ai-dot-lime" />
          <span className="ai-url">workwrk · AI Engine</span>
        </div>
        <div className="ai-body">
          <div className="ai-prompt">
            <span className="ai-prompt-label">You</span>
            <div className="ai-prompt-text">
              <TypedQuery
                text="Who's at risk of leaving this quarter, and why?"
                speed={30}
              />
            </div>
          </div>
          <Reveal>
            <div className="ai-answer">
              <span className="ai-answer-label">workwrk</span>
              <div className="ai-answer-text">
                Three signals I&apos;d look at this week:
              </div>
              <ol className="ai-risks">
                {risks.map((r, i) => (
                  <li
                    key={r.name}
                    className="ai-risk"
                    style={{ animationDelay: `${2000 + i * 250}ms` }}
                  >
                    <span className="ai-risk-name">{r.name}</span>
                    <span className="ai-risk-role">{r.role}</span>
                    <span className="ai-risk-signal">{r.signal}</span>
                  </li>
                ))}
              </ol>
              <div className="ai-footnote">
                Pulled from 2,741 activity events, 14 SOPs, 48 KPI records.
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      <style jsx>{`
        .ai-window {
          margin-top: 64px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          overflow: hidden;
          width: 100%;
        }
        .ai-chrome {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--b-line);
        }
        .ai-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        .ai-dot-red { background: #ff5e5b; }
        .ai-dot-amber { background: #ffba49; }
        .ai-dot-lime { background: var(--b-lime); }
        .ai-url {
          margin-left: 16px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t3);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .ai-body {
          padding: 28px 32px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .ai-prompt,
        .ai-answer {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ai-prompt-label,
        .ai-answer-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: var(--b-t2);
        }
        .ai-answer-label {
          color: var(--b-lime);
        }
        .ai-prompt-text {
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--b-fg);
          line-height: 1.3;
        }
        .ai-answer-text {
          font-size: 19px;
          color: var(--b-fg-off);
          margin-bottom: 12px;
          line-height: 1.5;
        }
        .ai-risks {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .ai-risk {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2px;
          padding: 14px 16px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-left: 3px solid var(--b-pink);
          border-radius: 12px;
          opacity: 0;
          animation: bentoPanelIn 0.5s cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
        }
        .ai-risk-name {
          font-size: 17px;
          font-weight: 600;
          color: var(--b-fg);
        }
        .ai-risk-role {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          color: var(--b-t2);
          letter-spacing: 0.04em;
        }
        .ai-risk-signal {
          font-size: 15px;
          color: var(--b-t2);
          margin-top: 6px;
          line-height: 1.5;
        }
        .ai-footnote {
          margin-top: 16px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          color: var(--b-t2);
          letter-spacing: 0.04em;
        }
        @media (max-width: 720px) {
          .ai-body {
            padding: 20px 18px;
          }
          .ai-prompt-text {
            font-size: 18px;
          }
        }
      `}</style>
    </Scene>
  );
}
