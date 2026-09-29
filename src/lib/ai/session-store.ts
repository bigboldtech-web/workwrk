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
//   - the draft follows the chat between the panel and the page.
//
// SAVE PATH, unchanged from before this store: a chat is created lazily on
// the first send (POST /api/sidekick/sessions), the stream route writes the
// question before it opens the stream and the answer after it closes. This
// file only reads what the route sends. When a send fails before the server
// has the question, the question leaves the thread and comes back to the
// composer; when it fails after, the question stays in the thread and the
// text comes back to the composer as well, so nothing typed is ever lost.
//
// Offline and a lapsed session are the shell's: JSON calls go through
// apiFetch (which raises the session-expired dialog and the offline strip);
// the stream is a raw fetch, so it raises both itself.

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { markSessionExpired, OFFLINE_EVENT, ONLINE_EVENT } from "@/lib/session-expiry";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import {
  messageFromApi,
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
 */
export type AiSendError = "not_sent" | "stopped" | "start_failed" | "agent_off" | "gone";

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
  draft: string;
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
  draft: "",
  agent: null,
  status: null,
  offline: false,
};

let state: AiSessionState = INITIAL;
const listeners = new Set<() => void>();
// Every reset, open or start bumps the generation; a stream or a load that
// belongs to an older generation stops writing into the store.
let generation = 0;
let streamAbort: AbortController | null = null;
let statusInflight: Promise<void> | null = null;
let windowBound = false;

function set(patch: Partial<AiSessionState> | ((s: AiSessionState) => Partial<AiSessionState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function bindWindow() {
  if (windowBound || typeof window === "undefined") return;
  windowBound = true;
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

/** Back to the landing. The draft goes too unless `keepDraft`. */
function reset(opts: { keepDraft?: boolean } = {}) {
  detach();
  set((s) => ({
    ...INITIAL,
    status: s.status,
    offline: s.offline,
    draft: opts.keepDraft ? s.draft : "",
  }));
}

/** Show a saved chat. */
async function open(id: string): Promise<void> {
  if (state.sessionId === id && !state.loadError && !state.missing) return;
  detach();
  const gen = generation;
  set((s) => ({ ...INITIAL, status: s.status, offline: s.offline, sessionId: id, loading: true }));
  const r = await apiFetch<{ session: AiSessionMeta; messages: Array<{ id: string; role: string; content: string; toolCalls?: unknown; createdAt: string }> }>(
    `/api/sidekick/sessions/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (gen !== generation) return;
  if (!r.ok) {
    set({ loading: false, loadError: r.status !== 404, missing: r.status === 404 });
    return;
  }
  set({
    loading: false,
    meta: {
      id: r.data.session.id,
      title: r.data.session.title,
      pinned: r.data.session.pinned,
      archived: Boolean(r.data.session.archived),
    },
    messages: r.data.messages.map(messageFromApi).filter((m): m is AiMessage => m !== null),
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
  const r = await apiFetch<{ session: AiSessionMeta; messages: Array<{ id: string; role: string; content: string; toolCalls?: unknown; createdAt: string }> }>(
    `/api/sidekick/sessions/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (gen !== generation || state.streaming || !r.ok) return false;
  const messages = r.data.messages.map(messageFromApi).filter((m): m is AiMessage => m !== null);
  set((s) => ({
    messages,
    meta: s.meta ? { ...s.meta, title: r.data.session.title ?? s.meta.title, pinned: r.data.session.pinned, archived: Boolean(r.data.session.archived) } : s.meta,
  }));
  return messages.length > 0 && messages[messages.length - 1].role === "ASSISTANT";
}

/**
 * A new chat: the landing, optionally bound to an agent, optionally with
 * `q` (?q=, a caller's prompt) waiting in the composer. It is NEVER sent
 * on arrival: a link anyone can post would otherwise run write tools as
 * whoever opened it. The person reads it and presses Send.
 */
async function start(opts: { agentSlug?: string | null; q?: string | null } = {}): Promise<void> {
  reset();
  if (opts.q && opts.q.trim()) set({ draft: opts.q.trim() });
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

/** Send one message: create the chat on the first send, then stream the answer. */
async function send(raw: string, context?: ChatContext): Promise<void> {
  const text = raw.trim();
  if (!text || state.streaming) return;
  if (state.meta?.archived) return;
  const gen = generation;
  set({ error: null, streaming: true, draft: "" });

  let sessionId = state.sessionId;
  if (!sessionId) {
    const body: Record<string, unknown> = { ...(context ?? {}) };
    if (state.agent) body.agentSlug = state.agent.slug;
    const r = await apiFetch<{ session: { id: string; title: string | null } }>("/api/sidekick/sessions", { method: "POST", json: body });
    if (gen !== generation) return;
    if (!r.ok) {
      set({
        streaming: false,
        draft: text,
        error: r.status === 404 && state.agent ? "agent_off" : r.offline ? "not_sent" : "start_failed",
      });
      return;
    }
    sessionId = r.data.session.id;
    set({ sessionId, meta: { id: sessionId, title: r.data.session.title, pinned: false, archived: false } });
  }

  const now = new Date().toISOString();
  const userTempId = `opt-user-${Date.now()}`;
  const aiTempId = `streaming-${Date.now()}`;
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
  let sawError = false;
  let sawDone = false;
  const fail = (kind: AiSendError) => {
    if (gen !== generation) return;
    if (serverHasMessage && kind === "stopped" && sessionId) {
      // The route saves the answer even after the connection drops, so read
      // the chat again before offering Try again (which would ask twice).
      const id = sessionId;
      window.setTimeout(() => {
        void refresh(id).then((answered) => {
          if (!answered || gen !== generation) return;
          set((s) => ({ error: s.error === "stopped" ? null : s.error, draft: s.draft === text ? "" : s.draft }));
        });
      }, 2500);
    }
    if (serverHasMessage) {
      // The question is saved: keep it, drop an answer that never started,
      // keep the tool rows of one that did.
      set((s) => ({
        error: kind,
        draft: s.draft || text,
        messages: s.messages
          .filter((m) => m.id !== aiTempId || m.content.length > 0 || m.toolCalls.length > 0)
          .map((m) => (m.id === aiTempId ? { ...m, streaming: false, toolCalls: m.toolCalls.map((c) => ({ ...c, pending: false })) } : m)),
      }));
    } else {
      set((s) => ({
        error: kind,
        draft: s.draft || text,
        messages: s.messages.filter((m) => m.id !== userTempId && m.id !== aiTempId),
      }));
    }
  };

  const ctrl = new AbortController();
  streamAbort = ctrl;
  try {
    const res = await fetch("/api/sidekick/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
      signal: ctrl.signal,
    });
    if (res.status === 401) markSessionExpired({ reason: "expired" });
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
          patchLive((m) => ({ ...m, toolCalls: withToolResult(m.toolCalls, evt.name, Boolean(evt.isError)) }));
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
    if (gen !== generation) return;
    const aborted = e instanceof DOMException && e.name === "AbortError";
    if (!aborted && typeof window !== "undefined" && navigator.onLine === false) {
      window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
    }
    fail(serverHasMessage ? "stopped" : "not_sent");
  } finally {
    if (streamAbort === ctrl) streamAbort = null;
    if (gen === generation) set({ streaming: false });
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
