// GET /api/okrs/[id]/assess — the AUTOMATED "on track?" assessment for a goal.
//
// Reads the goal's real signals — rolled-up progress + status, each key
// result's live numbers, check-in staleness, pace against the deadline, and the
// effort behind it (hours/tasks from linked KRA work) — and returns a verdict
// (on_track | at_risk | off_track) with a short, grounded explanation.
//
// The verdict is computed deterministically from the numbers first (so it
// always works and is consistent with the app's thresholds); the AI then writes
// the human narrative. If no AI key is configured, the heuristic narrative is
// returned as-is. Visibility mirrors the goal (canSeeGoal) — no extra leaks.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";
import { computeGoalRollups, enrichKeyResults, goalRollupFor, KR_KPI_SELECT } from "@/lib/alignment";
import { computeGoalEffort } from "@/lib/goal-effort";
import { getAnthropicForOrg, modelFor, createMessageWithFallback } from "@/lib/ai-client";

const DAY_MS = 24 * 60 * 60 * 1000;
const CADENCE_DAYS: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 31 };
type Verdict = "on_track" | "at_risk" | "off_track";

const SYSTEM = `You are a pragmatic performance manager assessing whether a goal is on track. You are given the goal's real numbers as JSON. Reply with ONLY a JSON object:
{ "verdict": "on_track" | "at_risk" | "off_track",
  "headline": "one plain-language sentence (max ~14 words) — the bottom line",
  "reasons": ["2-3 short bullet reasons grounded in the numbers"],
  "recommendation": "one concrete next action (max ~16 words)" }
Rules:
- Weigh PROGRESS vs PACE (percent of the time window elapsed): well behind pace = worse. Stale check-ins and no linked work moving are risk signals; steady effort is reassuring.
- Use the given "suggestedVerdict" as your prior; only diverge if the other signals clearly justify it.
- Ground every reason in a number you were given. Do NOT invent data. If the goal isn't measured yet, say so and flag at_risk.
- Return ONLY the JSON.`;

function heuristicVerdict(o: {
  progress: number | null; measured: boolean; completed: boolean;
  pctTimeElapsed: number | null; isStale: boolean; hasLinkedWork: boolean;
}): Verdict {
  if (o.completed || (o.progress ?? 0) >= 100) return "on_track";
  if (!o.measured || o.progress == null) return "at_risk"; // can't tell → flag it
  const gap = o.pctTimeElapsed != null ? o.progress - o.pctTimeElapsed : null;
  if (gap != null && gap < -25) return "off_track";
  if ((gap != null && gap < -10) || o.isStale || (o.pctTimeElapsed != null && o.pctTimeElapsed > 60 && !o.hasLinkedWork)) return "at_risk";
  return "on_track";
}

