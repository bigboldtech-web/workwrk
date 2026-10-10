// The live proof of AI teammates Phase 2 (docs/plans/ai-teammates-phase2.md
// step 8): steps 2 to 7 chained on one throwaway GROWTH workspace, driven
// over HTTP as the people who would use them, with the rows checked in the
// database after each, and the UI of steps 4 (group chats) and 6 (Talk)
// walked with a screenshot of each state. The workspace is deleted at the
// end, also when a check fails (KEEP=1 keeps it to look at).
//
// LOCAL ONLY. It refuses any database but Postgres on this machine
// (localhost:5432, as scripts/require-local-db.mjs). Run, in three terminals:
//
//   node scripts/ai-stand-in-model.mjs 8787
//   ANTHROPIC_API_KEY=stand-in ANTHROPIC_BASE_URL=http://127.0.0.1:8787 CRON_SECRET=<any> npx next dev -p 3016
//   BASE=http://localhost:3016 CRON_SECRET=<the same> npx tsx scripts/live-proof-ai-teammates-phase2.ts
//
// SHOTS=<folder> says where the screenshots go (default: the system temp
// folder); CHROME=<path> picks the browser (default: the Chrome app, else
// the newest chrome-headless-shell under ~/.cache/chrome-headless, installed
// with "npx @puppeteer/browsers install chrome-headless-shell@stable --path
// ~/.cache/chrome-headless"). Workspaces an earlier run left behind (slug
// p2-proof-*) are deleted first.
//
// The cron ticks it sends act on the whole local database, as a real tick
// does: other local workspaces' due routines run and their old schedules move.
//
// People: Owner Olivia, Member Max, Manager Mia, and Gil, a Guest (his
// stored role, which "Guests here" checks read).

import { config } from "dotenv";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { scriptPrisma } from "./lib/script-prisma";

// .env.local only: a repo's .env can point at another database (the main
// tree's points at the production tunnel), and dotenv never lets a later file
// override an earlier one, so loading it after would fill any gap from there.
config({ path: ".env.local" });

// ── Local only ──────────────────────────────────────────────────────

function refuseUnlessLocal(): void {
  // Every database address that is set must be this machine's: the client
  // reads DATABASE_URL (scripts/lib/script-prisma.ts), so a local DIRECT_URL
  // beside a remote DATABASE_URL is refused too.
  if (!process.env.DATABASE_URL) {
    console.error("Refused: DATABASE_URL is not set (this proof reads .env.local only).");
    process.exit(1);
  }
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = process.env[name];
    if (!raw) continue;
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
const CRON_SECRET = process.env.CRON_SECRET || "";
if (!CRON_SECRET) {
  console.error("Set CRON_SECRET to the dev server's value (the proof ticks the cron).");
  process.exit(1);
}
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), "p2-proof-shots-"));
mkdirSync(SHOTS, { recursive: true });
const prisma = scriptPrisma();
const RUN = Date.now().toString(36);
const PASSWORD = `Proof-${RUN}-pw!`;

// ── Checks ──────────────────────────────────────────────────────────

const results: Array<{ step: string; name: string; ok: boolean; detail?: string }> = [];
let step = "setup";

