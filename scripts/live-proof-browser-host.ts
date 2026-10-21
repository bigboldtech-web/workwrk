// The browser host proof (docs/plans/browser-host.md 12.2): our own host,
// started here in process mode WITHOUT proof mode, held to what the app and
// the person rely on. The proof itself is the app: it creates sessions over
// the API and drives each remote Chrome over its connect address with the
// app's own CDP client (src/lib/browser/cdp.ts connectCdp). A second Chrome
// is the person's browser: it opens a harness page that frames the live
// view, and the person's clicks, keys, IME, paste, wheel and touch are sent
// to that page, as a person's would be.
//
// LOCAL ONLY. Everything listens on 127.0.0.1: the host on 18789, its own
// fixture server on 18790 (routes and counts only, plus nickLength for a
// profile save, clicked for a button, and a count of untrusted events), and
// the harness on 18791 (the app origin the host frames for). No database,
// no .env, no outside network. The only person named is max@proof.test, on
// the fixture's profile page, as the other proofs' people are @proof.test.
// Everything it starts it stops by its own PID (the host, the viewer
// Chrome; a session Chrome only by a PID the host's state file names and
// whose command line holds this run's own profile folder).
//
// RUN, from the repository's root, with nothing else on ports 18789 to 18791:
//
//   npx tsx scripts/live-proof-browser-host.ts
//
// It needs a Chrome: CHROME, else the newest chrome-headless-shell under
// ~/.cache/chrome-headless (npx @puppeteer/browsers install
// chrome-headless-shell@stable --path ~/.cache/chrome-headless). The host
// and the viewer run the same one. KEEP=1 keeps the run's scratch folder.
// About three minutes; it prints "N of M checks passed" and exits 1 on any
// failure. Ctrl-C, SIGTERM or a closed terminal (SIGHUP) runs the same
// cleanup as the end of a run (the viewer's process group killed, the host
// stopped, any Chrome its state file names killed, the scratch folder
// removed), then exits 1; a second one kills what is left at once.
//
// THE HOST'S SETTINGS: a random key, BROWSER_HOST_MAX=2, the app origin
// http://127.0.0.1:18791, its own state folder, and the test windows: 5
// seconds to connect, 8 seconds for a control view; the second start (H13)
// adds 15 seconds to firewall_unchecked (H15).
//
// THE CHECKS (12.2): H1 auth, H2 shapes, H3 connect, H4 never connected, H5
// the timeout, H6 the max, H7 control input end to end, H8 a watch view
// cannot type, H9 revoke, expiry and the newest socket, H10 a held button,
// H11 frames, H12 the page, H13 the reaper, H14 nothing kept, H15 health,
// H16 a Chrome crash. H5's minute runs beside H7 to H12 and H16, in the
// other slot.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

import { LIVE_COPY } from "../services/browser-host/live/copy.mjs";
import { chromePath } from "../services/browser-host/lib/launcher-process.mjs";
import { type Cdp, connectCdp } from "../src/lib/browser/cdp";

const HOST_PORT = 18789;
const FIXTURE_PORT = 18790;
const HARNESS_PORT = 18791;
const API = `http://127.0.0.1:${HOST_PORT}`;
const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
const APP_ORIGIN = `http://127.0.0.1:${HARNESS_PORT}`;
const RUN = Date.now().toString(36);
const SCRATCH = mkdtempSync(join(tmpdir(), "bh-proof-"));
const STATE = join(SCRATCH, "state");
const KEY = randomBytes(36).toString("base64url");
const VIEW = { width: 1000, height: 700 };
const CHROME = chromePath(process.env.CHROME?.trim() || null);
/** The fixture's own page words, which the host must never keep. */
const PAGE_WORDS = `Profile words of max@proof.test ${RUN}`;
const PASTE = `Pasted words ${RUN} `.repeat(300).slice(0, 3000);
const ZERO = "00000000-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the host's and CDP's answers, read field by field
type Json = Record<string, any>;

// ── Checks ──────────────────────────────────────────────────────────

const results: Array<{ step: string; name: string; ok: boolean }> = [];
let step = "setup";

function check(name: string, ok: boolean, detail?: unknown): boolean {
  const d = detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 900);
  results.push({ step, name, ok });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${step}: ${name}${!ok && d ? `\n         ${d}` : ""}`);
  return ok;
}

async function until<T>(read: () => Promise<T> | T, done: (v: T) => boolean, ms = 5000, every = 100): Promise<T> {
  const t0 = Date.now();
  let v = await read();
  while (!done(v) && Date.now() - t0 < ms) {
    await sleep(every);
    v = await read();
  }
  return v;
}

/** Every value the host must never keep or log, by kind (H14). */
const secrets = { connect: new Set<string>(), live: new Set<string>(), ids: new Set<string>() };

// ── The host, by its own PID ────────────────────────────────────────

let hostOutput = "";
type Host = { child: ChildProcess; pid: number; startedAt: number; exited: Promise<void>; closed: Promise<void> };
let host: Host | null = null;

function startHost(extra: Record<string, string> = {}): Host {
  // Only what the host needs: never NODE_ENV=production (process mode refuses it), no key of the app's.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    BROWSER_HOST_MODE: "process",
    BROWSER_HOST_PORT: String(HOST_PORT),
    BROWSER_HOST_KEY: KEY,
    BROWSER_HOST_MAX: "2",
    BROWSER_HOST_APP_ORIGIN: APP_ORIGIN,
    BROWSER_HOST_STATE_DIR: STATE,
    BROWSER_HOST_TEST_CONNECT_SECONDS: "5",
    BROWSER_HOST_TEST_CONTROL_SECONDS: "8",
    ...(CHROME ? { CHROME } : {}),
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
  const startedAt = Date.now();
  const child = spawn(process.execPath, [join(process.cwd(), "services/browser-host/main.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d) => (hostOutput += String(d)));
  child.stderr?.on("data", (d) => (hostOutput += String(d)));
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  // "close" comes once its output is read to the end, after "exit": H14 reads the log only then.
  const closed = new Promise<void>((r) => child.once("close", () => r()));
  return { child, pid: child.pid ?? 0, startedAt, exited, closed };
}

/** Stop the host by its PID, and wait until its output is read to the end. */
async function stopHost(h: Host, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  if (h.child.exitCode === null && h.child.signalCode === null) {
    process.kill(h.pid, signal);
    await Promise.race([h.exited, sleep(30_000)]);
    if (h.child.exitCode === null && h.child.signalCode === null) process.kill(h.pid, "SIGKILL");
  }
  await Promise.race([h.closed, sleep(5000)]);
}

type Answer = { status: number; json: Json; text: string; headers: Headers };
async function api(method: string, p: string, body?: unknown, o: { key?: string | null; xff?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (o.key !== null) headers["x-bb-api-key"] = o.key ?? KEY;
  if (o.xff) headers["x-forwarded-for"] = o.xff;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: r.status, json, text, headers: r.headers };
}

const healthz = async () => {
  try {
    const r = await fetch(`${API}/healthz`);
    return { status: r.status, text: await r.text() };
  } catch {
    return { status: 0, text: "" };
  }
};

/** The app's create body (src/lib/browser/browserbase.ts), with our own viewport and timeout. */
const appBody = (over: Json = {}) => ({
  projectId: "workwrk",
  region: "us-east-1",
  timeout: 300,
  keepAlive: false,
  browserSettings: { viewport: VIEW, recordSession: false, logSession: false, blockAds: true },
  userMetadata: { wk: "host-proof", row: `row-${RUN}` },
  ...over,
});

async function create(over: Json = {}): Promise<Answer> {
  const r = await api("POST", "/v1/sessions", appBody(over));
  if (r.status === 201) {
    secrets.ids.add(String(r.json.id));
    const t = new URL(String(r.json.connectUrl)).searchParams.get("t");
    if (t) secrets.connect.add(t);
  }
  return r;
}

/** A live view's address, its token kept for H14. */
async function liveUrl(id: string, mode: "watch" | "control"): Promise<string> {
  const r = await api("GET", `/v1/sessions/${id}/debug${mode === "control" ? "?mode=control" : ""}`);
  const url = String(r.json.debuggerFullscreenUrl ?? "");
  const t = url.split("#t=")[1];
  if (t) secrets.live.add(t);
  return url;
}
const tokenOf = (url: string) => url.split("#t=")[1] ?? "";

async function listed(id: string): Promise<Json | undefined> {
  const r = await api("GET", "/v1/sessions");
  return Array.isArray(r.json) ? (r.json as Json[]).find((s) => s.id === id) : undefined;
}

/** What a websocket upgrade answers: 101 when it opens, else the HTTP status. */
function upgradeStatus(url: string, headers: Record<string, string> = {}): Promise<{ status: number; ws: WebSocket | null }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers, perMessageDeflate: false });
    ws.once("open", () => resolve({ status: 101, ws }));
    ws.once("unexpected-response", (_q, res) => {
      resolve({ status: res.statusCode ?? 0, ws: null });
      ws.terminate();
    });
    ws.once("error", () => resolve({ status: 0, ws: null }));
  });
}

/** A viewer socket of the proof's own (the live view's protocol, 4.2): its hello sent, every text and frame kept. */
type Raw = { ws: WebSocket; texts: Json[]; frames: Array<{ at: number; data: Buffer }>; closed: Promise<{ code: number; reason: string; at: number }> };
function rawViewer(id: string, token: string, headers: Record<string, string> = {}): Raw {
  const ws = new WebSocket(`ws://127.0.0.1:${HOST_PORT}/live/${id}/ws`, { origin: API, headers, perMessageDeflate: false });
  const texts: Json[] = [];
  const frames: Raw["frames"] = [];
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", token })));
  ws.on("message", (d, binary) => {
    if (binary) frames.push({ at: Date.now(), data: Buffer.from(d as Buffer) });
    else {
      try {
        texts.push(JSON.parse(String(d)));
      } catch {
        /* not ours */
      }
    }
  });
  ws.on("error", () => undefined);
  const closed = new Promise<{ code: number; reason: string; at: number }>((r) => ws.on("close", (code, reason) => r({ code, reason: String(reason), at: Date.now() })));
  return { ws, texts, frames, closed };
}
const helloOf = (r: Raw) => until(() => r.texts.find((t) => t.t === "hello"), (v) => Boolean(v), 5000);

