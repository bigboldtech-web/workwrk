// Proof mode, as the proofs use it (docs/plans/browser-host.md Decision 17
// and 12.1): the host started by main.mjs with --proof answers the stand-in's
// controls with their old answers, writes its log in the old shapes, serves
// every fixture site, and holds every string the Phase 4 and Phase 5 proofs
// read from proof/fixtures.mjs and proof/controls.mjs. No Chrome is started
// here: no session is ever made.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { run } from "../main.mjs";
import { PAGE_FUNCTIONS } from "./controls.mjs";
import { FIXTURE_HOSTS } from "./fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** What the proofs read from proof/fixtures.mjs and proof/controls.mjs (P4's planted words, P5's source check; 12.1). */
const P4_READS = ["Covered list words"];
const P5_READS = ['"expenses.proof.test"', '"pay.proof.test"', "renameSubmit", "jumpy", "fakeEvents", 'what === "click"', 'what === "choose"', 'what === "back"'];
const P4 = "scripts/live-proof-ai-teammates-phase4.ts";
const P5 = "scripts/live-proof-ai-teammates-phase5.ts";
const readOf = (file: string) => `readFileSync(join(process.cwd(), "${file}"), "utf8")`;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-proof-"));
const logFile = path.join(dir, "log.jsonl");
let host: Awaited<ReturnType<typeof run>>;
let api = "";
let fixturePort = 0;

