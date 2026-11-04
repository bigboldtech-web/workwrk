// The live proof of "A person's manager and profile in each workspace"
// (docs/plans/workspace-status-2.md, step 9: checks L1 onwards).
//
// WHAT IT HOLDS THE CODE TO. Two throwaway workspaces, A and B, and people
// who belong to both, driven over HTTP through the real routes as real
// people would, with the local rows read after each step:
//
//   1. each workspace's Reports to is its own row (E1): B sets Pat's line,
//      A's line stays, and both hold through Pat's switch into B and back
//      (E3, the swap);
//   2. trees, reach and the readers that follow a line (My team, Who can
//      see this record, people data, a digest manager, the weekly review
//      queue, the Team calendar) read this workspace's line, and the walk
//      through someone who manages Pat in A never crosses into B (E5);
//   3. dotted lines are each workspace's own (E2), and none to an Agent;
//   4. B's handover of Dana moves B's reports only, and A's lines stay; a
//      restore, a reactivation and a re-invitation each clear only B's stale
//      lines (E4, E6, the step 4 review M1);
//   5. B's People team edits Pat's B profile and lines, each on the B
//      membership; her name, phone, photo and birthday are refused; a job
//      title assigns her no KRA or SOP and the answer says so (E7, the step
//      5 review M1);
//   6. the pickers, a task, a message and Workload reach her (E12, E13);
//   7. B's identity provider is ignored until Bo turns on Provisioning's
//      "Let your identity provider set Reports to" (the final review, H1);
//      then it sets and removes her B manager through the enterprise
//      extension, and a refused manager writes one audit row and nothing
//      else (E9 i, step 7), in the shapes Okta and Entra send;
//   8. B's announcement, policy, survey and goal to B's Design reach her and
//      never Rita, whom B deactivated (E15, step 8);
//   9. the after-deploy window check lists none of the proof's rows (all
//      written by the new release, after its T1);
//   10. at 5,000 people (direct inserts into two throwaway scale
//      workspaces, deleted at the end): the raw walks with EXPLAIN ANALYZE,
//      a request through a manager anchored elsewhere, the Directory sorted
//      by reports, a bulk Change manager of 200 and a SCIM Group replace of
//      200, each FAILED past 2 seconds, and a SCIM Group replace of 5,000,
//      FAILED past 5 seconds (one transaction per request since step 9);
//      and, reported only, a bulk change of 2,000, an announcement to
//      everyone and the membership half with a department;
//   11. and the dev server logs no 500.
//
// THE PEOPLE. Ari registers A and Bo registers B. In A, Ari adds Max
// (Manager), Pat (Employee, A's Ops, Analyst, London), Rita and Ada
// (Manager). In B, Bo adds Dana (Manager), Hana (HR, the People team) and
// Lee. Dana joins A by invitation (a Manager there), Max, Pat and Ada (an
// Agent) join B, each moving there and switching back. Rita and a newcomer,
// Cole, join B from Bo's bulk import with Reports to Max. A's lines: Max
// under Dana, Pat and Rita and Ada as set below; B's: Max, Lee, Ada under
// Dana, Rita and Cole under Max.
//
// The database is written only for what no local route does: the scale
// workspaces' people and memberships (direct inserts, one statement each,
// deleted at the end with those workspaces) and their planner statistics
// (ANALYZE), and B's plan, set to Growth so Bo can turn Talk on (billing or
// the staff console changes a plan in production). Everything else goes
// through a route.
//
// LOCAL ONLY. It refuses any database but Postgres on this machine
// (localhost:5432), reads only .env.local, never .env, and never imports or
// runs scripts/deploy-migrations.mjs: prisma/sql/2026-11-03-workspace-lines.sql
// is applied to the local database beforehand, and the preflight checks its
// columns and marker. Its people are @proof.test accounts and planted
// @scale.lines.test rows in four throwaway workspaces, deleted at the end in
// the hard-delete order (KEEP=1 keeps them).
//
// RUN it with the launch tools' runner, which starts a fresh dev server on
// :3016 from this branch, runs this file and stops the server by its own PIDs:
//
//   PROOF=scripts/live-proof-workspace-lines.ts ~/workwrk-launch-backup/tools/run-status-proof.sh <run-name>
//
// What it reads from the environment:
//   BASE         the dev server (default http://localhost:3016)
//   DEV_LOG      the dev server's output file: the last check counts its 500s
//   SHOTS        where the EXPLAIN plans and the timings are written
//   KEEP=1       keep the workspaces
//
// TIMING. Each scale measure is run once to warm it (a dev server compiles
// a route on its first request), then three times; the median is reported
// with every run, and a gated measure FAILS when its median is over 2,000 ms.

import { config } from "dotenv";
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";

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
const DEV_LOG = process.env.DEV_LOG || "";
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), "lines-proof-"));
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36);
const PASSWORD = `Lines-${RUN}-Pw7!`;
const NET = 20 + (Date.now() % 200);
let ipSeq = 0;
const freshIp = () => {
  ipSeq += 1;
  return `10.${NET}.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
};

// ── The database client: the proof's and the app's ─────────────────
//
// The app's modules the proof calls (the raw walks, the digest manager, the
// placement halves) read through src/lib/prisma.ts, which reuses a client
// cached for the generated class. The proof puts its own client there first,
// one that reports each statement, so the EXPLAIN ANALYZE of a walk runs the
// very statement the app sent, with its values.

type QueryEvent = { query: string; params: string };
const captured: QueryEvent[] = [];
let capturing = false;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }), log: [{ emit: "event", level: "query" }] });
(prisma as unknown as { $on: (e: "query", f: (x: QueryEvent) => void) => void }).$on("query", (e) => {
  if (capturing) captured.push({ query: e.query, params: e.params });
});
(globalThis as unknown as { prismaByClass?: WeakMap<object, unknown> }).prismaByClass = new WeakMap<object, unknown>([[PrismaClient, prisma]]);

/** A plain connection for EXPLAIN and the after-deploy check: values sent untyped, as the app's statements bind them. */
async function withPg<T>(run: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}

// ── Checks ──────────────────────────────────────────────────────────

const results: Array<{ id: string; step: string; name: string; ok: boolean; detail?: string }> = [];
let step = "setup";
let seq = 0;

/** One check, numbered L1, L2 and so on in the order they run. */
function check(name: string, ok: boolean, detail?: unknown): boolean {
  seq += 1;
  const id = `L${seq}`;
  const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 1800);
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

const sorted = (xs: Iterable<string | null | undefined>) => [...xs].filter((x): x is string => !!x).sort();
const same = (a: Iterable<string | null | undefined>, b: Iterable<string | null | undefined>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const ok2 = (s: number) => s === 200 || s === 201;

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

class Person {
  jar = new Map<string, string>();
  password = PASSWORD;
  id = "";
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

  /** A fresh sign-in with the password, as the sign-in page does. */
  async signIn(): Promise<{ ok: boolean; error: string }> {
    this.jar.clear();
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { "x-real-ip": this.ip } });
    this.keepCookies(csrfRes);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: this.cookieHeader(), "x-real-ip": this.ip },
      body: new URLSearchParams({ csrfToken, email: this.email, password: this.password, json: "true", callbackUrl: `${BASE}/home` }),
    });
    this.keepCookies(res);
    const answer = await readReply(res);
    return this.sessionCookieName ? { ok: true, error: "" } : { ok: false, error: signInError(answer) };
  }

  async signInOrThrow(): Promise<void> {
    const r = await this.signIn();
    if (!r.ok) throw new Error(`${this.name} could not sign in: ${r.error}`);
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

// ── Rows ────────────────────────────────────────────────────────────

const ACCOUNT = {
  id: true, organizationId: true, managerId: true, status: true, deletedAt: true, accessLevel: true, departmentId: true, roleId: true, officeId: true,
  weeklyCapacityHours: true, workSchedule: true, customFields: true, firstName: true, lastName: true, phone: true, avatar: true, dateOfBirth: true, updatedAt: true,
} as const;
const SEAT = {
  id: true, role: true, status: true, removedAt: true, managerId: true, departmentId: true, roleId: true, officeId: true,
  weeklyCapacityHours: true, workSchedule: true, customFields: true, updatedAt: true,
} as const;

async function account(id: string) {
  return prisma.user.findUnique({ where: { id }, select: ACCOUNT });
}

async function seat(userId: string, organizationId: string) {
  return prisma.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: SEAT });
}

/** The line a workspace holds for a person: the account's where they are anchored there, the membership's elsewhere (E1). */
async function lineIn(userId: string, organizationId: string): Promise<string | null | undefined> {
  const a = await account(userId);
  if (!a) return undefined;
  if (a.organizationId === organizationId) return a.managerId;
  return (await seat(userId, organizationId))?.managerId ?? null;
}

async function dottedIn(userId: string, organizationId: string): Promise<string[]> {
  return sorted((await prisma.userDottedLine.findMany({ where: { userId, organizationId }, select: { managerId: true } })).map((r) => r.managerId));
}

async function auditRows(organizationId: string, type: string, targetId: string, since: Date) {
  return prisma.activityLog.findMany({
    where: { organizationId, type, targetId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, metadata: true, oldValue: true, newValue: true, actorLabel: true, createdAt: true },
  });
}

async function openInvitationToken(organizationId: string, email: string): Promise<string> {
  const inv = await prisma.invitation.findFirst({
    where: { organizationId, accepted: false, email: { equals: email, mode: "insensitive" }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  return inv?.token ?? "";
}

// ── What the people see ─────────────────────────────────────────────

async function switchTo(p: Person, organizationId: string): Promise<Reply> {
  const r = await p.json("POST", "/api/me/switch-org", { organizationId });
  if (r.status === 200) await p.refreshSession();
  return r;
}

async function sessionOrg(p: Person): Promise<string | null> {
  const s = await p.session();
  return typeof s.user?.organizationId === "string" ? s.user.organizationId : null;
}

async function myTeam(viewer: Person): Promise<{ status: number; teamIds: string[]; direct: string[]; managerOf: Map<string, string | null> }> {
  const r = await viewer.json("GET", "/api/my-team");
  const members = (r.body.members ?? []) as Json[];
  return {
    status: r.status,
    teamIds: sorted((r.body.teamIds ?? []) as string[]),
    direct: sorted((r.body.directReportIds ?? []) as string[]),
    managerOf: new Map(members.map((m) => [String(m.id), (m.managerId as string | null) ?? null])),
  };
}

async function record(viewer: Person, id: string): Promise<Reply> {
  return viewer.json("GET", `/api/users/${id}`);
}

async function recordAccess(viewer: Person, id: string): Promise<{ status: number; chain: string[]; dotted: string[] }> {
  const r = await viewer.json("GET", `/api/users/${id}/record-access`);
  const groups = (r.body.groups ?? []) as Json[];
  const ids = (key: string) => ((groups.find((g) => g.key === key)?.people ?? []) as Json[]).map((p) => String(p.id));
  return { status: r.status, chain: ids("chain"), dotted: ids("dotted") };
}

async function dottedGet(viewer: Person, id: string): Promise<{ status: number; ids: string[] }> {
  const r = await viewer.json("GET", `/api/users/${id}/dotted-lines`);
  return { status: r.status, ids: sorted(((r.body.managers ?? []) as Json[]).map((m) => String(m.id))) };
}

function week(): { from: string; to: string } {
  const d = new Date();
  const from = new Date(d.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(d.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

async function teamCalendar(viewer: Person): Promise<{ status: number; hasTeam: boolean; calendar: string; teamDenied: boolean; people: string[] }> {
  const { from, to } = week();
  const r = await viewer.json("GET", `/api/calendar/events?calendar=team&kinds=task&from=${from}T00:00:00Z&to=${to}T23:59:59Z`);
  return { status: r.status, hasTeam: r.body.hasTeam === true, calendar: String(r.body.calendar ?? ""), teamDenied: r.body.teamDenied === true, people: sorted(((r.body.people ?? []) as Json[]).map((p) => String(p.id))) };
}

let scimToken = "";
async function scim(method: string, path: string, body?: unknown, token = scimToken): Promise<Reply> {
  const res = await fetch(`${BASE}/api/scim/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/scim+json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readReply(res);
}
const SCIM_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const scimManagerOf = (r: Reply): string | null => ((r.body[ENTERPRISE] as Json | undefined)?.manager?.value as string | undefined) ?? null;

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
const PEOPLE = ["ari", "bo", "pat", "max", "dana", "rita", "ada", "hana", "lee", "cole", "sol", "tia", "danat"];
const emailOf = (first: string) => `${first}.lines@proof.test`;
const NAME_A = `Lines Proof A ${RUN}`;
const NAME_B = `Lines Proof B ${RUN}`;
const NAME_S = `Lines Scale S ${RUN}`;
const NAME_T = `Lines Scale T ${RUN}`;
const NAME_PREFIXES = ["Lines Proof ", "Lines Scale "];
const SLUG_PREFIXES = ["lines-proof-", "lines-scale-"];
const PLANT = `lsc${RUN}`;
const PLANT_EMAIL = "@scale.lines.test";
const peopleIds: string[] = [];

