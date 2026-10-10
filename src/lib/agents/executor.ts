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
// THE PERSON'S OWN GOOGLE (docs/plans/ai-teammates-phase3.md step 3). A
// connector call is first held to where and how often it may run: only in
// the person's own chats, continues and routines (Decision 13), at most 12 an
// answer and each tool's own count, 30 a minute per person (Decision 22).
// The person is read again for it, never taken from the start of a long turn;
// the connection and the person's allow are read in its preparation and its
// handler (connector-access.ts). A connector tool the turn was not offered
// answers why (a Talk answer, an allow missing, a connection to reconnect).
//
// A TURN THAT READ GOOGLE ASKS BEFORE EVERY WRITE (Decision 9). After a
// search_email, read_email or list_events that worked, or a preparation that
// read other people's words (a reply's conversation, review of step 3; the
// event a calendar change, cancel or answer names, step 4), every later
// call above READ in the turn waits on a card, whatever the person chose not
// to be asked about, and its card offers no "don't ask again"; a teammate
// this turn asks starts the same way. What such a read keeps in the call log
// is its count (Decision 16), though the model read it all. A Google write's
// card title is the person's alone: the model and the call log name the
// write by its kind (connectorTitle), never by a subject. A send, a reply or
// an invitation identical to one already waiting points at that card and
// makes no second one, and adds nothing to this turn's approval row
// (Decision 23; the invitation, review of step 4).
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";
import { TOOL_PRODUCT, TAINTING_TOOLS, CONNECTOR_LIMITS, type ConnectorProduct } from "@/lib/connectors/products";
import type { ConnectorRefusal } from "@/lib/connectors/connections";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { rateLimit } from "@/lib/rate-limit-memory";
import { actorLabelFor, resolveActingPerson, toolCtxFor, type ActingPerson } from "./acting";
import { proposeAction, waitingCount, writeEventLine, type EventLine } from "./actions";
import { claimTeammateTurn, giveBackTurn, type TurnTrigger } from "./budget";
import {
  CONNECTOR_TURN_LIMITS,
  connectorAuditFacts,
  connectorRefusalSentence,
  connectorStored,
  connectorTitle,
  connectorTrigger,
  emptyConnectorCounters,
  isHeldCode,
  notHereKindOf,
  notHereSentence,
  type ConnectorCounters,
  type HeldCode,
  type NotHereKind,
} from "./connector-rules";
import { prepareCall, type Prepared } from "./previews";
import {
  ACTION_ERRORS,
  CONNECTOR_COPY,
  DELEGATION_COPY,
  TALK_TEAMMATE_COPY,
  TEAMMATE_TOOL_ERRORS,
  agentAuditLine,
  forgotLine,
  memoryUpdatedLine,
  routineCreatedLine,
  titleList,
  tooManyWaiting,
} from "./teammate-copy";
import type { PrintField } from "./teammate-print";
import type { ActionPreview, ActionResult, CallState, TeammateStreamEvent } from "./teammate-thread";
import { toolOutcome, toolOutcomeSentence, toolSentence } from "./tool-verbs";
import {
  ACTION_TTL_MS,
  BASE_RISK,
  MAX_DELEGATIONS_PER_TURN,
  MAX_PENDING_PER_PERSON,
  MAX_PROPOSALS_PER_TURN,
  MAX_TOOL_CALLS_PER_TURN,
  TEAMMATE_EXCLUDED,
  gateFor,
  type ApprovalRules,
  type ToolRisk,
} from "./tool-policy";
import { isConnectorToolName, isToolName, type ConnectorToolName, type ToolName } from "./tool-names";
import { TOOLS, type TeammateToolContext, type ToolContext, type ToolDefinition } from "./tools";
import { clampText } from "./clamp";
import { plainData } from "./plain-data";
import { badInputSentence, checkToolInput } from "./input-check";

/** The most characters of one result the model is given; past it the result is cut and says so. */
export const TOOL_DATA_MAX = 30_000;

/** The teammate a call runs for, as the audit row and the chat name it. */
export interface TeammateRef {
  id: string;
  slug: string;
  name: string;
}

/** Who did it, as an audit row names them: a teammate, or Ask AI (no id, no slug). */
export type AuditAgent = { id: string | null; slug: string | null; name: string };

