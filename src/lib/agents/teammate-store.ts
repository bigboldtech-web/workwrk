"use client";

// The client half of a chat with an AI teammate (docs/plans/ai-teammates.md
// 5.3), and the list of teammates the page reads.
//
// useTeammateChat(slug): this person's one chat with one teammate. The state
// lives here, one per teammate per browser tab, not in the component that
// shows it, as Ask AI's does (src/lib/ai/session-store.ts):
//   - switching to another teammate and back keeps the draft, the Practice
//     run switch and an answer that is still arriving (a stream keeps
//     writing into its own chat while another chat is on screen);
//   - a chat already read is read again in place, never with a skeleton.
//
// SEND, Ask AI's rules (session-store.ts send): the person's message shows
// at once. When the server never had it (refused, offline, a stream that
// never opened) it leaves the thread and its words come back to the
// composer, above anything typed while it was out. When the server has it
// (the route saves it before the stream opens, so an open stream means it
// does) and the answer breaks off, it stays, the words come back to an empty
// composer as well, and the chat is read again a moment later: the route
// finishes and saves the turn after a client leaves. The server's own
// sentence shows for ai_limit, agent_cap, rate_limited and a teammate paused
// or removed meanwhile.
//
// DECIDE: the approval card's buttons (POST /api/agents/actions/decide). The
// cards change at once from the answer, the chat is read again for the
// decision's line, and when something ran the teammate continues once
// ({ resume: true }), only while its chat is open in this tab. A read or a
// continue asked for while an answer is arriving runs after it.
//
// useTeammateList: GET /api/agents/teammates, read again on window focus,
// when a chat changes (AI_CHATS_CHANGED_EVENT, which this store raises after
// every turn, decision and read) and when one changes without the person
// typing (the realtime event agent.changed: a decision in another tab, an
// expiry, a routine's report or pause).
//
// The pure rules are in teammate-thread.ts.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { aiSession, type AiStatus } from "@/lib/ai/session-store";
import { AI_CHATS_CHANGED_EVENT, notifyAiChatsChanged } from "@/lib/ai/events";
import { splitSse } from "@/lib/ai/thread";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";
import { markSessionExpired, OFFLINE_EVENT } from "@/lib/session-expiry";
import {
  TEMP_ID_PREFIX,
  applyDecisionResults,
  applyTeammateEvent,
  draftAfterFailure,
  failedTurnMessages,
  mergeNewestPage,
  prependOlder,
  isTempMessage,
  teammateSendFailure,
  type ActionView,
  type DecideAnswer,
  type TeammateDecision,
  type TeammateDecisionResult,
  type TeammateMessageView,
  type TeammateMessagesPage,
  type TeammateSendError,
  type TeammateStreamEvent,
  type TurnIds,
} from "./teammate-thread";
import type { TeammateLimits, TeammateRow } from "./teammate-views";
import type { TemplateCard } from "./templates";

export interface TeammateChatState {
  /** Read at least once: the thread, or that it is not there. */
  ready: boolean;
  loading: boolean;
  /** The read failed; Try again calls open() again. */
  loadError: boolean;
  /** The teammate is not there for this person (404). */
  missing: boolean;
  sessionId: string | null;
  messages: TeammateMessageView[];
  /** The cards' actions, by id. */
  actions: Record<string, ActionView>;
  /** Older messages wait above the first one shown. */
  hasMore: boolean;
  loadingOlder: boolean;
  streaming: boolean;
  error: TeammateSendError | null;
  /** The server's own sentence for the error, when it sent one. */
  errorText: string | null;
  draft: string;
  practice: boolean;
  /** The requests this tab is deciding now: their card reads "Approving…". */
  deciding: Record<string, "approve" | "deny">;
}

const INITIAL: TeammateChatState = {
  ready: false,
  loading: false,
  loadError: false,
  missing: false,
  sessionId: null,
  messages: [],
  actions: {},
  hasMore: false,
  loadingOlder: false,
  streaming: false,
  error: null,
  errorText: null,
  draft: "",
  practice: false,
  deciding: {},
};

/** The newest messages a read brings, and each older page. */
const PAGE = 50;

/** How long after an answer broke off the chat is read again (Ask AI's wait). */
const CHECK_AFTER_MS = 2500;

