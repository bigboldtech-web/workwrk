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
// GROUP CHATS (docs/plans/ai-teammates-phase2.md step 4): the same store,
// keyed "group:<id>" (a slug never holds ":"). A group's message draws only
// the person's bubble; each answerer's turn draws its own answer as it
// starts (answer_start), and a turn that broke off waits until a read holds
// every expected teammate's answer or skipped line (groupAnsweredSince).
// A decision continues a group only when the decide answer names that
// group, and a teammate's own chat only when it names that chat.
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
  applyGroupEvent,
  applyTeammateEvent,
  draftAfterFailure,
  failedTurnMessages,
  groupAnsweredSince,
  mergeNewestPage,
  prependOlder,
  isTempMessage,
  teammateSendFailure,
  type ActionView,
  type DecideAnswer,
  type GroupMemberView,
  type GroupRow,
  type GroupStreamEvent,
  type GroupTurnIds,
  type TeammateDecision,
  type TeammateMessageView,
  type TeammateMessagesPage,
  type TeammateSendError,
  type TeammateStreamEvent,
  type TurnIds,
} from "./teammate-thread";
import { sendDecisions } from "./decide-client";
import type { TeammateLimits, TeammateRow } from "./teammate-views";
import type { TemplateCard } from "./templates";
import { TEAMMATE_CHAT } from "./teammate-copy";

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
  /** A group chat's teammates, as its messages page names them (empty in a one-teammate chat). */
  members: GroupMemberView[];
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
  members: [],
};

const GROUP_PREFIX = "group:";

/** The store's key for a group chat. */
export function groupChatKey(id: string): string {
  return `${GROUP_PREFIX}${id}`;
}

function groupIdOf(key: string): string | null {
  return key.startsWith(GROUP_PREFIX) ? key.slice(GROUP_PREFIX.length) : null;
}

/** Where a chat's routes live: a group's, or a teammate's. */
function chatBase(key: string): string {
  const group = groupIdOf(key);
  return group ? `/api/teammate-groups/${encodeURIComponent(group)}` : `/api/agents/teammates/${encodeURIComponent(key)}`;
}

/** The newest messages a read brings, and each older page. */
const PAGE = 50;

/** How long after an answer broke off the chat is read again (Ask AI's wait). */
const CHECK_AFTER_MS = 2500;

/** When a turn that broke off is read again: soon, then once a minute, for up to ten minutes. */
const STOP_READS_MS = [CHECK_AFTER_MS, 10_000, 30_000, 60_000];
const STOP_READ_FOR_MS = 10 * 60_000;

/**
 * A turn that broke off, until a read finds its answer: the person's
 * message it answers (its saved id; null for a continue), the row this tab
 * drew for it (its live answer, with its tool rows), the rows the server
 * held when it stopped (for a continue, whose answer names no message), the
 * person's words, and when it stopped. Kept per chat, every one of them: a
 * new send clears the error, never an earlier stop.
 */
export interface StoppedTurn {
  questionId: string | null;
  liveId: string;
  known: ReadonlySet<string>;
  text: string | null;
  startedAt: number;
  /** A group turn: the teammates whose answer (or skipped line) it waits for. */
  expect?: string[];
  /** A group turn: the teammate whose answer was being drawn when it stopped. */
  liveAgentId?: string | null;
  /** A group continue (said, never guessed from what came back; review round 1). */
  continued?: boolean;
}
const stoppedTurns = new Map<string, StoppedTurn[]>();
/** The stop the chat's "The answer stopped" belongs to, per chat. */
const errorStop = new Map<string, StoppedTurn>();

/**
 * Whether these rows hold the answer to this stopped turn: for a chat turn,
 * only the answer saved for its message (replyTo: every chat answer names
 * it, so an answer that names none, a continue's, is never this one's); for
 * a continue, a new answer that names no message. A routine's report is
 * never an answer to a chat turn.
 */
