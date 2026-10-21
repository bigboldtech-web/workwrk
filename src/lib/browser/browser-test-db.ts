// The computer's tests' database double (src/lib/browser/*.test.ts and
// src/app/api/teammate-browser/**/*.test.ts): an in-memory workspace behind
// the prisma calls src/lib/browser makes, the raw statements included, each
// recognised by its own text. A raw statement this file does not know
// throws, so a query changed in the code cannot pass by being ignored, and
// the clauses that carry a statement's meaning (the lock class, the live
// statuses, the retention's UTC interval) are asserted, not assumed.
// A transaction runs on a copy of the tables and is put back when it throws,
// as a rolled-back one is. Every write is recorded in `bdb.events` with
// whether it ran inside a transaction.
//
// The tests mock the real module with it:
//   vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
//
// Test-only: nothing in the app imports it.

import { Prisma } from "@/generated/prisma";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

export type Row = Record<string, unknown>;

type Tables = {
  sessions: Row[];
  steps: Row[];
  shots: Row[];
  policies: Row[];
  orgs: Row[];
  agents: Row[];
  users: Row[];
  runs: Row[];
  actions: Row[];
  notifications: Row[];
  activity: Row[];
  /** Chat lines (ChatMessage): a browser's browser_started line, which its card is drawn in place of (last polish of Phase 4). */
  messages: Row[];
  /** A person's skills (TeammateSkill, docs/plans/ai-teammates-phase5.md step 2). */
  skills: Row[];
  /** Routines (AgentRoutine), for a skill's routine that goes with it (Phase 5 step 3: AgentRoutine_skillId_fkey ON DELETE CASCADE). */
  routines: Row[];
  /** A person's memberships of other workspaces (OrganizationMembership), read by levelHeldIn (the orphan check, final races review M2). */
  memberships: Row[];
};

export const bdb = {
  t: emptyTables(),
  /** Every advisory lock taken: its class and key, and whether inside a transaction. */
  locks: [] as Array<{ cls: number; key: unknown; inTx: boolean }>,
  /** Every statement and write, in order. */
  events: [] as Array<{ op: string; inTx: boolean }>,
  /** The text of every raw statement, in order. */
  raw: [] as string[],
  /** Rows read FOR UPDATE: what and whether inside a transaction. */
  rowLocks: [] as Array<{ what: string; inTx: boolean }>,
  inTx: 0,
};

function emptyTables(): Tables {
  return { sessions: [], steps: [], shots: [], policies: [], orgs: [], agents: [], users: [], runs: [], actions: [], notifications: [], activity: [], messages: [], skills: [], routines: [], memberships: [] };
}

export function resetBrowserDb(): void {
  bdb.t = emptyTables();
  bdb.locks = [];
  bdb.events = [];
  bdb.raw = [];
  bdb.rowLocks = [];
  bdb.inTx = 0;
  seq = 0;
}

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

const MODEL_TABLE: Record<string, keyof Tables> = {
  teammateBrowserSession: "sessions",
  teammateBrowserStep: "steps",
  teammateBrowserShot: "shots",
  teammateBrowserPolicy: "policies",
  organization: "orgs",
  agent: "agents",
  user: "users",
  agentRun: "runs",
  agentAction: "actions",
  notification: "notifications",
  activityLog: "activity",
  chatMessage: "messages",
  teammateSkill: "skills",
  agentRoutine: "routines",
  organizationMembership: "memberships",
};

