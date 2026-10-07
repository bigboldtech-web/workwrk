"use client";

// useAiSession: the ONE Ask AI session per browser tab (spec-ai-automation
// section 3, and section 2 "The one session rule").
//
// The /sidekick page and the Ask AI panel both render this store, and
// nothing else holds chat state. So:
//   - opening /sidekick while the panel has a live chat shows that same chat
//     (the shell closes the panel on /sidekick, so two threads are never on
//     screen);
//   - closing the panel does not end the chat, reopening resumes it;
//   - "Open full page" lands on ?session=<id> and the answer keeps arriving,
//     because the stream lives here, not in a component that unmounts;
//   - the draft follows the chat between the panel and the page, and each
//     chat keeps its own unsent words while the tab is open (drafts below).
//
// SAVE PATH, unchanged from before this store: a chat is created lazily on
// the first send (POST /api/sidekick/sessions), the stream route writes the
// question before it opens the stream and the answer after it closes. This
// file only reads what the route sends. When a send fails before the server
// has the question, the question leaves the thread and comes back to the
// composer, above anything typed since the send; when it fails after, the
// question stays in the thread and the text comes back to an empty composer
// as well (thread.ts draftAfterFailure), so nothing typed is ever lost.
//
// Offline and a lapsed session are the shell's: JSON calls go through
// apiFetch (which raises the session-expired dialog and the offline strip);
// the stream is a raw fetch, so it raises both itself.

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { markSessionExpired, OFFLINE_EVENT, ONLINE_EVENT } from "@/lib/session-expiry";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { sendDecisions } from "@/lib/agents/decide-client";
import { applyDecisionResults, type ActionView, type DecideAnswer, type TeammateDecision } from "@/lib/agents/teammate-thread";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import {
  answeredIn,
  draftAfterFailure,
  messageFromApi,
  threadOrder,
  withPromptAbove,
  settleDone,
  splitSse,
  titleFromFirstMessage,
  withToolResult,
  withToolUse,
  type AiMessage,
} from "@/lib/ai/thread";

export type { AiMessage, AiToolCall } from "@/lib/ai/thread";

export interface AiStatus {
  /** AI features for members (settings.data.aiEnabled) and the ai app key. */
  enabled: boolean;
  /** An AI key exists: the workspace's own or the shared one. */
  configured: boolean;
}

/**
 *   not_sent      the question never reached the server; it is back in the composer
 *   stopped       the server has the question and the answer broke off
 *   start_failed  the chat could not be created
 *   agent_off     ?agent= named an agent that is not turned on
 *   gone          the chat was archived or removed (elsewhere) before this
 *                 send; the text is back in the composer for a new chat
 *   ai_limit      the workspace has used all its plan's AI questions; the
 *                 server's sentence (errorText) says what to do
 *   rate_limited  too many AI requests in a minute; errorText says when
 */
export type AiSendError = "not_sent" | "stopped" | "start_failed" | "agent_off" | "gone" | "ai_limit" | "rate_limited";

export interface AiSessionMeta {
  id: string;
  title: string | null;
  pinned: boolean;
  archived: boolean;
}

export interface AiSessionState {
  sessionId: string | null;
  meta: AiSessionMeta | null;
  messages: AiMessage[];
  streaming: boolean;
  /** The thread is loading (open(id)). */
  loading: boolean;
  /** The thread failed to load; Try again calls open(id) again. */
  loadError: boolean;
  /** The chat asked for does not exist, or is not the viewer's. */
  missing: boolean;
  error: AiSendError | null;
  /** The server's own sentence for ai_limit and rate_limited. */
  errorText: string | null;
  draft: string;
  /** The requests this chat's approval cards name, as the cards show them (follow-up 1.5c). */
  actions: Record<string, ActionView>;
  /** The requests being approved or denied now. */
  deciding: Record<string, "approve" | "deny">;
  /** The question whose answer broke off ("The answer stopped"), by its saved id, and its words: any read that finds its answer clears the error. */
  stopped: { id: string; text: string } | null;
  /** The agent the next new chat is bound to (?agent=<slug>). */
  agent: { slug: string; name: string | null; examplePrompts?: string[] } | null;
  status: AiStatus | null;
  offline: boolean;
}

