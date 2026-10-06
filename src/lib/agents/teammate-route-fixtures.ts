// The teammate routes' test double (src/app/api/agents/**/route.test.ts): an
// in-memory workspace behind the prisma calls the routes make (agents,
// chats, messages, settings, requests, routines), the people of the
// authorization matrix, a requireApp that answers a Guest the way the real
// gate does (404), and the Apps settings gate the workspace agent routes use
// (requireManageApps). Every write that changed a row is recorded in
// `routeDb.writes`, so a test can say that a refusal wrote nothing. The tests
// mock the real modules with these: vi.mock("@/lib/prisma", async () =>
// ({ prisma: (await import("@/lib/agents/teammate-route-fixtures")).routeDb })).
//
// Test-only: nothing in the app imports it.

import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";

export type Row = Record<string, unknown>;

export const ORG = "org1";

export interface FakeViewer {
  userId: string;
  organizationId: string;
  orgRole: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
  isAgent: boolean;
  adminScopes: never[];
}

function person(userId: string, orgRole: FakeViewer["orgRole"], isAgent = false): FakeViewer {
  return { userId, organizationId: ORG, orgRole, isAgent, adminScopes: [] };
}

/** The matrix: a private teammate's owner, another member, an Admin, the Owner, a Guest, an agent account. */
export const PEOPLE = {
  max: person("u-max", "MEMBER"),
  lea: person("u-lea", "MEMBER"),
  admin: person("u-admin", "ADMIN"),
  owner: person("u-owner", "OWNER"),
  guest: person("u-guest", "GUEST"),
  bot: person("u-bot", "ADMIN", true),
};

// ── The where clauses the routes write ──────────────────────────────

const OPS = new Set(["equals", "in", "notIn", "not", "lt", "lte", "gt", "gte", "contains", "mode"]);

function isNullSentinel(v: unknown): boolean {
  return v === Prisma.DbNull || v === Prisma.JsonNull || v === Prisma.AnyNull;
}

function same(a: unknown, b: unknown): boolean {
  if (b === null || isNullSentinel(b)) return a === null || a === undefined;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function order(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

function fieldMatches(v: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date || isNullSentinel(cond)) return same(v, cond);
  const c = cond as Row;
  const keys = Object.keys(c);
  if (keys.length > 0 && keys.every((k) => OPS.has(k))) {
    return keys.every((k) => {
      const x = c[k];
      if (k === "equals") return same(v, x);
      if (k === "in") return (x as unknown[]).some((y) => same(v, y));
      if (k === "notIn") return !(x as unknown[]).some((y) => same(v, y));
      if (k === "not") return !fieldMatches(v, x);
      if (k === "lt") return v != null && order(v, x) < 0;
      if (k === "lte") return v != null && order(v, x) <= 0;
      if (k === "gt") return v != null && order(v, x) > 0;
      if (k === "gte") return v != null && order(v, x) >= 0;
      if (k === "contains") {
        if (typeof v !== "string") return false;
        return c.mode === "insensitive" ? v.toLowerCase().includes(String(x).toLowerCase()) : v.includes(String(x));
      }
      return true;
    });
  }
  // A relation filter: the related row is embedded in the row.
  return v !== null && typeof v === "object" && matches(v as Row, c);
}

/** Whether a row meets a prisma where: fields, operators, OR, AND, NOT and embedded relations. */
export function matches(row: Row, where?: Row | null): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c));
    if (key === "AND") return (Array.isArray(cond) ? cond : [cond]).every((c) => matches(row, c as Row));
    if (key === "NOT") return !(Array.isArray(cond) ? cond : [cond]).some((c) => matches(row, c as Row));
    return fieldMatches(row[key], cond);
  });
}

// ── The workspace ───────────────────────────────────────────────────

export const db = {
  viewer: PEOPLE.max as FakeViewer,
  plan: "STARTER",
  agents: [] as Row[],
  sessions: [] as Row[],
  messages: [] as Row[],
  settings: [] as Row[],
  actions: [] as Row[],
  routines: [] as Row[],
  runs: [] as Row[],
  /** AgentMemory rows, each with its agent embedded (the routes filter on agent.organizationId). */
  memories: [] as Row[],
};

let seq = 0;

export function resetRouteDb(): void {
  db.viewer = PEOPLE.max;
  db.plan = "STARTER";
  db.agents = [];
  db.sessions = [];
  db.messages = [];
  db.settings = [];
  db.actions = [];
  db.routines = [];
  db.runs = [];
  db.memories = [];
  routeDb.writes.length = 0;
  seq = 0;
}

