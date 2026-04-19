"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";

const chain = [
  { label: "KRA updated", accent: "lime" as const, detail: "Reduce first-response time" },
  { label: "KPI auto-updated", accent: "blue" as const, detail: "Target: <2h mean response" },
  { label: "Tasks regenerated", accent: "amber" as const, detail: "12 weekly · owners assigned" },
  { label: "Review form refreshed", accent: "pink" as const, detail: "Next cycle pre-filled" },
  { label: "Composite score", accent: "violet" as const, detail: "Recalculates overnight" },
];

export function SceneSpine() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || fired.current) continue;
          fired.current = true;
          let i = 0;
          const iv = window.setInterval(() => {
            i += 1;
            setStep(i);
            if (i >= chain.length) window.clearInterval(iv);
          }, 550);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Scene id="spine">
      <Reveal>
        <div className="scene-kicker">One data model · not a Frankenstack</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Change one thing. <span className="hi">Watch everything update.</span>
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub">
          KRAs, KPIs, tasks, SOPs, reviews, and scores share one spine. No exports. No Zapier.
          No stale dashboards. The moment a goal shifts, every downstream object catches up.
        </p>
      </Reveal>

      <div ref={ref} className="spine-chain">
        {chain.map((c, i) => (
          <div key={c.label} className={`spine-node is-${c.accent}${i < step ? " is-on" : ""}`}>
            <span className="spine-dot" aria-hidden />
            <div className="spine-node-body">
              <span className="spine-label">{c.label}</span>
              <span className="spine-detail">{c.detail}</span>
            </div>
            {i < chain.length - 1 && (
              <span className={`spine-line${i + 1 < step ? " is-on" : ""}`} aria-hidden />
            )}
          </div>
        ))}
      </div>

      <style jsx>{`
        .spine-chain {
          margin-top: 56px;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 0;
          position: relative;
        }
        .spine-node {
          position: relative;
          padding: 24px 20px 24px 0;
          opacity: 0.35;
          transition: opacity 0.4s;
        }
        .spine-node.is-on {
          opacity: 1;
        }
        .spine-dot {
          display: block;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--b-card-3);
          border: 2px solid var(--b-line);
          margin-bottom: 18px;
          transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;
        }
        .spine-node.is-on.is-lime .spine-dot { background: var(--b-lime); border-color: var(--b-lime); box-shadow: 0 0 20px var(--b-lime); }
        .spine-node.is-on.is-blue .spine-dot { background: var(--b-blue); border-color: var(--b-blue); box-shadow: 0 0 20px var(--b-blue); }
        .spine-node.is-on.is-amber .spine-dot { background: var(--b-amber); border-color: var(--b-amber); box-shadow: 0 0 20px var(--b-amber); }
        .spine-node.is-on.is-pink .spine-dot { background: var(--b-pink); border-color: var(--b-pink); box-shadow: 0 0 20px var(--b-pink); }
        .spine-node.is-on.is-violet .spine-dot { background: var(--b-violet); border-color: var(--b-violet); box-shadow: 0 0 20px var(--b-violet); }
        .spine-line {
          position: absolute;
          top: 30px;
          left: 14px;
          right: 0;
          height: 2px;
          background: var(--b-line);
          transform-origin: left;
          transform: scaleX(0);
          transition: transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1), background 0.4s;
        }
        .spine-line.is-on {
          transform: scaleX(1);
          background: linear-gradient(90deg, var(--b-lime), var(--b-lime) 40%, rgba(212, 255, 46, 0.3));
        }
        .spine-node-body {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .spine-label {
          font-size: 18px;
          font-weight: 600;
          color: var(--b-fg);
          letter-spacing: -0.01em;
        }
        .spine-detail {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          color: var(--b-t2);
          letter-spacing: 0.03em;
          line-height: 1.4;
        }
        @media (max-width: 900px) {
          .spine-chain {
            grid-template-columns: 1fr;
          }
          .spine-line {
            display: none;
          }
        }
      `}</style>
    </Scene>
  );
}
