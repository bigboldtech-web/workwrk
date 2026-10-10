// The pure half of a chat with an AI teammate (docs/plans/ai-teammates.md 4
// and 5.3): what a saved ChatMessage reads as in the thread, what an
// AgentAction reads as on its approval card, the events of the teammate
// stream, and the small rules the list and the thread share (a row's last
// line, the order of the list). No React, no fetch, no prisma, so the routes,
// the store (teammate-store.ts) and the tests read one shape.
//
// A teammate chat holds four kinds of ChatMessage (ChatMessage.kind):
//   null      an ordinary turn: the person's message (USER), or the
//             teammate's answer (ASSISTANT) with its call log in toolCalls
//   REPORT    a routine's report (ASSISTANT; meta { routineId, routineName,
//             runId, dueAt })
//   EVENT     a centred line the server writes. Its content IS the sentence
//             (teammate-copy.ts); meta { event, routineId?, actionId? } picks
//             the icon and the links, so a reader that does not know the
//             event still shows the words
//   APPROVAL  a turn's approval card (SYSTEM; meta { actionIds }). The card
//             reads the AgentAction rows live; the content is the first
//             title, for any reader that cannot
// A practice turn carries meta.practice. A TOOL row, a SYSTEM row with no
// kind and a kind this code does not know do not render.
//
// The client's rules live here too, so they are tested without a browser:
// how a stream event changes the chat (applyTeammateEvent), what a turn that
// failed leaves behind (in the thread and in the composer) and what the error
// row says, a decision's answer on the cards, the page's address
// (hubViewFor), the list's search, and a request's row on the Activity tab.

import { callFromLog, withToolUse, type AiToolCall } from "@/lib/ai/thread";
import type { RunTone } from "@/lib/automation/run-status";
import { clampText } from "./clamp";
import type { TeammateHue } from "./hues";
import { plainLine } from "./run-view";
import { ALWAYS_ASK, EDITABLE_FIELD } from "./tool-policy";
import { isToolName } from "./tool-names";
import { toolOutcomeSentence, toolSentence } from "./tool-verbs";
import {
  ACTION_ERRORS,
  ACTIVITY_COPY,
  APPROVAL_CARD,
  GROUP_COPY,
  ROUTINE_FALLBACK_NAME,
  TEAMMATE_CHAT,
  TEAMMATE_ROUTE_ERRORS,
  approvedAt,
  cancelledRemovedLine,
  cardFailedLine,
  deniedAt,
  didntWorkLine,
  expiredAt,
  lastLineReport,
  lastLineRunNow,
  lastLineYou,
  pausedNotSent,
  removedComposer,
  unconfirmedLine,
} from "./teammate-copy";

/** At most this many calls render from one turn's log (MAX_TOOL_CALLS_PER_TURN). */
const MAX_CALLS = 30;
/** At most this many actions on one card (MAX_PROPOSALS_PER_TURN). */
const MAX_ACTIONS = 50;

/** How a call ended, as the stream reports it. */
export type CallState = "ran" | "failed" | "waiting" | "practice";

export const TEAMMATE_EVENT_KINDS = [
  "memory_updated",
  "memory_forgotten",
  "routine_created",
  "routine_paused",
  "routine_skipped",
  "action_approved",
  "action_denied",
  "action_expired",
  "action_failed",
  // Phase 2 (docs/plans/ai-teammates-phase2.md).
  "schedule_moved",
  "group_skipped",
  "group_member_added",
  "group_member_removed",
  "group_renamed",
  "delegated_asked",
  "delegate_waiting",
  "talk_asked",
  "automation_asked",
] as const;

/** What an EVENT line is about (meta.event). */
export type TeammateEventKind = (typeof TEAMMATE_EVENT_KINDS)[number];

const EVENT_SET: ReadonlySet<string> = new Set(TEAMMATE_EVENT_KINDS);

export function isTeammateEventKind(v: unknown): v is TeammateEventKind {
  return typeof v === "string" && EVENT_SET.has(v);
}

interface MessageBase {
  id: string;
  /** ISO time. */
  createdAt: string;
  /** The person's words, the answer, the report, the line's sentence or the card's first title. */
  text: string;
}

export interface TeammateRoutineRef {
  id: string | null;
  name: string;
  runId: string | null;
  /** The slot it ran for (ISO), which can be earlier than the report. */
  dueAt: string | null;
}

/**
 * Where an answer was asked from when it was not the person in this chat
 * (meta.origin, Phase 2): another teammate (ask_teammate), a Talk message,
 * or an automation's step.
 */
export type MessageOrigin =
  | { kind: "delegated"; byName: string }
  | { kind: "talk"; place: string; conversationId: string; messageId: string; postedMessageId: string | null }
  | { kind: "automation"; workflowName: string; workflowId: string; runId: string };

/** What an EVENT line's Open goes to (meta.link). The address is built here, never read from the row. */
export type EventLink =
  | { kind: "chat"; slug: string; actionId?: string }
  | { kind: "talk"; conversationId: string; messageId: string }
  | { kind: "automation"; workflowId: string; runId: string };

/** The page an EVENT line's link opens: always a path in this app. */
export function eventLinkHref(l: EventLink): string {
  const e = encodeURIComponent;
  if (l.kind === "chat") return `/agents?chat=${e(l.slug)}${l.actionId ? `&action=${e(l.actionId)}` : ""}`;
  if (l.kind === "talk") return `/tlk/${e(l.conversationId)}?m=${e(l.messageId)}`;
  return `/automation/logs?workflowId=${e(l.workflowId)}&runId=${e(l.runId)}`;
}

/** Where a card in a group chat opens: the group, at the card. */
export function groupActionHref(sessionId: string, actionId: string): string {
  return `/agents?group=${encodeURIComponent(sessionId)}&action=${encodeURIComponent(actionId)}`;
}

/** One row of the thread. */
export type TeammateMessageView =
  | (MessageBase & {
      kind: "user";
      practice: boolean;
      /** A group chat: the teammates asked to answer it, in order (agent ids). */
      answerers?: string[];
      /** Sent by Run now in Workspace agents. */
      runNow?: boolean;
    })
  | (MessageBase & {
      kind: "agent";
      practice: boolean;
      toolCalls: AiToolCall[];
      streaming?: boolean;
      replyTo?: string;
      /** A group chat: the teammate that answered. */
      agentId?: string;
      agentName?: string;
      origin?: MessageOrigin;
      /** A continue after the person decided a card. */
      resume?: boolean;
      /** The turn read the person's Gmail or Google Calendar (meta.readGoogle): its links are shown, never clickable (review round 3 of Phase 3). */
      readGoogle?: true;
    })
  | (MessageBase & { kind: "report"; practice: boolean; toolCalls: AiToolCall[]; routine: TeammateRoutineRef; readGoogle?: true })
  | (MessageBase & {
      kind: "event";
      event: TeammateEventKind | null;
      routineId: string | null;
      actionId: string | null;
      agentId?: string | null;
      replyTo?: string;
      link?: EventLink | null;
    })
  | (MessageBase & { kind: "approval"; actionIds: string[]; replyTo?: string; agentId?: string });

