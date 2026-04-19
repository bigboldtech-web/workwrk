"use client";

import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";
import { useCurrency } from "@/components/layout/currency-provider";

const cycle = ["₹", "$", "€", "£", "د.إ", "S$", "¥", "₩", "R$", "kr"];
const languageSamples = [
  "English",
  "हिन्दी",
  "Español",
  "Français",
  "Deutsch",
  "Português",
  "العربية",
  "日本語",
  "한국어",
  "中文",
];

export function SceneGlobal() {
  const { currency, info } = useCurrency();

  return (
    <Scene id="global">
      <Reveal>
        <div className="scene-kicker">Built for the world · shipped from India</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Your team speaks its language. <br />
          <span className="hi">Your pricing is in its currency.</span>
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub">
          Eighteen languages. Twenty-one currencies. Auto-detected on first visit and
          remembered. Right-to-left locales work out of the box.
        </p>
      </Reveal>

      <div className="global-grid">
        <Reveal>
          <div className="global-panel">
            <div className="global-panel-kicker">Languages</div>
            <div className="scene-marquee-wrap">
              <div className="scene-marquee">
                {[...languageSamples, ...languageSamples].map((l, i) => (
                  <span key={`${l}-${i}`} className="global-lang">
                    {l}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal>
          <div className="global-panel global-panel-accent">
            <div className="global-panel-kicker">You&apos;re seeing {currency} · {info.name}</div>
            <div className="global-symbols">
              {cycle.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className={`global-sym${info.symbol === s ? " is-active" : ""}`}
                >
                  {s}
                </span>
              ))}
            </div>
            <p className="global-panel-body">
              We auto-detected your locale from your browser and region. Switch anytime from
              the nav — your pricing updates instantly.
            </p>
          </div>
        </Reveal>
      </div>

      <style jsx>{`
        .global-grid {
          margin-top: 48px;
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 14px;
        }
        .global-panel {
          padding: 32px;
          border-radius: var(--b-r-lg);
          background: var(--b-card);
          border: 1px solid var(--b-line);
          min-height: 200px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .global-panel-accent {
          background: var(--b-card-2);
          border-color: var(--b-line-2);
        }
        .global-panel-kicker {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--b-lime);
        }
        .global-lang {
          font-size: 22px;
          font-weight: 500;
          color: var(--b-fg-off);
          letter-spacing: -0.01em;
        }
        .global-symbols {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .global-sym {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 44px;
          height: 44px;
          padding: 0 10px;
          border-radius: 12px;
          background: var(--b-card-3);
          border: 1px solid var(--b-line);
          font-size: 18px;
          color: var(--b-t2);
          transition: all 0.3s;
          font-family: var(--font-geist), sans-serif;
          font-weight: 500;
        }
        .global-sym.is-active {
          background: var(--b-lime);
          color: var(--b-bg);
          border-color: transparent;
          transform: scale(1.05);
        }
        .global-panel-body {
          font-size: 13px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
        }
        @media (max-width: 900px) {
          .global-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Scene>
  );
}
