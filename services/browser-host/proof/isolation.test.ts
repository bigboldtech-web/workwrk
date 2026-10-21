// The server isolation proof's plan and parsing (docs/plans/browser-host.md
// 12.3). It runs only as root on the browser server, so here: what it
// refuses, the table it builds, how it reads each tool, the container
// checks, and a whole run over a simulated server (every command answered
// by a fake that plays the firewall), so the run's own code is exercised
// end to end without Docker.

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { containerCreateBody } from "../launcher/bodies.mjs";
import { COUNTERS, publicAddresses } from "../lib/firewall.mjs";
import {
  browserIdOf,
  cleanupCommands,
  counterFor,
  counterMoves,
  counterValues,
  DEADMAN_SECONDS,
  DEADMAN_UNIT,
  deadmanCommands,
  curlOutcome,
  digOutcome,
  DOCKER0,
  duplicateRules,
  envValue,
  firewallBeforeDocker,
  globalV6,
  HOST_ENV,
  FIREWALL_ENV,
  inspectChecks,
  LINK,
  LINK_HOST,
  LISTENER_DEV,
  LISTENERS,
  listenerCommand,
  localAddresses,
  localConnect,
  METADATA,
  mustWork,
  needlesIn,
  networkPlan,
  PROOF_NS,
  refusal,
  refusalMessage,
  routeDestinations,
  runProof,
  SAVED_LISTING,
  searchRoots,
  setupCommands,
  SIGNALS,
  statsBytes,
  stopRefusal,
  systemctlShow,
  USED_COUNTERS,
  wsRefusedBy,
  containerOf,
  holdsIdPart,
  idNeedles,
  POLICY_NAMES,
  STATE_FILE,
  type Deps,
  type PlanContext,
} from "./isolation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, "..", "main.mjs");

const HOST_ENV_TEXT = [
  "BROWSER_HOST_MODE=container",
  "BROWSER_HOST_PORT=8789",
  "BROWSER_HOST_PUBLIC_URL=https://browsers.example.test",
  "BROWSER_HOST_APP_ORIGIN=https://app.example.test",
  `BROWSER_HOST_KEY_SHA256=${"a".repeat(64)}`,
  "BROWSER_HOST_REGION=us-east-1",
  "BROWSER_HOST_SESSION_MEMORY_MB=1280",
  "",
].join("\n");
const GOOD = { platform: "linux", uid: 0, hostEnv: HOST_ENV_TEXT, key: "k".repeat(64), health: { status: 200, mode: "container" } };

describe("where it runs: as root on the browser server, in container mode, and nowhere else", () => {
  it("refuses another system, a user that is not root, a machine without host.env, process mode, no key, and a host that does not answer or refuses the key", () => {
    expect(refusal(GOOD)).toBeNull();
    expect(refusal({ ...GOOD, platform: "darwin" })).toMatch(/not Linux/);
    expect(refusal({ ...GOOD, uid: 501 })).toMatch(/as root/);
    expect(refusal({ ...GOOD, uid: null })).toMatch(/as root/);
    expect(refusal({ ...GOOD, hostEnv: null })).toMatch(/not the browser server/);
    expect(refusal({ ...GOOD, hostEnv: HOST_ENV_TEXT.replace("container", "process") })).toMatch(/BROWSER_HOST_MODE=container/);
    expect(refusal({ ...GOOD, key: "" })).toMatch(/BROWSER_HOST_KEY is not set/);
    expect(refusal({ ...GOOD, health: null })).toMatch(/does not answer/);
    expect(refusal({ ...GOOD, health: { status: 401, mode: null } })).toMatch(/refused BROWSER_HOST_KEY/);
    expect(refusal({ ...GOOD, health: { status: 200, mode: "process" } })).toMatch(/process mode, not container mode/);
    expect(refusalMessage("x")).toBe("The isolation proof runs only as root on the browser server, against its host in container mode (docs/plans/browser-host.md 12.3). Refused: x.");
  });

  it("main.mjs isolation-proof here refuses with that message and exit 2, and starts no host", async () => {
    const port = await new Promise<number>((resolve) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, BROWSER_HOST_PORT: String(port) } as unknown as NodeJS.ProcessEnv;
    const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
      const child = spawn(process.execPath, [MAIN, "isolation-proof"], { env, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", (d) => (text += String(d)));
      child.stderr.on("data", (d) => (text += String(d)));
      const t = setTimeout(() => child.kill("SIGKILL"), 20_000);
      child.on("close", (code) => {
        clearTimeout(t);
        resolve({ code, text });
      });
    });
    expect(out.code).toBe(2);
    expect(out.text).toContain("The isolation proof runs only as root on the browser server, against its host in container mode");
    // Nothing listens on the port the host would have taken.
    const listening = await new Promise<boolean>((resolve) => {
      const c = net.connect(port, "127.0.0.1", () => {
        c.destroy();
        resolve(true);
      });
      c.on("error", () => resolve(false));
    });
    expect(listening).toBe(false);
  }, 30_000);
});

const CTX: PlanContext = {
  bIp: "10.250.0.18",
  aGateway: "10.250.0.1",
  publicV4: ["198.51.100.10"],
  publicHost: "browsers.example.test",
  appV4: "192.0.2.200",
  appHost: "app.example.test",
  hostLocal: new Set(["127.0.0.1", "198.51.100.10", "10.250.0.1", "10.250.0.17", "172.17.0.1"]),
  resolved: { "example.com": "93.184.215.14", "portquiz.net": "35.180.139.74" },
};

describe("the network layer's table", () => {
  const plan = networkPlan(CTX);
  const row = (label: string) => {
    const r = plan.find((x) => x.label.startsWith(label));
    expect(r, label).toBeDefined();
    return r!;
  };

  it("has a listener in each of the eight ranges, each refused as private (they are routed, never local)", () => {
    expect(LISTENERS).toEqual(["10.77.0.1", "172.16.77.1", "192.168.77.1", "100.64.77.1", "169.254.77.1", "198.18.77.1", "192.0.2.77", "203.0.113.77"]);
    for (const ip of LISTENERS) {
      const r = row(`the listener on ${ip}`);
      expect({ ip, counter: r.counter, url: r.probe.argv.at(-1), control: r.control?.argv.at(-1) }).toEqual({ ip, counter: "private", url: `http://${ip}/`, control: `http://${ip}/` });
    }
  });

  it("names the counter of the hook each packet truly meets: a local address of the host is to_host, a routed one its forward rule", () => {
    expect(row("the metadata service").counter).toBe("private");
    expect(row("the metadata service").probe.argv.at(-1)).toBe(`http://${METADATA}/latest/meta-data/`);
    expect(row("B's DevTools")).toMatchObject({ counter: "private", control: { user: "wkbhost" } });
    expect(row("B's DevTools").probe.argv.at(-1)).toBe("http://10.250.0.18:9222/json/version");
    expect(row(`${DOCKER0} on 22`)).toMatchObject({ counter: "to_host" });
    expect(row(`${DOCKER0} on 22`).control).not.toBeNull();
    expect(row("the public IPv4 198.51.100.10 on 22").counter).toBe("to_host");
    expect(row("the public IPv4 198.51.100.10 on 443").counter).toBe("to_host");
    expect(row("the public IPv4 198.51.100.10 on 443").probe.argv).toContain("browsers.example.test:443:198.51.100.10");
    expect(row("A's gateway 10.250.0.1 on 22").counter).toBe("to_host");
    expect(row("A's gateway 10.250.0.1 on 443").counter).toBe("to_host");
    expect(row("the app server").counter).toBe("host");
    expect(row("the app server").probe.argv).toContain("app.example.test:443:192.0.2.200");
    expect(row("portquiz.net on 8080")).toMatchObject({ counter: "port" });
    expect(row("portquiz.net on 8080").probe.argv).toContain("portquiz.net:8080:35.180.139.74");
    expect(row("a resolver that is not one of the four")).toMatchObject({ counter: "other_dns", probe: { tool: "dig", argv: ["dig", "@8.8.8.8", "example.com", "A", "+time=2", "+tries=1"] } });
    expect(row("a name that resolves to a private address").counter).toBe("private");
    expect(row("a name that resolves to a private address").probe.argv).toContain("rebind.test:80:10.77.0.1");
  });

  it("refuses 172.17.0.1 as private, with no positive control, where docker0 does not hold it", () => {
    const p = networkPlan({ ...CTX, hostLocal: new Set(["198.51.100.10", "10.250.0.1"]) });
    const r = p.find((x) => x.label.startsWith(`${DOCKER0} on 22`))!;
    expect({ counter: r.counter, control: r.control }).toEqual({ counter: "private", control: null });
    expect(counterFor(new Set(["1.2.3.4"]), "1.2.3.4", "private")).toBe("to_host");
    expect(counterFor(new Set(), "1.2.3.4", "host")).toBe("host");
  });

  it("names only real counters, waits at most 5 seconds a probe, and every row but docker0's has a positive control", () => {
    for (const r of plan) {
      expect(COUNTERS).toContain(r.counter);
      if (r.probe.tool === "curl") expect(r.probe.argv.slice(0, 4)).toEqual(["curl", "-sS", "--max-time", "5"]);
      else expect(r.probe.argv).toContain("+tries=1");
      expect(r.control).not.toBeNull();
    }
    expect(plan).toHaveLength(8 + 1 + 1 + 1 + 2 + 2 + 1 + 1 + 1 + 1);
  });

  it("must work: example.com and portquiz.net, the resolver 1.1.1.1, and Docker's own resolver", () => {
    expect(mustWork(CTX).map((w) => [w.label.split(" ")[0], w.probe.argv.at(-1) ?? ""])).toEqual([
      ["https://example.com/", "https://example.com/"],
      ["http://portquiz.net/", "http://portquiz.net/"],
      ["dig", "+tries=2"],
      ["Docker's", "+tries=2"],
    ]);
    expect(mustWork(CTX)[3].probe.argv[1]).toBe("@127.0.0.11");
  });
});

