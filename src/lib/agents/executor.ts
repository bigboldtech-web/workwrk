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
// (Decision 23; the invitation, review of step 4); one identical to a card
// being sent, or sent in the last ten minutes, says so and asks nothing; the
// check and the card are made under one lock on the key (review round 1 of
// Phase 3). The run is marked the moment the turn reads Google, and every
// card a tainted turn asks for is marked on its own row (review round 1).
//
// THE PERSON'S BROWSER (docs/plans/ai-teammates-phase4.md step 3). A browser
// call runs only in the person's own one-teammate chat or its continue
// (Decision 21; anywhere else it answers why), at most 20 an answer and each
// tool's own count, 40 a minute per person (Decision 22), the person read
// again for it. A browser tool the turn was not offered answers its real
// reason (Decision 33). The moment a call meets a page the turn has read
// the web (Decision 15): every later call above READ asks, the run is marked
// at once (markRunReadWeb), and every card asked from then on is marked
// (AgentAction.readWeb). A browser call's record keeps its site and a count,
// never a page's text or an address (Decision 23); the model and the history
// name a browser step by its kind (browserTitle), never by an element's
// words. A step it asks for waits on a card of its own, one per session at
// a time, made under the session's card lock with the session swapped to
// waiting, expiring with the session's waiting window (Decision 13).
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
import { RUN_LOCK_TX_MAX_WAIT_MS, RUN_LOCK_TX_TIMEOUT_MS, claimTeammateTurn, giveBackTurn, runStillOpen, type TurnTrigger } from "./budget";
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
import {
  BROWSER_STEP_KIND,
  BROWSER_TOOL_COUNTS,
  COUNTED_ON_CARD,
  browserActOutcome,
  browserAuditFacts,
  browserNotHereOf,
  browserNotHereSentence,
  browserRefusalSentence,
  browserStored,
  browserTitle,
  closedSentence,
  emptyBrowserCounters,
  type BrowserCounters,
  type BrowserNotHere,
  type BrowserRefusal,
} from "./browser-rules";
import { BROWSER_TURN_LIMITS } from "@/lib/browser/classes";
import { siteOf } from "@/lib/browser/sites";
import { prepareCall, type Prepared } from "./previews";
import {
  ACTION_ERRORS,
  BROWSER_AUDIT_COPY,
  BROWSER_COPY,
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
import type { AllowPart } from "./teammate-print";
import type { ActionPreview, ActionResult, ActionView, CallState, TeammateStreamEvent } from "./teammate-thread";
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
import { isBrowserToolName, isConnectorToolName, isToolName, type BrowserToolName, type ConnectorToolName, type ToolName } from "./tool-names";
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
  /** The turn: its chat, its routine, what started it, and its AgentRun. `group`: a group chat (Phase 4: never the browser, Decision 21). */
  turn: {
    sessionId: string | null;
    routineId: string | null;
    trigger: TurnTrigger;
    runId: string;
    audience?: readonly string[];
    group?: boolean;
    /** A continue (RESUME): the runs of the answers it carries on, the runs of the cards it is told (review round 5 of Phase 4, engine.ts runTurn). */
    continues?: readonly string[];
    /**
     * The person's own Teach a skill message started this turn
     * (docs/plans/ai-teammates-phase5.md: the newest USER row's meta.showMe,
     * which only the messages route writes; engine.ts sets it in step 3):
     * an ask_to_show_me card says their words (browser-previews.ts).
     */
    showMe?: { name: string };
  };
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
   * (Decision 22). `readWeb`: a browser call of this turn met a page, or the
   * turn started from one that did (Phase 4 Decision 15), which the turn's
   * rows record; `browser`: its browser calls (Decision 22). All start empty
   * when a caller leaves them out.
   */
  counters: {
    calls: number;
    proposals: number;
    delegations: number;
    tainted?: boolean;
    readGoogle?: boolean;
    connector?: ConnectorCounters;
    readWeb?: boolean;
    browser?: BrowserCounters;
  };
  /** Why a Google product's tools are not offered this turn (engine.ts prepareTurn), so a call to one answers its real reason. */
  connectorRefusals?: Partial<Record<ConnectorProduct, { reason: ConnectorRefusal; changed?: AllowPart[] }>>;
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
  /**
   * The Google products the teammate holds tools for that are on here, which
   * that refusal names, as block 2 does (review of step 5). Left out: the
   * called tool's own product.
   */
  connectorNotHereProducts?: readonly ConnectorProduct[];
  /**
   * Why this turn was not offered the browser (engine.ts prepareTurn, a
   * one-teammate CHAT or RESUME whose computer access refused), so a call to
   * a browser tool answers its real reason (Phase 4, Decision 33).
   */
  browserRefusal?: { reason: BrowserRefusal } | null;
  /** The browser tools this teammate's own set holds, whatever this turn offers: a call to one it does not hold is refused as any tool it lacks. */
  browserHeld?: readonly string[];
  /** Where this turn runs, when that is why it has no browser (Decision 21); left out, it is read from the trigger and the group. */
  browserNotHere?: BrowserNotHere | null;
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
  // Both lines only while their turn's run is open (review round 4 of Phase 3): this one the delegate's, the next the caller's.
  await writeEventLine(
    session.id,
    { text: DELEGATION_COPY.askedByLine(a.agent.name, clampText(request, 300)), event: "delegated_asked", agentId: delegate.id },
    { whileOpen: { runId: claim.runId, personId: person.userId } },
  );

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
      // A web page's too (Phase 4 Decision 15), marked as one on its rows.
      origin: { kind: "delegated", by: { agentId: a.agent.id, name: a.agent.name, sessionId: a.turn.sessionId, runId: a.turn.runId }, request, tainted: a.counters.tainted === true, ...(a.counters.readWeb === true ? { readWeb: true } : {}) },
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
    const line = await writeEventLine(
      a.turn.sessionId,
      {
        text: DELEGATION_COPY.delegateWaitingLine(delegate.name, titleList(titles)),
        event: "delegate_waiting",
        agentId: a.agent.id,
        link: { kind: "chat", slug: delegate.slug, actionId: waiting[0].id },
      },
      { whileOpen: { runId: a.turn.runId, personId: a.person.userId } },
    );
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
  /** A browser call's site, when its result does not name one (a card that waits): its record's only input (Phase 4 Decision 23). */
  site?: string | null;
}