beforeAll(async () => {
  const port = await freePort();
  fixturePort = await freePort();
  host = await run(
    {
      BROWSER_HOST_MODE: "process",
      BROWSER_HOST_PORT: String(port),
      BROWSER_HOST_FIXTURE_PORT: String(fixturePort),
      BROWSER_HOST_KEY: "stand-in",
      BROWSER_HOST_STATE_DIR: dir,
      BROWSER_STAND_IN_LOG: logFile,
      CHROME: path.join(dir, "no-chrome-here"),
    },
    ["--proof"],
    { signals: false, write: () => undefined },
  );
  if (!host) throw new Error("the host refused to start");
  api = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await host?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, unknown>;
const control = async (p: string, method = "POST") => {
  const r = await fetch(`${api}/__stand-in/${p}`, { method });
  return { status: r.status, body: (await r.json()) as Json & Json[] };
};
const v1 = async (method: string, p: string, body?: unknown, key = "stand-in") => {
  const r = await fetch(`${api}${p}`, { method, headers: { "x-bb-api-key": key, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: (await r.json()) as Json };
};
const fixture = (host: string, p: string, method = "GET", body = "") =>
  new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: fixturePort, path: p, method, headers: { host, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
const logSince = async (since = 0) => (await control(`log?since=${since}`, "GET")).body as unknown as Json[];

const APP_BODY = {
  projectId: "stand-in",
  region: "us-east-1",
  timeout: 960,
  keepAlive: false,
  browserSettings: { viewport: { width: 1280, height: 800 }, recordSession: false, logSession: false, blockAds: true },
  userMetadata: { wk: "workwrk", row: "cm1row0000000000000000000" },
};

describe("the strings the proofs read", () => {
  it("are held by fixtures.mjs and controls.mjs, the files the proofs read", () => {
    const proof = read("services/browser-host/proof/fixtures.mjs") + read("services/browser-host/proof/controls.mjs");
    for (const s of [...P4_READS, ...P5_READS]) expect({ s, proof: proof.includes(s) }).toEqual({ s, proof: true });
    expect(FIXTURE_HOSTS).toEqual(expect.arrayContaining(["expenses.proof.test", "pay.proof.test"]));
    for (const fn of ["renameSubmit", "jumpy", "fakeEvents"]) expect(PAGE_FUNCTIONS.has(fn)).toBe(true);
  });

  it("P4 always holds review round 1's planted words, read from fixtures.mjs, and stops when one is missing (no if that quietly checks fewer)", async () => {
    const p4 = read(P4);
    expect(p4).not.toContain('.includes("Covered list words")) {');
    const list = (name: string) => {
      const m = new RegExp(`const ${name} = \\[([^\\]]*)\\];`).exec(p4);
      return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    };
    const hidden = list("ROUND1_HIDDEN");
    const visible = list("ROUND1_VISIBLE");
    expect({ hidden: hidden.length, visible: visible.length }).toEqual({ hidden: 9, visible: 3 });
    expect(hidden[0]).toBe("Covered list words");
    expect(p4).toContain(`const plantedFixtures = ${readOf("services/browser-host/proof/fixtures.mjs")};`);
    expect(p4).toContain("if (round1Missing.length > 0) throw new Error(");
    expect(p4).toContain("HIDDEN.push(...ROUND1_HIDDEN);");
    expect(p4).toContain("VISIBLE.push(...ROUND1_VISIBLE);");
    const fixtures = read("services/browser-host/proof/fixtures.mjs");
    const page = (await fixture("inject.proof.test", "/")).text;
    for (const w of [...hidden, ...visible]) expect({ w, fixtures: fixtures.includes(w), served: page.includes(w) }).toEqual({ w, fixtures: true, served: true });
  });

  it("P5's source check reads fixtures.mjs and controls.mjs together, for all eight strings", () => {
    const p5 = read(P5);
    expect(p5).toContain('["services/browser-host/proof/fixtures.mjs", "services/browser-host/proof/controls.mjs"].map((f) => readFileSync(join(process.cwd(), f), "utf8")).join("\\n")');
    for (const s of P5_READS) expect(p5).toContain(s);
  });

  it("neither proof reads the launcher for them, and the launcher no longer holds them", () => {
    for (const p of [P4, P5]) expect({ p, readsLauncher: read(p).includes(readOf("scripts/browser-stand-in.mjs")) }).toEqual({ p, readsLauncher: false });
    const launcher = read("scripts/browser-stand-in.mjs");
    for (const s of [...P4_READS, ...P5_READS]) expect({ s, inLauncher: launcher.includes(s) }).toEqual({ s, inLauncher: false });
  });

  it("each proof's RUN header shows the workwrk provider against the launcher, and the older stand-in provider beside it", () => {
    for (const p of [P4, P5]) {
      const text = read(p);
      const header = text.slice(text.indexOf("// RUN,"), text.indexOf("npx tsx scripts/live-proof-ai-teammates-phase"));
      expect({ p, workwrk: header.includes("BROWSER_PROVIDER=workwrk BROWSER_HOST_URL=http://127.0.0.1:8789 BROWSER_HOST_KEY=stand-in") }).toEqual({ p, workwrk: true });
      const after = text.slice(text.indexOf("// The older stand-in provider works too"));
      expect({ p, standIn: after.slice(0, 600).includes("BROWSER_PROVIDER=stand-in BROWSERBASE_API_KEY=stand-in BROWSERBASE_PROJECT_ID=stand-in") && after.slice(0, 600).includes("BROWSERBASE_BASE_URL=http://127.0.0.1:8789") }).toEqual({ p, standIn: true });
      expect(header).toContain("node scripts/browser-stand-in.mjs 8789");
    }
  });
});

describe("the fixture sites", () => {
  it("serves every site, and a host it does not know answers 404", async () => {
    const pages: Array<[string, string, string]> = [
      ["docs.proof.test", "/", "Proof docs"],
      ["docs.proof.test", "/cached", "Cached docs words."],
      ["inject.proof.test", "/", "Covered list words"],
      ["login.proof.test", "/", "Sign in"],
      ["shop.proof.test", "/checkout", "Place order"],
      ["expenses.proof.test", "/new", "window.renameSubmit"],
      ["expenses.proof.test", "/pickers", "Leave request"],
      ["expenses.proof.test", "/busy", "Expense 365"],
      ["pay.proof.test", "/card", "Card number"],
      ["ads.proof.test", "/", "An ad"],
      ["blocked.proof.test", "/", "You should never see this."],
      ["exfil.proof.test", "/", "You should never see this."],
    ];
    for (const [h, p, words] of pages) {
      const r = await fixture(h, p);
      // /cached keeps its own header, so the browser may keep it in its back/forward cache (as the stand-in served it).
      const store = p === "/cached" ? "private, max-age=0" : "no-store";
      expect({ h, p, status: r.status, has: r.text.includes(words), store: r.headers["cache-control"] }).toEqual({ h, p, status: 200, has: true, store });
    }
    expect((await fixture("nowhere.proof.test", "/")).status).toBe(404);
    expect((await fixture("docs.proof.test", "/redirect-blocked")).headers.location).toBe("http://blocked.proof.test/");
  });

  it("logs each hit as host, path and method, never a query or a form value", async () => {
    await control("reset");
    await fixture("docs.proof.test", "/guide?secret=1");
    await fixture("login.proof.test", "/session", "POST", "email=a%40b.c&password=hunter22");
    const entries = (await logSince(0)).filter((e) => e.kind === "fixture");
    expect(entries.map((e) => ({ host: e.host, path: e.path, method: e.method, status: e.status }))).toEqual([
      { host: "docs.proof.test", path: "/guide", method: "GET", status: 200 },
      { host: "login.proof.test", path: "/session", method: "POST", status: 302 },
    ]);
    expect(entries[1]).toMatchObject({ passwordLength: 8, hasEmail: true });
    const all = JSON.stringify(await logSince(0)) + fs.readFileSync(logFile, "utf8");
    expect(all).not.toContain("hunter22");
    expect(all).not.toContain("secret=1");
  });
});

describe("the controls, with the stand-in's answers", () => {
  it("reset answers ok and clears the log and its numbering; sessions and log are GETs", async () => {
    await fixture("docs.proof.test", "/");
    expect(await control("reset")).toEqual({ status: 200, body: { ok: true } });
    expect(await logSince(0)).toEqual([]);
    expect((await control("sessions", "GET")).body).toEqual([]);
  });

  it("answers the session controls 404 for a session it does not run, and refuses a page function it does not know", async () => {
    for (const what of ["type?session=x&selector=%23a&text=b", "click?session=x&selector=%23a", "choose?session=x&selector=%23a&index=1", "back?session=x", "page?session=x&fn=renameSubmit", "kill?session=x"]) {
      expect(await control(what)).toEqual({ status: 404, body: { error: "no such session" } });
    }
    expect(await control("page?session=x&fn=alert")).toEqual({ status: 400, body: { error: "no such page function" } });
    expect(await control("nothing")).toEqual({ status: 404, body: { error: "no such control" } });
  });

  it("a control is logged as kind control, which the proofs leave out", async () => {
    await control("reset");
    await control("kill?session=abc");
    expect((await logSince(0)).map((e) => ({ kind: e.kind, route: e.route, session: e.session }))).toEqual([{ kind: "control", route: "control.kill", session: "abc" }]);
  });
});

describe("a request target that is not a path", () => {
  it("answers 400 to a request and to an upgrade, and the host goes on (it never throws)", async () => {
    const port = Number(new URL(api).port);
    const rawFirstLine = (text: string) =>
      new Promise<string>((resolve) => {
        const c = net.connect(port, "127.0.0.1", () => c.write(text));
        let got = "";
        c.on("data", (d) => {
          got += String(d);
          if (got.includes("\r\n")) {
            resolve(got.split("\r\n")[0]);
            c.destroy();
          }
        });
        c.on("close", () => resolve(got.split("\r\n")[0] || "closed"));
        c.on("error", () => resolve("error"));
      });
    const upgrade = "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n";
    expect(await rawFirstLine(`GET http://a:99999/connect/x HTTP/1.1\r\nHost: 127.0.0.1\r\n${upgrade}\r\n`)).toBe("HTTP/1.1 400 Bad Request");
    expect(await rawFirstLine(`GET http://a:99999/live/x HTTP/1.1\r\nHost: 127.0.0.1\r\n${upgrade}\r\n`)).toBe("HTTP/1.1 400 Bad Request");
    expect(await rawFirstLine("GET http://a:99999/v1/sessions HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")).toBe("HTTP/1.1 400 Bad Request");
    expect((await fetch(`${api}/healthz`)).status).toBe(200);
    expect((await control("sessions", "GET")).status).toBe(200);
  });
});

describe("the API in proof mode", () => {
  it("fail injects its answer after the key, logged as the stand-in did", async () => {
    await control("reset");
    expect((await control("fail?route=create&status=503&times=1")).body).toEqual({ ok: true, rule: { route: "create", status: 503, times: 1, delayMs: 0 } });
    expect(await v1("POST", "/v1/sessions", APP_BODY, "nope")).toMatchObject({ status: 401 });
    const r = await v1("POST", "/v1/sessions", APP_BODY);
    expect(r).toMatchObject({ status: 503, body: { error: "injected" } });
    const made = (await logSince(0)).filter((e) => e.kind === "api" && e.route === "create");
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ kind: "api", method: "POST", path: "/v1/sessions", route: "create", injected: { status: 503, delayMs: 0 }, status: 503 });
    expect(typeof made[0].seq).toBe("number");
    expect(typeof made[0].at).toBe("string");
  });

  it("logs what a create asked for: recording and logging, keepAlive, timeout, region, the tag and the row", async () => {
    await control("reset");
    // Refused for its region (400), so no Chrome starts here; the entry is written all the same.
    const r = await v1("POST", "/v1/sessions", { ...APP_BODY, region: "eu-central-1" });
    expect(r).toMatchObject({ status: 400, body: { error: "bad_request", field: "region" } });
    const made = (await logSince(0)).filter((e) => e.kind === "api" && e.route === "create");
    expect(made[0]).toMatchObject({
      recordSession: false,
      logSession: false,
      keepAlive: false,
      timeout: 960,
      region: "eu-central-1",
      tag: "workwrk",
      row: "cm1row0000000000000000000",
    });
  });

  it("an injected 429 carries Retry-After: 7", async () => {
    await control("fail?route=list&status=429");
    const r = await v1("GET", "/v1/sessions?status=RUNNING");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("7");
  });

  it("a release of an id it does not know answers 404, logged with its path", async () => {
    await control("reset");
    const id = "00000000-0000-4000-8000-000000000001";
    expect((await v1("POST", `/v1/sessions/${id}`, { projectId: "stand-in", status: "REQUEST_RELEASE" })).status).toBe(404);
    const rel = (await logSince(0)).find((e) => e.kind === "api" && e.route === "release");
    expect(String(rel?.path)).toBe(`/v1/sessions/${id}`);
  });

  it("the key is still stand-in, and a wrong one is logged with its 401", async () => {
    await control("reset");
    expect((await v1("GET", "/v1/sessions?status=RUNNING", undefined, "nope")).status).toBe(401);
    expect((await v1("GET", "/v1/sessions?status=RUNNING")).status).toBe(200);
    expect((await logSince(0)).map((e) => e.status)).toEqual([401, 200]);
  });

  it("writes every entry to BROWSER_STAND_IN_LOG as it happens", async () => {
    await control("reset");
    await fixture("exfil.proof.test", "/x");
    const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Json);
    expect(lines.at(-1)).toMatchObject({ kind: "fixture", host: "exfil.proof.test", path: "/x", method: "GET" });
  });
});

describe("the live view, wired into the host (main.mjs)", () => {
  it("serves its page framed by the proofs' app origin alone, and its assets, with no key", async () => {
    const r = await fetch(`${api}/live/00000000-0000-4000-8000-000000000001`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors http://localhost:3016;");
    expect(r.headers.get("content-security-policy")).toContain(`connect-src ${api.replace("http", "ws")};`);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(await r.text()).toContain('<script type="module" src="/live/assets/live.mjs"></script>');
    for (const a of ["live.mjs", "view.mjs", "copy.mjs", "live.css"]) {
      const x = await fetch(`${api}/live/assets/${a}`);
      expect({ a, status: x.status, store: x.headers.get("cache-control"), corp: x.headers.get("cross-origin-resource-policy") }).toEqual({ a, status: 200, store: "no-store", corp: "same-origin" });
    }
  });

  it("its websocket refuses another Origin before the upgrade, and tells a viewer of a session it does not run that it ended", async () => {
    const at = `${api.replace("http", "ws")}/live/00000000-0000-4000-8000-000000000001/ws`;
    const refused = new WebSocket(at, { origin: "http://localhost:3016" });
    expect(await new Promise<number>((r) => refused.on("unexpected-response", (_q, res) => r(res.statusCode ?? 0)).on("error", () => undefined))).toBe(403);
    const ws = new WebSocket(at, { origin: api });
    const texts: string[] = [];
    ws.on("message", (d) => texts.push(String(d)));
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", token: "x.y" })));
    const closed = await new Promise<number>((r) => ws.on("close", (code) => r(code)));
    expect({ closed, texts }).toEqual({ closed: 4404, texts: ['{"t":"ended"}'] });
    const health = await v1("GET", "/health");
    expect((health.body.counts as Record<string, Record<string, number>>).live).toMatchObject({ refusedOrigin: 1, ended: 1, viewers: 0 });
  });
});
