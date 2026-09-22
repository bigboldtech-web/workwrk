import { describe, expect, it } from "vitest";
import {
  MAX_LANES,
  capLanes,
  durationHint,
  hhmm,
  hoursMinutes,
  minutesOfHhmm,
  minutesUntil,
  packEvents,
  yToMinutes,
} from "./calendar-blocks";

const ev = (id: string, start: string, end: string) => ({ id, start, end });

describe("packEvents", () => {
  it("gives a lone block the whole column", () => {
    const out = packEvents([ev("a", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z")]);
    expect(out).toEqual([{ e: expect.objectContaining({ id: "a" }), lane: 0, lanes: 1 }]);
  });

  it("puts two overlapping blocks side by side at half width", () => {
    // The whole point of the packer (audit P-8): before it, the second 2pm
    // meeting rendered under the first and could not be clicked at all.
    const out = packEvents([
      ev("a", "2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z"),
      ev("b", "2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z"),
    ]);
    expect(out.map((p) => p.lane).sort()).toEqual([0, 1]);
    expect(out.every((p) => p.lanes === 2)).toBe(true);
  });

  it("reuses a lane once its block has ended", () => {
    const out = packEvents([
      ev("a", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z"),
      ev("b", "2026-09-22T09:30:00Z", "2026-09-22T11:00:00Z"),
      ev("c", "2026-09-22T10:00:00Z", "2026-09-22T10:30:00Z"),
    ]);
    const lane = (id: string) => out.find((p) => p.e.id === id)!.lane;
    expect(lane("a")).toBe(0);
    expect(lane("b")).toBe(1);
    // c starts when a ends, so it takes a's lane rather than a third one.
    expect(lane("c")).toBe(0);
    expect(out.every((p) => p.lanes === 2)).toBe(true);
  });

  it("gives every block in one cluster the same width", () => {
    const out = packEvents([
      ev("a", "2026-09-22T09:00:00Z", "2026-09-22T12:00:00Z"),
      ev("b", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z"),
      ev("c", "2026-09-22T10:30:00Z", "2026-09-22T11:30:00Z"),
    ]);
    expect(new Set(out.map((p) => p.lanes))).toEqual(new Set([3]));
  });

  it("starts a new cluster when nothing overlaps, so the morning is not narrowed by the afternoon", () => {
    const out = packEvents([
      ev("a", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z"),
      ev("b", "2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z"),
      ev("c", "2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z"),
    ]);
    expect(out.find((p) => p.e.id === "a")!.lanes).toBe(1);
    expect(out.find((p) => p.e.id === "b")!.lanes).toBe(2);
  });

  it("gives a zero-length block (a reminder) room to push its neighbour aside", () => {
    const out = packEvents([
      ev("r", "2026-09-22T09:00:00Z", "2026-09-22T09:00:00Z"),
      ev("t", "2026-09-22T09:10:00Z", "2026-09-22T09:40:00Z"),
    ]);
    expect(out.every((p) => p.lanes === 2)).toBe(true);
  });

  it("is stable: the same input packs the same way every time", () => {
    const rows = [
      ev("b", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z"),
      ev("a", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z"),
    ];
    const first = packEvents(rows).map((p) => `${p.e.id}:${p.lane}`);
    const second = packEvents([...rows].reverse()).map((p) => `${p.e.id}:${p.lane}`);
    expect(first).toEqual(second);
  });

  it("does not mutate what it was given", () => {
    const rows = [ev("b", "2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z"), ev("a", "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z")];
    packEvents(rows);
    expect(rows[0].id).toBe("b");
  });
});

describe("yToMinutes", () => {
  it("snaps to a quarter hour", () => {
    expect(yToMinutes(0)).toBe(0);
    expect(yToMinutes(48)).toBe(60);
    expect(yToMinutes(12)).toBe(15);
    expect(yToMinutes(20)).toBe(30); // 25 minutes rounds to 30
  });

  it("never leaves the day", () => {
    expect(yToMinutes(-200)).toBe(0);
    expect(yToMinutes(48 * 40)).toBe(24 * 60);
  });
});

describe("hoursMinutes", () => {
  it("renders h:mm, which is the unit of the whole Planner", () => {
    expect(hoursMinutes(90)).toBe("1:30");
    expect(hoursMinutes(60)).toBe("1:00");
    expect(hoursMinutes(5)).toBe("0:05");
    expect(hoursMinutes(0)).toBe("0:00");
    expect(hoursMinutes(600)).toBe("10:00");
  });

  it("never renders a negative time", () => {
    expect(hoursMinutes(-30)).toBe("0:00");
  });
});

describe("hhmm and minutesOfHhmm", () => {
  it("round-trip", () => {
    for (const m of [0, 15, 90, 545, 1439]) expect(minutesOfHhmm(hhmm(m))).toBe(m);
  });

  it("pads both halves, because an input type=time will not take 9:5", () => {
    expect(hhmm(9 * 60 + 5)).toBe("09:05");
  });

  it("reads junk as midnight rather than NaN", () => {
    expect(minutesOfHhmm("")).toBe(0);
    expect(minutesOfHhmm("nonsense")).toBe(0);
  });

  it("clamps out-of-range input", () => {
    expect(minutesOfHhmm("48:00")).toBe(24 * 60);
  });
});

describe("durationHint", () => {
  it("says minutes under an hour and hours over it", () => {
    expect(durationHint(540, 585)).toBe("45 min");
    expect(durationHint(540, 600)).toBe("1h");
    expect(durationHint(540, 630)).toBe("1h 30m");
    expect(durationHint(0, 1440)).toBe("24h");
  });

  it("says 0 min for a backwards range instead of a negative number", () => {
    // The modal fixes a backwards range on save rather than refusing it, so
    // the hint has to be able to show the state it is being fixed from.
    expect(durationHint(600, 540)).toBe("0 min");
  });
});

describe("minutesUntil", () => {
  const at = (iso: string) => new Date(iso);

  it("counts forward to a time later today", () => {
    expect(minutesUntil(18, 0, 0, at("2026-09-22T14:30:00"))).toBe(210);
  });

  it("rolls to tomorrow rather than returning a snooze into the past", () => {
    // "This evening" clicked at 9pm means tomorrow evening. A negative
    // snooze would fire the reminder the instant it was set.
    const mins = minutesUntil(18, 0, 0, at("2026-09-22T21:00:00"));
    expect(mins).toBeGreaterThan(0);
    expect(mins).toBe(21 * 60);
  });

  it("takes a day offset for 'Tomorrow 9:00'", () => {
    expect(minutesUntil(9, 0, 1, at("2026-09-22T14:00:00"))).toBe(19 * 60);
  });

  it("is always positive, whatever hour it is asked at", () => {
    for (let h = 0; h < 24; h++) {
      const now = at(`2026-09-22T${String(h).padStart(2, "0")}:30:00`);
      expect(minutesUntil(18, 0, 0, now)).toBeGreaterThan(0);
      expect(minutesUntil(9, 0, 1, now)).toBeGreaterThan(0);
    }
  });
});

describe("capLanes", () => {
  const four = [
    ev("a", "2026-09-26T09:00:00Z", "2026-09-26T10:00:00Z"),
    ev("b", "2026-09-26T09:00:00Z", "2026-09-26T10:00:00Z"),
    ev("c", "2026-09-26T09:00:00Z", "2026-09-26T10:00:00Z"),
    ev("d", "2026-09-26T09:00:00Z", "2026-09-26T10:00:00Z"),
  ];

  it("keeps three columns and puts the rest behind the chip", () => {
    const { shown, hidden, overflowStart } = capLanes(packEvents(four));
    expect(shown).toHaveLength(3);
    expect(hidden.map((e) => e.id)).toEqual(["d"]);
    expect(overflowStart).toBe("2026-09-26T09:00:00Z");
    // Every visible block is a clean third, so the widths still add to 100%.
    expect(new Set(shown.map((p) => p.lanes))).toEqual(new Set([MAX_LANES]));
    expect(shown.map((p) => p.lane).sort()).toEqual([0, 1, 2]);
  });

  it("leaves a day that fits completely alone", () => {
    const two = four.slice(0, 2);
    const { shown, hidden, overflowStart } = capLanes(packEvents(two));
    expect(shown).toHaveLength(2);
    expect(shown.every((p) => p.lanes === 2)).toBe(true);
    expect(hidden).toEqual([]);
    expect(overflowStart).toBeNull();
  });

  it("hides nothing when the blocks do not overlap", () => {
    const serial = [
      ev("a", "2026-09-26T09:00:00Z", "2026-09-26T10:00:00Z"),
      ev("b", "2026-09-26T11:00:00Z", "2026-09-26T12:00:00Z"),
      ev("c", "2026-09-26T13:00:00Z", "2026-09-26T14:00:00Z"),
      ev("d", "2026-09-26T15:00:00Z", "2026-09-26T16:00:00Z"),
    ];
    const { shown, hidden } = capLanes(packEvents(serial));
    expect(shown).toHaveLength(4);
    expect(hidden).toEqual([]);
  });

  it("never drops a block: shown plus hidden is everything", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      ev(`e${i}`, "2026-09-26T09:00:00Z", "2026-09-26T10:00:00Z"));
    const { shown, hidden } = capLanes(packEvents(many));
    expect(shown.length + hidden.length).toBe(9);
    expect(hidden).toHaveLength(6);
  });
});