const DEFAULTS: Partial<Record<keyof Tables, () => Row>> = {
  sessions: () => ({
    id: nextId("bs"),
    chatSessionId: null,
    providerSessionId: null,
    region: null,
    status: "starting",
    endReason: null,
    lastRunId: null,
    waitingSince: null,
    handedOverAt: null,
    currentSite: null,
    endedAt: null,
    billedMinutes: null,
    stopAttempts: 0,
    nextStopAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  steps: () => ({ id: nextId("st"), code: null, actionId: null, shotId: null, at: new Date() }),
  activity: () => ({ id: nextId("al"), createdAt: new Date() }),
  messages: () => ({ id: nextId("cm"), role: "SYSTEM", createdAt: new Date() }),
  skills: () => ({
    id: nextId("sk"),
    description: "",
    status: "recording",
    version: 1,
    steps: [],
    stepCount: 0,
    sites: [],
    startUrl: null,
    recordingSessionId: null,
    recordingFull: false,
    recordingEndedAt: null,
    recordingEndReason: null,
    orphanedAt: null,
    lastRunAt: null,
    runCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
};

// ── Seeds ───────────────────────────────────────────────────────────

export function seedOrg(o: Row = {}): Row {
  const row = { id: "org1", name: "Acme", status: "ACTIVE", plan: "GROWTH", ...o };
  bdb.t.orgs.push(row);
  return row;
}

export function seedPolicy(o: Row = {}): Row {
  const row = { organizationId: "org1", enabled: true, allowSites: ["docs.proof.test"], blockSites: [], updatedById: null, createdAt: new Date(), updatedAt: new Date(), ...o };
  bdb.t.policies.push(row);
  return row;
}

export function seedAgent(o: Row = {}): Row {
  const row = { id: "a-shop", organizationId: "org1", slug: "shopper", name: "Shopper", status: "ENABLED", browserSites: ["docs.proof.test"], toolNames: ["open_page", "read_page", "click"], ...o };
  bdb.t.agents.push(row);
  return row;
}

/** A person anchored in org1, active, an Employee there (the orphan check reads where they are and their status). */
export function seedUser(o: Row = {}): Row {
  const row = { id: "u-max", organizationId: "org1", status: "ACTIVE", ...legacyLevelRow("EMPLOYEE"), firstName: "Max", lastName: "Chen", email: "max@proof.test", deletedAt: null, ...o };
  bdb.t.users.push(row);
  return row;
}

/**
 * A session row. One seeded past starting went live, so its chat holds the
 * browser_started line its card is drawn in place of (sessions.ts drewCard,
 * last polish of Phase 4); `drewCard: false` seeds one that closed while it
 * was starting, which has none.
 */
export function seedSession(o: Row = {}): Row {
  const { drewCard, ...given } = o;
  const now = Date.now();
  const row = {
    ...DEFAULTS.sessions!(),
    organizationId: "org1",
    userId: "u-max",
    agentId: "a-shop",
    chatSessionId: "chat-1",
    provider: "stand-in",
    providerSessionId: `pv-${seq}`,
    status: "live",
    bootId: "boot-x",
    reservedMinutes: 15,
    startedAt: new Date(now - 60_000),
    endsBy: new Date(now + 14 * 60_000),
    lastActiveAt: new Date(now - 30_000),
    ...given,
  };
  bdb.t.sessions.push(row);
  if (drewCard !== false && row.status !== "starting" && row.chatSessionId) seedCardLine(row);
  return row;
}

/** A session's browser_started line, as openBrowserSession writes it once the start went live (actions.ts writeEventLine's row). */
export function seedCardLine(session: Row, o: Row = {}): Row {
  const row = {
    ...DEFAULTS.messages!(),
    sessionId: session.chatSessionId,
    kind: "EVENT",
    content: "Opened a browser for you.",
    meta: { event: "browser_started", agentId: session.agentId, browserSessionId: session.id },
    createdAt: session.startedAt instanceof Date ? new Date((session.startedAt as Date).getTime() + 1000) : new Date(),
    ...o,
  };
  bdb.t.messages.push(row);
  return row;
}

/** A person's skill (Phase 5 step 2). */
export function seedSkill(o: Row = {}): Row {
  const row = { ...DEFAULTS.skills!(), organizationId: "org1", userId: "u-max", agentId: "a-shop", name: "A skill", ...o };
  bdb.t.skills.push(row);
  return row;
}

/** A routine, a skill's when `skillId` is set (Phase 5 step 3). */
export function seedRoutine(o: Row = {}): Row {
  const row = { id: nextId("rt"), organizationId: "org1", agentId: "a-shop", actingForId: "u-max", name: "A routine", status: "active", skillId: null, ...o };
  bdb.t.routines.push(row);
  return row;
}

/**
 * What the database's own keys do when skills are deleted (Phase 5): a
 * skill's routines go with it (AgentRoutine_skillId_fkey ON DELETE CASCADE)
 * and a browser following or recording it forgets it (the two session keys,
 * ON DELETE SET NULL).
 */
function skillsGone(ids: ReadonlySet<unknown>): void {
  if (ids.size === 0) return;
  bdb.t.routines = bdb.t.routines.filter((r) => !ids.has(r.skillId));
  for (const ss of bdb.t.sessions) {
    if (ids.has(ss.skillId)) ss.skillId = null;
    if (ids.has(ss.recordingSkillId)) ss.recordingSkillId = null;
  }
}

export function seedStep(o: Row): Row {
  const row = { ...DEFAULTS.steps!(), outcome: "ok", site: null, ...o };
  bdb.t.steps.push(row);
  return row;
}

// ── Where clauses ───────────────────────────────────────────────────

const time = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : (v as number));

function pathValue(v: unknown, path: string[]): unknown {
  let cur = v;
  for (const p of path) cur = cur && typeof cur === "object" ? (cur as Row)[p] : undefined;
  return cur;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c));
    if (key === "AND") return (Array.isArray(cond) ? cond : [cond]).every((c) => matches(row, c as Row));
    if (key === "NOT") return !matches(row, cond as Row);
    const v = row[key] ?? null;
    if (cond === null) return v === null;
    if (cond instanceof Date) return time(v) === cond.getTime();
    if (typeof cond === "object" && !Array.isArray(cond)) {
      const c = cond as Row;
      if ("path" in c) return JSON.stringify(pathValue(v, c.path as string[]) ?? null) === JSON.stringify(c.equals ?? null);
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(v);
      if ("not" in c) return c.not === null ? v !== null : v !== c.not;
      if ("equals" in c) return v === c.equals;
      let ok = true;
      if ("lt" in c) ok &&= v !== null && time(v) < time(c.lt);
      if ("lte" in c) ok &&= v !== null && time(v) <= time(c.lte);
      if ("gt" in c) ok &&= v !== null && time(v) > time(c.gt);
      if ("gte" in c) ok &&= v !== null && time(v) >= time(c.gte);
      if (!["lt", "lte", "gt", "gte"].some((k) => k in c)) throw new Error(`browser-test-db: unknown condition on ${key}: ${JSON.stringify(cond)}`);
      return ok;
    }
    return v === cond;
  });
}

