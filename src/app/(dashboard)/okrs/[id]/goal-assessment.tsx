"use client";

// GoalAssessment — the automated "on track?" card. Reads the goal's real
// signals (progress vs pace, check-in freshness, effort) and shows a verdict
// with a short, grounded explanation and one recommended next step. The verdict
// itself is deterministic; an AI writes the narrative (falls back to a plain
// one when no AI key). Mirrors GoalEffort's shape + styling.

import { useEffect, useState } from "react";
import { TrendingUp, AlertTriangle, TrendingDown, Sparkles, ArrowRight } from "lucide-react";

type Verdict = "on_track" | "at_risk" | "off_track";
interface Assessment {
  verdict: Verdict;
  headline: string;
  reasons: string[];
  recommendation: string;
  progress: number | null;
  pctTimeElapsed: number | null;
  daysLeft: number | null;
  source: "ai" | "heuristic";
}

const VERDICT: Record<Verdict, { label: string; color: string; bg: string; Icon: typeof TrendingUp }> = {
  on_track: { label: "On track", color: "#16a34a", bg: "rgba(22,163,74,.10)", Icon: TrendingUp },
  at_risk: { label: "At risk", color: "#c2820b", bg: "rgba(245,158,11,.12)", Icon: AlertTriangle },
  off_track: { label: "Off track", color: "#E2445C", bg: "rgba(226,68,92,.10)", Icon: TrendingDown },
};

export function GoalAssessment({ okrId }: { okrId: string }) {
  const [data, setData] = useState<Assessment | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/okrs/${okrId}/assess`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j) => { if (active) setData(j.data ?? j); })
      .catch(() => { if (active) setErr(true); });
    return () => { active = false; };
  }, [okrId]);

  if (err) return <p style={{ fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>Couldn&apos;t load the assessment.</p>;
  if (!data) return <p style={{ fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>Assessing…</p>;

  const v = VERDICT[data.verdict] ?? VERDICT.at_risk;
  const pace = data.progress != null && data.pctTimeElapsed != null
    ? `${data.progress}% done · ${data.pctTimeElapsed}% of time used${data.daysLeft != null ? ` · ${data.daysLeft}d left` : ""}`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: v.bg, color: v.color, fontSize: 13, fontWeight: 700 }}>
          <v.Icon style={{ width: 15, height: 15 }} /> {v.label}
        </span>
        {pace ? <span style={{ fontSize: 12.5, color: "var(--os-ink-3, #9aa3b2)", fontVariantNumeric: "tabular-nums" }}>{pace}</span> : null}
      </div>

      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: "var(--os-ink, #1e293b)" }}>{data.headline}</p>

      {data.reasons.length > 0 ? (
        <ul style={{ display: "flex", flexDirection: "column", gap: 5, margin: 0, paddingLeft: 16 }}>
          {data.reasons.map((r, i) => (
            <li key={i} style={{ fontSize: 13, lineHeight: 1.45, color: "var(--os-ink-2, #52525b)" }}>{r}</li>
          ))}
        </ul>
      ) : null}

      {data.recommendation ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 11px", borderRadius: 10, background: "var(--os-surface-1, #f4f4f5)" }}>
          <ArrowRight style={{ width: 15, height: 15, marginTop: 1, color: "#0073EA", flex: "none" }} />
          <span style={{ fontSize: 13, lineHeight: 1.45, color: "var(--os-ink, #1e293b)" }}><strong style={{ fontWeight: 600 }}>Next:</strong> {data.recommendation}</span>
        </div>
      ) : null}

      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--os-ink-3, #9aa3b2)" }}>
        <Sparkles style={{ width: 11, height: 11 }} /> {data.source === "ai" ? "AI assessment from live goal data" : "Auto-assessed from live goal data"}
      </span>
    </div>
  );
}
