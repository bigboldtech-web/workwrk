// Ask AI asks first (docs/plans/ai-teammates.md, follow-up 1.5c).
//
// Until 2026-10-07 Ask AI's chat routes ran every tool the model named, at
// once: any tool in the registry (a teammate tool Ask AI is never offered
// included), with whatever input the model sent, and anything other people
// would see (kudos, an invitation, a doc every member can edit) without
// asking. Text Ask AI reads, a task title or a doc, could steer it into one
// of those. Now every call goes through executeAskAiCall, the teammate rules
// with Ask AI's own set:
//   a tool the chat does not offer     refused
//   an input its schema does not       refused (input-check.ts), so an object
//   describe                           never reaches a query as a filter
//   READ                               runs now
//   anything else                      prepareCall first: the gate the tool's
//                                      write path stands behind, checked
//                                      now, and the class its input makes
//                                      the call
//   the person's own work (INTERNAL)   runs now, as before
//   what other people would see        one PENDING AgentAction with no
//                                      teammate, its card in the chat, and
//                                      the model told it waits. It runs
//                                      only when the person approves it
//                                      (actions.ts decideActions)
// Ask AI never offers "don't ask again", so what others would see always asks.
//
// It runs what it runs in the person's own context ({ orgId, userId }), as
// Ask AI always has: no teammate in the tool context.
//
// Server-only: imports prisma (through the queue and the registry).

import { resolveActingPerson, type ActingPerson } from "./acting";
import { proposeAction, waitingCount } from "./actions";
import { ASK_AI_PREPARE, askAiPreview } from "./ask-ai-identity";
import { badInputSentence, checkToolInput } from "./input-check";
import { prepareCall } from "./previews";
import { ASK_AI_CARDS, TEAMMATE_TOOL_ERRORS, tooManyWaiting } from "./teammate-copy";
import type { ActionView } from "./teammate-thread";
import { toolOutcome } from "./tool-verbs";
import { BASE_RISK, MAX_PENDING_PER_PERSON, MAX_PROPOSALS_PER_TURN, gateFor } from "./tool-policy";
import { isToolName } from "./tool-names";
import { TOOLS, type ToolContext, type ToolDefinition } from "./tools";

export type AskAiCallState = "ran" | "failed" | "waiting";

/** One Ask AI turn, as its calls share it. */
export interface AskAiTurn {
  organizationId: string;
  userId: string;
  /** The chat: a waiting request's card is in it. */
  sessionId: string;
  /** The person's message this turn answers: one turn's requests group on one card. */
  turnKey: string;
  /** The tools the chat offers (toolsForSession), by name. */
  enabled: ReadonlySet<string>;
  /** Counted across the turn's calls. */
  counters: { proposals: number };
  /** The person as the queue acts for them, read once per turn on first need (personOnce). */
  person: () => Promise<ActingPerson | null>;
}

export interface AskAiCallResult {
  /** The tool's answer, or { error } for a refusal: what the turn's log keeps and the model reads. */
  result: unknown;
  errorText: string | null;
  state: AskAiCallState;
  /** The request the call made, when it waits for the person. */
  actionId: string | null;
  /** Its card. */
  action: ActionView | null;
}

/**
 * The person, read once per turn (resolveActingPerson); null when the queue
 * may not act for them now, or the read failed: then nothing but a read runs.
 */
export function personOnce(organizationId: string, userId: string): () => Promise<ActingPerson | null> {
  let read: Promise<ActingPerson | null> | null = null;
  return () =>
    (read ??= resolveActingPerson(organizationId, userId).then(
      (r) => (r.ok ? r.person : null),
      () => null,
    ));
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A handler's answer, or the plain sentence for one that threw (the error itself goes to the server log). */
async function runHandler(tool: ToolDefinition, ctx: ToolContext, input: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await tool.handler(ctx, input) };
  } catch (err) {
    console.error(`[ask-ai] ${tool.name} failed: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    return { ok: false, error: TEAMMATE_TOOL_ERRORS.notAllowed };
  }
}

/** Run one call Ask AI's model asked for, as the person, or ask them first (see the file header). */
export async function executeAskAiCall(turn: AskAiTurn, name: string, rawInput: unknown): Promise<AskAiCallResult> {
  const refuse = (error: string, detail?: Record<string, unknown>): AskAiCallResult => ({
    result: { ...detail, error },
    errorText: error,
    state: "failed",
    actionId: null,
    action: null,
  });
  const ran = (result: unknown): AskAiCallResult => {
    const failed = toolOutcome(name, result).failed;
    return { result, errorText: failed ? (toolOutcome(name, result).message ?? null) : null, state: failed ? "failed" : "ran", actionId: null, action: null };
  };

  const tool = isToolName(name) && turn.enabled.has(name) ? TOOLS[name] : undefined;
  if (!isToolName(name) || !tool) return refuse(ASK_AI_CARDS.notOffered);
  const checked = checkToolInput(tool.input_schema, rawInput);
  if (!checked.ok) return refuse(badInputSentence(checked.field));
  const ctx: ToolContext = { orgId: turn.organizationId, userId: turn.userId };

  // Reads run: they change nothing.
  if (BASE_RISK[name] === "READ") {
    const out = await runHandler(tool, ctx, checked.input);
    return out.ok ? ran(out.result) : refuse(out.error);
  }

  const person = await turn.person();
  if (!person) return refuse(ASK_AI_CARDS.personCannot);
  const prepared = await prepareCall(name, checked.input, { person, teammate: { ...ASK_AI_PREPARE, trigger: "CHAT" }, agentRules: {} });
  if (!prepared.ok) return refuse(prepared.error, prepared.detail);

  const gate = gateFor({ tool: name, risk: prepared.risk, targetKey: prepared.targetKey, agentRules: {}, personRules: {} });
  if (gate === "run") {
    const out = await runHandler(tool, ctx, prepared.input);
    return out.ok ? ran(out.result) : refuse(out.error);
  }

  if (turn.counters.proposals >= MAX_PROPOSALS_PER_TURN || (await waitingCount(turn.organizationId, turn.userId)) >= MAX_PENDING_PER_PERSON) {
    return refuse(tooManyWaiting(person.firstName));
  }
  const view = await proposeAction({
    organizationId: turn.organizationId,
    agentId: null,
    actingForId: turn.userId,
    sessionId: turn.sessionId,
    runId: null,
    routineId: null,
    toolName: name,
    risk: prepared.risk === "READ" ? "INTERNAL" : prepared.risk,
    input: prepared.input,
    preview: askAiPreview(prepared.preview),
    targetKey: prepared.targetKey,
    groupKey: `${turn.turnKey}:${name}`,
  });
  turn.counters.proposals += 1;
  return {
    result: { status: "waiting_for_approval", actionId: view.id, title: view.preview.title },
    errorText: null,
    state: "waiting",
    actionId: view.id,
    action: view,
  };
}

/** The input a call's log keeps: the model's own, read as an object. */
export function loggedInput(raw: unknown): Record<string, unknown> {
  return record(raw);
}
