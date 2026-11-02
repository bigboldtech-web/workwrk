// The live proof of "A person's status in each workspace"
// (docs/plans/workspace-status.md, step 5: checks W1 onwards).
//
// WHAT IT HOLDS THE CODE TO. Two throwaway workspaces, A and B, and people
// who belong to both, driven over HTTP through the real routes as real people
// would, with the local database rows read after each step:
//
//   - each workspace's seat is its own (D1, D2, D5): B deactivating or
//     removing Pat never touches the account, Pat's sessions or A;
//   - ending the anchored seat while a usable seat is elsewhere moves the
//     account there, with no sign out (D3), and the token lands there at its
//     next session check; with nowhere else the account ends, signed out (D4);
//   - restoring and reactivating write the seat being restored (D6), the
//     switcher lists and accepts usable seats only (D7), sign-in repairs an
//     anchor in a suspended workspace (D7) and asks for the second factor by
//     the workspace it lands in (the step 2 review L3);
//   - B's hard delete keeps every account that belongs elsewhere (D9);
//   - re-inviting an ended membership revives it at the invitation's level,
//     and only an Admin may (D13, the step 2 review M1);
//   - SCIM acts on this workspace's seat only (D14); API keys stop with
//     their maker's seat (D15); the open invitations of an ended seat end
//     (the step 2 review H1); a workspace shows only its own department, job
//     title and office for a person (D18); the Owners are this workspace's
//     own (the step 4 review H1);
//   - and the dev server logs no 500.
//
// THE PEOPLE. Ada registers A and Bo registers B through /api/auth/register.
// Pat is made in A by hand (POST /api/users) as an Employee with A's
// department, job title and office. An Employee cannot make an API key, so
// Ada makes Pat a Company Admin for the key and an Employee again, as a
// company does for someone who sets up an integration. Ada also invites
// Pat's address before adding her by hand, so A holds an open invitation to
// Pat when her seat there ends. Bo invites Pat to B and Pat accepts through
// accept-invite, which moves her into B; she switches back to A. Quinn is
// made in A, his account dated older than Bo's (the database, since no route
// dates an account), and B invites him as a Company Admin. Mo is A's
// Manager, for the invitations only an Admin may send. Bo, Pat and Quinn set
// up two step verification through the routes, and B requires it for
// everyone, so Pat's sign-in into B asks for her code as the sign-in page
// does.
//
// The database is written only for what no route does: dating Quinn's
// account, suspending A and putting it back, and dating B's deletion past
// its grace period. The hard delete runs through POST
// /api/cron/org-hard-delete with CRON_SECRET. That cron deletes EVERY due
// company in the database, so before it runs the proof holds the schedule of
// every other cancelled company (a date far ahead) and puts each one back
// exactly as it was right after, in a finally.
//
// LOCAL ONLY. It refuses any database but Postgres on this machine
// (localhost:5432), it reads only .env.local, never .env, and it never
// imports or runs scripts/deploy-migrations.mjs: the SQL file
// (prisma/sql/2026-11-01-membership-status.sql) is applied to the local
// database beforehand, and the preflight checks its columns are there. Its
// people are @proof.test accounts in two throwaway workspaces, deleted at the
// end in the hard-delete order (KEEP=1 keeps them).
//
// RUN it with the launch tools' runner, which starts a fresh dev server on
// :3016 from this branch, runs this file and stops the server by its own PIDs:
//
//   ~/workwrk-launch-backup/tools/run-status-proof.sh <run-name> [KEEP=1]
//
// or by hand, in two terminals, from the repository's root:
//
//   NEXTAUTH_URL=http://localhost:3016 NEXT_PUBLIC_APP_URL=http://localhost:3016 CRON_SECRET=<any> \
//     npx next dev -p 3016 > $TMPDIR/status-dev.out 2>&1
//   BASE=http://localhost:3016 CRON_SECRET=<same> DEV_LOG=$TMPDIR/status-dev.out SHOTS=<folder> \
//     npx tsx scripts/live-proof-workspace-status.ts
//
// What it reads from the environment:
//   BASE         the dev server (default http://localhost:3016)
//   CRON_SECRET  the dev server's (required)
//   DEV_LOG      the dev server's output file: the last check counts its 500s
//   SHOTS        where the screenshot goes (default: a temp folder)
//   CHROME       the browser for the screenshot
//   KEEP=1       keep the workspaces
//
// TIMING. A session check runs at most every five minutes (src/lib/auth.ts
// REVALIDATE_MS); D3 says the token goes home at its next check. So where a
// check reads "lands in", the proof asks for the session, as the browser
// does, every 15 seconds until it does, up to six and a half minutes, and
// every answer on the way must still be signed in. A whole run takes about
// fifteen minutes.

import { config } from "dotenv";
import { spawn } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { generateSync } from "otplib";
import { scriptPrisma } from "./lib/script-prisma";

// Only the local file: .env points at the production database tunnel. The
// guard below refuses anything but this machine whatever is loaded.
config({ path: ".env.local", quiet: true });

// ── Local only ──────────────────────────────────────────────────────

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function refuseUnlessLocal(): void {
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
    let protocol = "";
    try {
      const u = new URL(raw);
      host = u.hostname;
      port = u.port || "5432";
      protocol = u.protocol;
    } catch {
      // Unreadable: refused below.
    }
    if (!(LOCAL_HOSTS.includes(host) && port === "5432" && /^postgres(ql)?:$/.test(protocol))) {
      console.error(`Refused: this proof runs only against Postgres on this machine (localhost:5432), and ${name} points at ${host ? `${protocol}//${host}:${port}` : "nothing readable"}.`);
      process.exit(1);
    }
  }
}
refuseUnlessLocal();

const BASE = (process.env.BASE || "http://localhost:3016").replace(/\/$/, "");
if (!LOCAL_HOSTS.includes(new URL(BASE).hostname)) {
  console.error(`Refused: BASE must be a server on this machine, not ${new URL(BASE).host}.`);
  process.exit(1);
}
const CRON_SECRET = process.env.CRON_SECRET || "";
if (!CRON_SECRET) {
  console.error("Set CRON_SECRET to the dev server's value.");
  process.exit(1);
}
const DEV_LOG = process.env.DEV_LOG || "";
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), "status-proof-shots-"));
mkdirSync(SHOTS, { recursive: true });
const prisma = scriptPrisma();
const RUN = Date.now().toString(36);
const PASSWORD = `Proof-${RUN}-Pw7!`;
/** The second octet of every address the proof sends from (X-Real-IP): its own per run. */
const NET = 20 + (Date.now() % 200);
let ipSeq = 0;
const freshIp = () => {
  ipSeq += 1;
  return `10.${NET}.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
};

// ── Checks ──────────────────────────────────────────────────────────

const results: Array<{ id: string; step: string; name: string; ok: boolean; detail?: string }> = [];
let step = "setup";
let seq = 0;

/** One check, numbered W1, W2 and so on in the order they run. */
function check(name: string, ok: boolean, detail?: unknown): boolean {
  seq += 1;
  const id = `W${seq}`;
  const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 1500);
  results.push({ id, step, name, ok, detail: ok ? undefined : d });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${id} [${step}] ${name}${!ok && d ? `\n         ${d}` : ""}`);
  return ok;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 20_000): Promise<T> {
  const t0 = Date.now();
  let v = await read();
  while (!done(v) && Date.now() - t0 < ms) {
    await sleep(400);
    v = await read();
  }
  return v;
}

// ── People over HTTP ────────────────────────────────────────────────

// Answers read as the routes send them: the checks name each field they rely on.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

type Reply = { status: number; body: Json; headers: Headers; text: string };

async function readReply(res: Response): Promise<Reply> {
  const text = await res.text();
  let body: Json = {};
  try {
    body = text.trim() ? JSON.parse(text.trim()) : {};
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body, headers: res.headers, text };
}

/** The error a NextAuth sign-in answered with (its url's ?error=), as the sign-in page reads it. */
function signInError(r: Reply): string {
  const raw = typeof r.body.url === "string" ? r.body.url : r.headers.get("location") ?? "";
  try {
    const e = new URL(raw, BASE).searchParams.get("error");
    if (e) return e;
  } catch {
    // Not a URL: the text below.
  }
  return `HTTP ${r.status} ${r.text.slice(0, 160)}`;
}