// ── The fixture server (18790) and the harness (18791) ─────────────

const fixtureCounts: Record<string, number> = {};
const untrustedTypes: Record<string, number> = {};
const fixtureHits: Array<{ route: string; k: string; at: number; n?: number; b?: number; d?: number }> = [];
let lastNickLength: number | null = null;

const PAGE_HEAD = '<!doctype html><html><head><meta charset="utf-8"><title>Proof fixture</title>';
const SEND = `const send = (q) => fetch('/e?' + q, { method: 'POST', keepalive: true });
for (const t of ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'textInput', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'wheel', 'touchstart', 'touchend', 'focusin', 'focusout', 'change'])
  document.addEventListener(t, (e) => { if (!e.isTrusted) send('k=untrusted&t=' + t); }, true);`;

const PAGES: Record<string, string> = {
  "/profile": `${PAGE_HEAD}<style>body{margin:0;font:16px sans-serif;height:5000px}#btn{position:absolute;left:40px;top:40px;width:220px;height:60px}#nick{position:absolute;left:40px;top:140px;width:400px;height:40px;font-size:18px}#save{position:absolute;left:460px;top:140px;width:120px;height:40px}#words{position:absolute;left:40px;top:220px}</style></head>
<body><button id="btn">Press me</button><input id="nick" autocomplete="off" aria-label="Nickname"><button id="save">Save</button><p id="words">${PAGE_WORDS}</p>
<script>${SEND}
btn.addEventListener('click', () => send('k=clicked'));
save.addEventListener('click', () => { send('k=save&n=' + nick.value.length); nick.value = ''; });
</script></body></html>`,
  "/drag": `${PAGE_HEAD}<style>body{margin:0;font:16px sans-serif}#drag{position:absolute;left:40px;top:40px;width:200px;height:120px;background:#cfd8dc;user-select:none}#other{position:absolute;left:40px;top:300px;width:200px;height:60px}</style></head>
<body><div id="drag">${PAGE_WORDS}</div><button id="other">Other</button>
<script>${SEND}
drag.addEventListener('mousedown', (e) => send('k=dragdown&b=' + e.buttons));
document.addEventListener('mouseup', () => send('k=mouseup'));
other.addEventListener('mousedown', (e) => send('k=otherdown&b=' + e.buttons));
other.addEventListener('click', (e) => send('k=otherclick&d=' + e.detail));
</script></body></html>`,
  "/anim": `${PAGE_HEAD}<style>body{margin:0}</style></head><body><canvas id="c" width="${VIEW.width}" height="${VIEW.height}"></canvas>
<script>const x = c.getContext('2d'); let i = 0; const f = () => { i += 1; x.fillStyle = 'hsl(' + (i * 7 % 360) + ',80%,50%)'; x.fillRect(0, 0, ${VIEW.width}, ${VIEW.height}); x.fillStyle = '#000'; x.font = '48px sans-serif'; x.fillText(String(i), 40, 100); requestAnimationFrame(f); }; f();</script></body></html>`,
  // Another origin than the app's, framing the live view (H12).
  "/frame": '<!doctype html><html><head><meta charset="utf-8"><title>Another origin</title></head><body style="margin:0"><iframe id="f" style="border:0;display:block;width:1000px;height:700px"></iframe></body></html>',
};

const fixtureServer = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", FIXTURE);
  if (req.method === "POST" && u.pathname === "/e") {
    const k = u.searchParams.get("k") ?? "";
    fixtureCounts[k] = (fixtureCounts[k] ?? 0) + 1;
    const hit: (typeof fixtureHits)[number] = { route: "/e", k, at: Date.now() };
    if (k === "save") lastNickLength = hit.n = Number(u.searchParams.get("n"));
    if (k === "untrusted") {
      const t = String(u.searchParams.get("t")).slice(0, 24);
      untrustedTypes[t] = (untrustedTypes[t] ?? 0) + 1;
    }
    if (u.searchParams.has("b")) hit.b = Number(u.searchParams.get("b"));
    if (u.searchParams.has("d")) hit.d = Number(u.searchParams.get("d"));
    fixtureHits.push(hit);
    res.writeHead(204, { "cache-control": "no-store" }).end();
    return;
  }
  const page = PAGES[u.pathname];
  fixtureHits.push({ route: u.pathname, k: "page", at: Date.now() });
  if (!page) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page);
});

