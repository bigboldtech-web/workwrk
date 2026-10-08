// The connector tests' database double (src/lib/connectors/*.test.ts and
// src/app/api/teammate-connections/**/*.test.ts): an in-memory workspace
// behind the prisma calls src/lib/connectors makes, the raw statements
// included, each recognised by its own text. A statement this file does not
// know throws, so a query changed in the code cannot pass by being ignored.
// Every write is recorded in `cdb.events` with whether it ran inside a
// transaction, so a test can say a delete and its queued revoke were one.
//
// THE CLAUSES THAT CARRY A STATEMENT'S MEANING ARE ASSERTED, NOT ASSUMED
// (review of step 2). This file applies its own logic once it knows a
// statement, so a statement that lost its state expiry, a leaver condition,
// the other-workspace NOT EXISTS or the policy upsert's array guard would
// still pass on that logic alone. Each such statement is first checked for
// those clauses (needs below) and throws without them, so dropping one fails
// the tests that run it. The real-Postgres run of these statements stays in
// the live proof.
//
// The tests mock the real module with it:
//   vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));
//
// Test-only: nothing in the app imports it.

import { legacyLevelOfRow } from "@/lib/access/test-fixtures";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma";

export type Row = Record<string, unknown>;

export const cdb = {
  connections: [] as Row[],
  states: [] as Row[],
  revocations: [] as Row[],
  /** organizationId to products. */
  policy: new Map<string, string[]>(),
  settings: [] as Row[],
  users: [] as Row[],
  memberships: [] as Row[],
  orgs: new Map<string, string>(),
  /** Workspaces deleted or closed (Organization.status CANCELLED). */
  closedOrgs: new Set<string>(),
  notifications: [] as Row[],
  activity: [] as Row[],
  agents: [] as Row[],
  /** Every write, in order, with whether it ran inside $transaction. */
  events: [] as Array<{ op: string; inTx: boolean }>,
  /** The text of every raw statement, in order. */
  raw: [] as string[],
  /** Every connection lookup by (organizationId, userId). */
  lookups: [] as Array<{ organizationId: string; userId: string }>,
  /** Every per-account lock statement: the keys it locked, in the order it locked them. */
  locks: [] as Array<{ keys: string[]; inTx: boolean }>,
};

let seq = 0;

export function resetConnectorDb(): void {
  cdb.connections = [];
  cdb.states = [];
  cdb.revocations = [];
  cdb.policy = new Map();
  cdb.settings = [];
  cdb.users = [];
  cdb.memberships = [];
  cdb.orgs = new Map([["org1", "Acme"]]);
  cdb.closedOrgs = new Set();
  cdb.notifications = [];
  cdb.activity = [];
  cdb.agents = [];
  cdb.events = [];
  cdb.raw = [];
  cdb.lookups = [];
  cdb.locks = [];
  seq = 0;
}

/** The account key as the code and the SQL write it (connections.ts accountKey), worked out here on its own. */
export function keyOf(provider: string, sub: string): string {
  return createHash("sha256").update(`${provider}:${sub}`, "utf8").digest("hex");
}

/** A connection row as the table holds it; sealed blobs are whatever the test passes. Its accountKey is the backfill's. */
export function seedConnection(o: Row & { organizationId: string; userId: string; accountSub: string }): Row {
  const row: Row = {
    id: `tc${++seq}`,
    provider: "google",
    status: "active",
    statusReason: null,
    products: ["gmail", "calendar"],
    scopes: [],
    accountEmail: `${o.userId}@mail.test`,
    refreshTokenSealed: { v: 1, iv: "00", ct: "00", tag: "00" },
    accessTokenSealed: null,
    accessTokenExpiresAt: null,
    tokenVersion: 1,
    connectedAt: new Date("2026-10-08T09:00:00Z"),
    lastUsedAt: null,
    lastUsedAgentId: null,
    needsReconnectAt: null,
    accountKey: keyOf(String(o.provider ?? "google"), o.accountSub),
    ...o,
  };
  cdb.connections.push(row);
  return row;
}

let inTx = false;

function wrote(op: string): void {
  cdb.events.push({ op, inTx });
}

const copy = <T extends Row | undefined>(r: T): T => (r ? ({ ...r } as T) : r);

/** Throw unless the statement holds every clause its meaning rests on (see the file header). */
function needs(sql: string, what: string, clauses: readonly string[]): void {
  for (const c of clauses) {
    if (!sql.includes(c)) throw new Error(`connector-test-db: ${what} lacks ${c}\n${sql}`);
  }
}