describe("the listeners' namespace", () => {
  it("puts every listener on a dummy inside wkbproof, routed by a /32 via the pair, so none is ever local to the host", () => {
    const cmds = setupCommands();
    const hostAddrs = cmds.filter((c) => c[0] === "ip" && c[1] === "addr" && c[2] === "add");
    expect(hostAddrs).toEqual([["ip", "addr", "add", `${LINK.host}/30`, "scope", "link", "dev", LINK_HOST]]);
    for (const ip of LISTENERS) {
      expect(cmds).toContainEqual(["ip", "-n", PROOF_NS, "addr", "add", `${ip}/32`, "dev", LISTENER_DEV]);
      expect(cmds).toContainEqual(["ip", "route", "add", `${ip}/32`, "via", LINK.peer, "dev", LINK_HOST]);
    }
    expect(cmds[0]).toEqual(["ip", "netns", "add", "wkbproof"]);
    // wkbproof0 never matches the firewall's "wkb-*".
    expect(/^wkb-/.test(LINK_HOST)).toBe(false);
    expect(cleanupCommands()).toContainEqual(["ip", "netns", "del", "wkbproof"]);
    expect(listenerCommand("10.77.0.1", "/run/x")).toEqual(["ip", "netns", "exec", "wkbproof", "python3", "-m", "http.server", "80", "--bind", "10.77.0.1", "--directory", "/run/x"]);
  });

  it("gives the pair's own /30 scope link, and the host's address reading leaves wkbproof* out whatever its scope, so a firewall check never writes it into the table", () => {
    const cmds = setupCommands();
    const pairAddrs = cmds.filter((c) => c.includes("addr") && c.includes("add") && (c.includes(LINK_HOST) || c.includes("wkbproof1")));
    expect(pairAddrs).toHaveLength(2);
    for (const c of pairAddrs) expect(c.slice(-4, -2)).toEqual(["scope", "link"]);
    // What `ip -j -4 addr show scope global` would list if the scope were global after all.
    expect(publicAddresses([{ ifname: LINK_HOST, addr_info: [{ family: "inet", local: LINK.host, scope: "global" }] }, { ifname: "eth0", addr_info: [{ family: "inet", local: "198.51.100.10", scope: "global" }] }])).toEqual(["198.51.100.10"]);
  });
});

describe("the guards around the host's stop, and the reads they need", () => {
  it("stops the host only with nothing open, starting or held on it, unless --stop-host", () => {
    expect(stopRefusal({ running: 0, starting: 0, held: 0 }, false)).toBeNull();
    expect(stopRefusal({ running: 1, starting: 0, held: 0 }, false)).toBe("the host was not stopped: 1 browser is open on it (running 1, starting 0, held 0), and a stop would end it; run again when none is, or with --stop-host to end them");
    expect(stopRefusal({ running: 2, starting: 1, held: 1 }, false)).toMatch(/^the host was not stopped: 4 browsers are open on it/);
    expect(stopRefusal({ running: 3, starting: 0, held: 0 }, true)).toBeNull();
    expect(stopRefusal({}, false)).toMatch(/did not say how many browsers are open/);
  });

  it("arms a dead-man switch that starts the host by its unit's exact name, and cancels it by its timer", () => {
    const { arm, cancel } = deadmanCommands();
    expect(arm).toEqual(["systemd-run", `--unit=${DEADMAN_UNIT}`, `--on-active=${DEADMAN_SECONDS}`, "--timer-property=AccuracySec=1s", "/usr/bin/systemctl", "start", "workwrk-browser-host.service"]);
    expect(DEADMAN_SECONDS).toBe(180);
    expect(cancel).toEqual(["systemctl", "stop", `${DEADMAN_UNIT}.timer`]);
  });

  it("handles Ctrl-C, a stop and a dropped SSH session", () => {
    expect(SIGNALS).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
  });

  it("searches the host's own folders, its PrivateTmp included, and never the rest of /tmp", () => {
    const tmp = [
      "systemd-private-0123456789abcdef0123456789abcdef-workwrk-browser-host.service-AbC123",
      "systemd-private-0123456789abcdef0123456789abcdef-workwrk-browser-launcher.service-Xy9",
      "systemd-private-0123456789abcdef0123456789abcdef-caddy.service-Q1",
      "systemd-private-0123456789abcdef0123456789abcdef-systemd-resolved.service-Z2",
      "someone-elses-file",
    ];
    expect(searchRoots(tmp, ["workwrk-browser-host", "workwrk-browser-firewall", "workwrk-browser-launcher", "sshd", "user"])).toEqual([
      "/var/lib/workwrk-browser-host",
      "/run/workwrk-browser-host",
      "/run/workwrk-browser-firewall",
      "/run/workwrk-browser-launcher",
      `/tmp/${tmp[0]}`,
      `/tmp/${tmp[1]}`,
      `/tmp/${tmp[2]}`,
    ]);
  });

  it("reads a probe's counters: its own rise, and any other counter the proof reads that moved", () => {
    const before = Object.fromEntries(COUNTERS.map((c) => [c, 5]));
    expect(counterMoves(before, { ...before, private: 6 }, "private")).toEqual({ rose: 1, others: [] });
    expect(counterMoves(before, { ...before, private: 6, to_host: 6 }, "private")).toEqual({ rose: 1, others: ["to_host"] });
    // Counters the proof never reads may move with other sessions' traffic.
    expect(counterMoves(before, { ...before, private: 6, rate: 9, into_session: 7, ipv6: 8 }, "private")).toEqual({ rose: 1, others: [] });
    expect(USED_COUNTERS.every((c) => COUNTERS.includes(c))).toBe(true);
  });

  it("sees a reload by the rule handles, which a reload re-creates", () => {
    const rule = (handle: number, comment: string) => ({ rule: { family: "inet", table: "workwrk_browsers", chain: "from_session", handle, comment, expr: [{ counter: { packets: 1, bytes: 1 } }] } });
    const a = counterValues({ nftables: [rule(4, "private"), rule(5, "host")] });
    const same = counterValues({ nftables: [rule(4, "private"), rule(5, "host")] });
    const reloaded = counterValues({ nftables: [rule(14, "private"), rule(15, "host")] });
    expect(a.generation).toBe(same.generation);
    expect(a.generation).not.toBe(reloaded.generation);
  });

  it("reads routes, and says what refused a page's websocket to DevTools", () => {
    expect(routeDestinations([{ dst: "10.77.0.1", gateway: "169.254.255.2" }, { dst: "169.254.255.0/30", scope: "link" }, { dst: "default" }])).toEqual(["10.77.0.1", "169.254.255.0/30", "default"]);
    expect(wsRefusedBy({ statuses: [403], texts: [] })).toBe("Chrome's Origin check (its DevTools server answered 403)");
    expect(wsRefusedBy({ statuses: [], texts: ["WebSocket connection to 'ws://127.0.0.1:9222/' failed: Error during WebSocket handshake: Unexpected response code: 403"] })).toBe("Chrome's Origin check (its DevTools server answered 403)");
    expect(wsRefusedBy({ statuses: [], texts: ["Failed: net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS"] })).toBe("Local Network Access (the request never reached the socket)");
    expect(wsRefusedBy({ statuses: [], texts: [] })).toBe("neither was seen");
  });
});