function answeredSince(messages: readonly TeammateMessageView[], stop: StoppedTurn): boolean {
  if (stop.expect) return groupStopAnswered(messages, stop);
  const saved = messages.filter((m) => !isTempMessage(m));
  // A delegated answer (origin) landing in this chat is never its continue's answer (Phase 2 step 5).
  if (stop.questionId === null) return saved.some((m) => m.kind === "agent" && !m.replyTo && !m.origin && !stop.known.has(m.id));
  return saved.some((m) => m.kind === "agent" && m.replyTo === stop.questionId);
}

/**
 * A group turn's stop. When the stream never named its answerers (it broke
 * before the saved message arrived, or a continue's teammate is not known
 * here), they are read from the saved message itself, else any answer to it
 * ends the stop; a continue's ends at a new continue answer. Never at once
 * on an empty list (review of step 4).
 */
export function groupStopAnswered(messages: readonly TeammateMessageView[], stop: StoppedTurn): boolean {
  let questionId = stop.questionId;
  // The stream broke before the saved message arrived: it is the newest
  // saved message with these words, sent at or after this send began
  // (review round 1: else the stop waited for a continue's answer, which a
  // message's answers never are, and never ended).
  if (!questionId && !stop.continued && stop.text) {
    // In the server's own order, never across two clocks (review round 2):
    // after the newest row this device already had when it stopped.
    const words = stop.text.trim();
    let lastKnown = -1;
    messages.forEach((m, i) => {
      if (stop.known.has(m.id)) lastKnown = i;
    });
    const found = messages
      .slice(lastKnown + 1)
      .reverse()
      .find((m) => m.kind === "user" && !isTempMessage(m) && !stop.known.has(m.id) && m.text.trim() === words);
    questionId = found?.id ?? null;
  }
  let expect = stop.expect ?? [];
  if (expect.length === 0 && questionId) {
    const question = messages.find((m) => m.kind === "user" && m.id === questionId);
    expect = question?.kind === "user" ? (question.answerers ?? []) : [];
  }
  if (expect.length > 0) return groupAnsweredSince(messages, { questionId, known: stop.known, expect });
  const saved = messages.filter((m) => !isTempMessage(m) && !stop.known.has(m.id));
  if (questionId) return saved.some((m) => m.kind === "agent" && m.replyTo === questionId);
  if (!stop.continued) return false;
  return saved.some((m) => m.kind === "agent" && m.resume === true && (!stop.liveAgentId || m.agentId === stop.liveAgentId));
}


/** Whether a group stop's own drawn answer is saved now: its row then goes, whatever the others are doing. */
function drawnAnswerSaved(page: readonly TeammateMessageView[], stop: StoppedTurn): boolean {
  if (!stop.expect || !stop.liveAgentId) return false;
  return page.some(
    (m) =>
      m.kind === "agent" &&
      m.agentId === stop.liveAgentId &&
      (stop.questionId ? m.replyTo === stop.questionId : m.resume === true && !stop.known.has(m.id)),
  );
}

/** The page with each unanswered stop's drawn row back under its own message (a continue's at the end). */
function withDrawn(held: readonly TeammateMessageView[], page: readonly TeammateMessageView[], open: readonly StoppedTurn[]): TeammateMessageView[] {
  if (open.length === 0) return [...page];
  const drawn = (s: StoppedTurn) => (drawnAnswerSaved(page, s) ? [] : held.filter((m) => m.id === s.liveId));
  const under = new Map<string, TeammateMessageView[]>();
  const tail: TeammateMessageView[] = [];
  for (const s of open) {
    const rows = drawn(s);
    if (rows.length === 0) continue;
    if (s.questionId && page.some((m) => m.id === s.questionId)) under.set(s.questionId, [...(under.get(s.questionId) ?? []), ...rows]);
    else tail.push(...rows);
  }
  const out: TeammateMessageView[] = [];
  for (const m of page) {
    out.push(m);
    const rows = under.get(m.id);
    if (rows) out.push(...rows);
  }
  return [...out, ...tail];
}