function pick(row: Row, select: unknown): Row {
  if (!select || typeof select !== "object") return { ...row };
  const out: Row = {};
  for (const [k, v] of Object.entries(select as Row)) {
    if (v === true) out[k] = row[k] ?? null;
    else if (v && typeof v === "object" && "select" in (v as Row)) {
      // A relation: the agent of an action or a setting, by its id.
      const rel = k === "agent" ? bdb.t.agents.find((a) => a.id === row.agentId) : null;
      out[k] = rel ? pick(rel, (v as Row).select) : null;
    }
  }
  return out;
}

function sorted(rows: Row[], orderBy: unknown): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, "asc" | "desc">>;
  return [...rows].sort((x, y) => {
    for (const k of keys) {
      const [field, dir] = Object.entries(k)[0];
      const a = x[field];
      const b = y[field];
      const d = a instanceof Date || b instanceof Date ? time(a) - time(b) : typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "") < String(b ?? "") ? -1 : String(a ?? "") > String(b ?? "") ? 1 : 0;
      if (d !== 0) return dir === "desc" ? -d : d;
    }
    return 0;
  });
}

function event(op: string): void {
  bdb.events.push({ op, inTx: bdb.inTx > 0 });
}

function model(name: string) {
  const table = MODEL_TABLE[name];
  if (!table) throw new Error(`browser-test-db: no model ${name}`);
  const rows = () => bdb.t[table];
  const key = (where: Row) => {
    if (table === "policies") return (r: Row) => r.organizationId === where.organizationId;
    // A membership by its compound key (userId, organizationId).
    const both = where.userId_organizationId as Row | undefined;
    if (table === "memberships" && both) return (r: Row) => r.userId === both.userId && r.organizationId === both.organizationId;
    return (r: Row) => matches(r, where);
  };
  return {
    findUnique: async (a: { where: Row; select?: unknown }) => {
      const r = rows().find(key(a.where));
      return r ? pick(r, a.select) : null;
    },
    findFirst: async (a: { where?: Row; select?: unknown; orderBy?: unknown }) => {
      const r = sorted(rows().filter((x) => matches(x, a.where)), a.orderBy)[0];
      return r ? pick(r, a.select) : null;
    },
    findMany: async (a: { where?: Row; select?: unknown; orderBy?: unknown; take?: number } = {}) =>
      sorted(rows().filter((x) => matches(x, a.where)), a.orderBy)
        .slice(0, a.take ?? Infinity)
        .map((r) => pick(r, a.select)),
    count: async (a: { where?: Row } = {}) => rows().filter((x) => matches(x, a.where)).length,
    // The pictures' budget (shots.ts, review round 1 of Phase 4): sums only.
    aggregate: async (a: { where?: Row; _sum?: Record<string, boolean> }) => {
      const hit = rows().filter((x) => matches(x, a.where));
      const sum: Row = {};
      for (const k of Object.keys(a._sum ?? {})) sum[k] = hit.length > 0 ? hit.reduce((n, r) => n + Number(r[k] ?? 0), 0) : null;
      return { _sum: sum };
    },
    create: async (a: { data: Row; select?: unknown }) => {
      const row = { ...(DEFAULTS[table]?.() ?? { id: nextId(table) }), ...a.data };
      rows().push(row);
      event(`${name}.create`);
      return pick(row, a.select);
    },
    createMany: async (a: { data: Row[] }) => {
      for (const d of a.data) rows().push({ ...(DEFAULTS[table]?.() ?? { id: nextId(table) }), ...d });
      event(`${name}.createMany`);
      return { count: a.data.length };
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      const hit = rows().filter((x) => matches(x, a.where));
      for (const r of hit) {
        for (const [k, v] of Object.entries(a.data)) {
          if (v && typeof v === "object" && "increment" in (v as Row)) r[k] = Number(r[k] ?? 0) + Number((v as Row).increment);
          else r[k] = v === Prisma.DbNull ? null : v;
        }
      }
      event(`${name}.updateMany:${hit.length}`);
      return { count: hit.length };
    },
    deleteMany: async (a: { where: Row }) => {
      const before = rows().length;
      const gone = rows().filter((x) => matches(x, a.where));
      bdb.t[table] = rows().filter((x) => !matches(x, a.where));
      if (table === "skills") skillsGone(new Set(gone.map((x) => x.id)));
      event(`${name}.deleteMany`);
      return { count: before - bdb.t[table].length };
    },
  };
}