/** Ask AI in the audit log: "Ask AI (for Priya Shah): Sent kudos to Max". */
export const ASK_AI_AUDIT: AuditAgent = { id: null, slug: null, name: "Ask AI" };

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
  turn: { sessionId: string | null; routineId: string | null; trigger: TurnTrigger; runId: string; audience?: readonly string[] };
  /** The tools this teammate may use this turn (teammate-tools.ts teammateToolNames). */
  enabled: ReadonlySet<string> | readonly string[];
  /** Its managers' tightening (sanitizeRules, level "agent"). */
  agentRules: ApprovalRules;
  /** The person's own choices (sanitizeRules, level "person"). */
  personRules: ApprovalRules;
  practice: boolean;
  /**
   * The turn's counters, shared by all its calls: each call, each request and
   * each teammate it asked is counted here. `tainted`: a Google read worked
   * in this turn (or the turn started from one that did, or could not be
   * told apart from one), so every later call above READ asks (Decision 9).
   * `readGoogle`: other people's words from the person's Google really
   * reached this turn (a read here, or a start known to follow one), which is
   * what the turn's rows record; a start the database could not answer asks
   * but records nothing (review of step 3). `connector`: its Google calls
   * (Decision 22). All start empty when a caller leaves them out.
   */
  counters: { calls: number; proposals: number; delegations: number; tainted?: boolean; readGoogle?: boolean; connector?: ConnectorCounters };
  /** Why a Google product's tools are not offered this turn (engine.ts prepareTurn), so a call to one answers its real reason. */
  connectorRefusals?: Partial<Record<ConnectorProduct, { reason: ConnectorRefusal; changed?: PrintField[] }>>;
  /**
   * The Google tools this teammate's own set holds, whatever this turn offers
   * (engine.ts prepareTurn). A call to one it does not hold is refused as any
   * tool it does not have, before any product, allow or connection reason
   * (review of step 3: else a planted call to send_email answered "allow it
   * in Settings", and the person's allow led nowhere). Left out: none.
   */
  connectorHeld?: readonly string[];
  /**
   * Where this turn's answer goes, when that is why no Google tool is offered
   * (engine.ts prepareTurn sets it for a Talk, automation or delegated turn
   * whose teammate holds Google tools here, step 5; left out, it is read from
   * the trigger).
   */
  connectorNotHere?: NotHereKind | null;
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
  // Look-alike brackets and invisible format characters made plain first (review round 7).
  const safe = plainData(body).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
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

/** The longest answer a delegate's words reach the caller with. */
const DELEGATE_ANSWER_MAX = 8000;
/** The longest request passed on (engine.ts DELEGATE_REQUEST_MAX; not imported: the engine imports this file). */
const DELEGATE_REQUEST_LIMIT = 4000;

/**
 * ask_teammate (docs/plans/ai-teammates-phase2.md step 5, Decisions 1 and
 * 16): one turn of another of the person's teammates, as the person, in the
 * person's own chat with it. Only from a turn the person watches (their chat
 * or its continue), at most three per answer, depth one (the delegate is
 * never offered ask_teammate), never in practice (which says what it would
 * ask). The delegate's question is its own (its monthly limit, the plan's,
 * the person's per-minute limit), traced to the caller's run. Anything the
 * delegate would do that other people see waits on one card in the
 * delegate's chat; the caller's chat gets a line that opens it. The answer
 * reaches the caller as data, inside <tool_data>.
 */