describe("reading the tools", () => {
  const ran = (code: number | null, stdout = "", stderr = "", ms = 3) => ({ code, stdout, stderr, ms });

  it("curl: an answer, a reset, an ICMP refusal, a hang, a TLS failure after connecting, no name", () => {
    expect(curlOutcome(ran(0, "200"))).toEqual({ outcome: "answered", http: 200 });
    expect(curlOutcome(ran(7, "000", "curl: (7) Failed to connect to 10.77.0.1 port 80 after 1 ms: Connection refused")).outcome).toBe("refused");
    expect(curlOutcome(ran(7, "000", "curl: (7) Failed to connect to 8.8.8.8 port 53 after 0 ms: No route to host")).outcome).toBe("unreachable");
    expect(curlOutcome(ran(7, "", "curl: (7) Failed to connect to 2606:4700:4700::1111 port 443 after 0 ms: Network is unreachable")).outcome).toBe("unreachable");
    expect(curlOutcome(ran(28, "000", "curl: (28) Connection timed out after 5001 milliseconds", 5001)).outcome).toBe("timeout");
    expect(curlOutcome(ran(35, "000", "curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL")).outcome).toBe("connected");
    expect(curlOutcome(ran(6, "000", "curl: (6) Could not resolve host: x")).outcome).toBe("no_name");
    // sshd's banner: the listener was reached.
    expect(curlOutcome(ran(1, "000", "curl: (1) Received HTTP/0.9 when not allowed")).outcome).toBe("connected");
    expect(curlOutcome(ran(1, "000", "curl: (1) Protocol \"x\" not supported")).outcome).toBe("failed");
  });

  it("dig: a reply with its status and answers, an ICMP refusal, no reply", () => {
    expect(digOutcome(ran(0, ";; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 1\n;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0"))).toEqual({ outcome: "answered", status: "NOERROR", answers: 2 });
    expect(digOutcome(ran(9, ";; communications error to 8.8.8.8#53: host unreachable")).outcome).toBe("unreachable");
    expect(digOutcome(ran(9, ";; connection timed out; no servers could be reached")).outcome).toBe("timeout");
  });

  it("nft's listing: every counter by its comment, a stacked one, and a missing one", () => {
    const rule = (chain: string, comment: string | null, packets: number) => ({
      rule: { family: "inet", table: "workwrk_browsers", chain, handle: Math.floor(Math.random() * 1000), ...(comment ? { comment } : {}), expr: [{ match: { op: "==", left: { meta: { key: "l4proto" } }, right: "tcp" } }, { counter: { packets, bytes: packets * 60 } }, { jump: { target: "refuse" } }] },
    });
    const listing = {
      nftables: [{ metainfo: { version: "1.0.9" } }, { table: { family: "inet", name: "workwrk_browsers" } }, ...COUNTERS.map((c, i) => rule("from_session", c, i)), rule("refuse", null, 99)],
    };
    const v = counterValues(listing);
    expect(v.values.private).toBe(COUNTERS.indexOf("private"));
    expect(v.values.devtools_other_user).toBe(COUNTERS.indexOf("devtools_other_user"));
    expect({ twice: v.twice, missing: v.missing, rules: v.rules }).toEqual({ twice: [], missing: [], rules: COUNTERS.length + 1 });
    const stacked = { nftables: [...listing.nftables, rule("from_session", "private", 4)] };
    expect(counterValues(stacked).twice).toEqual(["private"]);
    expect(duplicateRules(stacked)).toHaveLength(1);
    expect(duplicateRules(listing)).toEqual([]);
    expect(counterValues({ nftables: listing.nftables.filter((x) => (x as { rule?: { comment?: string } }).rule?.comment !== "port") }).missing).toEqual(["port"]);
    expect(() => counterValues({})).toThrow();
  });

  it("ip, json/version, docker stats, systemctl show, env files and the needles", () => {
    expect([...localAddresses([{ ifname: "lo", addr_info: [{ family: "inet", local: "127.0.0.1" }] }, { ifname: "docker0", addr_info: [{ family: "inet", local: "172.17.0.1" }, { family: "inet6", local: "fe80::1" }] }])]).toEqual(["127.0.0.1", "172.17.0.1"]);
    expect(globalV6("1: lo\n    inet6 ::1/128 scope host\n2: eth0\n    inet6 fe80::1/64 scope link\n")).toEqual([]);
    expect(globalV6("    inet6 2a01:7e00::1/64 scope global dynamic\n")).toEqual(["2a01:7e00::1"]);
    expect(browserIdOf({ webSocketDebuggerUrl: "ws://10.250.0.2:9222/devtools/browser/0b8c4a1e-1f2a-4c3d-9e8f-123456789abc" })).toBe("0b8c4a1e-1f2a-4c3d-9e8f-123456789abc");
    expect(browserIdOf({})).toBeNull();
    expect(statsBytes("1.25GiB / 1.25GiB")).toBe(Math.round(1.25 * 1024 ** 3));
    expect(statsBytes("512MiB / 1.25GiB")).toBe(512 * 1024 ** 2);
    expect(statsBytes("--")).toBeNull();
    const units = systemctlShow("Id=workwrk-browser-firewall.service\nActiveEnterTimestampMonotonic=4100000\nInactiveExitTimestampMonotonic=4000000\n\nId=docker.service\nActiveEnterTimestampMonotonic=6100000\nInactiveExitTimestampMonotonic=4200000\n");
    expect(firewallBeforeDocker(units)).toEqual({ ok: true, firewall: 4100000, docker: 4200000 });
    expect(firewallBeforeDocker({ ...units, "docker.service": { ...units["docker.service"], InactiveExitTimestampMonotonic: "4050000" } }).ok).toBe(false);
    expect(firewallBeforeDocker({}).ok).toBe(false);
    expect(envValue(HOST_ENV_TEXT, "BROWSER_HOST_REGION")).toBe("us-east-1");
    expect(envValue('BROWSER_HOST_BLOCK="192.0.2.200"\n', "BROWSER_HOST_BLOCK")).toBe("192.0.2.200");
    expect(envValue(null, "X")).toBeNull();
    expect(needlesIn("a line with tok_abcdef123 in it", [{ label: "a token", value: "tok_abcdef123" }, { label: "short", value: "abc" }, { label: "absent", value: "zzzzzzzz" }])).toEqual(["a token"]);
    expect(localConnect("wss://browsers.example.test/connect/abc?t=tok")).toBe("ws://127.0.0.1:8789/connect/abc?t=tok");
  });
});

