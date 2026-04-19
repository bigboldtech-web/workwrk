"use client";

export function AiHeroVisual() {
  return (
    <div className="aih">
      <div className="aih-prompt">
        <span className="aih-label">You</span>
        <div className="aih-bubble aih-you">
          Who on the sales team is likely to hit the ceiling next quarter?
        </div>
      </div>
      <div className="aih-prompt">
        <span className="aih-label aih-label-lime">WorkwrK AI</span>
        <div className="aih-bubble aih-them">
          <strong>3 candidates</strong>, based on 6 signals each:
          <ul>
            <li><span className="aih-ch">PS</span> Priya S. — 94 composite, +4 QoQ, 3 kudos, 100% SOP</li>
            <li><span className="aih-ch aih-ch-blue">AJ</span> Amit J. — 87 composite, +6 QoQ, calibrated +1σ</li>
            <li><span className="aih-ch aih-ch-amber">NM</span> Neha M. — 71 → 79 curve, promoted once in 14mo</li>
          </ul>
          <div className="aih-cite">cited: 3 KPI streams · 8 reviews · 14 kudos · 2 SOP audits</div>
        </div>
      </div>
      <style jsx>{`
        .aih { flex: 1; display: flex; flex-direction: column; gap: 14px; }
        .aih-prompt { display: flex; flex-direction: column; gap: 6px; }
        .aih-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px; letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--b-t3);
        }
        .aih-label-lime { color: var(--b-lime); }
        .aih-bubble {
          padding: 14px 18px;
          border-radius: 14px;
          font-size: 14px;
          line-height: 1.5;
        }
        .aih-you {
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          color: var(--b-off);
          align-self: flex-end;
          max-width: 85%;
        }
        .aih-them {
          background: var(--b-bg);
          border: 1px solid rgba(212,255,46,0.3);
          color: var(--b-fg);
        }
        .aih-them strong { color: var(--b-lime); font-weight: 600; }
        .aih-them ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .aih-them li { display: grid; grid-template-columns: 30px 1fr; gap: 10px; font-size: 13px; color: var(--b-off); align-items: center; }
        .aih-ch {
          width: 28px; height: 22px;
          border-radius: 6px;
          background: var(--b-lime);
          color: var(--b-bg);
          font-size: 10.5px;
          font-weight: 700;
          display: inline-flex; align-items: center; justify-content: center;
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.04em;
        }
        .aih-ch-blue { background: var(--b-blue); }
        .aih-ch-amber { background: var(--b-amber); }
        .aih-cite {
          margin-top: 12px;
          padding-top: 10px;
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

export function AiPromptVisual() {
  return (
    <div className="apv">
      <div className="apv-head">
        <span className="apv-dot" /> Thread · sales-ops
        <span className="apv-meta">24 prompts · 3 contributors</span>
      </div>
      <div className="apv-msg apv-you">
        <span className="apv-role">Priya</span>
        Draft KRAs for a senior SDR who will carry a ₹50L quota.
      </div>
      <div className="apv-msg apv-ai">
        <span className="apv-role apv-role-lime">Engine</span>
        Based on your top SDRs and current KPIs:
        <ol>
          <li>Sourced pipeline: ₹80L/qtr · SAL→SQL ≥ 40%</li>
          <li>Outbound touches: 480/wk · 6 accts/day</li>
          <li>SOP compliance: 95% on refund &amp; demo flows</li>
          <li>Onboarding ramp: 90-day to full quota</li>
          <li>NPS from accts: ≥ 8.5 rolling 30d</li>
        </ol>
      </div>
      <div className="apv-msg apv-you">
        <span className="apv-role">Priya</span>
        Publish these to the SDR role · notify the team.
      </div>
      <div className="apv-actions">
        <span className="apv-action">✓ Approved · published to KRAs</span>
      </div>
      <style jsx>{`
        .apv {
          flex: 1;
          display: flex; flex-direction: column; gap: 8px;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 18px;
        }
        .apv-head {
          display: flex; align-items: center; gap: 10px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--b-line);
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t2);
          letter-spacing: 0.06em;
          margin-bottom: 4px;
        }
        .apv-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--b-lime);
          box-shadow: 0 0 8px var(--b-lime);
        }
        .apv-meta { margin-left: auto; color: var(--b-t3); font-size: 10px; }
        .apv-msg {
          padding: 12px 14px;
          border-radius: 10px;
          font-size: 13.5px;
          line-height: 1.5;
        }
        .apv-msg ol { margin: 8px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 5px; }
        .apv-msg ol li { color: var(--b-off); font-size: 12.5px; }
        .apv-you {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          color: var(--b-off);
        }
        .apv-ai {
          background: rgba(212,255,46,0.04);
          border: 1px solid rgba(212,255,46,0.25);
          color: var(--b-fg);
        }
        .apv-role {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--b-t3);
          display: block;
          margin-bottom: 4px;
        }
        .apv-role-lime { color: var(--b-lime); }
        .apv-actions { margin-top: auto; padding-top: 8px; }
        .apv-action {
          display: inline-flex;
          padding: 5px 10px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-lime);
          background: rgba(212,255,46,0.08);
          border: 1px solid rgba(212,255,46,0.3);
          border-radius: 100px;
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}

