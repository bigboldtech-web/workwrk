// The approval queue (docs/plans/ai-teammates.md 3.7): what an AI teammate
// asked to do, and what the person it works for decided.
//
// ONE ROW PER ACTION (AgentAction), and every change of its status is ONE
// compare-and-swap: an updateMany that names the status it expects and must
// change exactly one row. A double click, two tabs, a retried request, or the
// Inbox and the chat at once can move an action PENDING to RUNNING once, so
// its tool runs once. A request that lost the swap answers already_decided
// with the status the winner left.
//
// ONLY THE PERSON IT ACTS FOR DECIDES. Every read names actingForId = the
// viewer, so another person's action id answers not_found exactly like a
// missing one: an Admin can neither decide a Member's request nor learn that
// it exists.
//
// AN APPROVAL RUNS AS THE PERSON IS NOW, not as they were when the teammate
// asked: resolveActingPerson again, and prepareCall again (the gate, the
// class and the card, with the person's rights at this moment) on the stored
// input or on the person's edit of its one editable field. The fresh card is
// what the row keeps, and prepareCall's input is what runs.
//
// WHAT AN APPROVAL MEETS, in order, by what is true now:
//   the request is past its time    EXPIRED
//   the teammate was removed, or    CANCELLED
//   the person can no longer use it
//   the teammate is paused          stays PENDING: approve it once it is on
//   the tool is no longer its own   CANCELLED
//   the person may not be acted for stays PENDING (resolveActingPerson)
//   the card is refused now         FAILED, with prepareCall's reason
// Saying no needs none of that: a deny runs nothing, so it works on any
// request still waiting, a paused or removed teammate's included.
//
// Each decision and each expiry writes its line into the chat (an EVENT row,
// teammate-copy.ts) and marks read the Inbox notification that pointed at
// the action. The teammate learns the outcome at its next turn
// (claimUnreportedOutcomes: one statement, so one turn reports it). The
// person's open tabs learn it at once: once the decisions settle, and after
// a sweep, each teammate whose cards moved is published to its person
// (the realtime event agent.changed), once per person and teammate.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import type { Viewer } from "@/lib/access/types";
import { isModuleActive } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { resolveActingPerson, type ActingResult } from "./acting";
import { prepareCall, type Prepared } from "./previews";
import { canUseAgent } from "./teammate-access";
import {
  ACTION_ERRORS,
  cancelledRemovedLine,
  cancelledToolOffLine,
  didntWorkLine,
  expiredWithoutAnswerLine,
  pausedComposer,
  titleList,
  youApprovedLine,
  youSaidNoLine,
} from "./teammate-copy";
import {
  actionViewFromRow,
  isAgentActionStatus,
  messageViewFromRow,
  type ActionPreview,
  type ActionRisk,
  type ActionView,
  type AgentActionRow,
  type AgentActionStatus,
  type TeammateEventKind,
  type TeammateMessageView,
} from "./teammate-thread";
import { teammateToolNames } from "./teammate-tools";
import { ACTION_TTL_MS, EDITABLE_FIELD, alwaysKeyFor, sanitizeRules, type ApprovalRules } from "./tool-policy";
import { PPMS_TOOL_NAMES, TEAMMATE_TOOL_NAMES, isToolName, type ToolName } from "./tool-names";
import { clampText } from "./clamp";

// executor.ts imports this file (proposeAction, waitingCount, the chat
// lines), so an approval loads the executor on first use.
const executor = () => import("./executor");

/** The most decisions one request may carry ("Approve 50"). */
export const MAX_DECISIONS = 50;

/** A request RUNNING longer than this is stuck: the sweep fails it, and it never runs again. */
export const RUNNING_STUCK_MS = 10 * 60 * 1000;

/** The most expired requests one sweep settles; the rest wait for the next tick. */
const SWEEP_BATCH = 500;

/** The most cards one read returns. */
const MAX_VIEWS = 1000;

