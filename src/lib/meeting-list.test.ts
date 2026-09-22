import { describe, expect, it } from "vitest";
import {
  JOIN_LEAD_MINUTES,
  canJoinNow,
  formatLength,
  meetingEndMs,
  meetingWindow,
  splitMeetings,
} from "./meeting-list";

const START = "2026-09-09T10:00:00.000Z";
const startMs = Date.parse(START);
const MIN = 60_000;

describe("meetingEndMs", () => {
  it("adds the duration", () => {
    expect(meetingEndMs(START, 30)).toBe(startMs + 30 * MIN);
  });

  it("falls back to 30 minutes for a nonsense duration", () => {
    expect(meetingEndMs(START, 0)).toBe(startMs + 30 * MIN);
    expect(meetingEndMs(START, Number.NaN)).toBe(startMs + 30 * MIN);
  });

  it("is NaN for an unreadable date rather than the epoch", () => {
    expect(Number.isNaN(meetingEndMs("not a date", 30))).toBe(true);
  });
});

describe("meetingWindow", () => {
  it("is unknown until the clock has been sampled", () => {
    // A component that has not run its effect yet must render the neutral
    // state rather than the one that happens to be true on the server.
    expect(meetingWindow(START, 30, null)).toBe("unknown");
  });

  it("walks the four states in order", () => {
    expect(meetingWindow(START, 30, startMs - 60 * MIN)).toBe("before");
    expect(meetingWindow(START, 30, startMs - 14 * MIN)).toBe("soon");
    expect(meetingWindow(START, 30, startMs)).toBe("live");
    expect(meetingWindow(START, 30, startMs + 29 * MIN)).toBe("live");
    expect(meetingWindow(START, 30, startMs + 30 * MIN)).toBe("ended");
  });

  it("opens the lead exactly 15 minutes out", () => {
    expect(meetingWindow(START, 30, startMs - JOIN_LEAD_MINUTES * MIN)).toBe("soon");
    expect(meetingWindow(START, 30, startMs - (JOIN_LEAD_MINUTES + 1) * MIN)).toBe("before");
  });

  it("is unknown for an unreadable date", () => {
    expect(meetingWindow("nope", 30, startMs)).toBe("unknown");
  });
});

describe("canJoinNow", () => {
  it("is true only inside the lead and the meeting", () => {
    expect(canJoinNow(START, 30, startMs - 60 * MIN)).toBe(false);
    expect(canJoinNow(START, 30, startMs - 5 * MIN)).toBe(true);
    expect(canJoinNow(START, 30, startMs + 5 * MIN)).toBe(true);
    // A finished meeting never wears a live affordance.
    expect(canJoinNow(START, 30, startMs + 31 * MIN)).toBe(false);
    expect(canJoinNow(START, 30, null)).toBe(false);
  });
});

describe("splitMeetings", () => {
  const rows = [
    { id: "past", scheduledAt: "2026-09-01T10:00:00.000Z", duration: 30 },
    { id: "later", scheduledAt: "2026-09-20T10:00:00.000Z", duration: 30 },
    { id: "now", scheduledAt: START, duration: 60 },
    { id: "older", scheduledAt: "2026-08-01T10:00:00.000Z", duration: 30 },
  ];

  it("keeps a meeting in Upcoming until it ENDS, not until it starts", () => {
    // The standup somebody is sitting in must not vanish at 9:00 and
    // reappear under Past.
    const { upcoming, past } = splitMeetings(rows, startMs + 10 * MIN);
    expect(upcoming.map((m) => m.id)).toEqual(["now", "later"]);
    expect(past.map((m) => m.id)).toEqual(["past", "older"]);
  });

  it("sorts Upcoming soonest first and Past newest first", () => {
    const { upcoming, past } = splitMeetings(rows, startMs + 10 * MIN);
    expect(upcoming[0].id).toBe("now");
    expect(past[0].id).toBe("past");
  });

  it("renders everything as Upcoming with no clock yet", () => {
    const { upcoming, past } = splitMeetings(rows, null);
    expect(upcoming).toHaveLength(4);
    expect(past).toHaveLength(0);
  });

  it("keeps an unreadable date visible rather than losing the row", () => {
    const { upcoming } = splitMeetings(
      [{ id: "broken", scheduledAt: "nope", duration: 30 }],
      startMs,
    );
    expect(upcoming.map((m) => m.id)).toEqual(["broken"]);
  });
});

describe("formatLength", () => {
  it("reads as words, never as 90m", () => {
    expect(formatLength(15)).toBe("15 min");
    expect(formatLength(59)).toBe("59 min");
    expect(formatLength(60)).toBe("1 h");
    expect(formatLength(90)).toBe("1 h 30 min");
    expect(formatLength(125)).toBe("2 h 5 min");
  });

  it("never renders a negative or a NaN", () => {
    expect(formatLength(-5)).toBe("0 min");
    expect(formatLength(Number.NaN)).toBe("0 min");
  });
});
