// The live proof of AI teammates Phase 3 (docs/plans/ai-teammates-phase3.md
// step 6): the live proofs of steps 2 to 5 chained on one throwaway GROWTH
// workspace, driven over HTTP as the people who would use them, through a
// stand-in model and a stand-in Google, with the rows checked in the database
// and both stand-ins' logs read after each, and every Connections, Apps &
// modules, picker and card state walked with a screenshot whose visible text
// is checked. It ends with EXPLAIN ANALYZE of the leaver sweep over 100,000
// seeded connections, seeded inside a transaction that is rolled back. The
// workspace is deleted at the end, also when a check fails (KEEP=1 keeps it
// to look at).
//
// What it holds the code to is what steps 1 to 5 built, as the "After Phase
// 3" section of the spec records it: every request that cannot be taken back
// on a card of its own; respond_to_invite sending only the person's own entry,
// with attendeesOmitted; the calendar read in the zone the person chose, else
// the one Google's events list names; the model and the history reading a
// Google write by its kind, never by a subject; a card that meets a
// connection to mend at its approval left waiting; the Tools tab's one-change
// PATCH; and the wk_tc_state cookie the connect rides on.
//
// LOCAL ONLY. It refuses any database but Postgres on this machine
// (localhost:5432, as scripts/require-local-db.mjs), and it reads only
// .env.local, never .env. It never follows a redirect to anywhere but the dev
// server or the Google stand-in. Run, in four terminals:
//
//   node scripts/ai-stand-in-model.mjs 8787
//   node scripts/google-stand-in.mjs 8788
//   ANTHROPIC_API_KEY=stand-in ANTHROPIC_BASE_URL=http://127.0.0.1:8787 \
//     GOOGLE_AGENT_CLIENT_ID=stand-in GOOGLE_AGENT_CLIENT_SECRET=stand-in \
//     GOOGLE_AGENT_BASE_URL=http://127.0.0.1:8788 GOOGLE_AGENT_PRODUCTS=gmail,calendar \
//     NEXTAUTH_URL=http://localhost:3016 NEXT_PUBLIC_APP_URL=http://localhost:3016 \
//     CRON_SECRET=<any> npx next dev -p 3016
//   BASE=http://localhost:3016 CRON_SECRET=<the same> npx tsx scripts/live-proof-ai-teammates-phase3.ts
//
// The dev server also needs SECRETS_ENCRYPTION_KEY (tokens are only ever
// stored sealed); without it the deployment offers no Google and the first
// checks say so.
//
// GOOGLE_STAND_IN=<url> names the Google stand-in (default
// http://127.0.0.1:8788); STAND_IN_LOG names the stand-in model's request log
// when it was started with one (default: the system temp folder, as the
// stand-in's own default). SHOTS=<folder> says where the screenshots go
// (default: the system temp folder); CHROME=<path> picks the browser
// (default: the Chrome app, else the newest chrome-headless-shell under
// ~/.cache/chrome-headless, installed with "npx @puppeteer/browsers install
// chrome-headless-shell@stable --path ~/.cache/chrome-headless"). Workspaces
// an earlier run left behind (slug p3-proof-*) are deleted first.
//
// The cron ticks it sends act on the whole local database, as a real tick
// does: other local workspaces' leavers are swept and queued revokes are
// tried, against the stand-in.
//
// People: Owner Olivia, Member Max, Manager Mia, and Gil, a Guest (his stored
// role, which "Guests here" checks read); Lea, a Member who does not share
// her free and busy times; Dee, who is deactivated; Sam, whom only the sweep
// finds. Their addresses are @proof.test, the domain the stand-in's fixtures
// name, so "Everyone on it is in this workspace" can be true.

import { config } from "dotenv";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { CONNECTOR_TOOL_NAMES } from "../src/lib/agents/tool-names";
import { CONNECTIONS_COPY, CONNECTOR_COPY, CONNECTOR_POLICY_COPY, CONNECTOR_TITLES, TOOL_PICKER_NOTES, thingsWaiting } from "../src/lib/agents/teammate-copy";
import { scriptPrisma } from "./lib/script-prisma";

// Only the local file: .env points at the production database tunnel. The
// guard below refuses anything but this machine whatever is loaded.
config({ path: ".env.local" });

// ── Local only ──────────────────────────────────────────────────────

function refuseUnlessLocal(): void {
  // Every database address that is set must be this machine's: the client
  // reads DATABASE_URL (scripts/lib/script-prisma.ts), so a local DIRECT_URL
  // beside a remote DATABASE_URL is refused too.
  const named = [
    ["DATABASE_URL", process.env.DATABASE_URL ?? ""],
    ["DIRECT_URL", process.env.DIRECT_URL ?? ""],
  ].filter(([, v]) => v);
  if (!process.env.DATABASE_URL) {
    console.error("Refused: DATABASE_URL is not set (this proof reads .env.local only).");
    process.exit(1);
  }
  for (const [name, raw] of named) {
    let host = "";
    let port = "";
    try {
      const u = new URL(raw);
      host = u.hostname;
      port = u.port || "5432";
    } catch {
      // Unreadable: refused below.
    }
    if (!(["localhost", "127.0.0.1", "[::1]"].includes(host) && port === "5432")) {
      console.error(`Refused: this proof runs only against a database on this machine (localhost:5432), and ${name} points at ${host ? `${host}:${port}` : "nothing readable"}.`);
      process.exit(1);
    }
  }
}
refuseUnlessLocal();

const BASE = (process.env.BASE || "http://localhost:3016").replace(/\/$/, "");
const GOOGLE = (process.env.GOOGLE_STAND_IN || "http://127.0.0.1:8788").replace(/\/$/, "");
const MODEL_LOG = process.env.STAND_IN_LOG || join(tmpdir(), "ai-stand-in-requests.jsonl");
const CRON_SECRET = process.env.CRON_SECRET || "";
if (!CRON_SECRET) {
  console.error("Set CRON_SECRET to the dev server's value (the proof ticks the cron).");
  process.exit(1);
}
// The Google stand-in is this machine's, or the proof would send people's
// codes to a host it does not know.
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(GOOGLE).hostname)) {
  console.error(`Refused: GOOGLE_STAND_IN must be on this machine, not ${new URL(GOOGLE).host}.`);
  process.exit(1);
}
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), "p3-proof-shots-"));
mkdirSync(SHOTS, { recursive: true });
const prisma = scriptPrisma();
const RUN = Date.now().toString(36);
const PASSWORD = `Proof-${RUN}-pw!`;

const START_PATH = "/api/teammate-connections/google/start";
const CALLBACK_PATH = "/api/teammate-connections/google/callback";
const STATE_COOKIE = "wk_tc_state";
const PRODUCT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const CONNECTOR_TOOLS: readonly string[] = CONNECTOR_TOOL_NAMES;
/** Every Google account the proof connects: its revokes are cleared from the queue at the end. */
const PROOF_ACCOUNTS = ["max@proof.test", "max.other@proof.test", "partial@proof.test", "olivia@proof.test", "dee@proof.test", "sam@proof.test"];

/** The stand-in's own rule for an account's OpenID sub (scripts/google-stand-in.mjs subOf). */
const subOf = (email: string) => `sub-${email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
/** connections.ts accountKey: what a queued revoke names its account by. */
const accountKey = (sub: string) => sha256hex(`google:${sub}`);

// ── Checks ──────────────────────────────────────────────────────────

const results: Array<{ step: string; name: string; ok: boolean; detail?: string }> = [];
let step = "setup";

function check(name: string, ok: boolean, detail?: unknown): boolean {
  const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 900);
  results.push({ step, name, ok, detail: ok ? undefined : d });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${step}: ${name}${!ok && d ? `\n         ${d}` : ""}`);
  return ok;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 30_000): Promise<T> {
  const t0 = Date.now();
  let v = await read();
  while (!done(v) && Date.now() - t0 < ms) {
    await sleep(500);
    v = await read();
  }
  return v;
}

/** A shot's visible text holds every one of these, and none of `absent`. */
function shows(text: string, present: readonly string[], absent: readonly string[] = []): boolean {
  return present.every((p) => text.includes(p)) && absent.every((a) => !text.includes(a));
}

// ── People over HTTP ────────────────────────────────────────────────

// Answers read as the routes send them: the checks name each field they rely on.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

class Person {
  cookie = "";
  token = "";
  constructor(
    readonly name: string,
    readonly email: string,
    readonly id: string,
  ) {}

  async signIn(): Promise<void> {
    const jar = new Map<string, string>();
    const keep = (res: Response) => {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    };
    const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    keep(csrfRes);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: header() },
      body: new URLSearchParams({ csrfToken, email: this.email, password: PASSWORD, json: "true", callbackUrl: `${BASE}/agents` }),
    });
    keep(res);
    const name = [...jar.keys()].find((k) => k.endsWith("next-auth.session-token"));
    if (!name) throw new Error(`${this.name} could not sign in (HTTP ${res.status})`);
    this.token = jar.get(name)!;
    this.cookie = `${name}=${this.token}`;
  }

  async json(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie: this.cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = {};
    try {
      parsed = text.trim() ? JSON.parse(text.trim()) : {};
    } catch {
      parsed = { raw: text.slice(0, 400) };
    }
    return { status: res.status, body: parsed };
  }

  /**
   * A streamed answer: every `data:` event, in order, or the JSON refusal
   * sent instead. A turn refused for asking too often (the 30 a minute AI
   * limit) is tried once more after the wait it names: the proof talks
   * faster than a person.
   */
  async sse(path: string, body: unknown): Promise<{ status: number; events: Json[]; refusal: Json | null }> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { cookie: this.cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        let refusal: Json = {};
        try {
          refusal = JSON.parse(text);
        } catch {
          refusal = { raw: text.slice(0, 400) };
        }
        if (res.status === 429 && attempt === 0) {
          const wait = Number(res.headers.get("retry-after") || 30);
          console.log(`         (asked too often: waiting ${wait}s once)`);
          await sleep(Math.min(Math.max(wait, 1), 65) * 1000);
          continue;
        }
        return { status: res.status, events: [], refusal };
      }
      const events = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => {
          try {
            return JSON.parse(l.slice(5).trim()) as Json;
          } catch {
            return { type: "unreadable", raw: l.slice(0, 200) };
          }
        });
      return { status: res.status, events, refusal: null };
    }
  }
}

