// The browser image kept current (docs/plans/browser-host.md Decisions 12
// and 18, 5.2 and 8.4): the boot self-test, the daily build, promotion only
// on a change, the problems it raises, and every build and self-test run
// only while a free slot is held.

import { describe, expect, it } from "vitest";

import { buildDueAt, createImages, nextBuildAfter, PROMOTE_AGE_DAYS, readState, selfTestPassed, SLOT_TRY_MS, type ImagesState } from "./images.mjs";

const DAY = 24 * 60 * 60_000;
const MIN = 60_000;
/** 10:00 server time on 21 October 2026. */
const T0 = new Date(2026, 9, 21, 10, 0, 0, 0).getTime();
const GOOD = { chrome: "154.0.7499.40", sandbox: "namespace seccomp_bpf", probes: { netlink: 0, netlinkHigh: 0, netAdmin: 0 }, imageCreated: new Date(T0 - DAY).toISOString() };

function rig(o: { stored?: unknown; free?: boolean } = {}) {
  const r = {
    now: T0,
    free: o.free ?? true,
    draining: false,
    held: 0,
    asks: 0,
    calls: [] as string[],
    /** What the launcher's self-test answers, by image. */
    selfTest: { current: GOOD as unknown, candidate: { ...GOOD, chrome: "155.0.7600.10", imageCreated: new Date(T0).toISOString() } as unknown },
    buildFails: false,
    baseDigest: "debian@sha256:base1",
    stored: o.stored ?? null,
    writes: [] as ImagesState[],
  };
  const images = createImages({
    wall: () => r.now,
    draining: () => r.draining,
    holdSlot: (reason) => {
      r.asks += 1;
      if (!r.free) return null;
      r.held += 1;
      r.calls.push(`hold ${reason}`);
      return () => {
        r.held -= 1;
        r.calls.push(`release ${reason}`);
      };
    },
    launcher: {
      selfTest: async (image) => {
        r.calls.push(`selftest ${image} held=${r.held}`);
        const a = r.selfTest[image];
        if (a instanceof Error) throw a;
        return a as never;
      },
      build: async () => {
        r.calls.push(`build held=${r.held}`);
        if (r.buildFails) throw new Error("build_failed");
        return { created: new Date(r.now).toISOString(), baseDigest: r.baseDigest };
      },
      promote: async () => {
        r.calls.push("promote");
        return { tag: "x" };
      },
      drop: async () => {
        r.calls.push("drop");
        return { dropped: true };
      },
    },
    store: { read: () => r.stored, write: (s) => void r.writes.push(JSON.parse(JSON.stringify(s))) },
  });
  return Object.assign(r, { images });
}

/** A server whose image was built yesterday, and whose build at 04:15 today changed nothing. */
const TODAY_0430 = T0 - 330 * MIN;
const BUILT = { v: 1, since: T0 - 30 * DAY, current: { chrome: "154.0.7499.40", builtAt: T0 - DAY, baseDigest: "debian@sha256:base1" }, lastAttemptAt: TODAY_0430, lastAttempt: "ok", lastGoodBuildAt: TODAY_0430, lastBuildFailedAt: null };

describe("the boot self-test", () => {
  it("passes on current with a slot held, and /health shows its Chrome and the image's age", async () => {
    const r = rig({ stored: BUILT });
    expect(r.images.problems()).toEqual(["selftest_failed"]);
    await r.images.boot();
    expect(r.calls).toEqual(["hold selftest", "selftest current held=1", "release selftest"]);
    expect(r.images.problems()).toEqual([]);
    expect(r.images.health()).toEqual({ chrome: "154.0.7499.40", chromeMajor: 154, imageBuiltAt: new Date(T0 - DAY).toISOString(), imageAgeDays: 1 });
  });

  it("refuses creates while it fails, and tries again after 10 minutes, not before", async () => {
    const r = rig({ stored: BUILT });
    r.selfTest.current = { ...GOOD, probes: { netlink: 0, netlinkHigh: 0, netAdmin: 1 } };
    await r.images.boot();
    expect(r.images.problems()).toEqual(["selftest_failed"]);
    r.now += 9 * MIN;
    await r.images.tick();
    expect(r.calls.filter((c) => c.startsWith("selftest current"))).toHaveLength(1);
    r.selfTest.current = GOOD;
    r.now += 1 * MIN;
    await r.images.tick();
    expect(r.calls.filter((c) => c.startsWith("selftest current"))).toHaveLength(2);
    expect(r.calls.filter((c) => c.startsWith("build"))).toHaveLength(0);
    expect(r.images.problems()).toEqual([]);
  });

  it("runs no self-test and no build without a free slot", async () => {
    const r = rig({ stored: BUILT, free: false });
    await r.images.boot();
    r.now = nextBuildAfter(T0) + MIN;
    for (let i = 0; i < 20; i += 1) {
      await r.images.tick();
      r.now += SLOT_TRY_MS;
    }
    expect(r.calls).toEqual([]);
    expect(r.images.problems()).toContain("selftest_failed");
  });

  it("builds the first image on a server that has none, and promotes it", async () => {
    const r = rig();
    await r.images.boot();
    expect(r.calls).toEqual(["hold image_build", "build held=1", "selftest candidate held=1", "promote", "release image_build"]);
    expect(r.images.problems()).toEqual([]);
    expect(r.images.health().chrome).toBe("155.0.7600.10");
    expect(r.writes.at(-1)).toMatchObject({ current: { chrome: "155.0.7600.10", baseDigest: "debian@sha256:base1" }, lastAttempt: "ok", lastGoodBuildAt: T0 });
  });

  it("builds at once when Docker has no current image, whatever images.json says", async () => {
    const r = rig({ stored: BUILT });
    r.selfTest.current = new Error("engine_404");
    await r.images.boot();
    expect(r.calls).toContain("build held=1");
    expect(r.calls).toContain("promote");
    expect(r.images.problems()).toEqual([]);
  });
});