/** A host as a record keeps it: lower-case letters, digits, dots, hyphens and underscores, at most 253; else none. */
function hostOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 253 && /^[a-z0-9._-]+$/i.test(v) ? v.toLowerCase() : null;
}

/** A browser step's input as a sentence or an audit line reads it: its site only (Decision 24). */
function browserSiteInput(input: Record<string, unknown> | null): Record<string, unknown> {
  const site = hostOf((input ?? {}).site);
  return site ? { site } : {};
}

/**
 * What a browser call's record keeps as its input (Decision 23): its site
 * alone (the result's, the card's, else the host of the address asked),
 * never the address, an element's id, the words typed or the option.
 */
function browserRecordInput(name: string, input: Record<string, unknown>, result: unknown, site: string | null | undefined): Record<string, unknown> {
  const host = site ?? hostOf(record(result).site) ?? (name === "open_page" && typeof input.url === "string" ? siteOf(input.url) : null);
  return host ? { site: host } : {};
}

/**
 * Where and how often a browser call may run (see the file header), or the
 * sentence that says why not. Counted only once it may run; a step asked
 * and a take over request are counted when their card is made, so one the
 * page refused before it was asked can be asked again.
 */
function browserPrecheck(a: ExecuteArgs, name: BrowserToolName): string | null {
  const kind = a.browserNotHere ?? browserNotHereOf(a.turn.trigger, a.turn.group === true);
  if (kind) return browserNotHereSentence(kind);
  if (a.turn.trigger !== "CHAT" && a.turn.trigger !== "RESUME") return ACTION_ERRORS.toolOff;
  const c = (a.counters.browser ??= emptyBrowserCounters());
  if (c.calls >= BROWSER_TURN_LIMITS.calls) return BROWSER_COPY.tooManyThisTurn;
  const own = BROWSER_TOOL_COUNTS[name];
  // A step asked and a take over request are held to theirs at the card (askBrowserCard), after the waiting card's own check.
  if (own && !COUNTED_ON_CARD.has(own.key) && c[own.key] >= own.max) return own.sentence;
  const minute = rateLimit(`browser-tools:${a.person.userId}`, { max: BROWSER_TURN_LIMITS.perPersonPerMinute, windowMs: 60_000 });
  if (!minute.ok) return BROWSER_COPY.ourRateLimit(minute.retryAfter);
  c.calls += 1;
  if (own && !COUNTED_ON_CARD.has(own.key)) c[own.key] += 1;
  return null;
}

/**
 * Why this turn was not offered a browser tool the model called anyway: a
 * tool the teammate does not hold at all (as any tool it lacks); then the
 * computer's own refusal (Decision 33); then where the turn runs (Decision
 * 21).
 */
function browserMissing(a: ExecuteArgs, name: BrowserToolName): string {
  if (!(a.browserHeld ?? []).includes(name)) return ACTION_ERRORS.toolOff;
  if (a.browserRefusal) return browserRefusalSentence(a.browserRefusal.reason, a.agent.name, a.person.firstName);
  const kind = a.browserNotHere ?? browserNotHereOf(a.turn.trigger, a.turn.group === true);
  if (kind) return browserNotHereSentence(kind);
  return ACTION_ERRORS.toolOff;
}

const browserSessions = () => import("@/lib/browser/sessions");

/**
 * Where and how often a connector call may run (see the file header), or
 * the sentence that says why not. Counted only once it may run, so a
 * refusal spends nothing of the answer's share.
 */