const ALL_TOOLS: readonly ToolName[] = [...PPMS_TOOL_NAMES, ...TEAMMATE_TOOL_NAMES];

/**
 * Where an action's card opens: the teammate's chat, at the card. The Inbox
 * notification for a request links here, so a decision can find it and mark
 * it read.
 */
export function actionHref(agentSlug: string, actionId: string): string {
  return `/agents?chat=${encodeURIComponent(agentSlug)}&action=${encodeURIComponent(actionId)}`;
}

/**
 * The columns a card reads (teammate-thread.ts AgentActionRow). `input` only
 * for its editable field's own text (ActionView.editableValue, what Edit
 * starts from); the rest of the input never reaches the card.
 */
const VIEW_SELECT = {
  id: true,
  toolName: true,
  risk: true,
  status: true,
  preview: true,
  result: true,
  error: true,
  input: true,
  editedInput: true,
  groupKey: true,
  sessionId: true,
  decidedVia: true,
  createdAt: true,
  expiresAt: true,
  decidedAt: true,
  executedAt: true,
} as const;

/** A row as a decision reads it: the card's columns, what runs, and the teammate as it is now. */
const DECIDE_SELECT = {
  ...VIEW_SELECT,
  agentId: true,
  runId: true,
  routineId: true,
  input: true,
  agent: {
    select: { id: true, slug: true, name: true, status: true, organizationId: true, visibility: true, ownerId: true, toolNames: true, productSlug: true, approvalRules: true },
  },
} as const;

type DecideRow = Prisma.AgentActionGetPayload<{ select: typeof DECIDE_SELECT }>;

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** One status change, as a compare-and-swap: true only when this call made it. */
async function swap(id: string, from: AgentActionStatus, data: Prisma.AgentActionUpdateManyMutationInput): Promise<boolean> {
  const changed = await prisma.agentAction.updateMany({ where: { id, status: from }, data });
  return changed.count === 1;
}

/** The answer of a decision that lost its swap: the status the winner left. */
async function lost(id: string): Promise<DecisionResult> {
  const now = await prisma.agentAction.findFirst({ where: { id }, select: { status: true } });
  if (!now) return { id, status: "not_found" };
  return { id, status: isAgentActionStatus(now.status) ? now.status : "CANCELLED", code: "already_decided" };
}

// ── The chat's lines and the Inbox ──────────────────────────────────

export interface EventLine {
  /** The sentence (teammate-copy.ts): the row's content IS the line. */
  text: string;
  event: TeammateEventKind;
  actionId?: string | null;
  routineId?: string | null;
}

/**
 * One centred line in a teammate chat: an EVENT ChatMessage whose content is
 * the sentence. Null when there is no chat to write it in, or the write
 * failed: a line is a notice, and nothing it reports is undone for want of it.
 */
