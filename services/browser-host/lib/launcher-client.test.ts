// Container mode's launcher client (docs/plans/browser-host.md 5.1, 5.5 and
// Step 3), against a fake launcher service on a unix socket and a fake
// DevTools server: no Docker, no Chrome.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { chromeVersionOf, createLauncherClient, parseSandbox, SELFTEST_SESSION, type Cdp } from "./launcher-client.mjs";

const SESSION = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-lc-"));
let n = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = { id: number; op: string; args?: any };
type Handler = (m: Msg) => unknown | Promise<unknown>;

/** A fake launcher service: every line recorded, each op answered by its handler (a thrown code is an error). */
async function fakeService(handlers: Record<string, Handler>) {
  n += 1;
  const sock = path.join(dir, `s${n}.sock`);
  const seen: Msg[] = [];
  const conns = new Set<net.Socket>();
  const server = net.createServer((c) => {
    conns.add(c);
    let buf = "";
    c.setEncoding("utf8");
    c.on("error", () => undefined);
    c.on("data", (d) => {
      buf += d;
      let at;
      while ((at = buf.indexOf("\n")) >= 0) {
        const m = JSON.parse(buf.slice(0, at)) as Msg;
        buf = buf.slice(at + 1);
        seen.push(m);
        void (async () => {
          try {
            const h = handlers[m.op];
            if (!h) throw new Error("unknown_op");
            c.write(`${JSON.stringify({ id: m.id, ok: true, result: await h(m) })}\n`);
          } catch (e) {
            c.write(`${JSON.stringify({ id: m.id, ok: false, error: (e as Error).message })}\n`);
          }
        })();
      }
    });
  });
  await new Promise<void>((r) => server.listen(sock, r));
  return {
    sock,
    seen,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        for (const c of conns) c.destroy();
      }),
  };
}