export const AGENT_ACTION_STATUSES = ["PENDING", "RUNNING", "EXECUTED", "FAILED", "DENIED", "EXPIRED", "CANCELLED"] as const;

export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set(AGENT_ACTION_STATUSES);

export function isAgentActionStatus(v: unknown): v is AgentActionStatus {
  return typeof v === "string" && STATUS_SET.has(v);
}

/** AgentAction.risk. A READ call never makes an action: it runs without asking. */
export type ActionRisk = "INTERNAL" | "OUTWARD" | "IRREVERSIBLE";

/**
 * What a card shows for one action. The server builds it from the stored
 * input (previews.ts), never from the model's words, and what runs is
 * exactly what it shows.
 */
export interface ActionPreview {
  /** "Post in #general" */
  title: string;
  /** The exact text that will be posted, commented or added. */
  body?: string;
  /** Facts: "34 people can read it." */
  lines?: string[];
  target?: { label: string; href?: string };
  audience?: number;
  undo?: string;
  editable?: { field: string; label: string; maxLength: number };
  /** The rule "don't ask again" stores: "post_in_talk:conv:<id>" or "send_kudos". */
  alwaysKey?: string;
  /** "Approve and don't ask again in #general" */
  alwaysLabel?: string;
}

/**
 * AgentAction.result once the tool ran: the sentence the decided card shows,
 * where it opens, and the tool's own answer, which only the teammate's next
 * turn reads (it never reaches the card).
 */
export interface ActionResult {
  text: string;
  href: string | null;
  data?: unknown;
}

/** One action as its card shows it. */
export interface ActionView {
  id: string;
  toolName: string;
  risk: ActionRisk;
  status: AgentActionStatus;
  preview: ActionPreview;
  /** "Approve and don't ask again": only while it waits, only where the preview names a rule, never when it cannot be undone. */
  always: { allowed: boolean; label: string | null };
  /** One card groups the actions of one run and one tool. */
  groupKey: string | null;
  sessionId: string | null;
  /** The person changed the text before approving. */
  edited: boolean;
  /**
   * What Edit starts from: the tool's one editable field (tool-policy.ts
   * EDITABLE_FIELD) as the input that runs holds it, the person's edit once
   * there is one, cut to the field's length. Never the card's own words: a
   * title there is shortened, and a doc section's body carries its heading.
   * Null when the tool has no such field or the input holds no text in it.
   */
  editableValue: string | null;
  /** person | rule | expiry | system */
  decidedVia: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  result: { text: string; href: string | null } | null;
  error: string | null;
  /** Where the card opens: its group chat, its teammate's chat, or Ask AI's (the server's actionViews). */
  href?: string | null;
  /**
   * Asked after the teammate read the person's email or calendar in that
   * answer, or in one that could not tell (review round 1 of Phase 3): it
   * stands alone, never in a batch (standsAlone). Present only when true.
   */
  readGoogle?: true;
}

/** One event of POST /api/agents/teammates/[slug]/messages. */
export type TeammateStreamEvent =
  | { type: "user_message"; message: TeammateMessageView }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> | null }
  | { type: "tool_result"; name: string; isError: boolean; state: CallState; title?: string }
  | { type: "approval"; action: ActionView }
  | { type: "event"; message: TeammateMessageView }
  | { type: "done"; messages: TeammateMessageView[]; error: string | null }
  | { type: "error"; message: string };

// ── Group chats (docs/plans/ai-teammates-phase2.md step 3) ───────────

/** One teammate of a group chat, as the page shows it. */
export interface GroupMemberView {
  agentId: string;
  slug: string;
  name: string;
  hue: TeammateHue | null;
  avatar: string | null;
  status: "ENABLED" | "DISABLED" | "ARCHIVED";
  /** It can answer now: on, not removed, and one the person may still use. */
  canAnswer: boolean;
  position: number;
  /** It answers a message that names nobody (group-chat.ts leadOf). */
  lead: boolean;
}

/** One group chat in the list (GET /api/teammate-groups). */
export interface GroupRow {
  id: string;
  name: string;
  /** The name is one the person gave it; else it follows its members (review round 8). */
  ownName?: boolean;
  members: GroupMemberView[];
  waiting: number;
  unread: boolean;
  lastAt: string | null;
  lastLine: string | null;
}

export interface GroupDetail extends GroupRow {
  createdAt: string;
}

/** A group message's stream: the saved message, then each answerer's turn, then done. */
export type GroupStreamEvent =
  | { type: "user_message"; message: TeammateMessageView; answerers: GroupMemberView[] }
  | { type: "answer_start"; agentId: string }
  | Extract<TeammateStreamEvent, { type: "text_delta" | "tool_use" | "tool_result" | "approval" | "event" }>
  | { type: "answer_done"; agentId: string; messages: TeammateMessageView[]; error: string | null }
  | { type: "skipped"; agentId: string; message: TeammateMessageView }
  | { type: "done"; messages: TeammateMessageView[]; error: string | null }
  | { type: "error"; message: string };

/** A ChatMessage as the routes select it. */
export interface TeammateMessageRow {
  id: string;
  role: string;
  content: string | null;
  toolCalls?: unknown;
  kind?: string | null;
  meta?: unknown;
  createdAt: Date | string;
}

/** An AgentAction as the routes select it. */
export interface AgentActionRow {
  id: string;
  toolName: string;
  risk: string;
  status: string;
  preview: unknown;
  result?: unknown;
  error?: string | null;
  /** The input that runs: read only for the editable field's own text (editableValue). */
  input?: unknown;
  editedInput?: unknown;
  groupKey?: string | null;
  sessionId?: string | null;
  /** The run that asked: a continue after it reads whether it read the person's Google (engine.ts startsTainted). */
  runId?: string | null;
  decidedVia?: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
  decidedAt?: Date | string | null;
  executedAt?: Date | string | null;
  /** Asked in a turn that read the person's Google, or could not tell (review round 1 of Phase 3). */
  readGoogle?: boolean | null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return typeof v === "string" ? v : null;
  return d.toISOString();
}

/** A link a card may follow: a path in this app, never another origin or a script. */
function appHref(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null;
}

function callsFrom(raw: unknown): AiToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CALLS).map(callFromLog).filter((c): c is AiToolCall => c !== null);
}

function idsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

/** A group message names at most this many answerers (GROUP_LIMITS.maxAnswerers). */
const MAX_ANSWERERS = 3;
/** The longest id or name a link or origin may carry; anything longer is not one this app wrote. */
const REF_MAX = 200;

function ref(v: unknown): string | null {
  const s = str(v);
  return s && s.length <= REF_MAX ? s : null;
}

