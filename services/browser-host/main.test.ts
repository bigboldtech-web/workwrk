// Container mode, wired into the host (docs/plans/browser-host.md 5.1, 5.5,
// 3.2 and Step 3), against a fake launcher service on a unix socket: no
// Docker and no Chrome. A host whose preflight and self-test have not passed
// starts, answers /healthz 503, reports the launcher's versions in /health,
// refuses creates with a blocking problem, and asked the launcher to sweep
// everything at start.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256 } from "./lib/config.mjs";
import { BLOCKING_PROBLEMS } from "./lib/sessions.mjs";
import { createDrains, DRAIN_SELF_UNDRAIN_MS, DRAIN_STUCK_MS, run } from "./main.mjs";

const KEY = "a-long-production-key-of-forty-characters";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-main-"));
const sock = path.join(dir, "l.sock");
const seen: Array<{ op: string; args?: unknown }> = [];
let launcher: net.Server;
let host: Awaited<ReturnType<typeof run>>;
let base = "";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

beforeAll(async () => {
  launcher = net.createServer((c) => {
    let buf = "";
    c.setEncoding("utf8");
    c.on("error", () => undefined);
    c.on("data", (d) => {
      buf += d;
      let at;
      while ((at = buf.indexOf("\n")) >= 0) {
        const m = JSON.parse(buf.slice(0, at));
        buf = buf.slice(at + 1);
        seen.push({ op: m.op, args: m.args });
        const answer =
          m.op === "versions"
            ? { ok: true, result: { docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3" } }
            : m.op === "sweep" || m.op === "stop"
              ? { ok: true, result: { removed: 0 } }
              : m.op === "list"
                ? { ok: true, result: [] }
                : // No image yet, and a build that fails: the self-test never passes here.
                  { ok: false, error: m.op === "selftest" ? "engine_404" : "build_failed" };
        c.write(`${JSON.stringify({ id: m.id, ...answer })}\n`);
      }
    });
  });
  await new Promise<void>((r) => launcher.listen(sock, r));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  host = await run(
    {
      BROWSER_HOST_MODE: "container",
      BROWSER_HOST_PORT: String(port),
      BROWSER_HOST_PUBLIC_URL: "https://browsers.workwrkbrowsers.com",
      BROWSER_HOST_APP_ORIGIN: "https://app.workwrk.com",
      BROWSER_HOST_REGION: "eu-central-1",
      BROWSER_HOST_KEY_SHA256: sha256(KEY).toString("hex"),
      BROWSER_HOST_STATE_DIR: dir,
    },
    [],
    { signals: false, write: () => undefined, launcherSocket: sock },
  );
  if (!host) throw new Error("the host refused to start");
});
afterAll(async () => {
  await host?.stop();
  await new Promise<void>((r) => launcher.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = async (p: string, key: string | null = KEY) => {
  const r = await fetch(`${base}${p}`, { headers: key ? { "x-bb-api-key": key } : {} });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: r.status, text, json };
};

describe("container mode in main.mjs", () => {
  it("starts, sweeps everything the launcher holds before answering, and reads its versions", async () => {
    expect(host!.cfg.mode).toBe("container");
    const firstSweep = seen.find((m) => m.op === "sweep");
    expect(firstSweep?.args).toEqual({ keep: [] });
    expect(seen.findIndex((m) => m.op === "sweep")).toBeLessThan(seen.findIndex((m) => m.op === "versions"));
    const h = await get("/health");
    expect(h.status).toBe(200);
    expect(h.json).toMatchObject({ mode: "container", region: "eu-central-1", ok: false, chrome: null, imageAgeDays: null, firewallCheckedAt: null });
    expect(h.json.versions).toMatchObject({ docker: "29.0.4", containerd: "v2.1.5", runc: "1.3.3", node: process.versions.node });
    // This laptop is no browser server: the firewall was never checked, and no self-test passed.
    expect(h.json.problems).toEqual(expect.arrayContaining(["preflight", "firewall_unchecked", "selftest_failed"]));
  });

  it("answers /healthz 503 while a problem needs a person, and refuses creates with a blocking one", async () => {
    expect(await get("/healthz", null)).toMatchObject({ status: 503, text: "unavailable" });
    const r = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "x-bb-api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({ projectId: "workwrk", region: "eu-central-1", timeout: 960, keepAlive: false, browserSettings: { viewport: { width: 1280, height: 800 } }, userMetadata: { wk: "workwrk-prod", row: "r1" } }),
    });
    const body = (await r.json()) as { error: string; why: string };
    expect(r.status).toBe(503);
    expect(body.error).toBe("unavailable");
    expect(BLOCKING_PROBLEMS).toContain(body.why);
    // Nothing was started: no start ever reached the launcher.
    expect(seen.some((m) => m.op === "start")).toBe(false);
  });

  it("asks the launcher for a first image when the server has none, and keeps creates refused while that fails", async () => {
    for (let i = 0; i < 50 && !seen.some((m) => m.op === "build"); i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(seen.some((m) => m.op === "build")).toBe(true);
    // A failed build promotes nothing and runs no candidate self-test.
    expect(seen.some((m) => m.op === "promote" || m.op === "selftest")).toBe(false);
    expect((await get("/health")).json.problems).toContain("selftest_failed");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "images.json"), "utf8"))).toMatchObject({ current: null, lastAttempt: "failed" });
  });
});