export async function writeEventLine(sessionId: string | null, line: EventLine): Promise<TeammateMessageView | null> {
  if (!sessionId) return null;
  const meta: Record<string, string> = { event: line.event };
  if (line.actionId) meta.actionId = line.actionId;
  if (line.routineId) meta.routineId = line.routineId;
  try {
    const row = await prisma.chatMessage.create({
      data: { sessionId, role: "SYSTEM", kind: "EVENT", content: line.text, meta },
      select: { id: true, role: true, content: true, kind: true, meta: true, createdAt: true },
    });
    return messageViewFromRow(row);
  } catch (err) {
    console.error(`[agents] chat line not written: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    return null;
  }
}

/** The person's Inbox notifications that point at these cards, marked read: there is nothing left to decide there. */
async function markLinksRead(userId: string, links: readonly string[]): Promise<void> {
  if (links.length === 0) return;
  await prisma.notification.updateMany({ where: { userId, link: { in: [...links] }, read: false }, data: { read: true } }).catch(() => {});
}

/**
 * Tell each person's open tabs that their chat with these teammates changed
 * (realtime-events.ts agent.changed): one event per person and teammate,
 * however many of its cards moved.
 */
function publishChanged(pairs: Iterable<readonly [userId: string, agentId: string]>): void {
  const seen = new Set<string>();
  for (const [userId, agentId] of pairs) {
    const key = `${userId}:${agentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    publishToUser(userId, { type: "agent.changed", agentId });
  }
}

// ── Asking ──────────────────────────────────────────────────────────

export interface ProposeInput {
  organizationId: string;
  agentId: string;
  actingForId: string;
  sessionId: string | null;
  runId: string | null;
  routineId: string | null;
  toolName: ToolName;
  risk: ActionRisk;
  /** The exact input that runs on approval: prepareCall's, never the model's own words. */
  input: Record<string, unknown>;
  preview: ActionPreview;
  targetKey: string | null;
  /** One card groups the actions of one run and one tool: "<runId>:<tool>". */
  groupKey: string | null;
  now?: Date;
}

/** Ask the person: one PENDING action, waiting ACTION_TTL_MS for their decision. */
export async function proposeAction(a: ProposeInput): Promise<ActionView> {
  const now = a.now ?? new Date();
  const row = await prisma.agentAction.create({
    data: {
      organizationId: a.organizationId,
      agentId: a.agentId,
      actingForId: a.actingForId,
      sessionId: a.sessionId,
      runId: a.runId,
      routineId: a.routineId,
      toolName: a.toolName,
      risk: a.risk,
      input: json(a.input),
      preview: json(a.preview),
      targetKey: a.targetKey,
      groupKey: a.groupKey,
      status: "PENDING",
      expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
    },
    select: VIEW_SELECT,
  });
  return actionViewFromRow(row);
}

/** What waits for this person's decision now, across their teammates (the sidebar's count, MAX_PENDING_PER_PERSON). */
export async function waitingCount(organizationId: string, userId: string, now: Date = new Date()): Promise<number> {
  return prisma.agentAction.count({ where: { organizationId, actingForId: userId, status: "PENDING", expiresAt: { gt: now } } });
}

/**
 * The cards for these ids, of this person's own actions only: an id of
 * anyone else's is left out, as a missing one is. A request past its time
 * that the sweep has not reached yet shows as expired, since its buttons
 * could only answer that.
 */
export async function actionViews(ids: readonly string[], viewerId: string, now: Date = new Date()): Promise<Record<string, ActionView>> {
  const wanted = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))].slice(0, MAX_VIEWS);
  const out: Record<string, ActionView> = {};
  if (wanted.length === 0) return out;
  const rows = await prisma.agentAction.findMany({ where: { id: { in: wanted }, actingForId: viewerId }, select: VIEW_SELECT });
  for (const row of rows) {
    const view = actionViewFromRow(row);
    const overdue = view.status === "PENDING" && Date.parse(view.expiresAt) <= now.getTime();
    out[row.id] = overdue ? { ...view, status: "EXPIRED", always: { allowed: false, label: null } } : view;
  }
  return out;
}

// ── Deciding ────────────────────────────────────────────────────────

export interface DecisionInput {
  id: string;
  decision: "approve" | "deny";
  /** The person's change to the action's one editable field (tool-policy.ts EDITABLE_FIELD). */
  edit?: { text: string };
}

export type DecisionCode = "already_decided" | "expired" | "agent_paused" | "agent_removed" | "tool_off" | "person_cannot" | "failed";

export interface DecisionResult {
  id: string;
  status: AgentActionStatus | "not_found";
  code?: DecisionCode;
  result?: { text: string; href: string | null };
  error?: string;
}

/** What one request's decisions share: the person, the modules and each teammate's tool set, read once. */
interface DecideCache {
  person: ActingResult | null;
  modules: { tablesOn: boolean; talkOn: boolean } | null;
  tools: Map<string, ReadonlySet<ToolName>>;
}