/** meta.origin, or null when it is not one this app writes (an unknown kind, a missing part). */
function originFrom(raw: unknown): MessageOrigin | null {
  const o = rec(raw);
  if (!o) return null;
  if (o.kind === "delegated") {
    const byName = ref(o.byName);
    return byName ? { kind: "delegated", byName } : null;
  }
  if (o.kind === "talk") {
    const place = ref(o.place);
    const conversationId = ref(o.conversationId);
    const messageId = ref(o.messageId);
    return place && conversationId && messageId ? { kind: "talk", place, conversationId, messageId, postedMessageId: ref(o.postedMessageId) } : null;
  }
  if (o.kind === "automation") {
    const workflowName = ref(o.workflowName);
    const workflowId = ref(o.workflowId);
    const runId = ref(o.runId);
    return workflowName && workflowId && runId ? { kind: "automation", workflowName, workflowId, runId } : null;
  }
  return null;
}

/** meta.link, or null. Only its ids are read; eventLinkHref builds the address. */
function linkFrom(raw: unknown): EventLink | null {
  const l = rec(raw);
  if (!l) return null;
  if (l.kind === "chat") {
    const slug = ref(l.slug);
    if (!slug) return null;
    const actionId = ref(l.actionId);
    return actionId ? { kind: "chat", slug, actionId } : { kind: "chat", slug };
  }
  if (l.kind === "talk") {
    const conversationId = ref(l.conversationId);
    const messageId = ref(l.messageId);
    return conversationId && messageId ? { kind: "talk", conversationId, messageId } : null;
  }
  if (l.kind === "automation") {
    const workflowId = ref(l.workflowId);
    const runId = ref(l.runId);
    return workflowId && runId ? { kind: "automation", workflowId, runId } : null;
  }
  return null;
}