async function cron(): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${BASE}/api/cron/run-due-agents`, { method: "POST", headers: { "x-cron-secret": CRON_SECRET } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { raw: text.slice(0, 400) } };
  }
}

const types = (events: Json[]) => events.map((e) => e.type);

// ── The stand-ins' logs ─────────────────────────────────────────────

/** Where the stand-in model's log ends now: a turn's requests are what it appends after. */
function modelMark(): number {
  try {
    const fd = openSync(MODEL_LOG, "r");
    const size = fstatSync(fd).size;
    closeSync(fd);
    return size;
  } catch {
    return 0;
  }
}

/** The stand-in model's requests since `mark`, one JSON line each. */
function modelSince(mark: number): Json[] {
  let text = "";
  try {
    const fd = openSync(MODEL_LOG, "r");
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.max(0, size - mark));
    readSync(fd, buf, 0, buf.length, mark);
    closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Json;
      } catch {
        return null;
      }
    })
    .filter((e): e is Json => e !== null);
}

/** A request's system prompt as one text (the engine sends blocks). */
function systemOf(e: Json): string {
  if (typeof e.system === "string") return e.system;
  return Array.isArray(e.system) ? e.system.map((b: Json) => String(b?.text ?? "")).join("\n") : "";
}

const toolsOfEntry = (e: Json): string[] => (Array.isArray(e.tools) ? e.tools.map(String) : []);

/** Every tool result a request carries, named by the tool_use it answers. */
function toolResultsOf(e: Json): Array<{ name: string; content: string }> {
  const names = new Map<string, string>();
  const out: Array<{ name: string; content: string }> = [];
  for (const m of e.messages ?? []) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (m.role === "assistant" && b.type === "tool_use") names.set(b.id, b.name);
      if (m.role === "user" && b.type === "tool_result") {
        const content = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: Json) => String(x?.text ?? "")).join("") : JSON.stringify(b.content);
        out.push({ name: names.get(b.tool_use_id) ?? "", content });
      }
    }
  }
  return out;
}

/** What the model last read back from `tool` in these requests, exactly as it was sent. */
function lastResult(entries: Json[], tool: string): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const found = toolResultsOf(entries[i]).filter((r) => r.name === tool);
    if (found.length > 0) return found[found.length - 1].content;
  }
  return null;
}

/** A <tool_data> block's JSON, read back: its "<" and ">" were written as \u003c and \u003e, which JSON reads as the characters. */
function toolData(content: string | null): Json | null {
  const m = /^<tool_data tool="[^"]+">([\s\S]*)<\/tool_data>$/.exec(content ?? "");
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Json;
  } catch {
    return null;
  }
}

async function googleGet(path: string): Promise<Json> {
  const r = await fetch(`${GOOGLE}${path}`);
  return (await r.json()) as Json;
}

async function googleControl(path: string): Promise<Json> {
  const r = await fetch(`${GOOGLE}/__stand-in/${path}`, { method: "POST" });
  return (await r.json().catch(() => ({}))) as Json;
}

/** Where the Google stand-in's log ends now. */
async function googleMark(): Promise<number> {
  const all = await googleGet("/__stand-in/log");
  const entries = (all.entries ?? []) as Json[];
  return entries.length > 0 ? Number(entries[entries.length - 1].seq) : 0;
}

/** What the app asked the Google stand-in since `mark`, the controls left out. */
async function googleSince(mark: number): Promise<Json[]> {
  const all = await googleGet(`/__stand-in/log?since=${mark}`);
  return ((all.entries ?? []) as Json[]).filter((e) => !String(e.route ?? "").startsWith("control."));
}

const routesOf = (entries: Json[], route: string) => entries.filter((e) => e.route === route);

// ── Turns ───────────────────────────────────────────────────────────

interface Turn {
  status: number;
  events: Json[];
  refusal: Json | null;
  /** The cards the turn made (approval events), in order. */
  approvals: Json[];
  /** Each tool's outcome as the stream reported it. */
  results: Json[];
  /** The stand-in model's requests for this turn. */
  model: Json[];
  /** What the Google stand-in was asked during it. */
  google: Json[];
}

async function turnOf(run: () => Promise<{ status: number; events: Json[]; refusal: Json | null }>): Promise<Turn> {
  const mm = modelMark();
  const gm = await googleMark();
  const r = await run();
  return {
    ...r,
    approvals: r.events.filter((e) => e.type === "approval").map((e) => e.action),
    results: r.events.filter((e) => e.type === "tool_result"),
    model: modelSince(mm),
    google: await googleSince(gm),
  };
}

/** One message to a teammate, as the person typing it. */
function say(who: Person, slug: string, message: string): Promise<Turn> {
  return turnOf(() => who.sse(`/api/agents/teammates/${encodeURIComponent(slug)}/messages`, { message }));
}

/** Decide cards as the person (POST /api/agents/actions/decide). */
async function decide(who: Person, decisions: Array<{ id: string; decision?: "approve" | "deny"; edit?: string }>): Promise<{ status: number; body: Json; results: Json[] }> {
  const r = await who.json("POST", "/api/agents/actions/decide", {
    decisions: decisions.map((d) => ({ id: d.id, decision: d.decision ?? "approve", ...(d.edit !== undefined ? { edit: { text: d.edit } } : {}) })),
  });
  return { ...r, results: (r.body.results ?? []) as Json[] };
}

/** After a decision, the chat continues as the page would continue it, so its outcome is told now and not at the next message. */
async function continueAfter(who: Person, decided: { body: Json }): Promise<void> {
  if (decided.body.resume && decided.body.chat?.kind === "teammate") {
    await who.sse(`/api/agents/teammates/${encodeURIComponent(decided.body.chat.slug)}/messages`, { resume: true });
  }
}

/**
 * Tell the teammate whatever was decided and not yet told (a denial does not
 * continue the chat), so the next message starts clean: a turn told of a
 * Google card starts as if it had read Google (review of step 4), and every
 * write in it would wait on a card. Nothing to tell answers 409, which is fine.
 */
async function settle(who: Person, slug: string): Promise<void> {
  await who.sse(`/api/agents/teammates/${encodeURIComponent(slug)}/messages`, { resume: true });
}

// ── Connecting Google, as the browser would ─────────────────────────

const aiOf = (u: URL | null) => u?.searchParams.get("ai") ?? null;
const errorOf = (u: URL | null) => u?.searchParams.get("ai_error") ?? null;
const partialOf = (u: URL | null) => u?.searchParams.getAll("ai_partial") ?? [];

function locationOf(res: Response): URL | null {
  const l = res.headers.get("location");
  return l ? new URL(l, BASE) : null;
}

/** A redirect may only lead to the dev server or to the Google stand-in: cookies go nowhere else. */
function sameOrigin(u: URL | null, origin: string): boolean {
  return Boolean(u) && u!.origin === new URL(origin).origin;
}

interface Started {
  status: number;
  /** The consent address at the stand-in, when the start sent the browser there. */
  authUrl: URL | null;
  /** Where the start sent the browser otherwise: the card, with ?ai_error. */
  location: URL | null;
  state: string | null;
  /** The wk_tc_state Set-Cookie line, whole. */
  cookieLine: string | null;
}

/** GET the start route as `who`, never following it. */
async function startConnect(who: Person, products = "gmail,calendar"): Promise<Started> {
  const res = await fetch(`${BASE}${START_PATH}?products=${encodeURIComponent(products)}`, { headers: { cookie: who.cookie }, redirect: "manual" });
  const location = locationOf(res);
  if (res.status === 307 && location && !sameOrigin(location, BASE)) {
    throw new Error(`The start route sent the browser to ${location.origin}, its canonical host: run the dev server with NEXTAUTH_URL and NEXT_PUBLIC_APP_URL set to ${BASE}, or set BASE to that host.`);
  }
  const cookieLine = res.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`)) ?? null;
  const state = cookieLine ? cookieLine.slice(STATE_COOKIE.length + 1).split(";")[0] : null;
  if (location && sameOrigin(location, GOOGLE)) return { status: res.status, authUrl: location, location: null, state, cookieLine };
  if (location && !sameOrigin(location, BASE)) {
    // Real Google, or anywhere else: never followed with anyone's cookies.
    throw new Error(`The start route sent the browser to ${location.origin}, not to the Google stand-in at ${GOOGLE}: run the dev server with GOOGLE_AGENT_BASE_URL=${GOOGLE}.`);
  }
  return { status: res.status, authUrl: null, location, state, cookieLine };
}

/** The person at Google's consent page, signed in as `account` (the stand-in reads login_hint), answered with a redirect back. */
async function consentAt(authUrl: URL, account?: string): Promise<URL | null> {
  const u = new URL(authUrl.toString());
  if (account) u.searchParams.set("login_hint", account);
  if (!sameOrigin(u, GOOGLE)) throw new Error(`Refused to open ${u.origin}: only the Google stand-in.`);
  const res = await fetch(u, { redirect: "manual" });
  const back = locationOf(res);
  if (back && !sameOrigin(back, BASE)) {
    throw new Error(`The stand-in sent the browser back to ${back.origin}, not ${BASE}: the dev server's redirect address (NEXTAUTH_URL, NEXT_PUBLIC_APP_URL) is another host.`);
  }
  return back;
}

/** The callback, as `as` with this state cookie (or none). */
async function finishAt(callback: URL, as: Person, stateCookie: string | null): Promise<{ status: number; location: URL | null; clearsCookie: boolean }> {
  const cookie = [as.cookie, ...(stateCookie !== null ? [`${STATE_COOKIE}=${stateCookie}`] : [])].join("; ");
  const res = await fetch(callback, { headers: { cookie }, redirect: "manual" });
  const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`)) ?? "";
  return { status: res.status, location: locationOf(res), clearsCookie: /^wk_tc_state=;/.test(cleared) && /max-age=0/i.test(cleared) };
}

/** A whole connect: start, consent as `account`, callback. The card's address it lands on. */
async function connectAs(who: Person, account: string, products = "gmail,calendar"): Promise<URL | null> {
  const s = await startConnect(who, products);
  if (!s.authUrl) return s.location;
  const back = await consentAt(s.authUrl, account);
  if (!back) return null;
  return (await finishAt(back, who, s.state)).location;
}

async function connectionOf(orgId: string, userId: string) {
  return prisma.teammateConnection.findUnique({ where: { organizationId_userId_provider: { organizationId: orgId, userId, provider: "google" } } });
}

// ── Screenshots (headless Chrome over CDP) ──────────────────────────

function chromePath(): string {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(app)) return app;
  const root = join(homedir(), ".cache", "chrome-headless", "chrome-headless-shell");
  try {
    for (const build of readdirSync(root).sort().reverse()) {
      for (const sub of readdirSync(join(root, build))) {
        const bin = join(root, build, sub, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
    }
  } catch {
    // None installed there.
  }
  throw new Error("No Chrome found: set CHROME to a Chrome or chrome-headless-shell binary.");
}

type Shot = { exceptions: string[]; acted: unknown; text: string; requests: Array<{ method: string; url: string; body: string | null }> };

/**
 * Open `path` as `who`, let it settle, optionally run `act` in the page (a
 * click, or an async script of clicks), and save a screenshot. Answers the
 * page's own exceptions, so a state that throws fails its check, the page's
 * visible text, so a check can say what is on screen, and every request the
 * page sent that was not a GET, so a check can say what a click sent.
 */
async function shot(who: Person, path: string, file: string, act?: string): Promise<Shot> {
  try {
    return await shotOnce(who, path, file, act);
  } catch (err) {
    return { exceptions: [`screenshot failed: ${err instanceof Error ? err.message : String(err)}`], acted: null, text: "", requests: [] };
  }
}

async function shotOnce(who: Person, path: string, file: string, act?: string): Promise<Shot> {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "p3-proof-chrome-"));
  const chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
  // A browser that cannot start fails this screenshot's check, never the whole run.
  let spawnError: Error | null = null;
  chrome.on("error", (err) => (spawnError = err));
  let ws: WebSocket | null = null;
  try {
    let version: { webSocketDebuggerUrl: string } | null = null;
    for (let i = 0; i < 80 && !version; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) version = (await r.json()) as { webSocketDebuggerUrl: string };
      } catch {
        await sleep(250);
      }
    }
    if (!version) throw new Error(`Chrome did not start${spawnError ? `: ${(spawnError as Error).message}` : ""} (set CHROME to a Chrome binary)`);
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    ws = socket;
    await new Promise((res, rej) => {
      socket.onopen = res;
      socket.onerror = rej;
    });
    let seq = 0;
    // CDP answers differ per method; each caller reads the fields it asked for.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const events: Json[] = [];
    socket.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && pending.has(d.id)) {
        const p = pending.get(d.id)!;
        pending.delete(d.id);
        if (d.error) p.reject(new Error(JSON.stringify(d.error)));
        else p.resolve(d.result);
      } else if (d.method) events.push(d);
    };
    const rpc = (method: string, params: Json = {}, sessionId?: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Promise<any>((resolve, reject) => {
        seq += 1;
        pending.set(seq, { resolve, reject });
        socket.send(JSON.stringify({ id: seq, method, params, sessionId }));
      });
    const { targetId } = await rpc("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await rpc("Target.attachToTarget", { targetId, flatten: true });
    for (const domain of ["Page", "Network", "Runtime"]) await rpc(`${domain}.enable`, {}, sessionId);
    await rpc("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const cookieName = who.cookie.slice(0, who.cookie.indexOf("="));
    await rpc("Network.setCookie", { name: cookieName, value: who.token, domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" }, sessionId);
    await rpc("Page.navigate", { url: BASE + path }, sessionId);
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000 && !events.some((e) => e.method === "Page.loadEventFired")) await sleep(100);
    await sleep(5000);
    // The tour and the cookie banner are overlays, not what is proved here.
    const dismiss = `(() => { let n = 0; for (const b of document.querySelectorAll("button")) { const t = (b.textContent || "").trim(); if (t === "Skip tour" || t === "Reject all" || t === "Skip") { b.click(); n++; } } return n; })()`;
    await rpc("Runtime.evaluate", { expression: dismiss, returnByValue: true }, sessionId);
    await sleep(800);
    let acted: unknown = null;
    if (act) {
      const r = await rpc("Runtime.evaluate", { expression: act, awaitPromise: true, returnByValue: true }, sessionId);
      acted = r.result?.value ?? r.exceptionDetails?.exception?.description ?? null;
      await sleep(2500);
    }
    const seen = await rpc("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true }, sessionId);
    const text = String(seen.result?.value ?? "");
    const { data } = await rpc("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(SHOTS, file), Buffer.from(data, "base64"));
    const exceptions = events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => String(e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text ?? "exception").slice(0, 300));
    const requests = events
      .filter((e) => e.method === "Network.requestWillBeSent" && e.params?.request?.method !== "GET")
      .map((e) => ({ method: String(e.params.request.method), url: String(e.params.request.url), body: typeof e.params.request.postData === "string" ? e.params.request.postData : null }));
    return { exceptions, acted, text, requests };
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
  }
}

/** A page expression: click the first button whose text is `label`, answering whether one was found. */
const clickButton = (label: string) =>
  `(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;

/** A page expression: click the switch named `label` (ui/switch.tsx: a button with role switch). */
const clickSwitch = (label: string) =>
  `(() => { const b = document.querySelector('button[role="switch"][aria-label=${JSON.stringify(label)}]'); if (!b) return false; b.click(); return true; })()`;

/**
 * A page expression: New, then New teammate, then Start from scratch, then
 * the Google rows scrolled into view. True once the form is open.
 */
const openNewTeammate = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (sel, re) => [...document.querySelectorAll(sel)].find((x) => re.test((x.textContent || "").trim()));
  const menu = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "New");
  if (!menu) return "no New button";
  menu.click(); await w(800);
  const item = pick("button, [role=menuitem]", /^New teammate/);
  if (!item) return "no New teammate item";
  item.click(); await w(1500);
  const scratch = pick("button", /Start from scratch/);
  if (!scratch) return "no Start from scratch";
  scratch.click(); await w(1500);
  const row = [...document.querySelectorAll("span")].find((x) => /^(Read your Google Calendar|Search your Gmail)$/.test((x.textContent || "").trim()));
  if (row) row.scrollIntoView({ block: "center" });
  await w(400);
  return true;
})()`;

/** A page expression: the Google rows of an open Tools and approvals tab scrolled into view. */
const showGoogleRows = `(async () => {
  const row = [...document.querySelectorAll("span")].find((x) => /^(Search your Gmail|Read your Google Calendar)$/.test((x.textContent || "").trim()));
  if (!row) return "no Google row";
  row.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 400));
  return true;
})()`;

// ── The workspace ───────────────────────────────────────────────────

const orgIds: string[] = [];
const PEOPLE_EMAILS = ["olivia", "max", "mia", "gil", "lea", "dee", "sam"].map((n) => `${n}@proof.test`);

async function makeWorkspace() {
  const leftOver = await prisma.organization.findMany({ where: { slug: { startsWith: "p3-proof-" } }, select: { id: true } });
  if (leftOver.length > 0) {
    orgIds.push(...leftOver.map((o) => o.id));
    await deleteWorkspaces();
    orgIds.length = 0;
    console.log(`Deleted ${leftOver.length} workspace(s) an earlier run left behind.`);
  }
  // The proof's people sign in by address: someone else here with one of
  // them would make the sign-in ambiguous.
  const taken = await prisma.user.count({ where: { email: { in: PEOPLE_EMAILS } } });
  if (taken > 0) throw new Error(`${taken} local account(s) already use a @proof.test address the proof signs in with; remove them first.`);

  const org = await prisma.organization.create({
    data: { name: `Phase 3 proof ${RUN}`, slug: `p3-proof-${RUN}`, plan: "GROWTH", status: "ACTIVE", settings: {} },
  });
  orgIds.push(org.id);
  const hash = await bcrypt.hash(PASSWORD, 12);
  const person = async (firstName: string, lastName: string, accessLevel: string, orgRole?: string) => {
    const email = `${firstName.toLowerCase()}@proof.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: hash, firstName, lastName, organizationId: org.id, accessLevel: accessLevel as never, status: "ACTIVE", ...(orgRole ? { orgRole: orgRole as never } : {}) },
    });
    await prisma.organizationMembership.create({ data: { userId: user.id, organizationId: org.id, role: accessLevel as never, isPrimary: true } });
    return new Person(firstName, email, user.id);
  };
  const olivia = await person("Olivia", "Owner", "SUPER_ADMIN");
  const max = await person("Max", "Member", "EMPLOYEE");
  const mia = await person("Mia", "Manager", "MANAGER");
  const gil = await person("Gil", "Guest", "EMPLOYEE", "GUEST");
  const lea = await person("Lea", "Private", "EMPLOYEE");
  const dee = await person("Dee", "Departing", "EMPLOYEE");
  const sam = await person("Sam", "Swept", "EMPLOYEE");

  // Talk is a module, installed here as Settings, Modules does, for step 5's
  // Talk turn: a private channel with Olivia, Max and Mia.
  const talk = await prisma.product.findFirst({ where: { slug: "workwrk-talk" }, select: { id: true } });
  let proofChannel: string | null = null;
  if (talk) {
    await prisma.productInstallation.create({ data: { organizationId: org.id, productId: talk.id, status: "ACTIVE" } });
    const c = await prisma.conversation.create({ data: { organizationId: org.id, type: "CHANNEL", name: "proof", createdById: olivia.id, restricted: true } });
    for (const m of [olivia, max, mia]) await prisma.conversationMember.create({ data: { conversationId: c.id, userId: m.id } });
    proofChannel = c.id;
  }

  for (const p of [olivia, max, mia, gil, lea, dee, sam]) await p.signIn();
  return { org, olivia, max, mia, gil, lea, dee, sam, proofChannel };
}