/**
 * Decide the viewer's own actions, one after another (at most MAX_DECISIONS).
 * `always`: "Approve and don't ask again", stored as the person's own rule
 * only where the policy allows it. `resume` is true when anything ran (or
 * failed trying), so the chat continues once; `agentSlug` names that chat.
 */
export async function decideActions(
  viewer: Viewer,
  decisions: readonly DecisionInput[],
  opts: { always?: boolean } = {},
): Promise<{ results: DecisionResult[]; resume: boolean; agentSlug: string | null }> {
  const cache: DecideCache = { person: null, modules: null, tools: new Map() };
  const results: DecisionResult[] = [];
  const touched: Array<[string, string]> = [];
  let firstSlug: string | null = null;
  let resumeSlug: string | null = null;
  try {
    for (const d of decisions.slice(0, MAX_DECISIONS)) {
      const id = typeof d.id === "string" ? d.id : "";
      const row = id
        ? await prisma.agentAction.findFirst({ where: { id, organizationId: viewer.organizationId, actingForId: viewer.userId }, select: DECIDE_SELECT })
        : null;
      if (!row) {
        results.push({ id, status: "not_found" });
        continue;
      }
      firstSlug ??= row.agent.slug;
      touched.push([viewer.userId, row.agentId]);
      const r = await decideOne(viewer, row, d, opts, cache);
      // Only what ran (or failed) in this call continues the chat: approving
      // a request decided before (two tabs, a double click) changes nothing,
      // so the turn after it would have nothing to tell.
      if ((r.status === "EXECUTED" || r.status === "FAILED") && r.code !== "already_decided") resumeSlug ??= row.agent.slug;
      results.push(r);
    }
  } finally {
    // Settled (or stopped by a throw after some ran): the person's other
    // tabs re-read the cards, the chat's lines and the sidebar's count.
    publishChanged(touched);
  }
  return { results, resume: resumeSlug !== null, agentSlug: resumeSlug ?? firstSlug };
}

/** The line and the Inbox for a decided row. */
async function settle(row: DecideRow, userId: string, line: EventLine): Promise<void> {
  await writeEventLine(row.sessionId, { ...line, actionId: row.id });
  await markLinksRead(userId, [actionHref(row.agent.slug, row.id)]);
}

async function decideOne(viewer: Viewer, row: DecideRow, d: DecisionInput, opts: { always?: boolean }, cache: DecideCache): Promise<DecisionResult> {
  const now = new Date();
  const view = actionViewFromRow(row);
  const title = view.preview.title;
  if (row.status !== "PENDING") return { id: row.id, status: view.status, code: "already_decided" };

  if (row.expiresAt.getTime() <= now.getTime()) {
    if (!(await swap(row.id, "PENDING", { status: "EXPIRED", decidedVia: "expiry", decidedAt: now }))) return lost(row.id);
    await settle(row, viewer.userId, { text: expiredWithoutAnswerLine(title), event: "action_expired" });
    return { id: row.id, status: "EXPIRED", code: "expired" };
  }

  if (d.decision === "deny") {
    if (!(await swap(row.id, "PENDING", { status: "DENIED", decidedVia: "person", decidedById: viewer.userId, decidedAt: now }))) return lost(row.id);
    await settle(row, viewer.userId, { text: youSaidNoLine(title), event: "action_denied" });
    return { id: row.id, status: "DENIED" };
  }
  if (d.decision !== "approve") return { id: row.id, status: "PENDING" };
  return approve(viewer, row, title, d, opts, cache, now);
}

/**
 * Close every request a removed teammate left waiting (DELETE
 * /api/agents/teammates/[slug]): CANCELLED with the reason its card shows,
 * by one swap from PENDING, so a request decided a moment ago keeps its
 * outcome, and the Inbox notifications that pointed at them marked read. No
 * line: nobody decided them. Returns how many it closed.
 */