type SignIn = { ok: boolean; errors: string[]; usedCode: boolean };

class Person {
  jar = new Map<string, string>();
  password = PASSWORD;
  id = "";
  totpSecret: string | null = null;
  lastStep = 0;
  readonly ip = freshIp();
  constructor(
    readonly name: string,
    readonly firstName: string,
    readonly lastName: string,
    readonly email: string,
  ) {}

  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  keepCookies(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const eq = pair.indexOf("=");
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1);
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || v === "") this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }

  get sessionCookieName(): string | null {
    return [...this.jar.keys()].find((k) => k.endsWith("next-auth.session-token")) ?? null;
  }

  get token(): string {
    const n = this.sessionCookieName;
    return n ? this.jar.get(n)! : "";
  }

  /** A code from the authenticator, never one of a step already used (the sign-in refuses a replay). */
  async totp(): Promise<string> {
    if (!this.totpSecret) throw new Error(`${this.name} has no authenticator`);
    for (;;) {
      const now = Date.now();
      const stepNow = Math.floor(now / 30_000);
      const left = 30_000 - (now % 30_000);
      if (stepNow > this.lastStep && left > 3_000) {
        this.lastStep = stepNow;
        return generateSync({ secret: this.totpSecret });
      }
      await sleep(left + 300);
    }
  }

  /**
   * A fresh sign-in with the password, as the sign-in page does
   * (src/app/(auth)/login/login-form.tsx): asked for the second factor
   * (MFA_REQUIRED), it sends the code from the authenticator with the same
   * address and password.
   */
  async signIn(callbackUrl = `${BASE}/home`): Promise<SignIn> {
    const errors: string[] = [];
    let code: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      this.jar.clear();
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { "x-real-ip": this.ip } });
      this.keepCookies(csrfRes);
      const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
      const form: Record<string, string> = { csrfToken, email: this.email, password: this.password, json: "true", callbackUrl };
      if (code) form.mfaCode = code;
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: this.cookieHeader(), "x-real-ip": this.ip },
        body: new URLSearchParams(form),
      });
      this.keepCookies(res);
      const answer = await readReply(res);
      if (this.sessionCookieName) return { ok: true, errors, usedCode: !!code };
      const error = signInError(answer);
      errors.push(error);
      if (error === "MFA_REQUIRED" && this.totpSecret && !code) {
        code = await this.totp();
        continue;
      }
      return { ok: false, errors, usedCode: !!code };
    }
    return { ok: false, errors, usedCode: true };
  }

  async signInOrThrow(): Promise<void> {
    const r = await this.signIn();
    if (!r.ok) throw new Error(`${this.name} could not sign in: ${r.errors.join(", ")}`);
  }

  /** session.update(): what the client calls after a switch or a join, so the token reads the account now. */
  async refreshSession(): Promise<number> {
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: this.cookieHeader(), "x-real-ip": this.ip } });
    this.keepCookies(csrfRes);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const res = await fetch(`${BASE}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: this.cookieHeader(), "x-real-ip": this.ip },
      body: JSON.stringify({ csrfToken, data: {} }),
    });
    this.keepCookies(res);
    await res.text();
    return res.status;
  }

  /** The browser's own session read (GET /api/auth/session), its re-issued cookie kept. */
  async session(): Promise<Json> {
    const res = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: this.cookieHeader(), "x-real-ip": this.ip } });
    this.keepCookies(res);
    return (await readReply(res)).body;
  }

  async json(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      headers: { cookie: this.cookieHeader(), "x-real-ip": this.ip, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return readReply(res);
  }
}

/** Two step verification set up through the routes, as the Security page does: a secret, then a code from it. */
async function enrolMfa(p: Person): Promise<boolean> {
  const g = await p.json("GET", "/api/auth/mfa/enroll");
  const secret = g.body.secret;
  if (g.status !== 200 || typeof secret !== "string") return false;
  p.totpSecret = secret;
  const r = await p.json("POST", "/api/auth/mfa/enroll", { secret, code: await p.totp() });
  const row = await prisma.user.findUnique({ where: { id: p.id }, select: { mfaEnabled: true } });
  return r.status === 200 && r.body.enabled === true && row?.mfaEnabled === true;
}

// ── Rows ────────────────────────────────────────────────────────────

async function account(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, organizationId: true, status: true, deletedAt: true, tokenVersion: true, accessLevel: true, departmentId: true, roleId: true, officeId: true, createdAt: true },
  });
}

async function seat(userId: string, organizationId: string) {
  return prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true, status: true, removedAt: true, isPrimary: true, departmentId: true, roleId: true, officeId: true, createdAt: true, endedWithAccount: true },
  });
}

/** The audit row an action writes after its answer (logActivity is not awaited): the newest of its type for the person since `since`. */
async function auditRow(organizationId: string, type: string, targetId: string, since: Date) {
  return until(
    () => prisma.activityLog.findFirst({ where: { organizationId, type, targetId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { metadata: true, description: true } }),
    (r) => !!r,
  );
}

async function openInvitations(organizationId: string, email: string) {
  return prisma.invitation.findMany({
    where: { organizationId, accepted: false, email: { equals: email, mode: "insensitive" } },
    select: { id: true, accessLevel: true, expiresAt: true, token: true },
    orderBy: { createdAt: "desc" },
  });
}

// ── What the people see ─────────────────────────────────────────────

async function orgsOf(p: Person): Promise<{ status: number; ids: string[] }> {
  const r = await p.json("GET", "/api/me/orgs");
  return { status: r.status, ids: ((r.body.memberships ?? []) as Json[]).map((m) => String(m.organization?.id)) };
}

/** The workspace switcher: POST /api/me/switch-org, then session.update() as the workspace menu calls it. */
async function switchTo(p: Person, organizationId: string): Promise<Reply> {
  const r = await p.json("POST", "/api/me/switch-org", { organizationId });
  if (r.status === 200) await p.refreshSession();
  return r;
}

async function sessionOrg(p: Person): Promise<string | null> {
  const s = await p.session();
  return typeof s.user?.organizationId === "string" ? s.user.organizationId : null;
}

/** Members (GET /api/settings/members) as `viewer`, searched by the person's address. */
async function membersRow(viewer: Person, email: string): Promise<{ reply: Reply; row: Json | undefined }> {
  const reply = await viewer.json("GET", `/api/settings/members?q=${encodeURIComponent(email)}`);
  return { reply, row: ((reply.body.rows ?? []) as Json[]).find((r) => r.email === email) };
}

/** The People directory (GET /api/users?scope=directory) as `viewer`, searched by the address. */
async function directoryRow(viewer: Person, email: string, view?: string): Promise<{ reply: Reply; row: Json | undefined }> {
  const reply = await viewer.json("GET", `/api/users?scope=directory&q=${encodeURIComponent(email)}${view ? `&view=${view}` : ""}`);
  return { reply, row: ((reply.body.data ?? []) as Json[]).find((r) => r.email === email) };
}

/** An API key at work: GET /api/v1/people with it, as an integration calls. */
async function keyCall(plaintext: string): Promise<Reply> {
  const res = await fetch(`${BASE}/api/v1/people?limit=1`, { headers: { authorization: `Bearer ${plaintext}` } });
  return readReply(res);
}

let scimToken = "";
async function scim(method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`${BASE}/api/scim/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${scimToken}`, ...(body === undefined ? {} : { "content-type": "application/scim+json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readReply(res);
}
const SCIM_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const scimActive = (value: boolean) => ({ schemas: [SCIM_PATCH], Operations: [{ op: "replace", path: "active", value }] });

/** Wait for the session's next check to send the token to `organizationId`, asking as the browser does (see TIMING). */
async function waitToLand(p: Person, organizationId: string): Promise<{ landed: boolean; signedOut: boolean; polls: number; seconds: number; last: string | null }> {
  const t0 = Date.now();
  let signedOut = false;
  let polls = 0;
  let last: string | null = null;
  while (Date.now() - t0 < 390_000) {
    const s = await p.session();
    polls += 1;
    if (!s.user?.id) signedOut = true;
    last = typeof s.user?.organizationId === "string" ? s.user.organizationId : null;
    if (last === organizationId) break;
    await sleep(15_000);
  }
  return { landed: last === organizationId, signedOut, polls, seconds: Math.round((Date.now() - t0) / 1000), last };
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

type Shot = { exceptions: string[]; acted: unknown; text: string; url: string };

const shotList: Array<{ file: string; what: string }> = [];

async function shot(who: Person, path: string, file: string, what: string, act: string, settleMs = 6000): Promise<Shot> {
  shotList.push({ file, what });
  try {
    return await shotOnce(who, path, file, act, settleMs);
  } catch (err) {
    return { exceptions: [`screenshot failed: ${err instanceof Error ? err.message : String(err)}`], acted: null, text: "", url: "" };
  }
}

async function shotOnce(who: Person, path: string, file: string, act: string, settleMs: number): Promise<Shot> {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "status-proof-chrome-"));
  const chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
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
    let n = 0;
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
    const cdp = (method: string, params: Json = {}, sessionId?: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Promise<any>((resolve, reject) => {
        n += 1;
        pending.set(n, { resolve, reject });
        socket.send(JSON.stringify({ id: n, method, params, sessionId }));
      });
    const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
    for (const domain of ["Page", "Network", "Runtime"]) await cdp(`${domain}.enable`, {}, sessionId);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (who.sessionCookieName) {
      await cdp("Network.setCookie", { name: who.sessionCookieName, value: who.token, domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" }, sessionId);
    }
    await cdp("Page.navigate", { url: BASE + path }, sessionId);
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000 && !events.some((e) => e.method === "Page.loadEventFired")) await sleep(100);
    await sleep(settleMs);
    const dismiss = `(() => { let k = 0; for (const b of document.querySelectorAll("button")) { const t = (b.textContent || "").trim(); if (t === "Skip tour" || t === "Reject all" || t === "Skip" || t === "Got it") { b.click(); k++; } } return k; })()`;
    await cdp("Runtime.evaluate", { expression: dismiss, returnByValue: true }, sessionId);
    await sleep(600);
    const r = await cdp("Runtime.evaluate", { expression: act, awaitPromise: true, returnByValue: true }, sessionId);
    const acted = r.result?.value ?? r.exceptionDetails?.exception?.description ?? null;
    await sleep(800);
    const seen = await cdp("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true }, sessionId);
    const text = String(seen.result?.value ?? "");
    const loc = await cdp("Runtime.evaluate", { expression: "location.href", returnByValue: true }, sessionId);
    const { data } = await cdp("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(SHOTS, file), Buffer.from(data, "base64"));
    const exceptions = events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => String(e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text ?? "exception").slice(0, 300));
    return { exceptions, acted, text, url: String(loc.result?.value ?? "") };
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
  }
}

const actedOf = (s: Shot): Json => (s.acted && typeof s.acted === "object" ? (s.acted as Json) : { value: s.acted });

/** Open the workspace menu (the sidebar's "Switch workspace" button) and answer its text once its list has loaded. */
const OPEN_WORKSPACE_MENU = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  let btn = null;
  for (let i = 0; i < 480 && !btn; i++) { btn = document.querySelector('button[aria-label="Switch workspace"][aria-haspopup="menu"]'); if (!btn) await w(250); }
  if (!btn) return { ok: "no workspace menu button" };
  await w(1500);
  btn.click();
  const menu = () => [...document.querySelectorAll('[aria-label="Switch workspace"]')].find((e) => e !== btn && (e.textContent || "").includes("Create workspace")) || null;
  for (let i = 0; i < 80 && !menu(); i++) await w(250);
  // The list comes from /api/me/orgs after the menu opens: its skeleton rows go first.
  for (let i = 0; i < 40 && menu() && menu().querySelector(".os-skeleton-pulse"); i++) await w(250);
  await w(1200);
  const m = menu();
  return { ok: !!m, menu: m ? m.innerText : null };
})()`;

/**
 * A dev server just started compiles a route on its first request, and while
 * NextAuth's catch-all is still compiling the app's own /api catch-all can
 * answer that first request 404. So the proof asks until it answers, up to 90
 * seconds, before anyone signs in.
 */
async function warmSignIn(): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const r = await fetch(`${BASE}/api/auth/csrf`).catch(() => null);
    const body = r ? await r.json().catch(() => null) : null;
    if (r?.status === 200 && typeof body?.csrfToken === "string") return true;
    await sleep(1000);
  }
  return false;
}

