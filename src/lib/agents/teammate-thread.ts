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

import { callFromLog, type AiToolCall } from "@/lib/ai/thread";
import { plainLine } from "./run-view";
import { toolOutcomeSentence, toolSentence } from "./tool-verbs";
import { APPROVAL_CARD, ROUTINE_FALLBACK_NAME, lastLineReport, lastLineYou } from "./teammate-copy";

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

/** One row of the thread. */
export type TeammateMessageView =
  | (MessageBase & { kind: "user"; practice: boolean })
  | (MessageBase & { kind: "agent"; practice: boolean; toolCalls: AiToolCall[]; streaming?: boolean })
  | (MessageBase & { kind: "report"; practice: boolean; toolCalls: AiToolCall[]; routine: TeammateRoutineRef })
  | (MessageBase & { kind: "event"; event: TeammateEventKind | null; routineId: string | null; actionId: string | null })
  | (MessageBase & { kind: "approval"; actionIds: string[] });

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
  /** person | rule | expiry | system */
  decidedVia: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  result: { text: string; href: string | null } | null;
  error: string | null;
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
  editedInput?: unknown;
  groupKey?: string | null;
  sessionId?: string | null;
  decidedVia?: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
  decidedAt?: Date | string | null;
  executedAt?: Date | string | null;
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

/** A saved message as the thread renders it, or null for one it does not render. */
export function messageViewFromRow(row: TeammateMessageRow): TeammateMessageView | null {
  const meta = rec(row.meta);
  const base: MessageBase = { id: row.id, createdAt: iso(row.createdAt) ?? "", text: row.content ?? "" };
  const practice = meta?.practice === true;
  switch (row.kind ?? null) {
    case null:
      if (row.role === "USER") return { ...base, kind: "user", practice };
      if (row.role === "ASSISTANT") return { ...base, kind: "agent", practice, toolCalls: callsFrom(row.toolCalls) };
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
      };
    case "EVENT": {
      const event = meta?.event;
      return { ...base, kind: "event", event: isTeammateEventKind(event) ? event : null, routineId: str(meta?.routineId), actionId: str(meta?.actionId) };
    }
    case "APPROVAL":
      return { ...base, kind: "approval", actionIds: idsFrom(meta?.actionIds) };
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
    decidedVia: row.decidedVia ?? null,
    createdAt: iso(row.createdAt) ?? "",
    expiresAt: iso(row.expiresAt) ?? "",
    decidedAt: iso(row.decidedAt),
    executedAt: iso(row.executedAt),
    result: resultText ? { text: resultText, href: appHref(result?.href) } : null,
    error: str(row.error),
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
  if (m.kind === "user") return line ? lastLineYou(line) : null;
  if (m.kind === "report") return line ? lastLineReport(m.routine.name, line) : m.routine.name;
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
