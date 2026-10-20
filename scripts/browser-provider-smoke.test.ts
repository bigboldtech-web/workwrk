// The smoke check's --host mode (scripts/browser-provider-smoke.ts,
// docs/plans/browser-host.md 9.4 and step 4): the health it holds to the
// floors, and the watch view it opens against a stand-in for our host on
// 127.0.0.1, with the host's own origin as its websocket's Origin. Every
// check here fails on the code before it, which had no --host mode (and ran
// on import).

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { CHROME_MAJOR_FLOOR, healthChecks, IMAGE_AGE_MAX_DAYS, RUNC_FLOOR, versionAtLeast, watchViewChecks } from "./browser-provider-smoke";

const HEALTH = {
  ok: true,
  mode: "container",
  version: "0f58e900",
  chrome: "154.0.7700.12",
  chromeMajor: 154,
  imageBuiltAt: "2026-10-19T04:15:00.000Z",
  imageAgeDays: 1,
  versions: { node: "24.10.0", kernel: "6.8.0-85-generic", docker: "28.5.1", containerd: "1.7.28", runc: "1.3.3", caddy: "2.10.2" },
  max: 4,
  running: 0,
  starting: 0,
  held: 0,
  region: "eu-central-1",
  draining: false,
  counts: { capacityRefusals1h: 0, capacityRefusals24h: 0 },
  problems: [],
};
const OK_Z = { status: 200, text: "ok" };
const SERVER = { loopback: false, region: "eu-central-1", maxAtOnce: "4" };

describe("the floors", () => {
  it("are the spec's, and RUNC_FLOOR equals the host's preflight", async () => {
    expect(CHROME_MAJOR_FLOOR).toBe(154);
    expect(RUNC_FLOOR).toBe("1.3.3");
    expect(IMAGE_AGE_MAX_DAYS).toBe(14);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("services/browser-host/lib/preflight.mjs", "utf8")).toMatch(/RUNC_FLOOR = "1\.3\.3"/);
  });

  it("compares versions by their numbers, a pre-release of the floor below it", () => {
    for (const v of ["1.3.3", "v1.3.3", "1.3.4", "1.4.0", "2.0.0", "1.10.0", "1.3.3+git"]) expect(versionAtLeast(v, "1.3.3"), v).toBe(true);
    for (const v of ["1.3.2", "1.2.9", "0.9.9", "1.3.3-rc.1", "1.3", "", "unknown", null, 133]) expect(versionAtLeast(v, "1.3.3"), String(v)).toBe(false);
  });
});

describe("healthChecks (step 1 of --host)", () => {
  it("holds a healthy container host, and prints every version", () => {
    const out = healthChecks(HEALTH, OK_Z, SERVER);
    expect(out.ok).toBe(true);
    expect(out.lines.at(-1)).toBe("smoke: versions: host 0f58e900, node 24.10.0, kernel 6.8.0-85-generic, docker 28.5.1, containerd 1.7.28, runc 1.3.3, caddy 2.10.2, chrome 154.0.7700.12");
  });

  it("fails each check on its own", () => {
    const failing: Array<[string, unknown, { status: number; text: string }, typeof SERVER]> = [
      ["not ok", { ...HEALTH, ok: false, problems: ["chrome_stale"] }, OK_Z, SERVER],
      ["/healthz 503", HEALTH, { status: 503, text: "unavailable" }, SERVER],
      ["process mode on a server", { ...HEALTH, mode: "process" }, OK_Z, SERVER],
      ["an old Chrome", { ...HEALTH, chromeMajor: 153, chrome: "153.0.1.2" }, OK_Z, SERVER],
      ["no Chrome", { ...HEALTH, chromeMajor: null }, OK_Z, SERVER],
      ["an old runc", { ...HEALTH, versions: { ...HEALTH.versions, runc: "1.2.5" } }, OK_Z, SERVER],
      ["no runc", { ...HEALTH, versions: { ...HEALTH.versions, runc: null } }, OK_Z, SERVER],
      ["a stale image", { ...HEALTH, imageAgeDays: 15 }, OK_Z, SERVER],
      ["no image", { ...HEALTH, imageAgeDays: null }, OK_Z, SERVER],
      ["another region", HEALTH, OK_Z, { ...SERVER, region: "us-east-1" }],
      ["more at once than the host's max", HEALTH, OK_Z, { ...SERVER, maxAtOnce: "5" }],
      ["the default 10 above a max of 4", HEALTH, OK_Z, { ...SERVER, maxAtOnce: undefined as unknown as string }],
      ["no answer", null, OK_Z, SERVER],
    ];
    for (const [why, h, z, o] of failing) expect(healthChecks(h, z, o).ok, why).toBe(false);
  });

  it("takes a lower BROWSER_MAX_AT_ONCE with a note, and process mode on this machine without runc or an image", () => {
    const lower = healthChecks(HEALTH, OK_Z, { ...SERVER, maxAtOnce: "2" });
    expect(lower.ok).toBe(true);
    expect(lower.lines).toContain("smoke: note: BROWSER_MAX_AT_ONCE 2 is below the host's max 4; it should equal it");
    const local = healthChecks({ ...HEALTH, mode: "process", imageAgeDays: null, imageBuiltAt: null, versions: { node: "24.10.0", kernel: "25.5.0", docker: null, containerd: null, runc: null, caddy: null } }, OK_Z, { loopback: true, region: "eu-central-1", maxAtOnce: "4" });
    expect(local.ok).toBe(true);
    expect(local.lines).toContain("smoke: runc: none in process mode");
  });

  it("prints codes and versions only, never words the host sent", () => {
    const out = healthChecks({ ...HEALTH, ok: false, chrome: "<script>alert(1)</script>", problems: ["chrome_stale", "the key is sk-123"], versions: { ...HEALTH.versions, caddy: "v2 with a long story about it" } }, OK_Z, SERVER);
    const all = out.lines.join("\n");
    expect(all).toContain("problems: chrome_stale");
    expect(all).not.toContain("sk-123");
    expect(all).not.toContain("<script>");
    expect(all).not.toContain("long story");
  });
});