describe("the daily build", () => {
  it("is due at the next 04:15, and promotes only when Chrome or the base changed", async () => {
    const r = rig({ stored: BUILT });
    await r.images.boot();
    r.calls.length = 0;
    // Before 04:15 tomorrow: nothing.
    r.now = nextBuildAfter(T0) - MIN;
    await r.images.tick();
    expect(r.calls).toEqual([]);
    // At 04:15: a build, and the same Chrome and base: no promote.
    r.now = nextBuildAfter(T0);
    r.selfTest.candidate = { ...GOOD, imageCreated: new Date(r.now).toISOString() };
    await r.images.tick();
    // Unchanged: the candidate is dropped at once.
    expect(r.calls).toEqual(["hold image_build", "build held=1", "selftest candidate held=1", "drop", "release image_build"]);
    // The next day: a new Chrome, promoted.
    r.calls.length = 0;
    r.now = nextBuildAfter(r.now);
    r.selfTest.candidate = { ...GOOD, chrome: "155.0.7600.10" };
    await r.images.tick();
    expect(r.calls).toContain("promote");
    expect(r.images.health().chrome).toBe("155.0.7600.10");
    // And a new base image alone promotes too.
    r.calls.length = 0;
    r.now = nextBuildAfter(r.now);
    r.baseDigest = "debian@sha256:base2";
    await r.images.tick();
    expect(r.calls).toContain("promote");
  });

  it(`promotes an unchanged image once current is ${PROMOTE_AGE_DAYS} days old`, async () => {
    const r = rig({ stored: { ...BUILT, current: { ...BUILT.current, builtAt: T0 - 6 * DAY } } });
    r.selfTest.current = { ...GOOD, imageCreated: new Date(T0 - 6 * DAY).toISOString() };
    await r.images.boot();
    r.selfTest.candidate = GOOD;
    r.calls.length = 0;
    r.now = nextBuildAfter(T0);
    await r.images.tick();
    // 6 days and some hours: not yet.
    expect(r.calls).not.toContain("promote");
    r.now = nextBuildAfter(r.now);
    await r.images.tick();
    expect(r.calls).toContain("promote");
  });

  it("keeps current when the candidate fails its self-test, tries again hourly, and raises image_build_failing after 3 days", async () => {
    const r = rig({ stored: BUILT });
    await r.images.boot();
    r.selfTest.candidate = { ...GOOD, sandbox: null };
    r.calls.length = 0;
    r.now = nextBuildAfter(T0);
    await r.images.tick();
    expect(r.calls).not.toContain("promote");
    expect(r.images.health().chrome).toBe("154.0.7499.40");
    const builds = () => r.calls.filter((c) => c.startsWith("build")).length;
    expect(builds()).toBe(1);
    r.now += 59 * MIN;
    await r.images.tick();
    expect(builds()).toBe(1);
    r.now += MIN;
    await r.images.tick();
    expect(builds()).toBe(2);
    expect(r.images.problems()).toEqual([]);
    // Every try failing until three days pass without a good build.
    r.buildFails = true;
    for (let i = 0; i < 3 * 24; i += 1) {
      r.now += 60 * MIN;
      await r.images.tick();
    }
    expect(r.images.problems()).toContain("image_build_failing");
  });

  it("drops a candidate that fails its self-test, and keeps current", async () => {
    const r = rig({ stored: BUILT });
    await r.images.boot();
    r.selfTest.candidate = { ...GOOD, probes: { netlink: 0, netlinkHigh: 1, netAdmin: 0 } };
    r.calls.length = 0;
    r.now = nextBuildAfter(T0);
    await r.images.tick();
    expect(r.calls).toEqual(["hold image_build", "build held=1", "selftest candidate held=1", "drop", "release image_build"]);
    expect(r.images.health().chrome).toBe("154.0.7499.40");
  });

  it("takes no slot, for a build or a self-test, while the host drains", async () => {
    const r = rig({ stored: BUILT });
    r.draining = true;
    await r.images.boot();
    r.now = nextBuildAfter(T0) + MIN;
    for (let i = 0; i < 12; i += 1) {
      await r.images.tick();
      r.now += SLOT_TRY_MS;
    }
    expect(r.asks).toBe(0);
    expect(r.calls).toEqual([]);
    // Once the drain is over (a restart), both run.
    r.draining = false;
    await r.images.tick();
    expect(r.calls).toContain("selftest current held=1");
    expect(r.calls).toContain("build held=1");
  });

  it("raises chrome_stale once current is 14 days old", async () => {
    const r = rig({ stored: { ...BUILT, current: { ...BUILT.current, builtAt: T0 - 13 * DAY } } });
    r.selfTest.current = { ...GOOD, imageCreated: new Date(T0 - 13 * DAY).toISOString() };
    await r.images.boot();
    expect(r.images.problems()).toEqual([]);
    r.free = false;
    r.now += DAY + MIN;
    await r.images.tick();
    expect(r.images.problems()).toContain("chrome_stale");
    expect(r.images.health().imageAgeDays).toBe(14);
  });

  it("waits for a free slot every 10 minutes, up to 6 hours, then gives the day up", async () => {
    // Built at 04:30 today: the next build is due at 04:15 tomorrow.
    const r = rig({ stored: BUILT });
    await r.images.boot();
    r.free = false;
    r.calls.length = 0;
    r.asks = 0;
    const due = nextBuildAfter(T0);
    r.now = due - 30 * MIN;
    for (let m = 0; m <= 6 * 60 + 60; m += 1) {
      await r.images.tick();
      r.now += MIN;
    }
    expect(r.calls).toEqual([]);
    // From 04:15 to 10:15, every 10 minutes: 37 asks, and none after the day was given up.
    expect(r.asks).toBe(37);
    const st = r.images.state();
    expect(st.lastAttempt).toBe("skipped");
    expect(st.lastAttemptAt).toBe(due + 6 * 60 * MIN);
    expect(buildDueAt(st)).toBe(nextBuildAfter(due + 6 * 60 * MIN));
    // Freed later the same day: still nothing until the next 04:15.
    r.free = true;
    await r.images.tick();
    expect(r.calls).toEqual([]);
    r.now = nextBuildAfter(r.now);
    await r.images.tick();
    expect(r.calls).toContain("build held=1");
  });
});