/** The account key expression the SQL paths must use, so it matches the code's. */
const KEY_SQL = `encode(sha256(convert_to(c."provider" || ':' || c."accountSub", 'UTF8')), 'hex')`;

/** The other-workspace guard of the hard delete's two statements. */
const OTHER_WORKSPACE = `(SELECT 1 FROM "TeammateConnection" o WHERE o."provider" = c."provider" AND o."accountSub" = c."accountSub" AND o."organizationId" <> ?)`;

/** Some other workspace's row holds this connection's account. */
function heldElsewhere(c: Row, org: unknown): boolean {
  return cdb.connections.some((o) => o.provider === c.provider && o.accountSub === c.accountSub && o.organizationId !== org);
}

/** One condition list of a removeConnections where, as the code writes them. */
function wherePredicate(where: string, vals: unknown[]): (r: Row) => boolean {
  if (where.includes('JOIN "Organization" o')) {
    needs(where, "the closed-workspace sweep", ['JOIN "Organization" o ON o."id" = c."organizationId"', `o."status" = 'CANCELLED'`]);
    return (r) => cdb.closedOrgs.has(String(r.organizationId));
  }
  if (where.includes(`u."accessLevel" = 'AGENT'`)) {
    needs(where, "the no-access sweep", [
      `u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'`,
      `u."organizationId" = c."organizationId" AND (u."accessLevel" = 'AGENT' OR (?::boolean AND u."orgRole" = 'GUEST' AND u."accessLevel" NOT IN ('SUPER_ADMIN', 'COMPANY_ADMIN')))`,
      `u."organizationId" <> c."organizationId" AND EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = c."userId" AND m."organizationId" = c."organizationId" AND m."role" = 'AGENT')`,
    ]);
    const guestColumnRead = vals[0] === true;
    return (r) => {
      const u = cdb.users.find((x) => x.id === r.userId);
      if (!u || u.deletedAt || u.status === "INACTIVE") return false;
      if (u.organizationId === r.organizationId) {
        const level = legacyLevelOfRow(u);
        return level === "AGENT" || (guestColumnRead && u.orgRole === "GUEST" && level !== "SUPER_ADMIN" && level !== "COMPANY_ADMIN");
      }
      return cdb.memberships.some((m) => m.userId === r.userId && m.organizationId === r.organizationId && m.role === "AGENT");
    };
  }
  if (where.includes('"OrganizationMembership"')) {
    needs(where, "the leaver sweep", [
      `u."deletedAt" IS NOT NULL OR u."status" = 'INACTIVE'`,
      `u."organizationId" <> c."organizationId"`,
      `NOT EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = c."userId" AND m."organizationId" = c."organizationId")`,
    ]);
    return (r) => {
      const u = cdb.users.find((x) => x.id === r.userId);
      if (!u) return false;
      if (u.deletedAt || u.status === "INACTIVE") return true;
      return u.organizationId !== r.organizationId && !cdb.memberships.some((m) => m.userId === r.userId && m.organizationId === r.organizationId);
    };
  }
  let i = 0;
  const tests = where.split(" AND ").map((raw) => {
    const c = raw.trim();
    const eq = /^"(\w+)" = \?$/.exec(c);
    if (eq) {
      const v = vals[i++];
      return (r: Row) => r[eq[1]] === v;
    }
    const inList = /^"(\w+)" IN \(([?, ]+)\)$/.exec(c);
    if (inList) {
      const n = (inList[2].match(/\?/g) ?? []).length;
      const vs = vals.slice(i, i + n);
      i += n;
      return (r: Row) => vs.includes(r[inList[1]]);
    }
    throw new Error(`connector-test-db: unknown condition ${c}`);
  });
  return (r) => tests.every((t) => t(r));
}

function rawOf(strings: TemplateStringsArray, values: unknown[]): { sql: string; values: unknown[] } {
  const q = Prisma.sql(strings, ...values);
  const sql = q.sql.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
  cdb.raw.push(sql);
  return { sql, values: q.values };
}

