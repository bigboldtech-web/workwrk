// The launcher service (docs/plans/browser-host.md 5.5, Decision 19, and
// Step 3), with no Docker: its checks refuse anything but the three
// arguments, its bodies equal 5.2 field by field, and its operations run
// against a fake Engine that records every request.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FORBIDDEN_FLAGS, PROOF_ONLY_FLAG } from "../forbidden-flags";
import { launcherTag, newBootKey } from "../lib/tokens.mjs";
import { BACKSTOP_SECONDS, containerCreateBody, fileOfTar, NAME, networkCreateBody, PACKAGES_FILE, probeCreateBody, PROBE_NAMES, PROBES, randomName, SELFTEST_SESSION, SESSION_ID, START } from "./bodies.mjs";
import { tarOf } from "./docker-api.mjs";
import { compactSeccomp, serve, sessionMemoryMb } from "./main.mjs";
import { checkArgs, createGate, createOps, OPS, stampOf } from "./ops.mjs";

const SESSION = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const SECCOMP = '{"defaultAction":"SCMP_ACT_ERRNO","syscalls":[]}';
const VIEWPORT = { width: 1280, height: 800 };

const FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-breakpad",
  "--disable-crash-reporter",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain",
  "--deny-permission-prompts",
  "--mute-audio",
  "--disk-cache-size=67108864",
  "--force-device-scale-factor=1",
  "--lang=en-US",
  "--window-size=1280,800",
  "--user-data-dir=/home/chrome/profile",
  "--disable-features=BackForwardCache,Translate,MediaRouter,AutofillServerCommunication",
  "--headless=new",
  "--remote-debugging-port=9223",
  "--remote-debugging-address=127.0.0.1",
];

