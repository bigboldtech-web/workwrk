// The connector tests' database double (src/lib/connectors/*.test.ts and
// src/app/api/teammate-connections/**/*.test.ts): an in-memory workspace
// behind the prisma calls src/lib/connectors makes, the raw statements
// included, each recognised by its own text. A statement this file does not
// know throws, so a query changed in the code cannot pass by being ignored.
// Every write is recorded in `cdb.events` with whether it ran inside a
// transaction, so a test can say a delete and its queued revoke were one.
//
// The tests mock the real module with it:
//   vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));
//
// Test-only: nothing in the app imports it.

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
  notifications: [] as Row[],
  activity: [] as Row[],
  agents: [] as Row[],
  /** Every write, in order, with whether it ran inside $transaction. */
  events: [] as Array<{ op: string; inTx: boolean }>,
  /** The text of every raw statement, in order. */
  raw: [] as string[],
  /** Every connection lookup by (organizationId, userId). */
  lookups: [] as Array<{ organizationId: string; userId: string }>,
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
  cdb.notifications = [];
  cdb.activity = [];
  cdb.agents = [];
  cdb.events = [];
  cdb.raw = [];
  cdb.lookups = [];
  seq = 0;
}

/** A connection row as the table holds it; sealed blobs are whatever the test passes. */
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

/** One condition list of a removeConnections where, as the code writes them. */
function wherePredicate(where: string, vals: unknown[]): (r: Row) => boolean {
  if (where.includes('"OrganizationMembership"')) {
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
  const sql = q.sql.replace(/\s+/g, " ").trim();
  cdb.raw.push(sql);
  return { sql, values: q.values };
}

async function queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  const { sql, values: v } = rawOf(strings, values);
  const now = Date.now();
  if (sql.startsWith('DELETE FROM "TeammateOAuthState" WHERE "id" = ?')) {
    const i = cdb.states.findIndex((s) => s.id === v[0] && (s.expiresAt as Date).getTime() > now);
    if (i < 0) return [];
    const [row] = cdb.states.splice(i, 1);
    wrote("state.delete");
    return [row];
  }
  if (sql.startsWith('SELECT "id", "accountSub", "refreshTokenSealed" FROM "TeammateConnection"')) {
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
  if (sql.startsWith('UPDATE "TeammateTokenRevocation" SET "attempts" = "attempts" + 1')) {
    const take = Number(v[0]);
    const due = cdb.revocations.filter((r) => (r.nextAttemptAt as Date).getTime() <= now).slice(0, take);
    for (const r of due) {
      r.attempts = Number(r.attempts) + 1;
      r.nextAttemptAt = new Date(now + 60 * 60 * 1000);
    }
    if (due.length) wrote("revocation.claim");
    return due.map((r) => ({ id: r.id, tokenSealed: r.tokenSealed, attempts: r.attempts, createdAt: r.createdAt }));
  }
  if (sql.startsWith('SELECT count(*)::int AS "connected"')) {
    const rows = cdb.connections.filter((c) => c.organizationId === v[0]);
    const has = (p: string) => rows.filter((c) => (c.products as string[]).includes(p)).length;
    return [{ connected: rows.length, gmail: has("gmail"), calendar: has("calendar"), needsReconnect: rows.filter((c) => c.status === "needs_reconnect").length }];
  }
  if (sql.startsWith('INSERT INTO "TeammateConnectorPolicy"')) {
    const [org, on, product] = v as [string, boolean, string];
    const was = cdb.policy.get(org) ?? [];
    const next = on ? (was.includes(product) ? was : [...was, product]) : was.filter((p) => p !== product);
    cdb.policy.set(org, next);
    wrote("policy.upsert");
    return [{ products: next }];
  }
  throw new Error(`connector-test-db: unknown query ${sql}`);
}

async function executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
  const { sql, values: v } = rawOf(strings, values);
  const now = Date.now();
  if (sql.startsWith('DELETE FROM "TeammateOAuthState" WHERE "expiresAt" <')) {
    const before = cdb.states.length;
    cdb.states = cdb.states.filter((s) => (s.expiresAt as Date).getTime() >= now);
    if (before !== cdb.states.length) wrote("state.sweep");
    return before - cdb.states.length;
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
    const org = v[0];
    const rows = cdb.connections.filter(
      (c) => c.organizationId === org && !cdb.connections.some((o) => o.provider === c.provider && o.accountSub === c.accountSub && o.organizationId !== org),
    );
    for (const c of rows) cdb.revocations.push({ id: `rv_sql${++seq}`, provider: c.provider, tokenSealed: c.refreshTokenSealed, reason: "workspace_deleted", attempts: 0, nextAttemptAt: new Date(now), createdAt: new Date(now) });
    wrote("revocation.queueWorkspace");
    return rows.length;
  }
  if (sql.startsWith('INSERT INTO "AgentPersonSetting"')) {
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
      const key = (a.where as { organizationId_userId_provider: { organizationId: string; userId: string; provider: string } }).organizationId_userId_provider;
      cdb.lookups.push({ organizationId: key.organizationId, userId: key.userId });
      return copy(cdb.connections.find((c) => c.organizationId === key.organizationId && c.userId === key.userId && c.provider === key.provider));
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
      const row = seedConnection({ ...(data as Row & { organizationId: string; userId: string; accountSub: string }) });
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
      cdb.revocations.push({ attempts: 0, nextAttemptAt: new Date(), createdAt: new Date(), ...(a.data as Row) });
      wrote("revocation.create");
      return copy(a.data as Row);
    },
    createMany: async (a: { data: Row[] }) => {
      for (const r of a.data) cdb.revocations.push({ attempts: 0, nextAttemptAt: new Date(), createdAt: new Date(), ...r });
      wrote("revocation.createMany");
      return { count: a.data.length };
    },
    findMany: async (a: Args) => {
      const ids = ((a.where?.id as { in: string[] }) ?? { in: [] }).in;
      return cdb.revocations.filter((r) => ids.includes(String(r.id))).map(copy);
    },
    deleteMany: async (a: Args) => {
      const before = cdb.revocations.length;
      cdb.revocations = cdb.revocations.filter((r) => r.id !== a.where?.id);
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
      const name = cdb.orgs.get(String(a.where?.id));
      return name === undefined ? null : { name };
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
      const w = a.where as { userId: string; type: string; message: { in: string[] } };
      const hit = cdb.notifications.filter((n) => n.userId === w.userId && n.type === w.type && n.read === false && w.message.in.includes(String(n.message)));
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