async function sweepLeftovers(): Promise<void> {
  const leftOver = await prisma.organization.findMany({
    where: { AND: [{ OR: NAME_PREFIXES.map((p) => ({ name: { startsWith: p } })) }, { OR: SLUG_PREFIXES.map((p) => ({ slug: { startsWith: p } })) }] },
    select: { id: true },
  });
  if (leftOver.length > 0) {
    orgIds.push(...leftOver.map((o) => o.id));
    await deleteWorkspaces();
    orgIds.length = 0;
    console.log(`Deleted ${leftOver.length} workspace(s) an earlier run left behind.`);
  }
  const taken = await prisma.user.count({ where: { OR: [{ email: { in: PEOPLE.map(emailOf) } }, { email: { endsWith: PLANT_EMAIL } }] } });
  if (taken > 0) throw new Error(`${taken} local account(s) already use an address this proof uses (an earlier proof kept with KEEP=1?); remove them first.`);
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
      { timeout: 600_000, maxWait: 60_000 },
    );
  }
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

// ── The after-deploy check, as a file of statements ─────────────────

/** The file's statements, split on semicolons outside comments, strings and dollar quotes. */
function sqlStatements(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const DASHES = "-".repeat(2);
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const j = end < 0 ? text.length : end + 2;
      cur += text.slice(i, j);
      i = j;
      continue;
    }
    if (text.startsWith(DASHES, i)) {
      const end = text.indexOf("\n", i);
      const j = end < 0 ? text.length : end;
      cur += text.slice(i, j);
      i = j;
      continue;
    }
    if (text.startsWith("$$", i)) {
      const end = text.indexOf("$$", i + 2);
      const j = end < 0 ? text.length : end + 2;
      cur += text.slice(i, j);
      i = j;
      continue;
    }
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (text[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      cur += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim().length > 0);
}

/** A moment as the window check's '<T1>' reads it: UTC, as Prisma stores "timestamp without time zone". */
const asT1 = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

// ── Scale: timings and plans ────────────────────────────────────────