const harnessServer = http.createServer((_req, res) => {
  res
    .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    .end('<!doctype html><html><head><meta charset="utf-8"><title>The card</title></head><body style="margin:0"><iframe id="f" style="border:0;display:block;width:1000px;height:700px"></iframe></body></html>');
});

const count = (k: string) => fixtureCounts[k] ?? 0;
const hitsOf = (k: string) => fixtureHits.filter((h) => h.k === k);

// ── The viewer Chrome: the person's browser ─────────────────────────

let viewerProc: ChildProcess | null = null;
let viewer: Cdp | null = null;
type Ctx = { id: number; origin: string; frame: string; alive: boolean };
type Tab = { target: string; sid: string; contexts: Ctx[]; logs: Array<{ source: string; text: string }> };
const tabs = new Map<string, Tab>();

async function startViewer(): Promise<Cdp> {
  if (!CHROME) throw new Error("no Chrome: set CHROME, or install chrome-headless-shell under ~/.cache/chrome-headless");
  // --headless, so a full Chrome named by CHROME never opens a window (chrome-headless-shell is headless anyway).
  const proc = spawn(CHROME, ["--headless", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${join(SCRATCH, "viewer")}`, "--window-size=1200,900", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank"], {
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
  });
  viewerProc = proc;
  const ws = await new Promise<string>((resolve, reject) => {
    let t = "";
    const timer = setTimeout(() => reject(new Error("the viewer Chrome did not start")), 15_000);
    proc.stderr?.on("data", (d) => {
      t = (t + String(d)).slice(-8192);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(t);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
  const v = await connectCdp(ws, { timeoutMs: 10_000 });
  v.on("Runtime.executionContextCreated", (p, s) => {
    const tab = s ? tabs.get(s) : undefined;
    if (tab) tab.contexts.push({ id: p.context.id, origin: String(p.context.origin), frame: String(p.context.auxData?.frameId ?? ""), alive: true });
  });
  v.on("Runtime.executionContextDestroyed", (p, s) => {
    const tab = s ? tabs.get(s) : undefined;
    for (const c of tab?.contexts ?? []) if (c.id === p.executionContextId) c.alive = false;
  });
  v.on("Runtime.executionContextsCleared", (_p, s) => {
    const tab = s ? tabs.get(s) : undefined;
    for (const c of tab?.contexts ?? []) c.alive = false;
  });
  v.on("Log.entryAdded", (p, s) => {
    const tab = s ? tabs.get(s) : undefined;
    tab?.logs.push({ source: String(p.entry?.source ?? ""), text: String(p.entry?.text ?? "") });
  });
  return v;
}

async function openTab(url: string): Promise<Tab> {
  const v = viewer!;
  const { targetId } = await v.send<Json>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await v.send<Json>("Target.attachToTarget", { targetId, flatten: true });
  const tab: Tab = { target: targetId, sid: sessionId, contexts: [], logs: [] };
  tabs.set(sessionId, tab);
  await v.send("Runtime.enable", {}, sessionId);
  await v.send("Log.enable", {}, sessionId);
  await v.send("Page.enable", {}, sessionId);
  await v.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
  await v.send("Page.navigate", { url }, sessionId);
  await until(() => tab.contexts.find((c) => c.alive && c.origin === new URL(url).origin), (c) => Boolean(c), 5000);
  return tab;
}

/** Something evaluated in the page the tab shows (its main frame). */
async function tabEval(tab: Tab, expression: string): Promise<unknown> {
  const r = await viewer!.send<Json>("Runtime.evaluate", { expression, returnByValue: true }, tab.sid);
  return r?.result?.value;
}

/** Something evaluated in the live view the tab frames (the host's own origin, inside the iframe). */
async function frameEval(tab: Tab, expression: string): Promise<unknown> {
  const ctx = [...tab.contexts].reverse().find((c) => c.alive && c.origin === API);
  if (!ctx) return undefined;
  const r = await viewer!.send<Json>("Runtime.evaluate", { expression, returnByValue: true, contextId: ctx.id }, tab.sid);
  return r?.result?.value;
}

/**
 * Frame a live view's address in the tab, in a new iframe: a new address that
 * differs from the frame's own only in its fragment would be a same-document
 * navigation, and the old view would stay.
 */
async function frameTo(tab: Tab, url: string): Promise<void> {
  for (const c of tab.contexts) if (c.origin === API) c.alive = false;
  await tabEval(tab, `(() => { const old = document.getElementById('f'); const f = old.cloneNode(false); f.removeAttribute('src'); old.replaceWith(f); f.src = ${JSON.stringify(url)}; })()`);
}

/** Whether the live view in the tab drew a picture: its status line hidden, its canvas the session's size. */
async function drawn(tab: Tab, ms = 8000): Promise<Json | null> {
  const read = async () => {
    const v = (await frameEval(tab, "JSON.stringify({ w: document.getElementById('screen').width, h: document.getElementById('screen').height, hidden: document.getElementById('status').hidden, status: document.getElementById('status').textContent })").catch(() => null)) as string | null;
    return v ? (JSON.parse(v) as Json) : null;
  };
  const v = await until(read, (x) => Boolean(x && x.hidden === true && x.w === VIEW.width && x.h === VIEW.height), ms, 150);
  return v && v.hidden === true ? v : null;
}

const vSend = async (tab: Tab, method: string, params: Json) => {
  await viewer!.send("Page.bringToFront", {}, tab.sid);
  return viewer!.send(method, params, tab.sid);
};
async function vClick(tab: Tab, x: number, y: number) {
  await vSend(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await vSend(tab, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await vSend(tab, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}
async function vType(tab: Tab, text: string) {
  for (const ch of text) {
    const code = `Key${ch.toUpperCase()}`;
    const vk = ch.toUpperCase().charCodeAt(0);
    await vSend(tab, "Input.dispatchKeyEvent", { type: "keyDown", key: ch, code, text: ch, unmodifiedText: ch.toLowerCase(), windowsVirtualKeyCode: vk });
    await vSend(tab, "Input.dispatchKeyEvent", { type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk });
  }
}

// ── The app's side: a session, its connect client and its tab ───────

type AppSession = { id: string; cdp: Cdp; sid: string; closedAt: number | null };
async function connectApp(created: Answer): Promise<AppSession> {
  const cdp = await connectCdp(String(created.json.connectUrl), { timeoutMs: 5000 });
  const s: AppSession = { id: String(created.json.id), cdp, sid: "", closedAt: null };
  cdp.onClose(() => (s.closedAt = Date.now()));
  const t = await cdp.send<Json>("Target.getTargets");
  const page = (t.targetInfos as Json[]).find((x) => x.type === "page");
  const { sessionId } = await cdp.send<Json>("Target.attachToTarget", { targetId: page?.targetId, flatten: true });
  s.sid = sessionId;
  return s;
}
const rEval = async (s: AppSession, expression: string) => (await s.cdp.send<Json>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, s.sid))?.result?.value;
async function rOpen(s: AppSession, p: string) {
  await s.cdp.send("Page.navigate", { url: `${FIXTURE}${p}` }, s.sid);
  await until(() => rEval(s, "document.readyState").catch(() => ""), (v) => v === "complete", 5000);
}

/** The state file's entry for a session: its Chrome's pid. */
function stateEntry(id: string): { pid: number; profile: string } | null {
  try {
    const st = JSON.parse(readFileSync(join(STATE, "state.json"), "utf8"));
    const e = (st.sessions as Json[]).find((x) => x.id === id);
    return e ? { pid: Number(e.pid), profile: String(e.profile) } : null;
  } catch {
    return null;
  }
}
/** Whether a pid runs a Chrome of this run's own (its command line holds our profile folder). */
function ownChromeRuns(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    return execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" }).includes(join(STATE, "profiles"));
  } catch {
    return false;
  }
}

/** The admin socket's answer to one op (process mode: <state dir>/admin.sock). */
function admin(op: string): Promise<Json | null> {
  return new Promise((resolve) => {
    const c = net.connect(join(STATE, "admin.sock"));
    let buf = "";
    c.on("connect", () => c.write(`${JSON.stringify({ op })}\n`));
    c.on("data", (d) => {
      buf += String(d);
      if (buf.includes("\n")) {
        c.destroy();
        try {
          resolve(JSON.parse(buf.split("\n")[0]));
        } catch {
          resolve(null);
        }
      }
    });
    c.on("error", () => resolve(null));
  });
}

// ── The proof ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  step = "setup";
  for (const port of [HOST_PORT, FIXTURE_PORT, HARNESS_PORT]) {
    const busy = await new Promise<boolean>((r) => {
      const c = net.connect(port, "127.0.0.1", () => {
        c.destroy();
        r(true);
      });
      c.on("error", () => r(false));
    });
    if (busy) throw new Error(`port ${port} is in use: stop what listens there first`);
  }
  if (!CHROME) throw new Error("no Chrome: set CHROME, or install chrome-headless-shell under ~/.cache/chrome-headless");
  await new Promise<void>((r) => fixtureServer.listen(FIXTURE_PORT, "127.0.0.1", r));
  await new Promise<void>((r) => harnessServer.listen(HARNESS_PORT, "127.0.0.1", r));
  host = startHost();
  const up = await until(healthz, (h) => h.status === 200, 30_000, 200);
  if (up.status !== 200) throw new Error(`the host did not start:\n${hostOutput.slice(-1500)}`);
  viewer = await startViewer();
  console.log(`The host is up on ${API} (process mode, not proof mode); scratch ${SCRATCH}`);

  // ── H1 ───────────────────────────────────────────────────────────
  step = "H1 auth";
  const noKey = await api("GET", "/v1/sessions?status=RUNNING", undefined, { key: null });
  const wrong = await api("GET", "/v1/sessions?status=RUNNING", undefined, { key: `${KEY}x` });
  check("no key gives 401, and a wrong key gives 401", noKey.status === 401 && wrong.status === 401 && noKey.json.error === "unauthorized", [noKey.status, wrong.status]);
  // Another address, through the X-Forwarded-For Caddy would set (read only from 127.0.0.1), so the proof's own is never blocked.
  const XFF = "203.0.113.9";
  const tries: number[] = [];
  let eleventh: Json = {};
  for (let i = 0; i < 11; i += 1) {
    const r = await api("GET", "/v1/sessions?status=RUNNING", undefined, { key: `wrong-${i}`, xff: XFF });
    tries.push(r.status);
    eleventh = r.json;
  }
  // A key fault the app reads as one (403 auth_blocked is `client`), never 429, which it reads as busy (final contract review).
  check("ten wrong keys from one address in a minute give 401, and the eleventh 403 auth_blocked, never 429", tries.slice(0, 10).every((s) => s === 401) && tries[10] === 403 && eleventh.error === "auth_blocked", tries);
  const routes: Array<[string, string, unknown, string | null]> = [
    ["POST", "/v1/sessions", appBody(), KEY],
    ["GET", "/v1/sessions?status=RUNNING", undefined, KEY],
    ["GET", `/v1/sessions/${ZERO}/debug?mode=control`, undefined, KEY],
    ["POST", `/v1/sessions/${ZERO}`, { status: "REQUEST_RELEASE" }, KEY],
    ["POST", `/v1/sessions/${ZERO}/live-views/revoke`, {}, KEY],
    ["GET", "/health", undefined, KEY],
    ["GET", "/healthz", undefined, null],
    ["GET", `/live/${ZERO}`, undefined, null],
    ["GET", "/live/assets/live.mjs", undefined, null],
  ];
  const blocked: Array<[string, number, string | null]> = [];
  for (const [m, p, b, k] of routes) {
    const r = await api(m, p, b, { key: k, xff: XFF });
    blocked.push([`${m} ${p.split("?")[0]}`, r.status, r.headers.get("retry-after")]);
  }
  const blockedWs = rawViewer(ZERO, "x.y", { "x-forwarded-for": XFF });
  const blockedClose = await Promise.race([blockedWs.closed, sleep(5000).then(() => ({ code: 0, reason: "", at: 0 }))]);
  check(
    "then that address gets 403 on every route, with the right key too, each with Retry-After, and the live view's websocket closes 4429",
    blocked.every(([, s, ra]) => s === 403 && Number(ra) > 0) && blockedClose.code === 4429,
    { blocked, ws: blockedClose.code },
  );
  check("and the proof's own address is not blocked", (await api("GET", "/v1/sessions?status=RUNNING")).status === 200);

  // ── H2 and H3 ────────────────────────────────────────────────────
  step = "H2 shapes";
  const c1 = await create();
  const s1id = String(c1.json.id);
  check("the right key gives 201", c1.status === 201, c1.status);
  // The session ends unconnected within 5 seconds (the test window): connect first.
  step = "H3 connect";
  const badUrl = String(c1.json.connectUrl).replace(/t=[^&]+/, `t=${randomBytes(32).toString("base64url")}`);
  check("a wrong token is refused (401 before the upgrade)", (await upgradeStatus(badUrl)).status === 401);
  const app1 = await connectApp(c1);
  const second = await upgradeStatus(String(c1.json.connectUrl));
  check("a second connect while the first is open gives 409", second.status === 409, second.status);
  step = "H2 shapes";
  const j = c1.json;
  check("the create answer has a UUID", UUID.test(s1id), s1id);
  check(`its connect address is ws://127.0.0.1:${HOST_PORT}/connect/<id>?t=...`, new RegExp(`^ws://127\\.0\\.0\\.1:${HOST_PORT}/connect/${s1id}\\?t=[A-Za-z0-9_-]{20,}$`).test(String(j.connectUrl)));
  const fields = ["id", "createdAt", "updatedAt", "startedAt", "endedAt", "expiresAt", "projectId", "status", "proxyBytes", "keepAlive", "contextId", "region", "userMetadata", "connectUrl"];
  check(
    "and every field of 3.2: RUNNING, proxyBytes 0, keepAlive false, contextId null, endedAt null, the region and the metadata",
    fields.every((f) => f in j) &&
      j.status === "RUNNING" &&
      j.proxyBytes === 0 &&
      j.keepAlive === false &&
      j.contextId === null &&
      j.endedAt === null &&
      j.region === "us-east-1" &&
      j.projectId === "workwrk" &&
      ["createdAt", "updatedAt", "startedAt", "expiresAt"].every((f) => !Number.isNaN(Date.parse(String(j[f])))) &&
      JSON.stringify(j.userMetadata) === JSON.stringify({ wk: "host-proof", row: `row-${RUN}` }),
    Object.keys(j),
  );
  const running = await api("GET", "/v1/sessions?status=RUNNING");
  const row = (Array.isArray(running.json) ? (running.json as unknown as Json[]) : []).find((s) => s.id === s1id);
  check("the list shows it RUNNING, with its userMetadata", row?.status === "RUNNING" && row?.userMetadata?.row === `row-${RUN}`, row);
  const fieldsOf: Array<[Json, string]> = [
    [{ region: "eu-central-1" }, "region"],
    [{ keepAlive: true }, "keepAlive"],
    [{ timeout: 30 }, "timeout"],
    [{ browserSettings: { viewport: VIEW, recordSession: true } }, "recordSession"],
  ];
  for (const [over, field] of fieldsOf) {
    const r = await api("POST", "/v1/sessions", appBody(over));
    check(`${JSON.stringify(over).replace(/"/g, "")} gives 400 with its field`, r.status === 400 && r.json.field === field, r.json);
  }
  step = "H3 connect";
  await app1.cdp.close();
  const done1 = await until(() => listed(s1id), (s) => s?.status === "COMPLETED", 5000, 250);
  check("after the first closes, the list shows it COMPLETED", done1?.status === "COMPLETED", done1?.status);
  check("and release gives 409", (await api("POST", `/v1/sessions/${s1id}`, { status: "REQUEST_RELEASE" })).status === 409);

  // ── H4 ───────────────────────────────────────────────────────────
  step = "H4 never connected";
  const c2 = await create();
  await sleep(6500);
  const s2 = await listed(String(c2.json.id));
  const lived = s2 ? Date.parse(String(s2.endedAt)) - Date.parse(String(s2.createdAt)) : NaN;
  check(`a create left alone has ended within 6 seconds (${lived} ms, the window is 5)`, c2.status === 201 && s2?.status === "COMPLETED" && lived >= 5000 && lived <= 6000, s2);

  // ── H6 ───────────────────────────────────────────────────────────
  step = "H6 max";
  const healthBefore = await api("GET", "/health");
  const m1 = await create();
  const m2 = await create();
  const third = await create();
  check("with two running, a third create gives 429 at_capacity with Retry-After: 30", m1.status === 201 && m2.status === 201 && third.status === 429 && third.json.error === "at_capacity" && third.headers.get("retry-after") === "30", [m1.status, m2.status, third.status, third.headers.get("retry-after")]);
  const healthAfter = await api("GET", "/health");
  const refusals = Number(healthAfter.json.counts?.capacityRefusals1h) - Number(healthBefore.json.counts?.capacityRefusals1h);
  check(`and /health counts one capacity refusal (${healthAfter.json.counts?.capacityRefusals1h})`, refusals === 1 && healthAfter.json.counts?.capacityRefusals24h === 1);
  const released1 = await api("POST", `/v1/sessions/${m1.json.id}`, { status: "REQUEST_RELEASE" });
  const m3 = await create();
  check("after one release, a create succeeds", released1.status === 200 && m3.status === 201, [released1.status, m3.status]);
  await api("POST", `/v1/sessions/${m2.json.id}`, { status: "REQUEST_RELEASE" });
  await api("POST", `/v1/sessions/${m3.json.id}`, { status: "REQUEST_RELEASE" });

  // ── H5 starts: its minute runs beside H7 to H12 ─────────────────
  step = "H5 timeout";
  const h5Sent = Date.now();
  const c5 = await create({ timeout: 60 });
  const app5 = await connectApp(c5);

  // ── The live session ─────────────────────────────────────────────
  step = "H7 control input";
  const cl = await create({ timeout: 600 });
  const app = await connectApp(cl);
  const lid = app.id;
  const version = await app.cdp.send<Json>("Browser.getVersion");
  const chromeVersion = /\/(\d+\.\d+\.\d+\.\d+)$/.exec(String(version.product))?.[1] ?? null;
  await rOpen(app, "/profile");
  const vt = await openTab(APP_ORIGIN);
  // A control view lives 8 seconds in this run (the test window), so each step frames a fresh one, as the card would.
  const control = async () => {
    await frameTo(vt, await liveUrl(lid, "control"));
    return drawn(vt);
  };
  const first = await control();
  check("the viewer Chrome frames the control view on the app origin, and it draws the page", first !== null, first);
  await vClick(vt, 150, 70);
  await until(() => count("clicked"), (n) => n >= 1, 3000);
  await sleep(700);
  check(`a click on the fixture's button gives clicked once (${count("clicked")})`, count("clicked") === 1);
  const saved = async () => {
    const before = hitsOf("save").length;
    await vClick(vt, 520, 160);
    await until(() => hitsOf("save").length, (n) => n > before, 3000);
    return lastNickLength;
  };
  await control();
  await vClick(vt, 240, 160);
  await sleep(250);
  await vType(vt, "Hello");
  await sleep(300);
  check("Hello typed by keys into the profile field, then saved, gives nickLength 5", (await saved()) === 5, lastNickLength);
  await control();
  await vClick(vt, 240, 160);
  await sleep(250);
  await vSend(vt, "Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
  await sleep(200);
  await vSend(vt, "Input.insertText", { text: "日本" });
  await sleep(300);
  check("an IME composition (日本), committed, gives nickLength 2", (await saved()) === 2, lastNickLength);
  await control();
  await vClick(vt, 240, 160);
  await sleep(250);
  const pasted = await frameEval(vt, `(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(PASTE)}); document.getElementById('keys').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return document.activeElement && document.activeElement.id; })()`);
  await sleep(400);
  check(`a paste event of 3,000 characters on the viewer gives nickLength 3000 (the keys field focused: ${String(pasted)})`, (await saved()) === 3000, lastNickLength);
  await control();
  await vSend(vt, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 500, y: 400, deltaX: 0, deltaY: 600 });
  const scrolled = await until(() => rEval(app, "window.scrollY"), (y) => Number(y) > 0, 3000, 150);
  check(`a wheel scrolls the fixture's long page (scrollY ${scrolled}, read through the connect client)`, Number(scrolled) > 0);
  await rEval(app, "window.scrollTo(0, 0)");
  await sleep(300);
  await control();
  const clickedBeforeTouch = count("clicked");
  await vSend(vt, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await vSend(vt, "Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 150, y: 70 }] });
  await vSend(vt, "Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(() => count("clicked"), (n) => n > clickedBeforeTouch, 3000);
  await vSend(vt, "Emulation.setTouchEmulationEnabled", { enabled: false });
  check("a touch tap through Input.dispatchTouchEvent on the viewer gives clicked", count("clicked") === clickedBeforeTouch + 1, count("clicked"));
  await sleep(300);
  // 12.2 holds the count to 0. It is read in two parts, so a failure says which: every event the
  // page recorder reads, and every other mouse, key, wheel, touch and text event; then the
  // composition events, whose end Chrome marks untrusted whenever a composition made over CDP ends.
  const otherUntrusted = Object.entries(untrustedTypes).filter(([t]) => !t.startsWith("composition"));
  const compositionUntrusted = Object.entries(untrustedTypes).filter(([t]) => t.startsWith("composition"));
  check(`the fixture's untrusted-event count is 0 for every event but the composition events (${otherUntrusted.length ? JSON.stringify(Object.fromEntries(otherUntrusted)) : "none"})`, otherUntrusted.length === 0, untrustedTypes);
  // Accepted on 2026-10-21 (H7 narrowed, docs/plans/browser-host.md "After"):
  // Chrome itself marks a CDP-made composition's end untrusted, whether
  // Input.insertText commits it or an empty imeSetComposition cancels it. The
  // recorder never reads composition events (page-recorder.ts listens to
  // pointerdown, keydown, focusout, input, change, click and blur), and not
  // forwarding compositions would leave a person typing Japanese or Chinese
  // blind until each word commits. So the only untrusted events allowed are
  // compositionend, at most one for each composition the proof made.
  const compositionsMade = 1;
  check(
    `and the only untrusted composition event is Chrome's own compositionend, at most one a composition (${compositionUntrusted.length ? JSON.stringify(Object.fromEntries(compositionUntrusted)) : "none"})`,
    compositionUntrusted.every(([t]) => t === "compositionend") && Number(untrustedTypes.compositionend ?? 0) <= compositionsMade,
    untrustedTypes,
  );

  // ── H8 ───────────────────────────────────────────────────────────
  step = "H8 watch cannot type";
  const vw = await openTab(APP_ORIGIN);
  await frameTo(vw, await liveUrl(lid, "watch"));
  const watchDrawn = await drawn(vw);
  check("a watch view framed in the viewer Chrome draws frames", watchDrawn !== null, watchDrawn);
  const refusedBefore = Number((await api("GET", "/health")).json.counts?.live?.watchInputRefused ?? -1);
  const clickedBeforeWatch = count("clicked");
  await vClick(vw, 150, 70);
  await vSend(vw, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", text: "a", windowsVirtualKeyCode: 65 });
  await vSend(vw, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await sleep(1500);
  const refusedAfter = Number((await api("GET", "/health")).json.counts?.live?.watchInputRefused ?? -1);
  const stillOpen = await drawn(vw, 1000);
  check(
    "its page attaches no input listener: a click and a key on it give no clicked, it sends nothing (the host refused no input) and it stays open",
    count("clicked") === clickedBeforeWatch && refusedAfter === refusedBefore && stillOpen !== null,
    { clicked: count("clicked") - clickedBeforeWatch, refusedBefore, refusedAfter, stillOpen },
  );
  await viewer.send("Target.closeTarget", { targetId: vw.target });
  const rw = rawViewer(lid, tokenOf(await liveUrl(lid, "watch")));
  const rwHello = await helloOf(rw);
  rw.ws.send(JSON.stringify({ t: "mouse", type: "down", x: 150, y: 70, button: "left", buttons: 1, clicks: 1, mods: 0 }));
  rw.ws.send(JSON.stringify({ t: "mouse", type: "up", x: 150, y: 70, button: "left", buttons: 0, clicks: 1, mods: 0 }));
  const rwClosed = await Promise.race([rw.closed, sleep(5000).then(() => ({ code: 0, reason: "", at: 0 }))]);
  await sleep(700);
  check(`a raw websocket with the watch token sends {t:"mouse"} and is closed 4403 (${rwClosed.code}), still with no clicked`, rwHello?.mode === "watch" && rwClosed.code === 4403 && count("clicked") === clickedBeforeWatch, { hello: rwHello, closed: rwClosed });

  // ── H9 ───────────────────────────────────────────────────────────
  step = "H9 revoke, expiry and reconnects";
  await control();
  const rcUrl = await liveUrl(lid, "control");
  const rc = rawViewer(lid, tokenOf(rcUrl));
  await helloOf(rc);
  const revoked = await api("POST", `/v1/sessions/${lid}/live-views/revoke`, {});
  const rcClosed = await Promise.race([rc.closed, sleep(5000).then(() => ({ code: 0, reason: "", at: 0 }))]);
  const vtStatus = await until(() => frameEval(vt, "document.getElementById('status').textContent").catch(() => ""), (t) => t === LIVE_COPY.revoked, 3000, 150);
  check(
    `revoke closes the control views 4401 revoked (${revoked.json.revoked} closed), and the framed one says "${LIVE_COPY.revoked}"`,
    revoked.status === 200 && Number(revoked.json.revoked) >= 2 && rcClosed.code === 4401 && rcClosed.reason === "revoked" && vtStatus === LIVE_COPY.revoked,
    { revoked: revoked.json, rcClosed, vtStatus },
  );
  const again = rawViewer(lid, tokenOf(rcUrl));
  const againClosed = await Promise.race([again.closed, sleep(5000).then(() => ({ code: 0, reason: "", at: 0 }))]);
  check("a reconnect with that token is refused (4401 revoked)", againClosed.code === 4401 && againClosed.reason === "revoked", againClosed);
  const minted = Date.now();
  const fresh = rawViewer(lid, tokenOf(await liveUrl(lid, "control")));
  const freshClosed = await Promise.race([fresh.closed, sleep(12_000).then(() => ({ code: 0, reason: "", at: 0 }))]);
  const freshMs = freshClosed.at - minted;
  check(`a fresh control view closes 4401 expired at 8 seconds (${freshMs} ms after it was minted)`, freshClosed.code === 4401 && freshClosed.reason === "expired" && freshMs >= 6900 && freshMs <= 8700, freshClosed);
  const shared = tokenOf(await liveUrl(lid, "control"));
  const older = rawViewer(lid, shared);
  await helloOf(older);
  const newer = rawViewer(lid, shared);
  const newerHello = await helloOf(newer);
  const olderClosed = await Promise.race([older.closed, sleep(5000).then(() => ({ code: 0, reason: "", at: 0 }))]);
  const savesBefore = hitsOf("save").length;
  const press = (x: number, y: number) => {
    newer.ws.send(JSON.stringify({ t: "mouse", type: "move", x, y, button: "none", buttons: 0, clicks: 1, mods: 0 }));
    newer.ws.send(JSON.stringify({ t: "mouse", type: "down", x, y, button: "left", buttons: 1, clicks: 1, mods: 0 }));
    newer.ws.send(JSON.stringify({ t: "mouse", type: "up", x, y, button: "left", buttons: 0, clicks: 1, mods: 0 }));
  };
  press(240, 160);
  await sleep(250);
  newer.ws.send(JSON.stringify({ t: "text", text: "Keep" }));
  await sleep(250);
  press(520, 160);
  await until(() => hitsOf("save").length, (n) => n > savesBefore, 3000);
  check(`a second socket on a live control token closes the first with 4408 (${olderClosed.code}), and keeps typing (nickLength ${lastNickLength})`, Boolean(newerHello) && olderClosed.code === 4408 && newer.ws.readyState === WebSocket.OPEN && lastNickLength === 4, { olderClosed, lastNickLength });
  newer.ws.close();
  await sleep(300);

  // ── H10 ──────────────────────────────────────────────────────────
  step = "H10 a held button";
  await rOpen(app, "/drag");
  check("a fresh control view is framed again after the revoke, and draws", (await control()) !== null);
  const releasedBefore = Number((await api("GET", "/health")).json.counts?.live?.released ?? 0);
  await vSend(vt, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 140, y: 100 });
  await vSend(vt, "Input.dispatchMouseEvent", { type: "mousePressed", x: 140, y: 100, button: "left", buttons: 1, clickCount: 1 });
  await vSend(vt, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 170, y: 120, button: "left", buttons: 1 });
  await vSend(vt, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 200, y: 140, button: "left", buttons: 1 });
  const downs = await until(() => hitsOf("dragdown").length, (n) => n >= 1, 3000);
  const upsBefore = hitsOf("mouseup").length;
  // The frame closed mid drag: the person's page is gone, its button never released.
  const closedAt = Date.now();
  await tabEval(vt, "document.getElementById('f').remove()");
  const ups = await until(() => hitsOf("mouseup").length, (n) => n > upsBefore, 3000, 50);
  const upAt = hitsOf("mouseup").at(-1)?.at ?? Infinity;
  check(`the viewer presses the button on the draggable element (${downs} down) and closes the frame mid drag: the fixture logs a mouseup within a second (${upAt - closedAt} ms)`, downs >= 1 && ups > upsBefore && upAt - closedAt <= 1000);
  // The viewer Chrome's own button let go too, so it holds nothing for later.
  await vSend(vt, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 200, y: 140, button: "left", buttons: 0, clickCount: 1 });
  const releasedAfter = Number((await api("GET", "/health")).json.counts?.live?.released ?? 0);
  check(`the host released what the viewer held (released ${releasedBefore} then ${releasedAfter})`, releasedAfter > releasedBefore);
  await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 140, y: 330 }, app.sid);
  await app.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 140, y: 330, button: "left", buttons: 1, clickCount: 1 }, app.sid);
  await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 140, y: 330, button: "left", buttons: 0, clickCount: 1 }, app.sid);
  const other = await until(() => hitsOf("otherclick"), (h) => h.length >= 1, 3000);
  const otherDown = hitsOf("otherdown").at(-1);
  check("a later proof click on another element is a plain click (pressed with the left button alone, a single click)", other.length === 1 && other[0].d === 1 && otherDown?.b === 1, { other, otherDown });

  // ── H11 ──────────────────────────────────────────────────────────
  step = "H11 frames";
  await rOpen(app, "/anim");
  const fw = rawViewer(lid, tokenOf(await liveUrl(lid, "watch")));
  await until(() => fw.frames.length, (n) => n >= 1, 5000);
  const from = fw.frames[0]?.at ?? Date.now();
  await sleep(4200);
  // Chrome sends the frames it may have in flight before the first acknowledgement; the paced rate is read after that first second.
  const opening = fw.frames.filter((f) => f.at >= from && f.at < from + 3000).length;
  const windowed = fw.frames.filter((f) => f.at >= from + 1000 && f.at < from + 4000);
  const jpeg = (b: Buffer) => b.length > 7 && b[0] === 0x01 && b[5 + b.readUInt32BE(1)] === 0xff && b[6 + b.readUInt32BE(1)] === 0xd8;
  check(
    `an animated fixture gives at most 15 frames a second over 3 seconds (${windowed.length} from its second second, at most 46 with one at the edge; ${opening} in the first 3 seconds, with Chrome's frames in flight before the first acknowledgement)`,
    windowed.length >= 15 && windowed.length <= 46,
    { windowed: windowed.length, opening },
  );
  check("each frame's picture starts FF D8", fw.frames.length > 0 && fw.frames.every((f) => jpeg(f.data)));
  fw.ws.close();

  // ── H12 ──────────────────────────────────────────────────────────
  step = "H12 the page";
  const shell = await fetch(`${API}/live/${lid}`);
  const csp = shell.headers.get("content-security-policy") ?? "";
  check(
    `/live/<id> answers no-store, frame-ancestors ${APP_ORIGIN} and no Set-Cookie`,
    shell.status === 200 && shell.headers.get("cache-control") === "no-store" && csp.includes(`frame-ancestors ${APP_ORIGIN};`) && shell.headers.get("set-cookie") === null,
    { status: shell.status, csp, store: shell.headers.get("cache-control") },
  );
  const assets: Array<[string, number, string | null, string | null]> = [];
  for (const a of ["live.mjs", "view.mjs", "copy.mjs", "live.css"]) {
    const r = await fetch(`${API}/live/assets/${a}`);
    assets.push([a, r.status, r.headers.get("cache-control"), r.headers.get("set-cookie")]);
  }
  check("and its assets answer no-store, with no Set-Cookie", assets.every(([, s, store, cookie]) => s === 200 && store === "no-store" && cookie === null), assets);
  const connectsBefore = Number((await api("GET", "/health")).json.counts?.live?.connects ?? 0);
  const vo = await openTab(`${FIXTURE}/frame`);
  await frameTo(vo, await liveUrl(lid, "watch"));
  const report = await until(() => vo.logs.find((l) => /frame-ancestors/.test(l.text)), (l) => Boolean(l), 5000, 150);
  const connectsAfter = Number((await api("GET", "/health")).json.counts?.live?.connects ?? 0);
  check(`a frame on another origin is refused by the viewer Chrome: its console reports the frame-ancestors refusal, and no viewer connects`, Boolean(report) && report?.source === "security" && connectsAfter === connectsBefore, { report, connectsBefore, connectsAfter });
  await viewer.send("Target.closeTarget", { targetId: vo.target });

  // ── H16 ──────────────────────────────────────────────────────────
  step = "H16 a Chrome crash";
  const entry = stateEntry(lid);
  const exitedBefore = Number((await api("GET", "/health")).json.counts?.ends?.chrome_exited ?? 0);
  const crashAt = Date.now();
  if (entry && ownChromeRuns(entry.pid)) process.kill(entry.pid, "SIGKILL");
  const closedApp = await until(() => app.closedAt, (t) => t !== null, 5000, 50);
  const crashed = await until(() => listed(lid), (s) => s?.status === "COMPLETED", 5000, 250);
  const ends = (await api("GET", "/health")).json.counts?.ends ?? {};
  const exitedAfter = Number(ends.chrome_exited ?? 0);
  check(`killing the session's Chrome ends it chrome_exited (${exitedBefore} then ${exitedAfter})`, Boolean(entry) && crashed?.status === "COMPLETED" && exitedAfter === exitedBefore + 1, { entry: Boolean(entry), ends });
  check(`and the proof's socket closes within 2 seconds (${closedApp === null ? "never" : `${closedApp - crashAt} ms`})`, closedApp !== null && closedApp - crashAt <= 2000);

  // ── H5 ends ──────────────────────────────────────────────────────
  step = "H5 timeout";
  const closed5 = await until(() => app5.closedAt, (t) => t !== null, Math.max(1000, h5Sent + 66_000 - Date.now()), 100);
  const done5 = await listed(app5.id);
  const host5 = done5 ? Date.parse(String(done5.endedAt)) - Date.parse(String(done5.createdAt)) : NaN;
  check(`timeout: 60 ends at 60 to 62 seconds (${host5} ms by the host's own times)`, c5.status === 201 && done5?.status === "COMPLETED" && host5 >= 60_000 && host5 <= 62_000, done5);
  check(`and the proof's own CDP socket closes (${closed5 === null ? "never" : `${closed5 - h5Sent} ms after the create was sent`})`, closed5 !== null && closed5 - h5Sent >= 60_000 && closed5 - h5Sent <= 62_000);

  // ── H13 ──────────────────────────────────────────────────────────
  step = "H13 the reaper";
  const c13 = await create();
  const app13 = await connectApp(c13);
  const e13 = stateEntry(app13.id);
  await stopHost(host, "SIGKILL");
  await sleep(300);
  // What the next two checks need to mean anything: a Chrome and a profile the killed host left.
  const leftRunning = Boolean(e13) && ownChromeRuns(e13!.pid);
  const leftProfile = Boolean(e13) && existsSync(e13!.profile);
  check("with a session running, the host is killed with SIGKILL, and its Chrome still runs (ps), its profile still there", leftRunning && leftProfile, { e13, leftRunning, leftProfile });
  host = startHost({ BROWSER_HOST_TEST_FIREWALL_SECONDS: "15" });
  const gone = await until(() => ownChromeRuns(e13?.pid ?? 0), (alive) => !alive, 5000, 50);
  const goneMs = Date.now() - host.startedAt;
  check(`the host started again kills it within 2 seconds (${goneMs} ms from its start)`, leftRunning && !gone && goneMs <= 2000);
  const back = await until(healthz, (h) => h.status === 200, 30_000, 100);
  check("and removes its profile", leftProfile && !existsSync(e13!.profile));
  check("release of the old id gives 404", back.status === 200 && (await api("POST", `/v1/sessions/${app13.id}`, { status: "REQUEST_RELEASE" })).status === 404);
  try {
    await app13.cdp.close();
  } catch {
    /* gone with the old host */
  }

  // ── H15 ──────────────────────────────────────────────────────────
  step = "H15 health";
  const health = await api("GET", "/health");
  check(`/health says mode process, the Chrome version of Browser.getVersion (${health.json.chrome} and ${chromeVersion}), and max 2`, health.json.mode === "process" && chromeVersion !== null && health.json.chrome === chromeVersion && health.json.max === 2, { mode: health.json.mode, chrome: health.json.chrome, max: health.json.max });
  const z1 = await healthz();
  const drained = await admin("drain");
  const z2 = await healthz();
  const wait15 = host.startedAt + 15_500 - Date.now();
  if (wait15 > 0) await sleep(wait15);
  const z3 = await healthz();
  check(
    `/healthz is 200 ${z1.text}, then 200 ${z2.text} after drain on the admin socket, then 503 once firewall_unchecked is forced by the test window (${z3.status})`,
    z1.status === 200 && z1.text === "ok" && drained?.ok === true && z2.status === 200 && z2.text === "draining" && z3.status === 503,
    { z1, drained, z2, z3 },
  );
  check("and /health then names firewall_unchecked", ((await api("GET", "/health")).json.problems as string[] | undefined)?.includes("firewall_unchecked") === true);

  // ── H14 ──────────────────────────────────────────────────────────
  step = "H14 nothing kept";
  await stopHost(host, "SIGTERM");
  const files: Array<{ path: string; text: Buffer }> = [];
  const walk = (p: string) => {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const n of readdirSync(p)) walk(join(p, n));
    else if (st.isFile()) files.push({ path: p, text: readFileSync(p) });
  };
  walk(STATE);
  const hay = [{ path: "the host's captured output", text: Buffer.from(hostOutput, "utf8") }, ...files];
  const kinds: Array<[string, string[]]> = [
    ["the key", [KEY]],
    ["any connect token", [...secrets.connect]],
    ["any live token", [...secrets.live]],
    ["any session id", [...secrets.ids]],
    ["the fixture's page words", [PAGE_WORDS, "max@proof.test"]],
    ['"Hello"', ["Hello"]],
    ["the pasted text", [PASTE, PASTE.slice(0, 40)]],
  ];
  for (const [label, values] of kinds) {
    const found = hay.filter((h) => values.some((v) => v && h.text.includes(Buffer.from(v, "utf8")))).map((h) => h.path);
    check(`the host's output, the state file and the state folder hold none of ${label} (${values.length} searched)`, values.length > 0 && found.length === 0, found);
  }
  const state = files.find((f) => f.path.endsWith("state.json"));
  check(`the state file is there, with no session left in it, and no profile is left (${files.length} files in the state folder)`, Boolean(state) && JSON.parse(String(state?.text)).sessions.length === 0 && !files.some((f) => f.path.includes(`${join(STATE, "profiles")}/`)));
}