function check(name: string, ok: boolean, detail?: unknown): boolean {
  const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600);
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

  /** A streamed answer: every `data:` event, in order, or the JSON refusal sent instead. */
  async sse(path: string, body: unknown): Promise<{ status: number; events: Json[]; refusal: Json | null }> {
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

type Shot = { exceptions: string[]; acted: unknown; text: string };

/**
 * Open `path` as `who`, let it settle, optionally run `act` in the page (a
 * click) or type `type` into its message box (as keystrokes would), and save
 * a screenshot. Answers the page's own exceptions, so a state that throws
 * fails its check, and the page's visible text, so a check can say what is
 * on screen.
 */
async function shot(who: Person, path: string, file: string, act?: string, type?: string): Promise<Shot> {
  try {
    return await shotOnce(who, path, file, act, type);
  } catch (err) {
    return { exceptions: [`screenshot failed: ${err instanceof Error ? err.message : String(err)}`], acted: null, text: "" };
  }
}

async function shotOnce(who: Person, path: string, file: string, act?: string, type?: string): Promise<Shot> {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "p2-proof-chrome-"));
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
    if (type) {
      const focus = `(() => { const el = document.querySelector("textarea") || document.querySelector('[contenteditable="true"]'); if (!el) return false; el.focus(); return true; })()`;
      const r = await rpc("Runtime.evaluate", { expression: focus, returnByValue: true }, sessionId);
      acted = r.result?.value ?? null;
      await rpc("Input.insertText", { text: type }, sessionId);
      await sleep(2000);
    }
    const seen = await rpc("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true }, sessionId);
    const text = String(seen.result?.value ?? "");
    const { data } = await rpc("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(SHOTS, file), Buffer.from(data, "base64"));
    const exceptions = events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => String(e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text ?? "exception").slice(0, 300));
    return { exceptions, acted, text };
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
  }
}

/** A page expression: open the menu behind the button `menu`, then click its item matching `item`. */
const clickMenuItem = (menu: string, item: RegExp) =>
  `(async () => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === ${JSON.stringify(menu)}); if (!b) return "no " + ${JSON.stringify(menu)}; b.click(); await new Promise((r) => setTimeout(r, 700)); const i = [...document.querySelectorAll("button, [role=menuitem]")].find((x) => ${item.toString()}.test(x.textContent || "")); if (!i) return "no item"; i.click(); return true; })()`;