describe("the drain", () => {
  it("is drain_stuck once held over 40 minutes, from its first drain, and not after an undrain", () => {
    let t = 1000;
    const calls: string[] = [];
    const d = createDrains({ drain: () => void calls.push("drain"), undrain: () => void calls.push("undrain"), status: () => ({ max: 4, running: 1, starting: 0, held: 0 }) }, () => t);
    d.drain();
    t += 30 * 60_000;
    // A second drain (the maintenance job after SIGUSR2) keeps the first one's start.
    d.drain();
    t += 10 * 60_000;
    expect(d.stuck()).toBe(false);
    t += 1;
    expect(d.stuck()).toBe(true);
    expect(DRAIN_STUCK_MS).toBe(40 * 60_000);
    d.undrain();
    expect(d.stuck()).toBe(false);
    expect(calls).toEqual(["drain", "drain", "undrain"]);
    expect(d.status()).toEqual({ max: 4, running: 1, starting: 0, held: 0 });
  });

  it("is lifted by the host itself once held 10 minutes past drain_stuck, when nobody lifted it (final contract review, M3)", () => {
    let t = 0;
    const calls: string[] = [];
    const d = createDrains({ drain: () => void calls.push("drain"), undrain: () => void calls.push("undrain"), status: () => ({ max: 4, running: 0, starting: 0, held: 0 }) }, () => t);
    d.drain();
    // The maintenance job applies at 40 minutes, stopping the host: the host never lifts a drain before that.
    t = DRAIN_STUCK_MS + 9 * 60_000;
    expect(d.tick()).toBe(false);
    expect(d.stuck()).toBe(true);
    t = DRAIN_SELF_UNDRAIN_MS + 1;
    expect(d.tick()).toBe(true);
    expect(d.stuck()).toBe(false);
    expect(calls).toEqual(["drain", "undrain"]);
    expect(d.selfUndrains()).toBe(1);
    expect(d.tick()).toBe(false);
    expect(DRAIN_SELF_UNDRAIN_MS).toBe(50 * 60_000);
  });
});

describe("the HTTP server", () => {
  it("keeps an idle connection longer than Caddy's upstream pool (2 minutes), so Caddy never reuses one the host is closing", () => {
    expect(host!.server.keepAliveTimeout).toBeGreaterThan(120_000);
  });
});

describe("process mode's Host check (final security review, L6)", () => {
  /** One raw request: its status line. */
  const raw = (port: number, text: string) =>
    new Promise<string>((resolve) => {
      const c = net.connect(port, "127.0.0.1", () => c.write(text));
      let buf = "";
      c.setEncoding("utf8");
      c.on("data", (d) => (buf += d));
      c.on("close", () => resolve(buf.split("\r\n")[0]));
      c.on("error", () => resolve(buf.split("\r\n")[0]));
      setTimeout(() => c.destroy(), 1500);
    });

  it("answers 421 to a request or an upgrade whose Host is not the public URL's, before the API, the controls or the live view", async () => {
    const pdir = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-host-"));
    const port = await freePort();
    const fixture = await freePort();
    const h = await run(
      { BROWSER_HOST_PORT: String(port), BROWSER_HOST_FIXTURE_PORT: String(fixture), BROWSER_HOST_KEY: "stand-in", BROWSER_HOST_STATE_DIR: pdir, BROWSER_STAND_IN_LOG: path.join(pdir, "log.jsonl") },
      ["--proof"],
      { signals: false, write: () => undefined },
    );
    try {
      expect(h).not.toBeNull();
      const rebound = `rebind.example:${port}`;
      expect(await raw(port, `POST /__stand-in/reset HTTP/1.1\r\nHost: ${rebound}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)).toBe("HTTP/1.1 421 Misdirected Request");
      expect(await raw(port, `GET /healthz HTTP/1.1\r\nHost: ${rebound}\r\nConnection: close\r\n\r\n`)).toBe("HTTP/1.1 421 Misdirected Request");
      const upgrade = (hostName: string) => `GET /live/00000000-0000-4000-8000-000000000001/ws HTTP/1.1\r\nHost: ${hostName}\r\nOrigin: http://127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
      expect(await raw(port, upgrade(rebound))).toBe("HTTP/1.1 421 Misdirected Request");
      // The public URL's own Host goes through, to the API and to the live view.
      expect(await raw(port, `GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)).toBe("HTTP/1.1 200 OK");
      expect(await raw(port, upgrade(`127.0.0.1:${port}`))).toBe("HTTP/1.1 101 Switching Protocols");
    } finally {
      await h?.stop();
      fs.rmSync(pdir, { recursive: true, force: true });
    }
  });
});