/** The viewer Chrome's whole process group, by its own PID. */
function killViewer(): void {
  if (!viewerProc?.pid) return;
  try {
    process.kill(-viewerProc.pid, "SIGKILL");
  } catch {
    /* gone */
  }
}

/** A session Chrome a killed host left: only one the state file names, whose command line holds this run's own folder. */
function killLeftChromes(): void {
  try {
    const st = JSON.parse(readFileSync(join(STATE, "state.json"), "utf8"));
    for (const e of st.sessions as Json[]) if (ownChromeRuns(Number(e.pid))) process.kill(-Number(e.pgid || e.pid), "SIGKILL");
  } catch {
    /* none */
  }
}

/**
 * The cleanup, once, from the end of the run or from a signal: the viewer's
 * process group killed, the host stopped by its PID, any Chrome the state
 * file names killed, the servers closed, the scratch folder removed.
 */
let cleaning: Promise<void> | null = null;
function cleanup(): Promise<void> {
  return (cleaning ??= (async () => {
    step = "cleanup";
    try {
      await viewer?.close();
    } catch {
      /* gone */
    }
    killViewer();
    if (host) await stopHost(host, "SIGTERM").catch(() => undefined);
    killLeftChromes();
    fixtureServer.close();
    harnessServer.close();
    if (process.env.KEEP === "1") console.log(`KEEP=1: the scratch folder is kept: ${SCRATCH}`);
    else rmSync(SCRATCH, { recursive: true, force: true });
  })());
}

