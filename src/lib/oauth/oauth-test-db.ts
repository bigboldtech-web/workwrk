// An in-memory stand-in for the parts of Prisma the OAuth server and the MCP
// server use, for the vitest suites (never imported by the app). Each model
// is an array of rows; `where` supports equality, null, gt/gte/lt/lte,
// in/notIn, not, has, contains, startsWith, a Json field's { path, equals },
// OR and AND, and compound keys
// (userId_organizationId, grantId_day); `orderBy` one key or a list;
// `select` a nested select over a related row stored inline; `data`
// supports { increment }. A transaction runs its function against the same store (the
// tests are single threaded); a raw statement is recorded, not run.

import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const MODEL_DEFAULTS: Record<string, () => Row> = {
  oAuthClient: () => ({ name: "", grantTypes: ["authorization_code", "refresh_token"], secretHash: null, disabledAt: null, disabledReason: null, lastUsedAt: null, createdAt: new Date() }),
  oAuthAuthorizationRequest: () => ({ state: null, viewerId: null, csrfHash: null, createdAt: new Date() }),
  oAuthGrant: () => ({ lastUsedAt: null, revokedAt: null, revokedReason: null, revokedById: null, createdAt: new Date(), updatedAt: new Date() }),
  oAuthAuthorizationCode: () => ({ usedAt: null, createdAt: new Date() }),
  oAuthToken: () => ({ parentId: null, usedAt: null, revokedAt: null, createdAt: new Date() }),
  mcpPolicy: () => ({ enabled: false, allowedApps: [], updatedById: null, createdAt: new Date(), updatedAt: new Date() }),
  mcpUsageDay: () => ({ calls: 0, writes: 0, refused: 0 }),
  notification: () => ({ read: false, createdAt: new Date() }),
  activityLog: () => ({ createdAt: new Date() }),
  user: () => ({ deletedAt: null, status: "ACTIVE", tokenVersion: 0, mfaEnabled: false, passwordChangedAt: null, ...legacyLevelRow("EMPLOYEE"), adminScopes: [] }),
  organization: () => ({ status: "ACTIVE", settings: {} }),
  organizationMembership: () => ({ role: "EMPLOYEE", isPrimary: false, adminScopes: [] }),
};

const KEY_OF: Record<string, string> = { mcpPolicy: "organizationId" };

function cmp(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "string" && typeof y === "string") return x < y ? -1 : x > y ? 1 : 0;
  return null;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return cmp(a, b) === 0;
  return a === b;
}

/** A compound key (userId_organizationId, grantId_day) read as its fields. */
function expand(where: Where): Where {
  const out: Where = {};
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k.includes("_") && v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) Object.assign(out, v as Where);
    else out[k] = v;
  }
  return out;
}

export function matches(row: Row, whereRaw: Where | undefined): boolean {
  const where = expand(whereRaw ?? {});
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") {
      if (!(cond as Where[]).some((c) => matches(row, c))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(cond as Where[]).every((c) => matches(row, c))) return false;
      continue;
    }
    const v = row[k];
    if (cond === undefined) continue;
    if (cond === null) {
      if (v !== null && v !== undefined) return false;
      continue;
    }
    if (cond instanceof Date || typeof cond !== "object" || Array.isArray(cond)) {
      if (!same(v, cond)) return false;
      continue;
    }
    // A Json field's value at a path (Prisma's { path, equals } on Postgres).
    if (Array.isArray((cond as Record<string, unknown>).path)) {
      let at: unknown = v;
      for (const step of (cond as { path: string[] }).path) at = at && typeof at === "object" && !Array.isArray(at) ? (at as Row)[step] : undefined;
      if ("equals" in (cond as Record<string, unknown>) && !same(at, (cond as Record<string, unknown>).equals)) return false;
      // { path, string_starts_with } on a string value (a goal's Date field window).
      const starts = (cond as Record<string, unknown>).string_starts_with;
      if (typeof starts === "string" && !(typeof at === "string" && at.startsWith(starts))) return false;
      continue;
    }
    for (const [op, x] of Object.entries(cond as Record<string, unknown>)) {
      const c = cmp(v, x);
      if (op === "gt" && !(c !== null && c > 0)) return false;
      if (op === "gte" && !(c !== null && c >= 0)) return false;
      if (op === "lt" && !(c !== null && c < 0)) return false;
      if (op === "lte" && !(c !== null && c <= 0)) return false;
      if (op === "in" && !(x as unknown[]).some((y) => same(v, y))) return false;
      if (op === "notIn" && (x as unknown[]).some((y) => same(v, y))) return false;
      if (op === "not" && (x === null ? v === null || v === undefined : same(v, x))) return false;
      // equals with mode "insensitive" (an email looked up whatever its case), as Postgres does it.
      const ci = (cond as Record<string, unknown>).mode === "insensitive";
      if (op === "equals" && !(ci && typeof v === "string" && typeof x === "string" ? v.toLowerCase() === x.toLowerCase() : same(v, x))) return false;
      if (op === "has" && !(Array.isArray(v) && v.includes(x))) return false;
      // Text search, any case (the mode is always "insensitive" where it is used).
      if (op === "contains" && !(typeof v === "string" && v.toLowerCase().includes(String(x).toLowerCase()))) return false;
      if (op === "startsWith" && !(typeof v === "string" && v.startsWith(String(x)))) return false;
    }
  }
  return true;
}

