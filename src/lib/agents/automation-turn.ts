// An automation's "Ask an AI teammate" step (docs/plans/ai-teammates-phase2.md
// step 7): one turn of the creator's teammate, as the creator, whose answer
// the step returns for later steps ({{teammate.answer}}).
//
// IN ORDER, and nothing is spent before its step. Each refusal throws a
// sentence the engine records on the step:
//   1. the automation has a creator
//   2. whoever published what runs, or clicked Retry, is the creator: the
//      teammate works as them, so nobody else may put words in its mouth
//   3. the creator can be acted for here now
//   4. the teammate is one the creator may use, and is not paused
//   5. AI is set up, and the step has a request
//   6. one AI question, held to the automation's own daily cap
//   7. the line in the creator's chat, then the turn
// It never asks questions (nobody is watching), and anything other people
// would see waits for the creator's approval in their chat with it, with one
// Inbox row (honoursDontAsk is false for AUTOMATION: tool-policy.ts).
//
// Server-only: imports prisma through its helpers.

import { isAiConfigured } from "@/lib/ai-client";
import { publishToUser } from "@/lib/realtime-bus";
import type { ActionContext } from "@/lib/automation/registry-actions";
import { resolveActingPerson } from "./acting";
import { writeEventLine } from "./actions";
import { AUTOMATION_TEAMMATE_DAILY_CAP, automationRequest } from "./automation-request";
import { claimTeammateTurn, giveBackTurn } from "./budget";
import { clampText } from "./clamp";
import { getOrCreateTeammateSession, runTeammateTurn, teammateAgentFrom, type TurnResult } from "./engine";
import { noticeTalkApprovals } from "./talk-turn";
import { AUTOMATION_TEAMMATE_COPY, TEAMMATE_CHAT } from "./teammate-copy";
import { loadTeammate } from "./teammate-server";
import { cleanOutwardText } from "./teammate-tools";

/** The longest answer a later step can use. */
export const AUTOMATION_ANSWER_MAX = 4000;

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

export async function runAutomationTeammateStep(ctx: ActionContext, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  // 1, 2. A creator, and nobody else's words.
  const creator = ctx.workflowCreatorId ?? null;
  if (!creator) throw new Error(AUTOMATION_TEAMMATE_COPY.noCreator);
  if ((ctx.publisherId && ctx.publisherId !== creator) || (ctx.retrierId && ctx.retrierId !== creator)) {
    throw new Error(AUTOMATION_TEAMMATE_COPY.creatorOnly);
  }

  // 3, 4. The creator, and their teammate. The slug is the creator's pick,
  // never filled from the record: it is read as written.
  const acting = await resolveActingPerson(ctx.organizationId, creator);
  if (!acting.ok) throw new Error(AUTOMATION_TEAMMATE_COPY.creatorCannot);
  const person = acting.person;
  const slug = typeof params.teammate === "string" ? params.teammate : "";
  const agent = slug ? await loadTeammate(slug, person.viewer) : null;
  if (!agent) throw new Error(AUTOMATION_TEAMMATE_COPY.noTeammate);
  if (agent.status !== "ENABLED") throw new Error(AUTOMATION_TEAMMATE_COPY.paused);

  // 5. AI set up, and something to ask.
  if (!(await isAiConfigured(person.organizationId))) throw new Error(TEAMMATE_CHAT.notSetUp);
  const { instruction, values } = automationRequest(typeof params.request === "string" ? params.request : "", ctx.payload);
  if (!instruction) throw new Error(AUTOMATION_TEAMMATE_COPY.noRequest);

  // 6. One question, in the creator's own chat with the teammate.
  const workflowName = ctx.workflowName?.trim() || AUTOMATION_TEAMMATE_COPY.workflowFallback;
  const session = await getOrCreateTeammateSession(agent, person.userId);
  const claim = await claimTeammateTurn({
    organizationId: person.organizationId,
    agentId: agent.id,
    userId: person.userId,
    what: AUTOMATION_TEAMMATE_COPY.what,
    trigger: "AUTOMATION",
    sessionId: session.id,
    routineId: null,
    practice: false,
    rateLimit: false,
    workflow: { id: ctx.workflowId, runId: ctx.runId, dailyCap: AUTOMATION_TEAMMATE_DAILY_CAP },
  });
  // The teammate's own monthly limit names it: the step says it without the name.
  if (!claim.ok) throw new Error(claim.code === "agent_cap" ? AUTOMATION_TEAMMATE_COPY.agentCap : claim.message);

  // 7. The line, then the turn. The line never stops a turn already paid for.
  await writeEventLine(session.id, {
    text: AUTOMATION_TEAMMATE_COPY.askedLine(workflowName, clampText(instruction, 300)),
    event: "automation_asked",
    agentId: agent.id,
    link: { kind: "automation", workflowId: ctx.workflowId, runId: ctx.runId },
  }).catch((err: unknown) => console.error(`[agents] automation asked line ${claim.runId} not saved: ${errorLine(err)}`));

  let turn: TurnResult | null = null;
  try {
    turn = await runTeammateTurn({
      agent: teammateAgentFrom(agent),
      person,
      sessionId: session.id,
      trigger: "AUTOMATION",
      userText: null,
      practice: false,
      routine: null,
      runId: claim.runId,
      questionId: claim.questionId,
      streaming: false,
      origin: { kind: "automation", workflowId: ctx.workflowId, workflowName, automationRunId: ctx.runId, instruction, values },
    });
  } catch (err) {
    // runTeammateTurn answers its own failures; what this one did is unknown, so its question is kept.
    console.error(`[agents] automation turn ${claim.runId} threw: ${errorLine(err)}`);
  }
  if (turn?.giveBack) await giveBackTurn(claim.runId, claim.questionId);

  // What it asked for waits in the creator's chat with it: one Inbox row points there.
  if (turn && turn.proposedActionIds.length > 0) {
    await noticeTalkApprovals(person.userId, agent, turn.proposedActionIds, workflowName);
  }
  publishToUser(person.userId, { type: "agent.changed", agentId: agent.id });

  // A turn that ended early (cut short, declined) gives later steps no half
  // answer to post or send: the step fails with its reason, and the words
  // stay in the creator's chat.
  if (!turn || turn.failedBeforeAnything || turn.error) throw new Error(turn?.error ?? AUTOMATION_TEAMMATE_COPY.noAnswer);
  // No words to use (it only called tools, or nothing was left once cleaned)
  // is no answer: later steps never post around an empty one.
  const answer = cleanOutwardText(turn.text, { talk: true, max: AUTOMATION_ANSWER_MAX });
  if (!answer.trim()) throw new Error(AUTOMATION_TEAMMATE_COPY.noAnswer);

  return {
    teammate: agent.name,
    teammateSlug: agent.slug,
    answer,
    waiting: turn.proposedActionIds.length,
    agentRunId: claim.runId,
  };
}
