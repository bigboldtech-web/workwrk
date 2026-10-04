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
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";
import { computeGoalRollups, enrichKeyResults, goalRollupFor, KR_KPI_SELECT } from "@/lib/alignment";
import { computeGoalEffort } from "@/lib/goal-effort";
import { verdictForGoal, verdictNarrative } from "@/lib/goal-verdict";
import { getAnthropicForOrg, modelFor, createMessageWithFallback } from "@/lib/ai-client";
import { aiOffResponse } from "@/lib/ai/ai-off-gate";

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

  // Authoritative progress (the same rollup the list reads).
  const [keyResults, rollupCtx, effort] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    computeGoalRollups(orgId),
    computeGoalEffort(orgId, id, await viewerFromSession()),
  ]);
  const rollup = goalRollupFor(rollupCtx, okr);
  const { hasLinkedWork, totalHours, tasksDone, tasksOpen, lastActivityAt } = effort;

  // The ONE verdict (src/lib/goal-verdict.ts), from the same inputs the
  // list hands it: the rollup, each target's newest check-in and whether a
  // KPI feeds it, and whether any work is linked.
  const { verdict, signals: sig, daysSinceCheckin } = verdictForGoal({
    goal: okr,
    rollup: { progress: rollup.progress, source: rollup.source },
    targets: okr.keyResults.map((kr) => ({ lastCheckInAt: kr.checkIns[0]?.createdAt ?? null, derived: kr.kpiId != null })),
    hasLinkedWork,
  });
  const measured = rollup.source !== "NONE";
  const progress = measured ? rollup.progress : null;
  const status = rollup.status || okr.status;
  const completed = verdict === "completed";
  const { pctTimeElapsed, daysLeft, isStale } = sig;

  const signals = {
    title: okr.title,
    level: okr.level,
    progressPercent: progress,
    measured,
    completed,
    percentOfTimeElapsed: pctTimeElapsed,
    daysLeft,
    daysSinceLastCheckin: daysSinceCheckin,
    checkInIsStale: isStale,
    cadence: okr.checkInCadence,
    keyResults: keyResults.map((kr) => ({ title: kr.title, progress: kr.progress, current: kr.currentValue, target: kr.targetValue, unit: kr.unit ?? null })),
    effort: { hasLinkedWork, totalHours, tasksDone, tasksOpen, lastActivityAt },
    verdict,
  };

  const base = {
    progress, status, measured, verdict,
    pctTimeElapsed, daysLeft, daysSinceCheckin, isStale, hasLinkedWork,
    totalHours, tasksDone, tasksOpen,
  };
  const heuristic = verdictNarrative(verdict, base);

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