type Measure = { name: string; gated: boolean; limit: number; runs: number[]; median: number; note?: string };
const measures: Measure[] = [];
const GATE_MS = 2000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * One measure: a warm-up (a dev server compiles a route on its first
 * request; a walk's first plan is cold), then `runs` timed runs, each given
 * its index so a write can change something new each time. Gated measures
 * fail past GATE_MS (the median).
 */
async function measure<T>(name: string, run: (i: number) => Promise<T>, opts: { gated: boolean; limit?: number; runs?: number; warm?: (() => Promise<unknown>) | null; note?: string } = { gated: true }): Promise<T> {
  if (opts.warm !== null) await (opts.warm ?? (() => run(-1)))();
  const times: number[] = [];
  let last: T | undefined;
  for (let i = 0; i < (opts.runs ?? 3); i += 1) {
    const t0 = performance.now();
    last = await run(i);
    times.push(Math.round(performance.now() - t0));
  }
  const limit = opts.limit ?? GATE_MS;
  const m = { name, gated: opts.gated, limit, runs: times, median: median(times), note: opts.note };
  measures.push(m);
  const said = `${name}: median ${m.median} ms (runs ${times.join(", ")} ms)`;
  if (opts.gated) check(`${said}, at most ${limit} ms`, m.median <= limit, m);
  else console.log(`  info ${said}${opts.note ? `; ${opts.note}` : ""}`);
  return last as T;
}

type Plan = { name: string; executionMs: number | null; text: string };
const plans: Plan[] = [];

/** EXPLAIN (ANALYZE, BUFFERS) of each statement `call` sends that `pick` keeps, on a plain connection, the values bound as the app bound them. */
async function explainCalls(name: string, call: () => Promise<unknown>, pick: (q: string) => boolean): Promise<Plan[]> {
  captured.length = 0;
  capturing = true;
  try {
    await call();
  } finally {
    capturing = false;
  }
  const kept = captured.filter((c) => pick(c.query));
  const out: Plan[] = [];
  await withPg(async (c) => {
    for (const [k, q] of kept.entries()) {
      const values = JSON.parse(q.params || "[]") as unknown[];
      const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.query}`, values as unknown[]);
      const text = r.rows.map((row: Json) => String(row["QUERY PLAN"])).join("\n");
      const ms = /Execution Time: ([0-9.]+) ms/.exec(text);
      const plan = { name: kept.length > 1 ? `${name} (${k + 1} of ${kept.length})` : name, executionMs: ms ? Number(ms[1]) : null, text: `${q.query}\n\nvalues: ${q.params}\n\n${text}` };
      out.push(plan);
      plans.push(plan);
    }
  });
  return out;
}

// ── The proof ───────────────────────────────────────────────────────

async function main() {
  // ── Preflight ─────────────────────────────────────────────────────
  step = "preflight";
  const devMark = fileMark(DEV_LOG);
  const cols = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; is_nullable: string }>>(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND ((table_name = 'OrganizationMembership' AND column_name = 'managerId') OR (table_name = 'UserDottedLine' AND column_name = 'organizationId'))`,
  );
  const marker = await prisma.$queryRawUnsafe<Array<{ c: string | null }>>(
    `SELECT col_description('"OrganizationMembership"'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'managerId' AND NOT attisdropped)) AS c`,
  );
  check(
    "the local database has 2026-11-03-workspace-lines.sql applied: the membership's line, the dotted line's workspace (NOT NULL) and the marker with its applied time",
    cols.length === 2 && cols.some((c) => c.table_name === "UserDottedLine" && c.is_nullable === "NO") && /workspace-lines-2026-11-03, applied \d{4}-\d{2}-\d{2} [0-9:.]+ UTC/.test(marker[0]?.c ?? ""),
    { cols, marker },
  );
  check("DEV_LOG names the dev server's output, for the last check", fileMark(DEV_LOG) > 0, DEV_LOG || "unset");
  check("the sign-in routes answer (a fresh dev server compiles each route on its first request)", await warmSignIn());
  await sweepLeftovers();
  // T1 for the window check: every row this proof writes is the new release's, after it.
  const T1 = new Date(Date.now() - 1000);

  // The app's own modules, through the proof's client (see above).
  const appPrisma = (await import("../src/lib/prisma")).prisma;
  check("the app's modules read through the proof's client (so a walk's EXPLAIN is its own statement)", appPrisma === prisma);
  const { getTeamUserIds } = await import("../src/lib/team");
  const { getSolidReportTree, getEffectiveReportTree } = await import("../src/lib/reporting-line");
  const { digestManagersOf } = await import("../src/lib/access/digest-recipients");
  const { idsPlacedHere } = await import("../src/lib/access/profile-here");
  const { ALIGNMENT_NOT_HERE } = await import("../src/lib/people/person-fields");

  // ── Setup: two workspaces and their people, through the routes ────
  step = "setup";
  const ari = new Person("Ari", "Ari", "Lines", emailOf("ari"));
  const bo = new Person("Bo", "Bo", "Lines", emailOf("bo"));
  const pat = new Person("Pat", "Pat", "Lines", emailOf("pat"));
  const max = new Person("Max", "Max", "Lines", emailOf("max"));
  const dana = new Person("Dana", "Dana", "Lines", emailOf("dana"));
  const rita = new Person("Rita", "Rita", "Lines", emailOf("rita"));
  const ada = new Person("Ada", "Ada", "Lines", emailOf("ada"));
  const hana = new Person("Hana", "Hana", "Lines", emailOf("hana"));
  const lee = new Person("Lee", "Lee", "Lines", emailOf("lee"));
  const cole = new Person("Cole", "Cole", "Lines", emailOf("cole"));
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
  const A = await register(ari, NAME_A);
  const B = await register(bo, NAME_B);
  if (!A || !B) throw new Error("The two workspaces were not made.");
  console.log(`Workspaces ${NAME_A} (${A}) and ${NAME_B} (${B}); plans and timings in ${SHOTS}`);
  await ari.signInOrThrow();
  await bo.signInOrThrow();

  const make = async (who: Person, path: string, body: Json): Promise<string> => {
    const r = await who.json("POST", path, body);
    return ok2(r.status) ? String(r.body.id ?? r.body.data?.id ?? "") : "";
  };
  const aOps = await make(ari, "/api/departments", { name: `Lines Ops ${RUN}` });
  const aAnalyst = await make(ari, "/api/roles", { title: `Lines Analyst ${RUN}` });
  const aLondon = await make(ari, "/api/offices", { name: `Lines London ${RUN}` });
  const bDesign = await make(bo, "/api/departments", { name: `Lines Design ${RUN}` });
  const bDesigner = await make(bo, "/api/roles", { title: `Lines Designer ${RUN}` });
  const bLeeds = await make(bo, "/api/offices", { name: `Lines Leeds ${RUN}` });
  check("Ari makes A's Ops, Analyst and London; Bo makes B's Design, Designer and Leeds", [aOps, aAnalyst, aLondon, bDesign, bDesigner, bLeeds].every(Boolean), { aOps, aAnalyst, aLondon, bDesign, bDesigner, bLeeds });
  const fieldsA = await ari.json("PUT", "/api/people/profile-fields", { fields: [{ key: "badge", label: "Badge" }] });
  const fieldsB = await bo.json("PUT", "/api/people/profile-fields", { fields: [{ key: "shirt_size", label: "Shirt size" }] });
  check("each workspace defines its own profile field (PUT /api/people/profile-fields 200)", fieldsA.status === 200 && fieldsB.status === 200, { a: fieldsA.body, b: fieldsB.body });

  const addByHand = async (by: Person, p: Person, accessLevel: string, extra: Json = {}) => {
    const r = await by.json("POST", "/api/users", { firstName: p.firstName, lastName: p.lastName, email: p.email, password: p.password, accessLevel, ...extra });
    if (ok2(r.status)) {
      p.id = String(r.body.id ?? r.body.user?.id ?? "");
      peopleIds.push(p.id);
    }
    return r;
  };
  const madeA = [await addByHand(ari, max, "MANAGER"), await addByHand(ari, pat, "EMPLOYEE", { departmentId: aOps, roleId: aAnalyst }), await addByHand(ari, rita, "EMPLOYEE"), await addByHand(ari, ada, "MANAGER")];
  const madeB = [await addByHand(bo, dana, "MANAGER"), await addByHand(bo, hana, "HR"), await addByHand(bo, lee, "EMPLOYEE")];
  check("Ari adds Max (Manager), Pat (A's Ops and Analyst), Rita and Ada (Manager) to A; Bo adds Dana (Manager), Hana (HR) and Lee to B (POST /api/users)", [...madeA, ...madeB].every((r) => ok2(r.status)) && [max, pat, rita, ada, dana, hana, lee].every((p) => !!p.id), [...madeA, ...madeB].map((r) => r.status));
  const patA = await ari.json("PATCH", `/api/users/${pat.id}`, { officeId: aLondon, weeklyCapacityHours: 40, workSchedule: { workdays: [1, 2, 3, 4, 5], hoursPerDay: 8 }, customFields: { badge: "A-7" } });
  check("Ari gives Pat A's London office, 40 hours over Monday to Friday and A's badge (PATCH 200)", patA.status === 200, patA.body);
  for (const p of [max, pat, rita, ada, dana, hana, lee]) await p.signInOrThrow();

  /** An invitation accepted signed in, as the join page does, then the switch back home. */
  const joinAndBack = async (inviter: Person, p: Person, into: string, body: Json, home: string) => {
    const inv = await inviter.json("POST", "/api/invitations", { email: p.email, ...body });
    const token = await openInvitationToken(into, p.email);
    const joined = await p.json("POST", "/api/auth/accept-invite", { token });
    await p.refreshSession();
    const there = (await account(p.id))?.organizationId === into && (await sessionOrg(p)) === into;
    const back = await switchTo(p, home);
    const home2 = (await account(p.id))?.organizationId === home && (await sessionOrg(p)) === home;
    return { ok: inv.status === 201 && !!token && joined.status === 201 && there && back.status === 200 && home2, inv: inv.body, joined: joined.body, back: back.body };
  };
  const danaJoin = await joinAndBack(ari, dana, A, { accessLevel: "MANAGER" }, B);
  check("Dana joins A by invitation as a Manager there (accept-invite 201, moved into A) and switches back to B", danaJoin.ok && (await seat(dana.id, A))?.role === "MANAGER", danaJoin);
  const maxJoin = await joinAndBack(bo, max, B, { accessLevel: "MANAGER" }, A);
  check("Max joins B as a Manager there and switches back to A", maxJoin.ok && (await seat(max.id, B))?.role === "MANAGER", maxJoin);
  const patJoin = await joinAndBack(bo, pat, B, { accessLevel: "EMPLOYEE" }, A);
  check("Pat joins B as an Employee (no Reports to) and switches back to A", patJoin.ok && (await seat(pat.id, B))?.status === "ACTIVE", patJoin);
  const adaJoin = await joinAndBack(bo, ada, B, { accessLevel: "AGENT" }, A);
  check("Ada joins B on the Agent tier and switches back to A, a Manager there", adaJoin.ok && (await seat(ada.id, B))?.role === "AGENT" && (await account(ada.id))?.accessLevel === "MANAGER", adaJoin);

  // A's lines (Dana holds a live Manager seat in A through her membership).
  const aLines = [
    await ari.json("PATCH", `/api/users/${dana.id}`, { managerId: ari.id }),
    await ari.json("PATCH", `/api/users/${max.id}`, { managerId: dana.id }),
    await ari.json("PATCH", `/api/users/${pat.id}`, { managerId: max.id }),
    await ari.json("PATCH", `/api/users/${rita.id}`, { managerId: ari.id }),
    await ari.json("PATCH", `/api/users/${ada.id}`, { managerId: ari.id }),
  ];
  const aDotted = await ari.json("PUT", `/api/users/${pat.id}/dotted-lines`, { managerIds: [ada.id] });
  check(
    "A's lines: Dana under Ari (on her A membership), Max under Dana, Pat under Max, Rita and Ada under Ari, and Pat's A dotted line to Ada",
    aLines.every((r) => r.status === 200) && aDotted.status === 200 && (await seat(dana.id, A))?.managerId === ari.id && (await account(max.id))?.managerId === dana.id && (await account(pat.id))?.managerId === max.id && same(await dottedIn(pat.id, A), [ada.id]),
    { statuses: aLines.map((r) => [r.status, r.body.error]), dotted: aDotted.body },
  );
  // B's lines.
  const bLines = [
    await bo.json("PATCH", `/api/users/${dana.id}`, { managerId: bo.id }),
    await bo.json("PATCH", `/api/users/${max.id}`, { managerId: dana.id }),
    await bo.json("PATCH", `/api/users/${hana.id}`, { managerId: bo.id }),
    await bo.json("PATCH", `/api/users/${lee.id}`, { managerId: dana.id }),
    await bo.json("PATCH", `/api/users/${ada.id}`, { managerId: dana.id }),
  ];
  check(
    "B's lines: Dana and Hana under Bo, Max (on his B membership), Lee and Ada (an Agent, on her B membership) under Dana",
    bLines.every((r) => r.status === 200) && (await account(dana.id))?.managerId === bo.id && (await seat(max.id, B))?.managerId === dana.id && (await seat(ada.id, B))?.managerId === dana.id && (await account(lee.id))?.managerId === dana.id,
    bLines.map((r) => [r.status, r.body.error]),
  );
  check(
    "no workspace's write reached the other's row: Max's account line is A's (Dana), his B membership B's (Dana); Dana's account is B's (Bo), her A membership A's (Ari)",
    (await account(max.id))?.managerId === dana.id && (await account(dana.id))?.managerId === bo.id && (await seat(dana.id, A))?.managerId === ari.id,
  );

  // Bo's bulk import: Rita (an existing account) and Cole (new), Reports to Max (here through a membership).
  const imp = await bo.json("POST", "/api/people/bulk-import", {
    dryRun: false,
    rows: [
      { firstName: "Rita", lastName: "Lines", email: rita.email, reportsTo: max.email },
      { firstName: "Cole", lastName: "Lines", email: cole.email, reportsTo: max.email },
    ],
  });
  const ritaInv = await prisma.invitation.findFirst({ where: { organizationId: B, email: rita.email, accepted: false }, select: { managerId: true, token: true } });
  const coleInv = await prisma.invitation.findFirst({ where: { organizationId: B, email: cole.email, accepted: false }, select: { managerId: true, token: true } });
  check("Bo's bulk import makes two invitations to B, each naming Max (here through a membership) as Reports to", imp.status === 200 && imp.body.summary?.created === 2 && ritaInv?.managerId === max.id && coleInv?.managerId === max.id, { imp: imp.body, ritaInv: ritaInv?.managerId, coleInv: coleInv?.managerId });
  const ritaJoined = await rita.json("POST", "/api/auth/accept-invite", { token: ritaInv?.token ?? "" });
  await rita.refreshSession();
  const ritaBack = await switchTo(rita, A);
  check(
    "Rita joins with her existing account (signed in, E10): her B line is Max, on her B membership; back in A, her A line is Ari",
    ritaJoined.status === 201 && ritaBack.status === 200 && (await seat(rita.id, B))?.managerId === max.id && (await account(rita.id))?.organizationId === A && (await account(rita.id))?.managerId === ari.id,
    { joined: ritaJoined.body, back: ritaBack.body, seatB: await seat(rita.id, B), account: await account(rita.id) },
  );
  const coleJoined = await fetch(`${BASE}/api/auth/accept-invite`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": cole.ip },
    body: JSON.stringify({ token: coleInv?.token ?? "", firstName: cole.firstName, lastName: cole.lastName, password: cole.password }),
  }).then(readReply);
  const coleRow = await prisma.user.findFirst({ where: { email: cole.email }, select: { id: true, organizationId: true, managerId: true } });
  if (coleRow) {
    cole.id = coleRow.id;
    peopleIds.push(cole.id);
  }
  check("Cole, new, joins signed out (201): anchored in B under Max, the import's Reports to", coleJoined.status === 201 && coleRow?.organizationId === B && coleRow.managerId === max.id, { joined: coleJoined.body, row: coleRow });
  const ritaDotted = await bo.json("PUT", `/api/users/${rita.id}/dotted-lines`, { managerIds: [dana.id] });
  check("Bo gives Rita a B dotted line to Dana (PUT 200), B's row", ritaDotted.status === 200 && same(await dottedIn(rita.id, B), [dana.id]) && same(await dottedIn(rita.id, A), []), ritaDotted.body);
  const kra = await bo.json("POST", "/api/kras", { name: `Lines design quality ${RUN}`, roleId: bDesigner, weight: 20 });
  const KRA_ID = String(kra.body.id ?? kra.body.data?.id ?? "");
  check("Bo gives B's Designer job title a KRA (POST /api/kras)", ok2(kra.status) && !!KRA_ID, kra.body);

  const nameOf = new Map([ari, bo, pat, max, dana, rita, ada, hana, lee, cole].map((p) => [p.id, p.name]));
  const named = (ids: Iterable<string>) => [...ids].map((id) => nameOf.get(id) ?? id);

  // ── 1. B sets Pat's Reports to, and the swap ──────────────────────
  step = "1 lines";
  const staleA0 = await seat(pat.id, A);
  check("before: Pat has no B line (her B membership's managerId is empty); her account, A's, names Max", (await seat(pat.id, B))?.managerId === null && (await account(pat.id))?.managerId === max.id);
  const danaTeam0 = await myTeam(dana);
  check(
    "before: Dana's My team in B holds Max and Lee, and not Pat, though Max (in her B tree) manages Pat in A: the walk never crosses into A's line",
    danaTeam0.status === 200 && danaTeam0.teamIds.includes(max.id) && danaTeam0.teamIds.includes(lee.id) && !danaTeam0.teamIds.includes(pat.id),
    named(danaTeam0.teamIds),
  );
  const t1 = new Date();
  const set1 = await bo.json("PATCH", `/api/users/${pat.id}`, { managerId: dana.id });
  check("Bo sets Pat's Reports to Dana in B (PATCH /api/users/[id] 200)", set1.status === 200, set1.body);
  const patAcct1 = await account(pat.id);
  check(
    "rows: B's membership holds Dana; the account, A's, still holds Max; A's own stale membership row is unchanged",
    (await seat(pat.id, B))?.managerId === dana.id && patAcct1?.managerId === max.id && patAcct1.organizationId === A && (await seat(pat.id, A))?.managerId === staleA0?.managerId,
    { seatB: await seat(pat.id, B), account: patAcct1, staleA: [staleA0?.managerId, (await seat(pat.id, A))?.managerId] },
  );
  const log1B = await until(() => auditRows(B, "reporting_line_changed", pat.id, t1), (r) => r.length > 0);
  const log1A = await auditRows(A, "reporting_line_changed", pat.id, t1);
  check("B logs the change (reporting_line_changed, Dana in newValue); A logs nothing", log1B.length === 1 && (log1B[0].newValue as Json)?.managerId === dana.id && log1A.length === 0, { b: log1B, a: log1A });
  const recordLines = async () => ({
    b: ((await record(bo, pat.id)).body.manager as Json | null)?.id ?? null,
    a: ((await record(ari, pat.id)).body.manager as Json | null)?.id ?? null,
  });
  let rec = await recordLines();
  check("Pat's record names Dana in B and Max in A (GET /api/users/[id])", rec.b === dana.id && rec.a === max.id, rec);
  const sw1 = await switchTo(pat, B);
  const patInB = await account(pat.id);
  check(
    "Pat switches to B (POST /api/me/switch-org 200): the account, B's now, takes Dana; A's membership takes Max (E3)",
    sw1.status === 200 && patInB?.organizationId === B && patInB.managerId === dana.id && (await seat(pat.id, A))?.managerId === max.id && (await sessionOrg(pat)) === B,
    { sw: sw1.body, account: patInB, seatA: await seat(pat.id, A) },
  );
  rec = await recordLines();
  const danaTeam1 = await myTeam(dana);
  const maxTeam1 = await myTeam(max);
  check("while anchored in B: her record names Dana in B and Max in A", rec.b === dana.id && rec.a === max.id, rec);
  check("while anchored in B: Dana's My team in B and Max's in A each hold Pat", danaTeam1.teamIds.includes(pat.id) && maxTeam1.teamIds.includes(pat.id) && danaTeam1.direct.includes(pat.id) && maxTeam1.direct.includes(pat.id), { dana: named(danaTeam1.teamIds), max: named(maxTeam1.teamIds) });
  // Her weekly review, written in B, stamped with B's manager.
  const wr = await pat.json("POST", "/api/me/weekly-review");
  const WR_ID = String(wr.body.review?.id ?? "");
  const wrSub = await pat.json("PATCH", `/api/me/weekly-review/${WR_ID}`, { highlights: "Shipped the B launch.", action: "submit" });
  const wrRow = await prisma.weeklyReview.findUnique({ where: { id: WR_ID }, select: { organizationId: true, managerId: true, status: true } });
  check("Pat, in B, writes and submits her weekly review: B's row, stamped with Dana (effectiveManagerOf in B)", wr.status === 200 && wrSub.status === 200 && wrRow?.organizationId === B && wrRow.managerId === dana.id && wrRow.status === "SUBMITTED", { wr: wr.body, sub: wrSub.body.error, row: wrRow });
  const sw2 = await switchTo(pat, A);
  const patBack = await account(pat.id);
  check(
    "Pat switches back to A: the account takes Max again, B's membership keeps Dana",
    sw2.status === 200 && patBack?.organizationId === A && patBack.managerId === max.id && (await seat(pat.id, B))?.managerId === dana.id && (await sessionOrg(pat)) === A,
    { sw: sw2.body, account: patBack, seatB: await seat(pat.id, B) },
  );
  rec = await recordLines();
  check("back in A: her record names Dana in B and Max in A", rec.b === dana.id && rec.a === max.id, rec);

  // ── 2. Trees and reach ────────────────────────────────────────────
  step = "2 trees and reach";
  const danaTeam = await myTeam(dana);
  check(
    "Dana's My team in B (team.ts's walk) holds Pat as a direct report, by her B membership's line, with Max and Lee",
    danaTeam.status === 200 && danaTeam.direct.includes(pat.id) && danaTeam.direct.includes(max.id) && danaTeam.direct.includes(lee.id) && danaTeam.managerOf.get(pat.id) === dana.id,
    { team: named(danaTeam.teamIds), direct: named(danaTeam.direct) },
  );
  const maxTeamA = await myTeam(max);
  check(
    "Max's My team in A holds Pat as a direct report, and nobody of B's lines (not Rita or Cole, who report to him in B)",
    maxTeamA.direct.includes(pat.id) && !maxTeamA.teamIds.includes(cole.id) && !maxTeamA.direct.includes(rita.id) && maxTeamA.managerOf.get(pat.id) === max.id,
    { team: named(maxTeamA.teamIds), direct: named(maxTeamA.direct) },
  );
  const raB = await recordAccess(bo, pat.id);
  const raA = await recordAccess(ari, pat.id);
  check("Who can see Pat's record in B: Dana, then Bo, up B's line; never Max", raB.status === 200 && JSON.stringify(raB.chain) === JSON.stringify([dana.id, bo.id]), named(raB.chain));
  check("in A: Max, then Dana, then Ari, up A's line", raA.status === 200 && JSON.stringify(raA.chain) === JSON.stringify([max.id, dana.id, ari.id]), named(raA.chain));
  const danaReads = await record(dana, pat.id);
  const leeReads = await record(lee, pat.id);
  const maxReadsA = await record(max, pat.id);
  check("reach: Dana reads the people data B holds of Pat (profileData); Lee, outside her line, does not", danaReads.status === 200 && danaReads.body.access?.profileData === true && leeReads.body.access?.profileData !== true, { dana: danaReads.body.access, lee: leeReads.body.access });
  check("reach: Max reads Pat's people data in A (peopleData)", maxReadsA.status === 200 && maxReadsA.body.access?.peopleData === true, maxReadsA.body.access);
  const digestB = (await digestManagersOf(B, [pat.id])).get(pat.id) as Json | undefined;
  const digestA = (await digestManagersOf(A, [pat.id])).get(pat.id) as Json | undefined;
  check("the digest manager (digest-recipients.ts, as the reminders cron reads it): Dana in B, Max in A", (digestB?.id ?? digestB?.userId) === dana.id && (digestA?.id ?? digestA?.userId) === max.id, { b: digestB, a: digestA });
  const queueDana = await dana.json("GET", "/api/team/weekly-reviews?status=SUBMITTED");
  const queueMaxA = await max.json("GET", "/api/team/weekly-reviews");
  check(
    "the weekly review queue: Dana's in B holds Pat's B review; Max's in A does not",
    queueDana.status === 200 && ((queueDana.body.reviews ?? []) as Json[]).some((r) => r.id === WR_ID) && !((queueMaxA.body.reviews ?? []) as Json[]).some((r) => r.id === WR_ID),
    { dana: [queueDana.status, ((queueDana.body.reviews ?? []) as Json[]).map((r) => r.id)], maxA: [queueMaxA.status, ((queueMaxA.body.reviews ?? []) as Json[]).map((r) => r.id)] },
  );
  const calDana = await teamCalendar(dana);
  const calMaxA = await teamCalendar(max);
  const calLee = await teamCalendar(lee);
  check("the calendar's Team pill: Dana's in B and Max's in A are on (hasTeam), Lee's in B is off", calDana.hasTeam && calMaxA.hasTeam && !calLee.hasTeam, { dana: calDana, maxA: calMaxA, lee: calLee });
  check("the Team calendar (reporting-line.ts's walk) opens for Dana in B and for Max in A", calDana.calendar === "team" && !calDana.teamDenied && calMaxA.calendar === "team" && !calMaxA.teamDenied, { dana: calDana, maxA: calMaxA });
  check("the Team calendar's People in A list Pat (anchored there) for Max", calMaxA.people.includes(pat.id), named(calMaxA.people));
  check("the Team calendar's People in B list Pat (here through a membership) for Dana", calDana.people.includes(pat.id), named(calDana.people));
  // Max in B.
  const maxToB = await switchTo(max, B);
  const maxTeamB = await myTeam(max);
  const maxReadsB = await record(max, pat.id);
  const calMaxB = await teamCalendar(max);
  const queueMaxB = await max.json("GET", "/api/team/weekly-reviews");
  check(
    "Max, switched into B: his My team holds Rita and Cole (B's lines to him) and never Pat, whom he manages in A",
    maxToB.status === 200 && maxTeamB.teamIds.includes(rita.id) && maxTeamB.teamIds.includes(cole.id) && !maxTeamB.teamIds.includes(pat.id),
    { sw: maxToB.body, team: named(maxTeamB.teamIds) },
  );
  check("in B Max reads none of Pat's people data, his Team calendar has no Pat, and his queue no Pat review", maxReadsB.status === 200 && maxReadsB.body.access?.profileData !== true && !calMaxB.people.includes(pat.id) && !((queueMaxB.body.reviews ?? []) as Json[]).some((r) => r.id === WR_ID), { access: maxReadsB.body.access, cal: calMaxB, queue: queueMaxB.status });
  const maxHome = await switchTo(max, A);
  check("Max switches back to A: his A line (Dana) and B line (Dana) are each where they were", maxHome.status === 200 && (await account(max.id))?.managerId === dana.id && (await seat(max.id, B))?.managerId === dana.id, { sw: maxHome.body, account: await account(max.id), seatB: await seat(max.id, B) });

  // ── 3. Dotted lines ───────────────────────────────────────────────
  step = "3 dotted lines";
  const dot3 = await bo.json("PUT", `/api/users/${pat.id}/dotted-lines`, { managerIds: [max.id] });
  check("Bo adds Pat's B dotted line to Max (PUT /api/users/[id]/dotted-lines 200)", dot3.status === 200 && same(dot3.body.managerIds ?? [], [max.id]), dot3.body);
  check("rows: B holds Pat's line to Max, A holds only hers to Ada", same(await dottedIn(pat.id, B), [max.id]) && same(await dottedIn(pat.id, A), [ada.id]), { b: await dottedIn(pat.id, B), a: await dottedIn(pat.id, A) });
  const dgA = await dottedGet(ari, pat.id);
  const dgB = await dottedGet(bo, pat.id);
  check("A's dotted lines for Pat (GET) are Ada only: A never sees B's line to Max; B's are Max only", dgA.status === 200 && same(dgA.ids, [ada.id]) && dgB.status === 200 && same(dgB.ids, [max.id]), { a: named(dgA.ids), b: named(dgB.ids) });
  const ra3B = await recordAccess(bo, pat.id);
  const ra3A = await recordAccess(ari, pat.id);
  check("Who can see the record lists B's dotted manager (Max) in B and A's (Ada) in A", same(ra3B.dotted, [max.id]) && same(ra3A.dotted, [ada.id]), { b: named(ra3B.dotted), a: named(ra3A.dotted) });
  const dotAgent = await bo.json("PUT", `/api/users/${pat.id}/dotted-lines`, { managerIds: [max.id, ada.id] });
  check("a B dotted line to Ada, an Agent in B, is refused (400), and B's rows are unchanged", dotAgent.status === 400 && same(await dottedIn(pat.id, B), [max.id]) && same(await dottedIn(pat.id, A), [ada.id]), { status: dotAgent.status, body: dotAgent.body });

  // ── 5. B's People team edits Pat's B profile ──────────────────────
  step = "5 editing";
  const acct5 = await account(pat.id);
  const t5 = new Date();
  const title5 = await hana.json("PATCH", `/api/users/${pat.id}`, { roleId: bDesigner });
  const kras5 = await prisma.kRAAssignment.count({ where: { userId: pat.id } });
  const sops5 = await prisma.sOPAssignment.count({ where: { userId: pat.id } });
  check("Hana (HR, B's People team) gives Pat B's Designer job title (200): on her B membership", title5.status === 200 && (await seat(pat.id, B))?.roleId === bDesigner, title5.body);
  check(`the new job title assigns her no KRA and no SOP, and the answer says so ("${ALIGNMENT_NOT_HERE}")`, title5.body.alignmentNote === ALIGNMENT_NOT_HERE && kras5 === 0 && sops5 === 0, { note: title5.body.alignmentNote, kras5, sops5 });
  const leeTitle = await hana.json("PATCH", `/api/users/${lee.id}`, { roleId: bDesigner, departmentId: bDesign });
  const leeKra = await prisma.kRAAssignment.count({ where: { userId: lee.id, kraId: KRA_ID } });
  check("the same job title for Lee, anchored in B, assigns him its KRA (the rule stays for people anchored here)", leeTitle.status === 200 && leeKra === 1, { status: leeTitle.status, leeKra });
  const place5 = await hana.json("PATCH", `/api/users/${pat.id}`, { departmentId: bDesign, officeId: bLeeds });
  const hours5 = await hana.json("PATCH", `/api/users/${pat.id}`, { weeklyCapacityHours: 10, workSchedule: { workdays: [1, 2], hoursPerDay: 5 } });
  const fields5 = await hana.json("PATCH", `/api/users/${pat.id}`, { customFields: { shirt_size: "M" } });
  const line5 = await hana.json("PATCH", `/api/users/${pat.id}`, { managerId: lee.id });
  const dot5 = await hana.json("PUT", `/api/users/${pat.id}/dotted-lines`, { managerIds: [bo.id] });
  const seat5 = await seat(pat.id, B);
  check("Hana's writes each answer 200 (department and office, hours and working week, profile field, Reports to, dotted lines)", [place5, hours5, fields5, line5, dot5].every((r) => r.status === 200), [place5, hours5, fields5, line5, dot5].map((r) => [r.status, r.body.error]));
  check("department Design and office Leeds land on the B membership", seat5?.departmentId === bDesign && seat5.officeId === bLeeds, seat5);
  check("10 hours over Monday and Tuesday land on the B membership", seat5?.weeklyCapacityHours === 10 && JSON.stringify((seat5?.workSchedule as Json | null)?.workdays) === JSON.stringify([1, 2]), seat5);
  check("the shirt size lands on the B membership's profile fields", (seat5?.customFields as Json | null)?.shirt_size === "M", seat5?.customFields);
  check("Reports to Lee lands on the B membership", seat5?.managerId === lee.id, seat5?.managerId);
  check("the dotted lines land on B's rows (Bo), and A's row to Ada stays", same(await dottedIn(pat.id, B), [bo.id]) && same(await dottedIn(pat.id, A), [ada.id]), { b: await dottedIn(pat.id, B), a: await dottedIn(pat.id, A) });
  const acct5b = await account(pat.id);
  check(
    "her account, A's, is exactly as before: A's Ops, Analyst, London, 40 hours, Monday to Friday, A's badge, and Max",
    !!acct5 && !!acct5b && acct5b.departmentId === aOps && acct5b.roleId === aAnalyst && acct5b.officeId === aLondon && acct5b.weeklyCapacityHours === 40 && JSON.stringify(acct5b.workSchedule) === JSON.stringify(acct5.workSchedule) && JSON.stringify(acct5b.customFields) === JSON.stringify({ badge: "A-7" }) && acct5b.managerId === max.id,
    { before: acct5, after: acct5b },
  );
  const refusals: Array<[string, Json]> = [
    ["name", { firstName: "Patricia" }],
    ["phone", { phone: "+44 20 7946 0000" }],
    ["photo", { avatar: "https://example.test/pat.png" }],
    ["birthday", { dateOfBirth: "1990-04-01" }],
  ];
  for (const [what, body] of refusals) {
    const r = await hana.json("PATCH", `/api/users/${pat.id}`, body);
    const now = await account(pat.id);
    const untouched = now?.firstName === acct5b?.firstName && now?.phone === acct5b?.phone && now?.avatar === acct5b?.avatar && now?.dateOfBirth?.getTime() === acct5b?.dateOfBirth?.getTime();
    check(`her ${what} is refused (403 identity_shared, the shared-identity sentence), nothing written`, r.status === 403 && r.body.code === "identity_shared" && untouched, { status: r.status, body: r.body });
  }
  const rec5 = await record(hana, pat.id);
  check(
    "Pat's B record shows what B holds: Designer, Design, Leeds, Lee, 10 hours and the shirt size",
    rec5.status === 200 && rec5.body.role?.id === bDesigner && rec5.body.department?.id === bDesign && rec5.body.office?.id === bLeeds && rec5.body.manager?.id === lee.id && rec5.body.weeklyCapacityHours === 10 && ((rec5.body.profileFields ?? []) as Json[]).some((f) => f.key === "shirt_size" && f.value === "M"),
    { role: rec5.body.role, department: rec5.body.department, office: rec5.body.office, manager: rec5.body.manager, hours: rec5.body.weeklyCapacityHours, fields: rec5.body.profileFields },
  );
  const rec5A = await record(ari, pat.id);
  check("her A record still shows A's: Analyst, Ops, London, Max", rec5A.body.role?.id === aAnalyst && rec5A.body.department?.id === aOps && rec5A.body.office?.id === aLondon && rec5A.body.manager?.id === max.id, { role: rec5A.body.role, department: rec5A.body.department, manager: rec5A.body.manager });
  const log5 = await until(() => auditRows(B, "reporting_line_changed", pat.id, t5), (r) => r.length >= 2);
  check("B logs Hana's line and dotted line changes; A logs none", log5.length >= 2 && (await auditRows(A, "reporting_line_changed", pat.id, t5)).length === 0, log5.map((r) => r.description));
  const rita5 = await hana.json("PATCH", `/api/users/${rita.id}`, { departmentId: bDesign });
  const ritaOff = await bo.json("PATCH", `/api/users/${rita.id}`, { status: "INACTIVE" });
  check("Hana places Rita in B's Design, and Bo deactivates Rita in B: her B membership INACTIVE, her account live in A", rita5.status === 200 && ritaOff.status === 200 && (await seat(rita.id, B))?.status === "INACTIVE" && (await seat(rita.id, B))?.departmentId === bDesign && (await account(rita.id))?.status === "ACTIVE", { place: rita5.body, off: ritaOff.body });

  // ── 6. Pickers and Workload ───────────────────────────────────────
  step = "6 pickers and workload";
  const pick = await dana.json("GET", `/api/people/pick?q=${encodeURIComponent("Lines")}`);
  const picked = (pick.body.people ?? []) as Json[];
  const patPicked = picked.find((p) => p.id === pat.id);
  check("Dana's people picker in B offers Pat, anchored in A, with B's job title, and not Rita, whom B deactivated", pick.status === 200 && !!patPicked && JSON.stringify(patPicked).includes(`Lines Designer ${RUN}`) && !picked.some((p) => p.id === rita.id), { pat: patPicked, ids: named(picked.map((p) => String(p.id))) });
  const board = await prisma.board.findFirst({ where: { organizationId: B, name: "Tasks" }, select: { id: true } });
  // The starter List is open to everyone to read; Bo makes Dana a member so she may add to it.
  const member = await bo.json("POST", `/api/boards/${board?.id ?? "none"}/members`, { userId: dana.id, role: "MEMBER" });
  check("Bo makes Dana a member of B's Tasks List (POST /api/boards/[id]/members)", ok2(member.status), { status: member.status, body: member.body });
  const task = await dana.json("POST", `/api/boards/${board?.id ?? "none"}/items`, { title: `Lines launch brief ${RUN}`, assigneeIds: [pat.id] });
  const TASK_ID = String(task.body.item?.id ?? "");
  const taskRow = TASK_ID ? await prisma.item.findUnique({ where: { id: TASK_ID }, select: { assigneeIds: true, organizationId: true } }) : null;
  check("Dana assigns Pat a task on B's Tasks List (201), the task holds her", ok2(task.status) && !!taskRow && taskRow.assigneeIds.includes(pat.id) && taskRow.organizationId === B, { status: task.status, body: task.body.error ?? task.body.reason, row: taskRow });
  // Talk is a module included from the Growth plan, and a new workspace is on
  // Starter. No local route changes a plan (billing, or the staff console, does
  // in production), so B's plan is set here; Bo turns Talk on through its route.
  await prisma.organization.update({ where: { id: B }, data: { plan: "GROWTH" } });
  const talk = await bo.json("POST", "/api/products/installations", { productSlug: "workwrk-talk" });
  check("with B on the Growth plan (the database: no local route changes a plan), Bo turns Talk on (POST /api/products/installations)", ok2(talk.status), { status: talk.status, body: talk.body });
  const dm = await dana.json("POST", "/api/conversations", { type: "DM", memberIds: [pat.id] });
  const dmRita = await dana.json("POST", "/api/conversations", { type: "DM", memberIds: [rita.id] });
  check("Dana messages Pat (a DM, 200 or 201), and a DM to Rita, deactivated in B, is refused", ok2(dm.status) && !ok2(dmRita.status), { dm: [dm.status, dm.body.error], rita: [dmRita.status, dmRita.body.error] });
  const { from, to } = week();
  const wl = await dana.json("GET", `/api/team/workload?from=${from}&to=${to}`);
  const wlPat = ((wl.body.people ?? []) as Json[]).find((p) => p.id === pat.id);
  check(
    "Teams > Workload for Dana in B shows Pat with B's 10 hours over Monday and Tuesday and B's Design, editable by Dana; no Rita",
    wl.status === 200 && wlPat?.weeklyCapacityHours === 10 && JSON.stringify(wlPat?.workSchedule?.workdays) === JSON.stringify([1, 2]) && wlPat?.departmentId === bDesign && wlPat?.canEditCapacity === true && !((wl.body.people ?? []) as Json[]).some((p) => p.id === rita.id),
    { status: wl.status, pat: wlPat, error: wl.body.error },
  );

  // ── 7. SCIM's manager attribute in B ──────────────────────────────
  step = "7 SCIM";
  const tokB = await bo.json("POST", "/api/scim-tokens", { name: `Lines IdP B ${RUN}` });
  const tokA = await ari.json("POST", "/api/scim-tokens", { name: `Lines IdP A ${RUN}` });
  scimToken = String(tokB.body.token ?? "");
  const scimA = String(tokA.body.token ?? "");
  check("Bo and Ari each make a SCIM token (POST /api/scim-tokens 201)", tokB.status === 201 && tokA.status === 201 && !!scimToken && !!scimA, { b: tokB.status, a: tokA.status });
  const getB0 = await scim("GET", `/Users/${pat.id}`);
  const getA0 = await scim("GET", `/Users/${pat.id}`, undefined, scimA);
  check("SCIM GET names B's line in B (Lee) and A's in A (Max), in the enterprise extension", getB0.status === 200 && scimManagerOf(getB0) === lee.id && getA0.status === 200 && scimManagerOf(getA0) === max.id, { b: getB0.body[ENTERPRISE], a: getA0.body[ENTERPRISE] });
  // The final review, product H1: the provider sets Reports to only where a
  // workspace turned on Security > Provisioning's switch, off by default.
  const t7off = new Date();
  const ignored = await scim("PATCH", `/Users/${pat.id}`, { schemas: [SCIM_PATCH], Operations: [{ op: "replace", value: { [ENTERPRISE]: { manager: { value: dana.id } } } }] });
  check(
    "with Let your identity provider set Reports to off (the default), an Okta-shaped PATCH answers 200 and writes and logs nothing of Pat's B line",
    ignored.status === 200 && (await seat(pat.id, B))?.managerId === lee.id && (await auditRows(B, "reporting_line_changed", pat.id, t7off)).length === 0 && (await auditRows(B, "reporting_line_refused", pat.id, t7off)).length === 0,
    { status: ignored.status, seatB: (await seat(pat.id, B))?.managerId },
  );
  const onB = await bo.json("PATCH", "/api/settings", { section: "security", data: { identityProviderSetsReportsTo: true } });
  const onA = await ari.json("PATCH", "/api/settings", { section: "security", data: { identityProviderSetsReportsTo: true } });
  check("Bo and Ari turn on Let your identity provider set Reports to (PATCH /api/settings, section security: 200)", onB.status === 200 && onA.status === 200, { b: onB.status, a: onA.status });
  const t7 = new Date();
  const okta = await scim("PATCH", `/Users/${pat.id}`, { schemas: [SCIM_PATCH], Operations: [{ op: "replace", value: { [ENTERPRISE]: { manager: { value: dana.id } } } }] });
  check(
    "an Okta-shaped PATCH (no path, the extension in the value) sets Pat's B manager to Dana: on her B membership, and A's line (Max) stays",
    okta.status === 200 && (await seat(pat.id, B))?.managerId === dana.id && (await account(pat.id))?.managerId === max.id && (await account(pat.id))?.organizationId === A,
    { status: okta.status, body: okta.body, seatB: (await seat(pat.id, B))?.managerId },
  );
  const log7 = await auditRows(B, "reporting_line_changed", pat.id, t7);
  check("B logs it with the identity provider as the actor; A logs nothing", log7.length === 1 && log7[0].actorLabel === "Identity provider" && (await auditRows(A, "reporting_line_changed", pat.id, t7)).length === 0, log7);
  const getB1 = await scim("GET", `/Users/${pat.id}`);
  const getA1 = await scim("GET", `/Users/${pat.id}`, undefined, scimA);
  check("SCIM GET now names Dana in B, still Max in A", scimManagerOf(getB1) === dana.id && scimManagerOf(getA1) === max.id, { b: getB1.body[ENTERPRISE], a: getA1.body[ENTERPRISE] });
  const oktaPut = await scim("PUT", `/Users/${pat.id}`, { schemas: [SCIM_USER], userName: pat.email, name: { givenName: "Pat", familyName: "Lines" }, emails: [{ value: pat.email, primary: true }], active: true });
  check("Okta's PUT of the full resource with no manager in it (how Okta sends an emptied manager) keeps the B line (step 7's Okta note)", oktaPut.status === 200 && (await seat(pat.id, B))?.managerId === dana.id, { status: oktaPut.status, body: oktaPut.body });
  const entraRemove = await scim("PATCH", `/Users/${pat.id}`, { schemas: [SCIM_PATCH], Operations: [{ op: "Remove", path: `${ENTERPRISE}:manager` }] });
  check("an Entra-shaped PATCH Remove of the manager clears B's line, and A's (Max) stays", entraRemove.status === 200 && (await seat(pat.id, B))?.managerId === null && (await account(pat.id))?.managerId === max.id, { status: entraRemove.status, body: entraRemove.body });
  const before7 = await seat(pat.id, B);
  const changed7 = (await auditRows(B, "reporting_line_changed", pat.id, t7)).length;
  const t7b = new Date();
  const refused = await scim("PATCH", `/Users/${pat.id}`, { schemas: [SCIM_PATCH], Operations: [{ op: "Replace", path: `${ENTERPRISE}:manager`, value: ada.id }] });
  const refusedRows = await auditRows(B, "reporting_line_refused", pat.id, t7b);
  const after7 = await seat(pat.id, B);
  check(
    "a manager B refuses (Ada, an Agent in B) answers 200 and writes one reporting_line_refused row with the reason, and nothing else",
    refused.status === 200 && refusedRows.length === 1 && (refusedRows[0].metadata as Json)?.reason === "agent" && /an Agent/.test(String(refusedRows[0].description)),
    { status: refused.status, rows: refusedRows },
  );
  check(
    "nothing else: her B membership unchanged (no line, the same updatedAt), no line change logged, A's line Max",
    after7?.managerId === null && after7?.updatedAt.getTime() === before7?.updatedAt.getTime() && (await auditRows(B, "reporting_line_changed", pat.id, t7)).length === changed7 && (await account(pat.id))?.managerId === max.id && (await auditRows(A, "reporting_line_refused", pat.id, t7b)).length === 0,
    { before: before7, after: after7 },
  );
  const refusedRita = await scim("PATCH", `/Users/${pat.id}`, { schemas: [SCIM_PATCH], Operations: [{ op: "Replace", path: `${ENTERPRISE}:manager`, value: rita.id }] });
  const ritaRows = await auditRows(B, "reporting_line_refused", pat.id, t7b);
  check("Rita, whom B deactivated, is refused as deactivated, one more row, nothing written", refusedRita.status === 200 && ritaRows.length === 2 && (ritaRows[1].metadata as Json)?.reason === "inactive" && (await seat(pat.id, B))?.managerId === null, ritaRows.map((r) => r.description));
  const entraPut = await scim("PUT", `/Users/${pat.id}`, { schemas: [SCIM_USER, ENTERPRISE], userName: pat.email, name: { givenName: "Pat", familyName: "Lines" }, active: true, [ENTERPRISE]: { manager: { value: dana.id } } });
  const getB2 = await scim("GET", `/Users/${pat.id}`);
  check("an Entra-shaped PUT with the extension's manager sets Dana again in B, and GET names her", entraPut.status === 200 && (await seat(pat.id, B))?.managerId === dana.id && scimManagerOf(getB2) === dana.id && (await account(pat.id))?.managerId === max.id, { status: entraPut.status, body: entraPut.body });
  check("SCIM never wrote Pat's name, which A shares", (await account(pat.id))?.firstName === "Pat" && (await account(pat.id))?.lastName === "Lines");

  // ── 8. Audiences by placement in B ────────────────────────────────
  step = "8 audiences";
  const reached = async (link: string, type?: string) => sorted((await prisma.notification.findMany({ where: { link, ...(type ? { type } : {}) }, select: { userId: true } })).map((n) => n.userId));
  const ann = await bo.json("POST", "/api/announcements", { title: `Lines Design news ${RUN}`, content: "The Design team's week.", targetAudience: { type: "DEPARTMENTS", ids: [bDesign] } });
  const annTo = ann.body.id ? await reached(`/announcements/${ann.body.id}`) : [];
  check("B's announcement to Design (201) reaches Pat and Lee, and never Rita, whom B deactivated", ann.status === 201 && annTo.includes(pat.id) && annTo.includes(lee.id) && !annTo.includes(rita.id), { status: ann.status, to: named(annTo) });
  const pol = await bo.json("POST", "/api/policies", { title: `Lines Design policy ${RUN}`, content: "Design reviews happen on Tuesdays.", requiresAck: true, status: "PUBLISHED" });
  const POL_ID = String(pol.body.id ?? pol.body.data?.id ?? "");
  const polAssign = await bo.json("POST", `/api/policies/${POL_ID}/assignments`, { departmentId: bDesign });
  const polTo = sorted((await prisma.policyAssignment.findMany({ where: { policyId: POL_ID }, select: { userId: true } })).map((a) => a.userId));
  check("B's policy assigned to Design reaches Pat and Lee (their assignment rows), and never Rita", ok2(pol.status) && polAssign.status === 201 && polTo.includes(pat.id) && polTo.includes(lee.id) && !polTo.includes(rita.id), { pol: pol.status, assign: polAssign.body, to: named(polTo) });
  const survey = await bo.json("POST", "/api/pulse-surveys", { title: `Lines Design pulse ${RUN}`, questions: [{ text: "How was the week?", type: "text" }], audienceType: "DEPARTMENTS", departmentIds: [bDesign] });
  const SURVEY_ID = String(survey.body.id ?? survey.body.data?.id ?? survey.body.survey?.id ?? "");
  const surveyTo = await until(() => reached(`/surveys/${SURVEY_ID}`, "survey_open"), (r) => r.length >= 2, 15_000);
  check("B's survey to Design tells Pat and Lee it is open, and never Rita", ok2(survey.status) && surveyTo.includes(pat.id) && surveyTo.includes(lee.id) && !surveyTo.includes(rita.id), { status: survey.status, id: SURVEY_ID, to: named(surveyTo) });
  const goal = await bo.json("POST", "/api/okrs", { title: `Lines Design goal ${RUN}`, level: "COMPANY", ownerId: bo.id, assignees: [{ type: "DEPARTMENT", id: bDesign }] });
  const GOAL_ID = String(goal.body.id ?? goal.body.data?.id ?? goal.body.okr?.id ?? "");
  const goals = await bo.json("GET", "/api/okrs");
  const goalRows = (Array.isArray(goals.body) ? goals.body : (goals.body.data ?? [])) as Json[];
  const goalMembers = sorted(((goalRows.find((g) => g.id === GOAL_ID)?.audience?.members ?? []) as Json[]).map((m) => String(m.id ?? m.userId)));
  check("B's goal for Design holds Pat and Lee as members (GET /api/okrs), and never Rita", ok2(goal.status) && goalMembers.includes(pat.id) && goalMembers.includes(lee.id) && !goalMembers.includes(rita.id), { status: goal.status, id: GOAL_ID, members: named(goalMembers) });

  // ── 4. B's handover of Dana, and the stale lines ──────────────────
  step = "4 handover";
  /** A removal here, as the Members page runs it: the handover first when anything is left, then DELETE. */
  const removeHere = async (by: Person, p: Person, to: Person): Promise<{ handover: number | null; removed: Reply }> => {
    const left = await by.json("GET", `/api/users/${p.id}/handover`);
    const pending = Number(left.body.openTasks?.count ?? 0) + Number(left.body.directReports?.count ?? 0) + Number(left.body.containers?.count ?? 0);
    let handover: number | null = null;
    if (pending > 0) handover = (await by.json("POST", `/api/users/${p.id}/handover`, { reassignToId: to.id })).status;
    return { handover, removed: await by.json("DELETE", `/api/users/${p.id}`) };
  };
  const patOut = await removeHere(bo, pat, bo);
  const adaOut = await removeHere(bo, ada, bo);
  check(
    "Bo removes Pat and Ada from B (200 each): their B seats removed, each still holding B's line to Dana; their accounts live in A",
    patOut.removed.status === 200 && adaOut.removed.status === 200 && !!(await seat(pat.id, B))?.removedAt && (await seat(pat.id, B))?.managerId === dana.id && !!(await seat(ada.id, B))?.removedAt && (await seat(ada.id, B))?.managerId === dana.id && (await account(pat.id))?.organizationId === A,
    { pat: patOut, ada: adaOut.removed.body },
  );
  const summary = await bo.json("GET", `/api/users/${dana.id}/handover`);
  const summaryIds = sorted(((summary.body.directReports?.items ?? []) as Json[]).map((r) => String(r.id)));
  check("Dana's handover summary in B counts her B reports here, Max and Lee (never Pat or Ada, removed)", summary.status === 200 && same(summaryIds, [max.id, lee.id]), { ids: named(summaryIds), body: summary.body.directReports });
  const t4 = new Date();
  const ho = await bo.json("POST", `/api/users/${dana.id}/handover`, { reassignToId: bo.id });
  check("Bo hands Dana's work and reports here to himself (POST /api/users/[id]/handover 200)", ho.status === 200, ho.body);
  check(
    "B's lines moved: Max (his B membership) and Lee now report to Bo in B",
    (await seat(max.id, B))?.managerId === bo.id && (await account(lee.id))?.managerId === bo.id,
    { max: (await seat(max.id, B))?.managerId, lee: (await account(lee.id))?.managerId },
  );
  check(
    "A's lines are untouched: Max still reports to Dana in A, Pat to Max, and Dana to Ari; Pat's removed B seat still names Dana",
    (await account(max.id))?.managerId === dana.id && (await account(pat.id))?.managerId === max.id && (await seat(dana.id, A))?.managerId === ari.id && (await seat(pat.id, B))?.managerId === dana.id,
  );
  check("the handover logs in B only", (await prisma.activityLog.count({ where: { organizationId: A, createdAt: { gte: t4 }, type: "reporting_line_changed" } })) === 0);
  const danaOut = await bo.json("DELETE", `/api/users/${dana.id}`);
  const danaRow = await account(dana.id);
  check(
    "Bo removes Dana from B (200): her B seat ends and her account moves to A (D3), where she is live and still leads Max",
    danaOut.status === 200 && danaRow?.organizationId === A && danaRow.status === "ACTIVE" && !!(await seat(dana.id, B))?.removedAt && (await account(max.id))?.managerId === dana.id && danaRow.managerId === ari.id,
    { reply: danaOut.body, account: danaRow, seatB: await seat(dana.id, B) },
  );
  const back4 = await bo.json("DELETE", `/api/users/${pat.id}?restore=true`);
  check(
    "Bo restores Pat in B (200): the restore clears her stale B line to Dana (removed) and says so",
    back4.status === 200 && (await seat(pat.id, B))?.removedAt === null && (await seat(pat.id, B))?.managerId === null && JSON.stringify(back4.body.linesCleared) === JSON.stringify([{ managerId: dana.id, kind: "manager", reason: "removed" }]),
    { reply: back4.body, seatB: await seat(pat.id, B) },
  );
  check("only B's: her B dotted line to Bo stays; her A line (Max) and A dotted line (Ada) stay", same(await dottedIn(pat.id, B), [bo.id]) && (await account(pat.id))?.managerId === max.id && same(await dottedIn(pat.id, A), [ada.id]), { b: await dottedIn(pat.id, B), a: await dottedIn(pat.id, A) });
  const ritaOn = await bo.json("PATCH", `/api/users/${rita.id}`, { status: "ACTIVE" });
  check(
    "Bo reactivates Rita in B (200): the reactivation clears her stale B dotted line to Dana (removed) and says so",
    ritaOn.status === 200 && (await seat(rita.id, B))?.status === "ACTIVE" && same(await dottedIn(rita.id, B), []) && JSON.stringify(ritaOn.body.linesCleared) === JSON.stringify([{ managerId: dana.id, kind: "dotted", reason: "removed" }]),
    { reply: ritaOn.body, dottedB: await dottedIn(rita.id, B) },
  );
  check("only B's: Rita's B line (Max, live) and her A line (Ari) stay", (await seat(rita.id, B))?.managerId === max.id && (await account(rita.id))?.managerId === ari.id);
  const t4b = new Date();
  const adaInv = await bo.json("POST", "/api/invitations", { email: ada.email, accessLevel: "AGENT" });
  const adaToken = await openInvitationToken(B, ada.email);
  const adaJoined = await ada.json("POST", "/api/auth/accept-invite", { token: adaToken });
  await ada.refreshSession();
  const adaSeat = await seat(ada.id, B);
  const adaLog = await until(() => auditRows(B, "reporting_line_changed", ada.id, t4b), (r) => r.length > 0);
  check(
    "Bo re-invites Ada, removed in B, as an Agent; she accepts signed in (201): her seat comes back with no line (Dana, removed, cleared: the step 4 review M1)",
    adaInv.status === 201 && adaJoined.status === 201 && adaSeat?.removedAt === null && adaSeat.role === "AGENT" && adaSeat.managerId === null && (await account(ada.id))?.organizationId === B,
    { inv: adaInv.body, joined: adaJoined.body, seat: adaSeat },
  );
  check("the join logs the clear in B (reporting_line_changed, onJoin)", adaLog.length === 1 && (adaLog[0].metadata as Json)?.onJoin === true && (adaLog[0].oldValue as Json)?.managerId === dana.id, adaLog);
  const adaHome = await switchTo(ada, A);
  check("Ada switches back to A: her A line (Ari) is where it was, and B's membership has none", adaHome.status === 200 && (await account(ada.id))?.managerId === ari.id && (await seat(ada.id, B))?.managerId === null, { sw: adaHome.body, account: await account(ada.id) });

  // ── 9. The after-deploy check ─────────────────────────────────────
  step = "9 after-deploy check";
  const checkFile = readFileSync(join(process.cwd(), "prisma/sql/after-deploy/2026-11-03-workspace-lines-window-check.sql"), "utf8");
  const statements = sqlStatements(checkFile);
  const proofIds = [A, B, ...[ari, bo, pat, max, dana, rita, ada, hana, lee, cole].map((p) => p.id)];
  const runCheck = async (t1At: Date) =>
    withPg(async (c) => {
      const lists: Array<{ rows: Json[]; ours: Json[] }> = [];
      await c.query("BEGIN READ ONLY");
      try {
        for (const s of statements) {
          const r = await c.query(s.split("'<T1>'").join(`'${asT1(t1At)}'`));
          const rows = (r.rows ?? []) as Json[];
          lists.push({ rows, ours: rows.filter((row) => proofIds.some((id) => JSON.stringify(row).includes(id))) });
        }
      } finally {
        await c.query("ROLLBACK");
      }
      return lists;
    });
  const bare = statements.map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim());
  check("the check file is its guard and six statements (the window, then lists a to e)", statements.length === 7 && bare[0].startsWith("DO $$") && bare.slice(1).every((s) => /^(WITH|SELECT)\b/.test(s)), bare.map((s) => s.slice(0, 40)));
  const at = await runCheck(T1);
  const window0 = at[1]?.rows[0] ?? {};
  check("with T1 the proof's start, the window runs from the marker's applied time to T1", !!window0.T0 && !!window0.T1, window0);
  // The lists since the final review (integrity H1): read from the snapshot the file takes, so the
  // database must have run the file with it (a fresh apply); the guard stops the check otherwise.
  const listNames = ["(a) lines lost or carried, from the snapshot", "(b) lines naming someone with no row there", "(c) handovers", "(d) dotted lines the deploy left, now gone", "(e) dotted-line writes"];
  for (let k = 0; k < 5; k += 1) {
    const l = at[k + 2];
    check(`${listNames[k]} lists none of the proof's rows (${l?.rows.length ?? "?"} row(s) of other local data)`, !!l && l.ours.length === 0, l?.ours.slice(0, 5));
  }
  const late = await runCheck(new Date());
  const whoOf = (row: Json) => nameOf.get(String(row.userId ?? "")) ?? String(row.userId ?? row.membershipId ?? "?");
  console.log(`  info with T1 at the end of the proof (as if the check were run late), the lists hold ${late.slice(2).map((l, k) => `${listNames[k]} ${l.ours.length} of the proof's rows${l.ours.length ? ` (${l.ours.map(whoOf).join(", ")})` : ""}`).join("; ")}`);

  // ── 10. Scale ─────────────────────────────────────────────────────
  step = "10 scale";
  const sol = new Person("Sol", "Sol", "Lines", emailOf("sol"));
  const tia = new Person("Tia", "Tia", "Lines", emailOf("tia"));
  const danaT = new Person("DanaT", "Dana", "Scale", emailOf("danat"));
  const S = await register(sol, NAME_S);
  const T = await register(tia, NAME_T);
  if (!S || !T) throw new Error("The scale workspaces were not made.");
  await sol.signInOrThrow();
  await tia.signInOrThrow();
  const danaTMade = await addByHand(tia, danaT, "MANAGER");
  await danaT.signInOrThrow();
  check("Tia adds Dana Scale to T as a Manager (POST /api/users)", ok2(danaTMade.status) && !!danaT.id, danaTMade.body);
  const u = (n: number) => `${PLANT}u${n}`;
  const DEEP = u(1);
  const MAXS = u(3002);
  const plantT0 = performance.now();
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "Department" ("id", "name", "organizationId", "updatedAt") SELECT $1 || 'd' || g, 'Scale Dept ' || g, $2, now() FROM generate_series(1, 10) g`, PLANT, S);
      await tx.$executeRawUnsafe(`INSERT INTO "Department" ("id", "name", "organizationId", "updatedAt") VALUES ($1 || 'td', 'Scale T Ops', $2, now())`, PLANT, T);
      // 5,000 people anchored in S: Deep (1) over a three-way tree of 3,000
      // (2 to 3001, seven levels), and Max Scale (3002) over 1,998 people
      // (3003 to 5000); Deep and Max Scale report to Sol.
      await tx.$executeRawUnsafe(
        `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "organizationId", "managerId", "departmentId", "accessLevel", "updatedAt")
         SELECT $1 || 'u' || n, 'p' || n || '.' || $3 || $4, 'planted, no sign-in', 'Scale', 'Person ' || lpad(n::text, 5, '0'), $2,
                CASE WHEN n = 1 OR n = 3002 THEN $5 WHEN n <= 3001 THEN $1 || 'u' || ((n - 2) / 3 + 1) ELSE $1 || 'u3002' END,
                $1 || 'd' || ((n % 10) + 1),
                (CASE WHEN n = 1 OR n = 3002 THEN 'MANAGER' ELSE 'EMPLOYEE' END)::"AccessLevel", now()
           FROM generate_series(1, 5000) n`,
        PLANT, S, RUN, PLANT_EMAIL, sol.id,
      );
      // 500 people anchored in T, each working in S through a membership, in
      // S's first department, under Deep there.
      await tx.$executeRawUnsafe(
        `INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "organizationId", "updatedAt")
         SELECT $1 || 't' || m, 't' || m || '.' || $3 || $4, 'planted, no sign-in', 'Scale', 'Member ' || lpad(m::text, 4, '0'), $2, now() FROM generate_series(1, 500) m`,
        PLANT, T, RUN, PLANT_EMAIL,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "managerId", "departmentId", "updatedAt")
         SELECT $1 || 'ms' || m, $1 || 't' || m, $2, 'EMPLOYEE', $1 || 'u1', $1 || 'd1', now() FROM generate_series(1, 500) m`,
        PLANT, S,
      );
      // Max Scale works in T through a membership under Dana Scale, and leads
      // 1,000 of Deep's tree there (2 to 1001, each with reports in S).
      await tx.$executeRawUnsafe(
        `INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "managerId", "updatedAt") VALUES ($1 || 'mx', $1 || 'u3002', $2, 'MANAGER', $3, now())`,
        PLANT, T, danaT.id,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "managerId", "departmentId", "updatedAt")
         SELECT $1 || 'mt' || n, $1 || 'u' || n, $2, 'EMPLOYEE', $1 || 'u3002', $1 || 'td', now() FROM generate_series(2, 1001) n`,
        PLANT, T,
      );
    },
    { timeout: 120_000 },
  );
  await prisma.$executeRawUnsafe(`ANALYZE "User"`);
  await prisma.$executeRawUnsafe(`ANALYZE "OrganizationMembership"`);
  const plantedUsers = await prisma.user.count({ where: { id: { startsWith: PLANT } } });
  const plantedSeats = await prisma.organizationMembership.count({ where: { id: { startsWith: PLANT } } });
  check(`5,500 people and 1,501 memberships planted in S and T by direct inserts (${Math.round(performance.now() - plantT0)} ms), the tables analysed`, plantedUsers === 5500 && plantedSeats === 1501, { plantedUsers, plantedSeats });

  // The raw walks.
  const WALK = (q: string) => q.includes("WITH RECURSIVE");
  const walk = async (name: string, run: () => Promise<string[]>, expect: number, exclude: string[] = []) => {
    const ids = await measure(name, run, { gated: true });
    check(`${name} answers ${expect} people${exclude.length ? ", none of the excluded" : ""}`, ids.length === expect && !exclude.some((x) => ids.includes(x)), { got: ids.length, expect });
    const [plan] = await explainCalls(name, run, WALK);
    const usesBoth = !!plan && plan.text.includes("User_managerId_idx") && plan.text.includes("OrganizationMembership_managerId_organizationId_idx");
    check(`${name}: EXPLAIN ANALYZE runs it in ${plan?.executionMs ?? "?"} ms, each step by "User_managerId_idx" and "OrganizationMembership_managerId_organizationId_idx"`, !!plan && usesBoth && (plan.executionMs ?? Infinity) <= GATE_MS, plan?.text.slice(-1500));
    return ids;
  };
  await walk("team.ts, Deep's tree in S (3,000 below him over seven levels, and 500 here through a membership)", () => getTeamUserIds(S, DEEP, { rootIsAgent: false }), 3501);
  await walk("reporting-line.ts solid tree, Deep in S (six levels, the viewer's cap)", () => getSolidReportTree(DEEP, { organizationId: S, rootIsAgent: false }), 1 + 1092 + 500);
  await walk("team.ts, Sol's whole tree in S", () => getTeamUserIds(S, sol.id, { rootIsAgent: false }), 5501);
  const sOnly = [u(3003), u(4000), u(5000), u(1500)];
  await walk("team.ts, Dana Scale's tree in T, through Max Scale anchored in S (1,998 reports there, read and dropped)", () => getTeamUserIds(T, danaT.id, { rootIsAgent: false }), 1002, sOnly);
  await walk("reporting-line.ts effective tree, Dana Scale in T, through Max Scale", () => getEffectiveReportTree(danaT.id, { organizationId: T, rootIsAgent: false }), 1002, sOnly);

  // A request Dana Scale makes in T walks through him (viewer.ts reportTreeFor).
  const mt = await measure("GET /api/my-team as Dana Scale in T (the walk through Max Scale, then 1,002 people's seats)", () => danaT.json("GET", "/api/my-team"), { gated: true });
  check("her My team holds Max Scale and the 1,000 who report to him in T, and none of his S-only reports", mt.status === 200 && (mt.body.teamIds as string[]).length === 1002 && (mt.body.teamIds as string[]).includes(MAXS) && !sOnly.some((x) => (mt.body.teamIds as string[]).includes(x)), { status: mt.status, n: (mt.body.teamIds ?? []).length });
  const rr = await measure("GET /api/users/[id] of Max Scale as Dana Scale in T (the viewer's tree on a record read)", () => danaT.json("GET", `/api/users/${MAXS}`), { gated: true });
  check("Dana Scale reads Max Scale's record in T (200)", rr.status === 200, rr.body.error);
  const tc = await measure("GET /api/calendar/events?calendar=team as Dana Scale in T", () => teamCalendar(danaT), { gated: true });
  check("her Team calendar in T opens", tc.status === 200 && tc.calendar === "team", tc);

  // The Directory sorted by reports.
  const dir1 = await measure("the Directory sorted by reports, page 1 of 40, as Sol in S (5,501 people)", () => sol.json("GET", "/api/users?scope=directory&sort=reports&size=40&page=1"), { gated: true });
  const dirRows = (dir1.body.data ?? []) as Json[];
  check("its first rows are Max Scale (1,998 reports here) then Deep (503: three in S, 500 through memberships)", dir1.status === 200 && dirRows[0]?.id === MAXS && dirRows[0]?.directReports === 1998 && dirRows[1]?.id === DEEP && dirRows[1]?.directReports === 503, dirRows.slice(0, 3).map((r) => [r.id, r.directReports]));
  const dir100 = await measure("the Directory sorted by reports, page 100", () => sol.json("GET", "/api/users?scope=directory&sort=reports&size=40&page=100"), { gated: true });
  check("page 100 answers 40 rows", dir100.status === 200 && ((dir100.body.data ?? []) as Json[]).length === 40, dir100.status);
  const exp = await measure("the Directory export sorted by reports (5,501 rows)", () => sol.json("GET", "/api/users/export?sort=reports"), { gated: true });
  check("the export holds a header and every row", exp.status === 200 && exp.text.trim().split("\n").length >= 5502, { status: exp.status, lines: exp.text.trim().split("\n").length });

  // A bulk Change manager of 200 (150 anchored in S, 50 here through a membership).
  const bulk200 = [...Array.from({ length: 150 }, (_, k) => u(3003 + k)), ...Array.from({ length: 50 }, (_, k) => `${PLANT}t${k + 1}`)];
  const to200 = [sol.id, DEEP, sol.id];
  const bulkRun = async (i: number) => sol.json("POST", "/api/people/bulk-update", { userIds: bulk200, action: "change_manager", payload: { managerId: to200[i] } });
  const bulkLast = await measure("bulk Change manager of 200 people in S", bulkRun, { gated: true, warm: () => sol.json("POST", "/api/people/bulk-update", { userIds: [u(4990)], action: "change_manager", payload: { managerId: DEEP } }) });
  const lines200 = await Promise.all([lineIn(u(3003), S), lineIn(`${PLANT}t1`, S)]);
  check("each run moved all 200 (the last to Sol), the membership people on their S memberships", bulkLast.status === 200 && bulkLast.body.updated === 200 && lines200.every((l) => l === sol.id), { body: bulkLast.body, lines200 });

  // A SCIM Group replace of 200.
  const tokS = await sol.json("POST", "/api/scim-tokens", { name: `Lines IdP S ${RUN}` });
  const scimS = String(tokS.body.token ?? "");
  const grp = await scim("POST", "/Groups", { schemas: [SCIM_GROUP], displayName: `Lines Scale Group ${RUN}`, members: [] }, scimS);
  const GID = String(grp.body.id ?? "");
  check("Sol's SCIM token in S makes a Group (POST /Groups 201)", tokS.status === 201 && grp.status === 201 && !!GID, { tok: tokS.status, grp: grp.body });
  const setX = [...Array.from({ length: 150 }, (_, k) => u(3200 + k)), ...Array.from({ length: 50 }, (_, k) => `${PLANT}t${100 + k}`)];
  const setY = [...Array.from({ length: 150 }, (_, k) => u(3400 + k)), ...Array.from({ length: 50 }, (_, k) => `${PLANT}t${200 + k}`)];
  const groupPut = (ids: string[]) => scim("PUT", `/Groups/${GID}`, { schemas: [SCIM_GROUP], displayName: `Lines Scale Group ${RUN}`, members: ids.map((value) => ({ value })) }, scimS);
  const sets = [setX, setY, setX];
  const gLast = await measure("SCIM Group replace (PUT) of 200 members in S (from 1, then each set swapped for another 200)", (i) => groupPut(sets[i]), { gated: true, warm: () => groupPut([u(4999)]) });
  const gMembers = await scim("GET", `/Groups/${GID}`, undefined, scimS);
  check("the Group holds the last 200, the membership people placed on their S memberships", gLast.status === 200 && ((gMembers.body.members ?? []) as Json[]).length === 200 && (await seat(`${PLANT}t100`, S))?.departmentId === GID, { status: gLast.status, members: ((gMembers.body.members ?? []) as Json[]).length });

  // Reported only: the plan's larger sizes and its audience note.
  const halves = await explainCalls("the membership half of a department audience in S (idsPlacedHere, live)", () => idsPlacedHere(S, { departmentIds: [`${PLANT}d1`] }, "live"), (q) => q.includes("OrganizationMembership") || q.includes('"User"'));
  for (const h of halves) {
    const used = [...new Set([...h.text.matchAll(/(?:Index (?:Only )?Scan using|Bitmap Index Scan on) "?([A-Za-z_]+)"?/g)].map((x) => x[1]))];
    const seq = [...new Set([...h.text.matchAll(/Seq Scan on "?([A-Za-z_]+)"?/g)].map((x) => x[1]))];
    console.log(`  info EXPLAIN ${h.name}: ${h.executionMs} ms; indexes ${used.join(", ") || "none"}; whole-table reads ${seq.join(", ") || "none"}`);
  }
  const everyone = await measure("an announcement to everyone in S (5,500 notified)", () => sol.json("POST", "/api/announcements", { title: `Lines everyone ${RUN}`, content: "To the whole company.", targetAudience: { type: "ALL" } }), { gated: false, runs: 1, warm: null });
  const everyoneTo = everyone.body.id ? (await reached(`/announcements/${everyone.body.id}`)).length : 0;
  console.log(`  info the announcement to everyone notified ${everyoneTo} people`);
  const big = [...Array.from({ length: 1998 }, (_, k) => u(3003 + k)), `${PLANT}t1`, `${PLANT}t2`];
  const bulkBig = await measure("bulk Change manager of 2,000 (the cap) in S", () => sol.json("POST", "/api/people/bulk-update", { userIds: big, action: "change_manager", payload: { managerId: DEEP } }), { gated: false, runs: 1, warm: null });
  console.log(`  info the 2,000 bulk answered ${bulkBig.status}, updated ${bulkBig.body.updated ?? bulkBig.body.error}`);
  const all5000 = [...Array.from({ length: 4500 }, (_, k) => u(k + 1)), ...Array.from({ length: 500 }, (_, k) => `${PLANT}t${k + 1}`)];
  // Since the step 9 fix (one transaction per request, seat-writes.ts
  // placeDepartmentHere): gated at 5 seconds, the coordinator's target, well
  // inside the 20 seconds of BATCH_TX. Each run swaps the 200 or the 5,000.
  const sets5000 = [all5000, setY, all5000];
  const g5000 = await measure("SCIM Group replace (PUT) of 5,000 members in S (from the last 200, then 5,000 swapped for 200 and back)", (i) => groupPut(sets5000[i]), { gated: true, limit: 5000, warm: null });
  const g5000Members = await scim("GET", `/Groups/${GID}`, undefined, scimS);
  check("the 5,000 Group PUT answered 200, and the Group holds all 5,000", g5000.status === 200 && ((g5000Members.body.members ?? []) as Json[]).length === 5000, { status: g5000.status, members: ((g5000Members.body.members ?? []) as Json[]).length });
  writeFileSync(join(SHOTS, "scale-plans.txt"), plans.map((p) => `== ${p.name}: ${p.executionMs} ms\n${p.text}\n`).join("\n"));
  writeFileSync(join(SHOTS, "scale-timings.json"), JSON.stringify(measures, null, 2));
  console.log(`Wrote ${plans.length} plans to ${join(SHOTS, "scale-plans.txt")} and the timings to ${join(SHOTS, "scale-timings.json")}.`);

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
    if (process.env.KEEP === "1") {
      console.log(`KEEP=1: workspaces kept (${orgIds.join(", ")}). Delete them by hand.`);
    } else {
      step = "cleanup";
      try {
        await deleteWorkspaces();
        const left = await prisma.organization.count({ where: { id: { in: orgIds } } });
        const usersLeft = await prisma.user.count({ where: { OR: [{ email: { in: PEOPLE.map(emailOf) } }, { id: { startsWith: PLANT } }, { email: { endsWith: PLANT_EMAIL } }] } });
        const seatsLeft = await prisma.organizationMembership.count({ where: { id: { startsWith: PLANT } } });
        check("the throwaway workspaces, their people and everything planted are deleted", left === 0 && usersLeft === 0 && seatsLeft === 0, { left, usersLeft, seatsLeft });
        await prisma.$executeRawUnsafe(`ANALYZE "User"`);
        await prisma.$executeRawUnsafe(`ANALYZE "OrganizationMembership"`);
      } catch (err) {
        check("the throwaway workspaces are deleted", false, err instanceof Error ? err.message : String(err));
      }
    }
    await prisma.$disconnect();
  }
  const failed = results.filter((r) => !r.ok);
  if (measures.length) {
    console.log("\nScale (median of the warm runs; gated ones fail past their limit, 2,000 ms unless named):");
    for (const m of measures) console.log(`  ${m.gated ? "gated" : "info "} ${String(m.median).padStart(6)} ms  ${m.name}  [${m.runs.join(", ")}]${m.gated && m.limit !== GATE_MS ? ` (limit ${m.limit} ms)` : ""}`);
    for (const p of plans) console.log(`  plan  ${String(p.executionMs).padStart(6)} ms  ${p.name}`);
  }
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  FAIL ${f.id} [${f.step}] ${f.name}`);
  }
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ""}.`);
  return failed.length || failedHard ? 1 : 0;
}

void proveAndCleanUp().then((code) => process.exit(code));