/** A saved message as the thread renders it, or null for one it does not render. */
export function messageViewFromRow(row: TeammateMessageRow): TeammateMessageView | null {
  const meta = rec(row.meta);
  const base: MessageBase = { id: row.id, createdAt: iso(row.createdAt) ?? "", text: row.content ?? "" };
  const practice = meta?.practice === true;
  // An automation's answer (kind AUTOMATION) reads as the teammate's own,
  // with where it was asked from; only the history query tells it apart.
  const kind = row.kind === "AUTOMATION" && row.role === "ASSISTANT" ? null : (row.kind ?? null);
  switch (kind) {
    case null:
      if (row.role === "USER") {
        const answerers = Array.isArray(meta?.answerers) ? idsFrom(meta.answerers).slice(0, MAX_ANSWERERS) : [];
        return {
          ...base,
          kind: "user",
          practice,
          ...(answerers.length > 0 ? { answerers } : {}),
          ...(meta?.runNow === true ? { runNow: true } : {}),
        };
      }
      if (row.role === "ASSISTANT") {
        // The person's message this answers (meta.replyTo), when the turn named it.
        const replyTo = str(meta?.replyTo);
        const agentId = str(meta?.agentId);
        const agentName = str(meta?.agentName);
        const origin = originFrom(meta?.origin);
        return {
          ...base,
          kind: "agent",
          practice,
          toolCalls: callsFrom(row.toolCalls),
          ...(replyTo ? { replyTo } : {}),
          ...(agentId ? { agentId } : {}),
          ...(agentId && agentName ? { agentName } : {}),
          ...(origin ? { origin } : {}),
          ...(meta?.resume === true ? { resume: true } : {}),
          ...(meta?.readGoogle === true ? { readGoogle: true as const } : {}),
        };
      }
      return null;
    case "REPORT":
      return {
        ...base,
        kind: "report",
        practice,
        toolCalls: callsFrom(row.toolCalls),
        routine: {
          id: str(meta?.routineId),
          name: str(meta?.routineName) ?? ROUTINE_FALLBACK_NAME,
          runId: str(meta?.runId),
          dueAt: iso(str(meta?.dueAt)),
        },
        ...(meta?.readGoogle === true ? { readGoogle: true as const } : {}),
      };
    case "EVENT": {
      const event = meta?.event;
      const agentId = str(meta?.agentId);
      const replyTo = str(meta?.replyTo);
      const link = linkFrom(meta?.link);
      return {
        ...base,
        kind: "event",
        event: isTeammateEventKind(event) ? event : null,
        routineId: str(meta?.routineId),
        actionId: str(meta?.actionId),
        ...(agentId ? { agentId } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(link ? { link } : {}),
      };
    }
    case "APPROVAL": {
      const replyTo = str(meta?.replyTo);
      const agentId = str(meta?.agentId);
      return { ...base, kind: "approval", actionIds: idsFrom(meta?.actionIds), ...(replyTo ? { replyTo } : {}), ...(agentId ? { agentId } : {}) };
    }
    default:
      return null;
  }
}

function previewFrom(raw: unknown): ActionPreview {
  const p: Record<string, unknown> = rec(raw) ?? {};
  const out: ActionPreview = { title: str(p.title) ?? APPROVAL_CARD.untitled };
  const body = str(p.body);
  if (body) out.body = body;
  const lines = Array.isArray(p.lines) ? p.lines.filter((l): l is string => typeof l === "string" && l.length > 0) : [];
  if (lines.length > 0) out.lines = lines;
  const target = rec(p.target);
  const targetLabel = str(target?.label);
  if (targetLabel) {
    const href = appHref(target?.href);
    out.target = href ? { label: targetLabel, href } : { label: targetLabel };
  }
  if (typeof p.audience === "number" && Number.isFinite(p.audience) && p.audience >= 0) out.audience = p.audience;
  const undo = str(p.undo);
  if (undo) out.undo = undo;
  const editable = rec(p.editable);
  const field = str(editable?.field);
  const label = str(editable?.label);
  const maxLength = editable?.maxLength;
  if (field && label && typeof maxLength === "number" && maxLength >= 1) out.editable = { field, label, maxLength: Math.floor(maxLength) };
  const alwaysKey = str(p.alwaysKey);
  if (alwaysKey) out.alwaysKey = alwaysKey;
  const alwaysLabel = str(p.alwaysLabel);
  if (alwaysLabel) out.alwaysLabel = alwaysLabel;
  return out;
}

/**
 * The editable field's own text in the input that runs (the person's edit
 * when there is one, else the stored input), a string only, cut to the
 * field's length without halving a character.
 */
function editableValueOf(row: AgentActionRow): string | null {
  const field = isToolName(row.toolName) ? EDITABLE_FIELD[row.toolName] : undefined;
  if (!field) return null;
  const edited = row.editedInput !== null && row.editedInput !== undefined;
  const value = rec(edited ? row.editedInput : row.input)?.[field.field];
  return typeof value === "string" ? clampText(value, field.maxLength) : null;
}

/**
 * A stored action as its card shows it, read defensively (the columns are
 * JSON). A status or risk this code does not know reads as the safe one: no
 * buttons (CANCELLED), and never "don't ask again" (IRREVERSIBLE).
 */
export function actionViewFromRow(row: AgentActionRow): ActionView {
  const status: AgentActionStatus = isAgentActionStatus(row.status) ? row.status : "CANCELLED";
  const risk: ActionRisk = row.risk === "INTERNAL" || row.risk === "OUTWARD" ? row.risk : "IRREVERSIBLE";
  const preview = previewFrom(row.preview);
  const allowed = status === "PENDING" && risk !== "IRREVERSIBLE" && Boolean(preview.alwaysKey);
  const result = rec(row.result);
  const resultText = str(result?.text);
  return {
    id: row.id,
    toolName: row.toolName,
    risk,
    status,
    preview,
    always: { allowed, label: allowed ? (preview.alwaysLabel ?? APPROVAL_CARD.approveAlways) : null },
    groupKey: row.groupKey ?? null,
    sessionId: row.sessionId ?? null,
    edited: row.editedInput !== null && row.editedInput !== undefined,
    editableValue: editableValueOf(row),
    decidedVia: row.decidedVia ?? null,
    createdAt: iso(row.createdAt) ?? "",
    expiresAt: iso(row.expiresAt) ?? "",
    decidedAt: iso(row.decidedAt),
    executedAt: iso(row.executedAt),
    result: resultText ? { text: resultText, href: appHref(result?.href) } : null,
    error: str(row.error),
    ...(row.readGoogle === true ? { readGoogle: true as const } : {}),
  };
}

export interface ApprovalGroup {
  /** AgentAction.groupKey (one run and one tool), else the action's own id. */
  key: string;
  toolName: string;
  actions: ActionView[];
}

/**
 * One card's actions (an APPROVAL row's actionIds), grouped as the card lists
 * them: by groupKey, in the order the turn asked. An id with no row (another
 * person's, or gone) is left out, and each id counts once. `pendingIds` is
 * what "Select all" and "Approve {k}" act on.
 */
export function groupApprovals(
  actionIds: readonly string[],
  actions: Readonly<Record<string, ActionView>>,
): { groups: ApprovalGroup[]; pendingIds: string[] } {
  const groups: ApprovalGroup[] = [];
  const byKey = new Map<string, ApprovalGroup>();
  const seen = new Set<string>();
  const pendingIds: string[] = [];
  for (const id of actionIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const action = Object.prototype.hasOwnProperty.call(actions, id) ? actions[id] : undefined;
    if (!action) continue;
    const key = action.groupKey ?? action.id;
    let group = byKey.get(key);
    if (!group) {
      group = { key, toolName: action.toolName, actions: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.actions.push(action);
    if (action.status === "PENDING") pendingIds.push(action.id);
  }
  return { groups, pendingIds };
}

/**
 * Whether a request is approved only on a card of its own (review of step
 * 3): what cannot be taken back (an email sent or a reply in the person's
 * name, an invitation, an invite answered, a calendar change that tells other
 * people, and a class this code does not know, read as IRREVERSIBLE).
 *
 * AND ANYTHING ASKED AFTER A GOOGLE READ (review round 1 of Phase 3). A
 * planted email could shape a memory ("always cc billing@..."), a routine or
 * a Talk post, and in a batch it started ticked and closed, one "Approve 4"
 * away with its words never on screen. Each such card is its own, its body
 * whole, approved by its own click.
 */
export function standsAlone(a: Pick<ActionView, "risk" | "toolName" | "readGoogle">): boolean {
  return a.readGoogle === true || a.risk === "IRREVERSIBLE" || (isToolName(a.toolName) && ALWAYS_ASK.has(a.toolName));
}

/**
 * One turn's requests as the approval card lays them out (approval-card.tsx,
 * the chat and the Inbox pane alike): what stands alone each on its own card,
 * with who it goes to, the account, who is outside the workspace and every
 * word in sight; everything else in one batch, as before. A batch starts with
 * every row ticked and closed, so "Approve {n}" could otherwise send an email
 * whose recipients the person never saw (a planted Reply-To, say).
 */
export function approvalCardParts(actions: readonly ActionView[]): { batch: ActionView[]; alone: ActionView[] } {
  const batch: ActionView[] = [];
  const alone: ActionView[] = [];
  for (const a of actions) (standsAlone(a) ? alone : batch).push(a);
  return { batch, alone };
}

/** How many lines of a routine report show before "And {n} more". */
export const REPORT_LINES = 8;

/**
 * A routine report as its bubble shows it: the first `max` lines with words
 * in them (the blank lines between them kept, so the markdown still reads as
 * paragraphs and lists), and how many more lines "And {n} more" stands for.
 */
export function reportLines(text: string, max = REPORT_LINES): { lines: string[]; more: number } {
  const all = text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "").split(/\r?\n/);
  const lines: string[] = [];
  let shown = 0;
  let more = 0;
  for (const line of all) {
    const blank = line.trim() === "";
    if (shown >= max) {
      if (!blank) more += 1;
      continue;
    }
    lines.push(line);
    if (!blank) shown += 1;
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return { lines, more };
}

const LAST_LINE_MAX = 120;

/**
 * The second line of a teammate's row: what was said last, on one line.
 * Null when the chat has nothing in it yet (the row shows the job instead).
 */
export function lastLineFor(m: TeammateMessageView | null | undefined): string | null {
  if (!m) return null;
  const line = plainLine(m.text, LAST_LINE_MAX);
  if (m.kind === "user") return line ? (m.runNow ? lastLineRunNow(line) : lastLineYou(line)) : null;
  if (m.kind === "report") return line ? lastLineReport(m.routine.name, line) : m.routine.name;
  // A group's answer names who answered.
  if (m.kind === "agent" && m.agentName && line) return GROUP_COPY.lastLineAgent(m.agentName, line);
  if (m.kind === "agent" && !line) {
    // An answer of tools only reads as what the last one did.
    const last = m.toolCalls[m.toolCalls.length - 1];
    if (!last) return null;
    return last.outcome ? toolOutcomeSentence(last.name, last.input, last.outcome).text : toolSentence(last.name, last.input, last.failed).text;
  }
  return line || null;
}

/**
 * The list's order (5.2): the most recent activity first, then the ones
 * never used, by name. `lastAt` is the time of the chat's last message.
 */
export function sortTeammates<T extends { name: string; lastAt: string | Date | null }>(rows: readonly T[]): T[] {
  const time = (at: string | Date | null) => (at === null ? Number.NaN : new Date(at).getTime());
  return [...rows].sort((a, b) => {
    const ta = time(a.lastAt);
    const tb = time(b.lastAt);
    const hasA = Number.isFinite(ta);
    const hasB = Number.isFinite(tb);
    if (hasA !== hasB) return hasA ? -1 : 1;
    if (hasA && ta !== tb) return tb - ta;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** The list as the search and the tab show it: by name or job, and on Waiting for you only those with something waiting. */
export function filterTeammates<T extends { name: string; job: string; waiting: number }>(
  rows: readonly T[],
  query: string,
  opts: { waitingOnly?: boolean } = {},
): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) => (!opts.waitingOnly || r.waiting > 0) && (!q || r.name.toLowerCase().includes(q) || r.job.toLowerCase().includes(q)),
  );
}

/** One row of the list: a teammate's chat, or a group chat (docs/plans/ai-teammates-phase2.md step 4). */
export type ListEntry<T extends { name: string; job: string; waiting: number; lastAt: string | Date | null }> =
  | { kind: "teammate"; row: T }
  | { kind: "group"; row: GroupRow };

/**
 * Teammates and groups in one list, filtered and sorted together (sortTeammates'
 * order, on name and last activity): the search matches a group's name and
 * its teammates' names, and Waiting for you keeps only what waits.
 */
export function listEntries<T extends { name: string; job: string; waiting: number; lastAt: string | Date | null }>(
  teammates: readonly T[],
  groups: readonly GroupRow[],
  query: string,
  opts: { waitingOnly?: boolean } = {},
): Array<ListEntry<T>> {
  const q = query.trim().toLowerCase();
  const shownGroups = groups.filter(
    (g) => (!opts.waitingOnly || g.waiting > 0) && (!q || g.name.toLowerCase().includes(q) || g.members.some((m) => m.name.toLowerCase().includes(q))),
  );
  const entries: Array<ListEntry<T> & { name: string; lastAt: string | Date | null }> = [
    ...filterTeammates(teammates, query, opts).map((row) => ({ kind: "teammate" as const, row, name: row.name, lastAt: row.lastAt })),
    ...shownGroups.map((row) => ({ kind: "group" as const, row, name: row.name, lastAt: row.lastAt })),
  ];
  return sortTeammates(entries).map((e) => (e.kind === "teammate" ? { kind: "teammate", row: e.row } : { kind: "group", row: e.row }));
}

/** At most this many starter buttons on a new chat (5.4). */
const STARTERS_SHOWN = 4;

/**
 * The starter prompts of the template a teammate was made from, read from
 * the list's templates (GET /api/agents/teammates) by the template's key.
 * Read defensively: a template without starters, or none, offers none.
 */
export function startersFor(templates: readonly unknown[] | null | undefined, key: string | null | undefined): string[] {
  if (!key || !templates) return [];
  for (const t of templates) {
    const r = rec(t);
    if (!r || r.key !== key || !Array.isArray(r.starters)) continue;
    return r.starters.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, STARTERS_SHOWN);
  }
  return [];
}

// ── The page's address (5.1) ────────────────────────────────────────

export const AGENTS_HUB_VIEWS = ["chats", "waiting", "workspace", "runs"] as const;

/** Chats, Waiting for you, Workspace agents, Run history. */
export type AgentsHubView = (typeof AGENTS_HUB_VIEWS)[number];

const HUB_VIEW_SET: ReadonlySet<string> = new Set(AGENTS_HUB_VIEWS);

/**
 * The view an /agents address opens. ?tab= names it. With no tab, a link
 * from before AI teammates (?agent=<slug>[&run=<id>], the agent drawer)
 * opens Workspace agents with that drawer, exactly as it did; anything else
 * is Chats.
 */
export function hubViewFor(params: { get(name: string): string | null } | null | undefined): AgentsHubView {
  const tab = params?.get("tab") ?? null;
  if (tab && HUB_VIEW_SET.has(tab)) return tab as AgentsHubView;
  if (!tab && params?.get("agent")) return "workspace";
  return "chats";
}

export const TEAMMATE_SETTINGS_TABS = ["instructions", "tools", "memory", "routines", "activity"] as const;

/** &settings=<tab>: the settings drawer and the tab it opens on. */
export type TeammateSettingsTab = (typeof TEAMMATE_SETTINGS_TABS)[number];

const SETTINGS_TAB_SET: ReadonlySet<string> = new Set(TEAMMATE_SETTINGS_TABS);

export function settingsTabFor(v: string | null | undefined): TeammateSettingsTab | null {
  return v && SETTINGS_TAB_SET.has(v) ? (v as TeammateSettingsTab) : null;
}

// ── A chat as the client holds it (teammate-store.ts) ───────────────

/** GET /api/agents/teammates/[slug]/messages: a page, oldest first, and the cards its rows name. */
export interface TeammateMessagesPage {
  session: { id: string } | null;
  messages: TeammateMessageView[];
  actions: Record<string, ActionView>;
  hasMore: boolean;
}

/** The id prefix of a row the store made before the server named it: the person's message, the answer as it arrives. */
export const TEMP_ID_PREFIX = "tmp:";

export function isTempMessage(m: { id: string }): boolean {
  return m.id.startsWith(TEMP_ID_PREFIX);
}

/** Whether `a` comes before `b` in the thread: the route's order, time and then id. */
function comesBefore(a: TeammateMessageView, b: TeammateMessageView): boolean {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
}

/**
 * The chat after a fresh read of its newest page: the page, under any older
 * messages already on screen (Show earlier messages), so a refresh never
 * takes them away. The store's own rows (an optimistic bubble, an answer
 * that broke off) give way to the saved ones. `hasMore` stays about the
 * oldest message held.
 */
/**
 * A page in reading order: an answer or a card saved for a message
 * (replyTo) sits right after that message, even when it was saved after a
 * later one (a turn that broke off finishes on the server after the person
 * asked again). Every other row keeps the server's order.
 */
export function orderReplies(rows: readonly TeammateMessageView[]): TeammateMessageView[] {
  const questions = new Set(rows.filter((r) => r.kind === "user").map((r) => r.id));
  // A group's skipped line names its message too, so a late one reads under it (review of step 4).
  const replyOf = (r: TeammateMessageView) =>
    (r.kind === "agent" || r.kind === "approval" || r.kind === "event") && r.replyTo && questions.has(r.replyTo) ? r.replyTo : null;
  const replies = new Map<string, TeammateMessageView[]>();
  const rest: TeammateMessageView[] = [];
  for (const r of rows) {
    const q = replyOf(r);
    if (q) replies.set(q, [...(replies.get(q) ?? []), r]);
    else rest.push(r);
  }
  if (replies.size === 0) return [...rows];
  const out: TeammateMessageView[] = [];
  for (const r of rest) {
    out.push(r);
    if (r.kind === "user") out.push(...(replies.get(r.id) ?? []));
  }
  return out;
}

export function mergeNewestPage(
  held: { messages: readonly TeammateMessageView[]; hasMore: boolean },
  page: { messages: readonly TeammateMessageView[]; hasMore: boolean },
): { messages: TeammateMessageView[]; hasMore: boolean } {
  const first = page.messages[0];
  if (!first) return { messages: [], hasMore: false };
  const ids = new Set(page.messages.map((m) => m.id));
  const older = held.messages.filter((m) => !isTempMessage(m) && !ids.has(m.id) && comesBefore(m, first));
  // Ordered across everything held, not one page: a late answer whose
  // message sits on an older page still reads under that message.
  return { messages: orderReplies([...older, ...page.messages]), hasMore: older.length > 0 ? held.hasMore : page.hasMore };
}

/** Show earlier messages: an older page above what is on screen, each message once. */
export function prependOlder(held: readonly TeammateMessageView[], older: readonly TeammateMessageView[]): TeammateMessageView[] {
  const have = new Set(held.map((m) => m.id));
  // Replies placed under their message across both pages (orderReplies).
  return orderReplies([...older.filter((m) => !have.has(m.id)), ...held]);
}

/** The newest answer or report the server saved: what the person has read up to once the chat is open. */
export function lastAnswerId(messages: readonly TeammateMessageView[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if ((m.kind === "agent" || m.kind === "report") && !isTempMessage(m)) return m.id;
  }
  return null;
}

// ── The live turn ───────────────────────────────────────────────────

type AgentMessage = Extract<TeammateMessageView, { kind: "agent" }>;

/** The chat while a turn streams in. */
export interface TurnView {
  messages: TeammateMessageView[];
  actions: Record<string, ActionView>;
}

/** The rows of the turn in flight. */
export interface TurnIds {
  /** The person's message: the optimistic bubble's id until the server's arrives. Null for a continue. */
  userId: string | null;
  /** The answer being written. */
  liveId: string;
}

function isMessageView(v: unknown): v is TeammateMessageView {
  const r = rec(v);
  return Boolean(r && typeof r.id === "string" && r.id && typeof r.kind === "string");
}

function patchAnswer(messages: readonly TeammateMessageView[], liveId: string, fn: (m: AgentMessage) => AgentMessage): TeammateMessageView[] {
  return messages.map((m) => (m.id === liveId && m.kind === "agent" ? fn(m) : m));
}

/** An answer that stopped arriving: no Working dots, no pending rows. */
function settleAnswer(m: AgentMessage): AgentMessage {
  return { ...m, streaming: false, toolCalls: m.toolCalls.map((c) => (c.pending ? { ...c, pending: false } : c)) };
}

/**
 * tool_result: settle the newest pending row of that tool. A call that
 * waits for the person's approval, or only practised, carries the title the
 * server gave it, so the row reads "Waiting for your approval: ..." or
 * "Would ...", never as done.
 */
export function withTeammateToolResult(
  calls: readonly AiToolCall[],
  e: { name: string; isError: boolean; state: CallState; title?: string },
): AiToolCall[] {
  const next = [...calls];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].name !== e.name || !next[i].pending) continue;
    const failed = e.isError || e.state === "failed";
    const didNotRun = !failed && (e.state === "waiting" || e.state === "practice");
    next[i] = {
      ...next[i],
      pending: false,
      failed,
      outcome: didNotRun
        ? { failed: false, message: null, href: null, count: null, searched: null, state: e.state as "waiting" | "practice", ...(e.title ? { title: e.title } : {}) }
        : next[i].outcome,
    };
    return next;
  }
  return next;
}

