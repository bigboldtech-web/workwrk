import { describe, expect, it } from "vitest";
import {
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  REALTIME_EVENT_NAMES,
  WINDOW_EVENTS,
  convoEventName,
  isRealtimeEvent,
  legacyWindowEventsFor,
  reconnectDelayMs,
  type RealtimeEvent,
} from "./realtime-events";

describe("realtime event contract", () => {
  it("keeps today's three producers as members of the union", () => {
    for (const name of ["message", "notification", "call"]) expect(REALTIME_EVENT_NAMES).toContain(name);
  });
  it("names every shell event from spec 1.11", () => {
    for (const name of [
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
    ]) {
      expect(REALTIME_EVENT_NAMES).toContain(name);
    }
  });
  it("carries the task event Phase 2 adds, so an open task stops polling and hoping", () => {
    expect(REALTIME_EVENT_NAMES).toContain("item");
    expect(isRealtimeEvent({ type: "item", itemId: "i1", boardId: "b1" })).toBe(true);
  });
  it("guards parsed payloads by type name only", () => {
    expect(isRealtimeEvent({ type: "notif.changed", unread: 3 })).toBe(true);
    expect(isRealtimeEvent({ type: "message", conversationId: "c1" })).toBe(true);
    expect(isRealtimeEvent({ type: "nope" })).toBe(false);
    expect(isRealtimeEvent(null)).toBe(false);
    expect(isRealtimeEvent("message")).toBe(false);
  });
  it("fans every wire event out to the legacy window events its consumers listen for", () => {
    const cases: [RealtimeEvent, string[]][] = [
      [{ type: "message", conversationId: "c1" }, [WINDOW_EVENTS.chatChanged, convoEventName("c1")]],
      [{ type: "notification" }, [WINDOW_EVENTS.notifChanged]],
      [{ type: "call", conversationId: "c1" }, [WINDOW_EVENTS.callIncoming]],
      [{ type: "notif.changed", unread: 1 }, [WINDOW_EVENTS.notifChanged]],
      [{ type: "reminder.due", id: "r1" }, [WINDOW_EVENTS.remindersChanged]],
      [{ type: "prefs.changed" }, [WINDOW_EVENTS.prefsChanged]],
      [{ type: "session.idle", idleUntil: null }, [WINDOW_EVENTS.sessionIdle]],
      // Phase 4: call.ended used to fan out to nothing at all, so a call
      // that ended left its live chip standing until the next poll. It and
      // call.changed now share one window event, because both mean "the
      // roster you are showing is stale".
      [{ type: "call.ended" }, [WINDOW_EVENTS.callChanged]],
      [{ type: "call.changed", conversationId: "c1" }, [WINDOW_EVENTS.callChanged]],
      // calendar.changed has no legacy fan-out: its consumer is the one
      // /api/calendar/events feed (spec-planner step 5) and it subscribes to
      // workwrk:realtime, not to a second name.
      [{ type: "calendar.changed" }, []],
      [{ type: "item", itemId: "i1", boardId: "b1" }, [WINDOW_EVENTS.itemChanged]],
    ];
    for (const [ev, expected] of cases) expect(legacyWindowEventsFor(ev)).toEqual(expected);
    // Exhaustive: every named type has a mapping (the switch returns an array).
    for (const name of REALTIME_EVENT_NAMES) {
      expect(Array.isArray(legacyWindowEventsFor({ type: name, conversationId: "x", unread: 0, id: "x", session: { id: "x", entityType: "", entityId: "", startedAt: "", title: null, url: null }, objectType: "", objectId: "", idleUntil: null } as unknown as RealtimeEvent))).toBe(true);
    }
  });
  it("backs off from 1s toward 30s with bounded jitter", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(RECONNECT_MIN_MS);
    expect(reconnectDelayMs(1, () => 0)).toBe(2000);
    expect(reconnectDelayMs(4, () => 0)).toBe(16_000);
    expect(reconnectDelayMs(10, () => 1)).toBe(RECONNECT_MAX_MS);
    expect(reconnectDelayMs(2, () => 1)).toBe(5200);
  });
});
