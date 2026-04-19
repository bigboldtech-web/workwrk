"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";

const steps = [
  { t: "Open the returns inbox", m: "0:12" },
  { t: "Verify the order ID matches the return request", m: "0:24" },
  { t: "Inspect the item using the damage checklist", m: "0:41" },
  { t: "Capture serial number and photograph damage", m: "1:06" },
  { t: "Issue refund or dispatch replacement", m: "1:38" },
  { t: "Log the case in the returns tracker", m: "2:02" },
];

export function SceneScribe() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
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
            setShown(i);
            if (i >= steps.length) window.clearInterval(iv);
          }, 420);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Scene id="scribe">
      <div className="scribe-grid">
        <div>
          <Reveal>
            <div className="scene-kicker">Scribe · SOP from a recording</div>
          </Reveal>
          <Reveal>
            <h2 className="scene-headline">
              Hit record once. <span className="hi">Your playbook writes itself.</span>
            </h2>
          </Reveal>
          <Reveal>
            <p className="scene-sub">
              Walk through the task on camera. Scribe extracts the steps, timestamps each one,
              and publishes a versioned SOP your team can follow tomorrow. No transcribing. No
              formatting. No Drive folder that rots.
            </p>
          </Reveal>
          <Reveal>
            <div className="scribe-stat">
              <span className="scribe-stat-num">2:14</span>
              <span className="scribe-stat-label">video in</span>
              <span className="scribe-arrow">→</span>
              <span className="scribe-stat-num">6 steps</span>
              <span className="scribe-stat-label">SOP out</span>
            </div>
          </Reveal>
        </div>

        <div ref={ref} className="scribe-visual">
          <div className="scribe-video">
            <div className="scribe-video-chrome">
              <span className="scribe-video-chrome-left">
                <span className="scribe-rec" /> REC · 02:14
              </span>
              <span className="scribe-video-title">returns-process.mp4</span>
            </div>
            <div className="scribe-video-body">
              <div className="scribe-frames" aria-hidden>
                <span className="scribe-frame" />
                <span className="scribe-frame is-active" />
                <span className="scribe-frame" />
                <span className="scribe-frame" />
                <span className="scribe-frame" />
              </div>
              <div className="scribe-play" aria-hidden>
                ▸
              </div>
              <div className="scribe-scrubber" aria-hidden>
                <span className="scribe-scrubber-fill" />
              </div>
            </div>
          </div>

          <div className="scribe-arrow-down" aria-hidden>
            ↓
          </div>

          <div className="scribe-sop">
            <div className="scribe-sop-head">
              <span className="scribe-sop-title">Returns process — v1</span>
              <span className="scribe-sop-badge">DRAFT</span>
            </div>
            <ol className="scribe-steps">
              {steps.map((s, i) => (
                <li
                  key={s.t}
                  className={`scribe-step${i < shown ? " is-in" : ""}`}
                  style={{ transitionDelay: `${i * 40}ms` }}
                >
                  <span className="scribe-step-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="scribe-step-text">{s.t}</span>
                  <span className="scribe-step-time">{s.m}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <style jsx>{`
        .scribe-grid {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: 56px;
          align-items: center;
          margin-top: 20px;
        }
        .scribe-stat {
          display: inline-flex;
          align-items: baseline;
          gap: 10px;
          margin-top: 30px;
          padding: 14px 18px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          flex-wrap: wrap;
        }
        .scribe-stat-num {
          font-family: var(--font-geist), sans-serif;
          font-size: 28px;
          font-weight: 600;
          color: var(--b-lime);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.03em;
        }
        .scribe-stat-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--b-t2);
        }
        .scribe-arrow {
          color: var(--b-t4);
          font-size: 18px;
        }
        .scribe-visual {
          display: flex;
          flex-direction: column;
          gap: 16px;
          align-items: center;
        }
        .scribe-video {
          width: 100%;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          overflow: hidden;
        }
        .scribe-video-chrome {
          padding: 14px 18px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--b-t3);
          border-bottom: 1px solid var(--b-line);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .scribe-video-chrome-left {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .scribe-rec {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ff5e5b;
          box-shadow: 0 0 10px #ff5e5b;
          animation: bentoPulse 1.2s ease-in-out infinite;
        }
        .scribe-video-title {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t2);
          text-transform: none;
          letter-spacing: 0;
        }
        .scribe-video-body {
          position: relative;
          padding: 24px;
          background: #0c0c0c;
          display: flex;
          flex-direction: column;
          gap: 18px;
          min-height: 180px;
        }
        .scribe-frames {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 6px;
        }
        .scribe-frame {
          aspect-ratio: 16 / 10;
          border-radius: 6px;
          background: linear-gradient(135deg, #1a1a1a, #222);
          border: 1px solid var(--b-line);
        }
        .scribe-frame.is-active {
          background: linear-gradient(135deg, #333, #1a1a1a);
          border-color: var(--b-lime);
          box-shadow: 0 0 18px rgba(212, 255, 46, 0.2);
        }
        .scribe-play {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: var(--b-lime);
          color: var(--b-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          margin: 6px auto 0;
          box-shadow: 0 0 40px rgba(212, 255, 46, 0.35);
        }
        .scribe-scrubber {
          height: 3px;
          width: 100%;
          background: var(--b-card-3);
          border-radius: 2px;
          overflow: hidden;
        }
        .scribe-scrubber-fill {
          display: block;
          height: 100%;
          width: 38%;
          background: var(--b-lime);
          border-radius: inherit;
        }
        .scribe-arrow-down {
          font-size: 22px;
          color: var(--b-lime);
          animation: bentoPulse 2s ease-in-out infinite;
        }
        .scribe-sop {
          width: 100%;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          padding: 22px 24px;
        }
        .scribe-sop-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--b-line);
        }
        .scribe-sop-title {
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .scribe-sop-badge {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          padding: 5px 10px;
          background: var(--b-lime);
          color: var(--b-bg);
          border-radius: 100px;
          font-weight: 600;
        }
        .scribe-steps {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .scribe-step {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--b-card-2);
          border: 1px solid transparent;
          opacity: 0;
          transform: translateY(6px);
          transition: opacity 0.4s cubic-bezier(0.2, 0.9, 0.3, 1),
            transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1),
            border-color 0.3s;
        }
        .scribe-step.is-in {
          opacity: 1;
          transform: translateY(0);
          border-color: var(--b-line);
        }
        .scribe-step-num {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          color: var(--b-lime);
          letter-spacing: 0.04em;
          min-width: 20px;
        }
        .scribe-step-text {
          font-size: 15px;
          color: var(--b-fg-off);
          line-height: 1.4;
        }
        .scribe-step-time {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          color: var(--b-t3);
        }
        @media (max-width: 1000px) {
          .scribe-grid {
            grid-template-columns: 1fr;
            gap: 40px;
          }
        }
      `}</style>
    </Scene>
  );
}
