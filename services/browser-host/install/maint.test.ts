// The server's daily maintenance (docs/plans/browser-host.md 8.4 and Step
// 3), with fake apt, systemctl and admin socket: nothing pending means no
// drain; a pending containerd.io, or a reboot required, drains, waits, stops
// the host and the launcher, applies and starts them again; a drain past 40
// minutes reports drain_stuck and applies anyway; a host that does not answer
// gets nothing applied.

import { describe, expect, it } from "vitest";

import { drainAndWait, DRAIN_POLL_MS, DRAIN_WAIT_MS, MAINT_PATHS, maintain, START_UNITS, STOP_UNITS, upgradable, type MaintDeps } from "./maint.mjs";

const APT_LIST = (rows: string[]) => ["Listing...", ...rows].join("\n");
const CONTAINERD = "containerd.io/noble 2.1.5-1~ubuntu.24.04~noble amd64 [upgradable from: 2.1.4-1~ubuntu.24.04~noble]";
const LIBC = "libc6/noble-updates 2.39-0ubuntu8.6 amd64 [upgradable from: 2.39-0ubuntu8.5]";
const INSTALL_CONTAINERD = "apt-get install -y -q --only-upgrade -o Dpkg::Options::=--force-confold containerd.io";
const STOP = "systemctl stop workwrk-browser-host.service workwrk-browser-launcher.service";
const START = "systemctl start workwrk-browser-launcher.service workwrk-browser-host.service";

type Answer = Record<string, unknown> | null;

function server(o: { list?: string[]; reboot?: boolean; running?: number[]; rebootAfterInstall?: boolean; needrestart?: string[]; drain?: Answer; statusAfter?: number; failAt?: string } = {}) {
  const s = {
    events: [] as string[],
    t: 0,
    reboot: o.reboot ?? false,
    running: [...(o.running ?? [0])],
    statuses: 0,
    files: new Map<string, string>(),
    logs: [] as string[],
    deps: null as unknown as MaintDeps,
  };
  s.deps = {
    exec: async (cmd, args) => {
      const c = [cmd, ...args].join(" ");
      s.events.push(c);
      if (o.failAt && c === o.failAt) throw new Error("exec_failed");
      if (c === "apt list --upgradable") return { code: 0, stdout: APT_LIST(o.list ?? []) };
      if (c === "needrestart -b -r l") return { code: 0, stdout: ["NEEDRESTART-VER: 3.6", "NEEDRESTART-KSTA: 1", ...(o.needrestart ?? [])].join("\n") };
      if (cmd === "apt-get" && args[0] === "install" && o.rebootAfterInstall) s.reboot = true;
      if (c === "caddy version") return { code: 0, stdout: "v2.10.2 h1:abc=\n" };
      if (c === "node --version") return { code: 0, stdout: "v24.11.0\n" };
      if (c === "uname -r") return { code: 0, stdout: "6.8.0-86-generic\n" };
      return { code: 0, stdout: "" };
    },
    exists: (p) => p === MAINT_PATHS.rebootFlag && s.reboot,
    admin: async (op) => {
      s.events.push(`admin ${op}`);
      if (op === "drain") return o.drain === undefined ? { ok: true } : o.drain;
      if (op === "status") {
        s.statuses += 1;
        if (o.statusAfter !== undefined && s.statuses > o.statusAfter) return null;
        const running = s.running.length > 1 ? s.running.shift()! : s.running[0];
        return { ok: true, result: { running, starting: 0, held: 0 } };
      }
      return { ok: true };
    },
    sleep: async (ms) => {
      s.t += ms;
    },
    now: () => s.t,
    writeFile: (p, text) => void s.files.set(p, text),
    log: (line) => void s.logs.push(line),
  };
  return s;
}
const order = (s: ReturnType<typeof server>) => s.events.filter((e) => e.startsWith("admin") || e.startsWith("apt-get install") || e.startsWith("systemctl"));