export async function cancelPendingActionsOf(agent: { id: string; slug: string; name: string }, now: Date = new Date()): Promise<number> {
  const rows = await prisma.agentAction.findMany({ where: { agentId: agent.id, status: "PENDING" }, select: { id: true, actingForId: true } });
  if (rows.length === 0) return 0;
  const closed = await prisma.agentAction.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: "PENDING" },
    data: { status: "CANCELLED", decidedVia: "system", decidedAt: now, error: cancelledRemovedLine(agent.name) },
  });
  const linksByPerson = new Map<string, string[]>();
  for (const r of rows) linksByPerson.set(r.actingForId, [...(linksByPerson.get(r.actingForId) ?? []), actionHref(agent.slug, r.id)]);
  for (const [userId, links] of linksByPerson) await markLinksRead(userId, links);
  return closed.count;
}

/** Close a request that can never run now, with the reason on its card. No line: nobody decided it. */
async function cancel(row: DecideRow, userId: string, code: "agent_removed" | "tool_off", error: string, now: Date): Promise<DecisionResult> {
  if (!(await swap(row.id, "PENDING", { status: "CANCELLED", decidedVia: "system", decidedAt: now, error }))) return lost(row.id);
  await markLinksRead(userId, [actionHref(row.agent.slug, row.id)]);
  return { id: row.id, status: "CANCELLED", code, error };
}

/** The tools this teammate may use now (teammateToolNames, with this workspace's modules). */
async function toolsOf(agent: DecideRow["agent"], cache: DecideCache): Promise<ReadonlySet<ToolName>> {
  const known = cache.tools.get(agent.id);
  if (known) return known;
  if (!cache.modules) {
    const [tablesOn, talkOn] = await Promise.all([isModuleActive(agent.organizationId, "workwrk-tables"), isModuleActive(agent.organizationId, "workwrk-talk")]);
    cache.modules = { tablesOn, talkOn };
  }
  const tools: ReadonlySet<ToolName> = new Set(teammateToolNames(agent, cache.modules));
  cache.tools.set(agent.id, tools);
  return tools;
}