function heuristicNarrative(v: Verdict, s: {
  progress: number | null; pctTimeElapsed: number | null; daysLeft: number | null;
  isStale: boolean; daysSinceCheckin: number | null; hasLinkedWork: boolean;
  totalHours: number; tasksOpen: number; tasksDone: number;
}) {
  const reasons: string[] = [];
  if (s.progress != null && s.pctTimeElapsed != null) reasons.push(`${s.progress}% complete with ${s.pctTimeElapsed}% of the time window elapsed.`);
  else if (s.progress != null) reasons.push(`${s.progress}% complete.`);
  else reasons.push("No measurable key-result progress yet.");
  if (s.isStale) reasons.push(s.daysSinceCheckin != null ? `Last check-in was ${s.daysSinceCheckin} days ago.` : "No recent check-in.");
  if (s.hasLinkedWork) reasons.push(`${s.totalHours}h logged · ${s.tasksDone} done / ${s.tasksOpen} open on linked work.`);
  else reasons.push("No linked work is moving this goal.");
  const headline = v === "on_track" ? "On track for the deadline." : v === "off_track" ? "Well behind pace — needs attention." : "Slipping — a few risk signals.";
  const recommendation = v === "on_track" ? "Keep the check-in cadence and current pace." : !s.hasLinkedWork ? "Link the KRA/board doing the work so effort is tracked." : s.isStale ? "Post a check-in to refresh where each key result stands." : "Re-plan the lagging key results or add capacity.";
  return { headline, reasons: reasons.slice(0, 3), recommendation };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // Authoritative progress/status (same as the detail page shows).
  const [keyResults, rollupCtx] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    computeGoalRollups(orgId),
  ]);
  const rollup = goalRollupFor(rollupCtx, okr);
  const measured = rollup.source !== "NONE";
  const progress = measured ? rollup.progress : null;
  const status = rollup.status || okr.status;
  const completed = status === "COMPLETED";

  // Pace: how far through the time window are we vs how far along the goal is.
  const now = Date.now();
  const start = okr.startDate?.getTime() ?? null;
  const end = okr.endDate?.getTime() ?? null;
  let pctTimeElapsed: number | null = null, daysLeft: number | null = null;
  if (start != null && end != null && end > start) {
    pctTimeElapsed = Math.round(Math.min(1, Math.max(0, (now - start) / (end - start))) * 100);
    daysLeft = Math.max(0, Math.round((end - now) / DAY_MS));
  }

  // Check-in staleness across the goal's key results.
  const lastCheckIn = okr.keyResults
    .flatMap((kr) => kr.checkIns.map((c) => c.createdAt.getTime()))
    .reduce<number | null>((m, t) => (m == null || t > m ? t : m), null);
  const cadenceDays = CADENCE_DAYS[okr.checkInCadence] ?? 7;
  const daysSinceCheckin = lastCheckIn != null ? Math.floor((now - lastCheckIn) / DAY_MS) : null;
  const isStale = !completed && (lastCheckIn == null || now - lastCheckIn > cadenceDays * DAY_MS);

  // Effort from all linked work (KRA tasks + board/space item time).
  const effort = await computeGoalEffort(orgId, id);
  const { hasLinkedWork, totalHours, tasksDone, tasksOpen, lastActivityAt } = effort;

  const suggestedVerdict = heuristicVerdict({ progress, measured, completed, pctTimeElapsed, isStale, hasLinkedWork });

  const signals = {
    title: okr.title,
    level: okr.level,
    quarter: okr.quarter ?? null,
    progressPercent: progress,
    storedStatus: status,
    measured,
    completed,
    percentOfTimeElapsed: pctTimeElapsed,
    daysLeft,
    daysSinceLastCheckin: daysSinceCheckin,
    checkInIsStale: isStale,
    cadence: okr.checkInCadence,
    keyResults: keyResults.map((kr) => ({ title: kr.title, progress: kr.progress, current: kr.currentValue, target: kr.targetValue, unit: kr.unit ?? null })),
    effort: { hasLinkedWork, totalHours, tasksDone, tasksOpen, lastActivityAt },
    suggestedVerdict,
  };

  const base = {
    progress, status, measured, verdict: suggestedVerdict,
    pctTimeElapsed, daysLeft, daysSinceCheckin, isStale, hasLinkedWork,
    totalHours, tasksDone, tasksOpen,
  };
  const heuristic = heuristicNarrative(suggestedVerdict, base);

  const ai = await getAnthropicForOrg(orgId);
  if (ai.source === "shared" && !process.env.ANTHROPIC_API_KEY) {
    return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });
  }

  try {
    const message = await createMessageWithFallback(ai.client, {
      model: modelFor(ai, "claude-sonnet-4-6"),
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(signals) }],
    });
    const textBlock = message.content.find((b: { type: string }) => b.type === "text") as { text?: string } | undefined;
    const match = (textBlock?.text ?? "").match(/\{[\s\S]*\}/);
    if (!match) return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });
    const parsed = JSON.parse(match[0]) as { verdict?: Verdict; headline?: string; reasons?: string[]; recommendation?: string };
    const verdict: Verdict = ["on_track", "at_risk", "off_track"].includes(parsed.verdict as string) ? parsed.verdict! : suggestedVerdict;
    return jsonSuccess({
      ...base,
      verdict,
      headline: typeof parsed.headline === "string" && parsed.headline.trim() ? parsed.headline.trim() : heuristic.headline,
      reasons: Array.isArray(parsed.reasons) && parsed.reasons.length ? parsed.reasons.filter((r) => typeof r === "string").slice(0, 3) : heuristic.reasons,
      recommendation: typeof parsed.recommendation === "string" && parsed.recommendation.trim() ? parsed.recommendation.trim() : heuristic.recommendation,
      source: "ai",
    });
  } catch {
    // AI failed — the heuristic assessment still stands.
    return jsonSuccess({ ...base, ...heuristic, source: "heuristic" });
  }
}