const chats = new Map<string, TeammateChatState>();
const listeners = new Map<string, Set<() => void>>();
/** How many components show each chat now: a continue starts only in a chat that is open. */
const shown = new Map<string, number>();
/** Bumped whenever this tab adds rows to a chat; a read that started before is older than the screen. */
const epochs = new Map<string, number>();
/** A read, and a continue, asked for while an answer was arriving: they run after it. */
const readAfter = new Set<string>();
const resumeAfter = new Set<string>();
let seq = 0;

function stateOf(slug: string): TeammateChatState {
  return chats.get(slug) ?? INITIAL;
}

function set(slug: string, patch: Partial<TeammateChatState> | ((s: TeammateChatState) => Partial<TeammateChatState>)): void {
  const prev = stateOf(slug);
  const next = typeof patch === "function" ? patch(prev) : patch;
  chats.set(slug, { ...prev, ...next });
  for (const l of listeners.get(slug) ?? []) l();
}

function subscribe(slug: string, l: () => void): () => void {
  let bucket = listeners.get(slug);
  if (!bucket) {
    bucket = new Set();
    listeners.set(slug, bucket);
  }
  bucket.add(l);
  return () => {
    listeners.get(slug)?.delete(l);
  };
}

function bump(slug: string): void {
  epochs.set(slug, (epochs.get(slug) ?? 0) + 1);
}

function messagesUrl(slug: string, before?: string): string {
  const q = new URLSearchParams({ take: String(PAGE) });
  if (before) q.set("before", before);
  return `/api/agents/teammates/${encodeURIComponent(slug)}/messages?${q.toString()}`;
}

/* ─────────────────────────── reading ─────────────────────────── */

/**
 * Read the newest page into the chat. A read that started before this tab
 * added rows (a send, a line from the stream) is dropped: the screen is newer.
 * Resolves true when the read was applied.
 */
async function read(slug: string, first: boolean): Promise<boolean> {
  const at = epochs.get(slug) ?? 0;
  const r = await apiFetch<TeammateMessagesPage>(messagesUrl(slug), { cache: "no-store" });
  if (stateOf(slug).streaming) {
    readAfter.add(slug);
    return false;
  }
  // A turn came and went while this read was out: read again.
  if ((epochs.get(slug) ?? 0) !== at) return read(slug, first);
  if (!r.ok) {
    if (first) set(slug, { loading: false, ready: true, loadError: r.status !== 404, missing: r.status === 404 });
    else if (r.status === 404) set(slug, { missing: true });
    return false;
  }
  set(slug, (s) => {
    const merged = mergeNewestPage(s, { messages: r.data.messages, hasMore: r.data.hasMore });
    return {
      loading: false,
      ready: true,
      loadError: false,
      missing: false,
      sessionId: r.data.session?.id ?? null,
      messages: merged.messages,
      hasMore: merged.hasMore,
      actions: { ...s.actions, ...r.data.actions },
    };
  });
  return true;
}

/** Show the chat: read it the first time (or after a failed read), else read it again in place. */
async function open(slug: string): Promise<void> {
  const s = stateOf(slug);
  if (s.loading) return;
  if (s.ready && !s.loadError && !s.missing) {
    await refresh(slug);
    return;
  }
  set(slug, { loading: true, loadError: false, missing: false });
  await read(slug, true);
}

/** Read the chat again in place. While an answer arrives it waits for the end of it. */
async function refresh(slug: string): Promise<boolean> {
  const s = stateOf(slug);
  if (!s.ready || s.loading || s.loadError) return false;
  if (s.streaming) {
    readAfter.add(slug);
    return false;
  }
  return read(slug, false);
}

/** Show earlier messages. Resolves false when the read failed. */
async function loadOlder(slug: string): Promise<boolean> {
  const s = stateOf(slug);
  const first = s.messages.find((m) => !isTempMessage(m));
  if (!s.hasMore || s.loadingOlder || !first) return true;
  set(slug, { loadingOlder: true });
  const r = await apiFetch<TeammateMessagesPage>(messagesUrl(slug, first.id), { cache: "no-store" });
  if (!r.ok) {
    set(slug, { loadingOlder: false });
    return false;
  }
  set(slug, (c) => ({
    loadingOlder: false,
    messages: prependOlder(c.messages, r.data.messages),
    hasMore: r.data.hasMore,
    actions: { ...r.data.actions, ...c.actions },
  }));
  return true;
}