/** A fake Chrome DevTools endpoint. */
let devtools: http.Server;
let devPort = 0;
const dev = { up: true, wsHost: "0.0.0.0:9222", hits: 0 };
beforeAll(async () => {
  devtools = http.createServer((req, res) => {
    dev.hits += 1;
    if (!dev.up) {
      res.destroy();
      return;
    }
    res.setHeader("content-type", "application/json");
    if (req.url === "/json/version") res.end(JSON.stringify({ Browser: "HeadlessChrome/154.0.7499.40", webSocketDebuggerUrl: `ws://${dev.wsHost}/devtools/browser/0b5c-77aa` }));
    else if (req.url === "/json/list") res.end(JSON.stringify([{ type: "page", id: "TAB1", url: "about:blank" }]));
    else res.end("{}");
  });
  await new Promise<void>((r) => devtools.listen(0, "127.0.0.1", r));
  devPort = (devtools.address() as net.AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => devtools.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  dev.up = true;
  dev.wsHost = "0.0.0.0:9222";
});

const clients: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});
function client(sock: string, extra: Partial<Parameters<typeof createLauncherClient>[0]> = {}) {
  const ips: string[] = [];
  const c = createLauncherClient({ socketPath: sock, devtoolsBase: (ip) => (ips.push(ip), `http://127.0.0.1:${devPort}`), launchMs: 1500, pollMs: 20, exitPollMs: 40, ...extra });
  clients.push(c);
  return Object.assign(c, { ips });
}
const ASK = { id: SESSION, viewport: { width: 1280, height: 800 }, timeoutSeconds: 600, proof: false };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("launch", () => {
  it("asks start with the three arguments, polls the container's own DevTools, and rebuilds the browser endpoint on its address", async () => {
    const svc = await fakeService({ start: () => ({ name: "wkb-1a2b3c4d", ip: "10.250.0.2" }), list: () => [{ session: SESSION, running: true }] });
    const c = client(svc.sock);
    const l = await c.launch(ASK);
    expect(svc.seen[0]).toEqual({ id: 1, op: "start", args: { session: SESSION, viewport: { width: 1280, height: 800 }, timeoutSeconds: 600 } });
    expect(c.ips).toEqual(["10.250.0.2"]);
    // Never Chrome's own host name: the path, on the container's address.
    expect(l.browserWs).toBe(`ws://127.0.0.1:${devPort}/devtools/browser/0b5c-77aa`);
    expect(l.devtoolsBase).toBe(`http://127.0.0.1:${devPort}`);
    expect(l.tabTargetId).toBe("TAB1");
    expect(l.stateEntry).toEqual({ id: SESSION, container: "wkb-1a2b3c4d", network: "wkb-1a2b3c4d" });
    await svc.close();
  });

  it("asks stop and rejects chrome_did_not_start when DevTools does not answer in time", async () => {
    dev.up = false;
    const svc = await fakeService({ start: () => ({ name: "wkb-1a2b3c4d", ip: "10.250.0.2" }), stop: () => ({ removed: 1 }) });
    const c = client(svc.sock, { launchMs: 300 });
    const t0 = Date.now();
    await expect(c.launch(ASK)).rejects.toThrow("chrome_did_not_start");
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(svc.seen.map((m) => m.op)).toEqual(["start", "stop"]);
    expect(svc.seen[1].args).toEqual({ session: SESSION });
    await svc.close();
  });

  it("refuses a start answer outside the session pool, or a refused start, and cleans up either way", async () => {
    for (const start of [() => ({ name: "wkb-1a2b3c4d", ip: "172.17.0.2" }), () => ({ name: "../x", ip: "10.250.0.2" }), () => Promise.reject(new Error("no_subnet"))]) {
      const svc = await fakeService({ start, stop: () => ({ removed: 0 }) });
      const c = client(svc.sock);
      const hits = dev.hits;
      await expect(c.launch(ASK)).rejects.toThrow("chrome_did_not_start");
      expect(dev.hits).toBe(hits);
      expect(svc.seen.map((m) => m.op)).toEqual(["start", "stop"]);
      await svc.close();
    }
  });

  it("resolves exited once a list asked after the launch no longer shows it running, and never on a failed list", async () => {
    let list: () => unknown = () => [{ session: SESSION, running: true }];
    const svc = await fakeService({ start: () => ({ name: "wkb-1a2b3c4d", ip: "10.250.0.2" }), list: () => list() });
    const c = client(svc.sock);
    const l = await c.launch(ASK);
    let gone: string | null = null;
    void l.exited.then((w) => (gone = w));
    await wait(150);
    expect(gone).toBeNull();
    list = () => {
      throw new Error("engine_unreachable");
    };
    await wait(150);
    expect(gone).toBeNull();
    list = () => [];
    await wait(150);
    expect(gone).toBe("exit");
    await svc.close();
  });
});

