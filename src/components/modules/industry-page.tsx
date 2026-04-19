"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Label, Reveal, SectionHeader } from "@/components/bento";
import {
  ModuleConnects,
  ModuleCta,
  ModuleFaq,
  ModuleStats,
  type ModuleIconKey,
} from "./module-page";
import "./module-page.css";

type Tone = "lime" | "pink" | "blue" | "amber";
const toneVar: Record<Tone, string> = {
  lime: "var(--b-lime)",
  pink: "var(--b-pink)",
  blue: "var(--b-blue)",
  amber: "var(--b-amber)",
};

export type IndustryConfig = {
  /** E.g. "Sales · Revenue teams" */
  eyebrow: string;
  /** Industry display name */
  name: string;
  /** Brand tone */
  tone: Tone;
  /** The big opening headline */
  headline: ReactNode;
  /** Paragraph under the headline */
  body: string;
  /** 3–5 pain-points the industry owns */
  pains: { title: string; body: string }[];
  /** 3–4 how-it-shows-up-for-you sections */
  fit: {
    eyebrow: string;
    title: ReactNode;
    body: ReactNode;
    bullets: string[];
    tone: Tone;
  }[];
  /** Proof numbers */
  stats: { stat: ReactNode; label: string; tone: Tone }[];
  /** Modules that matter most for this industry */
  relevantModules: {
    name: string;
    href: string;
    flow: string;
    iconKey: ModuleIconKey;
  }[];
  /** Industry-specific FAQs */
  faq: { q: string; a: ReactNode }[];
};

