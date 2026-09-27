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
/**
 * A call's roster changed (somebody joined or left), for the live-call chip
 * and the sidebar row (spec-talk.md section 2.6 Data: "the webhook publishes
 * workwrk:call-changed:<conversationId>").
 *
 * WHY IT IS `call.changed` AND NOT `call-changed`. The spec writes the
 * WINDOW event name, which is hyphenated like every other
 * `workwrk:*-changed`; the WIRE name follows this table's own dotted
 * convention, beside `call.incoming` and `call.ended`. One concept, the two
 * spellings each contract already uses, and `legacyWindowEventsFor` is where
 * they meet. A third naming style on the wire would have been the fourth
 * word for one thing.
 *
 * TRIGGER-ONLY, like every member here: the client refetches
 * `GET /api/conversations/[id]`, so a mis-scoped emit leaks no roster.
 */
export type CallChangedEvent = { type: "call.changed"; conversationId?: string; meetingId?: string };
/**
 * Something with a time on it changed: a personal event, a meeting's time, a
 * task's dates, a synced Google row (spec-planner.md section 2 `/planner`
 * Realtime, "the SSE event calendar.changed").
 *
 * TRIGGER-ONLY: it carries no title, no attendee and no time, only the fact
 * that the visible range is stale. The Calendar refetches
 * `GET /api/calendar/events` for the range it is showing and the server
 * scopes that read, so this event can never carry somebody else's schedule.
 */
export type CalendarChangedEvent = { type: "calendar.changed" };
export type AccessChangedEvent = { type: "access.changed"; objectType: string; objectId: string };
export type PrefsChangedEvent = { type: "prefs.changed" };
export type SessionIdleEvent = { type: "session.idle"; idleUntil: string | null };
/**
 * One task changed (spec-task-detail section 2, Realtime). Emitted by the item
 * PATCH and DELETE, by comment write/edit/delete, by reactions and by restore.
 * TRIGGER-ONLY like every other member: the open task re-fetches
 * `GET /api/items/[id]` and its thread, so a mis-scoped emit leaks nothing.
 * `boardId` lets a host list decide whether the change is even on screen.
 */
export type ItemChangedEvent = {
  type: "item";
  itemId: string;
  boardId: string | null;
  /**
   * Phase 5b: every List the task appears in (its home and the Lists it is
   * linked into), so a host List that shows it through a link knows the event
   * is on screen. Optional: a client that predates it keys on boardId alone.
   */
  listIds?: string[];
  /** Phase 5b: Lists the task has just left (a link removed), so they drop the row. */
  leftListIds?: string[];
};

/**
 * The same event dispatched by THIS tab about its own write (see
 * `emitItemChanged`). `local` tells the editor that caused it to ignore it;
 * `gone` tells a host list to drop the row rather than re-read it.
 */
export type LocalItemChangedEvent = ItemChangedEvent & { local?: boolean; gone?: boolean };

export type ShellRealtimeEvent =
  | NotifChangedEvent
  | ReminderDueEvent
  | TalkUnreadEvent
  | TimerStartedEvent
  | TimerStoppedEvent
  | CallIncomingEvent
  | CallEndedEvent
  | CallChangedEvent
  | CalendarChangedEvent
  | AccessChangedEvent
  | PrefsChangedEvent
  | SessionIdleEvent
  | ItemChangedEvent;

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
  "call.changed",
  "calendar.changed",
  "access.changed",
  "prefs.changed",
  "session.idle",
  "item",
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
  /** A call's roster changed, or it ended (spec-talk section 2.6). */
  callChanged: "workwrk:call-changed",
  remindersChanged: "workwrk:reminders-changed",
  prefsChanged: "workwrk:prefs-changed",
  /** One task changed; `detail: { itemId, boardId }`. */
  itemChanged: "workwrk:item-changed",
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
 * Tell this tab that one task changed.
 *
 * The SSE producer deliberately skips the actor (`publishItemChanged` excludes
 * `actorId`), and the task drawer is rendered by a different App Router slot
 * from the list underneath it, so props cannot carry the news across. One
 * window event does, and it is the SAME event the SSE stream fans out, so a
 * host list needs exactly one listener for "somebody changed a row" whether
 * that somebody is a colleague or the person at this keyboard.
 *
 * `gone` means archived or deleted: the host drops the row instead of
 * refetching it. `local: true` marks the event as this tab telling itself, so
 * the editor that caused it does not re-read what it already holds.
 *
 * `extra` (Phase 5b) carries what a link change needs a host List to know:
 * `leftListIds` names the Lists the task just left (Remove from this List, a
 * link Move), so exactly those Lists drop the row; `listIds` names Lists it
 * now appears in. The three-argument call is unchanged.
 */
export function emitItemChanged(
  itemId: string,
  boardId: string | null,
  gone = false,
  extra?: { listIds?: string[]; leftListIds?: string[] },
): void {
  if (typeof window === "undefined") return;
  const detail: LocalItemChangedEvent = {
    type: "item",
    itemId,
    boardId,
    local: true,
    ...(gone ? { gone: true } : {}),
    ...(extra?.listIds ? { listIds: extra.listIds } : {}),
    ...(extra?.leftListIds ? { leftListIds: extra.leftListIds } : {}),
  };
  try {
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.realtime, { detail }));
  } catch {
    // A tab that refuses CustomEvent is a tab with bigger problems; the host
    // list's own poll still catches up.
  }
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
    case "call.changed":
      // Both mean "the roster you are showing is stale". Its consumer is
      // IncomingCallWatcher (src/components/calls/incoming-call-watcher.tsx),
      // which listens for BOTH this name and workwrk:call-incoming and
      // re-reads the live-call list on either: a call that ended used to
      // leave its chip standing until the next 20s poll, because call.ended
      // fanned out to nothing at all.
      return [WINDOW_EVENTS.callChanged];
    case "calendar.changed":
      // No legacy fan-out on purpose. The Calendar's consumer is
      // spec-planner section 4 step 5 (the one GET /api/calendar/events
      // feed) and nothing publishes this wire event yet either, so a window
      // event here would be a name with nobody on either end. New consumers
      // subscribe to `workwrk:realtime` and read `detail.type`, which is the
      // contract this file says new consumers use.
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
    case "item":
      return [WINDOW_EVENTS.itemChanged];
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
