// Running the calls an AI teammate's model asks for (docs/plans/ai-teammates.md
// 3.6, 3.10, 3.11 and 3.13).
//
// executeToolCall decides, for the person the teammate acts for, what one
// call does:
//   a tool outside its set     refused: "This teammate can't use that tool."
//   READ                       runs now
//   anything else              prepareCall first: the gate the tool's write
//                              path stands behind, checked now, the class
//                              the input makes the call, and its card
//   a practice run             writes nothing at all (no action, memory,
//                              routine or audit row) and says what it would do
//   the policy asks            one PENDING AgentAction (proposeAction), the
//                              card sent to the chat, and the model told the
//                              call waits, so it stops and says what it asked
//   the policy runs it, and    an AgentAction recorded RUNNING by the
//   others will see it         person's own rule, then run (runApprovedAction),
//                              so what other people saw is on record exactly
//                              as an approved one is
//   the policy runs it, and    runs now
//   it is the person's own
// Every call that wrote something is audited (auditAgentAction), and
// remember, forget and create_routine also write their line into the chat,
// so a memory a planted sentence saved is seen at once.
//
// WHAT COMES BACK IS DATA. The model reads every result inside <tool_data>,
// with each "<" and ">" escaped inside the JSON (wrapToolData): nothing a
// task title, a comment or a message says can close the block, and the
// system prompt says the block is information, never instructions.
//
// A handler that throws answers a plain sentence (the error itself goes to
// the server log): a database message is no sentence for a card.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { actorLabelFor, toolCtxFor, type ActingPerson } from "./acting";
import { proposeAction, waitingCount, writeEventLine, type EventLine } from "./actions";
import type { TurnTrigger } from "./budget";
import { prepareCall, type Prepared } from "./previews";
import { ACTION_ERRORS, TEAMMATE_TOOL_ERRORS, agentAuditLine, forgotLine, memoryUpdatedLine, routineCreatedLine, tooManyWaiting } from "./teammate-copy";
import type { ActionPreview, ActionResult, CallState, TeammateStreamEvent } from "./teammate-thread";
import { toolOutcome, toolOutcomeSentence } from "./tool-verbs";
import {
  ACTION_TTL_MS,
  BASE_RISK,
  MAX_PENDING_PER_PERSON,
  MAX_PROPOSALS_PER_TURN,
  MAX_TOOL_CALLS_PER_TURN,
  TEAMMATE_EXCLUDED,
  gateFor,
  type ApprovalRules,
  type ToolRisk,
} from "./tool-policy";
import { isToolName, type ToolName } from "./tool-names";
import { TOOLS, type TeammateToolContext, type ToolContext, type ToolDefinition } from "./tools";
import { clampText } from "./clamp";

/** The most characters of one result the model is given; past it the result is cut and says so. */
export const TOOL_DATA_MAX = 30_000;

/** The teammate a call runs for, as the audit row and the chat name it. */
export interface TeammateRef {
  id: string;
  slug: string;
  name: string;
}

/**
 * One call as the turn's log keeps it (ChatMessage.toolCalls). The shape
 * Ask AI's log has ({ name, input, result, errorText, durationMs }, read by
 * src/lib/ai/thread.ts callFromLog), plus how it ended and its action.
 */
export interface CallRecord {
  name: string;
  input: Record<string, unknown> | null;
  result: unknown;
  errorText: string | null;
  durationMs: number;
  state: CallState;
  /** The AgentAction it made: a request waiting for the person, or one their own rule ran. */
  actionId: string | null;
}

export interface ExecuteArgs {
  /** The tool the model asked for, as it named it. */
  name: string;
  /** The input the model sent, read defensively. */
  input: unknown;
  person: ActingPerson;
  agent: TeammateRef;
  /** The turn: its chat, its routine, what started it, and its AgentRun. */
  turn: { sessionId: string | null; routineId: string | null; trigger: TurnTrigger; runId: string };
  /** The tools this teammate may use this turn (teammate-tools.ts teammateToolNames). */
  enabled: ReadonlySet<string> | readonly string[];
  /** Its managers' tightening (sanitizeRules, level "agent"). */
  agentRules: ApprovalRules;
  /** The person's own choices (sanitizeRules, level "person"). */
  personRules: ApprovalRules;
  practice: boolean;
  /** The turn's counters, shared by all its calls: each call and each request is counted here. */
  counters: { calls: number; proposals: number };
  emit?: (e: TeammateStreamEvent) => void;
}

export interface ExecuteResult {
  record: CallRecord;
  /** The tool_result's content: the result inside <tool_data>. */
  modelContent: string;
  isError: boolean;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

function jsonText(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "null";
  } catch {
    return JSON.stringify({ error: TEAMMATE_TOOL_ERRORS.notAllowed });
  }
}