const chats = new Map<string, TeammateChatState>();
const listeners = new Map<string, Set<() => void>>();
/** How many components show each chat now: a continue starts only in a chat that is open. */
const shown = new Map<string, number>();
/** Bumped whenever this tab adds rows to a chat; a read that started before is older than the screen. */
const epochs = new Map<string, number>();

/**
 * The continue whose failure a chat's error row shows (the teammate's slug in
 * a group, null in a one-teammate chat): Try again continues it, and never
 * sends the composer's words as a new message (review round 6).
 */
const failedContinues = new Map<string, string | null>();
/** A read, and a continue, asked for while an answer was arriving: they run after it. */
const readAfter = new Set<string>();
/**
 * Continues asked for during an answer, in order, with the group teammate
 * each is for (null in a one-teammate chat): two decided in one stream both
 * run, one after the other (review of step 4).
 */
const resumeAfter = new Map<string, Array<string | null>>();
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
  return `${chatBase(slug)}/messages?${q.toString()}`;
}

/** How long after a send that may have left the chat is read to see whether the server took it (Ask AI's wait). */
const UNSENT_CHECK_MS = 2500;

/**
 * Whether a send whose request may have left was saved anyway: the route
 * claims the question and saves the message before it answers, and carries
 * on when the connection drops before its headers come back. A moment later
 * the chat is read: it was saved when it holds a message with these words
 * that was not there when the send left (`known`, by id; no clock is
 * compared). A read that fails says no, so the words come back: seeing them
 * twice beats losing them (Ask AI's keepUnlessSaved; review round 5). It
 * answers the saved message's id, so the stop waits for that message's own
 * answer (review round 6).
 */
async function sentAnyway(slug: string, text: string, known: ReadonlySet<string>): Promise<string | null> {
  await new Promise((resolve) => setTimeout(resolve, UNSENT_CHECK_MS));
  const r = await apiFetch<TeammateMessagesPage>(messagesUrl(slug), { cache: "no-store" });
  if (!r.ok) return null;
  const words = text.trim();
  // The newest such message: the one this send saved.
  const found = [...r.data.messages].reverse().find((m) => m.kind === "user" && m.text.trim() === words && !known.has(m.id));
  return found?.id ?? null;
}

/** The one reader per chat that waits for its stopped turns; each new stop takes it over. */
const stopWatchers = new Map<string, object>();

/**
 * Read the chat again while it has stopped turns, soon and then once a
 * minute, for ten minutes from the newest stop. When the window ends the
 * stops are kept, so any later read (a focus, a decision) still ends them
 * and clears the error, and one last read is made.
 */
function watchStops(slug: string): void {
  const me = {};
  stopWatchers.set(slug, me);
  const startedAt = Date.now();
  const step = (i: number) => {
    setTimeout(() => {
      if (stopWatchers.get(slug) !== me) return;
      if (!stoppedTurns.has(slug)) {
        stopWatchers.delete(slug);
        return;
      }
      if (Date.now() - startedAt > STOP_READ_FOR_MS) {
        stopWatchers.delete(slug);
        void refresh(slug);
        return;
      }
      void refresh(slug).finally(() => step(i + 1));
    }, STOP_READS_MS[Math.min(i, STOP_READS_MS.length - 1)]);
  };
  step(0);
}

/* ─────────────────────────── reading ─────────────────────────── */

/**
 * Read the newest page into the chat. A read that started before this tab
 * added rows (a send, a line from the stream) is dropped: the screen is newer.
 * Resolves true when the read was applied.
 */
