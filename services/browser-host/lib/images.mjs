// @ts-check
// The browser image, kept current, and the self-test that proves it
// (docs/plans/browser-host.md Decisions 3, 12 and 18, 5.2 and 8.4).
//
// THE BOOT SELF-TEST runs against workwrk-chrome:current while holding a
// slot: Chrome's version, chrome://sandbox, and the two probes. Until it
// passes, creates are refused (selftest_failed); a failure is tried again
// after 1 minute, then 2, 4 and 8, then every 10 (final contract review: one
// passing blip no longer keeps every browser down for 10 minutes, and a
// failure that lasts costs one self-test each 10 minutes). A server with no
// image yet builds one first.
//
// THE DAILY BUILD, at 04:15 server time, and hourly after a failed one:
//   1. hold a slot (6.2): a build waits for a free one up to 6 hours, trying
//      every 10 minutes, then gives that day up;
//   2. the launcher's build (docker build --pull, the day as CACHE_DAY);
//   3. the self-test and the probes against candidate;
//   4. on failure, images.json records it; with no good build in 3 days,
//      image_build_failing (503 on /healthz);
//   5. on success, promote when Chrome, the base image or the image's
//      Debian packages changed (the hash of `dpkg-query -W` the build
//      writes, which the self-test reads: final security review, M1; a hash
//      that cannot be read counts as a change), when current is 7 days old
//      or more, or when current failed its own self-test. Running sessions
//      keep their container. A candidate not promoted (unchanged, or failed)
//      is dropped at once.
//
// NO SLOT IS TAKEN WHILE THE HOST DRAINS: neither a build nor a self-test
// starts then, so the maintenance job's wait for nothing held is never
// lengthened by the image job (step 3 review, L9).
//
// chrome_stale refuses creates once current is 14 days old.
//
// images.json (<state dir>, 0600) holds current's Chrome version, build time,
// base digest and package hash, and the last attempts: never a session, a
// token or an address.

import fs from "node:fs";
import path from "node:path";

import { devtoolsJson } from "./devtools-json.mjs";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

/** Creates are refused once current is this old (Decision 12). */
export const STALE_DAYS = 14;
/** image_build_failing with no good build in this long (3.2). */
export const FAILING_DAYS = 3;
/** current is replaced at least this often (8.4). */
export const PROMOTE_AGE_DAYS = 7;
/** The daily build's time, server time (8.4). */
export const BUILD_AT = Object.freeze({ hour: 4, minute: 15 });
/** After a failed build, the next try. */
export const RETRY_FAILED_MS = HOUR_MS;
/** How long a due build waits for a free slot, and how often it asks. */
export const SLOT_WAIT_MS = 6 * HOUR_MS;
export const SLOT_TRY_MS = 10 * 60_000;
/** A failed boot self-test is tried again after this, doubling each time it fails again, up to SELFTEST_RETRY_MS. */
export const SELFTEST_RETRY_MIN_MS = 60_000;
/** The longest wait between two tries of a failing self-test. */
export const SELFTEST_RETRY_MS = 10 * 60_000;

/**
 * The wait before the next try of a self-test that has failed `failures` times in a row.
 * @param {number} failures
 */
export function selfTestRetryMs(failures) {
  return Math.min(SELFTEST_RETRY_MS, SELFTEST_RETRY_MIN_MS * 2 ** Math.max(0, Math.min(failures, 10) - 1));
}

/**
 * @typedef {{ chrome: string | null, builtAt: number | null, baseDigest: string | null, packages: string | null }} ImageRecord
 * @typedef {{
 *   v: 1,
 *   since: number,
 *   current: ImageRecord | null,
 *   lastAttemptAt: number | null,
 *   lastAttempt: "ok" | "failed" | "skipped" | null,
 *   lastGoodBuildAt: number | null,
 *   lastBuildFailedAt: number | null,
 * }} ImagesState
 * @typedef {import("./launcher-client.mjs").SelfTestResult} SelfTestResult
 * @typedef {{
 *   selfTest: (image: "current" | "candidate") => Promise<SelfTestResult>,
 *   build: () => Promise<{ created?: string | null, baseDigest?: string | null } | null>,
 *   promote: () => Promise<unknown>,
 *   drop: () => Promise<unknown>,
 * }} ImageLauncher
 */

/**
 * Whether a self-test passed: a version read, the sandbox in use, and every probe refused with EPERM (exit 0).
 * @param {SelfTestResult | null | undefined} r
 */
export function selfTestPassed(r) {
  return Boolean(r && r.chrome && r.sandbox && r.probes && r.probes.netlink === 0 && r.probes.netlinkHigh === 0 && r.probes.netAdmin === 0);
}

/**
 * The first BUILD_AT strictly after `t`, server time.
 * @param {number} t
 */