/**
 * One event of the teammate stream applied to the chat. The person's saved
 * message replaces the optimistic one; text and tool rows build the answer;
 * a card's action joins the cards; a line (a memory saved, a routine set up)
 * lands above the answer, where its saved row sorts; `done` puts the saved
 * rows (the answer, then its card) where the live answer was. When nothing
 * was saved, what streamed stays, settled, so what it did stays in sight.
 */
export function applyTeammateEvent(view: TurnView, ids: TurnIds, e: TeammateStreamEvent): { view: TurnView; ids: TurnIds } {
  switch (e.type) {
    case "user_message": {
      const saved = e.message;
      const from = ids.userId;
      if (!isMessageView(saved) || from === null) return { view, ids };
      return { view: { ...view, messages: view.messages.map((m) => (m.id === from ? saved : m)) }, ids: { ...ids, userId: saved.id } };
    }
    case "text_delta":
      return { view: { ...view, messages: patchAnswer(view.messages, ids.liveId, (m) => ({ ...m, text: m.text + (typeof e.text === "string" ? e.text : "") })) }, ids };
    case "tool_use":
      return { view: { ...view, messages: patchAnswer(view.messages, ids.liveId, (m) => ({ ...m, toolCalls: withToolUse(m.toolCalls, e.name, e.input ?? null) })) }, ids };
    case "tool_result":
      return { view: { ...view, messages: patchAnswer(view.messages, ids.liveId, (m) => ({ ...m, toolCalls: withTeammateToolResult(m.toolCalls, e) })) }, ids };
    case "approval": {
      const action = e.action;
      if (!action || typeof action.id !== "string" || !action.id) return { view, ids };
      return { view: { ...view, actions: { ...view.actions, [action.id]: action } }, ids };
    }
    case "event": {
      const line = e.message;
      if (!isMessageView(line) || view.messages.some((m) => m.id === line.id)) return { view, ids };
      const at = view.messages.findIndex((m) => m.id === ids.liveId);
      const messages = at < 0 ? [...view.messages, line] : [...view.messages.slice(0, at), line, ...view.messages.slice(at)];
      return { view: { ...view, messages }, ids };
    }
    case "done": {
      const have = new Set(view.messages.map((m) => m.id));
      const rows: readonly TeammateMessageView[] = Array.isArray(e.messages) ? e.messages : [];
      const saved = rows.filter((m) => isMessageView(m) && !have.has(m.id));
      const at = view.messages.findIndex((m) => m.id === ids.liveId);
      if (at < 0) return { view: { ...view, messages: [...view.messages, ...saved] }, ids };
      const live = view.messages[at];
      const kept = live.kind === "agent" && (live.text.length > 0 || live.toolCalls.length > 0) ? [settleAnswer(live)] : [];
      const messages = [...view.messages.slice(0, at), ...(saved.length > 0 ? saved : kept), ...view.messages.slice(at + 1)];
      return { view: { ...view, messages }, ids };
    }
    default:
      return { view, ids };
  }
}