describe("the daily maintenance", () => {
  it("drains nothing when nothing is pending, and writes the versions", async () => {
    const s = server({ list: [LIBC] });
    expect(await maintain(s.deps)).toMatchObject({ pending: [], reboot: false, drained: false, applied: false });
    expect(order(s)).toEqual([]);
    expect(JSON.parse(s.files.get(MAINT_PATHS.versions)!)).toMatchObject({ caddy: "v2.10.2", node: "v24.11.0", kernel: "6.8.0-86-generic" });
  });

  it("drains for a pending containerd.io, waits until nothing runs, stops the host and the launcher, applies, and starts them again", async () => {
    const s = server({ list: [CONTAINERD, LIBC], running: [2, 1, 0] });
    expect(await maintain(s.deps)).toMatchObject({ pending: ["containerd.io"], answered: true, drained: true, stuck: false, applied: true, rebooted: false });
    expect(order(s)).toEqual(["admin drain", "admin status", "admin status", "admin status", STOP, INSTALL_CONTAINERD, START, "systemctl restart caddy.service", "admin undrain"]);
    expect(STOP_UNITS).toEqual(["workwrk-browser-host.service", "workwrk-browser-launcher.service"]);
    expect(START_UNITS).toEqual(["workwrk-browser-launcher.service", "workwrk-browser-host.service"]);
    expect(s.logs).toContain("[maint] applied containerd.io=2.1.5-1~ubuntu.24.04~noble");
    expect(s.files.has(MAINT_PATHS.versions)).toBe(true);
  });

  it("drains, waits, stops and reboots when a reboot is required, with nothing to install", async () => {
    const s = server({ reboot: true, running: [1, 0] });
    expect(await maintain(s.deps)).toMatchObject({ pending: [], reboot: true, drained: true, rebooted: true });
    expect(order(s)).toEqual(["admin drain", "admin status", "admin status", STOP, "systemctl reboot"]);
    // A reboot undrains by itself: nothing is asked of a host that is going down.
    expect(s.events).not.toContain("admin undrain");
  });

  it("reboots after an upgrade that asks for one, instead of starting the host again", async () => {
    const s = server({ list: [CONTAINERD], rebootAfterInstall: true });
    expect(await maintain(s.deps)).toMatchObject({ applied: true, rebooted: true });
    expect(s.events.at(-1)).toBe("systemctl reboot");
    expect(s.events.some((e) => e.startsWith("systemctl start") || e.startsWith("systemctl restart"))).toBe(false);
  });

  it("reports drain_stuck after 40 minutes and applies anyway", async () => {
    const s = server({ list: [CONTAINERD], running: [1] });
    expect(await maintain(s.deps)).toMatchObject({ answered: true, drained: true, stuck: true, applied: true });
    expect(s.t).toBeGreaterThanOrEqual(DRAIN_WAIT_MS);
    expect(s.t).toBeLessThan(DRAIN_WAIT_MS + DRAIN_POLL_MS + 1);
    expect(s.logs).toContain("[maint] drain_stuck applying_anyway");
    expect(s.events).toContain(INSTALL_CONTAINERD);
  });

  it("applies nothing when the host does not answer the drain, or stops answering while it waits", async () => {
    for (const s of [server({ list: [CONTAINERD], drain: null }), server({ list: [CONTAINERD], drain: { ok: false, error: "unknown_op" } }), server({ list: [CONTAINERD], running: [3, 2, 1], statusAfter: 2 })]) {
      expect(await maintain(s.deps)).toMatchObject({ answered: false, applied: false, rebooted: false });
      expect(s.events.some((e) => e.startsWith("apt-get install") || e.startsWith("systemctl"))).toBe(false);
      expect(s.logs).toContain("[maint] host_unanswered not_applying");
      expect(s.files.has(MAINT_PATHS.versions)).toBe(true);
    }
  });

  it("undrains, best effort, whenever it gives up after a drain the host answered (final contract review, M3)", async () => {
    // A status that stops answering: the host is not left refusing every browser.
    const s = server({ list: [CONTAINERD], running: [3, 2, 1], statusAfter: 2 });
    await maintain(s.deps);
    expect(order(s)).toEqual(["admin drain", "admin status", "admin status", "admin status", "admin undrain"]);
    // A drain the host never answered is not followed by an undrain.
    const none = server({ list: [CONTAINERD], drain: null });
    await maintain(none.deps);
    expect(none.events).not.toContain("admin undrain");
    // drain-wait (install.sh --update) does the same.
    const w = server({ running: [2], statusAfter: 1 });
    expect(await drainAndWait(w.deps)).toEqual({ answered: false, drained: true, stuck: false });
    expect(order(w)).toEqual(["admin drain", "admin status", "admin status", "admin undrain"]);
  });

  it("a step that fails after the drain starts the host it stopped and undrains it, then reports the failure", async () => {
    const s = server({ list: [CONTAINERD], failAt: INSTALL_CONTAINERD });
    await expect(maintain(s.deps)).rejects.toThrow("exec_failed");
    expect(order(s)).toEqual(["admin drain", "admin status", STOP, INSTALL_CONTAINERD, START, "admin undrain"]);
    expect(s.logs).toContain("[maint] failed_after_drain");
  });

  it("drains and restarts Docker's units and ours when needrestart says they run on a replaced library, and nothing else of the system", async () => {
    const s = server({ needrestart: ["NEEDRESTART-SVC: docker.service", "NEEDRESTART-SVC: containerd.service", "NEEDRESTART-SVC: cron.service"] });
    expect(await maintain(s.deps)).toMatchObject({ pending: [], stale: ["docker.service", "containerd.service"], drained: true });
    expect(order(s)).toEqual(["admin drain", "admin status", STOP, "systemctl restart containerd.service docker.service", START, "systemctl restart caddy.service", "admin undrain"]);
    // A library update to anything else is no reason to drain.
    const quiet = server({ needrestart: ["NEEDRESTART-SVC: cron.service", "NEEDRESTART-SVC: ssh.service"] });
    expect(await maintain(quiet.deps)).toMatchObject({ stale: [], drained: false });
  });

  it("writes versions.json into a folder root owns, never the host's", () => {
    expect(MAINT_PATHS.versions).toBe("/var/lib/workwrk-browser-maint/versions.json");
  });

  it("reads only the watched packages from apt list", () => {
    expect(
      upgradable(
        APT_LIST([
          CONTAINERD,
          LIBC,
          "docker-ce/noble 5:29.0.5-1~ubuntu.24.04~noble amd64 [upgradable from: 5:29.0.4-1~ubuntu.24.04~noble]",
          "caddy/any-version 2.10.3 amd64 [upgradable from: 2.10.2]",
          "nodejs/nodistro 24.12.0-1nodesource1 amd64 [upgradable from: 24.11.0-1nodesource1]",
        ]),
      ),
    ).toEqual([
      { name: "containerd.io", version: "2.1.5-1~ubuntu.24.04~noble" },
      { name: "docker-ce", version: "5:29.0.5-1~ubuntu.24.04~noble" },
      { name: "caddy", version: "2.10.3" },
      { name: "nodejs", version: "24.12.0-1nodesource1" },
    ]);
  });
});
