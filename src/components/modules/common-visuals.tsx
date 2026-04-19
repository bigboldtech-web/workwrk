"use client";

import type { ReactNode } from "react";

/**
 * Lightweight reusable visuals for module deep-dive pages. Each fills
 * the parent card and stays purely CSS — no images, no external libs.
 */

type Tone = "lime" | "pink" | "blue" | "amber";
const toneHex: Record<Tone, string> = {
  lime: "#d4ff2e",
  pink: "#ff3d8a",
  blue: "#4a9eff",
  amber: "#ff9933",
};

/* ── Data table with colored score cells ─────────────────────────── */

export function DataTableVisual({
  title,
  meta,
  rows,
  tone = "lime",
}: {
  title: string;
  meta: string;
  rows: { a: string; b: string; score: number; delta: string; up: boolean }[];
  tone?: Tone;
}) {
  return (
    <div className="cvt">
      <div className="cvt-head">
        <div>
          <div className="cvt-title">{title}</div>
          <div className="cvt-meta">{meta}</div>
        </div>
        <span className="cvt-live" style={{ color: toneHex[tone] }}>● live</span>
      </div>
      <div className="cvt-rows">
        {rows.map((r, i) => (
          <div key={i} className="cvt-row">
            <span className="cvt-ava" style={{ background: toneHex[tone], color: "#0a0a0a" }}>
              {r.a.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <div className="cvt-a">{r.a}</div>
              <div className="cvt-b">{r.b}</div>
            </div>
            <span className="cvt-score">{r.score}</span>
            <span className={`cvt-delta ${r.up ? "up" : "down"}`}>{r.delta}</span>
            <div className="cvt-bar">
              <span style={{ width: `${r.score}%`, background: r.up ? toneHex[tone] : "#ff3d8a" }} />
            </div>
          </div>
        ))}
      </div>
      <style jsx>{`
        .cvt {
          flex: 1;
          display: flex; flex-direction: column; gap: 14px;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 18px;
        }
        .cvt-head {
          display: flex; justify-content: space-between; align-items: flex-end;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--b-line);
        }
        .cvt-title { font-size: 15px; font-weight: 600; color: var(--b-fg); }
        .cvt-meta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-t3);
          letter-spacing: 0.06em; margin-top: 3px;
        }
        .cvt-live {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; letter-spacing: 0.1em;
        }
        .cvt-rows { display: flex; flex-direction: column; gap: 2px; }
        .cvt-row {
          display: grid;
          grid-template-columns: 26px 1fr 42px 36px 90px;
          gap: 10px;
          align-items: center;
          padding: 8px 4px;
          border-bottom: 1px solid var(--b-line);
          font-size: 12.5px;
        }
        .cvt-row:last-child { border-bottom: none; }
        .cvt-ava {
          width: 26px; height: 26px; border-radius: 6px;
          font-size: 10px; font-weight: 700;
          display: inline-flex; align-items: center; justify-content: center;
          font-family: var(--font-geist-mono), monospace;
        }
        .cvt-a { font-weight: 500; color: var(--b-fg); font-size: 12.5px; }
        .cvt-b {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-t3);
          letter-spacing: 0.04em;
        }
        .cvt-score {
          font-family: var(--font-geist-mono), monospace;
          font-size: 15px; font-weight: 600;
          color: var(--b-fg);
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .cvt-delta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          text-align: right;
        }
        .cvt-delta.up { color: var(--b-lime); }
        .cvt-delta.down { color: var(--b-pink); }
        .cvt-bar {
          height: 3px; background: rgba(255,255,255,0.08);
          border-radius: 2px; overflow: hidden;
        }
        .cvt-bar span {
          display: block; height: 100%;
          animation: bentoFillIn 1.4s cubic-bezier(0.2,0.9,0.3,1);
          transform-origin: left;
        }
      `}</style>
    </div>
  );
}

/* ── Dashboard with three stat tiles ─────────────────────────────── */

export function DashboardVisual({
  tiles,
  footer,
}: {
  tiles: { label: string; stat: ReactNode; delta: string; tone: Tone }[];
  footer?: string;
}) {
  return (
    <div className="cvd">
      <div className="cvd-grid">
        {tiles.map((t, i) => (
          <div key={i} className="cvd-tile" style={{ ["--c" as string]: toneHex[t.tone] } as React.CSSProperties}>
            <div className="cvd-label">{t.label}</div>
            <div className="cvd-stat">{t.stat}</div>
            <div className="cvd-delta">{t.delta}</div>
          </div>
        ))}
      </div>
      {footer && <div className="cvd-footer">{footer}</div>}
      <style jsx>{`
        .cvd {
          flex: 1;
          display: flex; flex-direction: column; gap: 12px;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 18px;
        }
        .cvd-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          flex: 1;
        }
        .cvd-tile {
          padding: 16px 18px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 10px;
          border-left: 3px solid var(--c);
        }
        .cvd-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--b-t3);
          margin-bottom: 6px;
        }
        .cvd-stat {
          font-size: 30px;
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1;
          color: var(--c);
          font-variant-numeric: tabular-nums;
        }
        .cvd-delta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t2);
          margin-top: 4px;
          letter-spacing: 0.04em;
        }
        .cvd-footer {
          padding-top: 8px;
          border-top: 1px dashed var(--b-line);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          color: var(--b-t3);
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}

/* ── Timeline of events ─────────────────────────────────────────── */

export function TimelineVisual({
  steps,
  tone = "lime",
}: {
  steps: { t: string; title: string; meta?: string }[];
  tone?: Tone;
}) {
  return (
    <div className="cvtl">
      {steps.map((s, i) => (
        <div key={i} className="cvtl-step">
          <div className="cvtl-dot" style={{ background: toneHex[tone], boxShadow: `0 0 10px ${toneHex[tone]}` }} />
          {i < steps.length - 1 && <div className="cvtl-line" />}
          <div className="cvtl-content">
            <div className="cvtl-t">{s.t}</div>
            <div className="cvtl-title">{s.title}</div>
            {s.meta && <div className="cvtl-meta">{s.meta}</div>}
          </div>
        </div>
      ))}
      <style jsx>{`
        .cvtl {
          flex: 1;
          display: flex; flex-direction: column;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 22px 22px 10px;
          position: relative;
          gap: 0;
        }
        .cvtl-step {
          display: grid;
          grid-template-columns: 24px 1fr;
          gap: 14px;
          padding-bottom: 20px;
          position: relative;
        }
        .cvtl-step:last-child { padding-bottom: 0; }
        .cvtl-dot {
          width: 10px; height: 10px;
          border-radius: 50%;
          margin-top: 6px;
          margin-left: 7px;
          flex-shrink: 0;
        }
        .cvtl-line {
          position: absolute;
          top: 18px; left: 12px; bottom: 0;
          width: 1px;
          background: linear-gradient(to bottom, var(--b-line-2), transparent);
        }
        .cvtl-t {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          color: var(--b-t3);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .cvtl-title { font-size: 14px; font-weight: 500; color: var(--b-fg); line-height: 1.4; }
        .cvtl-meta {
          font-size: 12px; color: var(--b-t2);
          line-height: 1.5; margin-top: 4px;
        }
      `}</style>
    </div>
  );
}

/* ── Org tree ────────────────────────────────────────────────────── */

export function OrgTreeVisual() {
  return (
    <div className="cvo">
      <div className="cvo-node cvo-top">
        <span className="cvo-ini" style={{ background: "#d4ff2e", color: "#0a0a0a" }}>AR</span>
        <div>
          <div className="cvo-name">Arjun R.</div>
          <div className="cvo-role">Founder / CEO</div>
        </div>
      </div>
      <div className="cvo-lines">
        <span /><span /><span />
      </div>
      <div className="cvo-row">
        <div className="cvo-node">
          <span className="cvo-ini" style={{ background: "#ff3d8a", color: "#0a0a0a" }}>PS</span>
          <div>
            <div className="cvo-name">Priya S.</div>
            <div className="cvo-role">Head of Sales · 14</div>
          </div>
        </div>
        <div className="cvo-node">
          <span className="cvo-ini" style={{ background: "#4a9eff", color: "#0a0a0a" }}>RK</span>
          <div>
            <div className="cvo-name">Ravi K.</div>
            <div className="cvo-role">Head of Eng · 22</div>
          </div>
        </div>
        <div className="cvo-node">
          <span className="cvo-ini" style={{ background: "#ff9933", color: "#0a0a0a" }}>NM</span>
          <div>
            <div className="cvo-name">Neha M.</div>
            <div className="cvo-role">Head of Ops · 9</div>
          </div>
        </div>
      </div>
      <div className="cvo-footer">
        <div>
          <span className="cvo-num">142</span>
          <span className="cvo-lab">Total people</span>
        </div>
        <div>
          <span className="cvo-num">18</span>
          <span className="cvo-lab">Roles defined</span>
        </div>
        <div>
          <span className="cvo-num">6</span>
          <span className="cvo-lab">Reporting depth</span>
        </div>
      </div>
      <style jsx>{`
        .cvo {
          flex: 1;
          display: flex; flex-direction: column; gap: 14px;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 18px;
        }
        .cvo-node {
          display: inline-flex; align-items: center; gap: 10px;
          padding: 10px 14px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 10px;
          min-width: 0;
        }
        .cvo-top { align-self: center; padding: 12px 18px; }
        .cvo-ini {
          width: 32px; height: 32px;
          border-radius: 8px;
          font-size: 11px; font-weight: 700;
          font-family: var(--font-geist-mono), monospace;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .cvo-name { font-size: 13px; font-weight: 600; color: var(--b-fg); }
        .cvo-role {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-t3);
          letter-spacing: 0.04em;
        }
        .cvo-lines {
          position: relative;
          height: 12px;
          display: flex; justify-content: space-between;
          padding: 0 24%;
        }
        .cvo-lines span {
          width: 1px; height: 100%;
          background: var(--b-line-2);
        }
        .cvo-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        .cvo-row .cvo-node { padding: 8px 12px; min-width: 0; }
        .cvo-row .cvo-ini { width: 24px; height: 24px; font-size: 9.5px; }
        .cvo-row .cvo-name { font-size: 12px; }
        .cvo-row .cvo-role { font-size: 9.5px; }
        .cvo-footer {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          padding-top: 10px;
          border-top: 1px dashed var(--b-line);
        }
        .cvo-footer > div { display: flex; flex-direction: column; gap: 2px; }
        .cvo-num {
          font-size: 20px; font-weight: 600;
          color: var(--b-fg);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
        }
        .cvo-lab {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px; color: var(--b-t3);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}

/* ── Integration pills grid ──────────────────────────────────────── */

export function IntegrationGridVisual({
  integrations,
  heading,
}: {
  integrations: { name: string; group: string; color?: string; status?: "live" | "soon" }[];
  heading?: string;
}) {
  const liveCount = integrations.filter((i) => (i.status ?? "live") === "live").length;
  return (
    <div className="cvi">
      <div className="cvi-head">
        <span>{heading ?? `Connected · ${liveCount} live · ${integrations.length - liveCount} coming`}</span>
        <span className="cvi-plus">+ add</span>
      </div>
      <div className="cvi-grid">
        {integrations.map((i) => {
          const isSoon = i.status === "soon";
          return (
            <div key={i.name} className={`cvi-pill${isSoon ? " cvi-pill-soon" : ""}`}>
              <span className="cvi-dot" style={{ background: i.color ?? "#4a9eff" }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="cvi-name">{i.name}</div>
                <div className="cvi-group">{i.group}</div>
              </div>
              {isSoon && <span className="cvi-soon-badge">SOON</span>}
            </div>
          );
        })}
      </div>
      <style jsx>{`
        .cvi {
          flex: 1;
          display: flex; flex-direction: column; gap: 12px;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 18px;
        }
        .cvi-head {
          display: flex; justify-content: space-between;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--b-line);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-t2);
          letter-spacing: 0.08em;
        }
        .cvi-plus { color: var(--b-lime); }
        .cvi-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .cvi-pill {
          display: grid;
          grid-template-columns: 10px 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 10px;
          transition: all 0.25s;
        }
        .cvi-pill:hover { border-color: var(--b-line-2); }
        .cvi-pill-soon { opacity: 0.55; }
        .cvi-pill-soon:hover { opacity: 0.85; }
        .cvi-soon-badge {
          font-family: var(--font-geist-mono), monospace;
          font-size: 8.5px;
          letter-spacing: 0.18em;
          color: var(--b-amber);
          padding: 2px 6px;
          border: 1px solid rgba(255,153,51,0.3);
          background: rgba(255,153,51,0.08);
          border-radius: 100px;
        }
        .cvi-dot {
          width: 8px; height: 8px; border-radius: 50%;
          box-shadow: 0 0 6px currentColor;
        }
        .cvi-name { font-size: 12.5px; font-weight: 500; color: var(--b-fg); }
        .cvi-group {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px; color: var(--b-t3);
          letter-spacing: 0.06em;
        }
      `}</style>
    </div>
  );
}
