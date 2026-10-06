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
//
// FREE QUESTIONS ARE ALSO PER PERSON. In a Starter workspace a question also
// counts against the person: everyone gets PLAN_LIMITS.STARTER.ai questions in
// total across every free workspace they are in (AIQuery.freeTier). The
// workspace's own count starts at 0 in every new workspace, and anyone can
// make one from the workspace menu, so without this a script could make
// workspace after workspace and ask 50 more questions in each.
//
// AND FREE AI HAS A DAILY CEILING ACROSS THE WHOLE PLATFORM. Anyone can also
// sign up again with a new address, which brings a new person AND a new free
// workspace, so caps per workspace and per person bound nothing in total.
// Every free question, automatic call and Fill with AI also takes one of the
// platform's free uses of the day (AiFreeDay, FREE_AI_PER_DAY, set by env):
// past it, free AI waits for the next UTC day, and what it can cost WorkwrK in
// a day is bounded however many accounts are made. Paid workspaces never
// touch it, and neither do free workspaces made before the ceiling
// (FREE_CEILING_FROM): that set is fixed and each is held to its own caps,
// so the total stays bounded, and a ceiling drained by new sign-ups never
// takes away AI a workspace already had. A use is given back when its call
// gives nothing, to the day it was taken from and only when one was taken
// (a question records that day, AIQuery.freeDay), and the first time a kind
// reaches the ceiling in a UTC day, OPS_ALERT_EMAIL is told.
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { rateLimit } from "@/lib/rate-limit-memory";
import { claimAiUse, releaseAiUse } from "@/lib/ai-usage";

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

export type FreeKind = "question" | "auto" | "fill";

/** Free workspaces made before this take no part in the ceiling (see above). */
export const FREE_CEILING_FROM = new Date("2026-10-06T00:00:00Z");

/** Whether a free workspace made at `createdAt` is under the platform's ceiling. */
export function underFreeCeiling(createdAt: Date | string | null | undefined): boolean {
  if (!createdAt) return true;
  return new Date(createdAt).getTime() >= FREE_CEILING_FROM.getTime();
}

/** Free AI uses the whole platform may make in a UTC day, by kind (env, else these). */
export function freeAiPerDay(kind: FreeKind, env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[kind === "question" ? "FREE_AI_QUESTIONS_PER_DAY" : kind === "auto" ? "FREE_AI_AUTO_PER_DAY" : "FREE_AI_FILLS_PER_DAY"]);
  const fallback = kind === "question" ? 2_000 : 5_000;
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/** The sentence free AI past the platform's ceiling for the day is shown. */
export const FREE_AI_DAY_MESSAGE = "Free AI has reached its limit for today across WorkwrK, and comes back tomorrow (UTC). A workspace on the Growth plan has its own questions: an Owner or Admin can change the plan in Settings, Plan & billing.";

type Db = Pick<typeof prisma, "$queryRaw">;

/**
 * Take one of the platform's free uses of the day, in ONE statement (the
 * upsert increments only below the cap, so two at once cannot both take the
 * last). Returns the UTC day the use was taken from (YYYY-MM-DD), which a
 * give-back names; null past the ceiling, and when the table is missing (the
 * SQL file not applied): fails closed, like the daily limits in
 * src/lib/ai-usage.ts.
 */