/** A group message's stream as it is drawn: the person's message, and the answer being written now (null between answers). */
export interface GroupTurnIds {
  userId: string | null;
  liveId: string | null;
  agentId: string | null;
}

/**
 * One event of a group chat's stream applied to the chat
 * (docs/plans/ai-teammates-phase2.md step 4). The person's saved message
 * replaces the optimistic one; each answerer's turn starts its own live
 * answer (`newLiveId` names it, from the caller, so a test can know it), and
 * its text, tools, cards and lines go to that answer as in a one-teammate
 * chat; answer_done puts that teammate's saved rows where its live answer
 * was; a skipped teammate's line lands at the foot; done adds any saved row
 * not drawn yet.
 */
export function applyGroupEvent(
  view: TurnView,
  ids: GroupTurnIds,
  e: GroupStreamEvent,
  live: { newLiveId: string; agentName: (agentId: string) => string | null },
): { view: TurnView; ids: GroupTurnIds } {
  const one = (t: TeammateStreamEvent): { view: TurnView; ids: GroupTurnIds } => {
    if (!ids.liveId && t.type !== "user_message" && t.type !== "approval" && t.type !== "event") return { view, ids };
    const out = applyTeammateEvent(view, { userId: ids.userId, liveId: ids.liveId ?? "" }, t);
    return { view: out.view, ids: { ...ids, userId: out.ids.userId } };
  };
  switch (e.type) {
    case "user_message":
      return one({ type: "user_message", message: e.message });
    case "answer_start": {
      if (typeof e.agentId !== "string" || !e.agentId) return { view, ids };
      const name = live.agentName(e.agentId);
      const row: TeammateMessageView = {
        id: live.newLiveId,
        kind: "agent",
        text: "",
        practice: false,
        toolCalls: [],
        createdAt: new Date().toISOString(),
        streaming: true,
        agentId: e.agentId,
        ...(name ? { agentName: name } : {}),
        ...(ids.userId && !isTempMessage({ id: ids.userId }) ? { replyTo: ids.userId } : {}),
      };
      return { view: { ...view, messages: [...view.messages, row] }, ids: { ...ids, liveId: live.newLiveId, agentId: e.agentId } };
    }
    case "text_delta":
    case "tool_use":
    case "tool_result":
    case "approval":
    case "event":
      return one(e);
    case "answer_done": {
      if (!ids.liveId) return { view, ids };
      const out = applyTeammateEvent(view, { userId: ids.userId, liveId: ids.liveId }, { type: "done", messages: Array.isArray(e.messages) ? e.messages : [], error: e.error ?? null });
      return { view: out.view, ids: { ...ids, liveId: null, agentId: null } };
    }
    case "skipped": {
      const line = e.message;
      if (!isMessageView(line) || view.messages.some((m) => m.id === line.id)) return { view, ids };
      return { view: { ...view, messages: [...view.messages, line] }, ids };
    }
    case "done": {
      const have = new Set(view.messages.map((m) => m.id));
      const rows: readonly TeammateMessageView[] = Array.isArray(e.messages) ? e.messages : [];
      const missing = rows.filter((m) => isMessageView(m) && !have.has(m.id));
      return missing.length > 0 ? { view: { ...view, messages: [...view.messages, ...missing] }, ids } : { view, ids };
    }
    default:
      return { view, ids };
  }
}

