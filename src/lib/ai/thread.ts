// The pure half of the one Ask AI session (src/lib/ai/session-store.ts): how
// the chat stream's bytes become events, and how a persisted or streamed
// turn becomes the rows the thread renders. No React, no fetch, so every
// rule here is tested without a browser.

import { toolOutcome, type ToolOutcome } from "@/lib/agents/tool-verbs";
import type { ActionView } from "@/lib/agents/teammate-thread";

/** One event of POST /api/sidekick/chat/stream (see that route's header). */
export type StreamEvent =
  | { type: "user_message"; message: { id: string; content?: string; createdAt?: string } }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string; input?: Record<string, unknown> | null }
  | { type: "tool_result"; name: string; isError?: boolean; state?: "ran" | "failed" | "waiting"; title?: string }
  /** A request waiting for the person: its card (follow-up 1.5c). */
  | { type: "approval"; action: ActionView }
  | {
      type: "done";
      message: { id: string; content: string; toolCalls?: Array<{ name: string; input?: unknown }> | null; createdAt?: string };
      /** The saved card row for this turn's waiting requests, if any. */
      approval?: { id: string; actionIds: string[]; createdAt?: string } | null;
    }
  | { type: "error"; message?: string };

/**
 * Split an SSE buffer into complete events and the unfinished tail. Events
 * are separated by a blank line; each carries one `data:` line of JSON. A
 * malformed event is skipped rather than ending the stream. `E` is the
 * stream's own event union (an AI teammate's chat reads TeammateStreamEvent);
 * Ask AI's is the default. Only the `type` string is checked here, so the
 * caller reads each event by its type.
 */
export function splitSse<E extends { type: string } = StreamEvent>(buffer: string): { events: E[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const events: E[] = [];
  for (const part of parts) {
    const line = part.split(/\r?\n/).find((l) => l.startsWith("data:"));
    if (!line) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const evt = JSON.parse(payload) as E;
      if (evt && typeof evt === "object" && typeof (evt as { type?: unknown }).type === "string") events.push(evt);
    } catch {
      /* a malformed event: skip it */
    }
  }
  return { events, rest };
}

export interface AiToolCall {
  name: string;
  input: Record<string, unknown> | null;
  /** Known once the turn is saved; null while it streams. */
  outcome: ToolOutcome | null;
  /** From the stream's tool_result, before the saved log arrives. */
  failed: boolean;
  /** Still running (tool_use seen, no tool_result yet). */
  pending: boolean;
  durationMs: number | null;
}

export interface AiMessage {
  id: string;
  /** SYSTEM: a row of the chat's own, never a turn (`kind` says which). */
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  toolCalls: AiToolCall[];
  createdAt: string;
  /** The answer is still arriving. */
  streaming?: boolean;
  /** A SYSTEM row: the card for requests waiting for the person, or a decision's line (follow-up 1.5c). */
  kind?: "APPROVAL" | "EVENT";
  /** An APPROVAL row's requests, in the order asked. */
  actionIds?: string[];
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** One saved call-log entry ({ name, input, result, errorText, durationMs }) as a row. */
export function callFromLog(entry: unknown): AiToolCall | null {
  const e = rec(entry);
  if (!e || typeof e.name !== "string") return null;
  const hasResult = "result" in e || "errorText" in e;
  const outcome = hasResult ? toolOutcome(e.name, e.result, typeof e.errorText === "string" ? e.errorText : null) : null;
  return {
    name: e.name,
    input: rec(e.input),
    outcome,
    failed: outcome?.failed ?? false,
    pending: false,
    durationMs: typeof e.durationMs === "number" ? e.durationMs : null,
  };
}

/** The request ids an APPROVAL row's meta names, as strings, at most 50. */
export function actionIdsOf(meta: unknown): string[] {
  const ids = rec(meta)?.actionIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 50) : [];
}

/**
 * A message from GET /api/sidekick/sessions/[id]: the user and assistant
 * turns, and the chat's own SYSTEM rows Ask AI draws (an approval card, a
 * decision's line). Any other row is left out.
 */
export function messageFromApi(m: { id: string; role: string; content: string; toolCalls?: unknown; createdAt: string; kind?: string | null; meta?: unknown }): AiMessage | null {
  if (m.role === "SYSTEM") {
    const base = { id: m.id, role: "SYSTEM" as const, content: m.content ?? "", toolCalls: [], createdAt: String(m.createdAt) };
    if (m.kind === "APPROVAL") {
      const actionIds = actionIdsOf(m.meta);
      return actionIds.length > 0 ? { ...base, kind: "APPROVAL", actionIds } : null;
    }
    return m.kind === "EVENT" ? { ...base, kind: "EVENT" } : null;
  }
  if (m.role !== "USER" && m.role !== "ASSISTANT") return null;
  const calls = Array.isArray(m.toolCalls) ? m.toolCalls.map(callFromLog).filter((c): c is AiToolCall => c !== null) : [];
  return { id: m.id, role: m.role, content: m.content ?? "", toolCalls: calls, createdAt: String(m.createdAt) };
}

/** The chat's last turn: the last user or assistant message, past any card or line after it. */
export function lastTurn(messages: readonly AiMessage[]): AiMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role !== "SYSTEM") return messages[i];
  return null;
}