async function queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  const { sql, values: v } = rawOf(strings, values);
  const now = Date.now();
  if (sql.startsWith('DELETE FROM "TeammateOAuthState" WHERE "id" = ?')) {
    needs(sql, "consumeState", [`AND "expiresAt" > (now() AT TIME ZONE 'UTC')`, "RETURNING"]);
    const i = cdb.states.findIndex((s) => s.id === v[0] && (s.expiresAt as Date).getTime() > now);
    if (i < 0) return [];
    const [row] = cdb.states.splice(i, 1);
    wrote("state.delete");
    return [row];
  }
  if (sql.startsWith('SELECT "id", "accountSub", "refreshTokenSealed" FROM "TeammateConnection"')) {
    needs(sql, "saveOnce's read", ["FOR UPDATE"]);
    return cdb.connections.filter((c) => c.organizationId === v[0] && c.userId === v[1] && c.provider === "google").map(copy);
  }
  if (sql.startsWith('DELETE FROM "TeammateConnection" WHERE "id" IN (SELECT "id" FROM "TeammateConnection" WHERE ')) {
    const m = /WHERE "id" IN \(SELECT "id" FROM "TeammateConnection" WHERE (.*) LIMIT \?\) RETURNING/.exec(sql);
    if (!m) throw new Error(`connector-test-db: unreadable delete ${sql}`);
    const take = Number(v[v.length - 1]);
    const match = wherePredicate(m[1], v.slice(0, -1));
    const gone = cdb.connections.filter(match).slice(0, take);
    cdb.connections = cdb.connections.filter((c) => !gone.includes(c));
    if (gone.length) wrote("connection.delete");
    return gone.map(copy);
  }
  if (sql.startsWith('SELECT DISTINCT "accountSub" FROM "TeammateConnection"')) {
    const subs = v[0] as string[];
    return [...new Set(cdb.connections.filter((c) => c.provider === "google" && subs.includes(String(c.accountSub))).map((c) => c.accountSub))].map((s) => ({ accountSub: s }));
  }
  if (sql.startsWith('SELECT DISTINCT "accountKey" FROM "TeammateConnection" WHERE "accountKey" = ANY(?::text[])')) {
    const keys = v[0] as string[];
    return [...new Set(cdb.connections.filter((c) => keys.includes(String(c.accountKey))).map((c) => c.accountKey))].map((k) => ({ accountKey: k }));
  }
  if (sql.startsWith('UPDATE "TeammateTokenRevocation" SET "attempts" = "attempts" + 1')) {
    needs(sql, "the revoke claim", [`WHERE "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')`, "FOR UPDATE SKIP LOCKED", '"accountKey"']);
    const take = Number(v[0]);
    const due = cdb.revocations.filter((r) => (r.nextAttemptAt as Date).getTime() <= now).slice(0, take);
    for (const r of due) {
      r.attempts = Number(r.attempts) + 1;
      r.nextAttemptAt = new Date(now + 60 * 60 * 1000);
    }
    if (due.length) wrote("revocation.claim");
    return due.map((r) => ({ id: r.id, tokenSealed: r.tokenSealed, attempts: r.attempts, createdAt: r.createdAt, accountKey: r.accountKey ?? null }));
  }
  if (sql.startsWith('SELECT count(*)::int AS "connected"')) {
    const rows = cdb.connections.filter((c) => c.organizationId === v[0]);
    const has = (p: string) => rows.filter((c) => (c.products as string[]).includes(p)).length;
    return [{ connected: rows.length, gmail: has("gmail"), calendar: has("calendar"), needsReconnect: rows.filter((c) => c.status === "needs_reconnect").length }];
  }
  if (sql.startsWith('INSERT INTO "TeammateConnectorPolicy"')) {
    needs(sql, "setPolicyProduct", [
      `VALUES (?, 'google', CASE WHEN ?::boolean THEN ARRAY[?::text] ELSE ARRAY[]::text[] END`,
      'ON CONFLICT ("organizationId", "provider") DO UPDATE SET',
      `CASE WHEN ?::text = ANY("TeammateConnectorPolicy"."products") THEN "TeammateConnectorPolicy"."products"`,
      `ELSE array_append("TeammateConnectorPolicy"."products", ?::text) END)`,
      `ELSE array_remove("TeammateConnectorPolicy"."products", ?::text) END`,
      'RETURNING "products"',
    ]);
    const [org, on, product] = v as [string, boolean, string];
    const was = cdb.policy.get(org) ?? [];
    const next = on ? (was.includes(product) ? was : [...was, product]) : was.filter((p) => p !== product);
    cdb.policy.set(org, next);
    wrote("policy.upsert");
    return [{ products: next }];
  }
  if (sql.startsWith('SELECT lower(u."email") AS "email" FROM "User" u')) {
    // Who of an email's recipients is a live person of this workspace (connector-previews.ts outsideCount).
    needs(sql, "the workspace member check", [
      `WHERE lower(u."email") = ANY(?::text[])`,
      `u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'`,
      `(u."organizationId" = ? OR EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = u."id" AND m."organizationId" = ?))`,
    ]);
    const [emails, org] = v as [string[], string];
    return cdb.users
      .filter((u) => !u.deletedAt && u.status !== "INACTIVE" && emails.includes(String(u.email).toLowerCase()))
      .filter((u) => u.organizationId === org || cdb.memberships.some((m) => m.userId === u.id && m.organizationId === org))
      .map((u) => ({ email: String(u.email).toLowerCase() }));
  }
  throw new Error(`connector-test-db: unknown query ${sql}`);
}