function connectorPrecheck(a: ExecuteArgs, name: ConnectorToolName): string | null {
  if (!connectorTrigger(a.turn.trigger)) {
    const kind = notHereKindOf(a.turn.trigger);
    return kind ? notHereSentence(kind, notHereProducts(a, name)) : ACTION_ERRORS.toolOff;
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

/** The products a "not here" refusal names: the held ones on here, else the called tool's own (review of step 5). */
function notHereProducts(a: ExecuteArgs, name: ConnectorToolName): readonly ConnectorProduct[] {
  const held = a.connectorNotHereProducts ?? [];
  return held.length > 0 ? held : [TOOL_PRODUCT[name]];
}

/**
 * Why this turn was not offered a Google tool the model called anyway: a tool
 * the teammate does not hold at all; then a product this workspace has off,
 * or this WorkwrK does not offer, wherever the turn runs; then where its
 * answer goes; else the person's connection or allow. Review of step 5: a
 * product off is its own reason, never "not here", which named a product
 * nobody here can use, and a "not here" names only the products the teammate
 * holds tools for that are on, as block 2 does.
 */
function connectorMissing(a: ExecuteArgs, name: ConnectorToolName): string {
  if (!(a.connectorHeld ?? []).includes(name)) return ACTION_ERRORS.toolOff;
  const product = TOOL_PRODUCT[name];
  const refusal = a.connectorRefusals?.[product];
  if (refusal && (refusal.reason === "workspace_off" || refusal.reason === "not_configured")) return connectorRefusalSentence(refusal, a.agent.name, product);
  const kind = a.connectorNotHere ?? notHereKindOf(a.turn.trigger);
  if (kind) return notHereSentence(kind, notHereProducts(a, name));
  return refusal ? connectorRefusalSentence(refusal, a.agent.name, product) : ACTION_ERRORS.toolOff;
}

/** The tools whose cards a twin replaces: what tells other people, sent once (Decision 23; the invitation, review of step 4). */
const DEDUPED: ReadonlySet<string> = new Set(["send_email", "reply_email", "create_event"]);

/** How long an identical email or invitation that went out still counts as a twin (review round 1 of Phase 3). */
const SENT_TWIN_MS = 10 * 60 * 1000;

/** The class of the twin check's advisory lock: its own key space (the two int form), apart from every other lock. */
const DEDUPE_LOCK_CLASS = 73_021;

/**
 * A twin of a card about to be made: one waiting for the person, one sent (or
 * being sent) a moment ago, or one that may have been sent a moment ago
 * (review round 2 of Phase 3).
 */
type Twin = { id: string; state: "waiting" | "sent" | "maybe_sent" };

/**
 * A send or a reply exactly like one already waiting for this person (the
 * same recipients, subject, body and conversation: the preparation's
 * dedupeKey), which a planted loop would otherwise ask for again and again,
 * so one "Approve 5" sends five (Decision 23). An invitation the same way:
 * the same people, title, times and account (calendar.ts eventDedupeKey,
 * review of step 4). A card with no key (a new event with nobody invited)
 * has no twin.
 *
 * REVIEW ROUND 1 OF PHASE 3. A card being sent right now (RUNNING), or sent
 * in the last ten minutes (EXECUTED), is a twin too: a planted "send it
 * again" in the continue made a fresh identical card, and the person
 * approved it thinking it was another. Read inside the caller's transaction,
 * under the key's lock (withTwinLock).
 *
 * REVIEW ROUND 2 OF PHASE 3. So is one that ended in the last ten minutes
 * with an outcome nobody knows (result.unknownOutcome: Google timed out or
 * answered 5xx after the send, runApprovedAction; or the sweep failed it
 * stuck RUNNING, actions.ts sweepActions). Gmail may have sent it, and the
 * continue told "it didn't work" asked for the very same email again on a
 * fresh card, which the person approved thinking the first had failed. The
 * ten minutes run from when it failed (updatedAt, set then).
 */
async function findTwin(db: Prisma.TransactionClient, person: ActingPerson, tool: ToolName, key: string, now: Date): Promise<Twin | null> {
  const since = new Date(now.getTime() - SENT_TWIN_MS);
  const row = await db.agentAction.findFirst({
    where: {
      organizationId: person.organizationId,
      actingForId: person.userId,
      toolName: tool,
      input: { path: ["dedupeKey"], equals: key },
      OR: [
        { status: "PENDING", expiresAt: { gt: now } },
        { status: "RUNNING" },
        { status: "EXECUTED", executedAt: { gt: since } },
        { status: "FAILED", updatedAt: { gt: since }, result: { path: ["unknownOutcome"], equals: true } },
      ],
    },
    select: { id: true, status: true },
  });
  if (!row) return null;
  return { id: row.id, state: row.status === "PENDING" ? "waiting" : row.status === "FAILED" ? "maybe_sent" : "sent" };
}

/**
 * The twin check and the card it may make, under one transaction-scoped lock
 * on the person, the tool and the key (review round 1 of Phase 3): two turns
 * at once (two teammates in a group, two chats one planted email drives)
 * each found no twin and each made a card, and the person could approve both.
 * Now the second waits for the first to commit, then finds its card. A card
 * with no key takes no lock, but is made in a transaction too (review round 4
 * of Phase 3), so the run check made with it holds until the card is written.
 *
 * EVERY READ IN `fn` GOES THROUGH `db` (review round 5 of Phase 3): one on the
 * base client asks for a second connection while this one is held, so with
 * the routine runner's 10 turns at a time the pool (10) could run dry and
 * every card wait to its timeout, its answer lost. Each branch also waits up
 * to RUN_LOCK_TX_MAX_WAIT_MS to start, not Prisma's 2 seconds.
 */
async function withTwinLock<T>(
  person: ActingPerson,
  tool: ToolName,
  input: Record<string, unknown>,
  fn: (twin: Twin | null, db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const key = input.dedupeKey;
  const opts = { timeout: RUN_LOCK_TX_TIMEOUT_MS, maxWait: RUN_LOCK_TX_MAX_WAIT_MS };
  if (!DEDUPED.has(tool) || typeof key !== "string" || key.length === 0) {
    return prisma.$transaction((tx) => fn(null, tx), opts);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEDUPE_LOCK_CLASS}::int, hashtext(${`${person.organizationId}:${person.userId}:${tool}:${key}`}))`;
    return fn(await findTwin(tx, person, tool, key, new Date()), tx);
  }, opts);
}

/**
 * Record on the turn's run, at once, that the turn read the person's Google
 * (review round 1 of Phase 3): output.readGoogle merged into whatever the run
 * holds, never replacing it. The run was marked only when the turn finished,
 * so a turn that stopped part way (a reload during a deploy, out of memory)
 * left its cards to be told to a later turn as if nothing had been read. A
 * write that fails is logged: the turn's cards carry their own mark
 * (AgentAction.readGoogle), and a run with no verdict on record reads as
 * unknown (engine.ts startsTainted).
 */
export async function markRunReadGoogle(runId: string): Promise<void> {
  if (!runId) return;
  await prisma.$executeRaw`
    UPDATE "AgentRun"
       SET "output" = jsonb_set(CASE WHEN jsonb_typeof("output") = 'object' THEN "output" ELSE '{}'::jsonb END, '{readGoogle}', 'true'::jsonb, true)
     WHERE "id" = ${runId}`.catch((err) => {
    console.error(`[agents] run ${runId}: its Google read not recorded yet: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
  });
}