/**
 * Whether these rows answer a group turn that broke off: every teammate it
 * expected has either its answer to that message (replyTo and agentId) or
 * its skipped line. A group continue expects one teammate, and is answered
 * by a new continue answer of that teammate (resume, not already held).
 * Phase 1's rule (one answer to the message) would end a two-teammate turn
 * at its first answer.
 */
export function groupAnsweredSince(
  messages: readonly TeammateMessageView[],
  stop: { questionId: string | null; known: ReadonlySet<string>; expect: readonly string[] },
): boolean {
  const saved = messages.filter((m) => !isTempMessage(m));
  if (stop.questionId === null) {
    return stop.expect.every((id) => saved.some((m) => m.kind === "agent" && m.agentId === id && m.resume === true && !stop.known.has(m.id)));
  }
  return stop.expect.every((id) =>
    saved.some((m) => (m.kind === "agent" || m.kind === "event") && m.replyTo === stop.questionId && m.agentId === id),
  );
}

/**
 * What a turn that failed leaves in the chat (session-store.ts send's rule):
 * when the server never had the message, the bubble leaves (its words go
 * back to the composer); when it has it, the bubble stays, an answer that
 * never started leaves, and one that did stays with its tool rows settled.
 */
export function failedTurnMessages(messages: readonly TeammateMessageView[], ids: TurnIds, serverHas: boolean): TeammateMessageView[] {
  return messages.flatMap((m): TeammateMessageView[] => {
    if (!serverHas && ids.userId !== null && m.id === ids.userId) return [];
    if (m.id !== ids.liveId || m.kind !== "agent") return [m];
    if (!serverHas || (!m.text && m.toolCalls.length === 0)) return [];
    return [settleAnswer(m)];
  });
}

/** What the composer holds after a turn failed: Ask AI's rule, the same for a teammate's chat (src/lib/ai/thread.ts). */
export { draftAfterFailure } from "@/lib/ai/thread";

/**
 * Why a message or a continue did not go through, as the composer's error row
 * says it (5.3, 5.4):
 *   not_sent        the chat never got the message; it is back in the composer
 *   stopped         the chat has the message and the answer broke off
 *   ended           the answer is saved but ended early (cut short, declined)
 *   ai_limit        the workspace's AI questions are used up
 *   agent_cap       the teammate's own monthly limit is reached
 *   rate_limited    too many AI requests in a minute
 *   paused, removed the teammate was paused or removed meanwhile
 *   gone            the teammate is not there for this person any more
 *   not_configured  the workspace has no AI key
 *   ai_off          AI was turned off for the workspace
 *   refused         the server said no for another reason
 */
export type TeammateSendError =
  | "not_sent"
  | "stopped"
  | "ended"
  | "ai_limit"
  | "agent_cap"
  | "rate_limited"
  | "paused"
  | "removed"
  | "gone"
  | "not_configured"
  | "ai_off"
  | "refused";

/**
 * A refused POST .../messages as the error row says it, with the server's
 * own sentence where it sent one. Only the teammate routes' { error, code }
 * carries a sentence; the app gate's { error: "app_off" } is a code. A
 * continue with nothing new to tell the teammate is no error at all (null).
 */
export function teammateSendFailure(status: number, body: unknown): { error: TeammateSendError | null; text: string | null } {
  const b = rec(body);
  const code = str(b?.code);
  const sentence = code ? str(b?.error) : null;
  if (status === 403 && str(b?.error) === "app_off") return { error: "ai_off", text: null };
  if (status === 403 && (code === "ai_limit" || code === "agent_cap")) return { error: code, text: sentence };
  if (status === 429) return { error: "rate_limited", text: sentence };
  if (status === 409 && code === "nothing_to_continue") return { error: null, text: null };
  // A teammate no longer in the group has nothing to continue: no error row,
  // and never a Try again that would send the composer's words (review round 2).
  if (status === 409 && code === "not_in_group") return { error: null, text: null };
  if (status === 409 && code === "no_one_to_answer") return { error: "refused", text: sentence };
  if (status === 409 && code === "agent_paused") return { error: "paused", text: sentence };
  if (status === 409 && code === "agent_removed") return { error: "removed", text: sentence };
  // A group member the person can no longer use: the server's sentence, no
  // Try again that would send the composer's words instead (review round 5).
  if (status === 409 && code === "no_access") return { error: "removed", text: sentence };
  if (status === 503) return { error: "not_configured", text: sentence };
  if (status === 404) return { error: "gone", text: null };
  if (status === 403) return { error: "refused", text: sentence };
  return { error: "not_sent", text: sentence };
}

/** The error row's sentence: the server's when it sent one, else the row's own. */
export function sendErrorSentence(error: TeammateSendError, serverText: string | null, name: string): string {
  if (serverText) return serverText;
  switch (error) {
    case "stopped":
      return TEAMMATE_CHAT.stopped;
    case "paused":
      return pausedNotSent(name);
    case "removed":
      return removedComposer(name);
    case "gone":
      return TEAMMATE_ROUTE_ERRORS.teammateNotFound;
    case "not_configured":
      return TEAMMATE_CHAT.notSetUp;
    case "ai_off":
      return TEAMMATE_CHAT.aiOff;
    case "refused":
      return ACTION_ERRORS.personCannot;
    default:
      return TEAMMATE_CHAT.notSent;
  }
}

