// GET /api/okrs/[id]/assess: the AUTOMATED "on track?" assessment for a goal.
//
// Reads the goal's real signals (rolled-up progress, each target's live
// numbers, check-in staleness, pace against the due date and the effort of
// the linked work) and returns the ONE verdict (src/lib/goal-verdict.ts, the
// same function every /okrs row uses) with a short grounded explanation.
// The AI, when configured, writes only the explanation; it can never change
// the verdict. Visibility mirrors the goal (canSeeGoal). Reads only.

import { viewerFromSession } from "@/lib/access/viewer";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";
import { computeGoalRollups, enrichKeyResults, goalRollupFor, KR_KPI_SELECT } from "@/lib/alignment";
import { computeGoalEffort } from "@/lib/goal-effort";
import { verdictNarrative, type GoalVerdict } from "@/lib/goal-verdict";
import { getAnthropicForOrg, modelFor, createMessageWithFallback } from "@/lib/ai-client";
import { aiAutoAllowed } from "@/lib/ai-allowance";
import { aiOffResponse } from "@/lib/ai/ai-off-gate";
import { currentPeriodPayload, orgPeriodSettings, settleOnRead } from "@/lib/goals/goal-periods.server";
import { goalVerdicts } from "@/lib/goals/goal-verdicts.server";
import { periodVerdict, periodView, type PeriodView } from "@/lib/goals/goal-period-view.server";
import { resultWords } from "@/lib/goals/goal-form";
import type { GoalResult } from "@/lib/goals/goal-period";

type AiVerdictReply = { headline?: string; reasons?: string[]; recommendation?: string };

// The AI writes the words around the verdict, never the verdict (spec-goals
// section 3: the list and this page must agree). It runs at most once per
// goal per ten minutes for the same numbers, so opening a goal page twice
// does not bill the org twice.
const AI_TTL_MS = 10 * 60 * 1000;
const aiCache = new Map<string, { at: number; reply: AiVerdictReply }>();

const SYSTEM = `You are a pragmatic performance manager explaining whether a goal is on track. You are given the goal's real numbers as JSON, including "verdict", which is final. Reply with ONLY a JSON object:
{ "headline": "one plain-language sentence (max ~14 words), the bottom line, consistent with the verdict",
  "reasons": ["2-3 short reasons grounded in the numbers"],
  "recommendation": "one concrete next action (max ~16 words)" }
Rules:
- Never contradict the given verdict.
- Ground every reason in a number you were given. Do NOT invent data.
- Plain sentences a manager would say. Never name data fields, never say "null", "percent is", "measured flag" or similar. Never use em dashes or double hyphens.
- Return ONLY the JSON.`;

const clean = (t: string) => t.replace(/\s*[\u2014\u2013]\s*|\s--\s/g, ". ").trim();

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

// A closed period's result in the verdict's place (the chip's tone and the
// filters read a verdict): Hit reads as completed, Partly hit as on track.
const VERDICT_OF_RESULT: Record<GoalResult, GoalVerdict> = { HIT: "completed", PARTLY_HIT: "on_track", MISSED: "off_track", NOT_MEASURED: "not_measured" };

/**
 * ?period=<key> of a CLOSED period (docs/plans/recurring-goals.md E2, E4): its
 * frozen result, "September 2026: Hit, 112%", with each target's final
 * numbers. Nothing is recomputed and the AI is never asked: the result is
 * final, so there is nothing for it to explain.
 */