describe("the bodies equal 5.2 field by field", () => {
  it("containerCreateBody", () => {
    const body = containerCreateBody(SESSION, VIEWPORT, 600, { name: "wkb-1a2b3c4d", ip: "10.250.0.2" }, { image: "current", memoryMb: 1280, seccomp: SECCOMP });
    expect(body).toEqual({
      Image: "workwrk-chrome:current",
      User: "10001:10001",
      Cmd: ["660", "/usr/local/bin/wkb-start", ...FLAGS, "about:blank"],
      Env: ["HOME=/home/chrome", "TZ=UTC", "LANG=C.UTF-8"],
      Labels: { "workwrk.browser": "1", "workwrk.session": SESSION },
      StopTimeout: 5,
      HostConfig: {
        NetworkMode: "wkb-1a2b3c4d",
        ReadonlyRootfs: true,
        Privileged: false,
        CapDrop: ["ALL"],
        CapAdd: null,
        SecurityOpt: ["no-new-privileges:true", `seccomp=${SECCOMP}`, "apparmor=workwrk-browser"],
        Tmpfs: {
          "/tmp": "rw,nosuid,nodev,noexec,size=128m,mode=1777",
          "/home/chrome": "rw,nosuid,nodev,noexec,size=512m,uid=10001,gid=10001,mode=0700",
        },
        ShmSize: 268435456,
        Memory: 1280 * 1024 * 1024,
        MemorySwap: 1280 * 1024 * 1024,
        OomKillDisable: false,
        OomScoreAdj: 500,
        NanoCpus: 1000000000,
        PidsLimit: 1024,
        Ulimits: [
          { Name: "nofile", Soft: 4096, Hard: 4096 },
          { Name: "core", Soft: 0, Hard: 0 },
        ],
        Sysctls: { "net.ipv6.conf.all.disable_ipv6": "1", "net.ipv6.conf.default.disable_ipv6": "1" },
        Dns: ["1.1.1.1", "9.9.9.9"],
        DnsSearch: [],
        DnsOptions: [],
        LogConfig: { Type: "none" },
        AutoRemove: true,
        Init: false,
        IpcMode: "private",
        CgroupnsMode: "private",
        PortBindings: {},
        PublishAllPorts: false,
        Binds: [],
        Mounts: [],
        Devices: [],
      },
      NetworkingConfig: { EndpointsConfig: { "wkb-1a2b3c4d": { IPAMConfig: { IPv4Address: "10.250.0.2" } } } },
    });
  });

  it("networkCreateBody", () => {
    expect(networkCreateBody("wkb-1a2b3c4d", { subnet: "10.250.0.16/28", gateway: "10.250.0.17" }, SESSION)).toEqual({
      Name: "wkb-1a2b3c4d",
      Driver: "bridge",
      CheckDuplicate: true,
      Internal: false,
      Attachable: false,
      EnableIPv6: false,
      IPAM: { Driver: "default", Config: [{ Subnet: "10.250.0.16/28", Gateway: "10.250.0.17" }] },
      Options: { "com.docker.network.bridge.name": "wkb-1a2b3c4d", "com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.enable_ip_masquerade": "true" },
      Labels: { "workwrk.browser": "1", "workwrk.session": SESSION },
    });
  });

  it("Cmd starts with the backstop seconds and holds no forbidden flag", () => {
    for (const t of [60, 1800, 21600]) {
      const cmd = containerCreateBody(SESSION, { width: 390, height: 844 }, t, { name: "wkb-x", ip: "10.250.0.2" }, { image: "candidate", memoryMb: 1024, seccomp: SECCOMP }).Cmd;
      expect(cmd[0]).toBe(String(t + BACKSTOP_SECONDS));
      // The image's start: socat on 9222 to Chrome on loopback 9223, then Chrome with these flags.
      expect(cmd[1]).toBe(START);
      expect(START).toBe("/usr/local/bin/wkb-start");
      expect(cmd.at(-1)).toBe("about:blank");
      for (const f of [...FORBIDDEN_FLAGS, PROOF_ONLY_FLAG]) expect(cmd.some((a) => a.startsWith(f))).toBe(false);
    }
  });

  it("the probes run with no network, the session's profiles and no way out", () => {
    const p = probeCreateBody("candidate", "netAdmin", { seccomp: SECCOMP });
    expect(p.Image).toBe("workwrk-chrome:candidate");
    expect(p.Cmd).toEqual(["20", ...PROBES.netAdmin]);
    expect(p.HostConfig).toMatchObject({ NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, CapDrop: ["ALL"], CapAdd: null, OomScoreAdj: 500, PortBindings: {}, Binds: [], Mounts: [], Devices: [] });
    expect(p.HostConfig.SecurityOpt).toEqual(["no-new-privileges:true", `seccomp=${SECCOMP}`, "apparmor=workwrk-browser"]);
    expect(PROBE_NAMES).toEqual(["netlink", "netlinkHigh", "netAdmin"]);
    expect(PROBES.netlink).toEqual(["/usr/bin/perl", "-e", "socket(my $s,16,3,12) ? exit 1 : ($!{EPERM} ? exit 0 : exit 3)"]);
    // The review's call: NETLINK_NETFILTER with a high bit set, which the kernel ignores.
    expect(PROBES.netlinkHigh).toEqual(["/usr/bin/perl", "-e", "syscall(41,16,3,4294967308) >= 0 ? exit 1 : ($!{EPERM} ? exit 0 : exit 3)"]);
    expect(4294967308).toBe(0x1_0000_000c);
    expect(PROBES.netAdmin.slice(0, 3)).toEqual(["/usr/bin/unshare", "-Urn", "/usr/bin/perl"]);
    expect(PROBES.netAdmin[4]).toContain("ioctl(S,0x8914,");
    // A probe passes only when refused with EPERM: any other refusal is a failure (exit 3).
    for (const n of PROBE_NAMES) expect(PROBES[n].at(-1)).toMatch(/\? exit 1 : \(\$!\{EPERM\} \? exit 0 : exit 3\)$/);
  });

  it("names a network and its container wkb-<8 random hex>, carrying nothing of the session (final privacy review, M1)", () => {
    const hex = SESSION.replace(/-/g, "");
    const slices = new Set<string>();
    for (let i = 0; i + 8 <= hex.length; i += 1) slices.add(hex.slice(i, i + 8));
    const names = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const n = randomName();
      expect(NAME.test(n)).toBe(true);
      expect(n).toHaveLength(12);
      expect(slices.has(n.slice(4))).toBe(false);
      names.add(n);
    }
    // Drawn afresh each time: 2,000 draws of 32 bits are all different, but for a chance of about 1 in 2,000.
    expect(names.size).toBeGreaterThan(1995);
  });
});