/** An Agent row; a workspace teammate made as one (toolNames set) unless told otherwise. */
export function seedAgent(o: Row & { slug: string }): Row {
  const row: Row = {
    id: `a-${o.slug}`,
    organizationId: ORG,
    name: o.slug,
    description: "Keeps work moving.",
    systemPrompt: "Be brief.",
    modelOverride: null,
    productSlug: null,
    toolNames: ["search_tasks", "create_task"],
    approvalRules: {},
    avatar: null,
    hue: "sky",
    visibility: "WORKSPACE",
    ownerId: null,
    status: "ENABLED",
    template: null,
    monthlyQuestionCap: null,
    autonomousEnabled: false,
    scheduleCron: null,
    nextRunAt: null,
    isPrebuilt: false,
    createdById: null,
    createdAt: new Date("2026-10-01T09:00:00Z"),
    ...o,
  };
  db.agents.push(row);
  return row;
}

/** A row as a database hands it back: a copy, so a later write never changes what was read. */
const copy = <T extends Row | undefined>(r: T): T => (r ? ({ ...r } as T) : r);

function uniqueClash(): Error {
  return Object.assign(new Error("Unique constraint failed on the fields: (`organizationId`,`slug`)"), { code: "P2002" });
}

function groupMax(rows: Row[], by: string, field: string) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(String(r[by]), [...(groups.get(String(r[by])) ?? []), r]);
  return [...groups].map(([key, rs]) => ({ [by]: key, _max: { [field]: new Date(Math.max(...rs.map((r) => (r[field] as Date).getTime()))) } }));
}

type Args = { where?: Row; data?: Row; take?: number; create?: Row; update?: Row; by?: string[]; orderBy?: unknown };