const SECCOMP = JSON.stringify({ defaultAction: "SCMP_ACT_ERRNO", syscalls: [{ names: ["read"], action: "SCMP_ACT_ALLOW" }] });
const SESSION = "0123abcd-0000-4000-8000-000000000001";

/** docker inspect of a session container as the launcher makes it (bodies.mjs), as Docker shows it. */
function inspectOf(id = SESSION, name = "wkb-0123abcd", ip = "10.250.0.2", gateway = "10.250.0.1") {
  const body = containerCreateBody(id, { width: 1280, height: 800 }, 1800, { name, ip }, { image: "current", memoryMb: 1280, seccomp: SECCOMP });
  return {
    Id: "c".repeat(64),
    Name: `/${name}`,
    State: { Pid: 4242, Running: true, OOMKilled: false },
    AppArmorProfile: "workwrk-browser",
    Config: { User: body.User, Labels: body.Labels },
    HostConfig: { ...body.HostConfig, Binds: null, Mounts: null },
    Mounts: [],
    NetworkSettings: { Ports: {}, Networks: { [name]: { IPAddress: ip, Gateway: gateway, GlobalIPv6Address: "" } } },
  };
}

describe("docker inspect of A", () => {
  it("holds every field of 12.3 for a container the launcher made", () => {
    const checks = inspectChecks(inspectOf(), { memoryMb: 1280, seccomp: SECCOMP });
    expect(checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([]);
    expect(checks).toHaveLength(13);
  });

  it("fails the check a changed field breaks, and only it", () => {
    const failing = (mutate: (i: ReturnType<typeof inspectOf>) => void, want = { memoryMb: 1280, seccomp: SECCOMP }) => {
      const i = inspectOf();
      mutate(i);
      return inspectChecks(i, want).filter((c) => !c.ok).map((c) => c.name);
    };
    expect(failing((i) => void (i.HostConfig.ReadonlyRootfs = false))).toEqual(["ReadonlyRootfs true"]);
    expect(failing((i) => void ((i.HostConfig as { CapAdd: unknown }).CapAdd = ["NET_ADMIN"]))).toEqual(["CapDrop [ALL] and CapAdd null"]);
    expect(failing((i) => void (i.HostConfig.Privileged = true))).toEqual(["Privileged false"]);
    expect(failing((i) => void (i.HostConfig.SecurityOpt = i.HostConfig.SecurityOpt.filter((s: string) => !s.startsWith("no-new"))))).toEqual(["SecurityOpt holds no-new-privileges"]);
    expect(failing(() => undefined, { memoryMb: 1280, seccomp: JSON.stringify({ defaultAction: "SCMP_ACT_ALLOW", syscalls: [] }) })).toEqual(["SecurityOpt holds the installed seccomp profile"]);
    expect(failing((i) => void (i.AppArmorProfile = "docker-default"))).toEqual(["SecurityOpt holds apparmor=workwrk-browser, and AppArmorProfile is workwrk-browser"]);
    expect(failing(() => undefined, { memoryMb: 2048, seccomp: SECCOMP })).toEqual(["Memory and MemorySwap at the cap (2048 MiB)"]);
    expect(failing((i) => void (i.HostConfig.OomScoreAdj = 0))).toEqual(["OomScoreAdj 500"]);
    expect(failing((i) => void (i.Config.User = "0:0"))).toEqual(["NanoCpus 1e9, PidsLimit 1024, User 10001:10001"]);
    expect(failing((i) => void ((i.HostConfig as { Binds: unknown }).Binds = ["/:/host"]))).toEqual(["no port, bind or mount"]);
    expect(failing((i) => void (i.NetworkSettings.Ports = { "9222/tcp": [{ HostIp: "0.0.0.0", HostPort: "9222" }] } as never))).toEqual(["no port, bind or mount"]);
    expect(failing((i) => void (i.HostConfig.NetworkMode = "bridge"))).toEqual(["one network, wkb-*, its own"]);
    expect(failing((i) => void (i.HostConfig.LogConfig = { Type: "json-file" }))).toEqual(["LogConfig none"]);
    expect(failing((i) => void (i.NetworkSettings.Networks["wkb-0123abcd"].GlobalIPv6Address = "2a01::2"))).toEqual(["IPv6 off"]);
  });
});

// ── A whole run over a simulated server ─────────────────────────────

const KEY = "the-proof-key-0123456789abcdefghijklmnopqrstuvwxyz0123456789ab";
const PUBLIC = "198.51.100.10";
const APP_IP = "192.0.2.200";

type Sim = {
  deps: Deps;
  lines: string[];
  argvs: string[][];
  /** Every command, and the proof's other acts (a search, a file written, an exit), in order. */
  timeline: string[];
  tokens: string[];
  counters: Record<string, number>;
  files: Map<string, string>;
  exits: number[];
  signal: (name: string) => void;
};

type SimOptions = {
  /** A probe, by part of its command, that hangs instead of being reset. */
  hang?: string;
  failSetup?: boolean;
  health?: { status: number; mode: string };
  /** Browsers /health says are open just before the stop. */
  open?: number;
  /** A probe during which the firewall is reloaded (its rule handles change, its counters zeroed), once. */
  reloadAt?: string;
  /** A probe that also moves another counter the proof reads. */
  alsoMoves?: { at: string; counter: string };
  /** A listener that never answers the host. */
  deadListener?: string;
  /** The pair still there after the cleanup. */
  linkStays?: boolean;
  /** A command, by its whole text, at which a signal arrives. */
  signalAt?: { command: string; signal: string };
  /** The old naming: a container named after its session's id. */
  nameFromId?: boolean;
  /** A Docker label holding the session's id. */
  labelIsId?: boolean;
  /** The kernel's log naming a bridge made from a session's id. */
  kernelNamesId?: boolean;
  swapOn?: boolean;
  corePattern?: string;
  /** A managed policy chrome://policy does not list. */
  policyMissing?: string;
};

/**
 * A browser server that answers every command as the firewall would: a
 * session's packet to a blocked target is reset at once and counted under
 * the comment the TEST names here (its own table, not the plan's), and
 * everything allowed answers.
 */
function simulate(o: SimOptions = {}): Sim {
  const lines: string[] = [];
  const argvs: string[][] = [];
  const timeline: string[] = [];
  const tokens: string[] = [];
  const exits: number[] = [];
  const counters: Record<string, number> = Object.fromEntries(COUNTERS.map((c) => [c, 0]));
  let generation = 1;
  let reloaded = false;
  const files = new Map<string, string>([
    [HOST_ENV, HOST_ENV_TEXT],
    [FIREWALL_ENV, `BROWSER_HOST_BLOCK=${APP_IP}\n`],
    ["/etc/workwrk-browser-host/chrome-seccomp.json", SECCOMP],
    [`/sys/fs/cgroup/system.slice/docker-${"c".repeat(64)}.scope/memory.peak`, String(1200 * 1024 * 1024)],
  ]);
  const sessions: Array<{ id: string; tag: string; name: string; ip: string; gateway: string; released: boolean }> = [];
  let n = 0;
  let netns = false;
  let hostUp = true;
  let deadman = false;
  let onSignal: ((s: string) => void) | null = null;
  // What the firewall answers a session's packet to, by its target: the test's own table.
  const truth = (target: string): string | null => {
    if (LISTENERS.some((ip) => target.includes(`//${ip}/`))) return "private";
    if (target.includes(METADATA)) return "private";
    if (target.includes("10.250.0.18:9222")) return "private";
    if (target.includes(`${DOCKER0}:22`)) return "to_host";
    if (target.includes(`:443:${PUBLIC}`) || target.includes(`${PUBLIC}:22`)) return "to_host";
    if (target.includes(":443:10.250.0.1") || target.includes("10.250.0.1:22")) return "to_host";
    if (target.includes(`:443:${APP_IP}`)) return "host";
    if (target.includes("portquiz.net:8080")) return "port";
    if (target.includes("@8.8.8.8")) return "other_dns";
    if (target.includes("rebind.test:80:10.77.0.1")) return "private";
    return null;
  };
  const listing = () => ({
    nftables: [{ metainfo: {} }, ...COUNTERS.map((c, i) => ({ rule: { family: "inet", table: "workwrk_browsers", chain: "from_session", handle: generation * 100 + i, comment: c, expr: [{ match: { c } }, { counter: { packets: counters[c], bytes: 0 } }, { jump: { target: "refuse" } }] } }))],
  });
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "", ms: 4 });
  const refusedRun = (counter: string, target: string) => {
    counters[counter] += 1;
    if (target.startsWith("dig")) return { code: 9, stdout: ";; communications error to 8.8.8.8#53: host unreachable", stderr: "", ms: 6 };
    return { code: 7, stdout: "000", stderr: "curl: (7) Failed to connect after 1 ms: Connection refused", ms: 6 };
  };
  const answered = (argv: readonly string[]) => {
    if (argv[0] === "dig") return ok(";; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 7\n;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0");
    if (argv.includes("-o")) return ok("200");
    return ok(JSON.stringify({ webSocketDebuggerUrl: "ws://10.250.0.2:9222/devtools/browser/0b8c4a1e-1f2a-4c3d-9e8f-123456789abc" }));
  };
  const exec: Deps["exec"] = async (cmd, args) => {
    const argv = [cmd, ...args];
    argvs.push(argv);
    const all = argv.join(" ");
    timeline.push(all);
    if (o.signalAt && all === o.signalAt.command && onSignal) {
      const fire = onSignal;
      onSignal = null;
      fire(o.signalAt.signal);
    }
    if (cmd === "ip") {
      if (all === "ip netns add wkbproof") {
        if (o.failSetup) return { code: 1, stdout: "", stderr: "RTNETLINK answers: Operation not permitted", ms: 1 };
        netns = true;
      }
      if (all === "ip netns del wkbproof") netns = false;
      if (all === "ip netns list") return ok(netns ? "wkbproof (id: 0)\n" : "");
      if (all === "ip link show wkbproof0") return netns || o.linkStays ? ok("7: wkbproof0@if6: <BROADCAST,MULTICAST,UP>") : { code: 1, stdout: "", stderr: 'Device "wkbproof0" does not exist.', ms: 1 };
      if (all === "ip -j route show dev wkbproof0" || all === "ip -j route show") return ok(JSON.stringify(netns ? LISTENERS.map((dst) => ({ dst, gateway: "169.254.255.2", dev: "wkbproof0" })) : [{ dst: "default", gateway: "198.51.100.1" }]));
      if (all === "ip -j -4 addr show") return ok(JSON.stringify([{ ifname: "lo", addr_info: [{ family: "inet", local: "127.0.0.1" }] }, { ifname: "eth0", addr_info: [{ family: "inet", local: PUBLIC, scope: "global" }] }, { ifname: "docker0", addr_info: [{ family: "inet", local: DOCKER0 }] }, ...(netns ? [{ ifname: "wkbproof0", addr_info: [{ family: "inet", local: "169.254.255.1", scope: "link" }] }] : []), ...sessions.map((s) => ({ ifname: s.name, addr_info: [{ family: "inet", local: s.gateway }] }))]));
      if (all === "ip -j -4 addr show scope global") return ok(JSON.stringify([{ ifname: "eth0", addr_info: [{ family: "inet", local: PUBLIC, scope: "global" }] }, { ifname: "docker0", addr_info: [{ family: "inet", local: DOCKER0, scope: "global" }] }]));
      return ok();
    }
    if (cmd === "nft") return ok(JSON.stringify(listing()));
    if (cmd === "nsenter") {
      const inner = argv.slice(4);
      const text = inner.join(" ");
      if (inner[0] === "ip") return ok("1: lo: <LOOPBACK,UP>\n    inet6 ::1/128 scope host\n");
      if (inner.includes("-6")) return { code: 7, stdout: "", stderr: "curl: (7) Failed to connect to 2606:4700:4700::1111 port 443 after 0 ms: Network is unreachable", ms: 3 };
      if (o.hang && text.includes(o.hang)) return { code: 28, stdout: "000", stderr: "curl: (28) Connection timed out after 5000 milliseconds", ms: 5003 };
      if (o.reloadAt && !reloaded && text.includes(o.reloadAt)) {
        // The 5-minute check reloads the table now: new rules, every counter at 0.
        reloaded = true;
        generation += 1;
        for (const c of COUNTERS) counters[c] = 0;
      }
      if (o.alsoMoves && text.includes(o.alsoMoves.at)) counters[o.alsoMoves.counter] += 1;
      const c = truth(text);
      return c ? refusedRun(c, text) : answered(inner);
    }
    if (cmd === "swapon") return ok(o.swapOn ? "/swap.img file 4G 0B -2\n" : "");
    if (cmd === "curl") {
      if (all.includes("10.250.0.18:9222")) return refusedRun("devtools_other_user", all);
      if (all.includes("http://10.250.0.18:80/")) return refusedRun("session_other_user", all);
      if (o.deadListener && all.includes(`//${o.deadListener}/`)) return { code: 7, stdout: "000", stderr: "curl: (7) Failed to connect: Connection refused", ms: 2 };
      // sshd answers its banner, which curl reads as HTTP/0.9.
      if (all.includes(":22/")) return { code: 1, stdout: "000", stderr: "curl: (1) Received HTTP/0.9 when not allowed", ms: 9 };
      return answered(argv);
    }
    if (cmd === "dig") return answered(argv);
    if (cmd === "runuser") return answered(argv.slice(4));
    if (cmd === "ssh-keyscan") return ok(`${args.at(-1)} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA`);
    if (cmd === "docker") {
      if (args[0] === "ps" && args.includes("name=wkb-")) return ok("");
      if (args[0] === "ps") {
        const id = String(args[args.indexOf("--filter") + 1]).split("=")[2];
        const s = sessions.find((x) => x.id === id);
        return ok(s && !s.released ? `${s.name}\n` : "");
      }
      if (args[0] === "inspect" || (args[0] === "container" && args[1] === "inspect")) {
        const s = sessions.find((x) => x.name === args.at(-1));
        if (args[0] === "container") return s && !s.released ? ok("[{}]") : { code: 1, stdout: "[]", stderr: `Error: No such container: ${args.at(-1)}`, ms: 2 };
        // The label the launcher writes is the host's tag, never the id (or the id itself, when the test says so).
        return ok(s && !s.released ? JSON.stringify([inspectOf(o.labelIsId ? s.id : s.tag, s.name, s.ip, s.gateway)]) : "[]");
      }
      if (args[0] === "network" && args[1] === "inspect") {
        const s = sessions.find((x) => x.name === args[2]);
        if (!s || s.released) return { code: 1, stdout: "[]", stderr: `Error: network ${args[2]} not found`, ms: 2 };
        return ok(JSON.stringify([{ Name: s.name, Options: { "com.docker.network.bridge.name": s.name }, Labels: { "workwrk.browser": "1", "workwrk.session": o.labelIsId ? s.id : s.tag } }]));
      }
      if (args[0] === "stats") return ok("1.1GiB / 1.25GiB\n");
      if (args[0] === "network") return ok("");
      return ok();
    }
    if (cmd === "systemd-run") {
      deadman = true;
      return ok(`Running timer as unit: ${DEADMAN_UNIT}.timer`);
    }
    if (cmd === "systemctl") {
      if (args[0] === "is-active") return args[1] === "rsyslog.service" ? { code: 3, stdout: "inactive\n", stderr: "", ms: 2 } : ok("active\n");
      if (args[0] === "stop" && args[1] === "workwrk-browser-host.service") hostUp = false;
      if (args[0] === "start" && args[1] === "workwrk-browser-host.service") hostUp = true;
      if (args[0] === "stop" && args[1] === `${DEADMAN_UNIT}.timer`) {
        if (!deadman) return { code: 5, stdout: "", stderr: "Unit not loaded.", ms: 1 };
        deadman = false;
      }
      if (args[0] === "show") return ok("Id=workwrk-browser-firewall.service\nActiveEnterTimestampMonotonic=4100000\nInactiveExitTimestampMonotonic=4000000\n\nId=docker.service\nActiveEnterTimestampMonotonic=6100000\nInactiveExitTimestampMonotonic=4200000\n");
      return ok();
    }
    if (cmd === "journalctl") {
      // The kernel names each bridge it makes: what it names is the launcher's random name (or, when the test says so, one made from the id).
      if (args[0] === "-k") return ok(sessions.map((x) => `${o.kernelNamesId ? `wkb-${x.id.slice(0, 8)}` : x.name}: port 1(veth1a2b3c4) entered forwarding state`).join("\n"));
      return ok("[host] start container host max=4\n[host] api create 201 2100ms\n");
    }
    return { code: 127, stdout: "", stderr: `no ${cmd} here`, ms: 1 };
  };

  const pages = new Map<string, string>();
  const live: Array<{ exited: boolean }> = [];
  const deps: Deps = {
    exec,
    spawnDetached: (argv) => {
      argvs.push([...argv]);
      timeline.push(argv.join(" "));
      const l = { exited: false };
      live.push(l);
      return { stop: () => void (l.exited = true), exited: () => l.exited };
    },
    api: async (method, p, body) => {
      if (p === "/health") {
        if (o.health) return { status: o.health.status, json: { mode: o.health.mode } };
        const open = sessions.filter((s) => !s.released).length + (o.open ?? 0);
        return { status: 200, json: { mode: "container", running: open, starting: 0, held: 0 } };
      }
      if (p === "/healthz") return { status: hostUp ? 200 : 0, json: null };
      if (method === "POST" && p === "/v1/sessions") {
        n += 1;
        const id = `0123abc${n}-0000-4000-8000-00000000000${n}`;
        const t = `connect-token-${n}-abcdefghijklmnop`;
        tokens.push(id, t);
        sessions.push({ id, tag: `9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1${n}`, name: o.nameFromId ? `wkb-0123abc${n}` : `wkb-5f3a9c0${n}`, ip: n === 1 ? "10.250.0.2" : "10.250.0.18", gateway: n === 1 ? "10.250.0.1" : "10.250.0.17", released: false });
        return { status: 201, json: { id, connectUrl: `wss://browsers.example.test/connect/${id}?t=${t}`, body } };
      }
      const debug = /^\/v1\/sessions\/([^/]+)\/debug\?mode=(\w+)$/.exec(p);
      if (debug) {
        const t = `live-${debug[2]}-${debug[1]}-0123456789`;
        tokens.push(t);
        return { status: 200, json: { debuggerFullscreenUrl: `https://browsers.example.test/live/${debug[1]}#t=${t}` } };
      }
      const rel = /^\/v1\/sessions\/([^/]+)$/.exec(p);
      if (rel) {
        timeline.push(`release ${rel[1]}`);
        const s = sessions.find((x) => x.id === rel[1]);
        if (!s) return { status: 404, json: null };
        const was = s.released;
        s.released = true;
        return { status: was ? 409 : 200, json: null };
      }
      return { status: 404, json: null };
    },
    cdp: async (wsUrl) => {
      expect(wsUrl.startsWith("ws://127.0.0.1:8789/connect/")).toBe(true);
      let closed = false;
      const me = wsUrl;
      const events = new Map<string, Array<(p: unknown, s?: string) => void>>();
      return {
        send: async (method: string, params: Record<string, unknown> = {}, sid?: string) => {
          if (method === "Target.getTargets") return { targetInfos: [{ type: "page", targetId: "T1" }] };
          if (method === "Target.attachToTarget") return { sessionId: "S1" };
          if (method === "Page.navigate") {
            pages.set(me, String(params.url));
            return {};
          }
          if (method === "Runtime.evaluate") {
            const e = String(params.expression);
            if (e.includes("shadowRoot")) return { result: { value: pages.get(me) === "chrome://policy" ? `Policy name Policy value ${POLICY_NAMES.filter((x) => x !== o.policyMissing).join(" OK ")} OK` : "" } };
            if (e.includes("document.readyState")) {
              const url = pages.get(me) ?? "";
              return { result: { value: url === "chrome://sandbox" ? "Namespace Sandbox Yes\nSeccomp-BPF sandbox Yes\nYou are adequately sandboxed." : "Example Domain\nThis domain is for use in documentation." } };
            }
            if (e.startsWith("fetch(")) return { result: { value: "rejected" } };
            if (e.startsWith("new Promise((done) => { let ws;")) {
              // Chrome's DevTools server answers the page's handshake 403 (its Origin check).
              for (const fn of events.get("Network.webSocketHandshakeResponseReceived") ?? []) fn({ response: { status: 403 } }, sid);
              return { result: { value: "refused" } };
            }
            // The allocation: the tab is gone, no answer ever comes.
            return new Promise(() => undefined);
          }
          return {};
        },
        on: (event: string, fn: (p: unknown, s?: string) => void) => void events.set(event, [...(events.get(event) ?? []), fn]),
        close: () => void (closed = true),
        closed: () => closed,
      };
    },
    httpsGet: async (url) => (url.includes("/live/") ? (hostUp ? 404 : 502) : 404),
    launcher: async (op) => (op === "probe" ? { netlink: 0, netlinkHigh: 0, netAdmin: 0 } : null),
    resolve4: async (name) => (name === "example.com" ? "93.184.215.14" : "35.180.139.74"),
    readFile: (p) => {
      // The host's state file names each running session's container by its id (lib/state.mjs).
      if (p === STATE_FILE) return JSON.stringify({ v: 1, boot: "b", mode: "container", sessions: sessions.filter((x) => !x.released).map((x) => ({ id: x.id, container: x.name, network: x.name })) });
      if (p === "/proc/sys/kernel/core_pattern") return o.corePattern ?? "|/bin/false\n";
      return files.get(p) ?? null;
    },
    writeFile: (p, text) => {
      timeline.push(`writeFile ${p}`);
      files.set(p, text);
    },
    searchFiles: (roots) => {
      timeline.push(`searchFiles ${roots.join(" ")}`);
      return [];
    },
    listDir: (p) => (p === "/tmp" ? ["systemd-private-0123456789abcdef0123456789abcdef-workwrk-browser-host.service-AbC123", "other"] : p === "/run" ? ["workwrk-browser-host", "workwrk-browser-firewall"] : []),
    emptyDir: () => ({ path: "/run/wkbproof-test", remove: () => undefined }),
    onSignal: (fn) => void (onSignal = fn),
    exit: (code) => {
      timeline.push(`exit ${code}`);
      exits.push(code);
    },
    platform: "linux",
    uid: 0,
    key: KEY,
    now: () => Date.UTC(2026, 9, 21, 9, 0, 0),
    sleep: async () => undefined,
    print: (line) => void lines.push(line),
  };
  return { deps, lines, argvs, timeline, tokens, counters, files, exits, signal: (name) => onSignal?.(name) };
}