/** Record one lock statement's keys, in the order the database would lock them; a lock outside a transaction holds nothing. */
function locked(keys: string[]): void {
  if (!inTx) throw new Error("connector-test-db: an account lock outside a transaction is released at once");
  const sorted = [...keys].sort();
  cdb.locks.push({ keys: sorted, inTx });
  wrote("lock");
}

async function executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
  const { sql, values: v } = rawOf(strings, values);
  const now = Date.now();
  if (sql.startsWith('DELETE FROM "TeammateOAuthState" WHERE "expiresAt" <')) {
    needs(sql, "the state sweep", [`WHERE "expiresAt" < (now() AT TIME ZONE 'UTC')`]);
    const before = cdb.states.length;
    cdb.states = cdb.states.filter((s) => (s.expiresAt as Date).getTime() >= now);
    if (before !== cdb.states.length) wrote("state.sweep");
    return before - cdb.states.length;
  }
  if (sql === `SELECT pg_advisory_xact_lock(hashtext('tc-sub:' || k)) FROM unnest(?::text[]) AS k ORDER BY k`) {
    const keys = v[0] as string[];
    locked(keys);
    return keys.length;
  }
  if (sql.startsWith(`SELECT pg_advisory_xact_lock(hashtext('tc-sub:' || s.k)) FROM (SELECT DISTINCT ${KEY_SQL} AS k`)) {
    needs(sql, "the hard delete's lock", [`WHERE c."organizationId" = ?`, `AND EXISTS ${OTHER_WORKSPACE}`, "ORDER BY s.k"]);
    const org = v[0];
    const keys = [...new Set(cdb.connections.filter((c) => c.organizationId === org && heldElsewhere(c, org)).map((c) => keyOf(String(c.provider), String(c.accountSub))))];
    locked(keys);
    return keys.length;
  }
  if (sql.startsWith('UPDATE "TeammateConnection" SET "lastUsedAt"')) {
    const row = cdb.connections.find((c) => c.id === v[1]);
    if (!row || (row.lastUsedAt && now - (row.lastUsedAt as Date).getTime() < 60_000)) return 0;
    row.lastUsedAt = new Date(now);
    row.lastUsedAgentId = v[0];
    wrote("connection.touch");
    return 1;
  }
  if (sql.startsWith('INSERT INTO "TeammateTokenRevocation"')) {
    needs(sql, "queueWorkspaceRevocations", [`WHERE c."organizationId" = ?`, `AND NOT EXISTS ${OTHER_WORKSPACE}`, `'workspace_deleted'`, `"accountKey")`, KEY_SQL]);
    const org = v[0];
    const rows = cdb.connections.filter((c) => c.organizationId === org && !heldElsewhere(c, org));
    for (const c of rows) {
      cdb.revocations.push({
        id: `rv_sql${++seq}`,
        provider: c.provider,
        tokenSealed: c.refreshTokenSealed,
        reason: "workspace_deleted",
        attempts: 0,
        nextAttemptAt: new Date(now),
        createdAt: new Date(now),
        accountKey: keyOf(String(c.provider), String(c.accountSub)),
      });
    }
    wrote("revocation.queueWorkspace");
    return rows.length;
  }
  if (sql.startsWith('INSERT INTO "AgentPersonSetting"')) {
    needs(sql, "the allow", ['ON CONFLICT ("agentId", "userId") DO UPDATE SET', `ELSE array_append("AgentPersonSetting"."connectorProducts", ?::text) END`, "jsonb_set("]);
    const [, agentId, userId, product, , prints] = v as [string, string, string, string, string, string];
    let row = cdb.settings.find((s) => s.agentId === agentId && s.userId === userId);
    if (!row) {
      row = { id: `ps${++seq}`, agentId, userId, approvalRules: {}, connectorProducts: [], connectorPrints: null };
      cdb.settings.push(row);
    }
    const list = row.connectorProducts as string[];
    if (!list.includes(product)) row.connectorProducts = [...list, product];
    const kept = row.connectorPrints && typeof row.connectorPrints === "object" ? (row.connectorPrints as Row) : {};
    row.connectorPrints = { ...kept, [product]: JSON.parse(prints) };
    wrote("setting.allow");
    return 1;
  }
  if (sql.startsWith('UPDATE "AgentPersonSetting" SET "connectorProducts" = array_remove')) {
    needs(sql, "the disallow", [`"connectorPrints" - ?::text`, `WHERE "agentId" = ? AND "userId" = ?`]);
    const [product, , agentId, userId] = v as [string, string, string, string];
    const row = cdb.settings.find((s) => s.agentId === agentId && s.userId === userId);
    if (!row) return 0;
    row.connectorProducts = (row.connectorProducts as string[]).filter((p) => p !== product);
    if (row.connectorPrints && typeof row.connectorPrints === "object") {
      const next = { ...(row.connectorPrints as Row) };
      delete next[product];
      row.connectorPrints = next;
    }
    wrote("setting.disallow");
    return 1;
  }
  throw new Error(`connector-test-db: unknown statement ${sql}`);
}