export function IndustryPage({ c }: { c: IndustryConfig }) {
  return (
    <>
      {/* Hero */}
      <section className="bento-section" style={{ paddingTop: 56, paddingBottom: 48 }}>
        <div className="bento-container">
          <Reveal>
            <div className="ip-eyebrow">
              <span className="ip-dot" style={{ background: toneVar[c.tone] }} />
              {c.eyebrow}
            </div>
          </Reveal>
          <Reveal>
            <h1 className="ip-headline">{c.headline}</h1>
          </Reveal>
          <Reveal>
            <p className="ip-body">{c.body}</p>
          </Reveal>
          <Reveal>
            <div className="ip-ctas">
              <Link href="/signup" className="bento-btn bento-btn-lime bento-btn-lg">
                Start 14-day trial →
              </Link>
              <Link href="/demo" className="bento-btn bento-btn-ghost bento-btn-lg">
                Book a live walkthrough
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pains */}
      <section className="bento-section" style={{ paddingTop: 40 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="What teams in this space wrestle with"
              title={<>The specific mess <span className="hi">{c.name}</span> teams inherit.</>}
              subtitle="Each of these is something we see week after week. Not an industry stereotype — patterns from live customers."
              aside={{
                label: "Pain points",
                stat: c.pains.length.toString(),
                text: "Every one of these maps to a first-class module in the spine.",
              }}
            />
          </Reveal>
          <Reveal stagger className="ip-pains">
            {c.pains.map((p) => (
              <article key={p.title} className="ip-pain">
                <div className="ip-pain-title">{p.title}</div>
                <div className="ip-pain-body">{p.body}</div>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      {/* How it fits */}
      {c.fit.map((f, i) => (
        <section
          key={i}
          className="ip-fit"
          style={{
            ["--c" as string]: toneVar[f.tone],
            background: i % 2 === 1 ? "var(--b-card)" : "transparent",
          } as React.CSSProperties}
        >
          <div className="bento-container">
            <Reveal>
              <div className="ip-fit-grid">
                <div className="ip-fit-copy">
                  <Label>{f.eyebrow}</Label>
                  <h2 className="ip-fit-title">{f.title}</h2>
                  <div className="ip-fit-body">{f.body}</div>
                </div>
                <ul className="ip-fit-bullets">
                  {f.bullets.map((b) => (
                    <li key={b}>
                      <span className="tick" style={{ color: toneVar[f.tone] }}>✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </section>
      ))}

      {/* Stats */}
      <ModuleStats
        kicker={`WorkwrK in ${c.name}`}
        title={<>What customers in this space <span className="hi">actually see.</span></>}
        stats={c.stats}
      />

      {/* Relevant modules */}
      <ModuleConnects
        sourceName={c.name}
        title={<>The modules that matter most <span className="hi">for you.</span></>}
        subtitle={`If you're in ${c.name.toLowerCase()} and you're only going to touch a few modules in the first month, start with these.`}
        entries={c.relevantModules.map((m) => ({
          name: m.name,
          flow: m.flow,
          href: m.href,
          iconKey: m.iconKey,
        }))}
      />

      {/* FAQ */}
      <ModuleFaq
        title={<>Questions we get from <span className="hi">{c.name.toLowerCase()}</span> teams.</>}
        items={c.faq}
      />

      {/* CTA */}
      <ModuleCta
        tone={c.tone}
        title={<>Run your {c.name.toLowerCase()} team <em>on workwrk.</em></>}
        subtitle="14-day free trial, no credit card. See your data in the system by end of day one."
      />

      <style>{`
        .ip-eyebrow {
          display: inline-flex; align-items: center; gap: 10px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--b-t2);
          margin-bottom: 22px;
        }
        .ip-dot {
          width: 8px; height: 8px; border-radius: 50%;
          box-shadow: 0 0 10px currentColor;
        }
        .ip-headline {
          font-size: clamp(48px, 6.6vw, 96px);
          font-weight: 600;
          letter-spacing: -0.045em;
          line-height: 0.98;
          margin: 0 0 24px;
          max-width: 18ch;
        }
        .ip-headline :global(.hi) { color: var(--b-lime); }
        .ip-headline :global(.pk) { color: var(--b-pink); }
        .ip-headline :global(.bl) { color: var(--b-blue); }
        .ip-headline :global(.am) { color: var(--b-amber); }
        .ip-body {
          font-size: 19px;
          color: var(--b-t2);
          line-height: 1.55;
          max-width: 58ch;
          margin: 0 0 32px;
        }
        .ip-ctas { display: flex; flex-wrap: wrap; gap: 10px; }

        .ip-pains {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-top: 32px;
        }
        .ip-pain {
          padding: 26px 24px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
          min-height: 180px;
          display: flex; flex-direction: column; gap: 10px;
          transition: all 0.3s;
        }
        .ip-pain:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .ip-pain-title { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; color: var(--b-fg); line-height: 1.2; }
        .ip-pain-body { font-size: 14px; color: var(--b-t2); line-height: 1.5; }

        .ip-fit { padding: 80px 0; scroll-margin-top: 90px; }
        .ip-fit-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 40px; align-items: start;
        }
        .ip-fit-title {
          font-size: clamp(28px, 3.8vw, 44px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin: 12px 0 18px;
        }
        .ip-fit-body {
          font-size: 16px;
          color: var(--b-t2);
          line-height: 1.55;
          max-width: 52ch;
        }
        .ip-fit-bullets {
          list-style: none; margin: 0; padding: 0;
          display: grid; gap: 10px;
        }
        .ip-fit-bullets li {
          display: grid; grid-template-columns: 18px 1fr; gap: 10px;
          padding: 14px 16px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 12px;
          font-size: 14.5px;
          color: var(--b-off);
          line-height: 1.45;
          transition: all 0.25s;
        }
        .ip-fit-bullets li:hover { border-color: var(--b-line-2); transform: translateX(2px); }
        .ip-fit-bullets .tick { font-weight: 700; }
        @media (max-width: 960px) {
          .ip-pains { grid-template-columns: 1fr 1fr; }
          .ip-fit-grid { grid-template-columns: 1fr; gap: 24px; }
          .ip-fit { padding: 56px 0; }
        }
        @media (max-width: 640px) { .ip-pains { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