const at = (sim: Sim, text: string) => sim.timeline.findIndex((t) => t === text || t.startsWith(text));
const lastAt = (sim: Sim, text: string) => sim.timeline.map((t, i) => (t === text || t.startsWith(text) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
const failsOf = (sim: Sim) => sim.lines.filter((l) => l.includes("FAIL"));

describe("a whole run over a simulated server", () => {
  it("passes every check where the firewall refuses as it should, and cleans up", async () => {
    const sim = simulate();
    const code = await runProof(sim.deps, []);
    expect(failsOf(sim)).toEqual([]);
    expect(code).toBe(0);
    const last = sim.lines.at(-1) ?? "";
    const m = /^\n?(\d+) of (\d+) checks passed\.$/.exec(last);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(Number(m![2]));
    expect(Number(m![2])).toBeGreaterThan(60);
    // Every refusal was counted under its own name, and the output rule once.
    expect(sim.counters.private).toBe(11);
    expect(sim.counters.devtools_other_user).toBe(1);
    expect(sim.argvs).toContainEqual(["ip", "netns", "del", "wkbproof"]);
    expect(sim.argvs).toContainEqual(["systemctl", "start", "workwrk-browser-host.service"]);
    // The sections are labelled: Chrome's layer as Chrome's, the loopback checks as the container's own.
    expect(sim.lines.some((l) => l.includes("Chrome's own layer (Chrome's, not the firewall's)"))).toBe(true);
    expect(sim.lines.filter((l) => l.includes("the container's own loopback")).length).toBeGreaterThanOrEqual(3);
    // What refused the page's websockets is recorded.
    expect(sim.lines.filter((l) => l.includes("by Chrome's Origin check (its DevTools server answered 403)"))).toHaveLength(2);
  });

  it("finds each session's container by the host's state file, and checks names, bridges and labels hold nothing of the id (final privacy review, M1)", async () => {
    const sim = simulate();
    expect(await runProof(sim.deps, [])).toBe(0);
    // Never a Docker filter by the id: no label holds it.
    expect(sim.argvs.some((a) => a.join(" ").includes("label=workwrk.session="))).toBe(false);
    for (const want of ["session A's container, network and bridge are named wkb- and 8 hex that hold no part of its id", "and their Docker label is the host's tag", "hold no session id, none of its first 8 characters, no wkb- name made from one"]) {
      expect({ want, ok: sim.lines.some((l) => l.includes("  ok  ") && l.includes(want)) }).toEqual({ want, ok: true });
    }
    expect(sim.argvs).toContainEqual(["journalctl", "-k", "--since", "2026-10-21T09:00:00.000Z", "-o", "cat", "--no-pager"]);
    expect(sim.argvs).toContainEqual(["journalctl", "-u", "systemd-networkd", "-u", "docker", "-u", "containerd", "--since", "2026-10-21T09:00:00.000Z", "-o", "cat", "--no-pager"]);
    expect(sim.lines.some((l) => l.includes("note /var/log/syslog is not there: rsyslog is masked"))).toBe(true);
  });

  it("fails a name made from the id, a label holding the id, and a kernel log naming a bridge after one", async () => {
    const named = simulate({ nameFromId: true });
    expect(await runProof(named.deps, [])).toBe(1);
    expect(failsOf(named).some((l) => l.includes("session A's container, network and bridge are named wkb- and 8 hex that hold no part of its id"))).toBe(true);
    const labelled = simulate({ labelIsId: true });
    expect(await runProof(labelled.deps, [])).toBe(1);
    expect(failsOf(labelled).some((l) => l.includes("and their Docker label is the host's tag"))).toBe(true);
    const kernel = simulate({ kernelNamesId: true });
    expect(await runProof(kernel.deps, [])).toBe(1);
    expect(failsOf(kernel)).toHaveLength(1);
    expect(failsOf(kernel)[0]).toContain("the kernel's log and systemd-networkd, docker, containerd's since the start hold no session id");
  });

  it("fails swap that is on, a core pattern that keeps dumps, and a policy Chrome does not list (M2, M3, M4)", async () => {
    for (const [o, want] of [
      [{ swapOn: true }, "swapon --show lists no swap area"],
      [{ corePattern: "|/usr/share/apport/apport -p%p -s%s -c%c\n" }, "the kernel's core pattern is |/bin/false"],
      [{ policyMissing: "PasswordLeakDetectionEnabled" }, "chrome://policy lists the 11 managed policies"],
    ] as const) {
      const sim = simulate(o);
      expect(await runProof(sim.deps, [])).toBe(1);
      expect({ want, fails: failsOf(sim).some((l) => l.includes(want)) }).toEqual({ want, fails: true });
    }
    // Root reaching a session on any other port is refused and counted (final security review, L4).
    const sim = simulate();
    await runProof(sim.deps, []);
    expect(sim.counters.session_other_user).toBe(1);
    expect(sim.lines.some((l) => l.includes("  ok  ") && l.includes("root's curl of B on port 80 is refused"))).toBe(true);
  });

  it("reads the id-made needles, the state file's names, and an id's parts", () => {
    const id = "0123abcd-4567-4890-8abc-def012345678";
    expect(idNeedles("A", id).map((n) => n.value)).toEqual([id, "0123abcd45674890" + "8abcdef012345678", "0123abcd", "wkb-0123abcd", "wkb-45674890", "wkb-8abcdef0", "wkb-12345678"]);
    expect(holdsIdPart("wkb-0123abcd", id)).toBe(true);
    expect(holdsIdPart("wkb-5f3a9c01", id)).toBe(false);
    expect(holdsIdPart("4890-8abc", id)).toBe(true);
    expect(containerOf(JSON.stringify({ sessions: [{ id, container: "wkb-5f3a9c01", network: "wkb-5f3a9c01" }] }), id)).toBe("wkb-5f3a9c01");
    expect(containerOf(JSON.stringify({ sessions: [{ id, container: "../x" }] }), id)).toBeNull();
    expect(containerOf("not json", id)).toBeNull();
    expect(STATE_FILE).toBe("/run/workwrk-browser-host/state.json");
    expect(POLICY_NAMES).toHaveLength(11);
  });

  it("never puts the key or a token in a command's arguments", async () => {
    const sim = simulate();
    await runProof(sim.deps, []);
    const all = sim.argvs.map((a) => a.join(" ")).join("\n");
    expect(all).not.toContain(KEY);
    for (const t of sim.tokens.filter((x) => !/^0123abc/.test(x))) expect(all).not.toContain(t);
  });

  it("fails a refusal that hangs instead of resetting, and only it", async () => {
    const sim = simulate({ hang: "portquiz.net:8080" });
    const code = await runProof(sim.deps, []);
    expect(code).toBe(1);
    const fails = failsOf(sim);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("portquiz.net on 8080: refused (timeout, 5003 ms)");
  });

  it("fails a refusal that raises another counter the proof reads besides its own", async () => {
    const sim = simulate({ alsoMoves: { at: "http://10.77.0.1/", counter: "to_host" } });
    const code = await runProof(sim.deps, []);
    expect(code).toBe(1);
    const fails = failsOf(sim);
    expect(fails.length).toBeGreaterThanOrEqual(1);
    expect(fails[0]).toContain("the listener on 10.77.0.1: refused (refused");
    expect(fails[0]).toContain("and to_host moved too");
  });

  it("runs a probe again when the firewall is reloaded during it, and passes on the new table", async () => {
    const sim = simulate({ reloadAt: "http://172.16.77.1/" });
    const code = await runProof(sim.deps, []);
    expect(failsOf(sim)).toEqual([]);
    expect(code).toBe(0);
    expect(sim.lines.some((l) => l.includes("the firewall table was reloaded during that probe"))).toBe(true);
    // The probe ran twice from A's namespace.
    expect(sim.argvs.filter((a) => a[0] === "nsenter" && a.join(" ").includes("http://172.16.77.1/")).length).toBe(2);
  });

  it("checks each listener really answers the host through its own route, and fails setup when one does not", async () => {
    const sim = simulate({ deadListener: "192.0.2.77" });
    await runProof(sim.deps, []);
    expect(failsOf(sim)[0]).toContain("each listener answering the host");
    expect(failsOf(sim)[0]).toContain('"192.0.2.77":"refused"');
  });

  it("checks the cleanup removed the pair, its routes and every listener, not only the namespace", async () => {
    const sim = simulate({ linkStays: true });
    const code = await runProof(sim.deps, []);
    expect(code).toBe(1);
    expect(failsOf(sim)).toHaveLength(1);
    expect(failsOf(sim)[0]).toContain("its 8 routes and every listener are gone");
  });

  it("searches the host's own folders before the stop wipes them, then forces the 502, then searches journald", async () => {
    const sim = simulate();
    await runProof(sim.deps, []);
    const search = at(sim, "searchFiles ");
    const stop = at(sim, "systemctl stop workwrk-browser-host.service");
    const journal = at(sim, "journalctl ");
    expect(search).toBeGreaterThan(0);
    expect(search).toBeLessThan(stop);
    expect(stop).toBeLessThan(journal);
    // Both sessions released, and their containers checked gone, before the search (the cleanup's releases come later).
    const releases = sim.timeline.map((t, i) => (t.startsWith("release ") ? i : -1)).filter((i) => i >= 0);
    expect(releases[1]).toBeLessThan(search);
    expect(at(sim, "docker network inspect wkb-5f3a9c02")).toBeLessThan(search);
    expect(sim.timeline[search]).toBe("searchFiles /var/lib/workwrk-browser-host /run/workwrk-browser-host /run/workwrk-browser-firewall /tmp/systemd-private-0123456789abcdef0123456789abcdef-workwrk-browser-host.service-AbC123");
  });

  it("arms the dead-man switch before the stop, and cancels it only once the host is started again", async () => {
    const sim = simulate();
    await runProof(sim.deps, []);
    const arm = at(sim, "systemd-run --unit=wkbproof-host-start");
    const stop = at(sim, "systemctl stop workwrk-browser-host.service");
    const start = at(sim, "systemctl start workwrk-browser-host.service");
    const cancel = at(sim, `systemctl stop ${DEADMAN_UNIT}.timer`);
    expect(arm).toBeGreaterThan(0);
    expect(arm).toBeLessThan(stop);
    expect(stop).toBeLessThan(start);
    expect(start).toBeLessThan(cancel);
    expect(sim.lines.some((l) => l.includes("Stopping the host now: every browser open on it ends"))).toBe(true);
  });

  it("never stops the host with a browser open on it, failing that check with why, unless --stop-host", async () => {
    const sim = simulate({ open: 1 });
    const code = await runProof(sim.deps, []);
    expect(code).toBe(1);
    expect(failsOf(sim)).toHaveLength(1);
    expect(failsOf(sim)[0]).toContain("the host is stopped for the Caddy check, with nothing open on it");
    expect(sim.lines.join("\n")).toContain("the host was not stopped: 1 browser is open on it (running 1, starting 0, held 0)");
    expect(at(sim, "systemctl stop workwrk-browser-host.service")).toBe(-1);
    expect(at(sim, "systemd-run")).toBe(-1);
    const forced = simulate({ open: 1 });
    expect(await runProof(forced.deps, ["--stop-host"])).toBe(0);
    expect(at(forced, "systemctl stop workwrk-browser-host.service")).toBeGreaterThan(0);
  });

  it("saves the listing for the run after the reboot only once the proof's own links are gone", async () => {
    const sim = simulate();
    await runProof(sim.deps, []);
    const saved = at(sim, `writeFile ${SAVED_LISTING}`);
    // After the cleanup's own removal (the last one; setup removes a dead run's leftovers first) and its check that the pair is gone.
    expect(saved).toBeGreaterThan(lastAt(sim, "ip netns del wkbproof"));
    expect(lastAt(sim, "ip link show wkbproof0")).toBeGreaterThan(lastAt(sim, "ip netns del wkbproof"));
    expect(saved).toBeGreaterThan(lastAt(sim, "ip link show wkbproof0"));
    expect(sim.files.get(SAVED_LISTING)).toBeTruthy();
  });

  for (const signal of SIGNALS) {
    it(`a ${signal} while the host is stopped runs the same cleanup: the host started again, the switch cancelled, the sessions released, the namespace gone, then exit 1`, async () => {
      const sim = simulate({ signalAt: { command: "systemctl stop workwrk-browser-host.service", signal } });
      const code = await runProof(sim.deps, []);
      const stop = at(sim, "systemctl stop workwrk-browser-host.service");
      const after = sim.timeline.slice(stop + 1);
      expect(after).toContain("systemctl start workwrk-browser-host.service");
      expect(after.indexOf(`systemctl stop ${DEADMAN_UNIT}.timer`)).toBeGreaterThan(after.indexOf("systemctl start workwrk-browser-host.service"));
      expect(after.filter((t) => t.startsWith("release ")).length).toBe(2);
      expect(after).toContain("ip netns del wkbproof");
      // Nothing new is started after the signal: no journald search, no 502 request's follow up.
      expect(after.some((t) => t.startsWith("journalctl"))).toBe(false);
      expect(sim.lines.some((l) => l.includes(`${signal}: stopping the proof, and cleaning up first`))).toBe(true);
      expect(sim.lines.some((l) => l.includes("FAIL") && l.includes(`interrupted by ${signal}`))).toBe(true);
      // One last line, whichever path reported it, and the exit code is 1.
      expect(sim.lines.filter((l) => /checks passed/.test(l))).toHaveLength(1);
      expect(sim.exits.length > 0 ? sim.exits[0] : code).toBe(1);
      // No listing saved from a run that did not reach its end.
      expect(at(sim, `writeFile ${SAVED_LISTING}`)).toBe(-1);
    });
  }

  it("stops at a failed setup step and still cleans up", async () => {
    const sim = simulate({ failSetup: true });
    const code = await runProof(sim.deps, []);
    expect(code).toBe(1);
    expect(sim.lines.some((l) => l.includes("FAIL") && l.includes("the proof ran to the end"))).toBe(true);
    expect(sim.argvs.filter((a) => a.join(" ") === "ip netns del wkbproof").length).toBeGreaterThanOrEqual(2);
    expect(sim.argvs.some((a) => a[0] === "nsenter")).toBe(false);
  });

  it("refuses a host in process mode before it runs a single command", async () => {
    const sim = simulate({ health: { status: 200, mode: "process" } });
    const code = await runProof(sim.deps, []);
    expect(code).toBe(2);
    expect(sim.argvs).toEqual([]);
    expect(sim.lines).toEqual([refusalMessage("the host here runs in process mode, not container mode")]);
  });

  it("after the reboot: the boot order, the listing saved before it, every rule once, and the network layer again", async () => {
    const sim = simulate();
    await runProof(sim.deps, []);
    const after = simulate();
    for (const [k, v] of sim.files) after.files.set(k, v);
    after.files.set("/run/workwrk-browser-firewall/firewall.loaded.json", sim.files.get(SAVED_LISTING) ?? "");
    const code = await runProof(after.deps, ["--after-reboot"]);
    expect(failsOf(after)).toEqual([]);
    expect(code).toBe(0);
    for (const want of ["the firewall service was active before Docker began to start", "the table equals the listing saved before the reboot", "every refusal counter is there exactly once", "no rule is there twice"]) {
      expect(after.lines.some((l) => l.includes("  ok  ") && l.includes(want))).toBe(true);
    }
    expect(after.lines.some((l) => l.includes("the network layer, from A's own namespace"))).toBe(true);
    // Not the first run's Chrome, container or nothing-kept checks again, and the host never stopped.
    expect(after.lines.some((l) => l.includes("Chrome's own layer"))).toBe(false);
    expect(at(after, "systemctl stop workwrk-browser-host.service")).toBe(-1);
  });
});