type Args = { where?: Row; data?: Row; select?: Row; take?: number };

function connectionWhere(where: Row | undefined): (c: Row) => boolean {
  return (c) =>
    Object.entries(where ?? {}).every(([k, want]) => {
      if (want && typeof want === "object" && !Array.isArray(want) && "not" in (want as Row)) return c[k] !== (want as Row).not;
      return c[k] === want;
    });
}

/** A where on id: one id, or { in: [...] }. */
function idMatch(where: Row | undefined): (r: Row) => boolean {
  const want = where?.id;
  if (want && typeof want === "object" && Array.isArray((want as { in?: unknown }).in)) {
    const ids = (want as { in: unknown[] }).in;
    return (r) => ids.includes(r.id);
  }
  return (r) => r.id === want;
}

export const connectorDb = {
  $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const was = inTx;
    inTx = true;
    try {
      return await fn(connectorDb);
    } finally {
      inTx = was;
    }
  },
  $queryRaw: queryRaw,
  $executeRaw: executeRaw,
  teammateConnectorPolicy: {
    findUnique: async (a: Args) => {
      const key = (a.where as { organizationId_provider: { organizationId: string } }).organizationId_provider;
      const products = cdb.policy.get(key.organizationId);
      return products ? { products, updatedAt: new Date("2026-10-08T09:00:00Z") } : null;
    },
  },
  teammateConnection: {
    findUnique: async (a: Args) => {
      // By id (a refresh reading the row again), or by the person's own key. Null when none, as Prisma answers.
      if (a.where && typeof a.where.id === "string") return copy(cdb.connections.find((c) => c.id === a.where?.id)) ?? null;
      const key = (a.where as { organizationId_userId_provider: { organizationId: string; userId: string; provider: string } }).organizationId_userId_provider;
      cdb.lookups.push({ organizationId: key.organizationId, userId: key.userId });
      return copy(cdb.connections.find((c) => c.organizationId === key.organizationId && c.userId === key.userId && c.provider === key.provider)) ?? null;
    },
    count: async (a: Args) => cdb.connections.filter(connectionWhere(a.where)).length,
    updateMany: async (a: Args) => {
      const hit = cdb.connections.filter(connectionWhere(a.where));
      for (const c of hit) Object.assign(c, a.data, a.data && a.data.accessTokenSealed === Prisma.DbNull ? { accessTokenSealed: null } : {});
      if (hit.length) wrote("connection.updateMany");
      return { count: hit.length };
    },
    create: async (a: Args) => {
      const data = a.data as Row;
      if (cdb.connections.some((c) => c.organizationId === data.organizationId && c.userId === data.userId && c.provider === data.provider)) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      }
      // What the code wrote, its accountKey included (no backfill fills one here).
      const row = seedConnection({ accountKey: null, ...(data as Row & { organizationId: string; userId: string; accountSub: string }) });
      wrote("connection.create");
      return copy(row);
    },
    update: async (a: Args) => {
      const row = cdb.connections.find((c) => c.id === a.where?.id);
      if (!row) throw new Error("not found");
      for (const [k, val] of Object.entries(a.data ?? {})) {
        if (val && typeof val === "object" && "increment" in (val as Row)) row[k] = Number(row[k]) + Number((val as Row).increment);
        else row[k] = val;
      }
      wrote("connection.update");
      return copy(row);
    },
  },
  teammateOAuthState: {
    create: async (a: Args) => {
      cdb.states.push({ ...(a.data as Row) });
      wrote("state.create");
      return copy(a.data as Row);
    },
  },
  teammateTokenRevocation: {
    create: async (a: Args) => {
      cdb.revocations.push({ attempts: 0, nextAttemptAt: new Date(), createdAt: new Date(), accountKey: null, ...(a.data as Row) });
      wrote("revocation.create");
      return copy(a.data as Row);
    },
    createMany: async (a: { data: Row[] }) => {
      for (const r of a.data) cdb.revocations.push({ attempts: 0, nextAttemptAt: new Date(), createdAt: new Date(), accountKey: null, ...r });
      wrote("revocation.createMany");
      return { count: a.data.length };
    },
    findMany: async (a: Args) => {
      const ids = ((a.where?.id as { in: string[] }) ?? { in: [] }).in;
      return cdb.revocations.filter((r) => ids.includes(String(r.id))).map((r) => ({ accountKey: null, ...r }));
    },
    deleteMany: async (a: Args) => {
      const before = cdb.revocations.length;
      const match = idMatch(a.where);
      cdb.revocations = cdb.revocations.filter((r) => !match(r));
      if (before !== cdb.revocations.length) wrote("revocation.delete");
      return { count: before - cdb.revocations.length };
    },
  },
  agentPersonSetting: {
    findUnique: async (a: Args) => {
      const key = (a.where as { agentId_userId: { agentId: string; userId: string } }).agentId_userId;
      return copy(cdb.settings.find((s) => s.agentId === key.agentId && s.userId === key.userId));
    },
    findMany: async (a: Args) => {
      const ids = ((a.where?.agentId as { in: string[] }) ?? { in: [] }).in;
      return cdb.settings.filter((s) => s.userId === a.where?.userId && ids.includes(String(s.agentId))).map(copy);
    },
  },
  agent: {
    // By id (the last user's name), or by slug in a workspace (loadTeammate); its access rules are canUseAgent's, after.
    findFirst: async (a: Args) =>
      copy(
        cdb.agents.find((g) =>
          a.where?.id !== undefined ? g.id === a.where?.id : g.slug === a.where?.slug && g.organizationId === a.where?.organizationId && g.status !== "ARCHIVED",
        ),
      ),
    findMany: async () => cdb.agents.map(copy),
  },
  organization: {
    findUnique: async (a: Args) => {
      const id = String(a.where?.id);
      const name = cdb.orgs.get(id);
      return name === undefined ? null : { name, status: cdb.closedOrgs.has(id) ? "CANCELLED" : "ACTIVE" };
    },
    findMany: async (a: Args) => {
      const ids = ((a.where?.id as { in: string[] }) ?? { in: [] }).in;
      return ids.filter((id) => cdb.orgs.has(id)).map((id) => ({ id, name: cdb.orgs.get(id) }));
    },
  },
  notification: {
    create: async (a: Args) => {
      cdb.notifications.push({ read: false, ...(a.data as Row) });
      wrote("notification.create");
      return copy(a.data as Row);
    },
    createMany: async (a: { data: Row[] }) => {
      for (const r of a.data) cdb.notifications.push({ read: false, ...r });
      wrote("notification.createMany");
      return { count: a.data.length };
    },
    updateMany: async (a: Args) => {
      // A reconnect marks its workspace's rows read by their link, never by their message.
      const w = a.where as { userId: string; type: string; read: boolean; link: string; message?: unknown };
      if (w.message !== undefined || typeof w.link !== "string") throw new Error("connector-test-db: notices are marked read by their link");
      const hit = cdb.notifications.filter((n) => n.userId === w.userId && n.type === w.type && n.read === false && n.link === w.link);
      for (const n of hit) n.read = true;
      return { count: hit.length };
    },
  },
  activityLog: {
    create: async (a: Args) => {
      cdb.activity.push({ ...(a.data as Row) });
      wrote("activity.create");
      return copy(a.data as Row);
    },
    createMany: async (a: { data: Row[] }) => {
      for (const r of a.data) cdb.activity.push({ ...r });
      wrote("activity.createMany");
      return { count: a.data.length };
    },
  },
};