async function approve(
  viewer: Viewer,
  row: DecideRow,
  title: string,
  d: DecisionInput,
  opts: { always?: boolean },
  cache: DecideCache,
  now: Date,
): Promise<DecisionResult> {
  const agent = row.agent;
  if (agent.status === "ARCHIVED" || !canUseAgent(agent, viewer)) return cancel(row, viewer.userId, "agent_removed", cancelledRemovedLine(agent.name), now);
  if (agent.status === "DISABLED") return { id: row.id, status: "PENDING", code: "agent_paused", error: pausedComposer(agent.name) };
  const tools = await toolsOf(agent, cache);
  const tool = row.toolName;
  if (!isToolName(tool) || !tools.has(tool)) return cancel(row, viewer.userId, "tool_off", cancelledToolOffLine(agent.name), now);

  const acting = (cache.person ??= await resolveActingPerson(viewer.organizationId, viewer.userId));
  if (!acting.ok) return { id: row.id, status: "PENDING", code: "person_cannot", error: ACTION_ERRORS.personCannot };
  const person = acting.person;

  // Only the tool's one editable field changes, clamped to its length.
  const stored = record(row.input);
  const field = EDITABLE_FIELD[tool];
  const edited = d.edit && field && typeof d.edit.text === "string" ? { ...stored, [field.field]: clampText(d.edit.text, field.maxLength) } : null;
  const agentRules = sanitizeRules(agent.approvalRules, { level: "agent", allowedTools: [...tools] });
  const prepared = await prepareCall(tool, edited ?? stored, { person, teammate: { agentId: agent.id, agentName: agent.name, trigger: "APPROVAL" }, agentRules });
  if (!prepared.ok) {
    // The person can no longer do it (or the edit left nothing to run): it
    // fails with the reason, and the teammate is told at its next turn.
    const failed = { status: "FAILED", decidedVia: "person", decidedById: viewer.userId, decidedAt: now, error: prepared.error, ...(edited ? { editedInput: json(edited) } : {}) };
    if (!(await swap(row.id, "PENDING", failed))) return lost(row.id);
    await settle(row, viewer.userId, { text: didntWorkLine(title, prepared.error), event: "action_failed" });
    return { id: row.id, status: "FAILED", code: "failed", error: prepared.error };
  }

  const risk = prepared.risk === "READ" ? row.risk : prepared.risk;
  const claimed = await swap(row.id, "PENDING", {
    status: "RUNNING",
    decidedVia: "person",
    decidedById: viewer.userId,
    decidedAt: now,
    risk,
    preview: json(prepared.preview),
    targetKey: prepared.targetKey,
    ...(edited ? { editedInput: json(prepared.input) } : {}),
  });
  if (!claimed) return lost(row.id);

  const { runApprovedAction } = await executor();
  const out = await runApprovedAction({
    action: { id: row.id, toolName: tool, risk, sessionId: row.sessionId, runId: row.runId, routineId: row.routineId, preview: prepared.preview },
    input: prepared.input,
    person,
    agent: { id: agent.id, slug: agent.slug, name: agent.name },
    trigger: "APPROVAL",
    decidedVia: "person",
  });
  const always = opts.always === true && (await storeAlways(agent.id, viewer.userId, tool, prepared));
  if (out.status === "EXECUTED") {
    await settle(row, viewer.userId, { text: youApprovedLine(prepared.preview.title, { always }), event: "action_approved" });
    return { id: row.id, status: "EXECUTED", result: { text: out.result.text, href: out.result.href } };
  }
  await settle(row, viewer.userId, { text: didntWorkLine(prepared.preview.title, out.error), event: "action_failed" });
  return { id: row.id, status: "FAILED", code: "failed", error: out.error };
}

/**
 * "Approve and don't ask again": the person's own rule for calls like this
 * one, stored only when the policy offers it for exactly this call (the
 * fresh card names the rule: the tool, the tool in one Talk conversation, or
 * the tool's calls above its own class) and never for what cannot be taken
 * back. False when nothing was stored; the person is simply asked next time.
 */