/**
 * A result as the model reads it: `<tool_data tool="...">JSON</tool_data>`.
 * Every "<" and ">" in the JSON is written as \u003c and \u003e, which is
 * still the same JSON (they can only occur inside its strings) and can never
 * close the block or open another. Past TOOL_DATA_MAX characters the JSON is
 * cut and the block says so: { "truncated": true, "partial": "..." }.
 */
export function wrapToolData(tool: string, payload: unknown): string {
  let body = jsonText(payload);
  if (body.length > TOOL_DATA_MAX) body = jsonText({ truncated: true, partial: clampText(body, TOOL_DATA_MAX) });
  const safe = body.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const name = String(tool).replace(/[^A-Za-z0-9_]/g, "").slice(0, 64) || "tool";
  return `<tool_data tool="${name}">${safe}</tool_data>`;
}

/** A handler's answer, or the plain sentence for one that threw. */
async function runHandler(tool: ToolDefinition, ctx: ToolContext, input: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await tool.handler(ctx, input) };
  } catch (err) {
    console.error(`[agents] ${tool.name} failed: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    return { ok: false, error: TEAMMATE_TOOL_ERRORS.notAllowed };
  }
}

/** The line a call writes into the chat when it changed what the teammate remembers or runs. */
function eventLineFor(tool: ToolName, result: unknown): EventLine | null {
  const r = record(result);
  if (tool === "remember") {
    const value = record(r.memory).value;
    return typeof value === "string" ? { text: memoryUpdatedLine(value), event: "memory_updated" } : null;
  }
  if (tool === "forget") return typeof r.key === "string" ? { text: forgotLine(r.key), event: "memory_forgotten" } : null;
  if (tool === "create_routine") {
    const routine = record(r.routine);
    if (typeof routine.name !== "string") return null;
    return {
      text: routineCreatedLine(routine.name, typeof routine.when === "string" ? routine.when : ""),
      event: "routine_created",
      routineId: typeof routine.id === "string" ? routine.id : null,
    };
  }
  return null;
}

/**
 * Run one call the model asked for, as the person (see the file header). A
 * refusal, a tool's failure or a tool that throws is a result the model
 * reads and the log keeps; only the queue's own writes can throw.
 */
export async function executeToolCall(a: ExecuteArgs): Promise<ExecuteResult> {
  const started = Date.now();
  const input = record(a.input);
  const done = (state: CallState, result: unknown, extra: { errorText?: string; actionId?: string } = {}): ExecuteResult => ({
    record: { name: a.name, input, result, errorText: extra.errorText ?? null, durationMs: Date.now() - started, state, actionId: extra.actionId ?? null },
    modelContent: wrapToolData(a.name, result),
    isError: state === "failed",
  });
  const refuse = (error: string, detail?: Record<string, unknown>) => done("failed", { ...detail, error });

  a.counters.calls += 1;
  if (a.counters.calls > MAX_TOOL_CALLS_PER_TURN) return refuse(ACTION_ERRORS.tooManyCalls);
  const enabled: ReadonlySet<string> = a.enabled instanceof Set ? a.enabled : new Set(a.enabled);
  const name = a.name;
  const tool = isToolName(name) && enabled.has(name) && !TEAMMATE_EXCLUDED.has(name) ? TOOLS[name] : undefined;
  if (!isToolName(name) || !tool) return refuse(ACTION_ERRORS.toolOff);
  const teammate: Omit<TeammateToolContext, "timezone"> = {
    agentId: a.agent.id,
    agentName: a.agent.name,
    sessionId: a.turn.sessionId,
    routineId: a.turn.routineId,
    trigger: a.turn.trigger,
  };

  // Reads run, in a practice run too: they change nothing.
  if (BASE_RISK[name] === "READ") {
    const ran = await runHandler(tool, toolCtxFor(a.person, teammate), input);
    if (!ran.ok) return done("failed", { error: ran.error }, { errorText: ran.error });
    return done(toolOutcome(name, ran.result).failed ? "failed" : "ran", ran.result);
  }

  const prepared = await prepareCall(name, input, {
    person: a.person,
    teammate: { agentId: a.agent.id, agentName: a.agent.name, trigger: a.turn.trigger },
    agentRules: a.agentRules,
  });
  if (!prepared.ok) return refuse(prepared.error, prepared.detail);
  if (a.practice) return done("practice", { practice: true, wouldDo: prepared.preview.title });

  const gate = gateFor({ tool: name, risk: prepared.risk, targetKey: prepared.targetKey, agentRules: a.agentRules, personRules: a.personRules });
  if (gate === "ask") {
    if (a.counters.proposals >= MAX_PROPOSALS_PER_TURN || (await waitingCount(a.person.organizationId, a.person.userId)) >= MAX_PENDING_PER_PERSON) {
      return refuse(tooManyWaiting(a.person.firstName));
    }
    const view = await proposeAction({
      organizationId: a.person.organizationId,
      agentId: a.agent.id,
      actingForId: a.person.userId,
      sessionId: a.turn.sessionId,
      runId: a.turn.runId,
      routineId: a.turn.routineId,
      toolName: name,
      risk: prepared.risk === "READ" ? "INTERNAL" : prepared.risk,
      input: prepared.input,
      preview: prepared.preview,
      targetKey: prepared.targetKey,
      groupKey: `${a.turn.runId}:${name}`,
    });
    a.counters.proposals += 1;
    a.emit?.({ type: "approval", action: view });
    return done("waiting", { status: "waiting_for_approval", actionId: view.id, title: view.preview.title }, { actionId: view.id });
  }

  if (prepared.risk !== "INTERNAL") {
    // Other people will see it, and the person chose not to be asked: on
    // record as an action decided by their rule, run through the same path
    // as an approval. Already reported: the model reads the result now.
    const actionId = await recordRuleAction(a, name, prepared);
    const out = await runApprovedAction({
      action: { id: actionId, toolName: name, risk: prepared.risk, sessionId: a.turn.sessionId, runId: a.turn.runId, routineId: a.turn.routineId, preview: prepared.preview },
      input: prepared.input,
      person: a.person,
      agent: a.agent,
      trigger: a.turn.trigger,
      decidedVia: "rule",
    });
    return out.status === "EXECUTED" ? done("ran", out.data, { actionId }) : done("failed", out.data, { actionId });
  }

  const ran = await runHandler(tool, toolCtxFor(a.person, teammate), prepared.input);
  if (!ran.ok) return done("failed", { error: ran.error }, { errorText: ran.error });
  if (toolOutcome(name, ran.result).failed) return done("failed", ran.result);
  await auditAgentAction({
    person: a.person,
    agent: a.agent,
    toolName: name,
    input: prepared.input,
    result: ran.result,
    risk: prepared.risk,
    runId: a.turn.runId,
    sessionId: a.turn.sessionId,
    routineId: a.turn.routineId,
  });
  const line = eventLineFor(name, ran.result);
  if (line) {
    const message = await writeEventLine(a.turn.sessionId, line);
    if (message) a.emit?.({ type: "event", message });
  }
  return done("ran", ran.result);
}

/** A call the person's own "Don't ask" lets run: on record as decided by their rule, RUNNING, and already reported. */
async function recordRuleAction(a: ExecuteArgs, tool: ToolName, prepared: Extract<Prepared, { ok: true }>): Promise<string> {
  const now = new Date();
  const row = await prisma.agentAction.create({
    data: {
      organizationId: a.person.organizationId,
      agentId: a.agent.id,
      actingForId: a.person.userId,
      sessionId: a.turn.sessionId,
      runId: a.turn.runId,
      routineId: a.turn.routineId,
      toolName: tool,
      risk: prepared.risk,
      input: json(prepared.input),
      preview: json(prepared.preview),
      targetKey: prepared.targetKey,
      groupKey: `${a.turn.runId}:${tool}`,
      status: "RUNNING",
      decidedVia: "rule",
      decidedById: a.person.userId,
      decidedAt: now,
      reportedAt: now,
      expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
    },
    select: { id: true },
  });
  return row.id;
}

export interface ApprovedRun {
  /** The action, already RUNNING (claimed by the approval's swap, or recorded so by the person's rule). */
  action: { id: string; toolName: string; risk: string; sessionId: string | null; runId: string | null; routineId: string | null; preview?: ActionPreview | null };
  /** The exact input that runs: prepareCall's, for the stored input or the person's edit. */
  input: Record<string, unknown>;
  person: ActingPerson;
  agent: TeammateRef;
  /** "APPROVAL" for a person's approval; the turn's own trigger for a call their rule let run. */
  trigger: TeammateToolContext["trigger"];
  decidedVia: "person" | "rule";
}

export type ApprovedOutcome =
  | { status: "EXECUTED"; result: ActionResult; data: unknown }
  | { status: "FAILED"; error: string; data: unknown };

/**
 * Run one RUNNING action's tool as the person, with the action's id in the
 * tool context (a Talk post's clientId is ag_<actionId>, so a repeat finds
 * the first post), then record EXECUTED with its result, or FAILED with the
 * reason, each as a swap from RUNNING: a row the sweep already failed keeps
 * its "Couldn't confirm it finished." An executed action is audited.
 */
export async function runApprovedAction(a: ApprovedRun): Promise<ApprovedOutcome> {
  const name = a.action.toolName;
  const tool = isToolName(name) ? TOOLS[name] : undefined;
  const ctx = toolCtxFor(a.person, {
    agentId: a.agent.id,
    agentName: a.agent.name,
    sessionId: a.action.sessionId,
    routineId: a.action.routineId,
    trigger: a.trigger,
    actionId: a.action.id,
  });
  const ran = tool ? await runHandler(tool, ctx, a.input) : ({ ok: false, error: ACTION_ERRORS.toolOff } as const);
  const data = ran.ok ? ran.result : { error: ran.error };
  const outcome = toolOutcome(name, data);
  if (outcome.failed) {
    const error = outcome.message ?? TEAMMATE_TOOL_ERRORS.notAllowed;
    await prisma.agentAction.updateMany({ where: { id: a.action.id, status: "RUNNING" }, data: { status: "FAILED", error } });
    return { status: "FAILED", error, data };
  }
  const href = outcome.href ?? a.action.preview?.target?.href ?? null;
  const result: ActionResult = { text: toolOutcomeSentence(name, a.input, outcome).text, href, data };
  await prisma.agentAction.updateMany({
    where: { id: a.action.id, status: "RUNNING" },
    data: { status: "EXECUTED", result: json(result), executedAt: new Date(), error: null },
  });
  await auditAgentAction({
    person: a.person,
    agent: a.agent,
    toolName: name,
    input: a.input,
    result: data,
    risk: a.action.risk,
    actionId: a.action.id,
    runId: a.action.runId,
    sessionId: a.action.sessionId,
    routineId: a.action.routineId,
    decidedVia: a.decidedVia,
  });
  return { status: "EXECUTED", result, data };
}

/** The object a result names, for the audit row's target: the task, the doc, the Talk conversation. */
const AUDIT_TARGETS: ReadonlyArray<{ key: string; type: string; idKey?: string }> = [
  { key: "task", type: "BOARD_ITEM" },
  { key: "doc", type: "DOC" },
  { key: "message", type: "conversation", idKey: "conversationId" },
  { key: "form", type: "FormDefinition" },
  { key: "table", type: "DataTable" },
  { key: "sop", type: "SOP" },
  { key: "okr", type: "okr" },
  { key: "kra", type: "KRA" },
  { key: "kpi", type: "kpi" },
  { key: "meeting", type: "meeting" },
  { key: "kudos", type: "kudos" },
  { key: "workspace", type: "space" },
  { key: "invitation", type: "Invitation" },
  { key: "routine", type: "agent_routine" },
];

function auditTarget(result: unknown): { id: string; type: string } | null {
  const r = record(result);
  for (const t of AUDIT_TARGETS) {
    const id = record(r[t.key])[t.idKey ?? "id"];
    if (typeof id === "string" && id) return { id, type: t.type };
  }
  return null;
}

/**
 * The audit row of something a teammate did (the runTalkUpdate precedent):
 * the person as the actor, acting for themselves, actorType "agent", and the
 * teammate named in the label and the sentence, so Settings > Audit reads
 * 'Chief of Staff (for Priya Shah): Created task "Call Acme"'. Anything that
 * cannot be taken back is a warning.
 */
export async function auditAgentAction(a: {
  person: Pick<ActingPerson, "userId" | "organizationId" | "name">;
  agent: TeammateRef;
  toolName: string;
  input: Record<string, unknown> | null;
  result: unknown;
  risk: ToolRisk | string;
  actionId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  routineId?: string | null;
  /** person: approved; rule: the person's own "Don't ask"; null: ran without asking. */
  decidedVia?: "person" | "rule" | null;
}): Promise<void> {
  const what = toolOutcomeSentence(a.toolName, a.input, toolOutcome(a.toolName, a.result)).text;
  const target = auditTarget(a.result);
  await logActivity({
    type: `agent.${a.toolName}`,
    actorId: a.person.userId,
    actorType: "agent",
    actorLabel: actorLabelFor(a.agent, a.person),
    actingForId: a.person.userId,
    organizationId: a.person.organizationId,
    description: agentAuditLine(a.agent.name, a.person.name, what),
    ...(target ? { targetId: target.id, targetType: target.type } : {}),
    metadata: {
      agentId: a.agent.id,
      agentSlug: a.agent.slug,
      toolName: a.toolName,
      actionId: a.actionId ?? null,
      runId: a.runId ?? null,
      sessionId: a.sessionId ?? null,
      routineId: a.routineId ?? null,
      decidedVia: a.decidedVia ?? null,
    },
    severity: a.risk === "IRREVERSIBLE" ? "warning" : "info",
  });
}