async function runDelegation(
  a: ExecuteArgs,
  input: Record<string, unknown>,
  done: (state: CallState, result: unknown, extra?: DoneExtra) => ExecuteResult,
  refuse: (error: string, detail?: Record<string, unknown>) => ExecuteResult,
): Promise<ExecuteResult> {
  if (a.turn.trigger !== "CHAT" && a.turn.trigger !== "RESUME") return refuse(ACTION_ERRORS.toolOff);
  if (a.counters.delegations >= MAX_DELEGATIONS_PER_TURN) return refuse(DELEGATION_COPY.tooManyAsks);
  const name = String(input.teammate ?? "").trim();
  const request = String(input.request ?? "").trim();
  if (!name || !request) return refuse(badInputSentence(!name ? "teammate" : "request"));
  // Never cut a request silently: the caller is told to shorten or split it (review round 1).
  if (request.length > DELEGATE_REQUEST_LIMIT) return refuse(DELEGATION_COPY.requestTooLong(DELEGATE_REQUEST_LIMIT));
  if (a.practice) return done("practice", { practice: true, wouldDo: DELEGATION_COPY.askTitle(name) });

  // Who the delegate works for, read now: a long turn can ask its second or
  // third teammate minutes later, and a person deactivated, made a Guest or
  // with AI turned off meanwhile starts no new turn in their name (review round 9).
  const acting = await resolveActingPerson(a.person.organizationId, a.person.userId).catch(() => null);
  if (!acting?.ok) return refuse(ACTION_ERRORS.personCannot);
  const person = acting.person;

  // Loaded here: the server half of teammates and the engine both import this file.
  const [{ usableTeammatesNamed }, engine] = await Promise.all([import("./teammate-server"), import("./engine")]);
  const found = await usableTeammatesNamed(person.viewer, name);
  if (found.length === 0) return refuse(DELEGATION_COPY.noTeammateNamed(name));
  if (found.length > 1) return refuse(DELEGATION_COPY.severalNamed(name));
  const delegate = found[0];
  if (delegate.id === a.agent.id) return refuse(DELEGATION_COPY.cantAskItself);
  if (delegate.status !== "ENABLED") return refuse(DELEGATION_COPY.delegatePaused(delegate.name));

  const session = await engine.getOrCreateTeammateSession(delegate, person.userId);
  const claim = await claimTeammateTurn({
    organizationId: person.organizationId,
    agentId: delegate.id,
    userId: person.userId,
    what: "AI teammate delegation",
    trigger: "DELEGATED",
    sessionId: session.id,
    routineId: null,
    practice: false,
    rateLimit: true,
    parentRunId: a.turn.runId,
  });
  if (!claim.ok) return refuse(claim.message);
  a.counters.delegations += 1;
  await writeEventLine(session.id, { text: DELEGATION_COPY.askedByLine(a.agent.name, clampText(request, 300)), event: "delegated_asked", agentId: delegate.id });

  let turn: Awaited<ReturnType<typeof engine.runTeammateTurn>> | null = null;
  try {
    turn = await engine.runTeammateTurn({
      agent: engine.teammateAgentFrom(delegate),
      person,
      sessionId: session.id,
      trigger: "DELEGATED",
      userText: null,
      practice: false,
      routine: null,
      runId: claim.runId,
      questionId: claim.questionId,
      streaming: false,
      // A turn that read Google hands its taint on: the delegate asks before
      // every write too, so a planted email cannot act through another
      // teammate (Decision 9).
      origin: { kind: "delegated", by: { agentId: a.agent.id, name: a.agent.name, sessionId: a.turn.sessionId, runId: a.turn.runId }, request, tainted: a.counters.tainted === true },
    });
  } catch (err) {
    // runTeammateTurn answers its own failures; what this one did is unknown, so its question is kept.
    console.error(`[agents] delegated turn ${claim.runId} threw: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
  }
  if (turn?.giveBack) await giveBackTurn(claim.runId, claim.questionId);

  // What the delegate asked for waits in its own chat; the caller's chat says so, with a link to the first card.
  const waitingIds = turn?.proposedActionIds ?? [];
  const waiting = waitingIds.length
    ? await prisma.agentAction.findMany({ where: { id: { in: waitingIds } }, select: { id: true, preview: true }, orderBy: { createdAt: "asc" } })
    : [];
  const titles = waiting.map((w) => (typeof record(w.preview).title === "string" ? (record(w.preview).title as string) : DELEGATION_COPY.askTitle(delegate.name)));
  if (titles.length > 0) {
    const line = await writeEventLine(a.turn.sessionId, {
      text: DELEGATION_COPY.delegateWaitingLine(delegate.name, titleList(titles)),
      event: "delegate_waiting",
      agentId: a.agent.id,
      link: { kind: "chat", slug: delegate.slug, actionId: waiting[0].id },
    });
    if (line) a.emit?.({ type: "event", message: line });
  }
  // The delegate's chat changed: the person's open tabs read it again.
  publishToUser(a.person.userId, { type: "agent.changed", agentId: delegate.id });

  // What waits is said even when no words came back, so the caller never asks again for what already waits (review round 1).
  const waits = titles.length > 0 ? { waiting: titles.map((title) => ({ title })), note: DELEGATION_COPY.waitingNote(a.person.firstName, delegate.name) } : {};
  if (!turn || (!turn.text.trim() && turn.error)) {
    return done("failed", { error: DELEGATION_COPY.delegateNoAnswer(delegate.name), ...waits }, { errorText: DELEGATION_COPY.delegateNoAnswer(delegate.name) });
  }
  // An answer cut short or declined part way is said to be one, so the
  // caller never passes it on as whole (review round 5), even when its save
  // failed too (round 6). An answer that only failed to save is whole.
  const endedEarly = turn.endedEarly;
  const notes = [
    ...(endedEarly ? [DELEGATION_COPY.endedEarlyNote(delegate.name)] : []),
    ...(titles.length > 0 ? [DELEGATION_COPY.waitingNote(a.person.firstName, delegate.name)] : []),
  ];
  return done("ran", {
    ok: true,
    teammate: { name: delegate.name },
    answer: clampText(turn.text, DELEGATE_ANSWER_MAX),
    ...(endedEarly ? { endedEarly: true } : {}),
    waiting: titles.map((title) => ({ title })),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  });
}

/** How a call's record differs from what the model read. */
interface DoneExtra {
  errorText?: string;
  actionId?: string;
  /** What the call log keeps of the result, when it is not the result itself: a connector read's count (Decision 16). */
  stored?: unknown;
}

/**
 * Where and how often a connector call may run (see the file header), or
 * the sentence that says why not. Counted only once it may run, so a
 * refusal spends nothing of the answer's share.
 */
function connectorPrecheck(a: ExecuteArgs, name: ConnectorToolName): string | null {
  if (!connectorTrigger(a.turn.trigger)) {
    const kind = notHereKindOf(a.turn.trigger);
    return kind ? notHereSentence(kind) : ACTION_ERRORS.toolOff;
  }
  const c = (a.counters.connector ??= emptyConnectorCounters());
  if (c.calls >= CONNECTOR_LIMITS.callsPerTurn) return CONNECTOR_COPY.tooManyThisTurn;
  const own = CONNECTOR_TURN_LIMITS[name];
  if (own && c[own.key] >= own.max) return own.sentence;
  const minute = rateLimit(`google-tools:${a.person.userId}`, { max: CONNECTOR_LIMITS.perPersonPerMinute, windowMs: 60_000 });
  if (!minute.ok) return CONNECTOR_COPY.ourRateLimit(minute.retryAfter);
  c.calls += 1;
  if (own) c[own.key] += 1;
  return null;
}

/**
 * Why this turn was not offered a Google tool the model called anyway: a tool
 * the teammate does not hold at all, then where its answer goes, else the
 * person's connection or allow.
 */
function connectorMissing(a: ExecuteArgs, name: ConnectorToolName): string {
  if (!(a.connectorHeld ?? []).includes(name)) return ACTION_ERRORS.toolOff;
  const kind = a.connectorNotHere ?? notHereKindOf(a.turn.trigger);
  if (kind) return notHereSentence(kind);
  const product = TOOL_PRODUCT[name];
  const refusal = a.connectorRefusals?.[product];
  return refusal ? connectorRefusalSentence(refusal, a.agent.name, product) : ACTION_ERRORS.toolOff;
}

/**
 * A send or a reply exactly like one already waiting for this person (the
 * same recipients, subject, body and conversation: the preparation's
 * dedupeKey), which a planted loop would otherwise ask for again and again,
 * so one "Approve 5" sends five (Decision 23). An invitation the same way:
 * the same people, title, times and account (calendar.ts eventDedupeKey,
 * review of step 4). A card with no key (a new event with nobody invited)
 * has no twin.
 */
async function waitingTwin(person: ActingPerson, tool: ToolName, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const key = input.dedupeKey;
  if (typeof key !== "string" || key.length === 0) return null;
  const row = await prisma.agentAction.findFirst({
    where: {
      organizationId: person.organizationId,
      actingForId: person.userId,
      toolName: tool,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      input: { path: ["dedupeKey"], equals: key },
    },
    select: { id: true },
  });
  return row ? { id: row.id } : null;
}

/**
 * Run one call the model asked for, as the person (see the file header). A
 * refusal, a tool's failure or a tool that throws is a result the model
 * reads and the log keeps; only the queue's own writes can throw.
 */
export async function executeToolCall(a: ExecuteArgs): Promise<ExecuteResult> {
  const started = Date.now();
  const input = record(a.input);
  // A Google read's record keeps no input either: its ids and search words
  // are the person's mail, not the teammate's words (Decision 16).
  const googleRead = isConnectorToolName(a.name) && BASE_RISK[a.name] === "READ";
  // Set once a call is past the reads (below): a Talk turn's writes tell the
  // model only how they went.
  let talkWrite = false;
  const done = (state: CallState, result: unknown, extra: DoneExtra = {}): ExecuteResult => ({
    record: {
      name: a.name,
      input: googleRead ? null : input,
      result: "stored" in extra ? extra.stored : result,
      errorText: extra.errorText ?? null,
      durationMs: Date.now() - started,
      state,
      actionId: extra.actionId ?? null,
    },
    modelContent: wrapToolData(a.name, talkWrite ? toldInTalk(state, result) : result),
    isError: state === "failed",
  });
  const refuse = (error: string, detail?: Record<string, unknown>) => done("failed", { ...detail, error });

  a.counters.calls += 1;
  if (a.counters.calls > MAX_TOOL_CALLS_PER_TURN) return refuse(ACTION_ERRORS.tooManyCalls);
  const enabled: ReadonlySet<string> = a.enabled instanceof Set ? a.enabled : new Set(a.enabled);
  const name = a.name;
  const tool = isToolName(name) && enabled.has(name) && !TEAMMATE_EXCLUDED.has(name) ? TOOLS[name] : undefined;
  if (!isToolName(name) || !tool) {
    // A Google tool this turn was not offered says why (see the file header).
    if (isConnectorToolName(name)) return refuse(connectorMissing(a, name));
    return refuse(ACTION_ERRORS.toolOff);
  }
  // The model API does not enforce input_schema: no read or write sees an
  // input the tool's own schema does not describe (input-check.ts), so an
  // object where a string belongs never reaches a query as a filter.
  const checked = checkToolInput(tool.input_schema, a.input);
  if (!checked.ok) return refuse(badInputSentence(checked.field));

  // A Google call: where and how often first, then the person as they are
  // now, never as they were when a long turn began (the connection and the
  // allow are read in the preparation and the handler).
  let person = a.person;
  if (isConnectorToolName(name)) {
    const stop = connectorPrecheck(a, name);
    if (stop) return refuse(stop);
    const now = await resolveActingPerson(a.person.organizationId, a.person.userId).catch(() => null);
    if (!now?.ok) return refuse(ACTION_ERRORS.personCannot);
    person = now.person;
  }
  const teammate: Omit<TeammateToolContext, "timezone"> = {
    agentId: a.agent.id,
    agentName: a.agent.name,
    sessionId: a.turn.sessionId,
    routineId: a.turn.routineId,
    trigger: a.turn.trigger,
    ...(a.turn.audience ? { audience: a.turn.audience } : {}),
  };

  // Asking another teammate runs that teammate's own turn (runDelegation).
  if (name === "ask_teammate") return runDelegation(a, checked.input, done, refuse);

  // Reads run, in a practice run too: they change nothing.
  if (BASE_RISK[name] === "READ") {
    const ran = await runHandler(tool, toolCtxFor(person, teammate), checked.input);
    if (!ran.ok) return done("failed", { error: ran.error }, { errorText: ran.error });
    const failed = toolOutcome(name, ran.result).failed;
    if (!isConnectorToolName(name) || failed) return done(failed ? "failed" : "ran", ran.result);
    // Other people's words came back: every later call above READ in this
    // turn waits on a card (Decision 9).
    if (TAINTING_TOOLS.has(name)) {
      a.counters.tainted = true;
      a.counters.readGoogle = true;
    }
    // The model reads all of it, once; the log keeps how many (Decision 16).
    return done("ran", ran.result, { stored: connectorStored(ran.result) });
  }

  // A Talk answer posts with no card to people who may not open what a write
  // names: a task's title, its List, a doc, a channel, or the Lists a
  // refusal offers. In a Talk turn the model hears only that the call ran,
  // waits or failed; the names stay on the card and in the person's own chat
  // (review round 5).
  talkWrite = a.turn.trigger === "TALK";
  const tainted = a.counters.tainted === true;
  const prepared = await prepareCall(name, checked.input, {
    person,
    teammate: { agentId: a.agent.id, agentName: a.agent.name, trigger: a.turn.trigger },
    agentRules: a.agentRules,
    tainted,
  });
  // A reply's preparation read its conversation in Gmail, or a calendar
  // write's the event it names (step 4): from here the turn has read other
  // people's words, as after search_email (review of step 3).
  if (prepared.readGoogle) {
    a.counters.tainted = true;
    a.counters.readGoogle = true;
  }
  if (!prepared.ok) return refuse(prepared.error, prepared.detail);
  // What the model and the history call a Google write: never its card's
  // title, which can quote a subject from someone else's email (review of
  // step 3). The card the person reads keeps it.
  const modelTitle = isConnectorToolName(name) ? connectorTitle(name) : prepared.preview.title;
  if (a.practice) return done("practice", { practice: true, wouldDo: modelTitle });

  // After a Google read in this turn nothing above READ runs without a card,
  // and the person's "Don't ask" is not read (Decision 9).
  const gate = tainted ? "ask" : gateFor({ tool: name, risk: prepared.risk, targetKey: prepared.targetKey, agentRules: a.agentRules, personRules: a.personRules });
  if (gate === "ask") {
    // An invitation too (review of step 4): two identical create_event cards
    // would each email every invitee and make a second event.
    if (name === "send_email" || name === "reply_email" || name === "create_event") {
      const twin = await waitingTwin(person, name, prepared.input);
      if (twin) {
        // The answer points at the card that already waits; the record names
        // no action of its own, so this turn's approval row never shows the
        // same email a second time, nor in another chat (review of step 3).
        const note = name === "create_event" ? CONNECTOR_COPY.alreadyWaitingEvent : CONNECTOR_COPY.alreadyWaiting;
        return done("waiting", { status: "waiting_for_approval", actionId: twin.id, title: modelTitle, note });
      }
    }
    if (a.counters.proposals >= MAX_PROPOSALS_PER_TURN || (await waitingCount(person.organizationId, person.userId)) >= MAX_PENDING_PER_PERSON) {
      return refuse(tooManyWaiting(person.firstName));
    }
    const view = await proposeAction({
      organizationId: person.organizationId,
      agentId: a.agent.id,
      actingForId: person.userId,
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
    return done("waiting", { status: "waiting_for_approval", actionId: view.id, title: isConnectorToolName(name) ? modelTitle : view.preview.title }, { actionId: view.id });
  }

  if (prepared.risk !== "INTERNAL") {
    // Other people will see it, and the person chose not to be asked: on
    // record as an action decided by their rule, run through the same path
    // as an approval. Already reported: the model reads the result now.
    const actionId = await recordRuleAction(a, name, prepared);
    const out = await runApprovedAction({
      action: { id: actionId, toolName: name, risk: prepared.risk, sessionId: a.turn.sessionId, runId: a.turn.runId, routineId: a.turn.routineId, preview: prepared.preview },
      input: prepared.input,
      person,
      agent: a.agent,
      trigger: a.turn.trigger,
      decidedVia: "rule",
    });
    return out.status === "EXECUTED" ? done("ran", out.data, { actionId }) : done("failed", out.data, { actionId });
  }

  const ran = await runHandler(tool, toolCtxFor(person, teammate), prepared.input);
  if (!ran.ok) return done("failed", { error: ran.error }, { errorText: ran.error });
  if (toolOutcome(name, ran.result).failed) return done("failed", ran.result);
  await auditAgentAction({
    person,
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
    // The teammate the line is about: a group chat holds several.
    const message = await writeEventLine(a.turn.sessionId, { ...line, agentId: a.agent.id });
    if (message) a.emit?.({ type: "event", message });
  }
  return done("ran", ran.result);
}

/** What a Talk turn's model hears of a write: how it went, never what it names (see executeToolCall). */
function toldInTalk(state: CallState, result: unknown): Record<string, unknown> {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  if (state === "waiting") return { status: "waiting_for_approval", actionId: r.actionId ?? null, note: TALK_TEAMMATE_COPY.toldWaiting };
  if (state === "failed") return { error: TALK_TEAMMATE_COPY.toldFailed };
  return { ok: true, note: TALK_TEAMMATE_COPY.toldDone };
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
  /** Null: Ask AI's own request, run in the person's own context exactly as Ask AI runs a tool. */
  agent: TeammateRef | null;
  /** "APPROVAL" for a person's approval; the turn's own trigger for a call their rule let run. */
  trigger: TeammateToolContext["trigger"];
  decidedVia: "person" | "rule";
  /**
   * The person's approval (actions.ts approve): a Google handler that refused
   * before anything was sent, with a reason that can be mended (its `held`),
   * answers HELD and leaves the row RUNNING for the caller to put back to
   * PENDING, never FAILED (review of step 3). Only a write whose outcome is
   * unknown, or one Google refused as written, ends the card.
   */
  holdNotSent?: boolean;
}

export type ApprovedOutcome =
  | { status: "EXECUTED"; result: ActionResult; data: unknown }
  | { status: "FAILED"; error: string; data: unknown }
  | { status: "HELD"; code: HeldCode; error: string; data: unknown };

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
  const ctx: ToolContext = a.agent
    ? toolCtxFor(a.person, {
        agentId: a.agent.id,
        agentName: a.agent.name,
        sessionId: a.action.sessionId,
        routineId: a.action.routineId,
        trigger: a.trigger,
        actionId: a.action.id,
      })
    : { orgId: a.person.organizationId, userId: a.person.userId };
  const ran = tool ? await runHandler(tool, ctx, a.input) : ({ ok: false, error: ACTION_ERRORS.toolOff } as const);
  const data = ran.ok ? ran.result : { error: ran.error };
  const outcome = toolOutcome(name, data);
  if (outcome.failed) {
    const held = record(data).held;
    if (a.holdNotSent && isConnectorToolName(name) && isHeldCode(held)) {
      const said = record(data).error;
      return { status: "HELD", code: held, error: typeof said === "string" && said ? said : (outcome.message ?? TEAMMATE_TOOL_ERRORS.notAllowed), data };
    }
    const error = outcome.message ?? TEAMMATE_TOOL_ERRORS.notAllowed;
    await prisma.agentAction.updateMany({ where: { id: a.action.id, status: "RUNNING" }, data: { status: "FAILED", error } });
    return { status: "FAILED", error, data };
  }
  const href = outcome.href ?? a.action.preview?.target?.href ?? null;
  const result: ActionResult = { text: toolOutcomeSentence(name, a.input, outcome).text, href, data };
  // It ran: the audit row is written first, so nothing after it can leave an
  // action that happened with no record of it (review round 1).
  await auditAgentAction({
    person: a.person,
    agent: a.agent ?? ASK_AI_AUDIT,
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
  try {
    await prisma.agentAction.updateMany({
      where: { id: a.action.id, status: "RUNNING" },
      data: { status: "EXECUTED", result: json(result), executedAt: new Date(), error: null },
    });
  } catch (err) {
    // The full result would not store: keep the outcome with its sentence
    // alone, so the card still says it ran and nothing asks to run it again.
    console.error(`[agents] action ${a.action.id} result not stored: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    await prisma.agentAction.updateMany({
      where: { id: a.action.id, status: "RUNNING" },
      data: { status: "EXECUTED", result: json({ text: clampText(result.text, 240), href: result.href }), executedAt: new Date(), error: null },
    });
  }
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
  agent: AuditAgent;
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
  // A Google write's sentence names no subject, and its facts are the id
  // Google gave it and how many it reached (Decision 16): admins read the
  // audit log, and the subject and the addresses are the person's mail.
  const connector = isConnectorToolName(a.toolName) ? a.toolName : null;
  const what = connector ? toolSentence(connector, null).text : toolOutcomeSentence(a.toolName, a.input, toolOutcome(a.toolName, a.result)).text;
  const target = connector ? null : auditTarget(a.result);
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
      ...(connector ? { connector: connectorAuditFacts(connector, a.input, a.result) } : {}),
    },
    severity: a.risk === "IRREVERSIBLE" ? "warning" : "info",
  });
}