async function storeAlways(agentId: string, userId: string, tool: ToolName, prepared: Extract<Prepared, { ok: true }>): Promise<boolean> {
  const key = alwaysKeyFor(tool, prepared.risk, prepared.targetKey);
  if (!key || prepared.preview.alwaysKey !== key) return false;
  const where = { agentId_userId: { agentId, userId } };
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const setting = await prisma.agentPersonSetting.findUnique({ where, select: { approvalRules: true } });
      // The new rule first, so the 200-key cap never drops it. Rules for a
      // tool switched off for now are kept: they are the person's choices.
      const rules: ApprovalRules = { [key]: "always" };
      for (const [k, v] of Object.entries(sanitizeRules(setting?.approvalRules, { level: "person", allowedTools: ALL_TOOLS }))) if (k !== key) rules[k] = v;
      try {
        await prisma.agentPersonSetting.upsert({ where, create: { agentId, userId, approvalRules: rules }, update: { approvalRules: rules } });
        return true;
      } catch (err) {
        // Two first rules at once: the other made the row, so read it again.
        if ((err as { code?: string } | null)?.code !== "P2002" || attempt > 0) throw err;
      }
    }
  } catch (err) {
    console.error(`[agents] approval rule not saved: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
  }
  return false;
}

// ── The sweep and the teammate's next turn ──────────────────────────

/**
 * Each cron tick: requests past their time become EXPIRED (one line per chat
 * naming them, their notifications marked read, and one agent.changed per
 * person and teammate), and a request RUNNING for over RUNNING_STUCK_MS
 * becomes FAILED with "Couldn't confirm it finished." and is never run
 * again: it may have happened, so the card tells the person to check before
 * asking again.
 */
export async function sweepActions(now: Date = new Date()): Promise<{ expired: number; stuck: number }> {
  const due = await prisma.agentAction.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { ...VIEW_SELECT, actingForId: true, agentId: true, agent: { select: { slug: true } } },
    orderBy: { expiresAt: "asc" },
    take: SWEEP_BATCH,
  });
  const expired: typeof due = [];
  for (const row of due) {
    // One swap each: a request decided a moment ago keeps its decision.
    if (await swap(row.id, "PENDING", { status: "EXPIRED", decidedVia: "expiry", decidedAt: now })) expired.push(row);
  }

  const bySession = new Map<string, typeof due>();
  const linksByPerson = new Map<string, string[]>();
  for (const row of expired) {
    if (row.sessionId) bySession.set(row.sessionId, [...(bySession.get(row.sessionId) ?? []), row]);
    linksByPerson.set(row.actingForId, [...(linksByPerson.get(row.actingForId) ?? []), actionHref(row.agent.slug, row.id)]);
  }
  for (const [sessionId, rows] of bySession) {
    const titles = rows.map((r) => actionViewFromRow(r).preview.title);
    await writeEventLine(sessionId, { text: expiredWithoutAnswerLine(titleList(titles)), event: "action_expired", actionId: rows[0].id });
  }
  for (const [userId, links] of linksByPerson) await markLinksRead(userId, links);
  publishChanged(expired.map((row) => [row.actingForId, row.agentId] as const));

  const cutoff = new Date(now.getTime() - RUNNING_STUCK_MS);
  const stuck = await prisma.agentAction.updateMany({
    where: { status: "RUNNING", OR: [{ decidedAt: { lt: cutoff } }, { decidedAt: null, createdAt: { lt: cutoff } }] },
    data: { status: "FAILED", error: ACTION_ERRORS.unconfirmed },
  });
  return { expired: expired.length, stuck: stuck.count };
}

/**
 * The outcomes of this chat's requests the teammate has not been told yet,
 * claimed in ONE statement (UPDATE ... RETURNING), so two turns at once never
 * both report one: the turn that stamped reportedAt has it. Oldest first. A
 * call the person's own rule ran was reported in its own turn (reportedAt is
 * set when it is recorded), so only decisions and expiries come back here.
 */
export async function claimUnreportedOutcomes(sessionId: string): Promise<AgentActionRow[]> {
  const rows = await prisma.$queryRaw<AgentActionRow[]>`
    UPDATE "AgentAction"
    SET "reportedAt" = now() AT TIME ZONE 'UTC', "updatedAt" = now() AT TIME ZONE 'UTC'
    WHERE "sessionId" = ${sessionId} AND "reportedAt" IS NULL
      AND "status" IN ('EXECUTED', 'FAILED', 'DENIED', 'EXPIRED', 'CANCELLED')
    RETURNING "id", "toolName", "risk", "status", "preview", "result", "error", "editedInput", "groupKey",
      "sessionId", "decidedVia", "createdAt", "expiresAt", "decidedAt", "executedAt"`;
  const at = (v: Date | string) => new Date(v).getTime();
  return [...rows].sort((x, y) => at(x.createdAt) - at(y.createdAt));
}

/**
 * Hand claimed outcomes back, unreported: the turn that claimed them never
 * got an answer from the model (engine.ts, a call that failed before anything
 * came back), so the teammate never heard them, and the next turn of this
 * chat tells it instead. Only this chat's rows. Never throws: it runs on a
 * path that is already failing.
 */
export async function releaseOutcomes(sessionId: string, ids: readonly string[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (wanted.length === 0) return;
  await prisma.agentAction.updateMany({ where: { id: { in: wanted }, sessionId }, data: { reportedAt: null } }).catch(() => {});
}