/** tool_use: a new pending row. */
export function withToolUse(calls: AiToolCall[], name: string, input: Record<string, unknown> | null | undefined): AiToolCall[] {
  return [...calls, { name, input: input ?? null, outcome: null, failed: false, pending: true, durationMs: null }];
}

/**
 * tool_result: settle the most recent pending row of that tool. A call that
 * waits for the person (`waiting`, with its card's title) reads as waiting
 * at once ("Would send kudos to Max"), never as done.
 */
export function withToolResult(calls: AiToolCall[], name: string, isError: boolean, waiting?: { title?: string | null } | null): AiToolCall[] {
  const next = [...calls];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].name === name && next[i].pending) {
      const outcome = waiting && !isError ? toolOutcome(name, { status: "waiting_for_approval", title: waiting.title ?? undefined }) : next[i].outcome;
      next[i] = { ...next[i], pending: false, failed: isError, outcome };
      return next;
    }
  }
  return next;
}

/**
 * done: the saved turn replaces the streamed one. Its text is the saved text
 * (the stream route keeps the final iteration's words), and its calls keep
 * what the stream already learnt (which failed), since the done event names
 * the calls without their results.
 */
export function settleDone(live: AiMessage, saved: { id: string; content: string; toolCalls?: Array<{ name: string; input?: unknown }> | null; createdAt?: string }): AiMessage {
  const savedCalls = Array.isArray(saved.toolCalls) ? saved.toolCalls : [];
  const calls: AiToolCall[] = savedCalls.length > 0
    ? savedCalls.map((c, i) => {
        const was = live.toolCalls[i];
        const same = was && was.name === c.name;
        return {
          name: c.name,
          input: rec(c.input),
          outcome: same ? was.outcome : null,
          failed: same ? was.failed : false,
          pending: false,
          durationMs: same ? was.durationMs : null,
        };
      })
    : live.toolCalls.map((c) => ({ ...c, pending: false }));
  return {
    id: saved.id,
    role: "ASSISTANT",
    // An empty saved text (the model answered only with tools) keeps what
    // streamed rather than blanking the turn.
    content: saved.content || live.content,
    toolCalls: calls,
    createdAt: saved.createdAt ? String(saved.createdAt) : live.createdAt,
    streaming: false,
  };
}

/** The title the server gives an untitled chat from its first message. */
export function titleFromFirstMessage(text: string): string {
  const t = text.trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/**
 * The page context a chat carries (productContext / boardContext), from the
 * first two segments of the page it was started on. /sidekick itself carries
 * none: the page is the assistant, not a place in the workspace.
 */
export function contextFromPath(pathname: string | null | undefined): { productContext?: string; boardContext?: string } {
  if (!pathname || pathname === "/") return {};
  const parts = pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] === "sidekick") return {};
  const out: { productContext?: string; boardContext?: string } = {};
  if (parts[0]) out.productContext = parts[0].slice(0, 80);
  if (parts[1]) out.boardContext = parts[1].slice(0, 80);
  return out;
}

/**
 * Whether a saved assistant turn is the stream route's apology for a model
 * error ("Sorry, I hit an error reaching the model." plus the raw error).
 * The saved text is kept as it is; the thread reads it as a turn that
 * stopped instead of printing a provider's error to the person.
 */
export function isStoppedAnswer(content: string): boolean {
  return /^Sorry(,| \u2014) I hit an error reaching the model\./.test(content.trim());
}

/**
 * A saved chat whose last turn is a question with no answer after it: the
 * answer broke off before the server saved it, or (when the question is a
 * couple of minutes old at most) is still being written. Null while an
 * answer is arriving in this tab, or when the chat ends in an answer.
 */
export function unansweredQuestion(
  messages: readonly AiMessage[],
  opts: { streaming: boolean; now?: number },
): { text: string; recent: boolean } | null {
  if (opts.streaming || messages.length === 0) return null;
  const last = lastTurn(messages);
  if (!last || last.role !== "USER") return null;
  const at = new Date(last.createdAt).getTime();
  const now = opts.now ?? Date.now();
  return { text: last.content, recent: Number.isFinite(at) && now - at < 2 * 60_000 };
}

/**
 * A prompt put in the composer (a starter, ?q=, Ask again, a page's Ask AI
 * button) goes above what the composer already holds, never in place of it,
 * and only once when the same prompt arrives again. Into an empty composer it
 * goes as given, so a starter that ends in a space waits for the rest.
 */
export function withPromptAbove(held: string, prompt: string): string {
  if (!prompt.trim()) return held;
  if (!held.trim()) return prompt;
  const q = prompt.trimEnd();
  if (held.trim() === q.trim() || held.startsWith(`${q}\n\n`)) return held;
  return `${q}\n\n${held}`;
}

/**
 * What the composer holds after a turn failed; `text` is the person's words
 * (null for a continue). When the server never had the message its bubble
 * leaves the thread, so the words always come back: above anything typed
 * since the send, a blank line between, never in place of it. When the
 * server has it, the bubble stays and the words come back only to an empty
 * composer.
 */
export function draftAfterFailure(draft: string, text: string | null, serverHas: boolean): string {
  if (text === null) return draft;
  if (serverHas) return draft || text;
  if (!draft.trim() || draft === text) return text;
  return `${text}\n\n${draft}`;
}