function project(row: Row, select: Record<string, unknown> | undefined): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [k, on] of Object.entries(select)) {
    if (!on) continue;
    // A nested select over a related row stored inline on the seed (tag: { name }).
    const inner = on && typeof on === "object" && "select" in (on as Row) ? ((on as Row).select as Record<string, unknown>) : null;
    const v = row[k];
    out[k] = inner && v && typeof v === "object" && !Array.isArray(v) ? project(v as Row, inner) : v;
  }
  return out;
}

type OrderBy = Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;

/** Rows sorted by one key or a list of keys, as Prisma's orderBy reads them. */
function ordered(list: Row[], orderBy: OrderBy | undefined): Row[] {
  if (!orderBy) return list;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...list].sort((x, y) => {
    for (const [k, dir] of keys) {
      const c = cmp(x[k], y[k]) ?? 0;
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

function apply(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && "increment" in (v as Row)) {
      row[k] = ((row[k] as number) ?? 0) + ((v as { increment: number }).increment);
    } else if (v !== undefined) {
      row[k] = Array.isArray(v) ? [...v] : v;
    }
  }
}

export interface FakeDb {
  rows: Record<string, Row[]>;
  raw: string[];
  /** How many transactions are running now, for a test to see whether a write ran inside one. */
  inTx: number;
  /** Model names whose writes throw (a missing table). */
  failing: Set<string>;
  prisma: Record<string, unknown>;
  reset(): void;
}

export function createFakeDb(): FakeDb {
  const db: FakeDb = {
    rows: {},
    raw: [],
    inTx: 0,
    failing: new Set(),
    prisma: {},
    reset() {
      for (const k of Object.keys(db.rows)) delete db.rows[k];
      db.raw.length = 0;
      db.inTx = 0;
      db.failing.clear();
    },
  };
  const table = (name: string) => (db.rows[name] ??= []);
  const guard = (name: string) => {
    if (db.failing.has(name)) throw new Error(`relation "${name}" does not exist`);
  };
  const model = (name: string) => ({
    findUnique: async (a: { where: Where; select?: Record<string, unknown> }) => {
      guard(name);
      const r = table(name).find((row) => matches(row, a.where));
      return r ? project(r, a.select) : null;
    },
    findFirst: async (a: { where?: Where; select?: Record<string, unknown>; orderBy?: OrderBy } = {}) => {
      guard(name);
      const r = ordered(table(name).filter((row) => matches(row, a.where)), a.orderBy)[0];
      return r ? project(r, a.select) : null;
    },
    findMany: async (a: { where?: Where; select?: Record<string, unknown>; take?: number; orderBy?: OrderBy; distinct?: string[] } = {}) => {
      guard(name);
      let list = ordered(table(name).filter((row) => matches(row, a.where)), a.orderBy);
      if (a.distinct) {
        const seen = new Set<string>();
        list = list.filter((r) => {
          const key = a.distinct!.map((d) => String(r[d])).join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (typeof a.take === "number") list = list.slice(0, a.take);
      return list.map((r) => project(r, a.select));
    },
    count: async (a: { where?: Where } = {}) => {
      guard(name);
      return table(name).filter((row) => matches(row, a.where)).length;
    },
    create: async (a: { data: Row; select?: Record<string, unknown> }) => {
      guard(name);
      const row: Row = { ...(MODEL_DEFAULTS[name]?.() ?? {}) };
      apply(row, a.data);
      if (row.id === undefined && !KEY_OF[name]) row.id = `${name}-${table(name).length + 1}`;
      table(name).push(row);
      return project(row, a.select);
    },
    update: async (a: { where: Where; data: Row; select?: Record<string, unknown> }) => {
      guard(name);
      const row = table(name).find((r) => matches(r, a.where));
      if (!row) throw new Error(`${name}.update: no row`);
      apply(row, a.data);
      if ("updatedAt" in row && !("updatedAt" in a.data)) row.updatedAt = new Date();
      return project(row, a.select);
    },
    updateMany: async (a: { where?: Where; data: Row }) => {
      guard(name);
      const hit = table(name).filter((r) => matches(r, a.where));
      for (const r of hit) apply(r, a.data);
      return { count: hit.length };
    },
    deleteMany: async (a: { where?: Where } = {}) => {
      guard(name);
      const keep = table(name).filter((r) => !matches(r, a.where));
      const count = table(name).length - keep.length;
      db.rows[name] = keep;
      return { count };
    },
    upsert: async (a: { where: Where; create: Row; update: Row }) => {
      guard(name);
      const row = table(name).find((r) => matches(r, a.where));
      if (row) {
        apply(row, a.update);
        return { ...row };
      }
      const fresh: Row = { ...(MODEL_DEFAULTS[name]?.() ?? {}) };
      apply(fresh, a.create);
      table(name).push(fresh);
      return { ...fresh };
    },
  });
  const models = new Map<string, ReturnType<typeof model>>();
  db.prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "$transaction") {
          // Rolled back on a throw, as Postgres does.
          return async (fn: (tx: unknown) => Promise<unknown>) => {
            const before = structuredClone(db.rows);
            db.inTx += 1;
            try {
              return await fn(db.prisma);
            } catch (err) {
              for (const k of Object.keys(db.rows)) delete db.rows[k];
              Object.assign(db.rows, before);
              throw err;
            } finally {
              db.inTx -= 1;
            }
          };
        }
        if (key === "$executeRaw" || key === "$queryRaw") {
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            db.raw.push(strings.join("?").replace(/\s+/g, " ").trim() + (values.length ? ` [${values.map(String).join(", ")}]` : ""));
            return key === "$queryRaw" ? [] : 1;
          };
        }
        if (typeof key !== "string" || key.startsWith("$") || key === "then") return undefined;
        if (!models.has(key)) models.set(key, model(key));
        return models.get(key);
      },
    },
  );
  return db;
}