/** Whether the error row offers Try again: only where sending the same words again can work. */
export function canRetrySend(error: TeammateSendError): boolean {
  return error === "not_sent" || error === "stopped" || error === "rate_limited";
}

// ── Deciding (POST /api/agents/actions/decide) ──────────────────────

/** One decision the person sends (actions.ts DecisionInput). */
export interface TeammateDecision {
  id: string;
  decision: "approve" | "deny";
  /** The person's change to the action's one editable field. */
  edit?: { text: string };
}

/** What the route answers for one decision (actions.ts DecisionResult). */
export interface TeammateDecisionResult {
  id: string;
  status: AgentActionStatus | "not_found";
  code?: string;
  result?: { text: string; href: string | null };
  error?: string;
}

/** A card's decision: the route's results, or why the request itself failed (its sentence, for a 429). */
export type DecideAnswer = { ok: true; results: TeammateDecisionResult[] } | { ok: false; error: string | null };

/**
 * The cards after a decision's answer, before the chat is read again: each
 * decided action shows its outcome at once. One that stays PENDING (its
 * teammate is paused, or the person cannot be acted for now) keeps its
 * buttons; the card says why. `at` stands in for the decision's time until
 * the read brings the server's.
 */
export function applyDecisionResults(
  actions: Readonly<Record<string, ActionView>>,
  results: readonly TeammateDecisionResult[],
  at: string,
): Record<string, ActionView> {
  const next: Record<string, ActionView> = { ...actions };
  for (const r of results) {
    const a = Object.prototype.hasOwnProperty.call(next, r.id) ? next[r.id] : undefined;
    if (!a || !isAgentActionStatus(r.status)) continue;
    const decided = r.status !== "PENDING";
    next[r.id] = {
      ...a,
      status: r.status,
      always: decided ? { allowed: false, label: null } : a.always,
      decidedAt: decided ? (a.decidedAt ?? at) : a.decidedAt,
      executedAt: r.status === "EXECUTED" ? (a.executedAt ?? at) : a.executedAt,
      result: r.result && typeof r.result.text === "string" ? { text: r.result.text, href: appHref(r.result.href) } : a.result,
      error: decided ? (r.error ?? a.error) : a.error,
    };
  }
  return next;
}

/** How many lines of a card's quoted text show before "Show all" (5.4). */
export const CARD_BODY_LINES = 12;

/** And at most this many characters of them: one long paragraph is many lines. */
const CARD_BODY_CHARS = 1500;

/**
 * A card's quoted text as it first shows: its first lines, cut by lines and
 * characters rather than by the box's height, so nothing is ever hidden
 * without "Show all" beside it.
 */
export function clipCardBody(text: string, maxLines = CARD_BODY_LINES, maxChars = CARD_BODY_CHARS): { text: string; clipped: boolean } {
  const lines = text.split(/\r?\n/);
  let shown = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : text;
  let clipped = lines.length > maxLines;
  if (shown.length > maxChars) {
    shown = clampText(shown, maxChars);
    clipped = true;
  }
  return clipped ? { text: `${shown.trimEnd()}…`, clipped } : { text, clipped };
}

/**
 * What the Edit box starts with: the field's own value as it will run
 * (editableValue: a long title whole, a doc section's text without the
 * heading its body shows above it). For a card read without its input, the
 * exact text a post, a comment, kudos or a doc section carries (the card's
 * body), or for a title the subject the card's title quotes ('Create task
 * "Call Acme"').
 */
export function editStartText(a: Pick<ActionView, "preview"> & Partial<Pick<ActionView, "editableValue">>): string {
  const field = a.preview.editable?.field;
  if (!field) return "";
  if (typeof a.editableValue === "string") return a.editableValue;
  if (field === "title") {
    const t = a.preview.title;
    const open = t.indexOf('"');
    const close = t.lastIndexOf('"');
    return open >= 0 && close > open ? t.slice(open + 1, close) : "";
  }
  return a.preview.body ?? "";
}

/**
 * A decided card's line (5.4): `time` is when it was decided, `date` when it
 * expired, in the viewer's words. Null while it waits or runs.
 */
export function decidedLine(
  a: Pick<ActionView, "status" | "error" | "preview">,
  words: { time: string; date: string; agentName: string },
): string | null {
  switch (a.status) {
    case "EXECUTED":
      return approvedAt(words.time);
    case "DENIED":
      return deniedAt(words.time);
    case "EXPIRED":
      return expiredAt(words.date, words.agentName);
    case "FAILED":
      if (a.error === ACTION_ERRORS.unconfirmed) return unconfirmedLine(a.preview.target?.label ?? a.preview.title);
      return a.error ? cardFailedLine(a.error) : didntWorkLine(a.preview.title, "");
    case "CANCELLED":
      return a.error ?? cancelledRemovedLine(words.agentName);
    default:
      return null;
  }
}

/** A request on the settings' Activity tab: its chip, when the card's own would not be true, and where it opens. */
export interface ActivityActionView {
  /** Null: the card's own chip (approval-card.tsx ActionStatusChip). */
  chip: { label: string; tone: RunTone } | null;
  href: string;
}

/**
 * One of the person's requests as the Activity tab lists it (5.5): it opens
 * its card in the chat. A call their own "Don't ask" let run (decidedVia
 * "rule") had no card and nobody approved it, so it reads "Ran without
 * asking" ("Running" while it runs; one that failed keeps "Didn't work") and
 * opens the run that made it, as a Recent runs row does. Its run is the part
 * of its groupKey before the colon ("<runId>:<tool>"); without one, the chat.
 */
export function activityActionView(a: Pick<ActionView, "id" | "status" | "decidedVia" | "groupKey" | "href">, slug: string): ActivityActionView {
  const chat = `/agents?chat=${encodeURIComponent(slug)}`;
  // Where the card lives, as the server says (a group's waits in the group; review round 8).
  if (a.decidedVia !== "rule") return { chip: null, href: a.href || `${chat}&action=${encodeURIComponent(a.id)}` };
  const colon = a.groupKey ? a.groupKey.indexOf(":") : -1;
  const runId = a.groupKey && colon > 0 ? a.groupKey.slice(0, colon) : null;
  const chip: ActivityActionView["chip"] =
    a.status === "EXECUTED"
      ? { label: ACTIVITY_COPY.ranWithoutAsking, tone: "success" }
      : a.status === "RUNNING"
        ? { label: ACTIVITY_COPY.running, tone: "info" }
        : null;
  return { chip, href: runId ? `/agents?tab=runs&agent=${encodeURIComponent(slug)}&run=${encodeURIComponent(runId)}` : chat };
}
