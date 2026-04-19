"use client";

import Link from "next/link";
import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";

export function SceneCta() {
  return (
    <Scene id="start">
      <Reveal>
        <div className="cta-card bento-dots">
          <div className="scene-kicker cta-kicker">The last operating system you&apos;ll migrate to</div>
          <h2 className="cta-headline">
            Run your company
            <br />
            like you mean it.
          </h2>
          <div className="cta-actions">
            <Link href="/signup" className="bento-btn cta-btn-dark bento-btn-lg">
              Start free · 14-day trial <span className="arr">→</span>
            </Link>
            <Link href="/pricing" className="bento-btn cta-btn-ghost bento-btn-lg">
              See pricing
            </Link>
          </div>
          <div className="cta-trust">
            No credit card · Setup in 30 min · Cancel anytime
          </div>
        </div>
      </Reveal>

      <style jsx>{`
        .cta-card {
          background: var(--b-lime);
          color: var(--b-bg);
          border-radius: var(--b-r-xl);
          padding: 140px 64px 120px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .cta-kicker {
          color: rgba(0, 0, 0, 0.6);
          font-size: 14px;
        }
        .cta-kicker::before {
          background: var(--b-bg);
        }
        .cta-headline {
          font-family: var(--font-geist), sans-serif;
          font-size: clamp(56px, 9vw, 128px);
          line-height: 0.96;
          letter-spacing: -0.045em;
          font-weight: 700;
          margin: 0 auto;
          color: var(--b-bg);
          max-width: 14ch;
        }
        .cta-actions {
          display: inline-flex;
          gap: 14px;
          margin-top: 56px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .cta-btn-dark {
          background: var(--b-bg);
          color: var(--b-lime);
          border: 1px solid var(--b-bg);
          box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.3);
        }
        .cta-btn-dark:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.45);
        }
        .cta-btn-ghost {
          background: transparent;
          color: var(--b-bg);
          border: 2px solid var(--b-bg);
        }
        .cta-btn-ghost:hover {
          background: rgba(0, 0, 0, 0.08);
          transform: translateY(-2px);
        }
        .cta-trust {
          margin-top: 36px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: rgba(0, 0, 0, 0.65);
        }
        @media (max-width: 720px) {
          .cta-card {
            padding: 80px 28px;
          }
        }
      `}</style>
    </Scene>
  );
}