describe("the checks", () => {
  it("refuse an unknown operation, an unknown field, or a bad session id, viewport or timeout", () => {
    const ok = { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 };
    expect(checkArgs("start", ok)).toEqual(ok);
    const refused = (op: string, args: unknown) => {
      try {
        checkArgs(op, args);
        return "accepted";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(refused("exec", {})).toBe("unknown_op");
    expect(refused("__proto__", {})).toBe("unknown_op");
    expect(refused("start", { ...ok, image: "ubuntu" })).toBe("unknown_field");
    expect(refused("start", { ...ok, session: "../../etc" })).toBe("bad_session");
    expect(refused("start", { ...ok, session: SESSION.toUpperCase() })).toBe("bad_session");
    expect(refused("start", { ...ok, session: SELFTEST_SESSION })).toBe("bad_session");
    expect(refused("start", { ...ok, viewport: { width: 4000, height: 800 } })).toBe("bad_viewport");
    expect(refused("start", { ...ok, viewport: { width: 1280, height: 800, deviceScaleFactor: 2 } })).toBe("bad_viewport");
    expect(refused("start", { ...ok, viewport: { width: "1280", height: 800 } })).toBe("bad_viewport");
    expect(refused("start", { ...ok, timeoutSeconds: 59 })).toBe("bad_timeout");
    expect(refused("start", { ...ok, timeoutSeconds: 21601 })).toBe("bad_timeout");
    expect(refused("start", { ...ok, timeoutSeconds: 600.5 })).toBe("bad_timeout");
    expect(refused("start", { session: SESSION, viewport: VIEWPORT })).toBe("missing_timeoutSeconds");
    expect(refused("stop", { session: "x" })).toBe("bad_session");
    expect(refused("sweep", { keep: [SESSION, "nope"] })).toBe("bad_keep");
    expect(refused("selftest", { image: "latest" })).toBe("bad_image");
    expect(refused("list", { all: true })).toBe("unknown_field");
    expect(Object.keys(OPS)).toEqual(["start", "stop", "list", "sweep", "build", "promote", "drop", "selftest", "probe", "versions"]);
  });

  it("promote and drop take only candidate", () => {
    for (const op of ["promote", "drop"]) {
      expect(checkArgs(op, { tag: "candidate" })).toEqual({ tag: "candidate" });
      for (const tag of ["current", "latest", "workwrk-chrome:candidate", "", null]) expect(() => checkArgs(op, { tag })).toThrow("bad_tag");
    }
  });
});

/** An Engine object as the fake keeps it: JSON, read loosely, as the launcher reads Docker's answers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** A fake Engine: networks and containers in memory, every request recorded. */
function fakeEngine() {
  const e = {
    requests: [] as Array<{ method: string; path: string; query?: Record<string, string>; body?: Json }>,
    networks: [] as Json[],
    containers: [] as Json[],
    gates: new Map<string, Promise<void>>(),
    builds: [] as Array<{ context: Buffer; query: Record<string, string> }>,
    buildOk: true,
    waitCodes: { netlink: 0, netlinkHigh: 0, netAdmin: 0 } as Record<string, number>,
    packages: "ab".repeat(32) as string | null,
    async request(method: string, p: string, o: { query?: Record<string, string>; body?: Json } = {}) {
      e.requests.push({ method, path: p, query: o.query, body: o.body });
      const gate = e.gates.get(`${method} ${p}`);
      if (gate) await gate;
      const label = o.query?.filters ? (JSON.parse(o.query.filters).label?.[0] as string | undefined) : undefined;
      const match = (x: Json) => {
        if (!label) return true;
        const [k, v] = label.split("=");
        return x.Labels?.[k] === v;
      };
      if (method === "GET" && p === "/networks") return { status: 200, json: e.networks.filter(match) };
      if (method === "GET" && p === "/containers/json") return { status: 200, json: e.containers.filter(match) };
      if (method === "POST" && p === "/networks/create") {
        if (e.networks.some((x) => x.Name === o.body.Name)) return { status: 409, json: null };
        e.networks.push({ Id: `net-${o.body.Name}`, Name: o.body.Name, Labels: o.body.Labels, IPAM: { Config: o.body.IPAM.Config } });
        return { status: 201, json: { Id: `net-${o.body.Name}` } };
      }
      if (method === "POST" && p === "/containers/create") {
        const name = o.query?.name ?? "";
        e.containers.push({ Id: `c-${name}`, Names: [`/${name}`], Labels: o.body.Labels, State: "created", NetworkSettings: { Networks: { [name]: { IPAddress: o.body.NetworkingConfig?.EndpointsConfig?.[name]?.IPAMConfig?.IPv4Address ?? "" } } }, probe: o.body.Labels["workwrk.probe"] });
        return { status: 201, json: { Id: `c-${name}` } };
      }
      const archive = /^\/containers\/([^/]+)\/archive$/.exec(p);
      if (method === "GET" && archive) {
        const c = e.containers.find((x) => x.Names[0] === `/${decodeURIComponent(archive[1])}` || x.Id === decodeURIComponent(archive[1]));
        if (!c || e.packages === null || o.query?.path !== PACKAGES_FILE) return { status: 404, json: null };
        return { status: 200, json: null, text: tarOf([{ name: "workwrk-packages.sha256", body: Buffer.from(`${e.packages}\n`) }]).toString("latin1") };
      }
      const start = /^\/containers\/([^/]+)\/start$/.exec(p);
      if (method === "POST" && start) {
        const c = e.containers.find((x) => x.Id === decodeURIComponent(start[1]));
        if (c) c.State = "running";
        return { status: c ? 204 : 404, json: null };
      }
      const wait = /^\/containers\/([^/]+)\/wait$/.exec(p);
      if (method === "POST" && wait) {
        const c = e.containers.find((x) => x.Id === decodeURIComponent(wait[1]));
        return { status: 200, json: { StatusCode: e.waitCodes[c?.probe] ?? 9 } };
      }
      if (method === "POST" && /\/kill$/.test(p)) return { status: 204, json: null };
      const del = /^\/containers\/([^/]+)$/.exec(p);
      if (method === "DELETE" && del) {
        const at = e.containers.findIndex((x) => x.Id === decodeURIComponent(del[1]) || x.Names[0] === `/${decodeURIComponent(del[1])}`);
        if (at >= 0) e.containers.splice(at, 1);
        return { status: at >= 0 ? 204 : 404, json: null };
      }
      const delNet = /^\/networks\/([^/]+)$/.exec(p);
      if (method === "DELETE" && delNet) {
        const at = e.networks.findIndex((x) => x.Id === decodeURIComponent(delNet[1]) || x.Name === decodeURIComponent(delNet[1]));
        if (at >= 0) e.networks.splice(at, 1);
        return { status: at >= 0 ? 204 : 404, json: null };
      }
      if (method === "GET" && /^\/images\/.+\/json$/.test(p)) return { status: 200, json: { Id: "sha256:abc", Created: "2026-10-21T04:16:00Z", RepoDigests: ["debian@sha256:base1"] } };
      if (method === "POST" && /\/tag$/.test(p)) return { status: 201, json: null };
      if (method === "DELETE" && p.startsWith("/images/")) return { status: 200, json: [] };
      if (method === "GET" && p === "/images/json") return { status: 200, json: [{ Id: "sha256:new", Created: 30 }, { Id: "sha256:mid", Created: 20 }, { Id: "sha256:old", Created: 10 }] };
      if (method === "GET" && p === "/version") return { status: 200, json: { Version: "29.0.4", Components: [{ Name: "Engine", Version: "29.0.4" }, { Name: "containerd", Version: "v2.1.5" }, { Name: "runc", Version: "1.3.3" }] } };
      return { status: 404, json: null };
    },
    async build(context: Buffer, query: Record<string, string>) {
      e.builds.push({ context, query });
      return { ok: e.buildOk };
    },
  };
  return e;
}

/** Names drawn in order, so a test can say which a start took: the real ones are random (randomName). */
const NAMES = ["wkb-5f3a9c01", "wkb-77e0b2d4", "wkb-0c1d2e3f", "wkb-a9b8c7d6", "wkb-13572468", "wkb-24681357"];
const opsOver = (engine: ReturnType<typeof fakeEngine>, names: string[] = [...NAMES]) =>
  createOps({
    engine,
    seccomp: SECCOMP,
    memoryMb: 1280,
    dockerfile: Buffer.from("FROM debian:trixie-slim\n"),
    startScript: Buffer.from("#!/bin/sh\n"),
    policy: Buffer.from('{"SyncDisabled":true}\n'),
    now: () => Date.parse("2026-10-21T04:15:30Z"),
    sleep: async () => undefined,
    name: () => names.shift() ?? randomName(),
  });
const line = (id: number, op: string, args?: unknown) => JSON.stringify(args === undefined ? { id, op } : { id, op, args });

describe("the operations", () => {
  it("refuse a request carrying a port, a bind, a mount, a device or Privileged, before Docker is asked anything", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    const ok = { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 };
    for (const extra of [{ PortBindings: { "9222/tcp": [{ HostPort: "9222" }] } }, { Binds: ["/:/host"] }, { Mounts: [{ Source: "/" }] }, { Devices: [{ PathOnHost: "/dev/kvm" }] }, { Privileged: true }]) {
      expect(await ops.handle(line(1, "start", { ...ok, ...extra }))).toEqual({ id: 1, ok: false, error: "unknown_field" });
      expect(await ops.handle(JSON.stringify({ id: 2, op: "start", args: ok, ...extra }))).toEqual({ id: 2, ok: false, error: "unknown_field" });
    }
    expect(await ops.handle("not json")).toEqual({ ok: false, error: "bad_request" });
    expect(await ops.handle(line(3, "exec", {}))).toEqual({ id: 3, ok: false, error: "unknown_op" });
    expect(engine.requests).toEqual([]);
    expect(ops.tally().refused).toBe(12);
  });

  it("start makes the network and the container of 5.2, with no port, bind, mount, device or privilege, whatever was asked", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    expect(await ops.handle(line(1, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 }))).toEqual({ id: 1, ok: true, result: { name: "wkb-5f3a9c01", ip: "10.250.0.2" } });
    const create = engine.requests.find((r) => r.path === "/containers/create")!;
    expect(create.query).toEqual({ name: "wkb-5f3a9c01" });
    expect(create.body).toEqual(containerCreateBody(SESSION, VIEWPORT, 600, { name: "wkb-5f3a9c01", ip: "10.250.0.2" }, { image: "current", memoryMb: 1280, seccomp: SECCOMP }));
    expect(create.body.HostConfig).toMatchObject({ PortBindings: {}, PublishAllPorts: false, Binds: [], Mounts: [], Devices: [], Privileged: false });
    expect(engine.requests.find((r) => r.path === "/networks/create")!.body).toEqual(networkCreateBody("wkb-5f3a9c01", { subnet: "10.250.0.0/28", gateway: "10.250.0.1" }, SESSION));
  });

  it("names nothing after the session: a real start's network, bridge and container take a random name (final privacy review, M1)", async () => {
    const engine = fakeEngine();
    const ops = createOps({ engine, seccomp: SECCOMP, memoryMb: 1280, dockerfile: Buffer.from("x"), startScript: Buffer.from("x"), policy: Buffer.from("{}"), sleep: async () => undefined });
    const tag = launcherTag(newBootKey(), SESSION);
    const r = (await ops.handle(line(1, "start", { session: tag, viewport: VIEWPORT, timeoutSeconds: 600 }))) as { ok: boolean; result: { name: string } };
    expect(r.ok).toBe(true);
    const hex = `${SESSION}${tag}`.replace(/-/g, "");
    const named = [r.result.name, engine.networks[0].Name, engine.networks[0].Name, engine.requests.find((x) => x.path === "/networks/create")!.body.Options["com.docker.network.bridge.name"]];
    for (const n of named) {
      expect(NAME.test(n)).toBe(true);
      for (let i = 0; i + 8 <= hex.length; i += 1) expect(n.includes(hex.slice(i, i + 8))).toBe(false);
    }
    // The label is the host's tag, never the session id.
    expect(engine.containers[0].Labels["workwrk.session"]).toBe(tag);
    expect(SESSION_ID.test(tag)).toBe(true);
    expect(tag).not.toBe(SESSION);
  });

  it("takes the lowest free /28, and draws another name when one is taken (409)", async () => {
    const engine = fakeEngine();
    engine.networks.push({ Id: "n1", Name: "bridge", IPAM: { Config: [{ Subnet: "172.30.0.0/24" }] } }, { Id: "n2", Name: "wkb-5f3a9c01", IPAM: { Config: [{ Subnet: "10.250.0.0/28" }] } }, { Id: "n3", Name: "x", IPAM: { Config: [{ Subnet: "10.250.0.32/28" }] } });
    const ops = opsOver(engine);
    expect(await ops.handle(line(1, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 }))).toEqual({ id: 1, ok: true, result: { name: "wkb-77e0b2d4", ip: "10.250.0.18" } });
    expect(await ops.handle(line(2, "start", { session: OTHER, viewport: VIEWPORT, timeoutSeconds: 600 }))).toEqual({ id: 2, ok: true, result: { name: "wkb-0c1d2e3f", ip: "10.250.0.50" } });
  });

  it("two starts at once take two different /28s, each its own name", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    let open = () => undefined as void;
    engine.gates.set("POST /containers/create", new Promise<void>((r) => (open = r)));
    const a = ops.handle(line(1, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 }));
    const b = ops.handle(line(2, "start", { session: OTHER, viewport: VIEWPORT, timeoutSeconds: 600 }));
    await new Promise((r) => setTimeout(r, 20));
    // Both made their network while the first container create still hangs: starts run side by side.
    expect(engine.networks.map((n) => n.IPAM.Config[0].Subnet)).toEqual(["10.250.0.0/28", "10.250.0.16/28"]);
    engine.gates.clear();
    open();
    expect(await a).toEqual({ id: 1, ok: true, result: { name: "wkb-5f3a9c01", ip: "10.250.0.2" } });
    expect(await b).toEqual({ id: 2, ok: true, result: { name: "wkb-77e0b2d4", ip: "10.250.0.18" } });
  });

  it("stop removes only the container and network labelled with that session", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    await ops.handle(line(1, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 }));
    await ops.handle(line(2, "start", { session: OTHER, viewport: VIEWPORT, timeoutSeconds: 600 }));
    expect(await ops.handle(line(3, "stop", { session: SESSION }))).toEqual({ id: 3, ok: true, result: { removed: 1 } });
    expect(engine.containers.map((c) => c.Labels["workwrk.session"])).toEqual([OTHER]);
    expect(engine.networks.map((n) => n.Labels["workwrk.session"])).toEqual([OTHER]);
    const lists = engine.requests.filter((r) => r.method === "GET" && r.query?.filters).slice(-2);
    for (const r of lists) expect(JSON.parse(r.query!.filters)).toEqual({ label: [`workwrk.session=${SESSION}`] });
  });

  it("sweep removes what no kept session owns, and list names what runs", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    await ops.handle(line(1, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 }));
    await ops.handle(line(2, "start", { session: OTHER, viewport: VIEWPORT, timeoutSeconds: 600 }));
    expect(await ops.handle(line(3, "list"))).toEqual({
      id: 3,
      ok: true,
      result: [
        { session: SESSION, name: "wkb-5f3a9c01", ip: "10.250.0.2", running: true },
        { session: OTHER, name: "wkb-77e0b2d4", ip: "10.250.0.18", running: true },
      ],
    });
    expect(await ops.handle(line(4, "sweep", { keep: [OTHER] }))).toEqual({ id: 4, ok: true, result: { removed: 1 } });
    expect(engine.containers.map((c) => c.Labels["workwrk.session"])).toEqual([OTHER]);
    expect(engine.networks.map((n) => n.Labels["workwrk.session"])).toEqual([OTHER]);
    expect(await ops.handle(line(5, "sweep", { keep: [] }))).toEqual({ id: 5, ok: true, result: { removed: 1 } });
    expect(engine.containers).toEqual([]);
    expect(engine.networks).toEqual([]);
  });

  it("never runs a start inside a sweep, nor a sweep inside a start: they run in the order their lines came", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    let open = () => undefined as void;
    engine.gates.set("GET /containers/json", new Promise<void>((r) => (open = r)));
    const sweep = ops.handle(line(1, "sweep", { keep: [] }));
    const start = ops.handle(line(2, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 }));
    await new Promise((r) => setTimeout(r, 20));
    // The sweep is listing; the start has asked Docker nothing.
    expect(engine.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /containers/json"]);
    engine.gates.clear();
    open();
    expect(await sweep).toMatchObject({ ok: true, result: { removed: 0 } });
    expect(await start).toMatchObject({ ok: true, result: { name: "wkb-5f3a9c01" } });
    // The sweep listed before the start made anything, so the new container survived it.
    expect(engine.containers).toHaveLength(1);

    // And the other way round: a sweep that arrives during a start waits for it, and keeps it when told.
    let open2 = () => undefined as void;
    engine.gates.set("POST /containers/create", new Promise<void>((r) => (open2 = r)));
    const start2 = ops.handle(line(3, "start", { session: OTHER, viewport: VIEWPORT, timeoutSeconds: 600 }));
    const sweep2 = ops.handle(line(4, "sweep", { keep: [SESSION, OTHER] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.requests.filter((r) => r.method === "DELETE")).toEqual([]);
    engine.gates.clear();
    open2();
    expect(await start2).toMatchObject({ ok: true });
    expect(await sweep2).toMatchObject({ ok: true, result: { removed: 0 } });
    expect(engine.containers).toHaveLength(2);
  });

  it("a start never waits behind a stop of another session, a probe, or a sweep's removals (final contract review, M1)", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    await ops.handle(line(1, "start", { session: OTHER, viewport: VIEWPORT, timeoutSeconds: 600 }));
    const later = (p: Promise<unknown>, ms = 150) => Promise.race([p, new Promise((r) => setTimeout(() => r("still waiting"), ms))]);
    // A stop whose Engine call hangs (its container's kill).
    let openKill = () => undefined as void;
    engine.gates.set(`POST /containers/c-wkb-5f3a9c01/kill`, new Promise<void>((r) => (openKill = r)));
    const stop = ops.handle(line(2, "stop", { session: OTHER }));
    expect(await later(ops.handle(line(3, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 })))).toMatchObject({ ok: true, result: { name: "wkb-77e0b2d4" } });
    openKill();
    expect(await stop).toMatchObject({ ok: true, result: { removed: 1 } });
    // A probe whose wait hangs.
    let openWait = () => undefined as void;
    engine.gates.set("POST /containers/c-wkb-probe-netlink/wait", new Promise<void>((r) => (openWait = r)));
    const probe = ops.handle(line(4, "probe", { image: "candidate" }));
    await new Promise((r) => setTimeout(r, 20));
    const third = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
    expect(await later(ops.handle(line(5, "start", { session: third, viewport: VIEWPORT, timeoutSeconds: 600 })))).toMatchObject({ ok: true });
    // And a sweep answers while the probe runs, leaving its container alone.
    expect(await later(ops.handle(line(6, "sweep", { keep: [SESSION, third] })))).toMatchObject({ ok: true, result: { removed: 0 } });
    expect(engine.containers.some((c) => c.probe === "netlink")).toBe(true);
    openWait();
    expect(await probe).toMatchObject({ ok: true, result: { netlink: 0 } });
    // A sweep whose removal hangs: a start after it waits for its listing only.
    let openDelete = () => undefined as void;
    engine.gates.set(`DELETE /containers/c-wkb-77e0b2d4`, new Promise<void>((r) => (openDelete = r)));
    const sweep = ops.handle(line(7, "sweep", { keep: [third] }));
    expect(await later(ops.handle(line(8, "start", { session: SESSION.replace("1a2b", "9999"), viewport: VIEWPORT, timeoutSeconds: 600 })))).toMatchObject({ ok: true });
    openDelete();
    expect(await sweep).toMatchObject({ ok: true, result: { removed: 1 } });
  });

  it("a stop that comes while its session's start still waits drops that start, at once; one that comes while it runs waits for it alone", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    // A sweep is listing, so a start behind it waits.
    let openList = () => undefined as void;
    engine.gates.set("GET /containers/json", new Promise<void>((r) => (openList = r)));
    const sweep = ops.handle(line(1, "sweep", { keep: [] }));
    const start = ops.handle(line(2, "start", { session: SESSION, viewport: VIEWPORT, timeoutSeconds: 600 }));
    await new Promise((r) => setTimeout(r, 20));
    const stopped = ops.handle(line(3, "stop", { session: SESSION }));
    // The start answers `stopped` before the sweep's listing is done, and asked Docker nothing.
    expect(await start).toEqual({ id: 2, ok: false, error: "stopped" });
    engine.gates.clear();
    openList();
    expect(await stopped).toEqual({ id: 3, ok: true, result: { removed: 0 } });
    await sweep;
    expect(engine.requests.some((r) => r.path === "/networks/create" || r.path === "/containers/create")).toBe(false);
    // A start that runs: the stop waits for it, then removes what it made.
    let openCreate = () => undefined as void;
    engine.gates.set("POST /containers/create", new Promise<void>((r) => (openCreate = r)));
    const running = ops.handle(line(4, "start", { session: OTHER, viewport: VIEWPORT, timeoutSeconds: 600 }));
    await new Promise((r) => setTimeout(r, 20));
    const order: string[] = [];
    const stop2 = ops.handle(line(5, "stop", { session: OTHER })).then((a) => (order.push("stop"), a));
    void running.then(() => order.push("start"));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]);
    engine.gates.clear();
    openCreate();
    expect(await stop2).toEqual({ id: 5, ok: true, result: { removed: 1 } });
    expect(order).toEqual(["start", "stop"]);
    expect(engine.containers).toEqual([]);
    expect(engine.networks).toEqual([]);
  });

  it("the gate lets shared holders pass together, an exclusive one alone, in the order they came", async () => {
    const g = createGate();
    const seen: string[] = [];
    const a = g.enter("shared");
    const x = g.enter("exclusive");
    const b = g.enter("shared");
    void a.ready.then(() => seen.push("a"));
    void x.ready.then(() => seen.push("x"));
    void b.ready.then((ok) => seen.push(ok ? "b" : "b cancelled"));
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["a"]);
    // b waits behind x: nobody passes a waiter ahead of them.
    expect(b.cancel()).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["a", "b cancelled"]);
    a.leave();
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["a", "b cancelled", "x"]);
    expect(x.cancel()).toBe(false);
    x.leave();
    expect(g.state()).toEqual({ shared: 0, exclusive: false, waiting: 0 });
  });

  it("reads a file out of the Engine's archive, a pax header skipped", () => {
    const hash = "cd".repeat(32);
    expect(fileOfTar(tarOf([{ name: "workwrk-packages.sha256", body: Buffer.from(`${hash}\n`) }]).toString("latin1"))).toBe(`${hash}\n`);
    const pax = tarOf([{ name: "PaxHeader", body: Buffer.from("30 mtime=1761019200.123456789\n") }]);
    pax[156] = "x".charCodeAt(0);
    const both = Buffer.concat([pax.subarray(0, 1024), tarOf([{ name: "f", body: Buffer.from(hash) }])]).toString("latin1");
    expect(fileOfTar(both)).toBe(hash);
    expect(fileOfTar("not a tar")).toBeNull();
    expect(fileOfTar(null)).toBeNull();
  });

  it("build sends the committed Dockerfile with --pull, the day, and the image label, as candidate", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    expect(await ops.handle(line(1, "build"))).toEqual({ id: 1, ok: true, result: { created: "2026-10-21T04:16:00Z", baseDigest: "debian@sha256:base1" } });
    expect(engine.builds[0].query).toEqual({ t: "workwrk-chrome:candidate", pull: "1", rm: "1", forcerm: "1", buildargs: '{"CACHE_DAY":"20261021"}', labels: '{"workwrk.browser.image":"1"}' });
    const ctx = engine.builds[0].context;
    expect(ctx.subarray(0, 10).toString()).toBe("Dockerfile");
    // The image's start rides in the context too, executable.
    expect(ctx.subarray(1024, 1033).toString()).toBe("wkb-start");
    expect(ctx.subarray(1024 + 100, 1024 + 107).toString()).toBe("0000755");
    // And Chrome's managed policy (final privacy review, M4), as the Dockerfile copies it.
    expect(ctx.subarray(2048, 2066).toString()).toBe("chrome-policy.json");
    expect(ctx.subarray(2560, 2560 + 21).toString()).toBe('{"SyncDisabled":true}');
    engine.buildOk = false;
    expect(await ops.handle(line(2, "build"))).toEqual({ id: 2, ok: false, error: "build_failed" });
  });

  it("promote retags candidate as the minute's stamp and current, and prunes older than the two newest", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    expect(await ops.handle(line(1, "promote", { tag: "candidate" }))).toEqual({ id: 1, ok: true, result: { tag: "20261021-0415", pruned: 1 } });
    const tags = engine.requests.filter((r) => r.path.endsWith("/tag")).map((r) => r.query);
    expect(tags).toEqual([{ repo: "workwrk-chrome", tag: "20261021-0415" }, { repo: "workwrk-chrome", tag: "current" }]);
    expect(engine.requests.some((r) => r.method === "DELETE" && r.path === "/images/sha256%3Aold")).toBe(true);
    expect(engine.requests.some((r) => r.method === "DELETE" && r.path === "/images/sha256%3Amid")).toBe(false);
    expect(stampOf(Date.parse("2026-01-02T03:04:59Z"))).toBe("20260102-0304");
  });

  it("selftest starts a session of the reserved id on the image asked, and probe answers both exit codes", async () => {
    const engine = fakeEngine();
    const ops = opsOver(engine);
    const st = await ops.handle(line(1, "selftest", { image: "candidate" }));
    expect(st).toEqual({ id: 1, ok: true, result: { name: "wkb-5f3a9c01", ip: "10.250.0.2", image: { created: "2026-10-21T04:16:00Z", packages: "ab".repeat(32) } } });
    // The package hash is read from the self-test's own container, by the Engine's archive of the file the build wrote.
    expect(engine.requests.find((r) => r.path.endsWith("/archive"))).toMatchObject({ method: "GET", path: "/containers/wkb-5f3a9c01/archive", query: { path: "/etc/workwrk-packages.sha256" } });
    expect(engine.requests.find((r) => r.path === "/containers/create")!.body.Image).toBe("workwrk-chrome:candidate");
    engine.waitCodes = { netlink: 0, netlinkHigh: 3, netAdmin: 1 };
    expect(await ops.handle(line(2, "probe", { image: "candidate" }))).toEqual({ id: 2, ok: true, result: { netlink: 0, netlinkHigh: 3, netAdmin: 1 } });
    // Each probe's container is removed once it has answered.
    expect(engine.containers.filter((c) => c.probe)).toEqual([]);
  });

  it("drop removes the candidate tag alone", async () => {
    const engine = fakeEngine();
    expect(await opsOver(engine).handle(line(1, "drop", { tag: "candidate" }))).toEqual({ id: 1, ok: true, result: { dropped: true } });
    expect(engine.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /images/workwrk-chrome:candidate"]);
  });

  it("versions reads Docker, containerd and runc", async () => {
    expect(await opsOver(fakeEngine()).handle(line(1, "versions"))).toEqual({ id: 1, ok: true, result: { docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3" } });
  });
});

describe("the service", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-launcher-"));

  it("answers each line by its id over its socket", async () => {
    const sock = path.join(dir, "l.sock");
    const server = net.createServer();
    serve(server, opsOver(fakeEngine()));
    await new Promise<void>((r) => server.listen(sock, r));
    const conn = net.connect(sock);
    const answers: unknown[] = [];
    let buf = "";
    conn.on("data", (d) => {
      buf += String(d);
      let at;
      while ((at = buf.indexOf("\n")) >= 0) {
        answers.push(JSON.parse(buf.slice(0, at)));
        buf = buf.slice(at + 1);
      }
    });
    conn.write(`${line(7, "versions")}\n${line(8, "nope", {})}\n`);
    for (let i = 0; i < 50 && answers.length < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
    conn.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    expect(answers).toContainEqual({ id: 7, ok: true, result: { docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3" } });
    expect(answers).toContainEqual({ id: 8, ok: false, error: "unknown_op" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads its fixed settings: S within 1024 to 4096, and a seccomp profile that is ERRNO by default", () => {
    expect(sessionMemoryMb(undefined)).toBe(1280);
    expect(sessionMemoryMb("2048")).toBe(2048);
    expect(sessionMemoryMb("512")).toBeNull();
    expect(sessionMemoryMb("9999")).toBeNull();
    expect(compactSeccomp('{ "defaultAction": "SCMP_ACT_ERRNO", "syscalls": [] }')).toBe(SECCOMP);
    expect(() => compactSeccomp('{ "defaultAction": "SCMP_ACT_ALLOW", "syscalls": [] }')).toThrow("seccomp_profile");
  });

  it("builds a tar the Engine reads: a ustar header, the file padded to 512 bytes, two empty blocks", () => {
    const t = tarOf([{ name: "Dockerfile", body: Buffer.from("FROM x\n") }]);
    expect(t.length).toBe(512 + 512 + 1024);
    expect(t.subarray(257, 262).toString()).toBe("ustar");
    expect(t.subarray(512, 519).toString()).toBe("FROM x\n");
    const sum = [...t.subarray(0, 512)].reduce((a, b, i) => a + (i >= 148 && i < 156 ? 32 : b), 0);
    expect(parseInt(t.subarray(148, 154).toString(), 8)).toBe(sum);
  });
});