/* ─────────────────────────── sending ─────────────────────────── */

/** Send one message as the person; `practice` defaults to the composer's switch. */
async function send(slug: string, raw: string, opts: { practice?: boolean } = {}): Promise<void> {
  const text = raw.trim();
  const s = stateOf(slug);
  if (!text || s.streaming || !s.ready) return;
  const practice = opts.practice ?? s.practice;
  const n = ++seq;
  const userId = `${TEMP_ID_PREFIX}user-${n}`;
  const liveId = `${TEMP_ID_PREFIX}live-${n}`;
  const now = new Date().toISOString();
  bump(slug);
  set(slug, (c) => ({
    error: null,
    errorText: null,
    streaming: true,
    draft: "",
    messages: [
      ...c.messages,
      { id: userId, kind: "user", text, practice, createdAt: now },
      { id: liveId, kind: "agent", text: "", practice, toolCalls: [], createdAt: now, streaming: true },
    ],
  }));
  await stream(slug, { message: text, ...(practice ? { practice: true } : {}) }, { userId, liveId }, text);
}

/** The teammate carries on after the person decided (the decide answer's `resume`). */
async function resume(slug: string): Promise<void> {
  const s = stateOf(slug);
  if (!s.ready) return;
  if (s.streaming) {
    resumeAfter.add(slug);
    return;
  }
  const ids: TurnIds = { userId: null, liveId: `${TEMP_ID_PREFIX}live-${++seq}` };
  bump(slug);
  set(slug, (c) => ({
    error: null,
    errorText: null,
    streaming: true,
    messages: [...c.messages, { id: ids.liveId, kind: "agent", text: "", practice: false, toolCalls: [], createdAt: new Date().toISOString(), streaming: true }],
  }));
  await stream(slug, { resume: true }, ids, null);
}

/** Try again after a failure: send what is in the composer. */
function retry(slug: string): Promise<void> {
  const text = stateOf(slug).draft;
  if (!text.trim()) return Promise.resolve();
  return send(slug, text);
}

/**
 * One turn's stream. `text` is the person's words (null for a continue): they
 * come back to the composer whenever the turn fails.
 */
