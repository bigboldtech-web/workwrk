"use client";

// The On track? block inside the goal page's Summary card (spec-goals
// /okrs/[id] body 1). The verdict is the ONE deterministic verdict
// (src/lib/goal-verdict.ts), the same one the goal's /okrs row shows; the
// server page passes it in so it paints at once, and GET /api/okrs/[id]/assess
// adds the pace line, the headline, two or three reasons and one next step
// (written by the org's AI when one is configured, never changing the word).
// Loading is a three-line skeleton; a failure says so with Retry.

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { ToneChip } from "@/components/people/person-bits";
import { verdictChip, type GoalVerdict } from "@/lib/goal-verdict";

interface Assessment {
  verdict: GoalVerdict;
  headline: string;
  reasons: string[];
  recommendation: string;
  progress: number | null;
  pctTimeElapsed: number | null;
  daysLeft: number | null;
  daysSinceCheckin: number | null;
  isStale: boolean;
  source: "ai" | "heuristic";
}

const CADENCE_WORD: Record<string, string> = { WEEKLY: "weekly", BIWEEKLY: "every two weeks", MONTHLY: "monthly" };

export function GoalAssessment({ okrId, initialVerdict, cadence, canCheckIn, onCheckIn }: {
  okrId: string;
  initialVerdict: GoalVerdict;
  cadence: string;
  canCheckIn: boolean;
  onCheckIn?: () => void;
}) {
  const [data, setData] = useState<Assessment | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => { setErr(false); setData(null); setTick((n) => n + 1); }, []);
  useEffect(() => {
    let active = true;
    fetch(`/api/okrs/${okrId}/assess`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (active) setData(j.data ?? j); })
      .catch(() => { if (active) setErr(true); });
    return () => { active = false; };
  }, [okrId, tick]);

  const verdict = data?.verdict ?? initialVerdict;
  const chip = verdictChip(verdict);
  const pace = data ? [
    data.progress != null ? `${data.progress}% done` : null,
    data.pctTimeElapsed != null ? `${data.pctTimeElapsed}% of time used` : null,
    data.daysLeft != null ? `${data.daysLeft} ${data.daysLeft === 1 ? "day" : "days"} left` : null,
  ].filter(Boolean).join(" · ") : "";

  return (
    <div className="mt-4 flex flex-col gap-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink-2">On track?</span>
        <ToneChip tone={chip.tone} label={chip.label} />
        {pace ? <span className="text-sm tabular-nums text-ink-2">{pace}</span> : null}
      </div>
      {err ? (
        <p className="m-0 text-sm text-ink-2">Couldn&apos;t assess this goal · <button type="button" onClick={retry} className="text-brand-deep hover:underline">Retry</button></p>
      ) : !data ? (
        <div className="flex flex-col gap-1.5" aria-hidden>
          <span className="h-4 w-3/5 animate-pulse rounded bg-surface-2" />
          <span className="h-3 w-4/5 animate-pulse rounded bg-surface-2" />
          <span className="h-3 w-2/5 animate-pulse rounded bg-surface-2" />
        </div>
      ) : (
        <>
          <p className="m-0 text-row font-medium text-ink">{data.headline}</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {data.reasons.map((r, i) => <li key={i} className="text-sm text-ink-2">{r}</li>)}
          </ul>
          {data.isStale && verdict !== "completed" ? (
            <p className="m-0 flex items-center gap-1.5 text-sm text-warning-text">
              <Clock className="h-4 w-4" aria-hidden />
              {data.daysSinceCheckin != null ? `Last check-in ${data.daysSinceCheckin} days ago` : "No check-in yet"}, cadence is {CADENCE_WORD[cadence] ?? cadence.toLowerCase()}.
              {canCheckIn && onCheckIn ? <button type="button" onClick={onCheckIn} className="text-brand-deep hover:underline">Check in</button> : null}
            </p>
          ) : null}
          <p className="m-0 flex items-center gap-2 rounded-md bg-subtle px-3 py-2 text-sm text-ink">
            <ArrowRight className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />
            <span><span className="font-medium">Next:</span> {data.recommendation}</span>
          </p>
          <p className="m-0 flex items-center gap-1 text-xs text-ink-2">
            {data.source === "ai" ? <><Sparkles className="h-3 w-3" aria-hidden /> AI summary from live goal data</> : "Assessed from live goal data"}
          </p>
        </>
      )}
    </div>
  );
}
