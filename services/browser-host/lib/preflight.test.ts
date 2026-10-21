// Container mode's preflight (docs/plans/browser-host.md Decision 2, 5.4,
// 8.5 and Step 3), over a fake machine: a Postgres or the app beside the
// host, a missing AppArmor profile, a stale firewall.ok, IPv6 on in the
// daemon and an unreachable launcher each refuse creates.

import { describe, expect, it } from "vitest";

import { FIREWALL_OK_MAX_MS, firewallOkAt, listeningPorts, preflight, problemsOf, RUNC_FLOOR, swapAreas, versionAtLeast, type PreflightDeps } from "./preflight.mjs";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const SWAPS_HEADER = "Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority";
const HEADER = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const tcpLine = (hexPort: string, st = "0A") => `   0: 00000000:${hexPort} 00000000:0000 ${st} 00000000:00000000 00:00000000 00000000   998        0 1234 1 0000000000000000 100 0 0 10 0`;

/** A clean server: the host on 8789, Caddy on 443 and 80, sshd on 22; the profile loaded; the firewall checked a minute ago. */
function machine() {
  const files = new Map<string, string>([
    ["/proc/net/tcp", [HEADER, tcpLine("2255"), tcpLine("01BB"), tcpLine("0050"), tcpLine("0016"), tcpLine("1538", "01")].join("\n")],
    ["/proc/net/tcp6", [HEADER, "   0: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 99 1"].join("\n")],
    ["/proc/1/comm", "systemd\n"],
    ["/proc/1/cmdline", "/sbin/init\0splash\0"],
    ["/proc/812/comm", "node\n"],
    ["/proc/812/cmdline", "/usr/bin/node\0/opt/workwrk-browser-host/current/main.mjs\0"],
    ["/etc/docker/daemon.json", JSON.stringify({ ipv6: false, icc: false, "userland-proxy": false, "live-restore": false, "no-new-privileges": true, "log-driver": "none" })],
    ["/var/lib/workwrk-browser-host/firewall.ok", `${new Date(NOW - 60_000).toISOString()}\n`],
    ["/proc/swaps", `${SWAPS_HEADER}\n`],
  ]);
  const dirs = new Map<string, string[]>([
    ["/proc", ["1", "812", "self", "net"]],
    ["/sys/kernel/security/apparmor/policy/profiles", ["docker-default.3", "workwrk-browser.7", "snap.lxd.0"]],
  ]);
  const m = {
    files,
    dirs,
    versions: { docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3" } as Record<string, string> | null,
    deps: null as unknown as PreflightDeps,
  };
  m.deps = {
    readFile: (p) => files.get(p) ?? null,
    listDir: (p) => dirs.get(p) ?? null,
    now: () => NOW,
    firewallOk: "/var/lib/workwrk-browser-host/firewall.ok",
    versions: async () => m.versions,
  };
  return m;
}

describe("the preflight", () => {
  it("passes a clean server", async () => {
    expect(await preflight(machine().deps)).toEqual([]);
  });

  it("refuses creates while /proc/swaps lists any swap area, or cannot be read (final privacy review, M3)", async () => {
    const m = machine();
    m.files.set("/proc/swaps", `${SWAPS_HEADER}\n/swap.img                               file\t\t4194300\t\t0\t\t-2\n`);
    expect(await preflight(m.deps)).toEqual(["swap_on"]);
    expect(problemsOf(["swap_on"])).toEqual(["preflight"]);
    m.files.delete("/proc/swaps");
    expect(await preflight(m.deps)).toEqual(["swap_unreadable"]);
    expect([swapAreas(`${SWAPS_HEADER}\n`), swapAreas(SWAPS_HEADER), swapAreas(null)]).toEqual([0, 0, null]);
  });

  it("refuses a /proc/net/tcp listener on 5432 (:1538), 5433 or 3000, in tcp or tcp6", async () => {
    for (const [port, code] of [["1538", "postgres_listener"], ["1539", "postgres_listener"], ["0BB8", "app_listener"]]) {
      const m = machine();
      m.files.set("/proc/net/tcp", `${m.files.get("/proc/net/tcp")}\n${tcpLine(port)}`);
      expect(await preflight(m.deps)).toEqual([code]);
    }
    const m = machine();
    m.files.set("/proc/net/tcp6", `${m.files.get("/proc/net/tcp6")}\n   1: 00000000000000000000000001000000:1538 00000000000000000000000000000000:0000 0A 0 0 0 0 0 1`);
    expect(await preflight(m.deps)).toEqual(["postgres_listener"]);
    // A connection from a 5432 port that is not listening is no listener.
    expect(listeningPorts([HEADER, tcpLine("1538", "01")].join("\n")).has(5432)).toBe(false);
  });

  it("refuses a next-server or a postgres process", async () => {
    const m = machine();
    m.dirs.set("/proc", ["1", "812", "4021"]);
    m.files.set("/proc/4021/comm", "next-server (v1\n");
    m.files.set("/proc/4021/cmdline", "next-server (v15.5.0)\0");
    expect(await preflight(m.deps)).toEqual(["app_process"]);
    m.files.set("/proc/4021/comm", "postgres\n");
    m.files.set("/proc/4021/cmdline", "/usr/lib/postgresql/16/bin/postgres\0-D\0/var/lib/postgresql\0");
    expect(await preflight(m.deps)).toEqual(["postgres_process"]);
  });

  it("refuses a missing AppArmor profile, or a profile list it cannot read", async () => {
    const m = machine();
    m.dirs.set("/sys/kernel/security/apparmor/policy/profiles", ["docker-default.3"]);
    expect(await preflight(m.deps)).toEqual(["apparmor_profile"]);
    m.dirs.delete("/sys/kernel/security/apparmor/policy/profiles");
    expect(await preflight(m.deps)).toEqual(["apparmor_profile"]);
  });

  it("refuses a stale or missing firewall.ok", async () => {
    const m = machine();
    m.files.set(m.deps.firewallOk, `${new Date(NOW - FIREWALL_OK_MAX_MS - 1000).toISOString()}\n`);
    expect(await preflight(m.deps)).toEqual(["firewall_stale"]);
    m.files.delete(m.deps.firewallOk);
    expect(await preflight(m.deps)).toEqual(["firewall_stale"]);
    expect(firewallOkAt("not a time")).toBeNull();
  });

  it("refuses IPv6 on in the daemon, or a daemon.json missing", async () => {
    const m = machine();
    m.files.set("/etc/docker/daemon.json", JSON.stringify({ ipv6: true }));
    expect(await preflight(m.deps)).toEqual(["daemon_ipv6"]);
    m.files.set("/etc/docker/daemon.json", JSON.stringify({ icc: false }));
    expect(await preflight(m.deps)).toEqual(["daemon_ipv6"]);
    m.files.delete("/etc/docker/daemon.json");
    expect(await preflight(m.deps)).toEqual(["daemon_config"]);
  });

  it("refuses an unreachable launcher socket, and a runc below the floor", async () => {
    const m = machine();
    m.versions = null;
    expect(await preflight(m.deps)).toEqual(["launcher_socket"]);
    m.deps.versions = async () => {
      throw new Error("launcher_unreachable");
    };
    expect(await preflight(m.deps)).toEqual(["launcher_socket"]);
    const old = machine();
    old.versions = { docker: "29.0.0", containerd: "v2.1.4", runc: "1.3.2" };
    expect(await preflight(old.deps)).toEqual(["runc_below_floor"]);
    expect(RUNC_FLOOR).toBe("1.3.3");
    expect(["1.3.3", "v1.3.4", "1.4.0", "2.0.0", "1.3.3-0ubuntu1"].map((v) => versionAtLeast(v, RUNC_FLOOR))).toEqual([true, true, true, true, true]);
    expect(["1.3.2", "1.2.9", "v1.1.15", "", "dev"].map((v) => versionAtLeast(v, RUNC_FLOOR))).toEqual([false, false, false, false, false]);
  });

  it("raises the firewall and the launcher by their own problem codes, everything else as preflight", () => {
    expect(problemsOf(["firewall_stale", "launcher_socket", "apparmor_profile", "daemon_ipv6"])).toEqual(["firewall_unchecked", "launcher_unreachable", "preflight"]);
    expect(problemsOf([])).toEqual([]);
  });
});