// A stand-in for our host's live view (services/browser-host/lib/api.mjs and
// live.mjs): the shell, an asset, and the websocket that refuses any Origin
// but its own, says hello watch, and closes a watch view 4403 at its first input.
type FakeOpts = { setCookie?: boolean; frameAncestors?: string; cache?: string; helloMode?: string; relayInput?: boolean; requireOrigin?: string };
let server: Server | null = null;

async function fakeHost(o: FakeOpts = {}): Promise<{ origin: string; seen: { origins: string[]; inputs: number } }> {
  const seen = { origins: [] as string[], inputs: 0 };
  const s = createServer((req, res) => {
    const headers: Record<string, string> = { "cache-control": o.cache ?? "no-store", "content-security-policy": `default-src 'none'; frame-ancestors ${o.frameAncestors ?? "https://app.workwrk.com"}; base-uri 'none'` };
    if (o.setCookie) headers["set-cookie"] = "x=1";
    if (req.url === "/live/assets/live.mjs" || /^\/live\/[A-Za-z0-9_-]+$/.test(req.url ?? "")) {
      res.writeHead(200, headers);
      res.end("<!doctype html>");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  s.on("upgrade", (req, socket, head) => {
    seen.origins.push(String(req.headers.origin));
    if (req.headers.origin !== (o.requireOrigin ?? origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let said = false;
      ws.on("message", (data) => {
        const msg = JSON.parse(String(data)) as { t: string; token?: string };
        if (!said) {
          said = true;
          if (msg.t !== "hello" || msg.token !== "payload.mac") return ws.close(4400);
          ws.send(JSON.stringify({ t: "hello", mode: o.helloMode ?? "watch", width: 1280, height: 800, exp: 0 }));
          return;
        }
        if (msg.t === "mouse") {
          seen.inputs += 1;
          if (!o.relayInput) ws.close(4403, "watch");
        }
      });
    });
  });
  server = s;
  return { origin, seen };
}

afterEach(async () => {
  const s = server;
  server = null;
  if (s) await new Promise<void>((r) => s.close(() => r()));
});

describe("watchViewChecks (step 3 of --host)", () => {
  it("holds a watch view of our host: its origin, the headers, the hello and the 4403, its websocket opened with the host's own Origin", async () => {
    const { origin, seen } = await fakeHost();
    const out = await watchViewChecks(`${origin}/live/pv-1#t=payload.mac`, { hostOrigin: origin, appOrigin: "https://app.workwrk.com", timeoutMs: 3000 });
    expect(out.lines.filter((l) => l.endsWith("FAILED"))).toEqual([]);
    expect(out.ok).toBe(true);
    // The Origin the host requires (lib/live.mjs refuses any other 403 before the upgrade).
    expect(seen.origins).toEqual([origin]);
    expect(seen.inputs).toBe(1);
    // Never the address or its token.
    const all = out.lines.join("\n");
    expect(all).not.toContain("payload.mac");
    expect(all).not.toContain(origin);
  });

  it("fails a view from another origin, a token in a query, a cookie, a cached page, another frame-ancestors, a control hello, and input that is relayed", async () => {
    const cases: Array<[string, FakeOpts, (origin: string) => string]> = [
      ["another origin", {}, () => "https://evil.example.com/live/pv-1#t=payload.mac"],
      ["a token in a query", {}, (origin) => `${origin}/live/pv-1?t=payload.mac`],
      ["a cookie", { setCookie: true }, (origin) => `${origin}/live/pv-1#t=payload.mac`],
      ["a cached page", { cache: "max-age=60" }, (origin) => `${origin}/live/pv-1#t=payload.mac`],
      ["another frame-ancestors", { frameAncestors: "https://app.workwrk.com https://evil.example.com" }, (origin) => `${origin}/live/pv-1#t=payload.mac`],
      ["a control hello", { helloMode: "control" }, (origin) => `${origin}/live/pv-1#t=payload.mac`],
      ["input that is relayed", { relayInput: true }, (origin) => `${origin}/live/pv-1#t=payload.mac`],
    ];
    for (const [why, opts, live] of cases) {
      const { origin } = await fakeHost(opts);
      const out = await watchViewChecks(live(origin), { hostOrigin: origin, appOrigin: "https://app.workwrk.com", timeoutMs: 800 });
      expect(out.ok, why).toBe(false);
      const s = server;
      server = null;
      if (s) await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it("says a websocket refused before the upgrade by its status, and fails", async () => {
    // A host that wants another Origin than the one sent (as ours refuses any but its own, 403).
    const { origin, seen } = await fakeHost({ requireOrigin: "https://browsers.workwrkbrowsers.com" });
    const started = Date.now();
    const out = await watchViewChecks(`${origin}/live/pv-1#t=payload.mac`, { hostOrigin: origin, appOrigin: "https://app.workwrk.com", timeoutMs: 3000 });
    expect(out.ok).toBe(false);
    expect(seen.origins).toEqual([origin]);
    expect(out.lines.join("\n")).toContain("(refused 403)");
    // Let go at once, not at the timeout.
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