export function nextBuildAfter(t) {
  const d = new Date(t);
  d.setHours(BUILD_AT.hour, BUILD_AT.minute, 0, 0);
  if (d.getTime() <= t) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * When the next build is due.
 * @param {ImagesState} s
 */
export function buildDueAt(s) {
  if (!s.current) return s.lastAttempt === "failed" && s.lastAttemptAt !== null ? s.lastAttemptAt + RETRY_FAILED_MS : (s.lastAttemptAt ?? s.since);
  if (s.lastAttemptAt === null) return nextBuildAfter(s.since);
  if (s.lastAttempt === "failed") return s.lastAttemptAt + RETRY_FAILED_MS;
  return nextBuildAfter(s.lastAttemptAt);
}

/** @param {unknown} v @returns {number | null} */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** @param {unknown} v @returns {string | null} */
const str = (v) => (typeof v === "string" && v.length <= 200 ? v : null);

/**
 * A state read back, every field checked.
 * @param {unknown} raw
 * @param {number} now
 * @returns {ImagesState}
 */
export function readState(raw, now) {
  const r = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  const c = r.current && typeof r.current === "object" ? r.current : null;
  const attempt = r.lastAttempt === "ok" || r.lastAttempt === "failed" || r.lastAttempt === "skipped" ? r.lastAttempt : null;
  return {
    v: 1,
    since: num(r.since) ?? now,
    current: c ? { chrome: str(c.chrome), builtAt: num(c.builtAt), baseDigest: str(c.baseDigest), packages: str(c.packages) } : null,
    lastAttemptAt: num(r.lastAttemptAt),
    lastAttempt: attempt,
    lastGoodBuildAt: num(r.lastGoodBuildAt),
    lastBuildFailedAt: num(r.lastBuildFailedAt),
  };
}

/**
 * images.json in a folder.
 * @param {string} dir
 */
export function imagesFile(dir) {
  const file = path.join(dir, "images.json");
  return {
    read() {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        return null;
      }
    },
    /** @param {ImagesState} s */
    write(s) {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}

/**
 * The image manager.
 * @param {{
 *   launcher: ImageLauncher,
 *   holdSlot: (reason: string) => (() => void) | null,
 *   store: { read: () => unknown, write: (s: ImagesState) => void },
 *   wall?: () => number,
 *   draining?: () => boolean,
 *   log?: import("./log.mjs").Log,
 * }} o
 */
export function createImages(o) {
  const wall = o.wall ?? (() => Date.now());
  const draining = o.draining ?? (() => false);
  const s = readState(o.store.read(), wall());
  let selftestOk = false;
  /** @type {string | null} */
  let chrome = null;
  let lastSelftestAt = -Infinity;
  /** The self-test's failures in a row, for its next try (selfTestRetryMs). */
  let failures = 0;
  let lastSlotTryAt = -Infinity;
  let busy = false;
  let needImage = !s.current;

  const save = () => {
    try {
      o.store.write(s);
    } catch {
      o.log?.event("images", "write_failed");
    }
  };
  save();

  /**
   * Run `fn` with a slot held, or answer null when none is free.
   * @template T
   * @param {string} reason
   * @param {() => Promise<T>} fn
   * @returns {Promise<T | null>}
   */
  async function withSlot(reason, fn) {
    // Never while the host drains (L9).
    if (draining()) return null;
    const release = o.holdSlot(reason);
    if (!release) return null;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** The self-test of current, with a slot held. */
  async function testCurrent() {
    if (draining()) return;
    lastSelftestAt = wall();
    const r = await withSlot("selftest", async () => {
      try {
        return await o.launcher.selfTest("current");
      } catch (err) {
        // No current image (the Engine's 404): the next tick builds one.
        if (err instanceof Error && err.message === "engine_404") needImage = true;
        return null;
      }
    });
    if (r === null && !selftestOk) {
      failures += 1;
      o.log?.event("images", "selftest", "failed");
      return;
    }
    if (!r) return;
    selftestOk = selfTestPassed(r);
    if (selftestOk) {
      failures = 0;
      chrome = r.chrome;
      const builtAt = r.imageCreated ? Date.parse(r.imageCreated) : NaN;
      // The package hash is the image's own, as its self-test read it (null when it could not be).
      s.current = { chrome: r.chrome, builtAt: Number.isFinite(builtAt) ? builtAt : (s.current?.builtAt ?? null), baseDigest: s.current?.baseDigest ?? null, packages: r.packages ?? null };
      needImage = false;
      save();
    } else failures += 1;
    o.log?.event("images", "selftest", selftestOk ? "ok" : "failed");
  }

  /** One build, with a slot held (see the header). Answers false when no slot was free. */
  async function buildOnce() {
    const started = wall();
    const done = await withSlot("image_build", async () => {
      let ok = false;
      try {
        const b = await o.launcher.build();
        const t = await o.launcher.selfTest("candidate");
        if (!selfTestPassed(t)) throw new Error("candidate_failed");
        const cur = s.current;
        const age = cur?.builtAt ? wall() - cur.builtAt : Infinity;
        const baseDigest = b?.baseDigest ?? null;
        // Debian's own fixes count (M1): a package hash that differs, or that cannot be read, is a change.
        const packages = t.packages ?? null;
        const change = !cur || !selftestOk || needImage || t.chrome !== cur.chrome || baseDigest !== cur.baseDigest || packages === null || packages !== cur.packages || age >= PROMOTE_AGE_DAYS * DAY_MS;
        if (!change) await o.launcher.drop().catch(() => undefined);
        if (change) {
          await o.launcher.promote();
          const builtAt = Date.parse(String(b?.created ?? t.imageCreated ?? ""));
          s.current = { chrome: t.chrome, builtAt: Number.isFinite(builtAt) ? builtAt : wall(), baseDigest, packages };
          chrome = t.chrome;
          selftestOk = true;
          needImage = false;
        }
        ok = true;
        o.log?.event("images", "build", "ok", change ? "promoted" : "unchanged", { ms: wall() - started });
      } catch {
        // A failed candidate goes at once (L8); a failed drop leaves it for the next build, which removes it first.
        await o.launcher.drop().catch(() => undefined);
        o.log?.event("images", "build", "failed", { ms: wall() - started });
      }
      return ok;
    });
    if (done === null) return false;
    s.lastAttemptAt = wall();
    s.lastAttempt = done ? "ok" : "failed";
    if (done) s.lastGoodBuildAt = s.lastAttemptAt;
    else s.lastBuildFailedAt = s.lastAttemptAt;
    save();
    return true;
  }

  /** The build schedule: due, a slot, or a day given up after 6 hours of none. */
  async function maybeBuild() {
    if (draining()) return;
    const now = wall();
    // A missing image is built at once, unless the last try failed (then hourly, as any failed build).
    const due = needImage && s.lastAttempt !== "failed" ? Math.min(buildDueAt(s), now) : buildDueAt(s);
    if (now < due) return;
    if (now - lastSlotTryAt < SLOT_TRY_MS) return;
    lastSlotTryAt = now;
    if (await buildOnce()) {
      lastSlotTryAt = -Infinity;
      return;
    }
    if (now - due >= SLOT_WAIT_MS) {
      // Six hours without a free slot: this day's build is given up (it counts toward image_build_failing).
      s.lastAttemptAt = now;
      s.lastAttempt = "skipped";
      save();
      o.log?.event("images", "build", "skipped_full");
    }
  }

  return {
    /** At start, after the reaper: the self-test of current, or a first build when there is none. */
    async boot() {
      busy = true;
      try {
        if (!needImage) await testCurrent();
        if (needImage) {
          lastSlotTryAt = -Infinity;
          await maybeBuild();
        }
      } finally {
        busy = false;
      }
    },
    /** Every minute: a failed self-test tried again, and the build schedule. */
    async tick() {
      if (busy) return;
      busy = true;
      try {
        if (!selftestOk && !needImage && wall() - lastSelftestAt >= selfTestRetryMs(failures)) await testCurrent();
        await maybeBuild();
      } finally {
        busy = false;
      }
    },
    /** The problems of 3.2 the image raises. */
    problems() {
      const now = wall();
      /** @type {string[]} */
      const out = [];
      if (!selftestOk) out.push("selftest_failed");
      if (s.current?.builtAt && now - s.current.builtAt > STALE_DAYS * DAY_MS) out.push("chrome_stale");
      if (now - (s.lastGoodBuildAt ?? s.since) > FAILING_DAYS * DAY_MS) out.push("image_build_failing");
      return out;
    },
    /** /health's Chrome and image fields. */
    health() {
      const builtAt = s.current?.builtAt ?? null;
      const major = chrome ? Number(chrome.split(".")[0]) : null;
      return {
        chrome,
        chromeMajor: Number.isInteger(major) ? major : null,
        imageBuiltAt: builtAt ? new Date(builtAt).toISOString() : null,
        imageAgeDays: builtAt ? Math.max(0, Math.floor((wall() - builtAt) / DAY_MS)) : null,
      };
    },
    state: () => ({ ...s, selftestOk, needImage }),
  };
}

/**
 * Process mode's version read (H15): one Chrome launched like a session with
 * a slot held, its /json/version read, then stopped. Answers the full
 * version, or null. Run before the minute's sweep starts.
 * @param {import("./sessions.mjs").Launcher} launcher
 * @param {(reason: string) => (() => void) | null} holdSlot
 * @param {string} id
 * @returns {Promise<string | null>}
 */
export async function processChromeVersion(launcher, holdSlot, id) {
  const release = holdSlot("selftest");
  if (!release) return null;
  try {
    const l = await launcher.launch({ id, viewport: { width: 1280, height: 800 }, timeoutSeconds: 60, proof: false });
    try {
      const v = await devtoolsJson(`${l.devtoolsBase}/json/version`, { timeoutMs: 2000 });
      const m = /\/(\d+\.\d+\.\d+\.\d+)$/.exec(typeof v?.Browser === "string" ? v.Browser : "");
      return m ? m[1] : null;
    } finally {
      await l.stop().catch(() => undefined);
    }
  } catch {
    return null;
  } finally {
    release();
  }
}