const INITIAL: AiSessionState = {
  sessionId: null,
  meta: null,
  messages: [],
  streaming: false,
  loading: false,
  loadError: false,
  missing: false,
  error: null,
  errorText: null,
  draft: "",
  actions: {},
  deciding: {},
  stopped: null,
  agent: null,
  status: null,
  offline: false,
};

let state: AiSessionState = INITIAL;
/** Counts sends, so each one's local row ids are its own. */
let tempSeq = 0;
// The realtime key Ask AI's own requests are published under (actions.ts ASK_AI_KEY).
const ASK_AI_KEY = "ask-ai";
const listeners = new Set<() => void>();
// Every reset, open or start bumps the generation; a stream or a load that
// belongs to an older generation stops writing into the store.
let generation = 0;
let streamAbort: AbortController | null = null;
let statusInflight: Promise<void> | null = null;
let windowBound = false;
// One draft per chat in this tab. Leaving a chat with words in its composer
// (opening another, or a new chat) keeps them here, and coming back to that
// chat brings them back, as an AI teammate's chat does. "" is the landing's:
// a new chat not made yet.
const drafts = new Map<string, string>();

/**
 * The key the open chat's words are kept under: its id, or the landing's
 * ("") for a chat with nothing saved in it yet (no list shows such a chat,
 * so words kept under its id could never be opened again).
 */
function draftKey(): string {
  const id = state.sessionId;
  if (!id) return "";
  // Only rows the server holds count: a first message still in flight shows
  // its local bubbles, but no list shows the chat until the server has it.
  const empty = !state.messages.some((m) => !isLocalRow(m.id)) && !state.loading && !state.loadError && !state.missing;
  return empty ? "" : id;
}

/** The ids of the rows a send shows before the server has them (its question, its live answer, its card). */
const LOCAL_ROW = /^(opt-user-|streaming-|card-)/;

function isLocalRow(id: string): boolean {
  return LOCAL_ROW.test(id);
}

/** Keep the open chat's unsent words for when it is opened again, beside any kept before. */
function stashDraft(): void {
  const key = draftKey();
  const now = state.draft.trim() ? state.draft : "";
  const before = drafts.get(key) ?? "";
  const kept = now && before && now !== before ? `${now}\n\n${before}` : now || before;
  if (kept) drafts.set(key, kept);
  else drafts.delete(key);
}

/**
 * Words a send gave up on because the person moved to another chat before
 * the server had them: back in the composer when the chat they were sent
 * from is the one showing, else kept for it, above anything kept before.
 */
function keepUnsent(key: string, text: string): void {
  if (draftKey() === key) {
    set((s) => ({ draft: draftAfterFailure(s.draft, text, false) }));
    return;
  }
  drafts.set(key, draftAfterFailure(drafts.get(key) ?? "", text, false));
}

/** How long after giving up on a send that had left the chat is read to see whether the server took it. */
const UNSENT_CHECK_MS = 2500;

/**
 * Words a send gave up on AFTER its request left: the server may hold the
 * question already (the stream route saves it first and carries on when the
 * client goes), so a moment later the chat is read again and only words it
 * does not hold come back (keepUnsent). The question counts as taken when
 * the chat now holds a question with these words that was not in it when
 * the request left (`before`, by id: no clock, the browser's or the
 * server's, is compared). A read that fails gives them back: seeing them
 * twice is better than losing them.
 */
function keepUnlessSaved(chatId: string, key: string, text: string, before: ReadonlySet<string>): void {
  setTimeout(() => {
    void apiFetch<SessionRead>(`/api/sidekick/sessions/${encodeURIComponent(chatId)}`, { cache: "no-store" }).then((r) => {
      const saved = r.ok && r.data.messages.some((m) => m.role === "USER" && (m.content ?? "").trim() === text && !before.has(m.id));
      if (!saved) keepUnsent(key, text);
    });
  }, UNSENT_CHECK_MS);
}

/** A chat's kept words, handed back once. */
function takeDraft(key: string): string {
  const d = drafts.get(key) ?? "";
  drafts.delete(key);
  return d;
}