export function AiSignalVisual() {
  const signals = [
    { kind: "Attrition", person: "Ravi K.", severity: "high", reason: "SOP reads ↓70%, kudos ↓, 3 late check-ins" },
    { kind: "Drift", person: "Refund SOP v2.1", severity: "med", reason: "Actual KPI diverges from written flow" },
    { kind: "Calibration", person: "Manager cohort", severity: "low", reason: "Pooja's team +0.8σ above peer mean" },
  ];
  return (
    <div className="asv">
      <div className="asv-head">
        <span className="asv-title">Signals · today</span>
        <span className="asv-pill">3 new</span>
      </div>
      {signals.map((s) => (
        <div key={s.person} className={`asv-row asv-${s.severity}`}>
          <div className="asv-top">
            <span className="asv-kind">{s.kind.toUpperCase()}</span>
            <span className="asv-who">{s.person}</span>
          </div>
          <div className="asv-reason">{s.reason}</div>
          <div className="asv-actions">
            <span className="asv-act">Open thread</span>
            <span className="asv-act">Dismiss</span>
          </div>
        </div>
      ))}
      <style jsx>{`
        .asv {
          flex: 1;
          display: flex; flex-direction: column; gap: 10px;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 16px;
        }
        .asv-head {
          display: flex; align-items: center; justify-content: space-between;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--b-line);
        }
        .asv-title { font-size: 14px; font-weight: 600; color: var(--b-fg); }
        .asv-pill {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          color: var(--b-blue);
          background: rgba(74,158,255,0.1);
          border: 1px solid rgba(74,158,255,0.3);
          padding: 3px 8px;
          border-radius: 100px;
          letter-spacing: 0.06em;
        }
        .asv-row {
          padding: 12px 14px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 10px;
          border-left-width: 3px;
        }
        .asv-row.asv-high { border-left-color: var(--b-pink); }
        .asv-row.asv-med { border-left-color: var(--b-amber); }
        .asv-row.asv-low { border-left-color: var(--b-blue); }
        .asv-top {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 6px;
        }
        .asv-kind {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px;
          color: var(--b-t3);
          letter-spacing: 0.14em;
        }
        .asv-who { font-size: 13px; font-weight: 600; color: var(--b-fg); }
        .asv-reason { font-size: 12.5px; color: var(--b-t2); line-height: 1.45; }
        .asv-actions {
          display: flex; gap: 10px; margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed var(--b-line);
        }
        .asv-act {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          color: var(--b-t3);
          letter-spacing: 0.06em;
          cursor: default;
        }
      `}</style>
    </div>
  );
}

export function AiGuardrailVisual() {
  const rails = [
    { label: "Zero training", on: true },
    { label: "Data in Mumbai", on: true },
    { label: "PII masking", on: true },
    { label: "Audit log · signed", on: true },
    { label: "Write requires approval", on: true },
    { label: "Kill-switch · org-wide", on: true },
  ];
  return (
    <div className="agv">
      <div className="agv-head">
        <span className="agv-label">AI Safety · live</span>
        <span className="agv-pulse" />
      </div>
      {rails.map((r) => (
        <div key={r.label} className="agv-row">
          <span className={`agv-sw ${r.on ? "on" : ""}`}>
            <span className="agv-nub" />
          </span>
          <span className="agv-name">{r.label}</span>
          <span className="agv-status">{r.on ? "ON" : "OFF"}</span>
        </div>
      ))}
      <div className="agv-sig">
        <span>cryptographic audit log · signed with your org key</span>
      </div>
      <style jsx>{`
        .agv {
          flex: 1;
          display: flex; flex-direction: column; gap: 8px;
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 18px;
        }
        .agv-head {
          display: flex; align-items: center; justify-content: space-between;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--b-line);
          margin-bottom: 4px;
        }
        .agv-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-pink);
          letter-spacing: 0.14em;
        }
        .agv-pulse {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--b-lime);
          box-shadow: 0 0 10px var(--b-lime);
          animation: bentoPulse 1.8s ease-in-out infinite;
        }
        .agv-row {
          display: grid;
          grid-template-columns: 34px 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 10px;
        }
        .agv-sw {
          width: 30px; height: 18px;
          border-radius: 100px;
          background: var(--b-card-3);
          position: relative;
          transition: background 0.25s;
        }
        .agv-sw.on { background: rgba(212,255,46,0.25); }
        .agv-nub {
          position: absolute; top: 2px; left: 2px;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: var(--b-t3);
          transition: all 0.25s;
        }
        .agv-sw.on .agv-nub {
          left: calc(100% - 16px);
          background: var(--b-lime);
          box-shadow: 0 0 8px var(--b-lime);
        }
        .agv-name { font-size: 13px; color: var(--b-fg); }
        .agv-status {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          color: var(--b-lime);
          letter-spacing: 0.12em;
        }
        .agv-sig {
          padding-top: 10px;
          margin-top: auto;
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