/** Rows in a prisma orderBy's order ({ field: "asc" | "desc" }, or a list of them). */
function sorted(rows: Row[], orderBy: unknown): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, "asc" | "desc">>;
  return [...rows].sort((x, y) => {
    for (const k of keys) {
      const [field, dir] = Object.entries(k)[0];
      const c = order(x[field], y[field]);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

/** findMany over a table: where, orderBy, take, each row a copy. */
function pickMany(rows: Row[], a: Args): Row[] {
  return sorted(
    rows.filter((r) => matches(r, a.where)),
    a.orderBy,
  )
    .slice(0, a.take ?? Infinity)
    .map(copy);
}

/** The prisma calls the teammate routes make, over `db`. */
export const routeDb = {
  writes: [] as string[],
  agent: {
    findFirst: async (a: Args) => copy(db.agents.find((r) => matches(r, a.where))),
    findMany: async (a: Args) => pickMany(db.agents, a),
    count: async (a: Args) => db.agents.filter((r) => matches(r, a.where)).length,
    create: async (a: Args) => {
      routeDb.writes.push("agent.create");
      const data = a.data as Row & { slug: string };
      if (db.agents.some((r) => r.organizationId === data.organizationId && r.slug === data.slug)) throw uniqueClash();
      return copy(seedAgent({ ...data, id: `a-${data.slug}`, createdAt: new Date() }));
    },
    update: async (a: Args) => {
      routeDb.writes.push("agent.update");
      const row = db.agents.find((r) => r.id === a.where?.id);
      if (!row) throw new Error("not found");
      Object.assign(row, a.data);
      return copy(row);
    },
    // POST /api/agents/[slug]/install adds a catalog agent by its unique
    // (organizationId, slug), whatever row holds that slug.
    upsert: async (a: Args) => {
      routeDb.writes.push("agent.upsert");
      const key = (a.where as { organizationId_slug: { organizationId: string; slug: string } }).organizationId_slug;
      const row = db.agents.find((r) => r.organizationId === key.organizationId && r.slug === key.slug);
      if (row) return copy(Object.assign(row, a.update));
      return copy(seedAgent({ ...(a.create as Row & { slug: string }), toolNames: null }));
    },
  },
  organization: {
    findUnique: async () => ({ plan: db.plan, settings: {} }),
  },
  chatSession: {
    findFirst: async (a: Args) => copy(db.sessions.find((r) => matches(r, a.where))),
    findMany: async (a: Args) => db.sessions.filter((r) => matches(r, a.where)).map(copy),
  },
  chatMessage: {
    groupBy: async (a: Args) => groupMax(db.messages.filter((r) => matches(r, a.where)), (a.by ?? ["sessionId"])[0], "createdAt"),
    findMany: async (a: Args) => pickMany(db.messages, a),
    findFirst: async (a: Args) => copy(db.messages.find((r) => matches(r, a.where))),
    create: async (a: Args) => {
      routeDb.writes.push("chatMessage.create");
      const row = { id: `m${++seq}`, kind: null, meta: null, toolCalls: null, createdAt: new Date(), ...a.data };
      db.messages.push(row);
      return copy(row);
    },
  },
  agentPersonSetting: {
    findMany: async (a: Args) => db.settings.filter((r) => matches(r, a.where)).map(copy),
    findUnique: async (a: Args) => {
      const key = (a.where as { agentId_userId: { agentId: string; userId: string } }).agentId_userId;
      return copy(db.settings.find((r) => r.agentId === key.agentId && r.userId === key.userId));
    },
    create: async (a: Args) => {
      routeDb.writes.push("agentPersonSetting.create");
      const row = { id: `ps${++seq}`, approvalRules: {}, lastReadAt: null, ...a.data };
      db.settings.push(row);
      return copy(row);
    },
    upsert: async (a: Args) => {
      routeDb.writes.push("agentPersonSetting.upsert");
      const key = (a.where as { agentId_userId: { agentId: string; userId: string } }).agentId_userId;
      const row = db.settings.find((r) => r.agentId === key.agentId && r.userId === key.userId);
      if (row) return copy(Object.assign(row, a.update));
      const made = { id: `ps${++seq}`, approvalRules: {}, lastReadAt: null, ...a.create };
      db.settings.push(made);
      return copy(made);
    },
  },
  agentAction: {
    groupBy: async (a: Args) => {
      const hit = db.actions.filter((r) => matches(r, a.where));
      const counts = new Map<string, number>();
      for (const r of hit) counts.set(String(r.agentId), (counts.get(String(r.agentId)) ?? 0) + 1);
      return [...counts].map(([agentId, n]) => ({ agentId, _count: { _all: n } }));
    },
    findMany: async (a: Args) => pickMany(db.actions, a),
    findFirst: async (a: Args) => copy(db.actions.find((r) => matches(r, a.where))),
    count: async (a: Args) => db.actions.filter((r) => matches(r, a.where)).length,
  },
  agentRoutine: {
    findMany: async (a: Args) => pickMany(db.routines, a),
    findFirst: async (a: Args) => copy(db.routines.find((r) => matches(r, a.where))),
    deleteMany: async (a: Args) => {
      const kept = db.routines.filter((r) => !matches(r, a.where));
      const count = db.routines.length - kept.length;
      if (count > 0) routeDb.writes.push("agentRoutine.deleteMany");
      db.routines = kept;
      return { count };
    },
  },
  agentMemory: {
    findFirst: async (a: Args) => copy(db.memories.find((r) => matches(r, a.where))),
    deleteMany: async (a: Args) => {
      const kept = db.memories.filter((r) => !matches(r, a.where));
      const count = db.memories.length - kept.length;
      if (count > 0) routeDb.writes.push("agentMemory.deleteMany");
      db.memories = kept;
      return { count };
    },
  },
  agentRun: {
    findMany: async (a: Args) => pickMany(db.runs, a),
    deleteMany: async (a: Args) => {
      const kept = db.runs.filter((r) => !matches(r, a.where));
      const count = db.runs.length - kept.length;
      if (count > 0) routeDb.writes.push("agentRun.deleteMany");
      db.runs = kept;
      return { count };
    },
  },
  conversationMember: {
    findMany: async () => [],
  },
};

/**
 * requireApp("ai"), requireManageApps and isOwnerOrAdmin as
 * src/lib/app-gate.ts answers them, for `db.viewer`. The Apps settings gate
 * is the Owner and Admins'; anyone else gets the settings page's 403
 * (src/lib/access/gate.ts: a settings page never 404s).
 */
export const appGateFake = {
  requireApp: async () =>
    db.viewer.orgRole === "GUEST" ? { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } : { viewer: db.viewer },
  requireManageApps: async () =>
    db.viewer.orgRole === "OWNER" || db.viewer.orgRole === "ADMIN"
      ? { viewer: db.viewer }
      : { error: NextResponse.json({ error: "no_access", page: "apps" }, { status: 403 }) },
  isOwnerOrAdmin: (v: FakeViewer) => v.orgRole === "OWNER" || v.orgRole === "ADMIN",
};

/** A JSON request to a route. */
export function jsonRequest(method: string, body?: unknown, url = "http://x/api/agents/teammates"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A dynamic segment's params, as Next passes them. */
export function paramsOf<T extends Record<string, string>>(p: T): { params: Promise<T> } {
  return { params: Promise.resolve(p) };
}