describe("the sweep", () => {
  it("reads its keep list when its line is written, not when it was asked", async () => {
    const svc = await fakeService({ sweep: () => ({ removed: 2 }) });
    let open = () => undefined as void;
    const gate = new Promise<void>((r) => (open = r));
    const c = client(svc.sock, {
      connect: async (p) => {
        await gate;
        return await new Promise<net.Socket>((resolve, reject) => {
          const s = net.connect(p);
          s.once("connect", () => resolve(s));
          s.once("error", reject);
        });
      },
    });
    const keep = ["a1b2c3d4-0000-4000-8000-000000000001"];
    const swept = c.sweep(() => keep);
    // A create lands while the connection is still opening.
    keep.push(SESSION);
    open();
    expect(await swept).toBe(2);
    expect(svc.seen[0]).toEqual({ id: 1, op: "sweep", args: { keep: ["a1b2c3d4-0000-4000-8000-000000000001", SESSION] } });
    await svc.close();
  });

  it("keeps the self-test's session while the self-test runs", async () => {
    let during: Promise<number> | null = null;
    const ref: { c?: ReturnType<typeof client> } = {};
    const svc = await fakeService({
      selftest: () => ({ name: "wkb-00000000", ip: "10.250.0.2", image: { created: "2026-10-21T04:16:00Z" } }),
      sweep: () => ({ removed: 0 }),
      stop: () => ({ removed: 1 }),
      probe: () => ({ netlink: 0, netlinkHigh: 0, netAdmin: 0 }),
    });
    const fakeCdp = async (): Promise<Cdp> => ({
      send: async (method: string) => {
        if (method === "Browser.getVersion") {
          during = ref.c!.sweep(() => [SESSION]);
          await during;
          return { product: "HeadlessChrome/154.0.7499.40" };
        }
        if (method === "Runtime.evaluate") return { result: { value: "Seccomp-BPF sandbox\tYes\nLayer 1 Sandbox\tNamespace\nYou are adequately sandboxed." } };
        return {};
      },
      close: () => undefined,
    });
    const c = client(svc.sock, { cdp: fakeCdp });
    ref.c = c;
    const r = await c.selfTest("candidate");
    expect(r).toEqual({ chrome: "154.0.7499.40", sandbox: "namespace seccomp_bpf", probes: { netlink: 0, netlinkHigh: 0, netAdmin: 0 }, imageCreated: "2026-10-21T04:16:00Z" });
    const sweeps = svc.seen.filter((m) => m.op === "sweep");
    expect(sweeps[0].args).toEqual({ keep: [SESSION, SELFTEST_SESSION] });
    await c.sweep(() => [SESSION]);
    expect(svc.seen.filter((m) => m.op === "sweep")[1].args).toEqual({ keep: [SESSION] });
    // Stopped before the probes run, on the image asked.
    const ops = svc.seen.map((m) => m.op).filter((op) => op !== "sweep");
    expect(ops).toEqual(["selftest", "stop", "probe"]);
    expect(svc.seen.find((m) => m.op === "probe")!.args).toEqual({ image: "candidate" });
    expect(svc.seen.find((m) => m.op === "stop")!.args).toEqual({ session: SELFTEST_SESSION });
    await svc.close();
  });
});

describe("the rest", () => {
  it("is unreachable once the socket refuses, and reachable again at the next answer", async () => {
    const sock = path.join(dir, "late.sock");
    const c = client(sock);
    expect(c.reachable()).toBe(true);
    await expect(c.versions()).rejects.toThrow("launcher_unreachable");
    expect(c.reachable()).toBe(false);
    const server = net.createServer((s) => {
      s.on("error", () => undefined);
      s.on("data", (d) => s.write(`${JSON.stringify({ id: JSON.parse(String(d)).id, ok: true, result: { docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3" } })}\n`));
    });
    await new Promise<void>((r) => server.listen(sock, r));
    expect(await c.versions()).toEqual({ docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3" });
    expect(c.reachable()).toBe(true);
    c.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("reaps what a state file names by stopping each session, and skips anything else", async () => {
    const svc = await fakeService({ stop: (m) => ({ removed: m.args.session === SESSION ? 1 : 0 }) });
    const c = client(svc.sock);
    expect(await c.reap([{ id: SESSION, container: "wkb-1a2b3c4d", network: "wkb-1a2b3c4d" }, { id: "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a" }, { id: "../../etc" }, { pid: 4 }])).toBe(1);
    expect(svc.seen.map((m) => m.args.session)).toEqual([SESSION, "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a"]);
    await svc.close();
  });

  it("reads chrome://sandbox and Browser.getVersion", () => {
    expect(parseSandbox("Layer 1 Sandbox\tNamespace\nPID namespaces\tYes\nSeccomp-BPF sandbox\tYes\nYou are adequately sandboxed.")).toEqual({ ok: true, summary: "namespace seccomp_bpf" });
    expect(parseSandbox("Layer 1 Sandbox\tNamespace\nSeccomp-BPF sandbox\tNo\nYou are not adequately sandboxed!").ok).toBe(false);
    expect(parseSandbox("Layer 1 Sandbox\tNone\nSeccomp-BPF sandbox\tYes\nYou are adequately sandboxed.").ok).toBe(false);
    expect(chromeVersionOf("HeadlessChrome/154.0.7499.40")).toBe("154.0.7499.40");
    expect(chromeVersionOf("Chrome/154")).toBeNull();
  });
});