export async function takeFreeDay(kind: FreeKind, db: Db = prisma, cap: number = freeAiPerDay(kind)): Promise<string | null> {
  if (cap <= 0) return null;
  try {
    const rows = await db.$queryRaw<Array<{ day: string }>>`
      INSERT INTO "AiFreeDay" ("day", "kind", "count", "updatedAt")
      VALUES ((now() AT TIME ZONE 'UTC')::date, ${kind}, 1, now() AT TIME ZONE 'UTC')
      ON CONFLICT ("day", "kind")
      DO UPDATE SET "count" = "AiFreeDay"."count" + 1, "updatedAt" = now() AT TIME ZONE 'UTC'
      WHERE "AiFreeDay"."count" < ${Math.floor(cap)}
      RETURNING "day"::text AS "day"`;
    if (rows.length > 0) return rows[0].day;
    await alertCeilingOnce(kind, db, cap);
    return null;
  } catch (err) {
    console.error(`[ai-allowance] free day claim failed: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    return null;
  }
}

/** Whether one of the day's free uses was taken (takeFreeDay, for a caller that never gives it back). */
export async function claimFreeDay(kind: FreeKind, db: Db = prisma, cap: number = freeAiPerDay(kind)): Promise<boolean> {
  return (await takeFreeDay(kind, db, cap)) !== null;
}

/**
 * Give back a free use takeFreeDay took (the call it was taken for gave
 * nothing), to the day it was taken from: a call that fails after midnight
 * UTC never lowers the new day's count. Never throws.
 */
export async function releaseFreeDay(kind: FreeKind, day: string, db: Db = prisma): Promise<void> {
  try {
    await db.$queryRaw`
      UPDATE "AiFreeDay" SET "count" = "count" - 1, "updatedAt" = now() AT TIME ZONE 'UTC'
      WHERE "kind" = ${kind} AND "day" = ${day}::date AND "count" > 0
      RETURNING "count"`;
  } catch {
    // A use not given back costs one use of the day, never anything more.
  }
}

/** The first refusal of a kind in a UTC day tells OPS_ALERT_EMAIL (once, by a conditional stamp). */
async function alertCeilingOnce(kind: FreeKind, db: Db, cap: number): Promise<void> {
  const first = await db.$queryRaw<Array<{ kind: string }>>`
    UPDATE "AiFreeDay" SET "alertedAt" = now() AT TIME ZONE 'UTC'
    WHERE "day" = (now() AT TIME ZONE 'UTC')::date AND "kind" = ${kind} AND "alertedAt" IS NULL
    RETURNING "kind"`.catch(() => []);
  if (first.length === 0) return;
  const what = `Free AI reached its ceiling for today: ${cap} free ${kind === "question" ? "questions" : kind === "auto" ? "automatic calls" : "fills"} across every free workspace made since ${FREE_CEILING_FROM.toISOString().slice(0, 10)}. New free workspaces are refused until 00:00 UTC. If this is growth, raise ${kind === "question" ? "FREE_AI_QUESTIONS_PER_DAY" : kind === "auto" ? "FREE_AI_AUTO_PER_DAY" : "FREE_AI_FILLS_PER_DAY"}; if it is a script, look at the day's new sign-ups.`;
  console.error(`[ai-allowance] ${what}`);
  const to = process.env.OPS_ALERT_EMAIL?.trim();
  if (!to) return;
  const { queueEmail } = await import("@/lib/email");
  await queueEmail({ to, subject: "WorkwrK: free AI reached its daily ceiling", template: "ops-ai-ceiling", html: `<p>${what}</p>`, variables: { kind, cap } }).catch(() => {});
}

/** The sentence a workspace at its cap is shown. */
export function aiCapMessage(plan: string, limit: number): string {
  return `This workspace has used all ${limit} AI questions on the ${PLAN_LABEL[plan] ?? plan} plan. An Owner or Admin can change the plan in Settings, Plan & billing.`;
}

/**
 * The sentence a person at the free questions they get across free
 * workspaces is shown.
 */
export function aiPersonCapMessage(limit: number): string {
  return `You have used all ${limit} AI questions one person gets across free workspaces. On the Growth plan a workspace has ${PLAN_LIMITS.GROWTH.ai} of its own: an Owner or Admin can change the plan in Settings, Plan & billing.`;
}

/** Claim one AI question for this workspace, or say why not. */
export async function claimAiQuestion(organizationId: string, userId: string, query: string): Promise<AiClaim> {
  return prisma.$transaction((tx) => claimAiQuestionIn(tx, organizationId, userId, query));
}

/**
 * claimAiQuestion's claim, inside a transaction the caller already holds, so
 * a caller can check a limit of its own under its own lock and claim in the
 * same transaction (an AI teammate's monthly limit, src/lib/agents/budget.ts):
 * a refusal or an error anywhere rolls back everything, the day's free use
 * included. It locks the workspace's row FOR UPDATE, so a caller that locks
 * another row first must always take its locks in that same order.
 */
export async function claimAiQuestionIn(tx: Prisma.TransactionClient, organizationId: string, userId: string, query: string): Promise<AiClaim> {
  const rows = await tx.$queryRaw<{ plan: string | null; createdAt: Date | null }[]>`
    SELECT "plan"::text AS plan, "createdAt" FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) return { ok: false as const, message: "Organization not found", limit: 0, used: 0 };
  const plan = rows[0].plan || "STARTER";
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER).ai;
  if (aiIsCapped(limit)) {
    const used = await tx.aIQuery.count({ where: { organizationId } });
    if (used >= limit) return { ok: false as const, message: aiCapMessage(plan, limit), limit, used };
  }
  const freeTier = plan === "STARTER";
  let freeDay: string | null = null;
  if (freeTier) {
    const free = PLAN_LIMITS.STARTER.ai;
    const mine = await tx.aIQuery.count({ where: { userId, freeTier: true } });
    if (mine >= free) return { ok: false as const, message: aiPersonCapMessage(free), limit: free, used: mine };
    // In the same transaction, so an error below rolls the day's use back.
    // A free workspace made before the ceiling takes no use (and so its
    // question records no day, and gives nothing back).
    if (underFreeCeiling(rows[0].createdAt)) {
      freeDay = await takeFreeDay("question", tx);
      if (!freeDay) return { ok: false as const, message: FREE_AI_DAY_MESSAGE, limit: freeAiPerDay("question"), used: 0 };
    }
  }
  const row = await tx.aIQuery.create({
    data: { query: query.slice(0, 4000), userId, organizationId, freeTier },
    select: { id: true },
  });
  // The day whose use it took: handing the question back gives back exactly that use.
  if (freeDay) await tx.$executeRaw`UPDATE "AIQuery" SET "freeDay" = ${freeDay}::date WHERE "id" = ${row.id}`;
  return { ok: true as const, id: row.id };
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
  // A question that took a use of the platform's ceiling gives it back, to
  // the day it took it from: a call that failed before the model ran costs
  // the day nothing. One that took none (a paid workspace, or a free one made
  // before the ceiling) has no day and gives nothing back, so a failure
  // there can never lower the count new workspaces are held to. DELETE ...
  // RETURNING: only the call that removed the row gives its use back.
  const gone = await prisma.$queryRaw<Array<{ freeDay: string | null }>>`
    DELETE FROM "AIQuery" WHERE "id" = ${id} RETURNING "freeDay"::text AS "freeDay"`.catch(() => []);
  const day = gone[0]?.freeDay;
  if (day) await releaseFreeDay("question", day);
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

/** The sentence a person past AI_ACTIONS_PER_MINUTE is shown (Ask AI's, and an AI teammate's, src/lib/agents/budget.ts). */
export function aiRateLimitMessage(retryAfter: number): string {
  return `Too many AI requests at once. Try again in ${retryAfter} seconds.`;
}

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
        { error: aiRateLimitMessage(limited.retryAfter), code: "rate_limited" },
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
 * questions left, and the person's pages are under their per-minute limit.
 * On WorkwrK's own key (`keySource` "shared") also under the workspace's
 * daily total, and in a free workspace the platform's free ceiling, which
 * this call then takes one of each; a workspace's own key (BYOK) is its own
 * bill, so no daily total applies. It never spends a question. False: show
 * the answer worked out without AI. Callers resolve the key first
 * (getAnthropicForOrg) and pass its source.
 */
export async function aiAutoAllowed(organizationId: string, userId: string, keySource: "shared" | "byok" = "shared"): Promise<boolean> {
  if (!rateLimit(`ai-auto:${userId}`, { max: AI_AUTO_PER_MINUTE, windowMs: 60_000 }).ok) return false;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true, createdAt: true } });
  if (!org) return false;
  const plan = String(org.plan ?? "STARTER");
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER).ai;
  if (aiIsCapped(limit) && (await aiQuestionsUsed(organizationId)) >= limit) return false;
  if (keySource === "byok") return true;
  // The workspace's own daily total first (fails closed: "limit" past it,
  // "not_ready" without the table), then the platform's free ceiling, giving
  // the workspace's use back when the ceiling refuses.
  if ((await claimAiUse(organizationId, "auto", AI_AUTO_PER_DAY[plan] ?? AI_AUTO_PER_DAY.STARTER)) !== "ok") return false;
  if (plan === "STARTER" && underFreeCeiling(org.createdAt) && !(await claimFreeDay("auto"))) {
    await releaseAiUse(organizationId, "auto");
    return false;
  }
  return true;
}