/** A row in a model, inserted with that model's defaults. */
export function seed(db: FakeDb, name: string, row: Row): Row {
  const full: Row = { ...(MODEL_DEFAULTS[name]?.() ?? {}), ...row };
  (db.rows[name] ??= []).push(full);
  return full;
}

// ── The world the OAuth suites share ──

/** The one store every OAuth suite mocks @/lib/prisma with. */
export const testDb = createFakeDb();

export const ORIGIN = "https://app.workwrk.com";
export const LOOPBACK_REGISTERED = "http://127.0.0.1/callback";
export const LOOPBACK = "http://127.0.0.1:18799/callback";
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const PUBLIC_ID = `wkc_public${"a".repeat(26)}`;
export const CONF_ID = `wkc_secret${"b".repeat(26)}`;
export const POST_ID = `wkc_postcl${"c".repeat(26)}`;
export const NO_REFRESH_ID = `wkc_norefr${"d".repeat(26)}`;
export const CONF_SECRET = `wkmcp_cs_${"S".repeat(43)}`;
export const POST_SECRET = `wkmcp_cs_${"P".repeat(43)}`;
export const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
export const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

/** The environment the server is offered in. */
export function useMcpEnv(): void {
  process.env.MCP_OFFERED = "1";
  process.env.NEXTAUTH_URL = ORIGIN;
  process.env.APP_HOST = "app.workwrk.com";
  process.env.MARKETING_HOST = "workwrk.com";
  delete process.env.MCP_PROOF_LIMITS;
  delete process.env.MCP_DOCS_URL;
}

/**
 * Two workspaces (Acme ACTIVE, Beta TRIAL) with AI apps on, Max a member of
 * both (anchored in Acme, tokenVersion 3), and four clients: a public one
 * named "Claude Code (workwrk)" on loopback, a Basic one named "Claude", a
 * client_secret_post one, and a public one without refresh_token.
 */