async function deleteWorkspaces(): Promise<void> {
  // The order the hard-delete cron uses (src/app/api/cron/org-hard-delete/route.ts):
  // the tables whose rows hold restricting links first, then the company
  // (most rows cascade, the connections, states and policy among them), then
  // the tables with no link back to it.
  const { HARD_DELETE_FIRST } = await import("../src/lib/admin/hard-delete-order");
  const { WORKSPACE_ORPHAN_TABLES } = await import("../src/lib/admin/workspace-orphans");
  for (const id of orgIds) {
    await prisma.$transaction(
      async (tx) => {
        for (const t of HARD_DELETE_FIRST) await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "organizationId" = $1`, id);
        await tx.$executeRawUnsafe(`DELETE FROM "Organization" WHERE "id" = $1`, id);
        for (const t of WORKSPACE_ORPHAN_TABLES) await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "organizationId" = $1`, id);
      },
      { timeout: 120_000 },
    );
  }
  // The revoke queue names no workspace (it outlives one on purpose): the
  // proof's own accounts' rows go by their account key, so no later tick
  // sends a stand-in token anywhere.
  await prisma.teammateTokenRevocation.deleteMany({ where: { accountKey: { in: PROOF_ACCOUNTS.map((e) => accountKey(subOf(e))) } } });
}

// ── The proof ───────────────────────────────────────────────────────

async function teammate(who: Person, body: Json): Promise<{ slug: string; id: string }> {
  const r = await who.json("POST", "/api/agents/teammates", { hue: "sky", instructions: "Be brief.", ...body });
  if (r.status !== 201) throw new Error(`${who.name} could not make ${body.name}: ${r.status} ${JSON.stringify(r.body)}`);
  return { slug: r.body.teammate.slug, id: r.body.teammate.id };
}