/**
 * The turn has read other people's words from the person's Google: every
 * later call above READ waits on a card (Decision 9), and the run says so
 * the first time (markRunReadGoogle).
 */
async function turnReadGoogle(a: ExecuteArgs): Promise<void> {
  a.counters.tainted = true;
  if (a.counters.readGoogle === true) return;
  a.counters.readGoogle = true;
  await markRunReadGoogle(a.turn.runId);
}

/**
 * Record on the turn's run, at once, that the turn read a web page (Phase 4
 * Decision 15): markRunReadGoogle's statement with output.readWeb, merged
 * into whatever the run holds.
 */
export async function markRunReadWeb(runId: string): Promise<void> {
  if (!runId) return;
  await prisma.$executeRaw`
    UPDATE "AgentRun"
       SET "output" = jsonb_set(CASE WHEN jsonb_typeof("output") = 'object' THEN "output" ELSE '{}'::jsonb END, '{readWeb}', 'true'::jsonb, true)
     WHERE "id" = ${runId}`.catch((err) => {
    console.error(`[agents] run ${runId}: its web read not recorded yet: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
  });
}

/**
 * The turn has met a web page: every later call above READ waits on a card
 * (Decision 15), and the run says so the first time (markRunReadWeb).
 */
async function turnReadWeb(a: ExecuteArgs): Promise<void> {
  a.counters.tainted = true;
  if (a.counters.readWeb === true) return;
  a.counters.readWeb = true;
  await markRunReadWeb(a.turn.runId);
}

/**
 * What a card asked in this turn is marked with (review round 1 of Phase 3,
 * Phase 4 Decision 15): read the web when a browser call met a page; read
 * Google when the person's Google was read, or the turn is tainted by a
 * start that could not tell and no web read explains it.
 */
function cardMarks(a: ExecuteArgs): { readGoogle: boolean; readWeb: boolean } {
  const readWeb = a.counters.readWeb === true;
  const readGoogle = a.counters.readGoogle === true || (a.counters.tainted === true && !readWeb);
  return { readGoogle, readWeb };
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
  // are the person's mail, not the teammate's words (Decision 16). A browser
  // call's keeps its site alone (Phase 4 Decision 23).
  const googleRead = isConnectorToolName(a.name) && BASE_RISK[a.name] === "READ";
  const browserCall = isBrowserToolName(a.name);
  // Set once a call is past the reads (below): a Talk turn's writes tell the
  // model only how they went.
  let talkWrite = false;
  const done = (state: CallState, result: unknown, extra: DoneExtra = {}): ExecuteResult => ({
    record: {
      name: a.name,
      input: browserCall ? browserRecordInput(a.name, input, result, extra.site) : googleRead ? null : input,
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
    // A Google or browser tool this turn was not offered says why (see the file header).
    if (isConnectorToolName(name)) return refuse(connectorMissing(a, name));
    if (isBrowserToolName(name)) return refuse(browserMissing(a, name));
    return refuse(ACTION_ERRORS.toolOff);
  }
  // The model API does not enforce input_schema: no read or write sees an
  // input the tool's own schema does not describe (input-check.ts), so an
  // object where a string belongs never reaches a query as a filter.
  const checked = checkToolInput(tool.input_schema, a.input);
  if (!checked.ok) return refuse(badInputSentence(checked.field));

  // A Google or browser call: where and how often first, then the person as
  // they are now, never as they were when a long turn began (the connection,
  // the allow, the computer and the session are read in the preparation and
  // the handler).
  let person = a.person;
  if (isConnectorToolName(name) || isBrowserToolName(name)) {
    const stop = isConnectorToolName(name) ? connectorPrecheck(a, name) : browserPrecheck(a, name as BrowserToolName);
    if (stop) return refuse(stop);
    const now = await resolveActingPerson(a.person.organizationId, a.person.userId).catch(() => null);
    if (!now?.ok) return refuse(ACTION_ERRORS.personCannot);
    person = now.person;
  }
  // A browser call tells the turn it met a page (Decision 15), and that it
  // started the browser (one an answer, Decision 22).
  let webRead = false;
  const teammate: Omit<TeammateToolContext, "timezone"> = {
    agentId: a.agent.id,
    agentName: a.agent.name,
    sessionId: a.turn.sessionId,
    routineId: a.turn.routineId,
    trigger: a.turn.trigger,
    runId: a.turn.runId,
    ...(a.turn.audience ? { audience: a.turn.audience } : {}),
    ...(browserCall
      ? {
          browser: {
            tainted: a.counters.tainted === true,
            mayStart: (a.counters.browser?.starts ?? 0) < BROWSER_TURN_LIMITS.starts,
            onStart: () => {
              (a.counters.browser ??= emptyBrowserCounters()).starts += 1;
            },
            onWebRead: () => {
              webRead = true;
            },
            ...(a.turn.continues && a.turn.continues.length > 0 ? { continues: a.turn.continues } : {}),
          },
        }
      : {}),
  };

  // Asking another teammate runs that teammate's own turn (runDelegation).
  if (name === "ask_teammate") return runDelegation(a, checked.input, done, refuse);

  // Reads run, in a practice run too: they change nothing.
  if (BASE_RISK[name] === "READ") {
    const ran = await runHandler(tool, toolCtxFor(person, teammate), checked.input);
    // A browser call that met the page taints the turn before the model
    // reads a word of it, a refusal naming a host the page sent it to
    // included (Decision 15). Closing reads nothing.
    if (browserCall && webRead) await turnReadWeb(a);
    if (!ran.ok) return done("failed", { error: ran.error }, { errorText: ran.error });
    const failed = toolOutcome(name, ran.result).failed;
    // The model reads the page once; the log keeps its site and a count (Decision 23).
    if (browserCall) return failed ? done("failed", ran.result) : done("ran", ran.result, { stored: browserStored(ran.result) });
    if (!isConnectorToolName(name) || failed) return done(failed ? "failed" : "ran", ran.result);
    // Other people's words came back: every later call above READ in this
    // turn waits on a card (Decision 9), and the run says so now.
    if (TAINTING_TOOLS.has(name)) await turnReadGoogle(a);
    // The model reads all of it, once; the log keeps how many (Decision 16).
    return done("ran", ran.result, { stored: connectorStored(ran.result) });
  }

  // A Talk answer posts with no card to people who may not open what a write
  // names: a task's title, its List, a doc, a channel, or the Lists a
  // refusal offers. In a Talk turn the model hears only that the call ran,
  // waits or failed; the names stay on the card and in the person's own chat
  // (review round 5).
  talkWrite = a.turn.trigger === "TALK";
  // A turn whose run closed under it (its person's account erased, review
  // round 4 of Phase 3) changes nothing more: what it made would outlive the
  // erasure. The rows written below ask again, under the run's lock.
  if (!(await runStillOpen(prisma, a.turn.runId, a.person.userId))) return refuse(ACTION_ERRORS.personCannot);
  const tainted = a.counters.tainted === true;
  const prepared = await prepareCall(name, checked.input, {
    person,
    teammate: { agentId: a.agent.id, agentName: a.agent.name, trigger: a.turn.trigger },
    agentRules: a.agentRules,
    tainted,
    taintedBy: a.counters.readWeb === true ? "web" : "google",
    turn: {
      runId: a.turn.runId,
      sessionId: a.turn.sessionId,
      // A browser card's preparation (review round 5 of Phase 4): the answers a continue carries on, and whether this answer may still start a browser.
      ...(browserCall ? { mayStart: (a.counters.browser?.starts ?? 0) < BROWSER_TURN_LIMITS.starts } : {}),
      ...(browserCall && a.turn.continues && a.turn.continues.length > 0 ? { continues: a.turn.continues } : {}),
      // The person's own words for a request to be shown how (Phase 5 step 2), never the model's.
      ...(name === "ask_to_show_me" && a.turn.showMe ? { showMe: a.turn.showMe } : {}),
    },
  });
  // A reply's preparation read its conversation in Gmail, or a calendar
  // write's the event it names (step 4): from here the turn has read other
  // people's words, as after search_email (review of step 3). A browser
  // card's read the page (Phase 4 Decision 15).
  if (prepared.readGoogle) await turnReadGoogle(a);
  if (prepared.readWeb) await turnReadWeb(a);
  if (!prepared.ok) return refuse(prepared.error, prepared.detail);
  // What the model and the history call a Google write: never its card's
  // title, which can quote a subject from someone else's email (review of
  // step 3). A browser step's the same: never an element's words (Phase 4).
  // The card the person reads keeps it.
  const modelTitle = isBrowserToolName(name) ? browserTitle(name) : isConnectorToolName(name) ? connectorTitle(name) : prepared.preview.title;
  if (a.practice) {
    if (isBrowserToolName(name)) await practiceStep(a, person, name, prepared.input);
    return done("practice", { practice: true, wouldDo: modelTitle }, isBrowserToolName(name) ? { site: hostOf(prepared.input.site) } : {});
  }

  // After a Google read in this turn nothing above READ runs without a card,
  // and the person's "Don't ask" is not read (Decision 9).
  const gate = tainted ? "ask" : gateFor({ tool: name, risk: prepared.risk, targetKey: prepared.targetKey, agentRules: a.agentRules, personRules: a.personRules });
  // A browser step: its own card, under its session's card lock (Decision 13).
  if (isBrowserToolName(name)) return askBrowserCard(a, person, name, prepared, modelTitle, done, refuse);
  if (gate === "ask") {
    // An invitation too (review of step 4): two identical create_event cards
    // would each email every invitee and make a second event. The check and
    // the card are one step under the key's lock (withTwinLock).
    const asked = await withTwinLock(person, name, prepared.input, async (twin, db) => {
      if (twin) {
        // The answer points at the card that already waits, or says the same
        // one just went out; the record names no action of its own, so this
        // turn's approval row never shows the same email a second time, nor
        // in another chat (review of step 3).
        const event = name === "create_event";
        // Sent, or being sent: nothing more is asked, and the call says so as its outcome.
        if (twin.state === "sent") return refuse(event ? CONNECTOR_COPY.alreadySentEvent : CONNECTOR_COPY.alreadySent, { actionId: twin.id });
        // Maybe sent (review round 2 of Phase 3): nothing more is asked, and the person is told to look first.
        if (twin.state === "maybe_sent") return refuse(event ? CONNECTOR_COPY.maybeSentEvent : CONNECTOR_COPY.maybeSent, { actionId: twin.id });
        return done("waiting", { status: "waiting_for_approval", actionId: twin.id, title: modelTitle, note: event ? CONNECTOR_COPY.alreadyWaitingEvent : CONNECTOR_COPY.alreadyWaiting });
      }
      // Counted on the transaction's own client (review round 5 of Phase 3).
      if (a.counters.proposals >= MAX_PROPOSALS_PER_TURN || (await waitingCount(person.organizationId, person.userId, new Date(), { db })) >= MAX_PENDING_PER_PERSON) {
        return refuse(tooManyWaiting(person.firstName));
      }
      // The card is made only while the run is open and its person here,
      // held until it commits (budget.ts runStillOpen, review round 4 of Phase 3).
      if (!(await runStillOpen(db, a.turn.runId, person.userId))) return refuse(ACTION_ERRORS.personCannot);
      const made = await proposeAction(
        {
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
          // Proposed after a Google read in this turn, or in one that could
          // not tell: marked so on its own row now (review round 1 of Phase
          // 3), so it stands alone on its card and a turn told of it starts
          // tainted, whether or not this turn ever saves its answer or run.
          // After a web page was read, marked readWeb (Phase 4 Decision 15).
          ...cardMarks(a),
        },
        db,
      );
      return made;
    });
    if (!("id" in asked)) return asked;
    a.counters.proposals += 1;
    a.emit?.({ type: "approval", action: asked });
    return done("waiting", { status: "waiting_for_approval", actionId: asked.id, title: isConnectorToolName(name) ? modelTitle : asked.preview.title }, { actionId: asked.id });
  }

  if (prepared.risk !== "INTERNAL") {
    // Other people will see it, and the person chose not to be asked: on
    // record as an action decided by their rule, run through the same path
    // as an approval. Already reported: the model reads the result now.
    const actionId = await recordRuleAction(a, name, prepared);
    if (!actionId) return refuse(ACTION_ERRORS.personCannot);
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
    const message = await writeEventLine(a.turn.sessionId, { ...line, agentId: a.agent.id }, { whileOpen: { runId: a.turn.runId, personId: a.person.userId } });
    if (message) a.emit?.({ type: "event", message });
  }
  return done("ran", ran.result);
}

/**
 * A browser step's card (Phase 4 step 3, Decisions 12 and 13), made under
 * one transaction-scoped lock on its session (sessions.ts CARD_LOCK_CLASS):
 * no other step of the session waiting, the person's waiting cards under
 * their cap, the turn's run still open, the session swapped to waiting in
 * the same transaction, then the card, IRREVERSIBLE, marked readWeb, and
 * expiring with the session's waiting window. Its step is written waiting.
 * The model reads that it waits, by its kind (browserTitle), never by the
 * element's words.
 */
async function askBrowserCard(
  a: ExecuteArgs,
  person: ActingPerson,
  name: BrowserToolName,
  prepared: Extract<Prepared, { ok: true }>,
  modelTitle: string,
  done: (state: CallState, result: unknown, extra?: DoneExtra) => ExecuteResult,
  refuse: (error: string, detail?: Record<string, unknown>) => ExecuteResult,
): Promise<ExecuteResult> {
  const sessionRow = typeof prepared.input.browserSessionId === "string" && prepared.input.browserSessionId.length <= 64 ? prepared.input.browserSessionId : null;
  if (!sessionRow) return refuse(TEAMMATE_TOOL_ERRORS.notAllowed);
  const site = hostOf(prepared.input.site);
  const s = await browserSessions();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + s.waitingWindowMs());
  const made = await prisma.$transaction(
    async (db): Promise<{ refusal: string } | { view: ActionView }> => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(${s.CARD_LOCK_CLASS}::int, hashtext(${sessionRow}))`;
      if (await s.waitingCardOf(sessionRow, a.turn.sessionId, db)) return { refusal: BROWSER_COPY.oneStepWaits(person.firstName) };
      // One step asked and one take over request an answer (Decision 22).
      const own = BROWSER_TOOL_COUNTS[name];
      if (own && COUNTED_ON_CARD.has(own.key) && (a.counters.browser?.[own.key] ?? 0) >= own.max) return { refusal: own.sentence };
      if (a.counters.proposals >= MAX_PROPOSALS_PER_TURN || (await waitingCount(person.organizationId, person.userId, now, { db })) >= MAX_PENDING_PER_PERSON) {
        return { refusal: tooManyWaiting(person.firstName) };
      }
      if (!(await runStillOpen(db, a.turn.runId, person.userId))) return { refusal: ACTION_ERRORS.personCannot };
      const waiting = await db.teammateBrowserSession.updateMany({
        where: { id: sessionRow, organizationId: person.organizationId, userId: person.userId, agentId: a.agent.id, status: { in: ["live", "waiting"] } },
        data: { status: "waiting", waitingSince: now },
      });
      if (waiting.count !== 1) {
        // Why the swap found nothing to swap, read in the same transaction
        // (review round 4 of Phase 4): the person took the browser in that
        // moment, or an end landed, each its own sentence; "The browser
        // closed. Open a page" only when the row is gone, and only to an
        // answer that may still start a browser (review round 5 of Phase 4:
        // the card's preparation read the page, so this one never may).
        const may = { mayOpen: a.counters.tainted !== true && (a.counters.browser?.starts ?? 0) < BROWSER_TURN_LIMITS.starts };
        const after = await s.sessionNow(sessionRow, db);
        if (after?.status === "handed_over") return { refusal: BROWSER_COPY.personHasIt(person.firstName) };
        if (after && (after.status === "ending" || after.status === "ended")) return { refusal: closedSentence(after.endReason, after.reservedMinutes, may) };
        return { refusal: closedSentence(null, undefined, may) };
      }
      const view = await proposeAction(
        {
          organizationId: person.organizationId,
          agentId: a.agent.id,
          actingForId: person.userId,
          sessionId: a.turn.sessionId,
          runId: a.turn.runId,
          routineId: a.turn.routineId,
          toolName: name,
          risk: "IRREVERSIBLE",
          input: prepared.input,
          preview: prepared.preview,
          targetKey: null,
          groupKey: `${a.turn.runId}:${name}`,
          // Its preparation read the page: marked at once (Decision 15).
          readGoogle: cardMarks(a).readGoogle,
          readWeb: true,
          expiresAt,
          now,
        },
        db,
      );
      return { view };
    },
    { timeout: RUN_LOCK_TX_TIMEOUT_MS, maxWait: RUN_LOCK_TX_MAX_WAIT_MS },
  );
  if ("refusal" in made) return refuse(made.refusal);
  a.counters.proposals += 1;
  const counted = BROWSER_TOOL_COUNTS[name];
  if (counted && COUNTED_ON_CARD.has(counted.key)) (a.counters.browser ??= emptyBrowserCounters())[counted.key] += 1;
  const shotId = typeof prepared.input.shotId === "string" ? prepared.input.shotId : null;
  await s.recordStep(sessionRow, person.userId, { kind: BROWSER_STEP_KIND[name], site, outcome: "waiting", actionId: made.view.id, shotId }, { whileOpen: { runId: a.turn.runId, personId: person.userId } });
  a.emit?.({ type: "approval", action: made.view });
  return done("waiting", { status: "waiting_for_approval", actionId: made.view.id, title: modelTitle }, { actionId: made.view.id, site });
}

/** A practice run's browser step: what it would have asked, on the session's record as practice (Decision 23's outcomes). */
async function practiceStep(a: ExecuteArgs, person: ActingPerson, name: BrowserToolName, input: Record<string, unknown>): Promise<void> {
  const row = typeof input.browserSessionId === "string" && input.browserSessionId.length <= 64 ? input.browserSessionId : null;
  if (!row) return;
  const s = await browserSessions();
  const shotId = typeof input.shotId === "string" ? input.shotId : null;
  await s.recordStep(row, person.userId, { kind: BROWSER_STEP_KIND[name], site: hostOf(input.site), outcome: "practice", shotId }, { whileOpen: { runId: a.turn.runId, personId: person.userId } });
}

/** What a Talk turn's model hears of a write: how it went, never what it names (see executeToolCall). */
function toldInTalk(state: CallState, result: unknown): Record<string, unknown> {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  if (state === "waiting") return { status: "waiting_for_approval", actionId: r.actionId ?? null, note: TALK_TEAMMATE_COPY.toldWaiting };
  if (state === "failed") return { error: TALK_TEAMMATE_COPY.toldFailed };
  return { ok: true, note: TALK_TEAMMATE_COPY.toldDone };
}

/**
 * A call the person's own "Don't ask" lets run: on record as decided by their
 * rule, RUNNING, and already reported. Null, recording nothing, once the
 * turn's run closed or its person's account is gone (review round 4 of Phase
 * 3), checked under the run's lock in the same transaction.
 */
async function recordRuleAction(a: ExecuteArgs, tool: ToolName, prepared: Extract<Prepared, { ok: true }>): Promise<string | null> {
  const now = new Date();
  return prisma.$transaction(
    async (tx) => {
      if (!(await runStillOpen(tx, a.turn.runId, a.person.userId))) return null;
      const row = await tx.agentAction.create({
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
    },
    { timeout: RUN_LOCK_TX_TIMEOUT_MS, maxWait: RUN_LOCK_TX_MAX_WAIT_MS },
  );
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
    // A Google or browser card stopped before anything was sent waits again (Phase 4: the browser's too).
    if (a.holdNotSent && (isConnectorToolName(name) || isBrowserToolName(name)) && isHeldCode(held)) {
      const said = record(data).error;
      // A browser card held in the person's own words (last polish of Phase
      // 4, browser-tools.ts `forPerson`): only the approval's answer reads a
      // held error, and the person reads it, so never "Max has the browser
      // now" to Max. Nothing of it reaches the teammate.
      const forPerson = isBrowserToolName(name) ? record(data).forPerson : null;
      const personError = typeof forPerson === "string" && forPerson.trim() ? clampText(forPerson.trim(), 240) : null;
      return { status: "HELD", code: held, error: personError ?? (typeof said === "string" && said ? said : (outcome.message ?? TEAMMATE_TOOL_ERRORS.notAllowed)), data };
    }
    const error = outcome.message ?? TEAMMATE_TOOL_ERRORS.notAllowed;
    // A write Google may have carried out (connector-tools.ts failed) says so
    // on the card, as a flag, never by its sentence: for ten minutes the same
    // email or invitation is not asked for again (findTwin, review round 2 of
    // Phase 3). updatedAt is when it failed, which that window counts from.
    const unknown = record(data).unknownOutcome === true;
    // A browser act is audited whatever its outcome (review of Phase 4 step
    // 3, Decision 24): one that did nothing, and one that may have gone
    // through (a refused hop after its input included), each its own row.
    if (BROWSER_ACTS.has(name)) {
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
    }
    // A browser card's failure in the person's own words (polish after review
    // round 6 of Phase 4, browser-tools.ts `forPerson`): the row's error is
    // what its card, its chat line and the Inbox show, so it takes those; the
    // teammate's own sentence, which can speak of "the person" and of what
    // its answer may open, is kept as result.modelError for its outcome note
    // (engine.ts outcomeNote).
    const forPerson = isBrowserToolName(name) ? record(data).forPerson : null;
    const personError = typeof forPerson === "string" && forPerson.trim() ? clampText(forPerson.trim(), 240) : null;
    const shown = personError ?? error;
    const kept = { ...(unknown ? { unknownOutcome: true } : {}), ...(personError && personError !== error ? { modelError: error } : {}) };
    await prisma.agentAction.updateMany({
      where: { id: a.action.id, status: "RUNNING" },
      data: { status: "FAILED", error: shown, ...(Object.keys(kept).length > 0 ? { result: json(kept) } : {}), ...(unknown ? { updatedAt: new Date() } : {}) },
    });
    return { status: "FAILED", error: shown, data };
  }
  const href = outcome.href ?? a.action.preview?.target?.href ?? null;
  // A browser step's sentence names its site only, never the element's words (Phase 4).
  const said = isBrowserToolName(name) ? browserSiteInput(a.input) : a.input;
  const result: ActionResult = { text: toolOutcomeSentence(name, said, outcome).text, href, data };
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

/** The browser steps that act on a page, each audited whatever its outcome (review of Phase 4 step 3). */
const BROWSER_ACTS: ReadonlySet<string> = new Set<BrowserToolName>(["click", "type_text", "select_option"]);

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
 * A browser step's audit sentence, by its outcome (review of Phase 4 step 3):
 * what it did on its site; that it did nothing there; or that it may have
 * gone through. Its site only, never an element's words.
 */
function browserAuditSentence(tool: BrowserToolName, input: Record<string, unknown> | null, result: unknown): string {
  const site = browserSiteInput(input);
  const outcome = browserActOutcome(result);
  if (outcome === "unknown") return BROWSER_AUDIT_COPY.actUnconfirmed(toolSentence(tool, site).text);
  if (outcome === "failed") return BROWSER_AUDIT_COPY.actNothingDone(toolSentence(tool, site, true).text, typeof site.site === "string" ? site.site : null);
  return toolSentence(tool, site).text;
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
  // audit log, and the subject and the addresses are the person's mail. A
  // browser step's names its site, and its facts are the site, the kind and
  // the element's role (Phase 4 Decision 24): never typed text, an element's
  // words or a page's path. Both rows are the person's own (review round 1
  // of Phase 4, src/lib/access/personal-activity.ts): only the person (its
  // actingForId) and Owners and Admins read them in Activity, and the home
  // feed shows them to no one.
  const connector = isConnectorToolName(a.toolName) ? a.toolName : null;
  const browser = isBrowserToolName(a.toolName) ? a.toolName : null;
  const what = connector
    ? toolSentence(connector, null).text
    : browser
      ? browserAuditSentence(browser, a.input, a.result)
      : toolOutcomeSentence(a.toolName, a.input, toolOutcome(a.toolName, a.result)).text;
  const target = connector || browser ? null : auditTarget(a.result);
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
      ...(browser ? { browser: browserAuditFacts(browser, a.input, a.result) } : {}),
    },
    severity: a.risk === "IRREVERSIBLE" ? "warning" : "info",
  });
}
