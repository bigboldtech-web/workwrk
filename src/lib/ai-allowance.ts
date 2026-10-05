// The plan's AI questions. Pricing promises Starter 50, Growth 500 and Scale
// 2,000 AI questions IN TOTAL (PLAN_LIMITS[plan].ai, a lifetime count), and
// this is what enforces it. One question = one AIQuery row.
//
// WHY. Ask AI, the product's AI surface (the /sidekick page and the Cmd+J
// panel), checked only that the AI app was open: no count, no cap. Any free
// workspace, one a stranger made a minute ago included, could send unlimited
// messages on WorkwrK's key, and the Plan & billing meter never moved because
// Ask AI wrote no AIQuery rows.
//
// A question is CLAIMED before the model runs and HANDED BACK if the model
// fails, so a failure costs the workspace nothing. The claim locks the
// workspace's row while it counts, so two questions at once can never pass
// the cap together.
//
// WHAT COUNTS. Every AI request a person starts: an Ask AI message, a meeting
// summary, and the AI actions in docs, files, forms, tables, whiteboards,
// SOPs, KRAs, the notetaker and the app builder (claimAiAction), and each run
// of an agent. Two kinds never spend a question:
//   - what nobody asked for (search summaries, inbox and field suggestions, a
//     goal's assessment): it runs only while the workspace has questions
//     left, under a daily total per workspace (AI_AUTO_PER_DAY) and a limit
//     per person per minute (aiAutoAllowed), and the page shows its answer
//     worked out without AI otherwise. Without the daily total, a workspace
//     that never asks a question could run these on WorkwrK's key without
//     end;
//   - Fill with AI and Talk updates, which have their own daily limit
//     (src/lib/ai-usage.ts).
//
// NO LIMIT. A plan whose AI limit is UNLIMITED_AI or more (Enterprise) has no
// cap, as Plan & billing says ("no limit"): its questions are still recorded,
// never refused.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { rateLimit } from "@/lib/rate-limit-memory";
import { claimAiUse } from "@/lib/ai-usage";

const PLAN_LABEL: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale", ENTERPRISE: "Enterprise" };

/** An AI limit this high means no limit (the value Plan & billing shows as "no limit", as seats do). */
export const UNLIMITED_AI = 99_999;

/** Whether a plan's AI limit is a real cap. */
export function aiIsCapped(limit: number): boolean {
  return limit < UNLIMITED_AI;
}

export type AiClaim =
  | { ok: true; id: string }
  | { ok: false; message: string; limit: number; used: number };

/** The sentence a workspace at its cap is shown. */
export function aiCapMessage(plan: string, limit: number): string {
  return `This workspace has used all ${limit} AI questions on the ${PLAN_LABEL[plan] ?? plan} plan. An Owner or Admin can change the plan in Settings, Plan & billing.`;
}

/** Claim one AI question for this workspace, or say why not. */
export async function claimAiQuestion(organizationId: string, userId: string, query: string): Promise<AiClaim> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ plan: string | null }[]>`
      SELECT "plan"::text AS plan FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    if (rows.length === 0) return { ok: false as const, message: "Organization not found", limit: 0, used: 0 };
    const plan = rows[0].plan || "STARTER";
    const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER).ai;
    if (aiIsCapped(limit)) {
      const used = await tx.aIQuery.count({ where: { organizationId } });
      if (used >= limit) return { ok: false as const, message: aiCapMessage(plan, limit), limit, used };
    }
    const row = await tx.aIQuery.create({
      data: { query: query.slice(0, 4000), userId, organizationId },
      select: { id: true },
    });
    return { ok: true as const, id: row.id };
  });
}

/**
 * Make the model call for a claimed question. A call that fails hands the
 * question back and rethrows. Only the CALL is covered: an answer that came
 * back but could not be used still counts, or a script could ask for unusable
 * answers forever at no cost to itself.
 */
export async function callOrGiveBack<T>(claimId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    await releaseAiQuestion(claimId);
    throw err;
  }
}

/** Hand a claimed question back (the model failed, nothing was answered). */
export async function releaseAiQuestion(id: string): Promise<void> {
  await prisma.aIQuery.deleteMany({ where: { id } }).catch(() => {});
}

/** Keep the answer with its question (the record /api/ai has always kept). */
export async function recordAiAnswer(id: string, response: string): Promise<void> {
  await prisma.aIQuery.updateMany({ where: { id }, data: { response: response.slice(0, 20000) } }).catch(() => {});
}

/** AI questions this workspace has used, in total: the number the cap counts. */
export function aiQuestionsUsed(organizationId: string): Promise<number> {
  return prisma.aIQuery.count({ where: { organizationId } });
}

/** AI requests one person may start in a minute, across every AI action: nobody clicks that fast, a script does. */
export const AI_ACTIONS_PER_MINUTE = 30;

export type AiActionClaim = { ok: true; id: string } | { ok: false; response: NextResponse };

/**
 * An AI request a person started (an Ask AI message, a summary, a draft, a
 * generated form): their per-minute limit, then one of the plan's questions
 * claimed. Answers 429 { code: "rate_limited" } or 403 { code: "ai_limit" }
 * with the sentence to show. The caller hands the question back with
 * releaseAiQuestion when the model fails.
 *
 * `what` names the action for the record ("Summarize a doc"), never the
 * person's own text: the row outlives the chat or doc it came from.
 */
export async function claimAiAction(organizationId: string, userId: string, what: string): Promise<AiActionClaim> {
  const limited = rateLimit(`ai:${userId}`, { max: AI_ACTIONS_PER_MINUTE, windowMs: 60_000 });
  if (!limited.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Too many AI requests at once. Try again in ${limited.retryAfter} seconds.`, code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      ),
    };
  }
  const claim = await claimAiQuestion(organizationId, userId, what);
  if (!claim.ok) return { ok: false, response: NextResponse.json({ error: claim.message, code: "ai_limit" }, { status: 403 }) };
  return { ok: true, id: claim.id };
}

/** Automatic AI calls one person's pages may make in a minute. */
export const AI_AUTO_PER_MINUTE = 20;

/**
 * Automatic AI calls a workspace may make in a UTC day, by plan: the total
 * bound on what nobody asked for, which never spends a question. Past it the
 * pages show their answers worked out without AI until the next day.
 */
export const AI_AUTO_PER_DAY: Record<string, number> = { STARTER: 100, GROWTH: 1_000, SCALE: 3_000, ENTERPRISE: 10_000 };

/**
 * Whether an AI call nobody asked for (a search summary, inbox or field
 * suggestions, a goal's assessment) may run: the workspace still has
 * questions left, the person's pages are under their per-minute limit, and
 * the workspace is under its daily total, which this call then takes one of.
 * It never spends a question. False: show the answer worked out without AI.
 */
export async function aiAutoAllowed(organizationId: string, userId: string): Promise<boolean> {
  if (!rateLimit(`ai-auto:${userId}`, { max: AI_AUTO_PER_MINUTE, windowMs: 60_000 }).ok) return false;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
  if (!org) return false;
  const plan = String(org.plan ?? "STARTER");
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER).ai;
  if (aiIsCapped(limit) && (await aiQuestionsUsed(organizationId)) >= limit) return false;
  // Fails closed: "limit" past the day's total, "not_ready" without the table.
  return (await claimAiUse(organizationId, "auto", AI_AUTO_PER_DAY[plan] ?? AI_AUTO_PER_DAY.STARTER)) === "ok";
}