/** The newest answer in a person's chat with a teammate. */
async function lastAnswer(agentId: string, userId: string) {
  return prisma.chatMessage.findFirst({
    where: { session: { agentId, userId }, role: "ASSISTANT" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { toolCalls: true, meta: true },
  });
}

async function audits(orgId: string, type: string) {
  return prisma.activityLog.findMany({ where: { organizationId: orgId, type }, orderBy: { createdAt: "asc" }, select: { description: true, metadata: true, targetId: true, actorId: true, severity: true } });
}

/** Whether this database has the column: the proof holds the code to what is there. */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

const linesOf = (a: Json | undefined): string[] => (Array.isArray(a?.preview?.lines) ? a!.preview.lines.map(String) : []);

async function main() {
  // ── Preflight ─────────────────────────────────────────────────────
  step = "preflight";
  let fixtures: Json = {};
  try {
    fixtures = await googleControl("reset");
  } catch (err) {
    throw new Error(`The Google stand-in does not answer at ${GOOGLE} (node scripts/google-stand-in.mjs 8788): ${err instanceof Error ? err.message : String(err)}`);
  }
  check("the Google stand-in answers, reset to its fixtures", fixtures.ok === true && /^\d{4}-\d{2}-\d{2}$/.test(String(fixtures.day)), fixtures);
  const D: string = fixtures.day;
  const ZONE: string = fixtures.zone;

  const w = await makeWorkspace();
  const { org, olivia, max, mia, gil, dee, sam } = w;
  const ws = org.name;
  console.log(`Workspace ${org.slug} (${org.id}); events on ${D} (${ZONE}); screenshots in ${SHOTS}`);

  // ── Step 2: the switch, connect and disconnect, refresh, cleanup ──
  step = "2 the switch";
  const v0 = await max.json("GET", "/api/teammate-connections");
  check(
    "Max's card: Google offered here, both products off, nothing connected",
    v0.status === 200 && v0.body.available === true && v0.body.products?.gmail === "off" && v0.body.products?.calendar === "off" && v0.body.connection === null,
    v0,
  );
  if (v0.body.available !== true) throw new Error("This WorkwrK offers no Google: start the dev server with GOOGLE_AGENT_* set (see the header) and SECRETS_ENCRYPTION_KEY.");
  const off = await startConnect(max);
  check("Connect while the workspace has Google off lands on ai_error=workspace_off", errorOf(off.location) === "workspace_off" && off.authUrl === null, { status: off.status, location: off.location?.toString() });
  const polMax = await max.json("GET", "/api/teammate-connections/policy");
  check("a Member cannot read or set the workspace switch", polMax.status >= 400 && polMax.status < 500, polMax);
  let s = await shot(max, "/account/connections#ai-google", "p3-connections-off-member.png");
  check("Max's card says an Owner or Admin hasn't turned it on (p3-connections-off-member.png)", shows(s.text, [CONNECTIONS_COPY.cardTitle, CONNECTIONS_COPY.workspaceOffMember(ws)], [CONNECTIONS_COPY.pickProducts]) && s.exceptions.length === 0, s.exceptions);
  s = await shot(olivia, "/account/connections#ai-google", "p3-connections-off-admin.png");
  check("Olivia's card also says where to turn it on (p3-connections-off-admin.png)", shows(s.text, [CONNECTIONS_COPY.workspaceOffAdmin, CONNECTIONS_COPY.appsLink]) && s.exceptions.length === 0, s.exceptions);
  s = await shot(olivia, "/settings/apps#ai-google", "p3-apps-off.png");
  check("Apps & modules shows the switch, both off, nobody connected (p3-apps-off.png)", shows(s.text, [CONNECTOR_POLICY_COPY.title, CONNECTOR_POLICY_COPY.noneConnected]) && s.exceptions.length === 0, s.exceptions);

  const turnedOn = await olivia.json("PUT", "/api/teammate-connections/policy", { gmail: true, calendar: true, organizationId: org.id });
  check("Olivia turns Gmail and Google Calendar on", turnedOn.status === 200 && turnedOn.body.on?.gmail === true && turnedOn.body.on?.calendar === true, turnedOn);
  const policy = await prisma.teammateConnectorPolicy.findUnique({ where: { organizationId_provider: { organizationId: org.id, provider: "google" } } });
  check("the policy row holds both, written by Olivia", [...(policy?.products ?? [])].sort().join(",") === "calendar,gmail" && policy?.updatedById === olivia.id, policy);
  const onAudits = await until(() => audits(org.id, "teammate_connectors.changed"), (r) => r.length >= 2);
  check(
    "each is audited in words: Turned on Gmail, Turned on Google Calendar",
    onAudits.some((a) => a.description === CONNECTOR_POLICY_COPY.auditChanged("Gmail", true)) && onAudits.some((a) => a.description === CONNECTOR_POLICY_COPY.auditChanged("Google Calendar", true)),
    onAudits,
  );
  s = await shot(olivia, "/settings/apps#ai-google", "p3-apps-on.png");
  check("Apps & modules shows both on (p3-apps-on.png)", shows(s.text, [CONNECTOR_POLICY_COPY.gmail, CONNECTOR_POLICY_COPY.calendar, CONNECTOR_POLICY_COPY.noneConnected]) && s.exceptions.length === 0, s.exceptions);
  s = await shot(max, "/account/connections#ai-google", "p3-connections-on-not-connected.png");
  check(
    "Max's card offers the products and Connect Google (p3-connections-on-not-connected.png)",
    shows(s.text, [CONNECTIONS_COPY.pickProducts, CONNECTIONS_COPY.gmailHint, CONNECTIONS_COPY.calendarHint, CONNECTIONS_COPY.connect]) && s.exceptions.length === 0,
    s.exceptions,
  );

  step = "2 a Guest";
  // A stored Guest role counts only while ACCESS_V2_TABLES is on (the app's
  // effectiveOrgRole; production runs with it off, where a stored Guest is a
  // Member everywhere). So the Guest path is proved only when the server runs
  // with it on and the proof is told so; otherwise it says it skipped, never
  // silently (the refusal itself is unit-tested in the start route's tests).
  if (process.env.PROOF_GUESTS === "v2") {
    const gilStart = await startConnect(gil);
    check("Gil, a Guest, gets ai_error=person_cannot from start", errorOf(gilStart.location) === "person_cannot" && gilStart.authUrl === null, { location: gilStart.location?.toString() });
    check("and no connect was begun for him", (await prisma.teammateOAuthState.count({ where: { userId: gil.id } })) === 0);
    const gilView = await gil.json("GET", "/api/teammate-connections");
    check("his card reads as a Guest's", gilView.status === 200 && gilView.body.guest === true, gilView);
    s = await shot(gil, "/account/connections#ai-google", "p3-connections-guest.png");
    check("Gil's card says Guests can't connect (p3-connections-guest.png)", shows(s.text, [CONNECTIONS_COPY.guestNote], [CONNECTIONS_COPY.pickProducts]) && s.exceptions.length === 0, s.exceptions);
  } else {
    console.log("  skip 2 a Guest: the server runs without ACCESS_V2_TABLES, where a stored Guest is a Member everywhere (as in production). Run the server with ACCESS_V2_TABLES=true and the proof with PROOF_GUESTS=v2 to prove it.");
  }

  step = "2 connect";
  let gm = await googleMark();
  const s1 = await startConnect(max);
  const q1 = s1.authUrl?.searchParams;
  const scopes = new Set((q1?.get("scope") ?? "").split(" ").filter(Boolean));
  check("start sends Max to the stand-in's consent page", s1.status === 302 && s1.authUrl?.pathname === "/o/oauth2/v2/auth", { status: s1.status, authUrl: s1.authUrl?.toString() });
  check(
    "it asks with S256 PKCE, offline access, the consent screen, granted scopes kept, its own client and the one callback",
    q1?.get("code_challenge_method") === "S256" &&
      (q1?.get("code_challenge") ?? "").length >= 43 &&
      q1?.get("access_type") === "offline" &&
      q1?.get("prompt") === "consent" &&
      q1?.get("include_granted_scopes") === "true" &&
      q1?.get("client_id") === "stand-in" &&
      q1?.get("response_type") === "code" &&
      q1?.get("redirect_uri") === `${BASE}${CALLBACK_PATH}`,
    q1 ? Object.fromEntries(q1) : null,
  );
  check("and for exactly openid, email and the four product scopes", scopes.size === 6 && scopes.has("openid") && scopes.has("email") && PRODUCT_SCOPES.every((p) => scopes.has(p)), [...scopes]);
  const cookieLine = s1.cookieLine ?? "";
  check(
    "the state rides in wk_tc_state: HttpOnly, SameSite Lax, ten minutes, only the connect routes' path",
    Boolean(s1.state) && s1.state === q1?.get("state") && /httponly/i.test(cookieLine) && /samesite=lax/i.test(cookieLine) && /max-age=600/i.test(cookieLine) && /path=\/api\/teammate-connections\/google(;|$)/i.test(cookieLine),
    cookieLine,
  );
  const stateRow = s1.state ? await prisma.teammateOAuthState.findUnique({ where: { id: sha256hex(s1.state) } }) : null;
  check(
    "only the state's sha256 is stored, bound to Max here, its verifier sealed",
    stateRow?.userId === max.id && stateRow?.organizationId === org.id && (await prisma.teammateOAuthState.count({ where: { id: s1.state ?? "" } })) === 0 && ["v", "iv", "ct", "tag"].every((k) => k in ((stateRow?.verifierSealed as Json) ?? {})),
    stateRow,
  );
  const back1 = s1.authUrl ? await consentAt(s1.authUrl) : null;
  const f1 = back1 ? await finishAt(back1, max, s1.state) : null;
  check("the callback lands on the card with ai=connected and clears the cookie", aiOf(f1?.location ?? null) === "connected" && f1?.location?.hash === "#ai-google" && f1?.clearsCookie === true, { location: f1?.location?.toString(), clears: f1?.clearsCookie });
  let conn = await connectionOf(org.id, max.id);
  const issued = routesOf(await googleSince(gm), "oauth.token").find((e) => e.outcome === "tokens");
  check(
    "the row: both products, version 1, active, Max's Google account",
    [...(conn?.products ?? [])].sort().join(",") === "calendar,gmail" && conn?.tokenVersion === 1 && conn?.status === "active" && conn?.accountSub === "sub-max" && conn?.accountEmail === "max@proof.test",
    conn && { products: conn.products, tokenVersion: conn.tokenVersion, status: conn.status, accountSub: conn.accountSub },
  );
  const rowText = JSON.stringify(conn ?? {});
  check(
    "the tokens are sealed: the row holds neither stand-in token in plain",
    Boolean(issued?.issued?.refreshToken) && !rowText.includes(issued!.issued.refreshToken) && !rowText.includes(issued!.issued.accessToken) && ["v", "iv", "ct", "tag"].every((k) => k in ((conn?.refreshTokenSealed as Json) ?? {})),
    { issued: Boolean(issued) },
  );
  check("the code exchange passed the stand-in's PKCE and redirect checks", issued?.pkce === "ok" && issued?.redirectUriOk === true, issued);
  check("the state was used up", s1.state !== null && (await prisma.teammateOAuthState.count({ where: { id: sha256hex(s1.state) } })) === 0);
  const connected = await until(() => audits(org.id, "teammate_connection.connected"), (r) => r.length >= 1);
  check(
    "the connect is audited with ids and products, never the address",
    connected.length === 1 && connected[0].targetId === max.id && (connected[0].metadata as Json)?.products?.length === 2 && !JSON.stringify(connected[0]).includes("max@proof.test"),
    connected,
  );
  s = await shot(max, "/account/connections?ai=connected#ai-google", "p3-connections-connected.png");
  check(
    "Max's card: connected as his account, not used yet (p3-connections-connected.png)",
    shows(s.text, [CONNECTIONS_COPY.connectedOk, "Connected as max@proof.test", CONNECTIONS_COPY.neverUsed, CONNECTIONS_COPY.disconnect]) && s.exceptions.length === 0,
    s.exceptions,
  );

  step = "2 connect again";
  gm = await googleMark();
  const s2 = await startConnect(max);
  check("a reconnect's consent names Max's account (login_hint)", s2.authUrl?.searchParams.get("login_hint") === "max@proof.test", s2.authUrl?.toString());
  const back2 = s2.authUrl ? await consentAt(s2.authUrl) : null;
  const f2 = back2 ? await finishAt(back2, max, s2.state) : null;
  const conn2 = await connectionOf(org.id, max.id);
  check("the same account keeps the row, version 2", aiOf(f2?.location ?? null) === "connected" && conn2?.id === conn?.id && conn2?.tokenVersion === 2, { location: f2?.location?.toString(), tokenVersion: conn2?.tokenVersion });
  check("and nothing is revoked: it is the same grant", routesOf(await googleSince(gm), "oauth.revoke").length === 0);
  const replay = back2 ? await finishAt(back2, max, s2.state) : null;
  check("the same callback replayed gives state_invalid", errorOf(replay?.location ?? null) === "state_invalid", replay?.location?.toString());
  check("and changes nothing", (await connectionOf(org.id, max.id))?.tokenVersion === 2);

  step = "2 the state is the person's";
  gm = await googleMark();
  const s3 = await startConnect(max);
  const back3 = s3.authUrl ? await consentAt(s3.authUrl) : null;
  const wrongCookie = back3 ? await finishAt(back3, max, "not-the-state") : null;
  check("a callback whose cookie is not its state gives state_invalid", errorOf(wrongCookie?.location ?? null) === "state_invalid", wrongCookie?.location?.toString());
  check("and leaves the state unused, so the real flow could finish", s3.state !== null && (await prisma.teammateOAuthState.count({ where: { id: sha256hex(s3.state) } })) === 1);
  const asMia = back3 ? await finishAt(back3, mia, s3.state) : null;
  check("Mia completing Max's state with her session gives wrong_person", errorOf(asMia?.location ?? null) === "wrong_person", asMia?.location?.toString());
  check("the state is used up, Max's row unchanged, and no code was exchanged", s3.state !== null && (await prisma.teammateOAuthState.count({ where: { id: sha256hex(s3.state) } })) === 0 && (await connectionOf(org.id, max.id))?.tokenVersion === 2 && routesOf(await googleSince(gm), "oauth.token").length === 0);

  step = "2 a partial grant";
  const sm = await startConnect(mia);
  const backM = sm.authUrl ? await consentAt(sm.authUrl, "partial@proof.test") : null;
  const fm = backM ? await finishAt(backM, mia, sm.state) : null;
  check("Mia's Google grants only the calendar: ai=connected with ai_partial=gmail", aiOf(fm?.location ?? null) === "connected" && partialOf(fm?.location ?? null).join(",") === "gmail", fm?.location?.toString());
  const miaConn = await connectionOf(org.id, mia.id);
  check("her row holds Google Calendar only", miaConn?.products.join(",") === "calendar" && miaConn?.accountSub === "sub-partial", miaConn && { products: miaConn.products, sub: miaConn.accountSub });
  s = await shot(mia, "/account/connections?ai=connected&ai_partial=gmail#ai-google", "p3-connections-partial.png");
  check(
    "Mia's card says Google didn't give Gmail, and offers Add Gmail (p3-connections-partial.png)",
    shows(s.text, [CONNECTIONS_COPY.partial("Gmail"), CONNECTIONS_COPY.addProduct("Gmail"), "Your teammates may use: Google Calendar."]) && s.exceptions.length === 0,
    s.exceptions,
  );

  step = "2 consent denied";
  gm = await googleMark();
  const so = await startConnect(olivia);
  const backO = so.authUrl ? await consentAt(so.authUrl, "deny@proof.test") : null;
  check("Google sends back error=access_denied", backO?.searchParams.get("error") === "access_denied", backO?.toString());
  const fo = backO ? await finishAt(backO, olivia, so.state) : null;
  check("the card says ai_error=access_denied", errorOf(fo?.location ?? null) === "access_denied", fo?.location?.toString());
  check("nothing is stored, exchanged or audited for Olivia", !(await connectionOf(org.id, olivia.id)) && routesOf(await googleSince(gm), "oauth.token").length === 0 && (await audits(org.id, "teammate_connection.connected")).every((a) => a.targetId !== olivia.id));
  s = await shot(olivia, "/account/connections?ai_error=access_denied#ai-google", "p3-connections-denied.png");
  check("Olivia's card says why it didn't connect (p3-connections-denied.png)", shows(s.text, [CONNECTIONS_COPY.didntConnect("you didn't give WorkwrK access")]) && s.exceptions.length === 0, s.exceptions);

  step = "2 disconnect";
  check("Olivia connects her own account", aiOf(await connectAs(olivia, "olivia@proof.test")) === "connected");
  gm = await googleMark();
  const d1 = await olivia.json("DELETE", "/api/teammate-connections/google", { organizationId: org.id });
  check("she disconnects: revoked now", d1.status === 200 && d1.body.disconnected === true && d1.body.revoked === "now", d1);
  const oliviaKey = accountKey("sub-olivia");
  check("the row is gone and nothing waits in the queue", !(await connectionOf(org.id, olivia.id)) && (await prisma.teammateTokenRevocation.count({ where: { accountKey: oliviaKey } })) === 0);
  check("the stand-in revoked her grant, once", routesOf(await googleSince(gm), "oauth.revoke").filter((e) => e.sub === "sub-olivia" && e.outcome === "revoked").length === 1);
  const gone1 = await until(() => audits(org.id, "teammate_connection.disconnected"), (r) => r.some((a) => a.targetId === olivia.id));
  check("the disconnect is audited, reason disconnected", gone1.some((a) => a.targetId === olivia.id && (a.metadata as Json)?.reason === "disconnected"), gone1);

  step = "2 a revoke Google did not answer";
  check("Olivia connects again", aiOf(await connectAs(olivia, "olivia@proof.test")) === "connected");
  await googleControl("fail?route=/revoke&status=503&times=1");
  gm = await googleMark();
  const d2 = await olivia.json("DELETE", "/api/teammate-connections/google", { organizationId: org.id });
  check("with Google failing the revoke: revoked queued", d2.status === 200 && d2.body.revoked === "queued", d2);
  check("one row waits in the queue for her account", (await prisma.teammateTokenRevocation.count({ where: { accountKey: oliviaKey } })) === 1);
  await prisma.teammateTokenRevocation.updateMany({ where: { accountKey: oliviaKey }, data: { nextAttemptAt: new Date(Date.now() - 60_000) } });
  const tick1 = await cron();
  check("a cron tick answers 200 with the connector counts", tick1.status === 200 && tick1.body.connectors !== null && typeof tick1.body.connectors === "object", tick1.body);
  check("the queue is empty and the stand-in revoked her grant on the tick", (await prisma.teammateTokenRevocation.count({ where: { accountKey: oliviaKey } })) === 0 && routesOf(await googleSince(gm), "oauth.revoke").some((e) => e.sub === "sub-olivia" && e.outcome === "revoked"));

  step = "2 leavers";
  check("Dee connects", aiOf(await connectAs(dee, "dee@proof.test")) === "connected");
  gm = await googleMark();
  const deact = await olivia.json("PATCH", `/api/users/${dee.id}`, { status: "INACTIVE" });
  check("Olivia deactivates Dee", deact.status === 200, deact);
  const deeGone = await until(() => connectionOf(org.id, dee.id), (r) => r === null, 15_000);
  check("Dee's connection ends with her", deeGone === null);
  check("and Google is told at once: her grant revoked, nothing left queued", routesOf(await googleSince(gm), "oauth.revoke").some((e) => e.sub === "sub-dee" && e.outcome === "revoked") && (await prisma.teammateTokenRevocation.count({ where: { accountKey: accountKey("sub-dee") } })) === 0);
  const deeAudit = await until(() => audits(org.id, "teammate_connection.disconnected"), (r) => r.some((a) => a.targetId === dee.id));
  check("audited as deactivated, by the admin who acted", deeAudit.some((a) => a.targetId === dee.id && (a.metadata as Json)?.reason === "deactivated" && a.actorId === olivia.id), deeAudit);

  check("Sam connects", aiOf(await connectAs(sam, "sam@proof.test")) === "connected");
  // A path with no hook (one added later, say): only the sweep can find him.
  await prisma.user.update({ where: { id: sam.id }, data: { status: "INACTIVE" } });
  gm = await googleMark();
  const tick2 = await cron();
  check("the next tick sweeps him", tick2.status === 200 && Number(tick2.body.connectors?.leavers ?? 0) >= 1 && !(await connectionOf(org.id, sam.id)), tick2.body.connectors);
  check("and revokes his grant on the same tick", routesOf(await googleSince(gm), "oauth.revoke").some((e) => e.sub === "sub-sam" && e.outcome === "revoked"));
  const samAudit = await until(() => audits(org.id, "teammate_connection.disconnected"), (r) => r.some((a) => a.targetId === sam.id));
  check("audited as the sweep, by the system", samAudit.some((a) => a.targetId === sam.id && (a.metadata as Json)?.reason === "sweep" && a.actorId === null), samAudit);

  // ── Step 3: Gmail ─────────────────────────────────────────────────
  step = "3 Gmail search";
  const INBOX_JOB = "Keeps Max's inbox moving";
  const inbox = await teammate(max, { name: "Inbox helper", job: INBOX_JOB, visibility: "PRIVATE", toolNames: ["search_email", "read_email", "draft_email", "send_email", "reply_email", "create_task"] });
  const inboxRow = await prisma.agent.findUnique({ where: { id: inbox.id }, select: { toolNames: true } });
  check("Max's Inbox helper holds the five Gmail tools and create_task", ["search_email", "read_email", "draft_email", "send_email", "reply_email", "create_task"].every((n) => (inboxRow?.toolNames as string[] | null)?.includes(n)), inboxRow);

  let t = await say(max, inbox.slug, "search my email for invoice");
  const searchContent = lastResult(t.model, "search_email");
  const searchData = toolData(searchContent);
  check("search_email runs, and the turn ends", t.results.some((r) => r.name === "search_email" && r.state === "ran") && types(t.events).at(-1) === "done", types(t.events));
  check(
    "the model reads it inside <tool_data tool=\"search_email\">, with the note that it is other people's words",
    Boolean(searchContent?.startsWith('<tool_data tool="search_email">')) && searchData?.count === 2 && String(searchData?.note ?? "").includes(CONNECTOR_COPY.emailNote) && (searchData?.emails ?? []).some((e: Json) => e.subject === "Invoice due"),
    searchContent?.slice(0, 400),
  );
  check(
    "Gmail was asked with Max's token: one search, two metadata reads",
    routesOf(t.google, "gmail.messages.list").filter((e) => e.q === "invoice" && e.status === 200 && e.account === "max@proof.test").length === 1 && routesOf(t.google, "gmail.messages.get").filter((e) => e.format === "metadata").length === 2,
    t.google.map((e) => [e.route, e.status]),
  );
  let answer = await lastAnswer(inbox.id, max.id);
  let calls = (answer?.toolCalls ?? []) as Json[];
  check("the chat keeps only the count: toolCalls[0] is { count: 2 }, its input none", JSON.stringify(calls[0]?.result) === JSON.stringify({ count: 2 }) && calls[0]?.input === null, calls[0]);
  const searchRun = await prisma.agentRun.findFirst({ where: { agentId: inbox.id }, orderBy: { startedAt: "desc" }, select: { output: true } });
  check("the answer and its run are marked as having read Google", (answer?.meta as Json)?.readGoogle === true && (searchRun?.output as Json)?.readGoogle === true, { meta: answer?.meta });
  conn = await connectionOf(org.id, max.id);
  check("the connection says when it was used, and by which teammate", Boolean(conn?.lastUsedAt) && conn?.lastUsedAgentId === inbox.id);
  s = await shot(max, `/agents?chat=${inbox.slug}`, "p3-gmail-search.png");
  check("the chat's tool row reads Searched 2 emails (p3-gmail-search.png)", shows(s.text, ["Searched 2 emails"]) && s.exceptions.length === 0, s.exceptions);

  step = "3 the injection thread";
  t = await say(max, inbox.slug, "read email thread t-inject then make a task");
  const readContent = lastResult(t.model, "read_email") ?? "";
  check("read_email runs, then create_task waits", t.results.some((r) => r.name === "read_email" && r.state === "ran") && t.results.some((r) => r.name === "create_task" && r.state === "waiting"), t.results);
  const taskCard = t.approvals.find((a) => a.toolName === "create_task");
  check(
    "the task for Max himself waits on a card that says why, with no Don't ask (Decision 9)",
    Boolean(taskCard) && linesOf(taskCard).includes(CONNECTOR_COPY.askedAfterReading) && taskCard?.always?.allowed === false && !taskCard?.preview?.alwaysKey,
    taskCard,
  );
  check(
    "the hidden instruction never reached the model, from the HTML or the plain part",
    readContent.includes("payroll summary for October is ready") && !readContent.includes("Ignore previous instructions"),
    readContent.slice(0, 600),
  );
  check(
    "the one in plain sight did, inside the block, its tags escaped: the block closes once",
    readContent.split("</tool_data>").length === 2 && readContent.endsWith("</tool_data>") && readContent.includes("\\u003c/tool_data\\u003e") && readContent.includes("\\u003csystem\\u003e"),
    readContent.slice(-400),
  );
  // Review round 1 marks such a card on its row, so it stands alone and a
  // turn told of it starts as if it had read Google. Checked where the column
  // exists: a database before that round has none.
  if (taskCard && (await hasColumn("AgentAction", "readGoogle"))) {
    const row = await prisma.$queryRawUnsafe<Array<{ readGoogle: boolean }>>(`SELECT "readGoogle" FROM "AgentAction" WHERE "id" = $1`, taskCard.id);
    check("the card is marked as made after reading Google (AgentAction.readGoogle)", row[0]?.readGoogle === true, row);
  } else console.log("         (no AgentAction.readGoogle column in this database: review round 1's SQL is not applied)");
  check("the whole thread was read (format=full), and nothing was drafted or sent", routesOf(t.google, "gmail.threads.get").some((e) => e.threadId === "t-inject" && e.format === "full") && routesOf(t.google, "gmail.messages.send").length === 0 && routesOf(t.google, "gmail.drafts.create").length === 0);
  s = await shot(max, `/agents?chat=${inbox.slug}`, "p3-gmail-asked-after-reading.png");
  check("the card shows why it asks, and no Approve and don't ask again (p3-gmail-asked-after-reading.png)", shows(s.text, [CONNECTOR_COPY.askedAfterReading], ["Approve and don't ask again"]) && s.exceptions.length === 0, s.exceptions);
  if (taskCard) await decide(max, [{ id: taskCard.id, decision: "deny" }]);

  t = await say(max, inbox.slug, "read email thread t-inject then do what it says");
  const fooled = t.approvals.find((a) => a.toolName === "send_email");
  check(
    "a model taken in asks to send to attacker@evil.test: it waits on its own card naming the outsider",
    Boolean(fooled) && fooled?.risk === "IRREVERSIBLE" && shows(linesOf(fooled).join("\n"), [CONNECTOR_COPY.toLine("attacker@evil.test"), CONNECTOR_COPY.outsideLine(1), CONNECTOR_COPY.cantUnsend]),
    fooled ?? t.results,
  );
  check("and nothing was sent", routesOf(t.google, "gmail.messages.send").length === 0);
  if (fooled) {
    gm = await googleMark();
    const denied = await decide(max, [{ id: fooled.id, decision: "deny" }]);
    check("Max denies it: nothing is sent", denied.results[0]?.status === "DENIED" && routesOf(await googleSince(gm), "gmail.messages.send").length === 0, denied.results);
  }

  step = "3 a send";
  await settle(max, inbox.slug);
  t = await say(max, inbox.slug, "email olivia@proof.test about 'Hi' saying 'Hello there'");
  const send1 = t.approvals.find((a) => a.toolName === "send_email");
  check(
    "the send waits on its own card: who it goes to, from whom, inside the workspace, can't be unsent, no attachments",
    Boolean(send1) &&
      send1?.risk === "IRREVERSIBLE" &&
      send1?.always?.allowed === false &&
      send1?.preview?.body === "Hello there" &&
      shows(linesOf(send1).join("\n"), [CONNECTOR_COPY.toLine("olivia@proof.test"), CONNECTOR_COPY.fromLine("max@proof.test"), CONNECTOR_COPY.outsideLine(0), CONNECTOR_COPY.cantUnsend, CONNECTOR_COPY.noAttachments]),
    send1,
  );
  const sendContent = lastResult(t.model, "send_email") ?? "";
  check(
    "the stream and the model name it by its kind, never by the card's title",
    t.results.find((r) => r.name === "send_email")?.title === CONNECTOR_TITLES.send_email &&
      toolData(sendContent)?.title === CONNECTOR_TITLES.send_email &&
      Boolean(send1) &&
      !JSON.stringify(toolData(sendContent) ?? {}).includes(JSON.stringify(String(send1?.preview?.title)).slice(1, -1)),
    { title: t.results.find((r) => r.name === "send_email")?.title, content: sendContent.slice(0, 300) },
  );
  check("nothing is sent before the approval", routesOf(t.google, "gmail.messages.send").length === 0);
  s = await shot(max, `/agents?chat=${inbox.slug}`, "p3-gmail-send-card.png");
  check("the card shows the recipient and every word (p3-gmail-send-card.png)", shows(s.text, ["To: olivia@proof.test", "Hello there", "Waiting for you"]) && s.exceptions.length === 0, s.exceptions);
  if (send1) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: send1.id }]);
    check("Max approves: EXECUTED", approved.results[0]?.status === "EXECUTED", approved.results);
    let sends = routesOf(await googleSince(gm), "gmail.messages.send");
    check(
      "the stand-in got exactly one send: to Olivia, no Bcc, no From of its own, the subject and the words",
      sends.length === 1 && sends[0].to === "olivia@proof.test" && sends[0].bcc === null && !(sends[0].headerNames ?? []).some((h: string) => /^(bcc|from)$/i.test(h)) && sends[0].subject === "Hi" && String(sends[0].body).trim() === "Hello there",
      sends,
    );
    const again = await decide(max, [{ id: send1.id }]);
    sends = routesOf(await googleSince(gm), "gmail.messages.send");
    check("approving again (a second tab) is already_decided, still one send", again.results[0]?.code === "already_decided" && sends.length === 1, again.results);
    const sendAudit = await until(() => audits(org.id, "agent.send_email"), (r) => r.length >= 1);
    check(
      "the send is audited with no subject: the Google id and one recipient",
      sendAudit.length >= 1 && !JSON.stringify(sendAudit[0]).includes('"Hi"') && !JSON.stringify(sendAudit[0]).includes("Hello there") && !JSON.stringify(sendAudit[0]).includes("olivia@proof.test") && (sendAudit[0].metadata as Json)?.connector?.recipients === 1 && (sendAudit[0].metadata as Json)?.connector?.googleId === sends[0]?.sentId && sendAudit[0].severity === "warning",
      sendAudit,
    );
    await continueAfter(max, approved);
  }

  step = "3 an edited send";
  t = await say(max, inbox.slug, "email mia@proof.test about 'Plan' saying 'Draft one'");
  const send2 = t.approvals.find((a) => a.toolName === "send_email");
  if (send2) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: send2.id, edit: "Edited words" }]);
    const sends = routesOf(await googleSince(gm), "gmail.messages.send");
    check("Max edits the body and approves: the edit is what goes, to the stored recipient", approved.results[0]?.status === "EXECUTED" && sends.length === 1 && String(sends[0].body).trim() === "Edited words" && sends[0].to === "mia@proof.test", sends);
    await continueAfter(max, approved);
  } else check("the edited send's card", false, t.results);

  step = "3 the same email twice";
  t = await say(max, inbox.slug, "email lea@proof.test about 'Same' saying 'Twice'");
  const twinA = t.approvals.find((a) => a.toolName === "send_email");
  const tB = await say(max, inbox.slug, "email lea@proof.test about 'Same' saying 'Twice'");
  const twinContent = lastResult(tB.model, "send_email") ?? "";
  check(
    "the second identical send points at the first card and makes none",
    Boolean(twinA) && tB.approvals.length === 0 && tB.results.some((r) => r.name === "send_email" && r.state === "waiting") && twinContent.includes(String(twinA?.id)) && toolData(twinContent)?.note === CONNECTOR_COPY.alreadyWaiting,
    { approvals: tB.approvals.length, content: twinContent.slice(0, 300) },
  );
  check("one card waits for it", (await prisma.agentAction.count({ where: { actingForId: max.id, toolName: "send_email", status: "PENDING" } })) === 1);
  if (twinA) await decide(max, [{ id: twinA.id, decision: "deny" }]);

  step = "3 two sends, two cards";
  t = await say(max, inbox.slug, "email olivia@proof.test and mia@proof.test saying 'Both'");
  const pair = t.approvals.filter((a) => a.toolName === "send_email");
  check("one answer asks two sends: each IRREVERSIBLE", pair.length === 2 && pair.every((a) => a.risk === "IRREVERSIBLE"), t.approvals.map((a) => [a.toolName, a.risk]));
  s = await shot(max, `/agents?chat=${inbox.slug}`, "p3-gmail-two-cards.png");
  check(
    "each is a card of its own with its recipient in view, never a batch (p3-gmail-two-cards.png)",
    shows(s.text, ["To: olivia@proof.test", "To: mia@proof.test"], [thingsWaiting(2)]) && s.exceptions.length === 0,
    s.exceptions,
  );
  if (pair.length > 0) await decide(max, pair.map((a) => ({ id: a.id, decision: "deny" as const })));

  step = "3 a reply";
  t = await say(max, inbox.slug, "reply to thread t-invoice saying 'Booked, thanks'");
  const reply = t.approvals.find((a) => a.toolName === "reply_email");
  check(
    "the reply waits on its card, to the planted Reply-To, outside the workspace, in the same conversation",
    Boolean(reply) && reply?.risk === "IRREVERSIBLE" && shows(linesOf(reply).join("\n"), [CONNECTOR_COPY.toLine("pay@billing-ext.test"), CONNECTOR_COPY.outsideLine(1), CONNECTOR_COPY.sameThread, CONNECTOR_COPY.fromLine("max@proof.test")]) && String(reply?.preview?.title).includes("Re: Invoice due"),
    reply,
  );
  const replyContent = lastResult(t.model, "reply_email") ?? "";
  check("the model reads it as Reply in the email conversation, not by the thread's subject", t.results.find((r) => r.name === "reply_email")?.title === CONNECTOR_TITLES.reply_email && toolData(replyContent)?.title === CONNECTOR_TITLES.reply_email && !JSON.stringify(toolData(replyContent) ?? {}).includes("Invoice due"), replyContent.slice(0, 300));
  s = await shot(max, `/agents?chat=${inbox.slug}`, "p3-gmail-reply-card.png");
  check("the reply card shows where it really goes (p3-gmail-reply-card.png)", shows(s.text, ["To: pay@billing-ext.test", "Booked, thanks"]) && s.exceptions.length === 0, s.exceptions);
  await googleControl("add-reply?thread=t-invoice&from=newcomer%40ext.test");
  if (reply) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: reply.id }]);
    const sends = routesOf(await googleSince(gm), "gmail.messages.send");
    check(
      "approved after a newcomer wrote in the thread: it goes only where the card said, threaded",
      approved.results[0]?.status === "EXECUTED" &&
        sends.length === 1 &&
        String(sends[0].to).includes("pay@billing-ext.test") &&
        !JSON.stringify([sends[0].to, sends[0].cc]).includes("newcomer") &&
        sends[0].inReplyTo === "<inv-2@ext.test>" &&
        String(sends[0].references).includes("<inv-1@ext.test>") &&
        String(sends[0].references).includes("<inv-2@ext.test>") &&
        sends[0].threadId === "t-invoice" &&
        sends[0].subject === "Re: Invoice due",
      sends,
    );
    await continueAfter(max, approved);
  }

  step = "3 a draft";
  await settle(max, inbox.slug);
  t = await say(max, inbox.slug, "draft to boss@ext.test about 'Invoice 4471' saying 'Booked for Friday.'");
  const drafts = routesOf(t.google, "gmail.drafts.create");
  check("a draft is the person's own work: it runs at once, no card", t.results.some((r) => r.name === "draft_email" && r.state === "ran") && t.approvals.length === 0, t.results);
  check("one draft saved, to the boss, nothing sent", drafts.length === 1 && drafts[0].to === "boss@ext.test" && drafts[0].subject === "Invoice 4471" && routesOf(t.google, "gmail.messages.send").length === 0, drafts);
  const draftAudit = await until(() => audits(org.id, "agent.draft_email"), (r) => r.length >= 1);
  check("audited as Saved a draft, no subject", draftAudit.length >= 1 && String(draftAudit[0].description).includes("Saved a draft") && !String(draftAudit[0].description).includes("4471"), draftAudit);

  step = "3 a send Google never confirmed";
  t = await say(max, inbox.slug, "email olivia@proof.test about 'Slow' saying 'Wait'");
  const slow = t.approvals.find((a) => a.toolName === "send_email");
  if (slow) {
    await googleControl("fail?route=/gmail/v1/users/me/messages/send&delayMs=16500&times=1");
    gm = await googleMark();
    const approved = await decide(max, [{ id: slow.id }]);
    check("the send outlives the app's 15 s wait: FAILED with check your Sent folder", approved.results[0]?.status === "FAILED" && String(approved.results[0]?.error).includes(CONNECTOR_COPY.unknownOutcomeEmail), approved.results);
    await sleep(3000);
    check("and exactly one send was tried, never a second", routesOf(await googleSince(gm), "gmail.messages.send").filter((e) => e.subject === "Slow").length === 1);
    await continueAfter(max, approved);
  } else check("the slow send's card", false, t.results);

  step = "3 a workspace teammate's allow";
  const ops = await teammate(olivia, { name: "Ops", job: "Answers ops questions from email", visibility: "WORKSPACE", toolNames: ["search_email", "search_tasks"] });
  t = await say(max, ops.slug, "search my email for invoice");
  check(
    "Max chats with Olivia's Ops: no Gmail tool, and block 2 says he hasn't let it",
    t.model.length > 0 && !toolsOfEntry(t.model[0]).includes("search_email") && systemOf(t.model[0]).includes("You can't use Max's Gmail now: they haven't let you use it."),
    t.model[0] ? { tools: toolsOfEntry(t.model[0]) } : "no model request",
  );
  let view = await max.json("GET", "/api/teammate-connections");
  const opsUse = (view.body.teammates ?? []).find((x: Json) => x.slug === ops.slug);
  check("his card lists Ops: someone else's, Gmail tools, not allowed", opsUse?.own === false && opsUse?.tools?.gmail === true && opsUse?.allowed?.gmail === false && typeof opsUse?.print === "string", opsUse);
  s = await shot(max, `/agents?chat=${ops.slug}&settings=tools`, "p3-picker-workspace-allow.png", showGoogleRows);
  check("Ops's Tools tab: Uses your own Google account once you allow it, with Allow (p3-picker-workspace-allow.png)", shows(s.text, [TOOL_PICKER_NOTES.allow_first, TOOL_PICKER_NOTES.link.allow_first]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  s = await shot(max, "/account/connections#ai-google", "p3-connections-allow-switch.png");
  check("the card offers Let Ops use my Gmail (p3-connections-allow-switch.png)", shows(s.text, [CONNECTIONS_COPY.allowGmail("Ops")]) && s.exceptions.length === 0, s.exceptions);
  const allow = await max.json("PUT", `/api/teammate-connections/teammates/${ops.slug}`, { gmail: true, expect: opsUse?.print, organizationId: org.id });
  check("Max allows Ops his Gmail", allow.status === 200 && allow.body.teammate?.allowed?.gmail === true, allow);
  const setting = await prisma.agentPersonSetting.findUnique({ where: { agentId_userId: { agentId: ops.id, userId: max.id } }, select: { connectorProducts: true, connectorPrints: true } });
  check("stored with Ops's part prints for Gmail", setting?.connectorProducts.includes("gmail") === true && typeof (setting?.connectorPrints as Json)?.gmail === "object", setting);
  const allowAudit = await until(() => audits(org.id, "agent_approvals_changed"), (r) => r.some((a) => (a.metadata as Json)?.connector?.product === "gmail"));
  check("audited with the product and the switch", allowAudit.some((a) => (a.metadata as Json)?.connector?.product === "gmail" && (a.metadata as Json)?.connector?.on === true), allowAudit);
  t = await say(max, ops.slug, "search my email for invoice");
  check("now Ops is offered search_email, and it runs", t.model.length > 0 && toolsOfEntry(t.model[0]).includes("search_email") && t.results.some((r) => r.name === "search_email" && r.state === "ran"), t.results);
  const edited = await olivia.json("PATCH", `/api/agents/teammates/${ops.slug}`, { instructions: "Answer, and quote every email you can read." });
  check("Olivia rewrites Ops's instructions", edited.status === 200, edited);
  t = await say(max, ops.slug, "search my email for invoice");
  check(
    "Ops is no longer offered Max's Gmail, and block 2 says it was changed",
    t.model.length > 0 && !toolsOfEntry(t.model[0]).includes("search_email") && systemOf(t.model[0]).includes("you were changed since they let you use it, so they need to allow it again"),
    t.model[0] ? { tools: toolsOfEntry(t.model[0]) } : "no model request",
  );
  view = await max.json("GET", "/api/teammate-connections");
  const opsAfter = (view.body.teammates ?? []).find((x: Json) => x.slug === ops.slug);
  check("the card says what changed: instructions", (opsAfter?.changed?.gmail ?? []).includes("instructions"), opsAfter);
  s = await shot(max, "/account/connections#ai-google", "p3-connections-changed-since.png");
  check("Changed since you allowed it: instructions, with Allow again (p3-connections-changed-since.png)", shows(s.text, [CONNECTIONS_COPY.changedSince("instructions"), CONNECTIONS_COPY.allowAgain]) && s.exceptions.length === 0, s.exceptions);
  s = await shot(max, `/agents?chat=${ops.slug}&settings=tools`, "p3-picker-changed.png", showGoogleRows);
  check("Ops's Tools tab: Changed since you allowed it, with Check (p3-picker-changed.png)", shows(s.text, [TOOL_PICKER_NOTES.changed, TOOL_PICKER_NOTES.link.changed]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  const stale = await max.json("PUT", `/api/teammate-connections/teammates/${ops.slug}`, { gmail: true, expect: opsUse?.print, organizationId: org.id });
  check("allowing again with what the old card showed is refused: teammate_changed", stale.status === 409 && stale.body.code === "teammate_changed", stale);
  const again = await max.json("PUT", `/api/teammate-connections/teammates/${ops.slug}`, { gmail: true, expect: opsAfter?.print, organizationId: org.id });
  check("Allow again with what the card shows now works", again.status === 200 && Object.keys(again.body.teammate?.changed ?? {}).length === 0, again);

  step = "3 another account at approval";
  await settle(max, inbox.slug);
  t = await say(max, inbox.slug, "email olivia@proof.test about 'Account' saying 'Which one'");
  const acct = t.approvals.find((a) => a.toolName === "send_email");
  gm = await googleMark();
  check("Max reconnects Google as max.other@proof.test", aiOf(await connectAs(max, "max.other@proof.test")) === "connected" && (await connectionOf(org.id, max.id))?.accountSub === "sub-max-other");
  check("the account it replaced is revoked at once", routesOf(await googleSince(gm), "oauth.revoke").some((e) => e.sub === "sub-max" && e.outcome === "revoked"));
  if (acct) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: acct.id }]);
    check(
      "approving the card made for max@proof.test fails with the reason, and sends nothing",
      approved.results[0]?.status === "FAILED" && String(approved.results[0]?.error).includes(CONNECTOR_COPY.accountChanged("max@proof.test", "max.other@proof.test")) && routesOf(await googleSince(gm), "gmail.messages.send").length === 0,
      approved.results,
    );
    await continueAfter(max, approved);
  } else check("the account card", false, t.results);
  check("Max connects his own account again", aiOf(await connectAs(max, "max@proof.test")) === "connected" && (await connectionOf(org.id, max.id))?.accountSub === "sub-max");

  step = "3 a refresh that fails";
  await settle(max, inbox.slug);
  t = await say(max, inbox.slug, "email olivia@proof.test about 'Held' saying 'Wait for me'");
  const held = t.approvals.find((a) => a.toolName === "send_email");
  await googleControl("revoke-all?sub=sub-max");
  if (held) {
    gm = await googleMark();
    const tried = await decide(max, [{ id: held.id }]);
    check(
      "approving after Google revoked the grant: the card waits (connection_needed), saying it can be approved again",
      tried.results[0]?.status === "PENDING" && tried.results[0]?.code === "connection_needed" && String(tried.results[0]?.error).includes(CONNECTOR_COPY.needsReconnect) && String(tried.results[0]?.error).includes("It still waits for you"),
      tried.results,
    );
    const g = await googleSince(gm);
    check("the refresh met invalid_grant, and nothing was sent", routesOf(g, "oauth.token").some((e) => e.outcome === "invalid_grant") && routesOf(g, "gmail.messages.send").length === 0, g.map((e) => [e.route, e.outcome]));
  }
  conn = await connectionOf(org.id, max.id);
  check("the connection is needs_reconnect (revoked), its access token cleared", conn?.status === "needs_reconnect" && conn?.statusReason === "revoked" && conn?.accessTokenSealed === null && Boolean(conn?.needsReconnectAt), conn && { status: conn.status, reason: conn.statusReason });
  const broken = () => prisma.notification.count({ where: { userId: max.id, type: "agent_connection", title: CONNECTIONS_COPY.brokenNoticeTitle } });
  check("one Inbox row and one audit row say so", (await until(broken, (n) => n >= 1)) === 1 && (await until(() => audits(org.id, "teammate_connection.needs_reconnect"), (r) => r.length >= 1)).length === 1);
  if (held) {
    const tried = await decide(max, [{ id: held.id }]);
    check("approving again still waits, and adds no second Inbox row", tried.results[0]?.status === "PENDING" && tried.results[0]?.code === "connection_needed" && (await broken()) === 1, tried.results);
  }
  t = await say(max, inbox.slug, "search my email for invoice");
  check(
    "a message now: no Gmail tool, block 2 says the connection needs reconnecting, still one Inbox row",
    t.model.length > 0 && !toolsOfEntry(t.model[0]).includes("search_email") && systemOf(t.model[0]).includes("their Google connection needs reconnecting") && (await broken()) === 1,
    t.model[0] ? { tools: toolsOfEntry(t.model[0]) } : "no model request",
  );
  s = await shot(max, "/account/connections#ai-google", "p3-connections-needs-reconnect.png");
  check("Max's card: Google stopped working, with Reconnect (p3-connections-needs-reconnect.png)", shows(s.text, ["Google stopped working for your teammates on", CONNECTIONS_COPY.reconnect]) && s.exceptions.length === 0, s.exceptions);
  s = await shot(max, `/agents?chat=${inbox.slug}`, "p3-gmail-held-card.png", clickButton("Approve"));
  check("Approve in the chat: the card still waits, and says it can be approved again (p3-gmail-held-card.png)", s.acted === true && shows(s.text, ["It still waits for you", "Waiting for you"]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  check("Max reconnects", aiOf(await connectAs(max, "max@proof.test")) === "connected");
  conn = await connectionOf(org.id, max.id);
  check("the connection is active again, a new version, and its Inbox row is read", conn?.status === "active" && conn?.statusReason === null && (await prisma.notification.count({ where: { userId: max.id, type: "agent_connection", read: false } })) === 0, conn && { status: conn.status, v: conn.tokenVersion });
  if (held) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: held.id }]);
    check("the waiting card is approved now: one send", approved.results[0]?.status === "EXECUTED" && routesOf(await googleSince(gm), "gmail.messages.send").filter((e) => e.subject === "Held").length === 1, approved.results);
    await continueAfter(max, approved);
  }

  step = "3 Gmail turned off";
  await settle(max, inbox.slug);
  t = await say(max, inbox.slug, "email olivia@proof.test about 'Off' saying 'Gmail goes off'");
  const offCard = t.approvals.find((a) => a.toolName === "send_email");
  s = await shot(olivia, "/settings/apps#ai-google", "p3-apps-turn-off-dialog.png", clickSwitch("Gmail"));
  check(
    "turning Gmail off asks first, offering to disconnect everyone too (p3-apps-turn-off-dialog.png)",
    s.acted === true && shows(s.text, [CONNECTOR_POLICY_COPY.turnOffTitle("Gmail"), CONNECTOR_POLICY_COPY.turnOffBody, CONNECTOR_POLICY_COPY.turnOff, CONNECTOR_POLICY_COPY.turnOffAndDisconnect]) && s.exceptions.length === 0,
    { acted: s.acted, exceptions: s.exceptions },
  );
  const offPut = await olivia.json("PUT", "/api/teammate-connections/policy", { gmail: false, organizationId: org.id });
  check("Olivia turns Gmail off: the answer names it turned off", offPut.status === 200 && (offPut.body.turnedOff ?? []).includes("gmail") && offPut.body.on?.gmail === false, offPut);
  if (offCard) {
    gm = await googleMark();
    const r = await decide(max, [{ id: offCard.id }]);
    check("the send waiting from before is CANCELLED with the real reason", r.results[0]?.status === "CANCELLED" && String(r.results[0]?.error).includes(CONNECTOR_COPY.cancelledProductOff("Gmail")) && routesOf(await googleSince(gm), "gmail.messages.send").length === 0, r.results);
  }
  s = await shot(max, "/agents", "p3-picker-gmail-off.png", openNewTeammate);
  check("the New teammate picker has no Gmail rows while it is off (p3-picker-gmail-off.png)", s.acted === true && shows(s.text, ["Read your Google Calendar"], ["Search your Gmail"]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  s = await shot(max, "/account/connections#ai-google", "p3-connections-gmail-off.png");
  check("Max's card says an Owner or Admin turned Gmail off (p3-connections-gmail-off.png)", shows(s.text, [CONNECTIONS_COPY.productTurnedOff("Gmail", ws)]) && s.exceptions.length === 0, s.exceptions);
  const backOn = await olivia.json("PUT", "/api/teammate-connections/policy", { gmail: true, organizationId: org.id });
  check("Olivia turns Gmail back on", backOn.status === 200 && backOn.body.on?.gmail === true, backOn);

  // ── Step 4: Google Calendar ───────────────────────────────────────
  step = "4 Calendar reads";
  const planner = await teammate(max, { name: "Planner", job: "Keeps Max's calendar", visibility: "PRIVATE", toolNames: ["list_events", "find_free_time", "create_event", "update_event", "cancel_event", "respond_to_invite"] });
  t = await say(max, planner.slug, "what's on my calendar this week");
  const listData = toolData(lastResult(t.model, "list_events"));
  check(
    "list_events reads the four events in the calendar's own zone, with the note",
    t.results.some((r) => r.name === "list_events" && r.state === "ran") &&
      listData?.count === 4 &&
      listData?.window?.zone === ZONE &&
      (listData?.events ?? []).some((e: Json) => e.eventId === "e-team" && e.organizer?.self === true) &&
      String(listData?.note ?? "").includes(CONNECTOR_COPY.calendarNote),
    listData,
  );
  check(
    "Max chose no zone, so his Google Calendar's own was read (the events list's timeZone), then the list in it",
    routesOf(t.google, "calendar.events.zone").length === 1 && routesOf(t.google, "calendar.events.list").some((e) => e.timeZone === ZONE),
    t.google.map((e) => [e.route, e.timeZone]),
  );
  answer = await lastAnswer(planner.id, max.id);
  calls = (answer?.toolCalls ?? []) as Json[];
  check("the chat keeps { count: 4 } only", JSON.stringify(calls[0]?.result) === JSON.stringify({ count: 4 }) && calls[0]?.input === null, calls[0]);
  s = await shot(max, `/agents?chat=${planner.slug}`, "p3-calendar-list.png");
  check("the tool row reads Looked at 4 of your events (p3-calendar-list.png)", shows(s.text, ["Looked at 4 of your events"]) && s.exceptions.length === 0, s.exceptions);

  t = await say(max, planner.slug, `find 30 minutes with mia@proof.test on ${D}`);
  const freeData = toolData(lastResult(t.model, "find_free_time"));
  const fb = routesOf(t.google, "calendar.freeBusy")[0];
  const busy: Array<[string, string]> = [...(fb?.busyLocal?.primary ?? []), ...(fb?.busyLocal?.["mia@proof.test"] ?? [])];
  const slots: Array<{ start: string; end: string }> = freeData?.slots ?? [];
  check(
    "find_free_time reads both calendars and finds times outside every busy block, in working hours",
    freeData?.count > 0 &&
      JSON.stringify(freeData?.checked) === JSON.stringify(["mia@proof.test"]) &&
      (freeData?.couldNotRead ?? []).length === 0 &&
      busy.length >= 5 &&
      slots.every((x) => x.start.startsWith(D) && x.start >= `${D}T09:00` && x.end <= `${D}T18:00` && busy.every(([bs, be]) => !(x.start < be && bs < x.end))),
    { slots, busy },
  );
  t = await say(max, planner.slug, `find 30 minutes with outsider@ext.test on ${D}`);
  check(
    "an outsider's calendar is never read: notMember, and no free/busy call",
    t.results.some((r) => r.name === "find_free_time" && r.state === "failed") && String(lastResult(t.model, "find_free_time")).includes(CONNECTOR_COPY.notMember("outsider@ext.test")) && routesOf(t.google, "calendar.freeBusy").length === 0,
    t.results,
  );
  t = await say(max, planner.slug, `find 30 minutes with lea@proof.test on ${D}`);
  const leaData = toolData(lastResult(t.model, "find_free_time"));
  check("Lea, who does not share, is named as unread, and the note says so", JSON.stringify(leaData?.couldNotRead) === JSON.stringify(["lea@proof.test"]) && String(leaData?.note ?? "").includes(CONNECTOR_COPY.freeBusyUnread), leaData);

  step = "4 Calendar writes";
  await settle(max, planner.slug);
  t = await say(max, planner.slug, `add event 'Focus' at ${D}T15:00 to ${D}T16:00`);
  let inserts = routesOf(t.google, "calendar.events.insert");
  check("an event with nobody else on it is added at once, no card", t.results.some((r) => r.name === "create_event" && r.state === "ran") && t.approvals.length === 0, t.results);
  check("with sendUpdates=none, at 15:00 on the calendar's clock", inserts.length === 1 && inserts[0].sendUpdates === "none" && inserts[0].startLocal === `${D}T15:00` && inserts[0].endLocal === `${D}T16:00` && inserts[0].attendees.length === 0, inserts);

  t = await say(max, planner.slug, `add event 'Kickoff' at ${D}T16:30 to ${D}T17:00 with mia@proof.test`);
  const invite = t.approvals.find((a) => a.toolName === "create_event");
  check(
    "inviting Mia waits on its own card: who is invited, that Google emails them, inside the workspace",
    Boolean(invite) && invite?.risk === "IRREVERSIBLE" && invite?.always?.allowed === false && shows(linesOf(invite).join("\n"), [CONNECTOR_COPY.invitesLine("mia@proof.test"), CONNECTOR_COPY.googleEmailsInvites, CONNECTOR_COPY.outsideLine(0), "When: "]),
    invite,
  );
  check("nothing is added before the approval", routesOf(t.google, "calendar.events.insert").length === 0);
  s = await shot(max, `/agents?chat=${planner.slug}`, "p3-calendar-invite-card.png");
  check("the invitation card in the chat (p3-calendar-invite-card.png)", shows(s.text, [CONNECTOR_COPY.invitesLine("mia@proof.test"), "Waiting for you"]) && s.exceptions.length === 0, s.exceptions);
  if (invite) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: invite.id }]);
    inserts = routesOf(await googleSince(gm), "calendar.events.insert");
    check("approved: added with sendUpdates=all, inviting Mia", approved.results[0]?.status === "EXECUTED" && inserts.length === 1 && inserts[0].sendUpdates === "all" && JSON.stringify(inserts[0].attendees) === JSON.stringify(["mia@proof.test"]) && inserts[0].startLocal === `${D}T16:30`, inserts);
    await continueAfter(max, approved);
  }

  t = await say(max, planner.slug, "cancel event e-team");
  const cancel1 = t.approvals.find((a) => a.toolName === "cancel_event");
  check(
    "cancelling e-team waits: Google tells 2 people, each named, 1 outside the workspace",
    Boolean(cancel1) && cancel1?.risk === "IRREVERSIBLE" && shows(linesOf(cancel1).join("\n"), [CONNECTOR_COPY.tellsCancelled(2), CONNECTOR_COPY.toldLine("mia@proof.test, outsider@ext.test"), CONNECTOR_COPY.outsideLine(1)]),
    cancel1,
  );
  s = await shot(max, `/agents?chat=${planner.slug}`, "p3-calendar-cancel-card.png");
  check("the cancel card in the chat (p3-calendar-cancel-card.png)", shows(s.text, [CONNECTOR_COPY.tellsCancelled(2)]) && s.exceptions.length === 0, s.exceptions);
  await googleControl("touch-event?id=e-team");
  if (cancel1) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: cancel1.id }]);
    check("the event changed at Google meanwhile: FAILED, eventChanged, nothing deleted", approved.results[0]?.status === "FAILED" && String(approved.results[0]?.error).includes(CONNECTOR_COPY.eventChanged) && routesOf(await googleSince(gm), "calendar.events.delete").length === 0, approved.results);
    await continueAfter(max, approved);
  }
  t = await say(max, planner.slug, "cancel event e-team");
  const cancel2 = t.approvals.find((a) => a.toolName === "cancel_event");
  if (cancel2) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: cancel2.id }]);
    const deletes = routesOf(await googleSince(gm), "calendar.events.delete");
    check("asked again and approved: deleted, telling everyone, under the etag it read", approved.results[0]?.status === "EXECUTED" && deletes.length === 1 && deletes[0].sendUpdates === "all" && deletes[0].ifMatch === deletes[0].etagNow && deletes[0].status === 204, deletes);
    await continueAfter(max, approved);
  } else check("the second cancel's card", false, t.results);

  t = await say(max, planner.slug, "accept invite e-invite");
  const answerCard = t.approvals.find((a) => a.toolName === "respond_to_invite");
  check("answering the invite always waits: the organizer sees it", Boolean(answerCard) && answerCard?.risk === "IRREVERSIBLE" && linesOf(answerCard).includes(CONNECTOR_COPY.organizerSees("Bea Boss")), answerCard);
  if (answerCard) {
    gm = await googleMark();
    const approved = await decide(max, [{ id: answerCard.id }]);
    const patches = routesOf(await googleSince(gm), "calendar.events.patch");
    check(
      "approved: only Max's own entry is sent, with attendeesOmitted, telling the organizer, under the etag",
      approved.results[0]?.status === "EXECUTED" &&
        patches.length === 1 &&
        JSON.stringify(patches[0].body?.attendees) === JSON.stringify([{ email: "max@proof.test", responseStatus: "accepted" }]) &&
        patches[0].body?.attendeesOmitted === true &&
        patches[0].sendUpdates === "all" &&
        patches[0].ifMatch === patches[0].etagNow,
      patches,
    );
    const evs = (await googleGet("/__stand-in/events")).calendars?.["max@proof.test"] ?? [];
    const inv = evs.find((e: Json) => e.id === "e-invite");
    check("at Google: Max accepted, the organizer still on it", inv?.attendees?.length === 2 && inv.attendees.find((a: Json) => a.email === "max@proof.test")?.responseStatus === "accepted" && inv.attendees.some((a: Json) => a.email === "boss@ext.test"), inv);
    await continueAfter(max, approved);
  }

  t = await say(max, planner.slug, "cancel event e-boss");
  check(
    "cancelling someone else's event is refused: notOrganizer, no card, nothing deleted",
    t.approvals.length === 0 && String(lastResult(t.model, "cancel_event")).includes(CONNECTOR_COPY.notOrganizer) && routesOf(t.google, "calendar.events.delete").length === 0,
    t.results,
  );

  step = "4 the zone Max chose";
  const prefsBefore = await prisma.userPreference.findUnique({ where: { userId: max.id } });
  const ownZone = "Asia/Kolkata";
  await prisma.userPreference.upsert({
    where: { userId: max.id },
    create: { userId: max.id, home: { locale: { timezone: ownZone } } },
    update: { home: { ...((prefsBefore?.home as Json) ?? {}), locale: { ...(((prefsBefore?.home as Json) ?? {}).locale ?? {}), timezone: ownZone } } },
  });
  t = await say(max, planner.slug, "what's on my calendar this week");
  const zoned = toolData(lastResult(t.model, "list_events"));
  check(
    "with a zone of his own, that zone is used and Google's is not read",
    zoned?.window?.zone === ownZone && routesOf(t.google, "calendar.events.zone").length === 0 && routesOf(t.google, "calendar.events.list").some((e) => e.timeZone === ownZone),
    { window: zoned?.window, routes: t.google.map((e) => e.route) },
  );
  // Back as it was (an empty home where there was none: the same to every reader), so Max's zone is his calendar's again.
  if (prefsBefore) await prisma.userPreference.update({ where: { userId: max.id }, data: { home: ((prefsBefore.home as Json | null) ?? {}) as never } });
  else await prisma.userPreference.delete({ where: { userId: max.id } }).catch(() => undefined);

  // ── Step 5: where tools run, the picker, privacy ─────────────────
  step = "5 Talk";
  if (w.proofChannel) {
    const mm = modelMark();
    gm = await googleMark();
    const talk = await max.sse(`/api/conversations/${w.proofChannel}/teammates`, { body: "@Inbox helper search my email for invoice", teammate: inbox.slug, clientId: `p3${RUN}t1` });
    const entries = modelSince(mm).filter((e) => systemOf(e).includes(INBOX_JOB));
    check(
      "the Inbox helper answering in #proof is offered no Google tool, and block 2 says why",
      talk.status === 200 && entries.length > 0 && entries.every((e) => toolsOfEntry(e).every((n) => !CONNECTOR_TOOLS.includes(n))) && systemOf(entries[0]).includes("Your Gmail tools aren't available here: your answer is posted for everyone in the conversation."),
      { status: talk.status, refusal: talk.refusal, tools: entries[0] ? toolsOfEntry(entries[0]) : null },
    );
    check("and Gmail was not touched", (await googleSince(gm)).filter((e) => String(e.route).startsWith("gmail.")).length === 0);
  } else check("Talk is installed for the Talk turn (run scripts/seed-products.ts)", false);

  step = "5 an automation";
  const space = await olivia.json("POST", "/api/spaces", { name: `Proof ${RUN}`, visibility: "ORG" });
  const spaceId: string | undefined = space.body.space?.id ?? space.body.id;
  const board = spaceId ? await prisma.board.findFirst({ where: { spaceId }, select: { id: true } }) : null;
  if (spaceId && board) {
    await olivia.json("POST", `/api/spaces/${spaceId}/members`, { userId: max.id, role: "MEMBER" });
    const wf = await max.json("POST", "/api/automation/workflows", {
      name: "Max asks his inbox helper",
      definition: { trigger: "task.created", scope: { listIds: [board.id] }, actions: [{ key: "ask_teammate", params: { teammate: inbox.slug, request: "search my email for {{title}}" } }] },
    });
    const wfId: string | undefined = wf.body.workflow?.id;
    const pub = wfId ? await max.json("POST", `/api/automation/workflows/${wfId}/publish`) : null;
    check("Max publishes an automation that asks his Inbox helper", wf.status === 201 && (pub?.status === 200 || pub?.status === 201), { wf: wf.status, pub: pub?.status });
    const mm = modelMark();
    gm = await googleMark();
    await max.json("POST", `/api/boards/${board.id}/items`, { title: "invoice" });
    const run = wfId
      ? await until(
          () => prisma.automationRun.findFirst({ where: { workflowId: wfId }, orderBy: { startedAt: "desc" }, select: { status: true } }),
          (r) => Boolean(r) && r!.status !== "RUNNING",
          60_000,
        )
      : null;
    const entries = modelSince(mm).filter((e) => systemOf(e).includes(INBOX_JOB));
    check(
      "its turn is offered no Google tool, and block 2 says why",
      Boolean(run) && entries.length > 0 && entries.every((e) => toolsOfEntry(e).every((n) => !CONNECTOR_TOOLS.includes(n))) && systemOf(entries[0]).includes("Your Gmail tools aren't available here: your answer goes to fields other people read."),
      { run: run?.status, tools: entries[0] ? toolsOfEntry(entries[0]) : null },
    );
    check("and Gmail was not touched", (await googleSince(gm)).filter((e) => String(e.route).startsWith("gmail.")).length === 0);
  } else check("Olivia makes a Space with its first List", false, space);

  step = "5 a teammate that asks";
  const chief = await teammate(max, { name: "Chief of Staff", job: "Runs Max's day", visibility: "PRIVATE", toolNames: ["search_tasks", "ask_teammate"] });
  t = await say(max, chief.slug, "ask Inbox helper to search my email for invoice");
  const delegate = t.model.filter((e) => JSON.stringify(e.messages ?? []).includes("<teammate_request>"));
  check(
    "the Inbox helper asked by another teammate is offered no Google tool, and block 2 says why",
    t.results.some((r) => r.name === "ask_teammate") && delegate.length > 0 && delegate.every((e) => toolsOfEntry(e).every((n) => !CONNECTOR_TOOLS.includes(n))) && systemOf(delegate[0]).includes("Your Gmail tools aren't available here: your answer goes back to the teammate that asked; the person can ask you directly."),
    { results: t.results, tools: delegate[0] ? toolsOfEntry(delegate[0]) : null },
  );
  check("and Gmail was not touched", t.google.filter((e) => String(e.route).startsWith("gmail.")).length === 0);

  step = "5 the picker and privacy";
  s = await shot(olivia, "/agents", "p3-picker-connect-first.png", openNewTeammate);
  check(
    "Olivia, not connected: the picker's Google rows say Connect Google first, with Connect (p3-picker-connect-first.png)",
    s.acted === true && shows(s.text, [TOOL_PICKER_NOTES.connect_first, TOOL_PICKER_NOTES.link.connect_first, "Search your Gmail"]) && s.exceptions.length === 0,
    { acted: s.acted, exceptions: s.exceptions },
  );
  s = await shot(max, "/agents", "p3-picker-ready.png", openNewTeammate);
  check("Max, connected: Uses your own Google account (p3-picker-ready.png)", s.acted === true && shows(s.text, [TOOL_PICKER_NOTES.ready, "Search your Gmail"]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  s = await shot(max, `/agents?chat=${inbox.slug}&settings=tools`, "p3-drawer-tools.png", showGoogleRows);
  check("the Inbox helper's Tools and approvals tab (p3-drawer-tools.png)", s.acted === true && shows(s.text, [TOOL_PICKER_NOTES.ready, "Send emails from your Gmail", "Always asks first"]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  s = await shot(max, "/privacy", "p3-privacy.png");
  check(
    "the privacy page says what a teammate does with Google, and Google's Limited Use sentence (p3-privacy.png)",
    shows(s.text, ["connect your own Google account to your AI teammates", "Google API Services User Data Policy", "Limited Use"]) && s.exceptions.length === 0,
    s.exceptions,
  );

  // ── Step 6: the Tools tab's one change, Disconnect everyone, scale ─
  step = "6 the Tools tab tick";
  // Another tab removes read_email after this one was read; this one, still
  // showing it ticked, unticks draft_email. Its PATCH must carry that one
  // change, and read_email must stay removed (review of step 5).
  const tick = `(async () => {
    const w = (ms) => new Promise((r) => setTimeout(r, ms));
    const box = (label) => document.querySelector('input[type="checkbox"][aria-label=' + JSON.stringify(label) + ']');
    const other = await fetch(${JSON.stringify(`/api/agents/teammates/${inbox.slug}`)}, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolChanges: { remove: ["read_email"] } }) });
    if (!other.ok) return { ok: false, why: "the other tab's change failed: " + other.status };
    const read = box("Read your Gmail");
    const draft = box("Draft emails in your Gmail");
    if (!draft) return { ok: false, why: "no Draft emails box" };
    if (!draft.checked) return { ok: false, why: "Draft emails was not ticked" };
    const stale = Boolean(read && read.checked);
    draft.click();
    await w(2500);
    return { ok: true, stale };
  })()`;
  s = await shot(max, `/agents?chat=${inbox.slug}&settings=tools`, "p3-tools-tab-tick.png", tick);
  const acted = (s.acted ?? {}) as Json;
  const patches = s.requests.filter((r) => r.method === "PATCH" && r.url.endsWith(`/api/agents/teammates/${inbox.slug}`));
  const own = patches.map((r) => r.body).filter((b) => b && !b.includes("read_email"));
  check("the tab unticks Draft emails while it still shows Read your Gmail ticked (p3-tools-tab-tick.png)", acted.ok === true && s.exceptions.length === 0, { acted, exceptions: s.exceptions });
  check("its PATCH carries that one change, never the whole list", own.length === 1 && JSON.stringify(JSON.parse(own[0] ?? "{}")) === JSON.stringify({ toolChanges: { remove: ["draft_email"] } }), patches);
  const toolsNow = ((await prisma.agent.findUnique({ where: { id: inbox.id }, select: { toolNames: true } }))?.toolNames ?? []) as string[];
  check(
    `the stored tools lose draft_email, and read_email stays removed${acted.stale ? " though the tab still showed it" : ""}`,
    !toolsNow.includes("draft_email") && !toolsNow.includes("read_email") && ["search_email", "send_email", "reply_email", "create_task"].every((n) => toolsNow.includes(n)),
    toolsNow,
  );

  step = "6 Disconnect everyone";
  s = await shot(max, "/account/connections#ai-google", "p3-connections-disconnect-dialog.png", clickButton(CONNECTIONS_COPY.disconnect));
  check("Max's Disconnect asks first, saying what it ends (p3-connections-disconnect-dialog.png)", s.acted === true && shows(s.text, [CONNECTIONS_COPY.disconnectTitle, CONNECTIONS_COPY.disconnectBody]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  const counts = await olivia.json("GET", "/api/teammate-connections/policy");
  check("Olivia reads counts only: 2 connected, 1 with Gmail, 2 with Google Calendar", counts.status === 200 && counts.body.counts?.connected === 2 && counts.body.counts?.gmail === 1 && counts.body.counts?.calendar === 2 && !JSON.stringify(counts.body).includes("@proof.test"), counts.body);
  s = await shot(olivia, "/settings/apps#ai-google", "p3-apps-counts.png");
  check("Apps & modules shows the counts (p3-apps-counts.png)", shows(s.text, [CONNECTOR_POLICY_COPY.counts(2, 1, 2), CONNECTOR_POLICY_COPY.disconnectAll]) && s.exceptions.length === 0, s.exceptions);
  s = await shot(olivia, "/settings/apps#ai-google", "p3-apps-disconnect-all-dialog.png", clickButton(CONNECTOR_POLICY_COPY.disconnectAll));
  check("Disconnect everyone asks first (p3-apps-disconnect-all-dialog.png)", s.acted === true && shows(s.text, [CONNECTOR_POLICY_COPY.disconnectAllTitle, CONNECTOR_POLICY_COPY.disconnectAllBody]) && s.exceptions.length === 0, { acted: s.acted, exceptions: s.exceptions });
  const unconfirmed = await olivia.json("POST", "/api/teammate-connections/policy/disconnect-all", { organizationId: org.id });
  check("without the confirm it is refused: confirm_needed", unconfirmed.status === 400 && unconfirmed.body.code === "confirm_needed", unconfirmed);
  gm = await googleMark();
  const all = await olivia.json("POST", "/api/teammate-connections/policy/disconnect-all", { confirm: "disconnect", organizationId: org.id });
  check("with it: disconnected 2", all.status === 200 && all.body.disconnected === 2, all);
  check("no connection is left in the workspace", (await prisma.teammateConnection.count({ where: { organizationId: org.id } })) === 0);
  const notices = await until(
    () => prisma.notification.findMany({ where: { userId: { in: [max.id, mia.id] }, type: "agent_connection", title: CONNECTIONS_COPY.disconnectedByAdminTitle }, select: { userId: true } }),
    (r) => r.length >= 2,
  );
  check("Max and Mia each get an Inbox row", new Set(notices.map((n) => n.userId)).size === 2, notices);
  const allAudits = await until(() => audits(org.id, "teammate_connection.disconnected"), (r) => r.filter((a) => (a.metadata as Json)?.reason === "admin_all").length >= 2);
  const adminAudit = await until(() => audits(org.id, "teammate_connectors.disconnected_all"), (r) => r.length >= 1);
  check("one audit row per person and one for Olivia, counts only", allAudits.filter((a) => (a.metadata as Json)?.reason === "admin_all").length === 2 && adminAudit.length === 1 && (adminAudit[0].metadata as Json)?.count === 2 && adminAudit[0].actorId === olivia.id, { allAudits, adminAudit });
  const revokes = routesOf(await googleSince(gm), "oauth.revoke");
  check("both grants are revoked at Google", ["sub-max", "sub-partial"].every((sub) => revokes.some((e) => e.sub === sub && e.outcome === "revoked")), revokes.map((e) => [e.sub, e.outcome]));
  // Review round 1 ends a person's allows with their connection, so a later
  // connect starts with nothing allowed. Checked where the code does it.
  if (/\bclearAllows\(/.test(readFileSync(join(process.cwd(), "src/lib/connectors/connections.ts"), "utf8"))) {
    const kept = await prisma.agentPersonSetting.findUnique({ where: { agentId_userId: { agentId: ops.id, userId: max.id } }, select: { connectorProducts: true, connectorPrints: true } });
    check("Max's allow of Ops ended with his connection", (kept?.connectorProducts ?? []).length === 0 && (kept?.connectorPrints ?? null) === null, kept);
  }
  s = await shot(olivia, "/settings/apps#ai-google", "p3-apps-after-disconnect-all.png");
  check("Apps & modules: nobody connected (p3-apps-after-disconnect-all.png)", shows(s.text, [CONNECTOR_POLICY_COPY.noneConnected]) && s.exceptions.length === 0, s.exceptions);
  s = await shot(max, "/account/connections#ai-google", "p3-connections-after-disconnect-all.png");
  check("Max's card offers Connect again (p3-connections-after-disconnect-all.png)", shows(s.text, [CONNECTIONS_COPY.pickProducts, CONNECTIONS_COPY.gmailHint], ["Connected as max@proof.test"]) && s.exceptions.length === 0, s.exceptions);

  step = "6 the leaver sweep at scale";
  await leaverSweepAtScale(org.id);
}

/**
 * EXPLAIN ANALYZE of the sweep's leaver query (connections.ts LEAVERS_WHERE,
 * read from the source so the proof measures the query the cron runs) over
 * 100,000 connections seeded in the throwaway workspace: 10,000 of their
 * people anchored in a second workspace, 2,000 of those with no membership
 * here (leavers), and 1,000 INACTIVE. All of it inside one transaction that
 * is rolled back, so no tick or reader ever sees a seeded row, and the
 * statistics ANALYZE wrote go with it.
 */
async function leaverSweepAtScale(orgId: string): Promise<void> {
  const source = readFileSync(join(process.cwd(), "src/lib/connectors/connections.ts"), "utf8");
  const m = /const LEAVERS_WHERE = Prisma\.sql`([\s\S]*?)`;/.exec(source);
  if (!check("the sweep's leaver query is read from connections.ts", Boolean(m), "LEAVERS_WHERE not found")) return;
  const where = m![1];
  const N = 100_000;
  class Rollback extends Error {
    constructor(readonly payload: { plan: string[]; leavers: number; seeded: number; ms: number }) {
      super("rollback");
    }
  }
  const t0 = Date.now();
  let out: Rollback["payload"] | null = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        const other = await tx.organization.create({ data: { name: `Phase 3 proof ${RUN} elsewhere`, slug: `p3-proof-${RUN}-elsewhere`, plan: "GROWTH", status: "ACTIVE", settings: {} } });
        await tx.$executeRawUnsafe(
          `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "organizationId", "status", "createdAt", "updatedAt", "joinDate")
           SELECT 'p3seed_u_' || g, 'seed' || g || '@p3-seed.local', 'x', 'Seed', 'Person',
                  CASE WHEN g % 10 = 0 THEN $2 ELSE $1 END,
                  CASE WHEN g % 100 = 1 THEN 'INACTIVE'::"UserStatus" ELSE 'ACTIVE'::"UserStatus" END,
                  now(), now(), now()
             FROM generate_series(1, ${N}) g`,
          orgId,
          other.id,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "isPrimary", "createdAt", "updatedAt")
           SELECT 'p3seed_m_' || g, 'p3seed_u_' || g, $1, 'EMPLOYEE'::"AccessLevel", false, now(), now()
             FROM generate_series(1, ${N}) g WHERE g % 10 = 0 AND g % 50 <> 0`,
          orgId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "TeammateConnection" ("id", "organizationId", "userId", "provider", "status", "products", "scopes", "accountSub", "accountEmail",
                                             "refreshTokenSealed", "tokenVersion", "connectedAt", "createdAt", "updatedAt", "accountKey")
           SELECT 'p3seed_c_' || g, $1, 'p3seed_u_' || g, 'google', 'active', ARRAY['gmail', 'calendar']::text[], ARRAY[]::text[],
                  'p3seed-sub-' || g, 'seed' || g || '@p3-seed.local', '{"v":1,"iv":"x","ct":"x","tag":"x"}'::jsonb, 1, now(), now(), now(), md5('p3seed' || g)
             FROM generate_series(1, ${N}) g`,
          orgId,
        );
        // The planner reads the tables as they now are, as it would in production.
        for (const table of ["User", "OrganizationMembership", "TeammateConnection"]) await tx.$executeRawUnsafe(`ANALYZE "${table}"`);
        const seeded = Number((await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "TeammateConnection" WHERE "id" LIKE 'p3seed_c_%'`))[0]?.n ?? 0);
        // The statement removeConnections runs per chunk: 500 at a time.
        const rows = await tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(`EXPLAIN (ANALYZE, BUFFERS) SELECT "id" FROM "TeammateConnection" WHERE ${where} LIMIT 500`);
        const leavers = Number((await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "TeammateConnection" WHERE ${where} AND "id" LIKE 'p3seed_c_%'`))[0]?.n ?? 0);
        const plan = rows.map((r) => String(r["QUERY PLAN"]));
        const time = /Execution Time: ([\d.]+) ms/.exec(plan.join("\n"));
        throw new Rollback({ plan, leavers, seeded, ms: time ? Number(time[1]) : Number.NaN });
      },
      { timeout: 600_000, maxWait: 30_000 },
    );
  } catch (err) {
    if (err instanceof Rollback) out = err.payload;
    else check("the 100,000 connections are seeded and measured", false, err instanceof Error ? err.message : String(err));
  }
  if (!out) return;
  console.log(`         EXPLAIN ANALYZE of the leaver sweep (seeded and measured in ${Math.round((Date.now() - t0) / 1000)} s):\n${out.plan.map((l) => `           ${l}`).join("\n")}`);
  check("100,000 connections were seeded in the throwaway workspace", out.seeded === 100_000, out.seeded);
  check("the leaver query finds exactly the 3,000 seeded leavers (1,000 INACTIVE, 2,000 gone from the workspace)", out.leavers === 3_000, out.leavers);
  check(`one 500-row chunk of it runs in under 5 s (${out.ms} ms)`, Number.isFinite(out.ms) && out.ms < 5_000, out.ms);
  // A scan of the membership or person table repeated per connection is the
  // shape that grows with the platform; an index probe or one hash is not.
  check(
    "no table is scanned again for each connection: memberships and people are read by index or hashed once",
    !out.plan.some((l) => /Seq Scan on "(OrganizationMembership|User)"/.test(l) && /loops=(\d+)/.test(l) && Number(/loops=(\d+)/.exec(l)![1]) > 1),
    out.plan,
  );
  const left = await prisma.teammateConnection.count({ where: { id: { startsWith: "p3seed_c_" } } });
  check("the transaction rolled back: no seeded row is left", left === 0 && (await prisma.user.count({ where: { id: { startsWith: "p3seed_u_" } } })) === 0, left);
}

async function proveAndCleanUp(): Promise<number> {
  let failedHard: unknown = null;
  try {
    await main();
  } catch (err) {
    failedHard = err;
    check("the proof ran to the end", false, err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.slice(0, 1200) : String(err));
  } finally {
    if (process.env.KEEP === "1") {
      console.log(`KEEP=1: workspace kept (${orgIds.join(", ")}). Delete it by hand.`);
    } else {
      step = "cleanup";
      try {
        await deleteWorkspaces();
        const left = await prisma.organization.count({ where: { id: { in: orgIds } } });
        check("the throwaway workspace is deleted", left === 0, { left });
      } catch (err) {
        check("the throwaway workspace is deleted", false, err instanceof Error ? err.message : String(err));
      }
    }
    await prisma.$disconnect();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ""}. Screenshots: ${SHOTS}`);
  return failed.length || failedHard ? 1 : 0;
}

void proveAndCleanUp().then((code) => process.exit(code));