let reported = false;
/** The last line, once. */
function report(hard: unknown): number {
  const failed = results.filter((r) => !r.ok);
  if (!reported) console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ""}.`);
  reported = true;
  return failed.length || hard ? 1 : 0;
}

// Ctrl-C, a stop or a closed terminal: the same cleanup, then out. A second
// one while it runs kills the viewer and the host at once.
let interrupted = "";
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (interrupted) {
      killViewer();
      if (host?.pid) {
        try {
          process.kill(host.pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      killLeftChromes();
      process.exit(1);
    }
    interrupted = signal;
    console.log(`\n${signal}: stopping the proof, and cleaning up first`);
    void cleanup()
      .catch(() => undefined)
      .then(() => {
        check("the proof ran to the end", false, `interrupted by ${signal}`);
        process.exit(report(signal));
      });
  });
}

async function proveAndCleanUp(): Promise<number> {
  let hard: unknown = null;
  try {
    await main();
  } catch (err) {
    hard = err;
    if (!interrupted) check("the proof ran to the end", false, err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.slice(0, 1500) : String(err));
  } finally {
    await cleanup().catch(() => undefined);
  }
  return report(hard);
}

void proveAndCleanUp().then((code) => {
  // A signal's handler reports and exits itself.
  if (!interrupted) process.exit(code);
});