// ── The workspaces ──────────────────────────────────────────────────

const orgIds: string[] = [];
const PEOPLE = ["ada", "bo", "pat", "quinn", "mo"];
const emailOf = (first: string) => `${first}.status@proof.test`;
const NAME_A = `Status Proof A ${RUN}`;
const NAME_B = `Status Proof B ${RUN}`;
const SLUG_PREFIXES = ["status-proof-a-", "status-proof-b-"];
const peopleIds: string[] = [];

/** Every other cancelled company's deletion date, held far ahead while the cron runs, and put back exactly after. */
const held: Array<{ id: string; scheduled: string }> = [];
const FAR_AHEAD = "2999-01-01T00:00:00.000Z";

async function setSchedule(id: string, value: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "Organization" SET "settings" = jsonb_set("settings"::jsonb, '{scheduledHardDeleteAt}', to_jsonb(${value}::text)) WHERE "id" = ${id}`;
}

async function putHeldBack(): Promise<boolean> {
  let all = true;
  while (held.length > 0) {
    const h = held[0];
    try {
      await setSchedule(h.id, h.scheduled);
      held.shift();
    } catch (err) {
      all = false;
      console.error(`Could not put back the deletion date of company ${h.id} (${h.scheduled}): ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
  return all;
}

async function sweepLeftovers(): Promise<void> {
  const leftOver = await prisma.organization.findMany({
    where: { AND: [{ name: { startsWith: "Status Proof " } }, { OR: SLUG_PREFIXES.map((p) => ({ slug: { startsWith: p } })) }] },
    select: { id: true },
  });
  if (leftOver.length > 0) {
    orgIds.push(...leftOver.map((o) => o.id));
    await deleteWorkspaces();
    orgIds.length = 0;
    console.log(`Deleted ${leftOver.length} workspace(s) an earlier run left behind.`);
  }
  const taken = await prisma.user.count({ where: { email: { in: PEOPLE.map(emailOf) } } });
  if (taken > 0) throw new Error(`${taken} local account(s) already use an address this proof signs up with (an earlier proof kept with KEEP=1?); remove them first.`);
}

async function deleteWorkspaces(): Promise<void> {
  const users = await prisma.user.findMany({ where: { OR: [{ organizationId: { in: orgIds } }, { email: { in: PEOPLE.map(emailOf) } }] }, select: { id: true } });
  const ids = [...new Set([...users.map((u) => u.id), ...peopleIds])];
  if (ids.length) await prisma.$executeRawUnsafe(`DELETE FROM "EndedSession" WHERE "userId" = ANY($1::text[])`, ids).catch(() => 0);
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
  // The record the hard delete keeps of B (no name in it) is the proof's own.
  if (orgIds.length) await prisma.workspaceDeletion.deleteMany({ where: { organizationId: { in: orgIds } } });
}

// ── The dev server's log ────────────────────────────────────────────

function fileMark(file: string): number {
  if (!file) return 0;
  try {
    const fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    closeSync(fd);
    return size;
  } catch {
    return 0;
  }
}

