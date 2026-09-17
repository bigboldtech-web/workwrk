// Realtime event CONTRACT (spec-shell.md section 1.11): the names and payload
// types the SSE stream carries and the shell consumes. Defined here, now, so
// every hub unit produces the same shapes; the PRODUCER changes (publishing
// these from the notification, reminder, timer, call and access code paths)
// are later units. Today's three producers (`message`, `notification`, `call`)
// keep working unchanged: they are the legacy members of the same union.
//
// Payloads are TRIGGER-ONLY (ids, counts, a timestamp), never content: the
// client refetches through its auth-scoped endpoints, so a mis-scoped emit
// can never leak a body. Pure module: no imports, vitest-safe.

// ── Wire events (server -> client over /api/realtime) ─────────────

/** Legacy producers, live today. Kept verbatim so nothing breaks mid-migration. */
export type LegacyRealtimeEvent =
  | { type: "message"; conversationId: string }
  | { type: "notification" }
  | { type: "call"; conversationId: string };

export type NotifChangedEvent = { type: "notif.changed"; unread: number };
export type ReminderDueEvent = { type: "reminder.due"; id: string };
export type TalkUnreadEvent = { type: "talk.unread"; conversationId: string; unread: number };
export type TimerStartedEvent = { type: "timer.started"; session: ActiveTimer };
export type TimerStoppedEvent = { type: "timer.stopped"; session: { id: string } };
export type CallIncomingEvent = { type: "call.incoming"; conversationId?: string; meetingId?: string };
export type CallEndedEvent = { type: "call.ended"; conversationId?: string; meetingId?: string };
export type AccessChangedEvent = { type: "access.changed"; objectType: string; objectId: string };
export type PrefsChangedEvent = { type: "prefs.changed" };
export type SessionIdleEvent = { type: "session.idle"; idleUntil: string | null };

export type ShellRealtimeEvent =
  | NotifChangedEvent
  | ReminderDueEvent
  | TalkUnreadEvent
  | TimerStartedEvent
  | TimerStoppedEvent
  | CallIncomingEvent
  | CallEndedEvent
  | AccessChangedEvent
  | PrefsChangedEvent
  | SessionIdleEvent;

export type RealtimeEvent = LegacyRealtimeEvent | ShellRealtimeEvent;
export type RealtimeEventName = RealtimeEvent["type"];

/** The running-timer shape the pill renders (also `/api/boot`.timer). */
export interface ActiveTimer {
  id: string;
  entityType: string;
  entityId: string;
  /** ISO timestamp. */
  startedAt: string;
  title: string | null;
  /** The list URL with the drawer open, or null when the viewer lost access. */
  url: string | null;
}

export const REALTIME_EVENT_NAMES: readonly RealtimeEventName[] = [
  "message",
  "notification",
  "call",
  "notif.changed",
  "reminder.due",
  "talk.unread",
  "timer.started",
  "timer.stopped",
  "call.incoming",
  "call.ended",
  "access.changed",
  "prefs.changed",
  "session.idle",
];

const NAME_SET: ReadonlySet<string> = new Set(REALTIME_EVENT_NAMES);

/** Runtime guard for a parsed SSE payload; unknown types are dropped. */
export function isRealtimeEvent(v: unknown): v is RealtimeEvent {
  if (!v || typeof v !== "object") return false;
  const t = (v as { type?: unknown }).type;
  return typeof t === "string" && NAME_SET.has(t);
}

// ── Window events (client fan-out; the de facto same-tab contract) ─

/** Every `window` CustomEvent the shell dispatches or listens for. */
export const WINDOW_EVENTS = {
  /** A parsed wire event, as `detail`. New consumers subscribe to this. */
  realtime: "workwrk:realtime",
  // Legacy fan-out kept for today's consumers.
  chatChanged: "workwrk:chat-changed",
  /** `workwrk:convo:<conversationId>` */
  convoPrefix: "workwrk:convo:",
  notifChanged: "workwrk:notif-changed",
  callIncoming: "workwrk:call-incoming",
  remindersChanged: "workwrk:reminders-changed",
  prefsChanged: "workwrk:prefs-changed",
  timerChanged: "workwrk:timer-changed",
  accessChanged: "workwrk:access-changed",
  sessionIdle: "workwrk:session-idle",
  /** Connection state of the SSE client, `detail: { connected: boolean }`. */
  realtimeState: "workwrk:realtime-state",
} as const;

export function convoEventName(conversationId: string): string {
  return `${WINDOW_EVENTS.convoPrefix}${conversationId}`;
}

/**
 * The legacy window events one wire event fans out to (in addition to
 * `workwrk:realtime`). Pure so the client and a test agree on the mapping.
 */
export function legacyWindowEventsFor(ev: RealtimeEvent): string[] {
  switch (ev.type) {
    case "message":
      return [WINDOW_EVENTS.chatChanged, convoEventName(ev.conversationId)];
    case "talk.unread":
      return [WINDOW_EVENTS.chatChanged, convoEventName(ev.conversationId)];
    case "notification":
    case "notif.changed":
      return [WINDOW_EVENTS.notifChanged];
    case "reminder.due":
      return [WINDOW_EVENTS.remindersChanged];
    case "call":
    case "call.incoming":
      return [WINDOW_EVENTS.callIncoming];
    case "call.ended":
      return [];
    case "timer.started":
    case "timer.stopped":
      return [WINDOW_EVENTS.timerChanged];
    case "access.changed":
      return [WINDOW_EVENTS.accessChanged];
    case "prefs.changed":
      return [WINDOW_EVENTS.prefsChanged];
    case "session.idle":
      return [WINDOW_EVENTS.sessionIdle];
  }
}

// ── Reconnect policy (section 1.11: 1s to 30s exponential with jitter) ─

export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;
/** While disconnected the shell polls `GET /api/boot?counts=1` this often. */
export const FALLBACK_POLL_MS = 60_000;

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, attempt));
  const jitter = base * 0.3 * random();
  return Math.round(Math.min(RECONNECT_MAX_MS, base + jitter));
}