// ── Raw statements ──────────────────────────────────────────────────

function flatten(strings: readonly string[], values: unknown[]): { sql: string; values: unknown[] } {
  let sql = strings[0];
  const out: unknown[] = [];
  values.forEach((v, i) => {
    const frag = v as { strings?: unknown; values?: unknown } | null;
    if (frag && typeof frag === "object" && Array.isArray(frag.strings) && Array.isArray(frag.values)) {
      const inner = flatten(frag.strings as string[], frag.values as unknown[]);
      sql += inner.sql;
      out.push(...inner.values);
    } else {
      sql += "?";
      out.push(v);
    }
    sql += strings[i + 1];
  });
  return { sql, values: out };
}

const LIVE_IN = `IN ('starting', 'live', 'waiting', 'handed_over')`;
const LIVE_AND_ENDING_IN = `IN ('starting', 'live', 'waiting', 'handed_over', 'ending')`;

function need(sql: string, ...parts: string[]): void {
  for (const p of parts) if (!sql.includes(p)) throw new Error(`browser-test-db: a statement lost "${p}": ${sql}`);
}

const dayStart = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const monthStart = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

function policyOf(org: string): Row | undefined {
  return bdb.t.policies.find((p) => p.organizationId === org);
}

function raw(kind: "query" | "execute") {
  return async (strings: TemplateStringsArray, ...given: unknown[]) => {
    const flat = flatten(strings, given);
    const sql = flat.sql.replace(/\s+/g, " ").trim();
    const v = flat.values;
    bdb.raw.push(sql);
    const inTx = bdb.inTx > 0;

    if (sql.includes("pg_advisory_xact_lock(")) {
      bdb.locks.push({ cls: Number(v[0]), key: sql.includes("hashtext(") ? v[1] : 0, inTx });
      event("lock");
      return kind === "execute" ? 1 : [];
    }
    // budget.ts runState: the run, then the person.
    if (sql.startsWith('SELECT "status" FROM "AgentRun" WHERE "id" = ? FOR UPDATE')) {
      bdb.rowLocks.push({ what: "run", inTx });
      const r = bdb.t.runs.find((x) => x.id === v[0]);
      return r ? [{ status: r.status }] : [];
    }
    if (sql.startsWith('SELECT "id" FROM "User" WHERE "id" = ? AND "deletedAt" IS NULL FOR SHARE')) {
      const u = bdb.t.users.find((x) => x.id === v[0]);
      return !u || u.deletedAt == null ? [{ id: v[0] }] : [];
    }
    if (sql.includes('SELECT "id", "agentId" FROM "TeammateBrowserSession"')) {
      need(sql, LIVE_IN, "FOR UPDATE");
      bdb.rowLocks.push({ what: "person-session", inTx });
      const [org, user] = v as [string, string];
      return bdb.t.sessions.filter((s) => s.organizationId === org && s.userId === user && ["starting", "live", "waiting", "handed_over"].includes(String(s.status))).map((s) => ({ id: s.id, agentId: s.agentId }));
    }
    if (sql.includes('AS "platform"')) {
      // One row a boot and status (browser host final review, contract M2): the caller leaves out what our host freed.
      need(sql, LIVE_AND_ENDING_IN, 'SELECT "bootId", "status",', 'GROUP BY "bootId", "status"');
      const [org] = v as [string];
      const live = bdb.t.sessions.filter((s) => ["starting", "live", "waiting", "handed_over", "ending"].includes(String(s.status)));
      event("count.live");
      const groups = new Map<string, { bootId: unknown; status: unknown; platform: number; atOnce: number }>();
      for (const s of live) {
        const key = `${String(s.bootId)}\u0000${String(s.status)}`;
        const g = groups.get(key) ?? { bootId: s.bootId ?? null, status: s.status, platform: 0, atOnce: 0 };
        g.platform += 1;
        if (s.organizationId === org) g.atOnce += 1;
        groups.set(key, g);
      }
      return [...groups.values()];
    }
    if (sql.includes('AS "personToday"')) {
      need(sql, "date_trunc('day', now() AT TIME ZONE 'UTC')", "date_trunc('month', now() AT TIME ZONE 'UTC')", 'COALESCE("billedMinutes", "reservedMinutes")');
      // Both day counts hold only the starts that reached a browser (review of Phase 4 step 2).
      if (sql.split('"providerSessionId" IS NOT NULL').length - 1 !== 2) throw new Error(`browser-test-db: the day counts lost "providerSessionId" IS NOT NULL: ${sql}`);
      const [user, org] = v as [string, string];
      const rows = bdb.t.sessions.filter((s) => s.organizationId === org && time(s.startedAt) >= monthStart());
      const reached = rows.filter((s) => s.providerSessionId != null && time(s.startedAt) >= dayStart());
      event("count.month");
      return [
        {
          today: reached.length,
          personToday: reached.filter((s) => s.userId === user).length,
          month: rows.reduce((n, s) => n + Number(s.status === "ended" ? (s.billedMinutes ?? s.reservedMinutes) : s.reservedMinutes), 0),
        },
      ];
    }
    if (sql.includes("FOR UPDATE OF s")) {
      need(sql, 'u."deletedAt" IS NULL');
      bdb.rowLocks.push({ what: "step-session", inTx });
      const [rowId, userId] = v as [string, string];
      const s = bdb.t.sessions.find((x) => x.id === rowId && x.userId === userId);
      const u = bdb.t.users.find((x) => x.id === userId);
      return s && (!u || u.deletedAt == null) ? [{ id: rowId }] : [];
    }
    if (sql.includes('AS "top" FROM "TeammateBrowserStep"')) {
      const steps = bdb.t.steps.filter((x) => x.browserSessionId === v[0]);
      return [{ n: steps.length, top: steps.reduce((m, x) => Math.max(m, Number(x.seq)), 0) }];
    }
    // Phase 5 step 2: one person's skills, counted under their lock (src/lib/skills/store.ts createRecording).
    if (sql.includes('AS "withTeammate"')) {
      need(sql, 'FROM "TeammateSkill"', `count(*) FILTER (WHERE "status" = 'recording')`, 'lower("name") = lower(?)');
      const [agentId, agentId2, name, org, user] = v as [string, string, string, string, string];
      const mine = bdb.t.skills.filter((x) => x.organizationId === org && x.userId === user);
      event("count.skills");
      return [
        {
          withTeammate: mine.filter((x) => x.agentId === agentId).length,
          inWorkspace: mine.length,
          recording: mine.filter((x) => x.status === "recording").length,
          sameName: mine.filter((x) => x.agentId === agentId2 && String(x.name).toLowerCase() === String(name).toLowerCase()).length,
        },
      ];
    }
    if (sql.includes(`st."code" = 'recording'`)) {
      need(sql, `st."kind" = 'take_over'`, "date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 hour'", `st."at" >= date_trunc('day', now() AT TIME ZONE 'UTC')`, 'JOIN "TeammateBrowserSession" s');
      const [user] = v as [string];
      const day = dayStart();
      const sessions = new Set(bdb.t.sessions.filter((x) => x.userId === user && time(x.startedAt) >= day - 60 * 60_000).map((x) => x.id));
      event("count.recordings");
      return [{ n: bdb.t.steps.filter((st) => sessions.has(st.browserSessionId) && st.kind === "take_over" && st.code === "recording" && time(st.at) >= day).length }];
    }
    if (sql.startsWith('SELECT "enabled", "skillsEnabled" FROM "TeammateBrowserPolicy"')) {
      need(sql, "FOR SHARE");
      bdb.rowLocks.push({ what: "policy-share", inTx });
      const p = policyOf(String(v[0]));
      return p ? [{ enabled: p.enabled, skillsEnabled: p.skillsEnabled === true }] : [];
    }
    if (sql.startsWith('SELECT "skillsEnabled" FROM "TeammateBrowserPolicy"')) {
      need(sql, "FOR UPDATE");
      bdb.rowLocks.push({ what: "policy", inTx });
      const p = policyOf(String(v[0]));
      return p ? [{ skillsEnabled: p.skillsEnabled === true }] : [];
    }
    if (sql.startsWith('INSERT INTO "TeammateBrowserPolicy"') && sql.includes('RETURNING "skillsEnabled"')) {
      const [org, on, actor] = v as [string, boolean, string];
      let p = policyOf(org);
      if (!p) {
        p = { organizationId: org, enabled: false, allowSites: [], blockSites: [], skillsEnabled: on, updatedById: actor, createdAt: new Date(), updatedAt: new Date() };
        bdb.t.policies.push(p);
      } else Object.assign(p, { skillsEnabled: on, updatedById: actor, updatedAt: new Date() });
      event("policy.skills");
      return [{ skillsEnabled: p.skillsEnabled }];
    }
    if (sql.includes('count(DISTINCT "userId")')) {
      need(sql, 'FROM "TeammateSkill"');
      const mine = bdb.t.skills.filter((x) => x.organizationId === v[0]);
      return [{ kept: mine.length, people: new Set(mine.map((x) => x.userId)).size }];
    }
    if (sql.startsWith('SELECT "enabled" FROM "TeammateBrowserPolicy"')) {
      need(sql, "FOR UPDATE");
      bdb.rowLocks.push({ what: "policy", inTx });
      const p = policyOf(String(v[0]));
      return p ? [{ enabled: p.enabled }] : [];
    }
    if (sql.startsWith('INSERT INTO "TeammateBrowserPolicy"') && sql.includes('RETURNING "enabled"')) {
      const [org, on, actor] = v as [string, boolean, string];
      let p = policyOf(org);
      if (!p) {
        p = { organizationId: org, enabled: on, allowSites: [], blockSites: [], updatedById: actor, createdAt: new Date(), updatedAt: new Date() };
        bdb.t.policies.push(p);
      } else Object.assign(p, { enabled: on, updatedById: actor, updatedAt: new Date() });
      event("policy.enabled");
      return [{ enabled: p.enabled }];
    }
    const col = sql.includes('"allowSites" AS "sites"') || sql.includes('SET "allowSites"') || sql.includes('"allowSites" = CASE') ? "allowSites" : "blockSites";
    if (sql.startsWith("SELECT") && sql.includes('AS "sites" FROM "TeammateBrowserPolicy"')) {
      need(sql, "FOR UPDATE");
      bdb.rowLocks.push({ what: "policy", inTx });
      const p = policyOf(String(v[0]));
      return p ? [{ sites: [...(p[col] as string[])] }] : [];
    }
    if (sql.startsWith('INSERT INTO "TeammateBrowserPolicy"') && sql.includes("array_append")) {
      const org = String(v[0]);
      const list = String(v[1]);
      const site = String(v[2]);
      const actor = v[5];
      const column = list === "allow" ? "allowSites" : "blockSites";
      let p = policyOf(org);
      if (!p) {
        p = { organizationId: org, enabled: false, allowSites: [], blockSites: [], updatedById: actor, createdAt: new Date(), updatedAt: new Date() };
        bdb.t.policies.push(p);
      }
      const arr = p[column] as string[];
      if (!arr.includes(site)) arr.push(site);
      p.updatedById = actor;
      event("policy.site");
      return [{ sites: [...arr] }];
    }
    if (sql.startsWith('UPDATE "TeammateBrowserPolicy"') && sql.includes("array_remove")) {
      const [site, actor, org] = v as [string, string, string];
      const p = policyOf(org);
      if (!p) return [];
      p[col] = (p[col] as string[]).filter((x) => x !== site);
      p.updatedById = actor;
      event("policy.site");
      return [{ sites: [...(p[col] as string[])] }];
    }
    if (sql.startsWith('SELECT "browserSites" FROM "Agent"')) {
      need(sql, "FOR UPDATE");
      bdb.rowLocks.push({ what: "agent", inTx });
      const [id, org] = v as [string, string];
      const a = bdb.t.agents.find((x) => x.id === id && x.organizationId === org);
      return a ? [{ browserSites: [...(a.browserSites as string[])] }] : [];
    }
    if (sql.startsWith('UPDATE "Agent" SET "browserSites"')) {
      const [site, id] = v as [string, string];
      const a = bdb.t.agents.find((x) => x.id === id);
      if (!a) return [];
      const arr = a.browserSites as string[];
      a.browserSites = sql.includes("array_append") ? [...arr, site] : arr.filter((x) => x !== site);
      event("agent.sites");
      return [{ browserSites: [...(a.browserSites as string[])] }];
    }
    if (sql.startsWith('DELETE FROM "TeammateBrowserStep"')) {
      need(sql, "(now() AT TIME ZONE 'UTC') - interval '30 days'", "LIMIT");
      const limit = Number(v[0]);
      const cut = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const old = bdb.t.steps.filter((x) => time(x.at) < cut).slice(0, limit);
      bdb.t.steps = bdb.t.steps.filter((x) => !old.includes(x));
      event("steps.retention");
      return old.length;
    }
    // Phase 5 step 3: a person's review of their own skill, under their lock (src/lib/skills/manage.ts editOwnSkill).
    if (sql.startsWith('SELECT "id", "agentId", "status", "version", "steps", "name", "description", "startUrl" FROM "TeammateSkill"')) {
      need(sql, 'WHERE "id" = ? AND "userId" = ? AND "organizationId" = ? FOR UPDATE');
      bdb.rowLocks.push({ what: "skill", inTx });
      const [id, user, org] = v as [string, string, string];
      event("skill.forUpdate");
      return bdb.t.skills
        .filter((x) => x.id === id && x.userId === user && x.organizationId === org)
        .map((x) => ({ id: x.id, agentId: x.agentId, status: x.status, version: x.version, steps: structuredClone(x.steps), name: x.name, description: x.description, startUrl: x.startUrl }));
    }
    if (sql.startsWith('SELECT count(*)::int AS "n" FROM "TeammateSkill"')) {
      need(sql, 'lower("name") = lower(?)', '"id" <> ?');
      const [user, agentId, name, id] = v as [string, string, string, string];
      event("count.sameName");
      return [{ n: bdb.t.skills.filter((x) => x.userId === user && x.agentId === agentId && String(x.name).toLowerCase() === String(name).toLowerCase() && x.id !== id).length }];
    }
    // "Delete every skill" (manage.ts deleteEverySkill): a batch by the workspace's index, by id.
    if (sql.startsWith('DELETE FROM "TeammateSkill" WHERE "id" IN (SELECT "id" FROM "TeammateSkill" WHERE "organizationId" = ? LIMIT ?)')) {
      const [org, limit] = v as [string, number];
      const gone = bdb.t.skills.filter((x) => x.organizationId === org).slice(0, Number(limit));
      const ids = new Set(gone.map((x) => x.id));
      bdb.t.skills = bdb.t.skills.filter((x) => !ids.has(x.id));
      skillsGone(ids);
      event(`skills.deleteBatch:${gone.length}`);
      return gone.length;
    }
    throw new Error(`browser-test-db: unknown raw statement ${sql}`);
  };
}

const models = new Map<string, ReturnType<typeof model>>();

async function transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
  const saved = structuredClone(bdb.t);
  bdb.inTx += 1;
  try {
    return await fn(browserDb);
  } catch (err) {
    bdb.t = saved;
    throw err;
  } finally {
    bdb.inTx -= 1;
  }
}

export const browserDb: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_t, key: string) => {
      if (key === "$queryRaw") return raw("query");
      if (key === "$executeRaw") return raw("execute");
      if (key === "$transaction") return transaction;
      if (key === "then") return undefined;
      if (!models.has(key)) models.set(key, model(key));
      return models.get(key);
    },
  },
);