function fileSince(file: string, mark: number): string {
  if (!file) return "";
  try {
    const fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.max(0, size - mark));
    readSync(fd, buf, 0, buf.length, mark);
    closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

// ── The proof ───────────────────────────────────────────────────────

const has = (v: unknown, needles: string[]) => {
  const s = JSON.stringify(v ?? null);
  return needles.filter((n) => n && s.includes(n));
};

async function main() {
  // ── Preflight ─────────────────────────────────────────────────────
  step = "preflight";
  const devMark = fileMark(DEV_LOG);
  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'OrganizationMembership' AND column_name = ANY($1::text[])`,
    ["status", "removedAt", "endedWithAccount", "departmentId", "roleId", "officeId", "joinDate", "orgRole", "isAgent"],
  );
  check("the local database has the seat and profile columns of 2026-11-01-membership-status.sql", cols.length === 9, cols.map((c) => c.column_name));
  check("DEV_LOG names the dev server's output, for the last check", fileMark(DEV_LOG) > 0, DEV_LOG || "unset");
  check("the sign-in routes answer (a fresh dev server compiles each route on its first request)", await warmSignIn());
  await sweepLeftovers();

  // ── Setup: two workspaces, through the sign-up route ──────────────
  step = "setup";
  const ada = new Person("Ada", "Ada", "Owner", emailOf("ada"));
  const bo = new Person("Bo", "Bo", "Owner", emailOf("bo"));
  const pat = new Person("Pat", "Pat", "Proof", emailOf("pat"));
  const quinn = new Person("Quinn", "Quinn", "Proof", emailOf("quinn"));
  const mo = new Person("Mo", "Mo", "Manager", emailOf("mo"));
  const register = async (p: Person, organizationName: string) => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": p.ip },
      body: JSON.stringify({ organizationName, firstName: p.firstName, lastName: p.lastName, email: p.email, password: p.password, timezone: "UTC" }),
    });
    const r = await readReply(res);
    if (r.status === 201) {
      p.id = String(r.body.userId);
      orgIds.push(String(r.body.organizationId));
      peopleIds.push(p.id);
    }
    check(`${p.name} signs up and makes ${organizationName} (POST /api/auth/register 201)`, r.status === 201 && !!r.body.organizationId, r.body);
    return String(r.body.organizationId ?? "");
  };
  const A = await register(ada, NAME_A);
  const B = await register(bo, NAME_B);
  if (!A || !B) throw new Error("The two workspaces were not made.");
  console.log(`Workspaces ${NAME_A} (${A}) and ${NAME_B} (${B}); screenshots in ${SHOTS}`);
  await ada.signInOrThrow();
  await bo.signInOrThrow();
  check("Bo sets up two step verification (GET and POST /api/auth/mfa/enroll)", await enrolMfa(bo));

  // A's department, job title and office, and an invitation to Pat's address still open.
  const dept = await ada.json("POST", "/api/departments", { name: `Proof Ops ${RUN}` });
  const role = await ada.json("POST", "/api/roles", { title: `Proof Analyst ${RUN}` });
  const office = await ada.json("POST", "/api/offices", { name: `Proof Office ${RUN}` });
  const A_DEPT = String(dept.body.id ?? "");
  const A_ROLE = String(role.body.id ?? "");
  const A_OFFICE = String(office.body.id ?? "");
  check("Ada makes A's department, job title and office (201 each)", dept.status === 201 && role.status === 201 && office.status === 201 && !!A_DEPT && !!A_ROLE && !!A_OFFICE, { dept: dept.status, role: role.status, office: office.status });
  const A_NAMES = [`Proof Ops ${RUN}`, `Proof Analyst ${RUN}`, `Proof Office ${RUN}`, A_DEPT, A_ROLE, A_OFFICE];
  const firstInvite = await ada.json("POST", "/api/invitations", { email: pat.email, accessLevel: "EMPLOYEE" });
  check("Ada invites Pat's address to A first (POST /api/invitations 201); it stays open", firstInvite.status === 201, firstInvite.body);

  const addByHand = async (p: Person, accessLevel: string, extra: Json = {}) => {
    const r = await ada.json("POST", "/api/users", { firstName: p.firstName, lastName: p.lastName, email: p.email, password: p.password, accessLevel, ...extra });
    if (r.status === 201 || r.status === 200) {
      p.id = String(r.body.id ?? r.body.user?.id ?? "");
      peopleIds.push(p.id);
    }
    return r;
  };
  const patMade = await addByHand(pat, "EMPLOYEE", { departmentId: A_DEPT, roleId: A_ROLE });
  check("Ada adds Pat to A by hand as an Employee with A's department and job title (POST /api/users)", !!pat.id && patMade.body.accessLevel === "EMPLOYEE", patMade.body);
  const patOffice = await ada.json("PATCH", `/api/users/${pat.id}`, { officeId: A_OFFICE });
  check("Ada puts Pat in A's office (PATCH /api/users/[id] 200)", patOffice.status === 200, patOffice.body);
  const moMade = await addByHand(mo, "MANAGER");
  const quinnMade = await addByHand(quinn, "EMPLOYEE");
  check("Ada adds Mo (Manager) and Quinn (Employee) to A", !!mo.id && !!quinn.id && moMade.body.accessLevel === "MANAGER", { mo: moMade.body, quinn: quinnMade.body });
  const boRow = await account(bo.id);
  // No route dates an account: Quinn's is made older than Bo's here.
  await prisma.user.update({ where: { id: quinn.id }, data: { createdAt: new Date(boRow!.createdAt.getTime() - 400 * 86_400_000) } });
  const quinnRow0 = await account(quinn.id);
  check("Quinn's account is dated older than Bo's (the database: no route dates an account)", !!quinnRow0 && quinnRow0.createdAt < boRow!.createdAt);
  for (const p of [pat, mo, quinn]) await p.signInOrThrow();
  check("Pat and Quinn set up two step verification in A", (await enrolMfa(pat)) && (await enrolMfa(quinn)));

  // Pat's API key in A: an Employee cannot make one, so Ada makes her an Admin for it and an Employee again.
  const promote = await ada.json("PATCH", `/api/users/${pat.id}`, { accessLevel: "COMPANY_ADMIN" });
  // A promotion reaches a session at its next check or a fresh sign-in; the
  // Owner pages also ask the session's own claim (freshWorkspaceActor).
  await pat.signInOrThrow();
  const keyMade = await pat.json("POST", "/api/keys", { name: `Pat's integration ${RUN}`, scopes: ["READ"] });
  const KEY = String(keyMade.body.plaintext ?? "");
  const KEY_ID = String(keyMade.body.id ?? "");
  check("Pat, made a Company Admin of A for it, makes an API key there (POST /api/keys)", promote.status === 200 && keyMade.status === 200 && KEY.startsWith("wk_live_"), { promote: promote.status, key: keyMade.status, body: keyMade.body.error });
  const demote = await ada.json("PATCH", `/api/users/${pat.id}`, { accessLevel: "EMPLOYEE" });
  await pat.signInOrThrow();
  const patRow0 = await account(pat.id);
  check("Ada makes Pat an Employee again; her account in A holds A's department, job title and office", demote.status === 200 && patRow0?.accessLevel === "EMPLOYEE" && patRow0.departmentId === A_DEPT && patRow0.roleId === A_ROLE && patRow0.officeId === A_OFFICE, { demote: demote.status, row: patRow0 });
  const keyWorks0 = await keyCall(KEY);
  check("Pat's key works in A (GET /api/v1/people 200)", keyWorks0.status === 200, keyWorks0.body);

  // B invites Pat; Pat joins through accept-invite (which moves her into B), then switches back to A.
  const invPat = await bo.json("POST", "/api/invitations", { email: pat.email, accessLevel: "EMPLOYEE" });
  const patToken = (await openInvitations(B, pat.email))[0]?.token ?? "";
  check("Bo invites Pat to B (POST /api/invitations 201)", invPat.status === 201 && !!patToken, invPat.body);
  const joinCard = await pat.json("GET", `/api/auth/accept-invite?token=${patToken}`);
  check("Pat opens the invitation: the join card (accountExists, not already in B)", joinCard.status === 200 && joinCard.body.accountExists === true && joinCard.body.alreadyInThisOrg === false, joinCard.body);
  const joined = await pat.json("POST", "/api/auth/accept-invite", { token: patToken });
  await pat.refreshSession();
  const patInB = await account(pat.id);
  const patSeatA0 = await seat(pat.id, A);
  check("Pat accepts signed in (201): her account moves into B, her session acts there", joined.status === 201 && patInB?.organizationId === B && (await sessionOrg(pat)) === B, { joined: joined.body, row: patInB });
  check(
    "D18 on the move: A's department, job title and office stay on A's membership (primary); the account holds B's (none)",
    !!patSeatA0 && patSeatA0.isPrimary && patSeatA0.departmentId === A_DEPT && patSeatA0.roleId === A_ROLE && patSeatA0.officeId === A_OFFICE && patInB?.departmentId === null && patInB.roleId === null && patInB.officeId === null,
    { seatA: patSeatA0, account: patInB },
  );
  const back0 = await switchTo(pat, A);
  const patHome = await account(pat.id);
  const patSeatB0 = await seat(pat.id, B);
  check(
    "Pat switches back to A (POST /api/me/switch-org): anchored in A with A's profile again, a live Employee seat in B",
    back0.status === 200 && patHome?.organizationId === A && patHome.departmentId === A_DEPT && patHome.officeId === A_OFFICE && patSeatB0?.status === "ACTIVE" && patSeatB0.removedAt === null && patSeatB0.role === "EMPLOYEE" && (await sessionOrg(pat)) === A,
    { back: back0.body, account: patHome, seatB: patSeatB0 },
  );
  const rule = await bo.json("PATCH", "/api/settings", { section: "security", data: { mfaRequired: "everyone" } });
  check("Bo makes B require two step verification for everyone (PATCH /api/settings 200)", rule.status === 200, rule.body);
  const orgs0 = await orgsOf(pat);
  check("Pat's workspace list (GET /api/me/orgs) has A and B", orgs0.status === 200 && orgs0.ids.includes(A) && orgs0.ids.includes(B), orgs0);

  // ── 1. B deactivates Pat (D5) ─────────────────────────────────────
  step = "1 B deactivates Pat";
  let before = await account(pat.id);
  const t1 = new Date();
  const deact1 = await bo.json("PATCH", `/api/users/${pat.id}`, { status: "INACTIVE" });
  check("Bo deactivates Pat in Members (PATCH /api/users/[id] 200)", deact1.status === 200, deact1.body);
  let now = await account(pat.id);
  let seatB = await seat(pat.id, B);
  check(
    "rows: the account is ACTIVE, still anchored in A, its tokenVersion unchanged; B's membership is INACTIVE, not removed",
    now?.status === "ACTIVE" && now.deletedAt === null && now.organizationId === A && now.tokenVersion === before?.tokenVersion && seatB?.status === "INACTIVE" && seatB.removedAt === null,
    { account: now, seatB },
  );
  const audit1 = await auditRow(B, "membership.changed", pat.id, t1);
  check("B's audit row says the membership ended, nothing about the account", (audit1?.metadata as Json)?.seat === "membership" && (audit1?.metadata as Json)?.outcome === "membership_ended", audit1);
  const sess1 = await pat.session();
  const dirA1 = await directoryRow(pat, pat.email);
  check("Pat's session still works in A with no sign out (GET /api/auth/session, A's Directory 200)", sess1.user?.organizationId === A && dirA1.reply.status === 200, { session: sess1.user, dir: dirA1.reply.status });
  const orgs1 = await orgsOf(pat);
  check("GET /api/me/orgs no longer lists B (A only)", orgs1.ids.includes(A) && !orgs1.ids.includes(B), orgs1);
  const sw1 = await pat.json("POST", "/api/me/switch-org", { organizationId: B });
  check("the switch to B is refused (403 You no longer have access to that workspace.) and moves nothing", sw1.status === 403 && /no longer have access/.test(String(sw1.body.error)) && (await account(pat.id))?.organizationId === A, sw1.body);
  const memB1 = await membersRow(bo, pat.email);
  const memA1 = await membersRow(ada, pat.email);
  check("B's Members shows Pat Deactivated (INACTIVE)", memB1.row?.status === "INACTIVE", memB1.row ?? memB1.reply.body);
  check("A's Members shows Pat Active", memA1.row?.status === "ACTIVE", memA1.row ?? memA1.reply.body);
  const key1 = await keyCall(KEY);
  check("Pat's API key made in A still works", key1.status === 200, key1.body);
  const menu = await shot(pat, "/home", "pat-workspace-menu.png", "Pat's workspace menu after B deactivated her: A only, no B", OPEN_WORKSPACE_MENU, 6000);
  const menuText = String(actedOf(menu).menu ?? "");
  check(
    "screenshot pat-workspace-menu.png: Pat's workspace menu shows A and Create workspace, and no B",
    menuText.includes(NAME_A) && menuText.includes("Create workspace") && !menuText.includes(NAME_B) && !menu.text.includes(NAME_B),
    { acted: menu.acted, exceptions: menu.exceptions, url: menu.url },
  );

  // ── 2. B reactivates Pat ──────────────────────────────────────────
  step = "2 B reactivates Pat";
  const react2 = await bo.json("PATCH", `/api/users/${pat.id}`, { status: "ACTIVE" });
  seatB = await seat(pat.id, B);
  check("Bo reactivates Pat (PATCH 200): B's membership is ACTIVE again", react2.status === 200 && seatB?.status === "ACTIVE" && seatB.removedAt === null, { reply: react2.body, seatB });
  const orgs2 = await orgsOf(pat);
  check("B is back in GET /api/me/orgs", orgs2.ids.includes(A) && orgs2.ids.includes(B), orgs2);
  const sw2 = await switchTo(pat, B);
  now = await account(pat.id);
  check("the switch to B works: anchored in B, the session acts there", sw2.status === 200 && now?.organizationId === B && (await sessionOrg(pat)) === B, { reply: sw2.body, account: now });

  // ── 3. Anchored in B, B deactivates Pat (D3) ──────────────────────
  step = "3 B deactivates Pat anchored there";
  before = await account(pat.id);
  const dirB3 = await directoryRow(pat, pat.email);
  check("before: Pat reads B's Directory (200)", dirB3.reply.status === 200, dirB3.reply.status);
  const t3 = new Date();
  const deact3 = await bo.json("PATCH", `/api/users/${pat.id}`, { status: "INACTIVE" });
  now = await account(pat.id);
  seatB = await seat(pat.id, B);
  check(
    "Bo deactivates Pat (200): the account moves to A (D3), ACTIVE, tokenVersion unchanged; B keeps her seat there as INACTIVE",
    deact3.status === 200 && now?.organizationId === A && now.status === "ACTIVE" && now.deletedAt === null && now.tokenVersion === before?.tokenVersion && seatB?.status === "INACTIVE" && seatB.removedAt === null,
    { reply: deact3.body, account: now, seatB },
  );
  const audit3 = await auditRow(B, "membership.changed", pat.id, t3);
  check("B's audit row: the account moved, and never says where (no A id)", (audit3?.metadata as Json)?.outcome === "moved" && (audit3?.metadata as Json)?.accountMoved === true && has(audit3, [A]).length === 0, audit3);
  const dirB3after = await directoryRow(pat, pat.email);
  check("at once, Pat's session still acting in B reads nothing of B (B's Directory refused)", dirB3after.reply.status !== 200, dirB3after.reply.status);
  const land3 = await waitToLand(pat, A);
  check(`Pat's next session check lands her in A, never signed out on the way (${land3.seconds}s, ${land3.polls} reads)`, land3.landed && !land3.signedOut, land3);
  const dirA3 = await directoryRow(pat, pat.email);
  check("Pat works in A (A's Directory 200)", dirA3.reply.status === 200, dirA3.reply.status);
  const react3 = await bo.json("PATCH", `/api/users/${pat.id}`, { status: "ACTIVE" });
  seatB = await seat(pat.id, B);
  now = await account(pat.id);
  check("Bo reactivates Pat in B: B's membership ACTIVE, the account stays in A", react3.status === 200 && seatB?.status === "ACTIVE" && now?.organizationId === A, { reply: react3.body, seatB, account: now });

  // ── 4. A removes Pat while she has a live seat in B (D3) ──────────
  step = "4 A removes Pat";
  before = await account(pat.id);
  const openA = (await openInvitations(A, pat.email)).filter((i) => i.expiresAt > new Date());
  check("before: A's invitation to Pat's address is still open", openA.length === 1, openA);
  const dirA4 = await directoryRow(pat, pat.email);
  const t4 = new Date();
  const removed4 = await ada.json("DELETE", `/api/users/${pat.id}`);
  now = await account(pat.id);
  const seatA4 = await seat(pat.id, A);
  check(
    "Ada removes Pat (DELETE /api/users/[id] 200): the account moves to B, live, tokenVersion unchanged",
    removed4.status === 200 && now?.organizationId === B && now.status === "ACTIVE" && now.deletedAt === null && now.tokenVersion === before?.tokenVersion,
    { reply: removed4.body, account: now },
  );
  check(
    "rows: A's membership has removedAt (INACTIVE) and keeps A's department, job title and office; the account holds none of them",
    !!seatA4?.removedAt && seatA4.status === "INACTIVE" && seatA4.departmentId === A_DEPT && seatA4.roleId === A_ROLE && seatA4.officeId === A_OFFICE && now?.departmentId !== A_DEPT && now?.roleId !== A_ROLE && now?.officeId !== A_OFFICE,
    { seatA: seatA4, account: now },
  );
  const audit4 = await auditRow(A, "user_removed", pat.id, t4);
  check("A's audit row: moved, one API key revoked, and never says where (no B id)", (audit4?.metadata as Json)?.outcome === "moved" && (audit4?.metadata as Json)?.apiKeysRevoked === 1 && has(audit4, [B]).length === 0, audit4);
  check("before the removal Pat read A's Directory (200); at once after it, her session still acting in A is refused", dirA4.reply.status === 200 && (await directoryRow(pat, pat.email)).reply.status !== 200, dirA4.reply.status);
  const land4 = await waitToLand(pat, B);
  check(`Pat's next session check lands her in B, never signed out on the way (${land4.seconds}s, ${land4.polls} reads)`, land4.landed && !land4.signedOut, land4);
  const removedView = await directoryRow(ada, pat.email, "removed");
  check("A's Directory Removed view lists Pat, with her removal", !!removedView.row && !!removedView.row.deletedAt, removedView.row ?? removedView.reply.body);
  const memA4 = await membersRow(ada, pat.email);
  check("A's Members no longer lists her", memA4.reply.status === 200 && !memA4.row, memA4.row);
  const memB4 = await membersRow(bo, pat.email);
  const dirB4 = await directoryRow(bo, pat.email);
  const pick4 = await bo.json("GET", `/api/people/pick?q=${encodeURIComponent("Pat Proof")}`);
  const pickRow4 = ((pick4.body.people ?? []) as Json[]).find((p) => p.id === pat.id);
  const record4 = await bo.json("GET", `/api/users/${pat.id}`);
  check("D18: B's Members shows Pat with no department, job title or office of A's", !!memB4.row && memB4.row.department === null && memB4.row.jobTitle === null && memB4.row.office === null && has(memB4.reply.body, A_NAMES).length === 0, { row: memB4.row, found: has(memB4.reply.body, A_NAMES) });
  check("D18: B's Directory shows none of A's for Pat", !!dirB4.row && dirB4.row.department === null && dirB4.row.role === null && dirB4.row.office === null && has(dirB4.reply.body, A_NAMES).length === 0, { row: dirB4.row, found: has(dirB4.reply.body, A_NAMES) });
  check("D18: B's people picker (GET /api/people/pick) shows no job title of A's for Pat", !!pickRow4 && pickRow4.role === null && has(pick4.body, A_NAMES).length === 0, { row: pickRow4, found: has(pick4.body, A_NAMES) });
  check("D18: Pat's record in B (GET /api/users/[id]) shows none of A's", record4.status === 200 && !record4.body.role && !record4.body.department && !record4.body.office && has(record4.body, A_NAMES).length === 0, { status: record4.status, found: has(record4.body, A_NAMES) });
  const key4 = await keyCall(KEY);
  const keyRow4 = await prisma.apiKey.findUnique({ where: { id: KEY_ID }, select: { revokedAt: true } });
  check("Pat's API key made in A is refused (api-auth 401) and revoked in its row", key4.status === 401 && !!keyRow4?.revokedAt, { status: key4.status, body: key4.body, row: keyRow4 });
  const invA4 = await openInvitations(A, pat.email);
  check("A's open invitation to Pat ended (expiresAt now, the row kept)", invA4.length === 1 && invA4[0].expiresAt <= new Date() && invA4[0].expiresAt >= t4, invA4);

  // ── 5. A restores Pat (D6) ────────────────────────────────────────
  step = "5 A restores Pat";
  const restore5 = await ada.json("DELETE", `/api/users/${pat.id}?restore=true`);
  const seatA5 = await seat(pat.id, A);
  now = await account(pat.id);
  check("Ada restores Pat (DELETE ?restore=true 200): A's seat is live; the account stays in B, where it is live", restore5.status === 200 && seatA5?.status === "ACTIVE" && seatA5.removedAt === null && now?.organizationId === B, { reply: restore5.body, seatA: seatA5, account: now });
  const orgs5 = await orgsOf(pat);
  check("A is in Pat's GET /api/me/orgs again", orgs5.ids.includes(A) && orgs5.ids.includes(B), orgs5);
  const key5 = await keyCall(KEY);
  check("her old key stays refused (a restore brings no key back)", key5.status === 401, key5.status);
  const sw5 = await switchTo(pat, A);
  now = await account(pat.id);
  check("Pat switches to A: anchored there with A's department, job title and office again", sw5.status === 200 && now?.organizationId === A && now.departmentId === A_DEPT && now.roleId === A_ROLE && now.officeId === A_OFFICE && (await sessionOrg(pat)) === A, { reply: sw5.body, account: now });

  // ── 6. SCIM in B (D14) ────────────────────────────────────────────
  step = "6 SCIM in B";
  const tok = await bo.json("POST", "/api/scim-tokens", { name: `Proof IdP ${RUN}` });
  scimToken = String(tok.body.token ?? "");
  check("Bo makes a SCIM token in Settings (POST /api/scim-tokens 201)", tok.status === 201 && !!scimToken, tok.body);
  before = await account(pat.id);
  const off6 = await scim("PATCH", `/Users/${pat.id}`, scimActive(false));
  seatB = await seat(pat.id, B);
  now = await account(pat.id);
  check("SCIM PATCH active:false (200, active false): B's membership is INACTIVE (D5)", off6.status === 200 && off6.body.active === false && seatB?.status === "INACTIVE" && seatB.removedAt === null, { reply: off6.body, seatB });
  check("the account is untouched: anchored in A, ACTIVE, tokenVersion unchanged", now?.organizationId === A && now.status === "ACTIVE" && now.deletedAt === null && now.tokenVersion === before?.tokenVersion, now);
  const dirA6 = await directoryRow(pat, pat.email);
  check("A still works for Pat (A's Directory 200, the session in A)", dirA6.reply.status === 200 && (await sessionOrg(pat)) === A, dirA6.reply.status);
  const get6 = await scim("GET", `/Users/${pat.id}`);
  check("SCIM GET reports active false", get6.status === 200 && get6.body.active === false, get6.body);
  const on6 = await scim("PATCH", `/Users/${pat.id}`, scimActive(true));
  seatB = await seat(pat.id, B);
  check("SCIM PATCH active:true (200) brings the seat back at the same level (ACTIVE, Employee)", on6.status === 200 && on6.body.active === true && seatB?.status === "ACTIVE" && seatB.role === "EMPLOYEE", { reply: on6.body, seatB });
  const rm6 = await bo.json("DELETE", `/api/users/${pat.id}`);
  seatB = await seat(pat.id, B);
  now = await account(pat.id);
  check("Bo removes Pat in Members (200): B's membership removed (D5), the account untouched in A", rm6.status === 200 && !!seatB?.removedAt && now?.organizationId === A && now.status === "ACTIVE", { reply: rm6.body, seatB, account: now });
  const usersBefore6 = await prisma.user.count({ where: { email: { equals: pat.email, mode: "insensitive" } } });
  const post6 = await scim("POST", "/Users", { schemas: [SCIM_USER], userName: pat.email, name: { givenName: "Pat", familyName: "Proof" }, emails: [{ value: pat.email, primary: true }], active: true });
  const seatB6 = await seat(pat.id, B);
  const usersAfter6 = await prisma.user.count({ where: { email: { equals: pat.email, mode: "insensitive" } } });
  check("SCIM POST with Pat's address answers 409 and writes nothing (one account, the seat still removed)", post6.status === 409 && usersAfter6 === usersBefore6 && usersAfter6 === 1 && seatB6?.removedAt?.getTime() === seatB?.removedAt?.getTime() && seatB6?.status === "INACTIVE", { reply: post6.body, usersAfter6, seatB: seatB6 });
  const put6 = await scim("PUT", `/Users/${pat.id}`, { schemas: [SCIM_USER], userName: pat.email, name: { givenName: "Pat", familyName: "Proof" }, active: true });
  const seatB6b = await seat(pat.id, B);
  check("SCIM PUT active:true answers 409 and writes nothing", put6.status === 409 && !!seatB6b?.removedAt && seatB6b.status === "INACTIVE", { reply: put6.body, seatB: seatB6b });
  const back6 = await bo.json("DELETE", `/api/users/${pat.id}?restore=true`);
  seatB = await seat(pat.id, B);
  check("Bo restores Pat again (DELETE ?restore=true 200): B's seat live", back6.status === 200 && seatB?.status === "ACTIVE" && seatB.removedAt === null, { reply: back6.body, seatB });

  // ── 7. The Owner rule (the step 4 review H1) ──────────────────────
  step = "7 the Owner rule";
  const owners = async (viewer: Person) => {
    const r = await viewer.json("GET", `/api/settings/members`);
    const rows = (r.body.rows ?? []) as Json[];
    return { status: r.status, owners: rows.filter((x) => x.role === "OWNER").map((x) => x.email as string), quinn: rows.find((x) => x.email === quinn.email)?.role ?? null, counts: r.body.counts, viewerIsOwner: r.body.viewer?.isOwner };
  };
  const invQ = await bo.json("POST", "/api/invitations", { email: quinn.email, accessLevel: "COMPANY_ADMIN" });
  const qToken = (await openInvitations(B, quinn.email))[0]?.token ?? "";
  const qJoin = await quinn.json("POST", "/api/auth/accept-invite", { token: qToken });
  await quinn.refreshSession();
  const quinnRow = await account(quinn.id);
  check("Bo invites Quinn as a Company Admin and Quinn accepts: he works in B now", invQ.status === 201 && qJoin.status === 201 && quinnRow?.organizationId === B && quinnRow.accessLevel === "COMPANY_ADMIN" && (await sessionOrg(quinn)) === B, { invite: invQ.body, join: qJoin.body, account: quinnRow });
  let o7 = await owners(bo);
  check("B's Owners are Bo only, in Members' owner flags and the role counts (Quinn is an Admin)", o7.status === 200 && o7.owners.length === 1 && o7.owners[0] === bo.email && o7.quinn === "ADMIN" && o7.counts?.owners === 1 && o7.counts?.admins === 1, o7);
  const oq = await owners(quinn);
  check("Quinn's own view of B's Members: not an Owner, Bo the only one", oq.status === 200 && oq.viewerIsOwner === false && oq.owners.length === 1 && oq.owners[0] === bo.email, oq);
  const qBack = await switchTo(quinn, A);
  o7 = await owners(bo);
  check("Quinn switches back to A: B's Owners and counts do not change", qBack.status === 200 && (await sessionOrg(quinn)) === A && o7.owners.length === 1 && o7.owners[0] === bo.email && o7.counts?.owners === 1 && o7.counts?.admins === 1, { back: qBack.body, o7 });

  // ── 7b. Re-inviting an ended membership (D13, the step 2 review M1) ─
  step = "7b re-invite an ended membership";
  before = await account(quinn.id);
  const rmQ = await ada.json("DELETE", `/api/users/${quinn.id}`);
  const quinnMoved = await account(quinn.id);
  const quinnSeatA = await seat(quinn.id, A);
  check("Ada removes Quinn from A (200): his account moves to B (D3), no sign out; A's membership removed", rmQ.status === 200 && quinnMoved?.organizationId === B && quinnMoved.tokenVersion === before?.tokenVersion && !!quinnSeatA?.removedAt, { reply: rmQ.body, account: quinnMoved, seatA: quinnSeatA });
  const moInvite = await mo.json("POST", "/api/invitations", { email: quinn.email, accessLevel: "EMPLOYEE" });
  const afterMo = (await openInvitations(A, quinn.email)).filter((i) => i.expiresAt > new Date());
  check("Mo, A's Manager, may not bring him back by invitation (403 seat_ended), and no invitation is made", moInvite.status === 403 && moInvite.body.code === "seat_ended" && afterMo.length === 0, { reply: moInvite.body, open: afterMo });
  const adaInvite = await ada.json("POST", "/api/invitations", { email: quinn.email, accessLevel: "MANAGER" });
  const qInv = (await openInvitations(A, quinn.email)).filter((i) => i.expiresAt > new Date());
  check("Ada, A's Owner, invites him again as a Manager (201)", adaInvite.status === 201 && qInv.length === 1 && qInv[0].accessLevel === "MANAGER", { reply: adaInvite.body, open: qInv });
  const qCard = await quinn.json("GET", `/api/auth/accept-invite?token=${qInv[0]?.token ?? ""}`);
  check("Quinn's join card: an ended seat is not \"already in A\"", qCard.status === 200 && qCard.body.alreadyInThisOrg === false, qCard.body);
  const qAccept = await quinn.json("POST", "/api/auth/accept-invite", { token: qInv[0]?.token ?? "" });
  await quinn.refreshSession();
  const qBackRow = await account(quinn.id);
  const qSeatB = await seat(quinn.id, B);
  check(
    "Quinn accepts (201): A's seat comes back at the invitation's level, Manager, and he works in A; B keeps his Admin seat",
    qAccept.status === 201 && qBackRow?.organizationId === A && qBackRow.accessLevel === "MANAGER" && qBackRow.status === "ACTIVE" && qBackRow.deletedAt === null && qSeatB?.role === "COMPANY_ADMIN" && qSeatB.status === "ACTIVE" && (await sessionOrg(quinn)) === A,
    { reply: qAccept.body, account: qBackRow, seatB: qSeatB },
  );
  const qIntoB = await switchTo(quinn, B);
  o7 = await owners(bo);
  check("Quinn switches into B again: B's Owners are still Bo only", qIntoB.status === 200 && (await account(quinn.id))?.organizationId === B && o7.owners.length === 1 && o7.owners[0] === bo.email && o7.counts?.owners === 1, { reply: qIntoB.body, o7 });

  // ── 8. Sign-in repair (D7) ────────────────────────────────────────
  step = "8 sign-in repair";
  check("before: Pat is anchored in A with a live seat in B", (await account(pat.id))?.organizationId === A && (await seat(pat.id, B))?.status === "ACTIVE");
  const aStatus = (await prisma.organization.findUnique({ where: { id: A }, select: { status: true } }))!.status;
  // No route suspends a workspace locally (the staff console does in production).
  await prisma.organization.update({ where: { id: A }, data: { status: "SUSPENDED" } });
  let signIn8: SignIn;
  try {
    signIn8 = await pat.signIn();
  } finally {
    await prisma.organization.update({ where: { id: A }, data: { status: aStatus } });
  }
  now = await account(pat.id);
  check(
    "with A suspended, Pat signs in and lands in B, asked for her code by B's rule once she is there (L3)",
    signIn8.ok && signIn8.usedCode && signIn8.errors[0] === "MFA_REQUIRED" && now?.organizationId === B && (await sessionOrg(pat)) === B,
    { signIn: signIn8, account: now },
  );
  check(`A is set back to its own status (${aStatus})`, (await prisma.organization.findUnique({ where: { id: A }, select: { status: true } }))?.status === aStatus);

  // ── 9. B's hard delete (D9) ───────────────────────────────────────
  step = "9 B's hard delete";
  const seatPatA9 = await seat(pat.id, A);
  const seatQuinnA9 = await seat(quinn.id, A);
  const boMemberships = await prisma.organizationMembership.count({ where: { userId: bo.id, organizationId: { not: B } } });
  check(
    "before: Pat and Quinn are anchored in B with a live seat in A; Bo belongs nowhere else",
    (await account(pat.id))?.organizationId === B && seatPatA9?.status === "ACTIVE" && !seatPatA9.removedAt && (await account(quinn.id))?.organizationId === B && seatQuinnA9?.status === "ACTIVE" && boMemberships === 0,
    { seatPatA9, seatQuinnA9, boMemberships },
  );
  const del9 = await bo.json("POST", "/api/organizations/delete", { confirmName: NAME_B, confirmPhrase: "DELETE" });
  check("Bo asks for B's deletion (POST /api/organizations/delete 200, CANCELLED)", del9.status === 200 && del9.body.status === "CANCELLED", del9.body);
  // The 30 days of grace are made past here: no route does that.
  await setSchedule(B, new Date(Date.now() - 60_000).toISOString());
  const others = await prisma.$queryRaw<Array<{ id: string; scheduled: string }>>`
    SELECT "id", "settings"->>'scheduledHardDeleteAt' AS "scheduled" FROM "Organization"
     WHERE "status" = 'CANCELLED' AND "id" <> ${B} AND "settings"->>'scheduledHardDeleteAt' IS NOT NULL`;
  let cron: Reply | null = null;
  try {
    for (const o of others) {
      held.push(o);
      await setSchedule(o.id, FAR_AHEAD);
    }
    if (others.length) console.log(`Held the deletion date of ${others.length} other cancelled compan${others.length === 1 ? "y" : "ies"} while the cron runs.`);
    cron = await readReply(await fetch(`${BASE}/api/cron/org-hard-delete`, { method: "POST", headers: { "x-cron-secret": CRON_SECRET } }));
  } finally {
    const putBack = await putHeldBack();
    const after = others.length
      ? await prisma.$queryRaw<Array<{ id: string; scheduled: string }>>`SELECT "id", "settings"->>'scheduledHardDeleteAt' AS "scheduled" FROM "Organization" WHERE "id" = ANY(${others.map((o) => o.id)}::text[])`
      : [];
    const same = others.every((o) => after.find((a) => a.id === o.id)?.scheduled === o.scheduled);
    check(`every other cancelled company (${others.length}) kept, its deletion date put back exactly`, putBack && same && after.length === others.length, { others, after });
  }
  check("POST /api/cron/org-hard-delete with CRON_SECRET (200)", cron?.status === 200, cron?.body);
  const bLeft = {
    org: await prisma.organization.count({ where: { id: B } }),
    memberships: await prisma.organizationMembership.count({ where: { organizationId: B } }),
    anchored: await prisma.user.count({ where: { organizationId: B } }),
    invitations: await prisma.invitation.count({ where: { organizationId: B } }),
    scimTokens: await prisma.scimToken.count({ where: { organizationId: B } }),
    activity: await prisma.activityLog.count({ where: { organizationId: B } }),
    bo: await prisma.user.count({ where: { id: bo.id } }),
  };
  check("B's rows are gone: the company, its memberships, its accounts (Bo's), invitations, SCIM tokens and its log", Object.values(bLeft).every((n) => n === 0), bLeft);
  const record9 = await prisma.workspaceDeletion.findFirst({ where: { organizationId: B }, select: { hardDeletedAt: true } });
  check("the deletion record (no name) is stamped hardDeletedAt", !!record9?.hardDeletedAt, record9);
  now = await account(pat.id);
  check("Pat's account still exists, anchored in A and live", now?.organizationId === A && now.status === "ACTIVE" && now.deletedAt === null, now);
  const quinn9 = await account(quinn.id);
  check("Quinn's account moved home to A (D9), live at his level there (Manager)", quinn9?.organizationId === A && quinn9.status === "ACTIVE" && quinn9.deletedAt === null && quinn9.accessLevel === "MANAGER", quinn9);
  const signIn9 = await pat.signIn();
  check("Pat signs in, to A", signIn9.ok && (await sessionOrg(pat)) === A, signIn9);

  // ── 10. Pat works nowhere else (D4), and the way back ─────────────
  step = "10 D4 and the way back";
  before = await account(pat.id);
  const t10 = new Date();
  const rm10 = await ada.json("DELETE", `/api/users/${pat.id}`);
  now = await account(pat.id);
  check(
    "Ada removes Pat, who works nowhere else (200): the account ends (D4): INACTIVE, removed, tokenVersion + 1",
    rm10.status === 200 && now?.organizationId === A && now.status === "INACTIVE" && !!now.deletedAt && now.tokenVersion === (before?.tokenVersion ?? 0) + 1,
    { reply: rm10.body, account: now },
  );
  const audit10 = await auditRow(A, "user_removed", pat.id, t10);
  check("A's audit row says the account ended", (audit10?.metadata as Json)?.outcome === "account_ended", audit10);
  const signIn10 = await pat.signIn();
  check("Pat cannot sign in (This account is no longer active)", !signIn10.ok && /no longer active/.test(signIn10.errors.join(" ")), signIn10);
  // D13 is about a membership; an account ended where it is anchored comes
  // back through a restore (D4: "as today"; D6), so both invitations are
  // refused, the Admin's too (see "Step 5, built" in the plan).
  const moInv10 = await mo.json("POST", "/api/invitations", { email: pat.email, accessLevel: "EMPLOYEE" });
  const adaInv10 = await ada.json("POST", "/api/invitations", { email: pat.email, accessLevel: "EMPLOYEE" });
  const open10 = (await openInvitations(A, pat.email)).filter((i) => i.expiresAt > new Date());
  check("Mo's invitation of Pat's address is refused", moInv10.status >= 400 && moInv10.status < 500, moInv10.body);
  check("Ada's is refused too, as before this change (400 User already exists in your organization), and no invitation is open", adaInv10.status === 400 && /already exists/.test(String(adaInv10.body.error)) && open10.length === 0, { reply: adaInv10.body, open: open10 });
  const removed10 = await directoryRow(ada, pat.email, "removed");
  check("A's Directory Removed view lists Pat, the way back", !!removed10.row && !!removed10.row.deletedAt, removed10.row ?? removed10.reply.body);
  const restore10 = await ada.json("DELETE", `/api/users/${pat.id}?restore=true`);
  now = await account(pat.id);
  check("Ada restores her from it (200): the account is ACTIVE again, an Employee", restore10.status === 200 && now?.status === "ACTIVE" && now.deletedAt === null && now.accessLevel === "EMPLOYEE", { reply: restore10.body, account: now });
  const signIn10b = await pat.signIn();
  check("Pat signs in, to A", signIn10b.ok && (await sessionOrg(pat)) === A, signIn10b);

  // ── 11. The dev server's log ──────────────────────────────────────
  step = "11 the log";
  const log = fileSince(DEV_LOG, devMark);
  const fives = log.split("\n").filter((l) => / 500 in /.test(l));
  check("no 500 in the dev server's log", !!DEV_LOG && fives.length === 0, fives.slice(0, 10));
}

async function proveAndCleanUp(): Promise<number> {
  let failedHard: unknown = null;
  try {
    await main();
  } catch (err) {
    failedHard = err;
    check("the proof ran to the end", false, err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.slice(0, 1500) : String(err));
  } finally {
    if (held.length > 0) await putHeldBack();
    if (process.env.KEEP === "1") {
      console.log(`KEEP=1: workspaces kept (${orgIds.join(", ")}). Delete them by hand.`);
    } else {
      step = "cleanup";
      try {
        await deleteWorkspaces();
        const left = await prisma.organization.count({ where: { id: { in: orgIds } } });
        const usersLeft = await prisma.user.count({ where: { email: { in: PEOPLE.map(emailOf) } } });
        check("the throwaway workspaces and their people are deleted", left === 0 && usersLeft === 0, { left, usersLeft });
      } catch (err) {
        check("the throwaway workspaces are deleted", false, err instanceof Error ? err.message : String(err));
      }
    }
    await prisma.$disconnect();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nScreenshots (${shotList.length}) in ${SHOTS}:`);
  for (const s of shotList) console.log(`  ${s.file}: ${s.what}`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  FAIL ${f.id} [${f.step}] ${f.name}`);
  }
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ""}.`);
  return failed.length || failedHard ? 1 : 0;
}

void proveAndCleanUp().then((code) => process.exit(code));