function frozenAssessment(v: PeriodView) {
  const result = v.result ?? "NOT_MEASURED";
  const label = v.resultLabel ?? "Not measured";
  return {
    closed: true,
    periodKey: v.key,
    periodLabel: v.label,
    result,
    resultLabel: label,
    attainment: v.attainment,
    scored: v.scored,
    progress: v.progress,
    measured: v.progress != null,
    verdict: VERDICT_OF_RESULT[result],
    pctTimeElapsed: 100,
    daysLeft: 0,
    daysSinceCheckin: null,
    isStale: false,
    headline: `${v.label}: ${resultWords(label, v.attainment, result)}`,
    reasons: v.targets.slice(0, 3).map((t) => `${t.title}: ${num(t.currentValue)} of ${num(t.targetValue)}${t.unit ? ` ${t.unit}` : ""}`),
    recommendation: "",
    source: "frozen" as const,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: orgId },
    include: {
      keyResults: { orderBy: { createdAt: "asc" }, include: { checkIns: { orderBy: { createdAt: "desc" }, take: 1 }, kpi: { select: KR_KPI_SELECT } } },
    },
  });
  if (!okr) return jsonError("Not found", 404);
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);

  // A repeating goal is settled first, then paced over its current period
  // from trackedFrom (docs/plans/recurring-goals.md E4), and the words name
  // the period ("On track for October 2026.").
  const now = new Date();
  if (okr.repeat) await settleOnRead(orgId, [okr.id], "a goal's assessment", now);

  // ?period=: one period of a repeating goal. A closed one answers its
  // frozen result here, before any rollup, effort or AI; a period still
  // open (the current one, or one in its grace) is assessed below over its
  // own window.
  const askedKey = new URL(req.url).searchParams.get("period");
  let asked: PeriodView | null = null;
  if (askedKey) {
    const stored = okr.repeat ? await prisma.goalPeriod.findUnique({ where: { okrId_key: { okrId: okr.id, key: askedKey } }, select: { status: true } }) : null;
    if (!stored) return jsonError("That period was not found.", 404);
    if (stored.status === "CLOSED") {
      const frozen = await periodView(null, okr.id, askedKey, await orgPeriodSettings(orgId), now);
      if (!frozen) return jsonError("That period was not found.", 404);
      return jsonSuccess(frozenAssessment(frozen));
    }
  }

  // Authoritative progress (the same rollup the list reads).
  const [keyResults, rollupCtx, effort] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    computeGoalRollups(orgId, now),
    computeGoalEffort(orgId, id, await viewerFromSession()),
  ]);
  const rollup = goalRollupFor(rollupCtx, okr);
  const period = okr.repeat && rollupCtx.periodSettings
    ? currentPeriodPayload(rollupCtx.periods.get(okr.id) ?? [], rollupCtx.periodSettings, now)
    : null;
  const { hasLinkedWork, totalHours, tasksDone, tasksOpen, lastActivityAt } = effort;
  if (askedKey && askedKey !== period?.key && rollupCtx.periodSettings) {
    asked = await periodView(rollupCtx, okr.id, askedKey, rollupCtx.periodSettings, now);
    if (!asked) return jsonError("That period was not found.", 404);
  }

  // The ONE verdict (goalVerdicts, which the list, the page and the profile
  // read too): the rollup, each target's newest check-in and whether a KPI
  // or a source feeds it, a repeating goal's period, and linked work. A
  // period that has ended but still takes numbers is paced over its own
  // window instead (all of its time is used), with its own last check-in.
  const { verdicts } = await goalVerdicts(rollupCtx, [okr], { has: () => hasLinkedWork }, now);
  let { verdict, signals: sig, daysSinceCheckin } = verdicts.get(okr.id)!;
  let measured = rollup.source !== "NONE";
  let progress = measured ? rollup.progress : null;
  let periodWords = period?.label ?? null;
  let targetSignals = keyResults.slice(0, 20).map((kr) => ({ title: kr.title.slice(0, 200), progress: kr.progress, current: kr.currentValue, target: kr.targetValue, unit: kr.unit?.slice(0, 40) ?? null }));
  if (asked) {
    const v = await periodVerdict(okr, asked, hasLinkedWork, now);
    verdict = v.verdict;
    sig = v.signals;
    daysSinceCheckin = v.daysSinceCheckin;
    measured = asked.progress != null;
    progress = asked.progress;
    periodWords = asked.label;
    targetSignals = asked.targets.slice(0, 20).map((t) => ({ title: t.title.slice(0, 200), progress: t.progress, current: t.currentValue, target: t.targetValue, unit: t.unit?.slice(0, 40) ?? null }));
  }
  const status = rollup.status || okr.status;
  const completed = verdict === "completed";
  const { pctTimeElapsed, isStale } = sig;
  // A repeating goal's days left are its period's calendar days in the
  // workspace zone, the number the period control shows beside it (E2).
  // A period that has ended has no days left to name.
  const daysLeft = asked ? null : period ? period.daysLeft : sig.daysLeft;

  const signals = {
    // Cut here: the caller wrote the goal, so its size is ours to set. The
    // prompt and the cache key are both bounded.
    title: okr.title.slice(0, 200),
    level: okr.level,
    progressPercent: progress,
    measured,
    completed,
    percentOfTimeElapsed: pctTimeElapsed,
    daysLeft,
    daysSinceLastCheckin: daysSinceCheckin,
    checkInIsStale: isStale,
    cadence: okr.checkInCadence,
    keyResults: targetSignals,
    effort: { hasLinkedWork, totalHours, tasksDone, tasksOpen, lastActivityAt },
    verdict,
  };

  const base = {
    progress, status, measured, verdict,
    pctTimeElapsed, daysLeft, daysSinceCheckin, isStale, hasLinkedWork,
    totalHours, tasksDone, tasksOpen,
  };
  const heuristic = verdictNarrative(verdict, { ...base, periodLabel: periodWords });

  // AI features turned off for the workspace (settings.data.aiEnabled): no
  // workspace content goes to the model provider, and the goal still gets
  // the assessment worked out without AI, as it does with no AI key.
  if (await aiOffResponse(orgId)) return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });
  const ai = await getAnthropicForOrg(orgId);
  if (ai.source === "shared" && !process.env.ANTHROPIC_API_KEY) {
    return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });
  }

  const cacheKey = `${id}:${JSON.stringify(signals)}`;
  const hit = aiCache.get(cacheKey);
  if (hit && Date.now() - hit.at < AI_TTL_MS) {
    return jsonSuccess({ ...base, ...heuristic, ...hit.reply, verdict, source: "ai" });
  }
  // An assessment nobody asked for never spends one of the plan's AI
  // questions; the model writes it only while the workspace has some left
  // (src/lib/ai-allowance.ts), and the worked-out one stands otherwise.
  if (!(await aiAutoAllowed(orgId, getUserId(session), ai.source))) return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });

  try {
    const message = await createMessageWithFallback(ai.client, {
      model: modelFor(ai, "claude-haiku-4-5"),
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(signals) }],
    });
    const textBlock = message.content.find((b: { type: string }) => b.type === "text") as { text?: string } | undefined;
    const match = (textBlock?.text ?? "").match(/\{[\s\S]*\}/);
    if (!match) return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });
    const parsed = JSON.parse(match[0]) as AiVerdictReply;
    const reply: AiVerdictReply = {
      headline: typeof parsed.headline === "string" && parsed.headline.trim() ? clean(parsed.headline) : heuristic.headline,
      reasons: Array.isArray(parsed.reasons) && parsed.reasons.length ? parsed.reasons.filter((r) => typeof r === "string").slice(0, 3).map(clean) : heuristic.reasons,
      recommendation: typeof parsed.recommendation === "string" && parsed.recommendation.trim() ? clean(parsed.recommendation) : heuristic.recommendation,
    };
    if (aiCache.size > 500) aiCache.clear();
    aiCache.set(cacheKey, { at: Date.now(), reply });
    return jsonSuccess({ ...base, ...reply, verdict, source: "ai" });
  } catch {
    // AI failed: the deterministic assessment still stands.
    return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });
  }
}
