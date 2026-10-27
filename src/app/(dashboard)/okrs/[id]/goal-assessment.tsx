"use client";

// The On track? block inside the goal page's Summary card (spec-goals
// /okrs/[id] body 1). The verdict is the ONE deterministic verdict
// (src/lib/goal-verdict.ts), the same one the goal's /okrs row shows; the
// server page passes it in so it paints at once, and GET /api/okrs/[id]/assess
// adds the pace line, the headline, two or three reasons and one next step
// (written by the org's AI when one is configured, never changing the word).
// Loading is a three-line skeleton; a failure says so with Retry.
//
// Staying current: every write on this page (a check-in, a target added or
// deleted, work linked, the goal's dates edited) ends in router.refresh(),
// which repaints the ring and the target rows from the server. The words
// here come from a client fetch, so they have to follow that refresh or the
// Summary card contradicts its own ring ("0% done" beside 50%). The caller
// passes a refreshKey that moves on every server render; an assessment is
// only shown for the key it was fetched for, and until the new one lands
// the chip reads the fresh server verdict and the text is the skeleton.
//
// A repeating goal (docs/plans/recurring-goals.md E2, E4): the block follows
// the period control. For a period other than the one running now it asks
// assess?period=<key>. A CLOSED period shows its result where the verdict is
// ("September 2026: Hit, 112%") with each target's final numbers, from the
// frozen period (the server never asks the AI for it), and no next step. A
// running repeating goal at 100% reads "Target hit", not Completed.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { ToneChip } from "@/components/people/person-bits";
import { type GoalVerdict } from "@/lib/goal-verdict";
import { goalChip, RESULT_TONE } from "@/lib/goals/goal-form";
import type { GoalResult } from "@/lib/goals/goal-period";

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
  source: "ai" | "heuristic" | "frozen";
  /** A closed period's frozen result (assess?period=). */
  closed?: boolean;
  periodLabel?: string;
  result?: GoalResult;
  resultLabel?: string;
  attainment?: number | null;
}

/** A closed period's result, as the server page knows it before the fetch. */
export interface ClosedResult {
  periodLabel: string;
  result: GoalResult;
  resultLabel: string;
  attainment: number | null;
}

/**
 * A fetched assessment remembers the refresh key it was fetched for and the
 * server verdict the page held at that moment.
 */
export interface AssessmentEntry<T extends { verdict: GoalVerdict } = Assessment> {
  key: string;
  verdictAtFetch: GoalVerdict;
  data: T;
}

/**
 * What the block shows for the page as it is NOW. An entry fetched for an
 * older refresh key is not shown (its pace line and reasons describe numbers
 * the ring no longer shows), and the chip always takes the server's verdict
 * once that verdict has moved past the one the entry was fetched beside, so
 * the chip never lags the /okrs row while the refetch runs.
 */
export function pickAssessment<T extends { verdict: GoalVerdict }>(
  entry: AssessmentEntry<T> | null,
  key: string,
  initialVerdict: GoalVerdict,
): { current: T | null; verdict: GoalVerdict } {
  const current = entry && entry.key === key && entry.verdictAtFetch === initialVerdict ? entry.data : null;
  return { current, verdict: current ? current.verdict : initialVerdict };
}

// One counter per goal that moves each time the server hands the page a new
// render (router.refresh() after any write). GoalWorkCards marks it, since
// its `targets` prop is a fresh array on every server render; the Summary
// reads it. A module store because the two sit in different server-rendered
// cards with no client parent to share state through.
const renders = new Map<string, number>();
const listeners = new Set<() => void>();
export function markGoalServerRender(okrId: string) {
  renders.set(okrId, (renders.get(okrId) ?? 0) + 1);
  listeners.forEach((l) => l());
}
function subscribeRenders(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useGoalServerRender(okrId: string): number {
  return useSyncExternalStore(subscribeRenders, () => renders.get(okrId) ?? 0, () => 0);
}

const CADENCE_WORD: Record<string, string> = { WEEKLY: "weekly", BIWEEKLY: "every two weeks", MONTHLY: "monthly" };

export function GoalAssessment({ okrId, initialVerdict, refreshKey = "", cadence, canCheckIn, canEdit = true, onCheckIn, periodKey = null, closed = null, goal = null }: {
  okrId: string;
  /** A period other than the one running now (assess?period=). */
  periodKey?: string | null;
  /** That period is closed: its result, painted at once. */
  closed?: ClosedResult | null;
  /** A repeating goal's cadence and end, for "Target hit". */
  goal?: { repeat?: string | null; completedAt?: string | null } | null;
  /** False for a viewer who cannot edit the goal: the next step is the
   *  owner's to take (adding targets, fixing dates), so it is labelled so. */
  canEdit?: boolean;
  initialVerdict: GoalVerdict;
  /** Moves whenever the server re-renders the page; a new key refetches. */
  refreshKey?: string;
  cadence: string;
  canCheckIn: boolean;
  onCheckIn?: () => void;
}) {
  const [entry, setEntry] = useState<AssessmentEntry | null>(null);
  // The key a failure belongs to, so a refresh after a failed fetch tries
  // again on its own and Retry is only offered for the page as it is now.
  const [errKey, setErrKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${refreshKey}#${tick}`;
  const retry = useCallback(() => { setTick((n) => n + 1); }, []);
  useEffect(() => {
    let active = true;
    const verdictAtFetch = initialVerdict;
    fetch(`/api/okrs/${okrId}/assess${periodKey ? `?period=${encodeURIComponent(periodKey)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (active) setEntry({ key, verdictAtFetch, data: j.data ?? j }); })
      .catch(() => { if (active) setErrKey(key); });
    return () => { active = false; };
    // initialVerdict is read, not tracked: a verdict change always comes
    // with a server render, which moves refreshKey, so tracking it too
    // would fetch twice for one refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okrId, key, periodKey]);

  const { current: data, verdict } = pickAssessment(entry, key, initialVerdict);
  const err = errKey === key && !data;
  const chip = goalChip(verdict, goal ?? {});

  if (closed) {
    const words = data?.closed ? data : null;
    return (
      <div className="mt-4 flex flex-col gap-2" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink-2">{closed.periodLabel}:</span>
          <ToneChip tone={RESULT_TONE[closed.result] ?? "neutral"} label={closed.resultLabel} />
          {closed.result !== "NOT_MEASURED" && closed.attainment != null ? <span className="text-sm tabular-nums text-ink-2">{closed.attainment}%</span> : null}
        </div>
        {words ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {words.reasons.map((r, i) => <li key={i} className="text-sm text-ink-2">{r}</li>)}
          </ul>
        ) : err ? null : (
          <div className="flex flex-col gap-1.5" aria-hidden>
            <span className="h-3 w-3/5 rounded bg-skeleton os-skeleton-pulse" />
          </div>
        )}
      </div>
    );
  }
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
          <span className="h-4 w-3/5 rounded bg-skeleton os-skeleton-pulse" />
          <span className="h-3 w-4/5 rounded bg-skeleton os-skeleton-pulse" />
          <span className="h-3 w-2/5 rounded bg-skeleton os-skeleton-pulse" />
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
            <span><span className="font-medium">{canEdit ? "Next:" : "Next for the owner:"}</span> {data.recommendation}</span>
          </p>
          <p className="m-0 flex items-center gap-1 text-xs text-ink-2">
            {data.source === "ai" ? <><Sparkles className="h-3 w-3" aria-hidden /> AI summary from live goal data</> : "Assessed from live goal data"}
          </p>
        </>
      )}
    </div>
  );
}