/** A page expression: click the first button whose text is `label`, answering whether one was found. */
const clickButton = (label: string) =>
  `(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;

// ── The workspace ───────────────────────────────────────────────────

const orgIds: string[] = [];

async function makeWorkspace() {
  const leftOver = await prisma.organization.findMany({ where: { slug: { startsWith: "p2-proof-" } }, select: { id: true } });
  if (leftOver.length > 0) {
    orgIds.push(...leftOver.map((o) => o.id));
    await deleteWorkspaces();
    orgIds.length = 0;
    console.log(`Deleted ${leftOver.length} workspace(s) an earlier run left behind.`);
  }
  const org = await prisma.organization.create({
    data: { name: `Phase 2 proof ${RUN}`, slug: `p2-proof-${RUN}`, plan: "GROWTH", status: "ACTIVE", settings: {} },
  });
  orgIds.push(org.id);
  const hash = await bcrypt.hash(PASSWORD, 12);
  const person = async (firstName: string, lastName: string, accessLevel: string, orgRole?: string) => {
    const email = `${firstName.toLowerCase()}.${RUN}@p2-proof.local`;
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

  // Talk is a module: installed here, as Settings, Modules does.
  const talk = await prisma.product.findFirst({ where: { slug: "workwrk-talk" }, select: { id: true } });
  if (!talk) throw new Error('The Talk product row (slug "workwrk-talk") is missing locally: run scripts/seed-products.ts first.');
  await prisma.productInstallation.create({ data: { organizationId: org.id, productId: talk.id, status: "ACTIVE" } });

  // Talk places: a private channel with Olivia, Max and Mia; a public one;
  // and a private one Gil, a Guest, is in.
  const channel = async (name: string, restricted: boolean, members: Person[]) => {
    const c = await prisma.conversation.create({ data: { organizationId: org.id, type: "CHANNEL", name, createdById: olivia.id, restricted } });
    for (const m of members) await prisma.conversationMember.create({ data: { conversationId: c.id, userId: m.id } });
    return c.id;
  };
  const proofChannel = await channel("proof", true, [olivia, max, mia]);
  const generalChannel = await channel("general", false, [olivia, max, mia]);
  const guestChannel = await channel("with-gil", true, [max, gil]);

  for (const p of [olivia, max, mia, gil]) await p.signIn();
  return { org, olivia, max, mia, gil, proofChannel, generalChannel, guestChannel };
}

async function deleteWorkspaces(): Promise<void> {
  // The order the hard-delete cron uses (src/app/api/cron/org-hard-delete/route.ts):
  // the tables whose rows hold restricting links first, then the company
  // (most rows cascade), then the tables with no link back to it.
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
}

// ── The proof ───────────────────────────────────────────────────────

async function teammate(who: Person, body: Json): Promise<{ slug: string; id: string }> {
  const r = await who.json("POST", "/api/agents/teammates", { hue: "sky", instructions: "Be brief.", ...body });
  if (r.status !== 201) throw new Error(`${who.name} could not make ${body.name}: ${r.status} ${JSON.stringify(r.body)}`);
  return { slug: r.body.teammate.slug, id: r.body.teammate.id };
}

async function main() {
  const w = await makeWorkspace();
  const { org, olivia, max, mia, gil } = w;
  console.log(`Workspace ${org.slug} (${org.id}); screenshots in ${SHOTS}`);

  // Max's own teammates, used by groups, delegation, Talk and automations.
  const planner = await teammate(max, { name: "Max Planner", job: "Plans Max's week", visibility: "PRIVATE", toolNames: ["search_tasks", "create_task", "post_in_talk", "comment_on_task"] });
  const writer = await teammate(max, { name: "Max Writer", job: "Drafts Max's updates", visibility: "PRIVATE", toolNames: ["search_tasks", "post_in_talk"] });
  const lead = await teammate(max, { name: "Max Lead", job: "Runs Max's day", visibility: "PRIVATE", toolNames: ["search_tasks", "ask_teammate"] });
  // A workspace teammate Olivia's automation asks (an Owner or Admin may change it).
  const desk = await teammate(olivia, { name: "Ops Desk", job: "Answers ops questions", visibility: "WORKSPACE", toolNames: ["search_tasks"] });

  // ── Step 2: old Workspace agents schedules become routines ────────
  step = "2 legacy schedules";
  const legacy = await prisma.agent.create({
    data: {
      organizationId: org.id,
      slug: `ops-watch-${RUN}`,
      name: "Ops Watch",
      description: "Watches what is overdue",
      systemPrompt: "Report what is overdue.",
      visibility: "WORKSPACE",
      status: "ENABLED",
      autonomousEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      autonomousPrompt: "Check what is overdue.",
      createdById: olivia.id,
    },
  });
  const tick1 = await cron();
  check("the cron tick answers 200", tick1.status === 200, tick1.body);
  const moved = await prisma.agent.findUnique({ where: { id: legacy.id }, select: { autonomousEnabled: true, scheduleMovedAt: true, scheduleRoutineId: true, scheduleMoveReason: true } });
  check("the old schedule is moved and turned off", Boolean(moved?.scheduleMovedAt) && moved?.autonomousEnabled === false && Boolean(moved?.scheduleRoutineId), moved);
  const routine = moved?.scheduleRoutineId ? await prisma.agentRoutine.findUnique({ where: { id: moved.scheduleRoutineId } }) : null;
  check(
    "its routine works as its creator, made by the move, with the teammate's fingerprint",
    routine?.actingForId === olivia.id && routine?.createdVia === "legacy" && routine?.status === "active" && Boolean(routine?.teammatePrint),
    routine,
  );
  const movedLine = await prisma.chatMessage.findFirst({ where: { role: "SYSTEM", meta: { path: ["event"], equals: "schedule_moved" }, session: { userId: olivia.id, agentId: legacy.id } } });
  check("Olivia's chat with it says the schedule moved", Boolean(movedLine), null);
  const turnBack = await olivia.json("PATCH", `/api/agents/${legacy.slug}/schedule`, { autonomousEnabled: true });
  check("turning the old schedule back on is refused (409 use_routines)", turnBack.status === 409 && turnBack.body.code === "use_routines", turnBack);
  const runNowMax = await max.json("POST", `/api/agents/${legacy.slug}/schedule`);
  check("Run now is an Owner's or Admin's (Max refused)", runNowMax.status === 403, runNowMax);
  const runNow = await olivia.json("POST", `/api/agents/${legacy.slug}/schedule`);
  check("Run now answers its run, as Olivia's own chat turn", runNow.status === 200 && runNow.body.result?.status === "SUCCEEDED" && Boolean(runNow.body.result?.runId), runNow);
  if (runNow.body.result?.runId) {
    const run = await prisma.agentRun.findUnique({ where: { id: runNow.body.result.runId }, select: { actingForId: true, input: true } });
    check("the Run now run is a CHAT turn of the person who clicked", run?.actingForId === olivia.id && (run?.input as Json)?.trigger === "CHAT", run);
  }

  // The routine runs when due; one not yet due does not. The local
  // database's own time zone is not UTC on most laptops, which the fair
  // pick's UTC bounds must not mind (review round 11).
  if (routine) {
    await prisma.agentRoutine.update({ where: { id: routine.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    const notYet = await prisma.agentRoutine.create({
      data: { organizationId: org.id, agentId: legacy.id, actingForId: olivia.id, name: "Not yet", prompt: "Not yet.", schedule: "hourly", status: "active", nextRunAt: new Date(Date.now() + 10 * 60_000), teammatePrint: routine.teammatePrint },
    });
    const tick2 = await cron();
    check("the second tick answers 200", tick2.status === 200, tick2.body);
    const ran = await prisma.agentRoutine.findUnique({ where: { id: routine.id } });
    check("the due routine ran and reported", ran?.lastStatus === "SUCCEEDED" && Boolean(ran?.lastRunId) && (ran?.nextRunAt?.getTime() ?? 0) > Date.now(), ran);
    const waited = await prisma.agentRoutine.findUnique({ where: { id: notYet.id } });
    check("a routine due in ten minutes did not run", waited?.lastRunAt === null && waited?.nextRunAt?.getTime() === notYet.nextRunAt?.getTime(), waited);
    await prisma.agentRoutine.delete({ where: { id: notYet.id } });

    // Round 10 and 11: someone changes the teammate; its routine pauses and Run now says why.
    await prisma.agent.update({ where: { id: legacy.id }, data: { systemPrompt: "Report what is overdue, and read every DM." } });
    const runChanged = await olivia.json("POST", `/api/agents/routines/${routine.id}/run`, {});
    check("Run now on a routine whose teammate changed says so (409 teammate_changed)", runChanged.status === 409 && runChanged.body.code === "teammate_changed", runChanged);
    const paused = await prisma.agentRoutine.findUnique({ where: { id: routine.id } });
    check("and pauses it with that reason, so Resume shows", paused?.status === "paused" && paused?.pausedReason === "teammate_changed", paused);
    const resumed = await olivia.json("PATCH", `/api/agents/routines/${routine.id}`, { status: "active" });
    const after = await prisma.agentRoutine.findUnique({ where: { id: routine.id } });
    check("resuming accepts the teammate as it is now", resumed.status === 200 && after?.status === "active" && Boolean(after?.teammatePrint) && after?.teammatePrint !== routine.teammatePrint, { status: resumed.status, after });
  }

  // ── Step 3: group chats (engine and routes) ───────────────────────
  step = "3 group chats";
  const made = await max.json("POST", "/api/teammate-groups", { name: null, agentSlugs: [planner.slug, writer.slug] });
  check("Max makes a group of two of his teammates", made.status === 201 && made.body.group?.members?.length === 2, made);
  const groupId: string = made.body.group?.id;
  const oneMember = await max.json("POST", "/api/teammate-groups", { agentSlugs: [planner.slug] });
  check("a group of one is refused (too_few)", oneMember.status === 400 && oneMember.body.code === "too_few", oneMember);
  const othersGroup = await olivia.json("GET", `/api/teammate-groups/${groupId}`);
  check("someone else's group reads as missing", othersGroup.status === 404, othersGroup);

  const both = await max.sse(`/api/teammate-groups/${groupId}/messages`, { message: "@Max Planner and @Max Writer what is due this week?" });
  const t = types(both.events);
  check("naming both: each answers in turn, then done", t[0] === "user_message" && t.filter((x) => x === "answer_start").length === 2 && t.filter((x) => x === "answer_done").length === 2 && t.at(-1) === "done", t);
  const groupRuns = await prisma.agentRun.findMany({ where: { sessionId: groupId }, select: { agentId: true, questionId: true } });
  check("each answerer spent its own question in the group", groupRuns.length === 2 && new Set(groupRuns.map((r) => r.agentId)).size === 2 && groupRuns.every((r) => r.questionId), groupRuns);
  const leadOnly = await max.sse(`/api/teammate-groups/${groupId}/messages`, { message: "Anything I should know?" });
  check("naming nobody: only the lead answers", types(leadOnly.events).filter((x) => x === "answer_start").length === 1, types(leadOnly.events));

  // A card in a group, approved, continues in the group with the teammate whose request it was.
  const asked = await max.sse(`/api/teammate-groups/${groupId}/messages`, { message: "@Max Writer post 'Group hello' in #proof" });
  const card = asked.events.find((e) => e.type === "approval")?.action;
  check("an outward request waits as a card in the group", Boolean(card?.id), types(asked.events));
  if (card?.id) {
    const decided = await max.json("POST", "/api/agents/actions/decide", { decisions: [{ id: card.id, decision: "approve" }] });
    check("approving it posts, and answers which chat continues", decided.status === 200 && decided.body.results?.[0]?.status === "EXECUTED" && decided.body.chat?.kind === "group" && decided.body.chat?.id === groupId, decided);
    const posted = await prisma.conversationMessage.findFirst({ where: { conversationId: w.proofChannel, body: { contains: "Group hello" } } });
    check("the post is in #proof", Boolean(posted), null);
    if (decided.body.resume) {
      const cont = await max.sse(`/api/teammate-groups/${groupId}/messages`, { resume: true, agentSlug: decided.body.chat.agentSlug });
      check("the group continues with that teammate", types(cont.events).includes("answer_done"), types(cont.events));
    }
  }

  // ── Step 4: group chats (UI) ──────────────────────────────────────
  step = "4 group chat UI";
  const s1 = await shot(max, `/agents?group=${groupId}`, "p2-step4-group-chat.png");
  check("the group chat opens with its answers (screenshot p2-step4-group-chat.png)", s1.text.includes("Max Planner and Max Writer") && s1.exceptions.length === 0, s1.exceptions);
  const waitingCard = await max.sse(`/api/teammate-groups/${groupId}/messages`, { message: "@Max Planner post 'Second hello' in #proof" });
  const card2 = waitingCard.events.find((e) => e.type === "approval")?.action;
  const s2 = await shot(max, `/agents?group=${groupId}`, "p2-step4-group-card-waiting.png");
  check("a waiting card shows in the group (p2-step4-group-card-waiting.png)", Boolean(card2?.id) && s2.text.includes("Waiting for you") && s2.exceptions.length === 0, s2.exceptions);
  const s3 = await shot(max, `/agents?group=${groupId}`, "p2-step4-group-card-denied.png", clickButton("Deny"));
  check("denying it from the group (p2-step4-group-card-denied.png)", s3.acted === true && s3.text.includes("Denied") && s3.exceptions.length === 0, { acted: s3.acted, exceptions: s3.exceptions });
  if (card2?.id) {
    const denied = await until(() => prisma.agentAction.findUnique({ where: { id: card2.id }, select: { status: true } }), (r) => r?.status === "DENIED", 10_000);
    check("the card is denied", denied?.status === "DENIED", denied);
  }
  const s4 = await shot(max, "/agents", "p2-step4-new-group.png", clickMenuItem("New", /group chat/i));
  check("the new group dialog opens from New (p2-step4-new-group.png)", s4.acted === true && s4.exceptions.length === 0, { acted: s4.acted, exceptions: s4.exceptions });

  // ── Step 5: ask_teammate ──────────────────────────────────────────
  step = "5 ask a teammate";
  const delegated = await max.sse(`/api/agents/teammates/${lead.slug}/messages`, { message: "ask Max Planner which tasks are stuck" });
  const askUse = delegated.events.find((e) => e.type === "tool_use" && e.name === "ask_teammate");
  const askResult = delegated.events.find((e) => e.type === "tool_result" && e.name === "ask_teammate");
  check("Max Lead asks Max Planner, and hears back", Boolean(askUse) && askResult?.state === "ran" && types(delegated.events).at(-1) === "done", types(delegated.events));
  const child = await prisma.agentRun.findFirst({ where: { agentId: planner.id, parentRunId: { not: null } }, orderBy: { startedAt: "desc" }, select: { input: true, parentRunId: true, actingForId: true } });
  check("the asked teammate ran a DELEGATED turn as Max, under the asking run", (child?.input as Json)?.trigger === "DELEGATED" && child?.actingForId === max.id && Boolean(child?.parentRunId), child);
  const askedLine = await prisma.chatMessage.findFirst({ where: { session: { agentId: planner.id, userId: max.id }, meta: { path: ["event"], equals: "delegated_asked" } } });
  check("Max Planner's own chat says who asked it", Boolean(askedLine), null);
  const practice = await max.sse(`/api/agents/teammates/${lead.slug}/messages`, { message: "ask Max Planner what is due", practice: true });
  check("a practice run says what it would ask and asks nobody", practice.events.some((e) => e.type === "tool_result" && e.name === "ask_teammate" && e.state === "practice"), types(practice.events));

  // ── Step 6: Talk ──────────────────────────────────────────────────
  step = "6 Talk";
  const list = await max.json("GET", `/api/conversations/${w.proofChannel}/teammates`);
  check("Max may ask his teammates in #proof", list.status === 200 && list.body.addressable === true && list.body.teammates?.some((x: Json) => x.slug === planner.slug), list);
  const clientId = `proof${RUN}a1`;
  const talk = await max.sse(`/api/conversations/${w.proofChannel}/teammates`, { body: "@Max Planner what is due this week?", teammate: planner.slug, clientId });
  const answer = talk.events.find((e) => e.type === "answer")?.message;
  check("the teammate answers in the channel", types(talk.events)[0] === "message" && Boolean(answer?.id), types(talk.events));
  if (answer?.id) {
    const row = await prisma.conversationMessage.findUnique({ where: { id: answer.id }, select: { authorId: true, metadata: true } });
    const meta = (row?.metadata ?? {}) as Json;
    check("its answer is posted for Max, marked as the teammate's, for the channel's readers", row?.authorId === max.id && meta.kind === "agent_post" && meta.via === "talk" && Array.isArray(meta.readers), row);
  }
  const again = await max.sse(`/api/conversations/${w.proofChannel}/teammates`, { body: "@Max Planner what is due this week?", teammate: planner.slug, clientId });
  const talkRuns = await prisma.agentRun.count({ where: { agentId: planner.id, input: { path: ["trigger"], equals: "TALK" } } });
  check("the same message sent twice starts one turn", talkRuns === 1, { talkRuns, again: types(again.events), refusal: again.refusal });
  const pub = await max.sse(`/api/conversations/${w.generalChannel}/teammates`, { body: "@Max Planner hi", teammate: planner.slug, clientId: `proof${RUN}b1` });
  check("a public channel is refused (public_channel)", pub.status === 403 && pub.refusal?.code === "public_channel", pub);
  const withGuest = await max.sse(`/api/conversations/${w.guestChannel}/teammates`, { body: "@Max Planner hi", teammate: planner.slug, clientId: `proof${RUN}c1` });
  check("a place a Guest is in is refused (has_guests)", withGuest.status === 403 && withGuest.refusal?.code === "has_guests", withGuest);
  const gilList = await gil.json("GET", `/api/conversations/${w.guestChannel}/teammates`);
  check("and Gil's place says why nobody may ask there", gilList.body.addressable === false, gilList);
  const s5 = await shot(max, `/tlk/${w.proofChannel}`, "p2-step6-talk-answer.png");
  check("the channel shows the request and the answer (p2-step6-talk-answer.png)", s5.text.includes("via Max Planner") && s5.exceptions.length === 0, s5.exceptions);
  const sAt = await shot(max, `/tlk/${w.proofChannel}`, "p2-step6-talk-at-list.png", undefined, "@");
  check("typing @ in #proof lists Max's teammates (p2-step6-talk-at-list.png)", sAt.acted === true && sAt.text.includes("Max Planner") && sAt.exceptions.length === 0, { acted: sAt.acted, exceptions: sAt.exceptions });
  const s6 = await shot(max, `/tlk/${w.guestChannel}`, "p2-step6-talk-guest-place.png", undefined, "@");
  check(
    "typing @ in a place with a Guest says teammates can't be asked there (p2-step6-talk-guest-place.png)",
    s6.acted === true && s6.text.includes("can't be asked in a conversation with guests") && !s6.text.includes("Max Planner") && s6.exceptions.length === 0,
    { acted: s6.acted, exceptions: s6.exceptions, text: s6.text.slice(-400) },
  );
  const s7 = await shot(mia, `/tlk/${w.proofChannel}`, "p2-step6-talk-as-mia.png");
  check("Mia, a reader, sees the answer (p2-step6-talk-as-mia.png)", s7.text.includes("via Max Planner") && s7.exceptions.length === 0, s7.exceptions);

  // ── Step 7: automations ───────────────────────────────────────────
  step = "7 automations";
  const space = await olivia.json("POST", "/api/spaces", { name: `Proof ${RUN}`, visibility: "ORG" });
  check("Olivia makes a Space", space.status === 201 || space.status === 200, space);
  const spaceId: string | undefined = space.body.space?.id ?? space.body.id;
  const board = spaceId ? await prisma.board.findFirst({ where: { spaceId }, select: { id: true } }) : null;
  check("it has its first List", Boolean(board), { spaceId });
  // Max works in it as a Space member: an automation works only where its creator may.
  const joined = spaceId ? await olivia.json("POST", `/api/spaces/${spaceId}/members`, { userId: max.id, role: "MEMBER" }) : null;
  check("Olivia adds Max to the Space", joined?.status === 201 || joined?.status === 200, joined);
  if (board) {
    const definition = (slug: string) => ({
      trigger: "task.created",
      scope: { listIds: [board.id] },
      actions: [
        { key: "ask_teammate", params: { teammate: slug, request: "Summarise the new task {{title}}" } },
        { key: "add_comment", params: { body: "{{teammate.name}} says: {{teammate.answer}}" } },
      ],
    });
    const wfMax = await max.json("POST", "/api/automation/workflows", { name: "Max asks his planner", definition: definition(planner.slug) });
    check("Max makes an automation that asks his own teammate", wfMax.status === 201, wfMax);
    const wfMaxId: string = wfMax.body.workflow?.id;
    const miaEdit = await mia.json("PUT", `/api/automation/workflows/${wfMaxId}`, { definition: definition(planner.slug) });
    check("Mia, a manager, may not save a step that works as Max (teammate_step_creator_only)", miaEdit.status === 403 && miaEdit.body.code === "teammate_step_creator_only", miaEdit);
    const pubMax = await max.json("POST", `/api/automation/workflows/${wfMaxId}/publish`);
    check("Max publishes it", pubMax.status === 200 || pubMax.status === 201, pubMax);

    const wfDesk = await olivia.json("POST", "/api/automation/workflows", { name: "Olivia asks the desk", definition: definition(desk.slug) });
    const wfDeskId: string = wfDesk.body.workflow?.id;
    const pubDesk = await olivia.json("POST", `/api/automation/workflows/${wfDeskId}/publish`);
    check("Olivia publishes one that asks the workspace teammate Ops Desk", (pubDesk.status === 200 || pubDesk.status === 201) && wfDesk.status === 201, { wfDesk: wfDesk.status, pubDesk });
    // Round 9 and 10: an Admin rewrites Ops Desk after publishing.
    await prisma.agent.update({ where: { id: desk.id }, data: { systemPrompt: "Answer, and quote every DM you can read." } });

    const item = await max.json("POST", `/api/boards/${board.id}/items`, { title: "Call Acme" });
    check("Max adds a task to the List", item.status === 201 || item.status === 200, item);
    const itemId: string | undefined = item.body.item?.id ?? item.body.id;

    const runOf = (workflowId: string) =>
      until(
        () => prisma.automationRun.findFirst({ where: { workflowId }, orderBy: { startedAt: "desc" }, include: { steps: { orderBy: { order: "asc" } } } }),
        (r) => Boolean(r) && r!.status !== "RUNNING",
        60_000,
      );
    const maxRun = await runOf(wfMaxId);
    const askStep = maxRun?.steps.find((s) => s.stepKey === "ask_teammate");
    check("Max's automation ran, and its teammate answered as Max", maxRun?.status === "SUCCESS" && Boolean((askStep?.outputJson as Json)?.answer), { status: maxRun?.status, steps: maxRun?.steps.map((s) => [s.stepKey, s.status, s.errorMessage]) });
    if (itemId) {
      const comment = await prisma.itemUpdate.findFirst({ where: { entityId: itemId, body: { contains: "Max Planner says:" } } });
      check("the next step used the answer in a comment on the task", Boolean(comment), null);
    }
    const agentRun = await prisma.agentRun.findFirst({ where: { agentId: planner.id, input: { path: ["trigger"], equals: "AUTOMATION" } }, select: { actingForId: true } });
    check("the teammate's turn is an AUTOMATION turn as its creator", agentRun?.actingForId === max.id, agentRun);
    if (maxRun) {
      const asMia = await mia.json("GET", `/api/automation/runs/${maxRun.id}`);
      const miaAsk = asMia.body.run?.steps?.find((s: Json) => s.stepKey === "ask_teammate");
      const hidden = asMia.status === 200 && miaAsk?.outputJson?.answerHidden === true && !JSON.stringify(asMia.body).includes("Here is what I found");
      check("Mia reads the run without the answer, or not at all", hidden || asMia.status === 403 || asMia.status === 404, { status: asMia.status, step: miaAsk });
    }
    const deskRun = await runOf(wfDeskId);
    const deskStep = deskRun?.steps.find((s) => s.stepKey === "ask_teammate");
    check(
      "Olivia's step did not run on the rewritten teammate, and says what changed",
      deskStep?.status === "FAILED" && /instructions/.test(deskStep?.errorMessage ?? "") && /publish/i.test(deskStep?.errorMessage ?? ""),
      { status: deskRun?.status, step: deskStep && [deskStep.status, deskStep.errorMessage] },
    );
    const deskTurns = await prisma.agentRun.count({ where: { agentId: desk.id, input: { path: ["trigger"], equals: "AUTOMATION" } } });
    check("and spent no question on it", deskTurns === 0, { deskTurns });
  }
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
