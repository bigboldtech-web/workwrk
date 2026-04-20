"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, AlertTriangle, TrendingDown, Clock, Heart, ChevronRight } from "lucide-react";

type SignalKind = "KUDOS_DECAY" | "REVIEW_OVERDUE" | "SOP_DRIFT" | "KPI_STALE";

type Signal = {
  kind: SignalKind;
  severity: "high" | "med" | "low";
  target: string;
  reason: string;
  href?: string;
};

const kindMeta: Record<SignalKind, { label: string; icon: typeof Sparkles }> = {
  KUDOS_DECAY: { label: "Kudos decay", icon: Heart },
  REVIEW_OVERDUE: { label: "Review overdue", icon: Clock },
  SOP_DRIFT: { label: "SOP drift", icon: TrendingDown },
  KPI_STALE: { label: "KPI stale", icon: AlertTriangle },
};

const severityColor: Record<Signal["severity"], string> = {
  high: "#ff3d8a",
  med: "#ff9933",
  low: "#4a9eff",
};

export function AISignals() {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/ai/signals")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSignals(d?.signals ?? []))
      .catch(() => setSignals([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="sig-card">
        <div className="sig-head">
          <Sparkles size={14} style={{ color: "#d4ff2e" }} />
          <span className="sig-title">Signals · live</span>
        </div>
        <div className="sig-skeleton" />
      </div>
    );
  }

  if (!signals || signals.length === 0) {
    return (
      <div className="sig-card">
        <div className="sig-head">
          <Sparkles size={14} style={{ color: "#d4ff2e" }} />
          <span className="sig-title">Signals · live</span>
          <span className="sig-empty-pill">All clear</span>
        </div>
        <p className="sig-empty-body">
          Nothing off-track right now. The engine scans your org nightly for
          attrition risk, SOP drift, kudos decay, and stale KPIs.
        </p>
      </div>
    );
  }

  const visible = signals.slice(0, 6);

  return (
    <div className="sig-card">
      <div className="sig-head">
        <Sparkles size={14} style={{ color: "#d4ff2e" }} />
        <span className="sig-title">Signals · live</span>
        <span className="sig-count">{signals.length}</span>
      </div>

      <div className="sig-list">
        {visible.map((s, i) => {
          const meta = kindMeta[s.kind];
          const Icon = meta.icon;
          const color = severityColor[s.severity];
          const inner = (
            <>
              <span className="sig-icon" aria-hidden>
                <Icon size={13} />
              </span>
              <div className="sig-body">
                <div className="sig-top">
                  <span className="sig-kind">{meta.label.toUpperCase()}</span>
                  <span className="sig-target">{s.target}</span>
                </div>
                <p className="sig-reason">{s.reason}</p>
              </div>
              {s.href && (
                <ChevronRight
                  size={14}
                  style={{ color: "#707070", flexShrink: 0, marginTop: 2 }}
                />
              )}
            </>
          );
          const style = { ["--c" as string]: color } as React.CSSProperties;
          return s.href ? (
            <Link key={i} href={s.href} className="sig-row" style={style}>
              {inner}
            </Link>
          ) : (
            <div key={i} className="sig-row" style={style}>
              {inner}
            </div>
          );
        })}
      </div>

      {signals.length > visible.length && (
        <div className="sig-foot">+{signals.length - visible.length} more</div>
      )}

      <style>{`
        .sig-card {
          background: var(--b-card);
          border: 1px solid var(--b-accent-border);
          border-radius: 16px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          position: relative;
          overflow: hidden;
        }
        .sig-card::before {
          content: "";
          position: absolute;
          top: -40px;
          right: -40px;
          width: 180px;
          height: 180px;
          background: radial-gradient(circle, rgba(212, 255, 46, 0.12), transparent 70%);
          filter: blur(40px);
          pointer-events: none;
        }
        .sig-head {
          display: flex;
          align-items: center;
          gap: 8px;
          position: relative;
        }
        .sig-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--b-fg);
          letter-spacing: -0.01em;
        }
        .sig-count {
          margin-left: auto;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: #ff3d8a;
          background: rgba(255, 61, 138, 0.12);
          border: 1px solid rgba(255, 61, 138, 0.3);
          padding: 2px 8px;
          border-radius: 100px;
          letter-spacing: 0.06em;
        }
        .sig-empty-pill {
          margin-left: auto;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-accent-text);
          background: var(--b-accent-tint);
          border: 1px solid var(--b-accent-border);
          padding: 2px 10px;
          border-radius: 100px;
          letter-spacing: 0.06em;
        }
        .sig-empty-body {
          font-size: 13px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
          position: relative;
        }
        .sig-skeleton {
          height: 80px;
          background: var(--b-hover-tint);
          border-radius: 10px;
          animation: sig-pulse 1.4s ease-in-out infinite;
        }
        @keyframes sig-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .sig-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          position: relative;
        }
        .sig-row {
          display: grid;
          grid-template-columns: 26px 1fr auto;
          gap: 10px;
          padding: 10px 12px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-left: 2px solid var(--c);
          border-radius: 10px;
          text-decoration: none;
          transition: all 0.2s;
        }
        .sig-row:hover {
          background: var(--b-card-3);
          transform: translateX(2px);
        }
        .sig-icon {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          background: var(--b-hover-tint);
          color: var(--c);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .sig-body {
          min-width: 0;
        }
        .sig-top {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }
        .sig-kind {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9px;
          letter-spacing: 0.14em;
          color: var(--c);
        }
        .sig-target {
          font-size: 13px;
          font-weight: 600;
          color: var(--b-fg);
          letter-spacing: -0.01em;
        }
        .sig-reason {
          font-size: 12px;
          color: var(--b-t2);
          line-height: 1.45;
          margin: 0;
        }
        .sig-foot {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: var(--b-t3);
          letter-spacing: 0.08em;
          text-align: center;
          padding-top: 4px;
          position: relative;
        }
      `}</style>
    </div>
  );
}