async function read(slug: string, first: boolean): Promise<boolean> {
  const at = epochs.get(slug) ?? 0;
  const r = await apiFetch<TeammateMessagesPage & { members?: GroupMemberView[] }>(messagesUrl(slug), { cache: "no-store" });
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
  const stops = stoppedTurns.get(slug) ?? [];
  set(slug, (s) => {
    const merged = mergeNewestPage(s, { messages: r.data.messages, hasMore: r.data.hasMore });
    // A turn that broke off is saved only when the route's turn ends: until a
    // read holds its answer, the row this tab drew for it stays under its own
    // message, and once one does, its stop ends; "The answer stopped" goes
    // only with the stop it belongs to.
    const open = stops.filter((st) => !answeredSince(merged.messages, st));
    if (open.length > 0) stoppedTurns.set(slug, open);
    else stoppedTurns.delete(slug);
    const owner = errorStop.get(slug);
    const ownerAnswered = owner !== undefined && !open.includes(owner) && stops.includes(owner);
    if (ownerAnswered) errorStop.delete(slug);
    return {
      loading: false,
      ready: true,
      loadError: false,
      missing: false,
      sessionId: r.data.session?.id ?? null,
      messages: withDrawn(s.messages, merged.messages, open),
      hasMore: merged.hasMore,
      actions: { ...s.actions, ...r.data.actions },
      ...(Array.isArray(r.data.members) ? { members: r.data.members } : {}),
      ...(ownerAnswered && owner
        ? {
            error: s.error === "stopped" ? null : s.error,
            errorText: s.error === "stopped" ? null : s.errorText,
            draft: owner.text !== null && s.draft === owner.text ? "" : s.draft,
          }
        : {}),
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
  // A new send owns the error now; an earlier stop is still waited on.
  errorStop.delete(slug);
  bump(slug);
  if (groupIdOf(slug)) {
    // A group draws only the person's message: each answerer's answer
    // starts when its turn does (answer_start).
    set(slug, (c) => ({
      error: null,
      errorText: null,
      streaming: true,
      draft: "",
      messages: [...c.messages, { id: userId, kind: "user", text, practice: false, createdAt: now }],
    }));
    await streamGroup(slug, { message: text }, { userId, liveId: null, agentId: null }, text, null);
    return;
  }
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

/**
 * The teammate carries on after the person decided (the decide answer's
 * `resume`); in a group, the teammate named by `agentSlug` only.
 */
async function resume(slug: string, agentSlug: string | null = null): Promise<void> {
  const s = stateOf(slug);
  if (!s.ready) return;
  if (s.streaming) {
    const queued = resumeAfter.get(slug) ?? [];
    if (!queued.includes(agentSlug)) resumeAfter.set(slug, [...queued, agentSlug]);
    return;
  }
  if (groupIdOf(slug)) {
    if (!agentSlug) return;
    const self = s.members.find((m) => m.slug === agentSlug);
    // A teammate no longer in this group has nothing to continue here
    // (review round 1); the continues queued behind it still run (round 2).
    if (!self && s.members.length > 0) {
      await afterTurn(slug);
      return;
    }
    bump(slug);
    set(slug, { error: null, errorText: null, streaming: true });
    await streamGroup(slug, { resume: true, agentSlug }, { userId: null, liveId: null, agentId: null }, null, self ? [self.agentId] : []);
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

/** Try again after a failure: the continue that failed, else send what is in the composer. */
function retry(slug: string): Promise<void> {
  if (failedContinues.has(slug)) {
    const agentSlug = failedContinues.get(slug) ?? null;
    failedContinues.delete(slug);
    return resume(slug, agentSlug);
  }
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
  // What the chat held when the send left, and whether it failed before the
  // answer began (it may have been saved anyway: sentAnyway).
  const knownAtSend = new Set(stateOf(slug).messages.filter((m) => !isTempMessage(m)).map((m) => m.id));
  const epochAtSend = epochs.get(slug) ?? 0;
  let unknown = false;
  // A send saved anyway stops on what the chat held when it left, so a read
  // during the check never hides its answer (review round 6).
  let stopKnown: ReadonlySet<string> | null = null;
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
    // A continue sent no message: its row says so, and Try again continues.
    if (text === null) failedContinues.set(slug, null);
    else failedContinues.delete(slug);
    if (text === null && !errorText && (error === "not_sent" || error === "stopped")) errorText = TEAMMATE_CHAT.continueFailed;
    set(slug, (c) => ({
      error,
      errorText,
      // Typed more while the send was out: both stay (draftAfterFailure).
      draft: draftAfterFailure(c.draft, text, serverHas),
      messages: failedTurnMessages(c.messages, ids, serverHas),
    }));
    if (serverHas && error === "stopped") {
      // The route saves the turn after the connection drops, but only when
      // the turn ends, so the chat is read again, soon and then once a minute
      // for up to ten minutes, until its answer is there (Try again would ask
      // a second time). Any read that finds it, later ones included, ends the
      // stop and clears the error it owns (read()).
      const question = ids.userId && !isTempMessage({ id: ids.userId }) ? ids.userId : null;
      const me: StoppedTurn = {
        questionId: question,
        liveId: ids.liveId,
        known: stopKnown ?? new Set(stateOf(slug).messages.filter((m) => !isTempMessage(m)).map((m) => m.id)),
        text,
        startedAt: Date.now(),
      };
      stoppedTurns.set(slug, [...(stoppedTurns.get(slug) ?? []), me]);
      errorStop.set(slug, me);
      watchStops(slug);
    }
  };

  try {
    const res = await fetch(`${chatBase(slug)}/messages`, {
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
    if (serverHas || text === null) fail(serverHas ? "stopped" : "not_sent", null);
    else unknown = true;
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
  // Failed before the answer began: "Not sent", with the words back, only
  // when the server did not take it; else it waits for the answer as a turn
  // that broke off, so a resend never asks and pays twice.
  if (unknown && text !== null) {
    const saved = await sentAnyway(slug, text, knownAtSend);
    const drawnId = ids.userId;
    if ((epochs.get(slug) ?? 0) !== epochAtSend) {
      // Another send began meanwhile: its row is its own. Words the server
      // never took come back to the composer, and their bubble goes, so the
      // thread never shows them as sent (review round 6).
      if (!saved) set(slug, (c) => ({ draft: draftAfterFailure(c.draft, text, false), messages: c.messages.filter((m) => m.id !== drawnId) }));
      return;
    }
    if (saved) {
      // The drawn bubble is that saved message now, and the stop waits for its answer.
      set(slug, (c) => ({ messages: c.messages.map((m) => (m.id === drawnId ? { ...m, id: saved } : m)) }));
      ids = { ...ids, userId: saved };
      stopKnown = knownAtSend;
    }
    serverHas = saved !== null;
    fail(saved ? "stopped" : "not_sent", null);
  }
}

/**
 * A group message's stream (or a group continue's): the same rules as a
 * one-teammate turn's, over applyGroupEvent. `resumeExpect` is the teammate
 * a continue waits for; a message waits for its answerers, named by the
 * saved message the stream sends first.
 */
async function streamGroup(slug: string, body: Record<string, unknown>, start: GroupTurnIds, text: string | null, resumeExpect: string[] | null): Promise<void> {
  let ids = start;
  let serverHas = false;
  let sawDone = false;
  let broke: string | null = null;
  let expect: string[] = resumeExpect ?? [];
  // As a one-teammate send: a group message that failed before the answers
  // began may have been saved, and asking again would ask every answerer
  // twice (review round 5).
  const knownAtSend = new Set(stateOf(slug).messages.filter((m) => !isTempMessage(m)).map((m) => m.id));
  const epochAtSend = epochs.get(slug) ?? 0;
  let unknown = false;
  // A send saved anyway stops on what the chat held when it left, so a read
  // during the check never hides its answer (review round 6).
  let stopKnown: ReadonlySet<string> | null = null;
  const sentAt = Date.now();
  const continued = body.resume === true;
  // An answer that ended early (cut short, declined, not saved, or nothing back): its sentence shows (review of step 4).
  let endedEarly: string | null = null;
  let savedRows = false;

  const nameOf = (agentId: string) => stateOf(slug).members.find((m) => m.agentId === agentId)?.name ?? null;
  const apply = (e: GroupStreamEvent) => {
    const c = stateOf(slug);
    if (e.type === "user_message" && Array.isArray(e.answerers)) {
      expect = e.answerers.map((m) => m.agentId).filter((id): id is string => typeof id === "string");
    }
    if (e.type === "answer_done") {
      if (Array.isArray(e.messages) && e.messages.length > 0) savedRows = true;
      if (typeof e.error === "string" && e.error) endedEarly ??= e.error;
    }
    const out = applyGroupEvent({ messages: c.messages, actions: c.actions }, ids, e, { newLiveId: `${TEMP_ID_PREFIX}live-${++seq}`, agentName: nameOf });
    ids = out.ids;
    set(slug, { messages: out.view.messages, actions: out.view.actions });
  };
  const turnIds = (): TurnIds => ({ userId: ids.userId, liveId: ids.liveId ?? "" });

  const fail = (error: TeammateSendError, errorText: string | null) => {
    const drawn = turnIds();
    // A continue sent no message: its row says so, and Try again continues that teammate.
    if (continued) failedContinues.set(slug, typeof body.agentSlug === "string" ? body.agentSlug : null);
    else failedContinues.delete(slug);
    if (continued && !errorText && (error === "not_sent" || error === "stopped")) errorText = TEAMMATE_CHAT.continueFailed;
    set(slug, (c) => ({
      error,
      errorText,
      draft: draftAfterFailure(c.draft, text, serverHas),
      messages: failedTurnMessages(c.messages, drawn, serverHas),
    }));
    if (serverHas && error === "stopped") {
      const question = ids.userId && !isTempMessage({ id: ids.userId }) ? ids.userId : null;
      const me: StoppedTurn = {
        questionId: question,
        liveId: drawn.liveId,
        known: stopKnown ?? new Set(stateOf(slug).messages.filter((m) => !isTempMessage(m)).map((m) => m.id)),
        text,
        startedAt: sentAt,
        expect,
        liveAgentId: ids.agentId,
        continued,
      };
      stoppedTurns.set(slug, [...(stoppedTurns.get(slug) ?? []), me]);
      errorStop.set(slug, me);
      watchStops(slug);
    }
  };

  try {
    const res = await fetch(`${chatBase(slug)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) markSessionExpired({ reason: "expired" });
    if (!res.ok || !res.body) {
      const refusal: unknown = await res.json().catch(() => null);
      const why = teammateSendFailure(res.status, refusal);
      if (why.error === null) return;
      fail(why.error, why.text);
      if (why.error === "paused" || why.error === "removed" || why.error === "gone") notifyAiChatsChanged();
      if (why.error === "not_configured" || why.error === "ai_off") void aiSession.loadStatus(true);
      return;
    }
    serverHas = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = splitSse<GroupStreamEvent>(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) {
        if (e.type === "error") {
          broke = typeof e.message === "string" ? e.message : null;
          continue;
        }
        if (e.type === "done") sawDone = true;
        apply(e);
      }
    }
    if (!sawDone) fail("stopped", broke);
    else if (endedEarly) {
      // As a one-teammate turn: nothing kept (a continue that got nothing
      // back) reads as an answer that broke off; anything kept stays, and
      // the row says why.
      if (savedRows || stateOf(slug).messages.some((m) => m.kind === "agent" && isTempMessage(m) && (m.text || m.toolCalls.length > 0))) set(slug, { error: "ended", errorText: endedEarly });
      else if (resumeExpect) fail("stopped", endedEarly);
      else set(slug, { error: "ended", errorText: endedEarly });
    }
  } catch {
    // The connection dropping after the turn said it was done changes nothing.
    if (!sawDone) {
      if (typeof window !== "undefined" && navigator.onLine === false) window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
      if (serverHas || text === null) fail(serverHas ? "stopped" : "not_sent", null);
      else unknown = true;
    }
  } finally {
    set(slug, (c) => ({
      streaming: false,
      messages: c.messages.some((m) => m.kind === "agent" && m.streaming) ? failedTurnMessages(c.messages, turnIds(), true).map((m) => (m.kind === "agent" && m.streaming ? { ...m, streaming: false } : m)) : c.messages,
    }));
    notifyAiChatsChanged();
    void afterTurn(slug);
  }
  if (unknown && text !== null) {
    const saved = await sentAnyway(slug, text, knownAtSend);
    const drawnId = ids.userId;
    if ((epochs.get(slug) ?? 0) !== epochAtSend) {
      // Another send began meanwhile: its row is its own. Words the server
      // never took come back to the composer, and their bubble goes, so the
      // thread never shows them as sent (review round 6).
      if (!saved) set(slug, (c) => ({ draft: draftAfterFailure(c.draft, text, false), messages: c.messages.filter((m) => m.id !== drawnId) }));
      return;
    }
    if (saved) {
      // The drawn bubble is that saved message now, and the stop waits for its answer.
      set(slug, (c) => ({ messages: c.messages.map((m) => (m.id === drawnId ? { ...m, id: saved } : m)) }));
      ids = { ...ids, userId: saved };
      stopKnown = knownAtSend;
    }
    serverHas = saved !== null;
    fail(saved ? "stopped" : "not_sent", null);
  }
}

/** What waited for the answer to end: a read, then a continue (only while the chat is open). */
async function afterTurn(slug: string): Promise<void> {
  if (readAfter.delete(slug)) await refresh(slug);
  const queued = resumeAfter.get(slug);
  if (queued && queued.length > 0) {
    const [agentSlug, ...rest] = queued;
    if (rest.length > 0) resumeAfter.set(slug, rest);
    else resumeAfter.delete(slug);
    // The next one waits for this one's end, and runs from its own afterTurn.
    if ((shown.get(slug) ?? 0) > 0) await resume(slug, agentSlug ?? null);
    else resumeAfter.delete(slug);
  }
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
  const r = await sendDecisions(decisions, opts);
  const settle = (c: TeammateChatState) => {
    const deciding = { ...c.deciding };
    for (const id of ids) delete deciding[id];
    return deciding;
  };
  if (!r.ok) {
    set(slug, (c) => ({ deciding: settle(c) }));
    return { ok: false, error: r.error };
  }
  const results = r.results;
  set(slug, (c) => ({ deciding: settle(c), actions: applyDecisionResults(c.actions, results, new Date().toISOString()) }));
  notifyAiChatsChanged();
  await refresh(slug);
  // Only the chat the decision names continues: a group's request continues
  // that group (with its own teammate), never the teammate's other chat, and
  // a teammate's continues only its own chat (an older server names none).
  const chat = r.chat;
  if (chat?.kind === "group") {
    const key = groupChatKey(chat.id);
    if ((shown.get(key) ?? 0) > 0) void resume(key, chat.agentSlug);
  } else if (r.resume) {
    const next = chat?.kind === "teammate" ? chat.slug : r.agentSlug;
    if (next && (shown.get(next) ?? 0) > 0) void resume(next);
  }
  return { ok: true, results };
}

/** The person has read the chat up to now: the list's unread dot clears. */
async function markRead(slug: string): Promise<void> {
  const r = await apiFetch(`${chatBase(slug)}/read`, { method: "POST", keepalive: true });
  if (r.ok) notifyAiChatsChanged();
}

function setDraft(slug: string, draft: string): void {
  if (draft !== stateOf(slug).draft) set(slug, { draft });
}

function setPractice(slug: string, practice: boolean): void {
  if (practice !== stateOf(slug).practice) set(slug, { practice });
}

function clearError(slug: string): void {
  failedContinues.delete(slug);
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
      resume: (agentSlug?: string) => resume(slug, agentSlug ?? null),
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

/** One group chat, as the components read it: the same store, keyed by the group. */
export function useGroupChat(id: string) {
  return useTeammateChat(groupChatKey(id));
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
  /** The person's group chats (Phase 2); absent from an older server. */
  groups?: GroupRow[];
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

/** The store's own actions without React, for its tests (teammate-store.stop.test.ts). */
export const teammateStoreForTests = { open, send, refresh, resume, retry, setDraft, decide, stateOf, show: (key: string) => shown.set(key, (shown.get(key) ?? 0) + 1) };