export function seedWorld(db: FakeDb, hash: (s: string) => string): void {
  db.reset();
  seed(db, "organization", { id: "org-a", name: "Acme", status: "ACTIVE", settings: {} });
  seed(db, "organization", { id: "org-b", name: "Beta", status: "TRIAL", settings: {} });
  seed(db, "user", { id: "u-max", email: "max@acme.test", firstName: "Max", lastName: "Member", organizationId: "org-a", ...legacyLevelRow("EMPLOYEE"), tokenVersion: 3 });
  seed(db, "organizationMembership", { id: "m-1", userId: "u-max", organizationId: "org-b", role: "EMPLOYEE" });
  seed(db, "mcpPolicy", { organizationId: "org-a", enabled: true, allowedApps: [] });
  seed(db, "mcpPolicy", { organizationId: "org-b", enabled: true, allowedApps: [] });
  seed(db, "oAuthClient", { id: PUBLIC_ID, name: "Claude Code (workwrk)", redirectUris: [LOOPBACK_REGISTERED], grantTypes: ["authorization_code", "refresh_token"], authMethod: "none", secretHash: null });
  seed(db, "oAuthClient", { id: CONF_ID, name: "Claude", redirectUris: [CLAUDE_REDIRECT], grantTypes: ["authorization_code", "refresh_token"], authMethod: "client_secret_basic", secretHash: hash(CONF_SECRET) });
  seed(db, "oAuthClient", { id: POST_ID, name: "Poster", redirectUris: [CLAUDE_REDIRECT], grantTypes: ["authorization_code", "refresh_token"], authMethod: "client_secret_post", secretHash: hash(POST_SECRET) });
  seed(db, "oAuthClient", { id: NO_REFRESH_ID, name: "Once", redirectUris: [LOOPBACK_REGISTERED], grantTypes: ["authorization_code"], authMethod: "none", secretHash: null });
}

/** A form body. */
export function formOf(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

/** The Basic header for a client id and secret (RFC 6749 2.3.1). */
export function basic(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;
}

/** The person resolveActingPerson answers with in the suites: a Member. */
export function actingAs(organizationId: string, userId: string): Record<string, unknown> {
  return { userId, organizationId, ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", name: "Max Member", email: "max@acme.test" };
}

/** A signed-in session as getServerSession answers it, with the tokenVersion it carries. */
export function sessionOf(id: string, organizationId: string, email: string, tokenVersion?: number): { user: Record<string, unknown> } {
  const s = legacyTestSession(id, "EMPLOYEE", organizationId);
  return { user: { ...s.user, email, ...(tokenVersion === undefined ? {} : { tokenVersion }) } };
}

/** A user row of a Member. */
export function memberRow(row: Record<string, unknown>): Record<string, unknown> {
  return { ...legacyLevelRow("EMPLOYEE"), ...row };
}

/**
 * A live connection for Max in Acme through the public loopback client: the
 * grant (at his tokenVersion 3, family "fam-1") and one access token for
 * MCP_RESOURCE, as a consent and a code exchange leave them. Returns the
 * token in the clear and the grant row.
 */
export function seedConnection(
  db: FakeDb,
  hash: (s: string) => string,
  o: { scopes?: string[]; token?: string; grantId?: string; userId?: string; organizationId?: string; now?: Date } = {},
): { token: string; grant: Row } {
  const now = o.now ?? new Date();
  const token = o.token ?? `wkmcp_at_${"T".repeat(43)}`;
  const grant = seed(db, "oAuthGrant", {
    id: o.grantId ?? "gr-1",
    clientId: PUBLIC_ID,
    organizationId: o.organizationId ?? "org-a",
    userId: o.userId ?? "u-max",
    scopes: o.scopes ?? ["mcp:read", "mcp:write"],
    appName: "an app on this computer",
    redirectHost: "localhost",
    familyId: "fam-1",
    tokenVersion: 3,
    authorizedAt: new Date(now.getTime() - 60_000),
    endsBy: new Date(now.getTime() + 30 * 86_400_000),
  });
  seed(db, "oAuthToken", {
    id: hash(token),
    grantId: grant.id,
    kind: "access",
    familyId: "fam-1",
    scopes: o.scopes ?? ["mcp:read", "mcp:write"],
    resource: `${ORIGIN}/api/mcp`,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  return { token, grant };
}
