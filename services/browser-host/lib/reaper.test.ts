import { describe, expect, it } from "vitest";

import { reapEntries, sweepProfiles, terminate, type ReaperDeps } from "./reaper.mjs";

const PROFILES = "/state/profiles";

/** A fake system: processes by pid with their start time, the signals sent, the folders removed. */
function fakeSystem(procs: Array<{ pid: number; started: string; args: string; group?: number }>, dirs: string[] = []) {
  const live = new Map(procs.map((p) => [p.pid, p]));
  const signals: Array<[number, string]> = [];
  const removed: string[] = [];
  const deps: ReaperDeps = {
    processes: async () => [...live.values()].map((p) => ({ pid: p.pid, args: p.args })),
    startTime: async (pid) => live.get(pid)?.started ?? null,
    kill(target, signal) {
      signals.push([target, signal]);
      const hit = target < 0 ? [...live.values()].filter((p) => (p.group ?? p.pid) === -target) : live.has(target) ? [live.get(target)!] : [];
      if (hit.length === 0) return false;
      if (signal === "SIGTERM" || signal === "SIGKILL") for (const p of hit) live.delete(p.pid);
      return true;
    },
    alive: (pid) => live.has(pid),
    sleep: async () => undefined,
    rm: async (p) => void removed.push(p),
    list: async () => dirs,
  };
  return { deps, signals, removed, live };
}

const chrome = (id: string) => `/x/chrome-headless-shell --no-first-run --user-data-dir=${PROFILES}/${id} --remote-debugging-port=0 about:blank`;

describe("the reaper at start, over the state file", () => {
  it("kills an entry whose process still runs with the same start time, its whole group, and removes its profile", async () => {
    const sys = fakeSystem([
      { pid: 4100, started: "Tue Oct 20 10:00:00 2026", args: chrome("a") },
      { pid: 4101, started: "Tue Oct 20 10:00:01 2026", args: "/x/chrome-headless-shell --type=renderer", group: 4100 },
    ]);
    const killed = await reapEntries([{ id: "a", pid: 4100, pgid: 4100, started: "Tue Oct 20 10:00:00 2026", profile: `${PROFILES}/a` }], { profilesDir: PROFILES, deps: sys.deps });
    expect(killed).toBe(1);
    expect(sys.signals[0]).toEqual([-4100, "SIGTERM"]);
    expect(sys.live.size).toBe(0);
    expect(sys.removed).toEqual([`${PROFILES}/a`]);
  });

  it("leaves alone a pid that now belongs to another start time", async () => {
    const sys = fakeSystem([{ pid: 4100, started: "Wed Oct 21 09:00:00 2026", args: "/usr/bin/some-other-program" }]);
    const killed = await reapEntries([{ id: "a", pid: 4100, pgid: 4100, started: "Tue Oct 20 10:00:00 2026", profile: `${PROFILES}/a` }], { profilesDir: PROFILES, deps: sys.deps });
    expect(killed).toBe(0);
    expect(sys.signals).toEqual([]);
    expect(sys.live.has(4100)).toBe(true);
  });

  it("never signals pid 0 or 1, nor removes a profile outside the folder", async () => {
    const sys = fakeSystem([{ pid: 1, started: "boot", args: "/sbin/init" }]);
    await reapEntries(
      [
        { id: "a", pid: 1, pgid: 1, started: "boot", profile: "/etc" },
        { id: "b", pid: 0, pgid: 0, started: "boot", profile: `${PROFILES}/../../home` },
      ],
      { profilesDir: PROFILES, deps: sys.deps },
    );
    expect(sys.signals).toEqual([]);
    expect(sys.removed).toEqual([]);
    expect(await terminate(-1, 1, sys.deps)).toBe(false);
  });
});

describe("the sweep", () => {
  it("at start, kills every process holding a profile under the prefix and removes every stray profile", async () => {
    const sys = fakeSystem(
      [
        { pid: 5000, started: "s", args: chrome("old1") },
        { pid: 5001, started: "s", args: chrome("old2") },
        { pid: 5002, started: "s", args: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/me/Library/Chrome" },
        { pid: 5003, started: "s", args: "/x/chrome --user-data-dir=/state/profiles-other/z" },
      ],
      ["old1", "old2", "gone"],
    );
    expect(await sweepProfiles(() => [], { profilesDir: PROFILES, deps: sys.deps })).toBe(2);
    expect([...sys.live.keys()]).toEqual([5002, 5003]);
    expect(sys.removed).toEqual([`${PROFILES}/old1`, `${PROFILES}/old2`, `${PROFILES}/gone`]);
  });

  it("every minute, kills a Chrome no session owns and keeps the live ones", async () => {
    const sys = fakeSystem(
      [
        { pid: 6000, started: "s", args: chrome("live") },
        { pid: 6001, started: "s", args: chrome("stray") },
      ],
      ["live", "stray"],
    );
    expect(await sweepProfiles(() => ["live"], { profilesDir: PROFILES, deps: sys.deps })).toBe(1);
    expect([...sys.live.keys()]).toEqual([6000]);
    expect(sys.removed).toEqual([`${PROFILES}/stray`]);
  });

  it("a create that lands while ps runs is never killed or emptied: what it keeps is read after the listing (MEDIUM 1)", async () => {
    const sys = fakeSystem([{ pid: 7000, started: "s", args: chrome("stray") }], ["stray"]);
    const live = new Set<string>();
    let release = () => undefined as void;
    const gate = new Promise<void>((r) => (release = r));
    const listing = sys.deps.processes;
    // ps is slow: while it runs, a create puts its session in the table, then makes its folder and its Chrome.
    sys.deps.processes = async () => {
      await gate;
      return listing();
    };
    const sweeping = sweepProfiles(() => [...live], { profilesDir: PROFILES, deps: sys.deps });
    await Promise.resolve();
    live.add("new");
    sys.live.set(7001, { pid: 7001, started: "s", args: chrome("new") });
    const dirs = await sys.deps.list(PROFILES);
    sys.deps.list = async () => [...dirs, "new"];
    release();
    expect(await sweeping).toBe(1);
    expect([...sys.live.keys()]).toEqual([7001]);
    expect(sys.signals.some(([pid]) => pid === 7001)).toBe(false);
    expect(sys.removed).toEqual([`${PROFILES}/stray`]);
  });

  it("a folder made between the kills and the removals is kept: the getter is read again before removing", async () => {
    const sys = fakeSystem([], ["stray"]);
    const live = new Set<string>();
    const lister = sys.deps.list;
    sys.deps.list = async (dir) => {
      const names = await lister(dir);
      // A create lands as the folders are listed.
      live.add("late");
      return [...names, "late"];
    };
    await sweepProfiles(() => [...live], { profilesDir: PROFILES, deps: sys.deps });
    expect(sys.removed).toEqual([`${PROFILES}/stray`]);
  });
});