describe("its parts", () => {
  it("passes a self-test only with a version, the sandbox and both probes refused", () => {
    expect(selfTestPassed(GOOD)).toBe(true);
    expect(selfTestPassed({ ...GOOD, sandbox: null })).toBe(false);
    expect(selfTestPassed({ ...GOOD, probes: { netlink: 1, netlinkHigh: 0, netAdmin: 0 } })).toBe(false);
    // The high bits probe: refused only when it exits 0 (EPERM); 3 is another refusal, 1 an open socket.
    for (const c of [1, 3, null]) expect(selfTestPassed({ ...GOOD, probes: { netlink: 0, netlinkHigh: c, netAdmin: 0 } })).toBe(false);
    expect(selfTestPassed({ ...GOOD, probes: null })).toBe(false);
    expect(selfTestPassed(null)).toBe(false);
  });

  it("reads images.json back field by field, and the next 04:15", () => {
    expect(readState({ current: { chrome: 5, builtAt: "x" }, lastAttempt: "maybe", since: 7 }, 9)).toEqual({ v: 1, since: 7, current: { chrome: null, builtAt: null, baseDigest: null }, lastAttemptAt: null, lastAttempt: null, lastGoodBuildAt: null, lastBuildFailedAt: null });
    const at = new Date(nextBuildAfter(T0));
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([22, 4, 15]);
    const early = new Date(2026, 9, 21, 3, 0).getTime();
    expect(new Date(nextBuildAfter(early)).getDate()).toBe(21);
  });
});
