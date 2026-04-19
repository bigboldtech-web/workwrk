"use client";

/**
 * SOP page visuals — three hand-built micro-mockups that illustrate
 * each sub-feature. All CSS, no images. Contained within their parent
 * card, never break out.
 */

export function HeroSopVisual() {
  return (
    <div className="hsv">
      <div className="hsv-stack hsv-a">
        <div className="hsv-chip">WRITTEN</div>
        <div className="hsv-row hsv-title">Refund approval</div>
        <div className="hsv-row hsv-meta">v 3.2 · 8 steps · owner Priya</div>
        <div className="hsv-bar"><span style={{ width: "86%" }} /></div>
        <div className="hsv-foot">86% compliance · 142 reads</div>
      </div>
      <div className="hsv-stack hsv-b">
        <div className="hsv-chip hsv-chip-blue">SCRIBE</div>
        <div className="hsv-video">
          <div className="hsv-play" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
          </div>
          <div className="hsv-video-bar"><span style={{ width: "37%" }} /></div>
        </div>
        <div className="hsv-row hsv-title hsv-sm">Onboarding a new vendor</div>
        <div className="hsv-row hsv-meta">4 chapters · 2m 14s</div>
      </div>
      <div className="hsv-stack hsv-c">
        <div className="hsv-chip hsv-chip-amber">FLOW</div>
        <div className="hsv-flow">
          <div className="hsv-node hsv-node-active">Ticket in</div>
          <div className="hsv-split">
            <div className="hsv-node">L1</div>
            <div className="hsv-node hsv-node-alt">Escalate</div>
          </div>
        </div>
        <div className="hsv-row hsv-meta">12 branches · SLA 4h</div>
      </div>

      <style jsx>{`
        .hsv {
          flex: 1;
          display: grid;
          grid-template-columns: 1.05fr 1fr 1fr;
          gap: 14px;
          align-items: stretch;
        }
        .hsv-stack {
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 18px;
          padding: 18px;
          display: flex; flex-direction: column; gap: 10px;
          position: relative;
          transition: transform 0.3s, border-color 0.3s;
        }
        .hsv-stack:hover { transform: translateY(-3px); border-color: var(--b-line-2); }
        .hsv-a { border-color: rgba(255,61,138,0.28); }
        .hsv-b { border-color: rgba(74,158,255,0.28); }
        .hsv-c { border-color: rgba(255,153,51,0.28); }
        .hsv-chip {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9px;
          letter-spacing: 0.18em;
          color: var(--b-pink);
          background: rgba(255,61,138,0.1);
          border: 1px solid rgba(255,61,138,0.28);
          border-radius: 100px;
          padding: 3px 8px;
          width: max-content;
        }
        .hsv-chip-blue {
          color: var(--b-blue); background: rgba(74,158,255,0.1); border-color: rgba(74,158,255,0.28);
        }
        .hsv-chip-amber {
          color: var(--b-amber); background: rgba(255,153,51,0.1); border-color: rgba(255,153,51,0.28);
        }
        .hsv-title { font-size: 17px; font-weight: 600; letter-spacing: -0.015em; color: var(--b-fg); line-height: 1.2; }
        .hsv-title.hsv-sm { font-size: 14px; }
        .hsv-meta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-t3);
          letter-spacing: 0.06em;
        }
        .hsv-bar {
          height: 4px; background: rgba(255,255,255,0.08); border-radius: 100px;
          overflow: hidden; margin-top: auto;
        }
        .hsv-bar span { display: block; height: 100%; background: var(--b-pink); border-radius: 100px; animation: bentoFillIn 1.4s cubic-bezier(0.2,0.9,0.3,1); transform-origin: left; }
        .hsv-foot {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-pink);
          letter-spacing: 0.02em;
        }
        .hsv-video {
          aspect-ratio: 16/9;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 10px;
          position: relative;
          overflow: hidden;
          background-image:
            linear-gradient(135deg, rgba(74,158,255,0.1), transparent 60%),
            radial-gradient(circle at 70% 30%, rgba(74,158,255,0.18), transparent 40%);
        }
        .hsv-play {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -60%);
          width: 30px; height: 30px;
          border-radius: 50%;
          background: var(--b-blue);
          color: var(--b-bg);
          display: grid; place-items: center;
        }
        .hsv-video-bar {
          position: absolute; bottom: 8px; left: 10px; right: 10px;
          height: 3px; background: rgba(255,255,255,0.18); border-radius: 100px;
          overflow: hidden;
        }
        .hsv-video-bar span { display: block; height: 100%; background: var(--b-blue); }
        .hsv-flow { display: flex; flex-direction: column; gap: 6px; margin: auto 0; }
        .hsv-node {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 8px;
          padding: 8px 10px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-t2);
          letter-spacing: 0.04em;
          text-align: center;
        }
        .hsv-node-active {
          border-color: var(--b-amber);
          color: var(--b-amber);
          background: rgba(255,153,51,0.06);
        }
        .hsv-split { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .hsv-node-alt {
          background: rgba(255,61,138,0.08);
          border-color: rgba(255,61,138,0.28);
          color: var(--b-pink);
        }
        @media (max-width: 520px) {
          .hsv { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

/* --- Written SOP: a document with structured fields --- */
export function WrittenSopVisual() {
  return (
    <div className="wsv">
      <div className="wsv-header">
        <div className="wsv-dots" aria-hidden>
          <span /><span /><span />
        </div>
        <div className="wsv-path">workwrk / sops / refund-approval · v3.2</div>
      </div>
      <div className="wsv-meta-row">
        <span className="wsv-meta-pill"><em>Owner</em> Priya S.</span>
        <span className="wsv-meta-pill"><em>Reviewer</em> Ravi K.</span>
        <span className="wsv-meta-pill wsv-live"><em>Status</em> Live</span>
      </div>
      <h4 className="wsv-title">Refund approval (India · B2C)</h4>
      <ol className="wsv-steps">
        <li><span className="wsv-n">01</span> Check order in Razorpay · confirm payment captured</li>
        <li><span className="wsv-n">02</span> Verify refund window · 14 days from delivery</li>
        <li><span className="wsv-n">03</span> Slack <code>#ops-refunds</code> for amounts &gt; ₹10k</li>
        <li><span className="wsv-n">04</span> Trigger refund · attach ticket ID in note</li>
        <li><span className="wsv-n">05</span> Reply to customer with ETA · 5–7 working days</li>
      </ol>
      <div className="wsv-footer">
        <span className="wsv-diff">+ step 03 added Mar 12 · approved Ravi K.</span>
        <span className="wsv-stat"><i />86% compliance · 142 reads</span>
      </div>
      <style jsx>{`
        .wsv {
          flex: 1;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 18px;
          padding: 22px 24px 20px;
          display: flex; flex-direction: column; gap: 14px;
          font-size: 13px;
          position: relative;
        }
        .wsv-header {
          display: flex; align-items: center; gap: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--b-line);
        }
        .wsv-dots { display: flex; gap: 5px; }
        .wsv-dots span { width: 9px; height: 9px; border-radius: 50%; }
        .wsv-dots span:nth-child(1) { background: #ff5e5b; }
        .wsv-dots span:nth-child(2) { background: #ffba49; }
        .wsv-dots span:nth-child(3) { background: var(--b-lime); }
        .wsv-path {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-t3);
          letter-spacing: 0.04em;
        }
        .wsv-meta-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .wsv-meta-pill {
          padding: 4px 9px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          font-size: 11px; color: var(--b-off);
          display: inline-flex; align-items: center; gap: 5px;
        }
        .wsv-meta-pill em {
          font-family: var(--font-geist-mono), monospace;
          font-style: normal;
          font-size: 9px;
          color: var(--b-t3);
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .wsv-meta-pill.wsv-live {
          background: rgba(212,255,46,0.08);
          border-color: rgba(212,255,46,0.3);
          color: var(--b-lime);
        }
        .wsv-title {
          font-size: 20px; font-weight: 600; letter-spacing: -0.025em;
          color: var(--b-fg); margin: 0;
        }
        .wsv-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .wsv-steps li {
          display: grid; grid-template-columns: 28px 1fr; align-items: start;
          gap: 10px;
          font-size: 13px;
          color: var(--b-off);
          line-height: 1.45;
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          transition: all 0.25s;
        }
        .wsv-steps li:hover { border-color: var(--b-line-2); }
        .wsv-n {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-pink);
          letter-spacing: 0.04em;
          padding-top: 1px;
        }
        .wsv-steps code {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11.5px;
          background: var(--b-card-3);
          padding: 1px 6px;
          border-radius: 4px;
          color: var(--b-fg);
        }
        .wsv-footer {
          display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
          padding-top: 10px;
          border-top: 1px solid var(--b-line);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
        }
        .wsv-diff { color: var(--b-lime); }
        .wsv-stat { color: var(--b-pink); display: inline-flex; align-items: center; gap: 6px; }
        .wsv-stat i {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--b-pink);
          box-shadow: 0 0 8px var(--b-pink);
          display: inline-block;
        }
      `}</style>
    </div>
  );
}

/* --- Scribe recording: video frame + step extraction --- */
export function ScribeVisual() {
  const chapters = [
    { t: "0:00", title: "Open Razorpay dashboard", active: false },
    { t: "0:24", title: "Search order by ticket ID", active: true },
    { t: "1:02", title: "Trigger partial refund", active: false },
    { t: "1:48", title: "Slack the customer", active: false },
  ];
  return (
    <div className="scv">
      <div className="scv-video">
        <div className="scv-tape">
          <span /><span /><span /><span /><span /><span />
        </div>
        <div className="scv-rec">
          <span className="scv-rec-dot" /> REC · 02:14
        </div>
        <div className="scv-caption">
          &ldquo;So I search for the order by ticket ID here…&rdquo;
        </div>
        <div className="scv-bar">
          <span style={{ width: "46%" }} />
        </div>
      </div>
      <div className="scv-extract">
        <div className="scv-header">
          <span className="scv-header-label">AI-extracted steps</span>
          <span className="scv-header-sparkle" aria-hidden>✦</span>
        </div>
        <ol className="scv-list">
          {chapters.map((c) => (
            <li key={c.t} className={c.active ? "is-active" : ""}>
              <span className="scv-t">{c.t}</span>
              <span className="scv-title">{c.title}</span>
            </li>
          ))}
        </ol>
      </div>
      <style jsx>{`
        .scv {
          flex: 1;
          display: grid;
          grid-template-rows: 1.1fr 1fr;
          gap: 12px;
        }
        .scv-video {
          position: relative;
          border-radius: 14px;
          background:
            linear-gradient(135deg, #1f2a40, #0d1626 60%, #0a0a0a);
          border: 1px solid var(--b-line);
          overflow: hidden;
          min-height: 180px;
        }
        .scv-tape {
          position: absolute; inset: 14px 14px 34px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(2, 1fr);
          gap: 8px;
        }
        .scv-tape span {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 6px;
        }
        .scv-rec {
          position: absolute; top: 12px; right: 14px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; color: var(--b-fg);
          background: rgba(0,0,0,0.5);
          padding: 4px 9px;
          border-radius: 100px;
          display: inline-flex; align-items: center; gap: 6px;
          letter-spacing: 0.14em;
        }
        .scv-rec-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #ff5e5b;
          box-shadow: 0 0 8px #ff5e5b;
          animation: bentoPulse 1.2s ease-in-out infinite;
        }
        .scv-caption {
          position: absolute; bottom: 28px; left: 14px; right: 14px;
          font-size: 12.5px;
          color: var(--b-off);
          line-height: 1.45;
          font-style: italic;
          text-shadow: 0 2px 12px rgba(0,0,0,0.8);
        }
        .scv-bar {
          position: absolute; bottom: 14px; left: 14px; right: 14px;
          height: 3px; background: rgba(255,255,255,0.12);
          border-radius: 100px;
        }
        .scv-bar span {
          display: block; height: 100%;
          background: var(--b-blue);
          border-radius: 100px;
        }
        .scv-extract {
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 16px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .scv-header {
          display: flex; align-items: center; gap: 8px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .scv-header-label { color: var(--b-blue); }
        .scv-header-sparkle { color: var(--b-blue); animation: bentoSparkle 3s ease-in-out infinite; }
        .scv-list {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-direction: column; gap: 4px;
        }
        .scv-list li {
          display: grid; grid-template-columns: 44px 1fr;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          font-size: 12.5px;
          color: var(--b-t2);
          border-radius: 8px;
          border: 1px solid transparent;
          transition: all 0.2s;
        }
        .scv-list li.is-active {
          background: var(--b-card);
          border-color: rgba(74,158,255,0.35);
          color: var(--b-fg);
        }
        .scv-t {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-t3);
          letter-spacing: 0.06em;
        }
        .scv-list li.is-active .scv-t { color: var(--b-blue); }
      `}</style>
    </div>
  );
}

/* --- Process flow: branching diagram --- */
export function FlowVisual() {
  return (
    <div className="fv">
      <div className="fv-node fv-start">
        <span className="fv-chip">TRIGGER</span>
        <span className="fv-label">Customer opens ticket</span>
      </div>
      <div className="fv-edge" />
      <div className="fv-node fv-decision">
        <span className="fv-chip fv-chip-amber">DECISION</span>
        <span className="fv-label">Severity?</span>
        <div className="fv-branches">
          <span>P0 / P1</span>
          <span>P2 / P3</span>
        </div>
      </div>
      <div className="fv-split">
        <div className="fv-col">
          <div className="fv-edge fv-edge-left" />
          <div className="fv-node fv-node-pk">
            <span className="fv-chip fv-chip-pink">ACTION</span>
            <span className="fv-label">Page on-call immediately</span>
            <div className="fv-sla">SLA · 15 min</div>
          </div>
        </div>
        <div className="fv-col">
          <div className="fv-edge fv-edge-right" />
          <div className="fv-node fv-node-bl">
            <span className="fv-chip fv-chip-blue">ACTION</span>
            <span className="fv-label">Queue for L1 support</span>
            <div className="fv-sla">SLA · 4 hours</div>
          </div>
        </div>
      </div>
      <div className="fv-legend">
        <span><i style={{ background: "var(--b-amber)" }} /> 12 branches</span>
        <span><i style={{ background: "var(--b-lime)" }} /> 3 escalations / month</span>
      </div>
      <style jsx>{`
        .fv {
          flex: 1;
          display: flex; flex-direction: column; align-items: center;
          gap: 8px;
          padding: 10px 0 0;
        }
        .fv-node {
          width: 100%;
          max-width: 280px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 12px;
          padding: 12px 16px;
          text-align: center;
          position: relative;
          transition: all 0.3s;
        }
        .fv-node:hover { transform: translateY(-2px); border-color: var(--b-line-2); }
        .fv-decision { border-color: rgba(255,153,51,0.35); }
        .fv-node-pk { border-color: rgba(255,61,138,0.35); max-width: 100%; }
        .fv-node-bl { border-color: rgba(74,158,255,0.35); max-width: 100%; }
        .fv-chip {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9px;
          letter-spacing: 0.2em;
          color: var(--b-t3);
          display: block;
          margin-bottom: 4px;
        }
        .fv-chip-amber { color: var(--b-amber); }
        .fv-chip-pink { color: var(--b-pink); }
        .fv-chip-blue { color: var(--b-blue); }
        .fv-label {
          font-size: 13.5px;
          font-weight: 500;
          color: var(--b-fg);
          display: block;
        }
        .fv-branches {
          display: flex; justify-content: space-between;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px dashed var(--b-line);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          color: var(--b-t3);
          letter-spacing: 0.06em;
        }
        .fv-edge {
          width: 1.5px; height: 22px;
          background: linear-gradient(to bottom, var(--b-line), var(--b-line-2));
        }
        .fv-split {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 10px; width: 100%;
          margin-top: 2px;
        }
        .fv-col { display: flex; flex-direction: column; align-items: center; gap: 0; }
        .fv-edge-left, .fv-edge-right {
          width: 50%; height: 18px;
          border-top: 1.5px dashed var(--b-line-2);
          border-radius: 0;
          background: transparent;
        }
        .fv-edge-left { margin-right: 50%; border-left: 1.5px dashed var(--b-line-2); border-top-left-radius: 12px; }
        .fv-edge-right { margin-left: 50%; border-right: 1.5px dashed var(--b-line-2); border-top-right-radius: 12px; }
        .fv-sla {
          margin-top: 8px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
        }
        .fv-node-pk .fv-sla { color: var(--b-pink); }
        .fv-node-bl .fv-sla { color: var(--b-blue); }
        .fv-legend {
          display: flex; gap: 18px;
          margin-top: 10px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-t3);
          letter-spacing: 0.06em;
        }
        .fv-legend span { display: inline-flex; align-items: center; gap: 6px; }
        .fv-legend i {
          width: 6px; height: 6px; border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 8px currentColor;
        }
      `}</style>
    </div>
  );
}