function set(patch: Partial<AiSessionState> | ((s: AiSessionState) => Partial<AiSessionState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function bindWindow() {
  if (windowBound || typeof window === "undefined") return;
  windowBound = true;
  // A card of this chat decided in another tab, or expired: read it again.
  window.addEventListener(WINDOW_EVENTS.realtime, (e) => {
    const ev = (e as CustomEvent<RealtimeEvent>).detail;
    if (ev?.type !== "agent.changed" || ev.agentId !== ASK_AI_KEY) return;
    if (state.sessionId && state.messages.some((m) => m.kind === "APPROVAL")) void refresh(state.sessionId);
  });
  const off = () => set({ offline: true });
  const on = () => set({ offline: false });
  window.addEventListener(OFFLINE_EVENT, off);
  window.addEventListener(ONLINE_EVENT, on);
  window.addEventListener("offline", off);
  window.addEventListener("online", on);
  if (navigator.onLine === false) state = { ...state, offline: true };
}

function subscribe(l: () => void) {
  bindWindow();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/* ─────────────────────────── actions ─────────────────────────── */

/** Read whether Ask AI can answer. Cheap; `force` re-reads an answer already held. */
function loadStatus(force = false): Promise<void> {
  if (!force && state.status) return Promise.resolve();
  if (statusInflight) return statusInflight;
  statusInflight = apiFetch<AiStatus>("/api/ai/status", { cache: "no-store" }).then((r) => {
    statusInflight = null;
    if (r.ok) set({ status: r.data });
    // 403 is app_off (the app hidden, or AI features off): the honest "off".
    else if (r.status === 403) set({ status: { enabled: false, configured: true } });
    // A network failure says nothing about the workspace: keep what we knew,
    // and let the composer try (the offline strip already explains).
    else if (!state.status) set({ status: { enabled: true, configured: true } });
  });
  return statusInflight;
}

function detach() {
  generation++;
  if (streamAbort) {
    // The server keeps going and saves the turn (the route persists after a
    // client disconnect); this only stops the store from listening.
    try { streamAbort.abort(); } catch { /* already done */ }
    streamAbort = null;
  }
}

/**
 * Back to the landing. The open chat's words are kept for it and the
 * landing's own come back, unless `keepDraft`: then the words move to the
 * new chat with the person (Start a new chat with it) instead.
 */
function reset(opts: { keepDraft?: boolean } = {}) {
  if (!opts.keepDraft) stashDraft();
  detach();
  const draft = opts.keepDraft ? state.draft : takeDraft("");
  set((s) => ({
    ...INITIAL,
    status: s.status,
    offline: s.offline,
    draft,
  }));
}

/** Show a saved chat. */
async function open(id: string): Promise<void> {
  if (state.sessionId === id && !state.loadError && !state.missing) return;
  // Opening it again after a failed load keeps what is in the composer.
  const same = state.sessionId === id;
  if (!same) stashDraft();
  detach();
  const gen = generation;
  const draft = same ? state.draft : takeDraft(id);
  set((s) => ({ ...INITIAL, status: s.status, offline: s.offline, sessionId: id, loading: true, draft }));
  const r = await apiFetch<SessionRead>(`/api/sidekick/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (gen !== generation) return;
  if (!r.ok) {
    set({ loading: false, loadError: r.status !== 404, missing: r.status === 404 });
    return;
  }
  set({
    loading: false,
    actions: r.data.actions ?? {},
    meta: {
      id: r.data.session.id,
      title: r.data.session.title,
      pinned: r.data.session.pinned,
      archived: Boolean(r.data.session.archived),
    },
    messages: threadOrder(r.data.messages.map(messageFromApi).filter((m): m is AiMessage => m !== null)),
  });
}

/**
 * Re-read the open chat in place (no skeleton): after an answer broke off,
 * the server may still have saved the whole of it. Resolves true when the
 * chat now ends in an answer. Never runs while an answer is arriving.
 */
async function refresh(id: string): Promise<boolean> {
  if (state.sessionId !== id || state.streaming) return false;
  const gen = generation;
  const r = await apiFetch<SessionRead>(`/api/sidekick/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (gen !== generation || state.streaming || !r.ok) return false;
  const fresh = threadOrder(r.data.messages.map(messageFromApi).filter((m): m is AiMessage => m !== null));
  const answered = state.stopped !== null && answeredIn(fresh, state.stopped.id);
  set((s) => ({
    // The server can be behind a turn this tab already drew: an answer that
    // broke off is saved, with its card, only when the route's loop ends.
    // Each question the server does not hold an answer to keeps, right after
    // it, the rows this tab drew for it (its tool rows, its card).
    messages: withUnsaved(s.messages, fresh),
    actions: { ...s.actions, ...(r.data.actions ?? {}) },
    meta: s.meta ? { ...s.meta, title: r.data.session.title ?? s.meta.title, pinned: r.data.session.pinned, archived: Boolean(r.data.session.archived) } : s.meta,
    // The answer that broke off is saved now: "The answer stopped" is no longer true.
    ...(answered && s.stopped
      ? { stopped: null, error: s.error === "stopped" ? null : s.error, draft: s.draft === s.stopped.text ? "" : s.draft }
      : {}),
  }));
  return answered;
}

/**
 * The server's thread with, after each question it holds no answer to, the
 * rows this tab drew for that question and the server has not saved yet
 * (local ids: the live answer, its card). A question this tab drew rows for
 * is matched by its saved id, so no row lands under another question.
 */
function withUnsaved(local: readonly AiMessage[], fresh: readonly AiMessage[]): AiMessage[] {
  const drawn = new Map<string, AiMessage[]>();
  let question: string | null = null;
  for (const m of local) {
    if (m.role === "USER") question = isLocalRow(m.id) ? null : m.id;
    else if (question && isLocalRow(m.id)) drawn.set(question, [...(drawn.get(question) ?? []), m]);
  }
  if (drawn.size === 0) return [...fresh];
  const out: AiMessage[] = [];
  for (const m of fresh) {
    out.push(m);
    const rows = m.role === "USER" ? drawn.get(m.id) : undefined;
    if (rows && !answeredIn(fresh, m.id)) out.push(...rows);
  }
  return out;
}

/** Whether the open thread shows rows the server has not saved yet under a question it holds. */
function hasUnsaved(): boolean {
  let question = false;
  for (const m of state.messages) {
    if (m.role === "USER") question = !isLocalRow(m.id);
    else if (question && isLocalRow(m.id)) return true;
  }
  return false;
}

/** How long to wait before each read again of a thread with unsaved rows: soon, then once a minute. */
const WATCH_MS = [2_500, 10_000, 30_000, 60_000];
/** Read again for at most this long: the route's model calls time out within it. */
const WATCH_FOR_MS = 10 * 60_000;
let watching: object | null = null;

/**
 * While the open chat shows rows the server has not saved (an answer that
 * broke off, its card) or an answer marked stopped, read it again, soon and
 * then once a minute, for up to WATCH_FOR_MS: the saved turn replaces the
 * drawn one and clears "The answer stopped" whenever it arrives. One watcher
 * per chat view; it ends when nothing is left to wait for, when the person
 * opens another chat, or after WATCH_FOR_MS.
 */
function watchUnsaved(): void {
  const id = state.sessionId;
  if (!id) return;
  const me = { gen: generation, startedAt: Date.now() };
  if (watching && (watching as { gen: number }).gen === generation) return;
  watching = me;
  const step = (i: number) => {
    setTimeout(() => {
      const over = me.gen !== generation || state.sessionId !== id || Date.now() - me.startedAt > WATCH_FOR_MS || (!hasUnsaved() && !state.stopped);
      if (watching !== me || over) {
        if (watching === me) watching = null;
        return;
      }
      void refresh(id).finally(() => step(i + 1));
    }, WATCH_MS[Math.min(i, WATCH_MS.length - 1)]);
  };
  step(0);
}

/**
 * A new chat: the landing, optionally bound to an agent, optionally with
 * `q` (?q=, a caller's prompt) waiting in the composer. It is NEVER sent
 * on arrival: a link anyone can post would otherwise run write tools as
 * whoever opened it. The person reads it and presses Send.
 */
async function start(opts: { agentSlug?: string | null; q?: string | null } = {}): Promise<void> {
  reset();
  const q = opts.q?.trim();
  // The caller's prompt goes above any words the landing kept, never in
  // place of them, and only once when the same prompt arrives again.
  if (q) set((s) => ({ draft: withPromptAbove(s.draft, q) }));
  const gen = generation;
  if (opts.agentSlug) {
    set({ agent: { slug: opts.agentSlug, name: null } });
    const r = await apiFetch<{ installed: Array<{ slug: string; name: string; status: string; examplePrompts?: string[] }> }>("/api/agents", { cache: "no-store" });
    if (gen !== generation) return;
    const found = r.ok ? r.data.installed.find((a) => a.slug === opts.agentSlug && a.status === "ENABLED") : null;
    if (r.ok && !found) {
      set({ agent: null, error: "agent_off" });
      return;
    }
    if (found) set({ agent: { slug: found.slug, name: found.name, examplePrompts: found.examplePrompts ?? [] } });
  }
}

export interface ChatContext {
  productContext?: string;
  boardContext?: string;
}

/** GET /api/sidekick/sessions/[id]: the chat, its rows, and the requests its cards name. */
interface SessionRead {
  session: AiSessionMeta;
  messages: Array<{ id: string; role: string; content: string; toolCalls?: unknown; createdAt: string; kind?: string | null; meta?: unknown }>;
  actions?: Record<string, ActionView>;
}

/** Send one message: create the chat on the first send, then stream the answer. */
async function send(raw: string, context?: ChatContext): Promise<void> {
  const text = raw.trim();
  // Never while the chat is still loading, or when it could not load: the
  // load would replace the thread under the send, or the thread stays hidden
  // behind "Couldn't load this chat", and the question the server took would
  // never show. Try again loads it, and the words wait in the composer.
  if (!text || state.streaming || state.loading || state.loadError) return;
  if (state.meta?.archived) return;
  const gen = generation;
  // Where the words go back if this send is given up after the person moved
  // on: the chat it was sent from, or the landing for a chat not made yet.
  const homeKey = draftKey();
  let given = false;
  // Set when the stream request leaves: from then on the server may have it.
  let sent: { chatId: string; before: ReadonlySet<string> } | null = null;
  const giveBack = () => {
    if (given) return;
    given = true;
    if (sent) keepUnlessSaved(sent.chatId, homeKey, text, sent.before);
    else keepUnsent(homeKey, text);
  };
  // The composer empties only when it held what is sent: a starter sent
  // while other words wait in it leaves them there.
  set((s) => ({ error: null, stopped: null, streaming: true, draft: s.draft.trim() === text ? "" : s.draft }));

  let sessionId = state.sessionId;
  if (!sessionId) {
    const body: Record<string, unknown> = { ...(context ?? {}) };
    if (state.agent) body.agentSlug = state.agent.slug;
    const r = await apiFetch<{ session: { id: string; title: string | null } }>("/api/sidekick/sessions", { method: "POST", json: body });
    if (gen !== generation) {
      // The person opened another chat while this one was being made: the
      // question was never sent, so its words are kept for the landing.
      giveBack();
      return;
    }
    if (!r.ok) {
      // Typed more while the chat was being made: both stay (draftAfterFailure).
      set((s) => ({
        streaming: false,
        draft: draftAfterFailure(s.draft, text, false),
        error: r.status === 404 && state.agent ? "agent_off" : r.offline ? "not_sent" : "start_failed",
      }));
      return;
    }
    sessionId = r.data.session.id;
    set({ sessionId, meta: { id: sessionId, title: r.data.session.title, pinned: false, archived: false } });
  }

  const now = new Date().toISOString();
  // Unique per send, never the clock alone: two sends in one millisecond
  // must never share a row.
  const turnSeq = `${Date.now()}-${++tempSeq}`;
  const userTempId = `opt-user-${turnSeq}`;
  const aiTempId = `streaming-${turnSeq}`;
  // The card for what this turn asks the person, below its answer, from the
  // first approval event until the saved row's id arrives with done.
  const cardTempId = `card-${turnSeq}`;
  set((s) => ({
    messages: [
      ...s.messages,
      { id: userTempId, role: "USER", content: text, toolCalls: [], createdAt: now },
      { id: aiTempId, role: "ASSISTANT", content: "", toolCalls: [], createdAt: now, streaming: true },
    ],
  }));

  const patchLive = (fn: (m: AiMessage) => AiMessage) => {
    if (gen !== generation) return;
    set((s) => ({ messages: s.messages.map((m) => (m.id === aiTempId ? fn(m) : m)) }));
  };

  let serverHasMessage = false;
  /** The question's saved id, from the stream's user_message event. */
  let ackedId: string | null = null;
  let sawError = false;
  let sawDone = false;
  const fail = (kind: AiSendError) => {
    if (gen !== generation) {
      // Moved on before the server had it: the words are kept, never dropped.
      if (!serverHasMessage) giveBack();
      return;
    }
    if (serverHasMessage && kind === "stopped" && ackedId) {
      // The route saves the answer even after the connection drops, but only
      // when its loop ends, so the chat is read again until it is there
      // (Try again would ask twice): watchUnsaved, and any other read, clears
      // the error once the server holds the answer to this question.
      const question = { id: ackedId, text };
      set({ stopped: question });
      watchUnsaved();
    }
    if (serverHasMessage) {
      // The question is saved: keep it, drop an answer that never started,
      // keep the tool rows of one that did.
      set((s) => ({
        error: kind,
        draft: draftAfterFailure(s.draft, text, true),
        messages: s.messages
          .filter((m) => m.id !== aiTempId || m.content.length > 0 || m.toolCalls.length > 0)
          .map((m) => (m.id === aiTempId ? { ...m, streaming: false, toolCalls: m.toolCalls.map((c) => ({ ...c, pending: false })) } : m)),
      }));
    } else {
      // The server never had it, so its bubble leaves: the words come back
      // above anything typed since the send, never in place of it.
      set((s) => ({
        error: kind,
        draft: draftAfterFailure(s.draft, text, false),
        messages: s.messages.filter((m) => m.id !== userTempId && m.id !== aiTempId),
      }));
    }
  };

  const ctrl = new AbortController();
  streamAbort = ctrl;
  try {
    // The questions the chat already holds, by id: the check after a give-up
    // looks for one that is not among them.
    sent = { chatId: sessionId, before: new Set(state.messages.filter((m) => m.role === "USER" && !isLocalRow(m.id)).map((m) => m.id)) };
    const res = await fetch("/api/sidekick/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
      signal: ctrl.signal,
    });
    if (res.status === 401) markSessionExpired({ reason: "expired" });
    if (res.status === 403 || res.status === 429) {
      // The plan's AI questions are used up, or too many requests in a
      // minute: the question was not written, and the server says why.
      const refusal = (await res.clone().json().catch(() => null)) as { code?: unknown; error?: unknown } | null;
      if (refusal?.code === "ai_limit" || refusal?.code === "rate_limited") {
        if (gen === generation) set({ errorText: typeof refusal.error === "string" ? refusal.error : null });
        fail(refusal.code);
        return;
      }
    }
    if (res.status === 403) void loadStatus(true);
    if (res.status === 404) {
      // Archived or gone (another tab, All chats): the question was not
      // written. It goes back to the composer, and the thread says why.
      fail("gone");
      return;
    }
    if (!res.ok || !res.body) {
      fail("not_sent");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (gen !== generation) return;
      buffer += decoder.decode(value, { stream: true });
      const parsed = splitSse(buffer);
      buffer = parsed.rest;
      for (const evt of parsed.events) {
        if (evt.type === "user_message") {
          serverHasMessage = true;
          const saved = evt.message;
          if (typeof saved?.id === "string") ackedId = saved.id;
          set((s) => ({
            messages: s.messages.map((m) => (m.id === userTempId ? { ...m, id: saved.id ?? m.id } : m)),
            // The server titles an untitled chat from its first message.
            meta: s.meta && !s.meta.title ? { ...s.meta, title: titleFromFirstMessage(text) } : s.meta,
          }));
        } else if (evt.type === "text_delta") {
          patchLive((m) => ({ ...m, content: m.content + (evt.text ?? "") }));
        } else if (evt.type === "tool_use") {
          patchLive((m) => ({ ...m, toolCalls: withToolUse(m.toolCalls, evt.name, evt.input ?? null) }));
        } else if (evt.type === "tool_result") {
          const waiting = evt.state === "waiting" ? { title: evt.title ?? null } : null;
          patchLive((m) => ({ ...m, toolCalls: withToolResult(m.toolCalls, evt.name, Boolean(evt.isError), waiting) }));
        } else if (evt.type === "approval") {
          const view = evt.action;
          if (gen === generation && view && typeof view.id === "string") {
            set((s) => {
              const has = s.messages.some((m) => m.id === cardTempId);
              const messages: AiMessage[] = has
                ? s.messages.map((m) => (m.id === cardTempId ? { ...m, actionIds: [...(m.actionIds ?? []), view.id] } : m))
                : [...s.messages, { id: cardTempId, role: "SYSTEM", kind: "APPROVAL", content: "", toolCalls: [], createdAt: new Date().toISOString(), actionIds: [view.id] }];
              return { actions: { ...s.actions, [view.id]: view }, messages };
            });
          }
        } else if (evt.type === "error") {
          sawError = true;
        } else if (evt.type === "done") {
          sawDone = true;
          if (sawError) {
            // The route saved an apology with the provider's raw error as
            // the answer. The thread says the answer stopped instead.
            fail("stopped");
          } else {
            patchLive((m) => settleDone(m, evt.message));
          }
          const card = evt.approval;
          if (card && gen === generation) {
            set((s) => ({ messages: s.messages.map((m) => (m.id === cardTempId ? { ...m, id: card.id, actionIds: card.actionIds.length ? card.actionIds : m.actionIds } : m)) }));
          }
        }
      }
    }
    if (gen !== generation) return;
    if (!sawDone) {
      fail(serverHasMessage ? "stopped" : "not_sent");
    } else {
      patchLive((m) => (m.streaming ? { ...m, streaming: false } : m));
    }
  } catch (e) {
    if (gen !== generation) {
      if (!serverHasMessage) giveBack();
      return;
    }
    const aborted = e instanceof DOMException && e.name === "AbortError";
    if (!aborted && typeof window !== "undefined" && navigator.onLine === false) {
      window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
    }
    fail(serverHasMessage ? "stopped" : "not_sent");
  } finally {
    if (streamAbort === ctrl) streamAbort = null;
    if (gen === generation) set({ streaming: false });
    // An earlier answer that broke off may still be unsaved under its own
    // question: keep reading until the server holds it.
    if (gen === generation && hasUnsaved()) watchUnsaved();
    // The sidebar's CHATS section shows the new chat and its title.
    notifyAiChatsChanged();
  }
}

/** Try again after a failure: resend what is in the composer. */
function retry(context?: ChatContext): Promise<void> {
  const text = state.draft;
  if (!text.trim()) return Promise.resolve();
  return send(text, context);
}

function setDraft(draft: string) {
  if (draft !== state.draft) set({ draft });
}

/**
 * Approve or deny requests on this chat's cards (POST
 * /api/agents/actions/decide, the call every card sends). The cards change
 * at once from the answer, then the chat is read again for the decision's
 * line. Ask AI never carries on by itself: it hears the outcome with the
 * person's next message.
 */
async function decide(decisions: TeammateDecision[], opts: { always?: boolean } = {}): Promise<DecideAnswer> {
  if (decisions.length === 0) return { ok: true, results: [] };
  const ids = decisions.map((d) => d.id);
  set((s) => {
    const deciding = { ...s.deciding };
    for (const d of decisions) deciding[d.id] = d.decision;
    return { deciding };
  });
  const r = await sendDecisions(decisions, opts);
  const settle = (s: AiSessionState) => {
    const deciding = { ...s.deciding };
    for (const id of ids) delete deciding[id];
    return deciding;
  };
  if (!r.ok) {
    set((s) => ({ deciding: settle(s) }));
    return { ok: false, error: r.error };
  }
  const at = new Date().toISOString();
  set((s) => ({ deciding: settle(s), actions: applyDecisionResults(s.actions, r.results, at) }));
  notifyAiChatsChanged();
  if (state.sessionId) void refresh(state.sessionId);
  return { ok: true, results: r.results };
}

function clearError() {
  if (state.error) set({ error: null });
}

/** Rename, pin or restore reflected locally after the API said yes. */
function patchMeta(patch: Partial<AiSessionMeta>) {
  set((s) => (s.meta ? { meta: { ...s.meta, ...patch } } : {}));
}

export const aiSession = {
  getState: () => state,
  subscribe,
  loadStatus,
  reset,
  open,
  refresh,
  start,
  send,
  retry,
  setDraft,
  decide,
  clearError,
  patchMeta,
  /** Stop listening to the answer in flight (the server still saves it). */
  stop: detach,
};

/** The one Ask AI session of this tab. */
export function useAiSession(): AiSessionState & typeof aiSession {
  const s = useSyncExternalStore(subscribe, () => state, () => INITIAL);
  return { ...s, ...aiSession };
}