async function stream(slug: string, body: Record<string, unknown>, start: TurnIds, text: string | null): Promise<void> {
  let ids = start;
  let serverHas = false;
  let sawDone = false;
  let savedRows = false;
  let broke: string | null = null;
  let endedEarly: string | null = null;

  const apply = (e: TeammateStreamEvent) => {
    const c = stateOf(slug);
    const out = applyTeammateEvent({ messages: c.messages, actions: c.actions }, ids, e);
    ids = out.ids;
    set(slug, { messages: out.view.messages, actions: out.view.actions });
  };

  const fail = (error: TeammateSendError, errorText: string | null) => {
    set(slug, (c) => ({
      error,
      errorText,
      // Typed more while the send was out: both stay (draftAfterFailure).
      draft: draftAfterFailure(c.draft, text, serverHas),
      messages: failedTurnMessages(c.messages, ids, serverHas),
    }));
    if (serverHas && error === "stopped") {
      // The route saves the turn after the connection drops, so read the
      // chat again before Try again would ask a second time.
      window.setTimeout(() => {
        void refresh(slug).then((applied) => {
          const now = stateOf(slug);
          const last = now.messages[now.messages.length - 1];
          if (!applied || !last || last.kind === "user") return;
          set(slug, (c) => ({ error: c.error === "stopped" ? null : c.error, errorText: c.error === "stopped" ? null : c.errorText, draft: c.draft === text ? "" : c.draft }));
        });
      }, CHECK_AFTER_MS);
    }
  };

  try {
    const res = await fetch(`/api/agents/teammates/${encodeURIComponent(slug)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) markSessionExpired({ reason: "expired" });
    if (!res.ok || !res.body) {
      const refusal: unknown = await res.json().catch(() => null);
      const why = teammateSendFailure(res.status, refusal);
      if (why.error === null) {
        // A continue with nothing new to tell the teammate: nothing to say.
        set(slug, (c) => ({ messages: failedTurnMessages(c.messages, ids, false) }));
        return;
      }
      fail(why.error, why.text);
      // The teammate changed meanwhile: the list (and so the composer) reads it again.
      if (why.error === "paused" || why.error === "removed" || why.error === "gone") notifyAiChatsChanged();
      if (why.error === "not_configured" || why.error === "ai_off") void aiSession.loadStatus(true);
      return;
    }
    // The route saved the message before it opened the stream.
    serverHas = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = splitSse<TeammateStreamEvent>(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) {
        if (e.type === "error") {
          broke = typeof e.message === "string" ? e.message : null;
          continue;
        }
        if (e.type === "done") {
          sawDone = true;
          savedRows = Array.isArray(e.messages) && e.messages.length > 0;
          endedEarly = typeof e.error === "string" && e.error ? e.error : null;
        }
        apply(e);
      }
    }
    if (!sawDone) {
      fail("stopped", broke);
      return;
    }
    if (endedEarly) {
      // Nothing came back and nothing ran (the question went back): as an
      // answer that broke off, with Try again. An answer that was saved but
      // cut short or declined, or one that ran but could not be saved: it
      // stays, and the row says why, with no Try again (it could ask twice).
      const keptLive = stateOf(slug).messages.some((m) => m.id === ids.liveId);
      if (savedRows || keptLive) set(slug, { error: "ended", errorText: endedEarly });
      else fail("stopped", endedEarly);
    }
  } catch {
    if (typeof window !== "undefined" && navigator.onLine === false) window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
    fail(serverHas ? "stopped" : "not_sent", null);
  } finally {
    set(slug, (c) => ({
      streaming: false,
      // An answer the stream never closed reads as settled.
      messages: c.messages.some((m) => m.id === ids.liveId && m.kind === "agent" && m.streaming) ? failedTurnMessages(c.messages, ids, true) : c.messages,
    }));
    // The list's last line and unread dot, and the AI sidebar's count.
    notifyAiChatsChanged();
    void afterTurn(slug);
  }
}

/** What waited for the answer to end: a read, then a continue (only while the chat is open). */
async function afterTurn(slug: string): Promise<void> {
  if (readAfter.delete(slug)) await refresh(slug);
  if (resumeAfter.delete(slug) && (shown.get(slug) ?? 0) > 0) await resume(slug);
}

/* ─────────────────────────── deciding ─────────────────────────── */

/**
 * Approve or deny requests on this chat's cards. The cards change at once,
 * the chat is read again for the decision's line, and when something ran,
 * the teammate continues once if its chat is open in this tab.
 */
async function decide(slug: string, decisions: TeammateDecision[], opts: { always?: boolean } = {}): Promise<DecideAnswer> {
  if (decisions.length === 0) return { ok: true, results: [] };
  const ids = decisions.map((d) => d.id);
  set(slug, (c) => {
    const deciding = { ...c.deciding };
    for (const d of decisions) deciding[d.id] = d.decision;
    return { deciding };
  });
  const r = await apiFetch<{ results: TeammateDecisionResult[]; resume: boolean; agentSlug: string | null }>("/api/agents/actions/decide", {
    method: "POST",
    json: { decisions, ...(opts.always ? { always: true } : {}) },
  });
  const settle = (c: TeammateChatState) => {
    const deciding = { ...c.deciding };
    for (const id of ids) delete deciding[id];
    return deciding;
  };
  if (!r.ok) {
    set(slug, (c) => ({ deciding: settle(c) }));
    return { ok: false, error: r.status === 429 ? r.error : null };
  }
  const results = Array.isArray(r.data.results) ? r.data.results : [];
  set(slug, (c) => ({ deciding: settle(c), actions: applyDecisionResults(c.actions, results, new Date().toISOString()) }));
  notifyAiChatsChanged();
  await refresh(slug);
  const next = r.data.resume ? r.data.agentSlug : null;
  if (next && (shown.get(next) ?? 0) > 0) void resume(next);
  return { ok: true, results };
}

/** The person has read the chat up to now: the list's unread dot clears. */
async function markRead(slug: string): Promise<void> {
  const r = await apiFetch(`/api/agents/teammates/${encodeURIComponent(slug)}/read`, { method: "POST", keepalive: true });
  if (r.ok) notifyAiChatsChanged();
}

function setDraft(slug: string, draft: string): void {
  if (draft !== stateOf(slug).draft) set(slug, { draft });
}

function setPractice(slug: string, practice: boolean): void {
  if (practice !== stateOf(slug).practice) set(slug, { practice });
}

function clearError(slug: string): void {
  if (stateOf(slug).error) set(slug, { error: null, errorText: null });
}

/** One teammate's chat, as the components read it. */
export function useTeammateChat(slug: string) {
  const sub = useCallback((l: () => void) => subscribe(slug, l), [slug]);
  const snap = useCallback(() => stateOf(slug), [slug]);
  const s = useSyncExternalStore(sub, snap, () => INITIAL);

  // Count the chat as open while this component shows it.
  useEffect(() => {
    shown.set(slug, (shown.get(slug) ?? 0) + 1);
    return () => {
      const left = (shown.get(slug) ?? 1) - 1;
      if (left > 0) shown.set(slug, left);
      else shown.delete(slug);
    };
  }, [slug]);

  const actions = useMemo(
    () => ({
      open: () => open(slug),
      refresh: () => refresh(slug),
      loadOlder: () => loadOlder(slug),
      send: (text: string, opts?: { practice?: boolean }) => send(slug, text, opts),
      retry: () => retry(slug),
      resume: () => resume(slug),
      decide: (decisions: TeammateDecision[], opts?: { always?: boolean }) => decide(slug, decisions, opts),
      markRead: () => markRead(slug),
      setDraft: (draft: string) => setDraft(slug, draft),
      setPractice: (practice: boolean) => setPractice(slug, practice),
      clearError: () => clearError(slug),
    }),
    [slug],
  );
  return useMemo(() => ({ ...s, ...actions }), [s, actions]);
}

/**
 * Only the words waiting in one chat's composer, for a screen that shows
 * them without the chat (its teammate is not there any more). Read-only, and
 * the chat does not count as open.
 */
export function useTeammateDraft(slug: string | null): string {
  const sub = useCallback((l: () => void) => (slug ? subscribe(slug, l) : () => {}), [slug]);
  const snap = useCallback(() => (slug ? stateOf(slug).draft : ""), [slug]);
  return useSyncExternalStore(sub, snap, () => "");
}

/**
 * Whether AI can answer (GET /api/ai/status) and whether the tab is offline:
 * Ask AI's own reading of both (session-store.ts), read again when a chat
 * shows, so the composer says AI is off or not set up instead of failing.
 */
export function useAiAvailability(): { status: AiStatus | null; offline: boolean } {
  const status = useSyncExternalStore(aiSession.subscribe, () => aiSession.getState().status, () => null);
  const offline = useSyncExternalStore(aiSession.subscribe, () => aiSession.getState().offline, () => false);
  useEffect(() => {
    void aiSession.loadStatus(true);
  }, []);
  return { status, offline };
}

/* ─────────────────────────── the list ─────────────────────────── */

/** GET /api/agents/teammates */
export interface TeammateListData {
  teammates: TeammateRow[];
  /** What waits for this person across their teammates: the Waiting for you count. */
  waitingTotal: number;
  /** The starter templates as this workspace can make them now (templates.ts templateCards), read by the new teammate dialog and a new chat's starters. */
  templates: TemplateCard[];
  canCreateWorkspace: boolean;
  limits: TeammateLimits;
  talkOn: boolean;
  tablesOn: boolean;
}

/** The teammates this person can use; `removed` adds the removed ones (Show removed). */
export function useTeammateList(opts: { removed: boolean }) {
  const { removed } = opts;
  const [data, setData] = useState<TeammateListData | null>(null);
  const [error, setError] = useState(false);
  // Reads can cross (focus and a change at once): only the newest one lands.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const n = ++latest.current;
    const r = await apiFetch<TeammateListData>(`/api/agents/teammates${removed ? "?removed=1" : ""}`, { cache: "no-store" });
    if (n !== latest.current) return;
    if (!r.ok) {
      setError(true);
      return;
    }
    setError(false);
    setData(r.data);
  }, [removed]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onChange = () => void load();
    // A teammate changed without the person typing: what waits for them, or
    // what they have not read, may have moved.
    const onRealtime = (e: Event) => {
      if ((e as CustomEvent<RealtimeEvent>).detail?.type === "agent.changed") void load();
    };
    window.addEventListener("focus", onChange);
    window.addEventListener(AI_CHATS_CHANGED_EVENT, onChange);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onChange);
      window.removeEventListener(AI_CHATS_CHANGED_EVENT, onChange);
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
    };
  }, [load]);

  return { data, error, reload: load };
}
