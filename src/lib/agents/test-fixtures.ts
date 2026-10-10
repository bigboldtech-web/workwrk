// The approval queue's test double, shared by actions.test.ts and
// executor.test.ts: an in-memory AgentAction table, the chat lines and the
// Inbox writes, and stand-ins for the modules around the queue (the person,
// the cards, the tools, the audit log, the workspace's modules). Each one
// records what it was asked. The tests mock the real modules with these
// (vi.mock(..., async () => (await import("./test-fixtures")).x)).
//
// Test-only: nothing in the app imports it.

import { Prisma } from "@/generated/prisma";
import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { CONNECTOR_COPY } from "./teammate-copy";
import { BASE_RISK, alwaysKeyFor, type ApprovalRules, type ToolRisk } from "./tool-policy";
import { PPMS_TOOL_NAMES, TEAMMATE_TOOL_NAMES, isToolName } from "./tool-names";

export interface ActionRowFx {
  id: string;
  organizationId: string;
  /** Null: Ask AI's own request. */
  agentId: string | null;
  actingForId: string;
  sessionId: string | null;
  runId: string | null;
  routineId: string | null;
  toolName: string;
  risk: string;
  input: unknown;
  editedInput: unknown;
  preview: unknown;
  targetKey: string | null;
  groupKey: string | null;
  status: string;
  decidedVia: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  executedAt: Date | null;
  result: unknown;
  error: string | null;
  reportedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const VIEWER = { userId: "me", organizationId: "org", orgRole: "MEMBER", isAgent: false, adminScopes: [] };

/** The person as acting.ts resolves them; their level comes from the legacy fixture. */
export const PERSON = {
  userId: "me",
  organizationId: "org",
  ...legacyLevelRow("EMPLOYEE"),
  orgRole: "MEMBER",
  name: "Priya Shah",
  firstName: "Priya",
  email: "priya@x.com",
  timezone: "UTC",
  viewer: VIEWER,
};

export const AGENT_SLUG = "t-chief-of-staff-abc123";

function freshAgent() {
  return {
    id: "a1",
    slug: AGENT_SLUG,
    name: "Chief of Staff",
    status: "ENABLED",
    organizationId: "org",
    visibility: "PRIVATE",
    ownerId: "me",
    toolNames: ["search_tasks", "create_task", "comment_on_task", "post_in_talk", "send_kudos", "invite_person_with_role", "update_doc", "remember", "forget", "create_routine"] as unknown,
    productSlug: null as string | null,
    approvalRules: {} as unknown,
  };
}

/** A refusal may carry `held` (an approval that can wait, connector-rules.ts HeldCode) and `readGoogle` (the preparation read Gmail). */
type Card =
  | { ok: false; error: string; held?: "connection_needed" | "retry_later"; readGoogle?: true }
  | { risk?: ToolRisk; title?: string; targetKey?: string | null; input?: Record<string, unknown>; readGoogle?: true };

export const fx = {
  actions: [] as ActionRowFx[],
  agent: freshAgent(),
  messages: [] as Array<{ sessionId: string; role: string; kind: string | null; content: string; meta: Record<string, unknown> }>,
  notifications: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  settings: new Map<string, unknown>(),
  handlerCalls: [] as Array<{ tool: string; ctx: { orgId: string; userId: string; teammate?: Record<string, unknown> }; input: Record<string, unknown> }>,
  /** What a tool's handler answers (an Error is thrown); else { ok: true }. */
  answers: {} as Record<string, unknown>,
  person: { ok: true, person: PERSON } as { ok: true; person: typeof PERSON } | { ok: false; reason: string },
  /** What resolveActingPerson answers next, one read at a time, before falling back to `person`; and how many reads there were. */
  personQueue: [] as Array<{ ok: true; person: typeof PERSON } | { ok: false; reason: string }>,
  personReads: 0,
  /** What prepareCall answers for a tool: a refusal, or the class, title, target and input of its card. */
  cards: {} as Record<string, Card | ((input: Record<string, unknown>) => Card)>,
  prepareCalls: [] as Array<{ tool: string; input: Record<string, unknown>; ctx: { agentRules?: ApprovalRules; teammate: Record<string, unknown> } }>,
  modules: { tablesOn: true, talkOn: true },
  activity: [] as Array<Record<string, unknown>>,
  sql: [] as string[],
  /** What started each run, by run id (AgentRun.input.trigger). */
  runTriggers: {} as Record<string, string>,
  /** The Ask AI chat an Ask AI request's decision reads (null: gone, or not the person's). */
  chat: { productContext: null as string | null, agent: null as Record<string, unknown> | null } as { id?: string; kind?: string | null; productContext: string | null; agent: Record<string, unknown> | null } | null,
  /** The workspace's Google products (connections.ts workspaceConnectorProducts), for the tests that mock it with connectorFake. */
  connectors: { gmail: false, calendar: false },
  /** What connectorAccess answers (connectorFake), and what it was asked. */
  connectorAccess: { ok: true } as { ok: true } | { ok: false; reason: string; changed?: string[] },
  connectorAccessCalls: [] as Array<{ product: string; forApproval?: boolean; agent: { id: string; visibility: string; ownerId: string | null } }>,
};

export function resetFixtures(): void {
  fx.actions = [];
  fx.agent = freshAgent();
  fx.messages = [];
  fx.notifications = [];
  fx.settings = new Map();
  fx.handlerCalls = [];
  fx.answers = {};
  fx.person = { ok: true, person: PERSON };
  fx.personQueue = [];
  fx.personReads = 0;
  fx.cards = {};
  fx.prepareCalls = [];
  fx.modules = { tablesOn: true, talkOn: true };
  fx.activity = [];
  fx.sql = [];
  fx.runTriggers = {};
  fx.chat = { productContext: null, agent: null };
  fx.connectors = { gmail: false, calendar: false };
  fx.connectorAccess = { ok: true };
  fx.connectorAccessCalls = [];
}

/** One request in the table, PENDING for the person unless told otherwise. */
export function seedAction(o: Partial<ActionRowFx> & { toolName: string }): ActionRowFx {
  const now = new Date();
  const row: ActionRowFx = {
    id: `act${fx.actions.length + 1}`,
    organizationId: "org",
    agentId: "a1",
    actingForId: "me",
    sessionId: "s1",
    runId: "run1",
    routineId: null,
    risk: "OUTWARD",
    input: {},
    editedInput: null,
    preview: { title: "Post in #general" },
    targetKey: null,
    groupKey: `run1:${o.toolName}`,
    status: "PENDING",
    decidedVia: null,
    decidedById: null,
    decidedAt: null,
    executedAt: null,
    result: null,
    error: null,
    reportedAt: null,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...o,
  };
  fx.actions.push(row);
  return row;
}

// ── prisma ──────────────────────────────────────────────────────────

/** A where clause as the queue writes them: equality, in, not, lt, lte, gt, OR, and a JSON path's equals (a send's dedupeKey). */
function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Array<Record<string, unknown>>).some((c) => matches(row, c));
    const v = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown; lt?: Date; lte?: Date; gt?: Date; path?: string[]; equals?: unknown };
      if (Array.isArray(c.path)) {
        const at = c.path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), v);
        return at === c.equals;
      }
      if (c.in) return c.in.includes(v);
      // `{ not: null }`: a teammate's request, never Ask AI's own (agentId null).
      if ("not" in c) return (v ?? null) !== c.not;
      if (!(v instanceof Date)) return false;
      if (c.lt) return v.getTime() < c.lt.getTime();
      if (c.lte) return v.getTime() <= c.lte.getTime();
      if (c.gt) return v.getTime() > c.gt.getTime();
      return false;
    }
    return v === cond;
  });
}

const rows = (where?: Record<string, unknown>) => fx.actions.filter((r) => matches(r as unknown as Record<string, unknown>, where));

/** A read hands back a copy, as a database does: a later write never changes what was read. Ask AI's own have no teammate. */
const withAgent = (r: ActionRowFx) => ({ ...r, agent: r.agentId ? { ...fx.agent } : null });

export const prismaFake = {
  agentRun: {
    findUnique: async (a: { where: { id: string } }) => (a.where.id in fx.runTriggers ? { input: { trigger: fx.runTriggers[a.where.id] } } : null),
  },
  agentAction: {
    findFirst: async (a: { where: Record<string, unknown> }) => {
      const row = rows(a.where)[0];
      return row ? withAgent(row) : null;
    },
    findMany: async (a: { where: Record<string, unknown>; orderBy?: { expiresAt?: "asc" }; take?: number }) => {
      const hit = [...rows(a.where)];
      if (a.orderBy?.expiresAt) hit.sort((x, y) => x.expiresAt.getTime() - y.expiresAt.getTime());
      return hit.slice(0, a.take ?? hit.length).map(withAgent);
    },
    updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows(a.where);
      // A JSON column set back to empty (Prisma.DbNull) reads as null, as the database answers.
      const data = Object.fromEntries(Object.entries(a.data).map(([k, v]) => [k, v === Prisma.DbNull ? null : v]));
      for (const r of hit) Object.assign(r, data, { updatedAt: new Date() });
      return { count: hit.length };
    },
    create: async (a: { data: Partial<ActionRowFx> & { toolName: string } }) => ({ ...seedAction({ ...a.data, id: `act${fx.actions.length + 1}`, createdAt: new Date() }) }),
    count: async (a: { where: Record<string, unknown> }) => rows(a.where).length,
  },
  chatSession: {
    findFirst: async () => (fx.chat ? { ...fx.chat } : null),
    // actions.ts reads the kind of each card's chat (a group's cards open in the group).
    findMany: async (a: { where: { id: { in: string[] } } }) =>
      fx.chat?.id && a.where.id.in.includes(fx.chat.id) ? [{ id: fx.chat.id, kind: fx.chat.kind ?? null }] : [],
  },
  chatMessage: {
    create: async (a: { data: { sessionId: string; role: string; kind: string | null; content: string; meta: Record<string, unknown> } }) => {
      fx.messages.push(a.data);
      return { id: `m${fx.messages.length}`, ...a.data, createdAt: new Date() };
    },
  },
  notification: {
    updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      fx.notifications.push(a);
      return { count: 1 };
    },
  },
  agentPersonSetting: {
    findUnique: async (a: { where: { agentId_userId: { agentId: string; userId: string } } }) => {
      const key = `${a.where.agentId_userId.agentId}:${a.where.agentId_userId.userId}`;
      return fx.settings.has(key) ? { approvalRules: fx.settings.get(key) } : null;
    },
    upsert: async (a: { where: { agentId_userId: { agentId: string; userId: string } }; create: { approvalRules: unknown }; update: { approvalRules: unknown } }) => {
      const key = `${a.where.agentId_userId.agentId}:${a.where.agentId_userId.userId}`;
      fx.settings.set(key, fx.settings.has(key) ? a.update.approvalRules : a.create.approvalRules);
      return {};
    },
  },
  // claimUnreportedOutcomes' one statement, as Postgres runs it: it stamps
  // what it returns, so a second run returns nothing. outcomesWaiting's read
  // takes the same rows and stamps none.
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    // Prisma.sql fragments (one teammate's filter, the continuable filter) arrive as values.
    const frags = values.filter((v): v is { strings: string[]; values: unknown[] } => Boolean(v) && typeof v === "object" && "strings" in (v as object) && "values" in (v as object));
    const sql = strings.join("?") + frags.map((f) => ` [${f.strings.join("?")}]`).join("");
    fx.sql.push(sql);
    const claim = sql.includes('UPDATE "AgentAction"');
    if (!claim && !/^\s*SELECT "id" FROM "AgentAction"/.test(sql)) return [];
    const ofAgent = frags.find((f) => f.strings.join("?").includes('"agentId"'));
    const agentId = ofAgent ? ofAgent.values[0] : null;
    // The continuable filter: a card a Talk, automation or delegated run made is left (review round 8).
    const continuable = frags.some((f) => f.strings.join("?").includes('"AgentRun"'));
    const outside = (r: ActionRowFx) => Boolean(r.runId) && ["TALK", "AUTOMATION", "DELEGATED"].includes(fx.runTriggers[r.runId as string] ?? "");
    const decided = ["EXECUTED", "FAILED", "DENIED", "EXPIRED", "CANCELLED"];
    const limit = values.find((v): v is number => typeof v === "number") ?? Infinity;
    const hit = fx.actions
      .filter((r) => r.sessionId === values[0] && r.reportedAt === null && decided.includes(r.status) && (!agentId || r.agentId === agentId) && !(continuable && outside(r)))
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .slice(0, limit);
    if (claim) for (const r of hit) r.reportedAt = new Date();
    return hit.map((r) => ({ ...r }));
  },
};

// ── The modules around the queue ────────────────────────────────────

/** connections.ts's switch and access, answering fx.connectors and fx.connectorAccess (the tests that mock "@/lib/connectors/connections"). */
export const connectorFake = {
  workspaceConnectorProducts: async () => ({ ...fx.connectors }),
  connectorAccess: async (a: { product: string; forApproval?: boolean; agent: { id: string; visibility: string; ownerId: string | null } }) => {
    fx.connectorAccessCalls.push({ product: a.product, forApproval: a.forApproval, agent: { id: a.agent.id, visibility: a.agent.visibility, ownerId: a.agent.ownerId } });
    return fx.connectorAccess;
  },
};

export const actingFake = {
  resolveActingPerson: async () => {
    fx.personReads += 1;
    return fx.personQueue.shift() ?? fx.person;
  },
  toolCtxFor: (person: typeof PERSON, teammate: Record<string, unknown>) => ({
    orgId: person.organizationId,
    userId: person.userId,
    teammate: { ...teammate, timezone: teammate.timezone || person.timezone },
  }),
  actorLabelFor: (agent: { name: string }, person: { name: string }) => `${agent.name} for ${person.name}`,
};

/**
 * prepareCall's stand-in: the tool's own class unless a card says otherwise,
 * a Talk conversation's target key, the policy's own "don't ask again" key
 * (none where the teammate's managers set the tool to ask, and none, with the
 * line that says why, in a turn that read Google: previews.ts prepareCall's
 * tainted rule), and the input as given unless the card names the input it
 * resolves to.
 */
export async function fakePrepareCall(tool: string, input: unknown, ctx: { agentRules?: ApprovalRules; teammate: Record<string, unknown>; tainted?: boolean }) {
  const raw = { ...((input ?? {}) as Record<string, unknown>) };
  fx.prepareCalls.push({ tool, input: raw, ctx });
  const set = fx.cards[tool];
  const card: Card = (typeof set === "function" ? set(raw) : set) ?? {};
  if ("ok" in card && card.ok === false) return card;
  if (!isToolName(tool)) return { ok: false as const, error: "That didn't work. Check it in the app and try again." };
  const o = card as Exclude<Card, { ok: false }>;
  const risk = o.risk ?? BASE_RISK[tool];
  const resolved = o.input ?? raw;
  const targetKey =
    o.targetKey !== undefined ? o.targetKey : tool === "post_in_talk" && typeof resolved.conversationId === "string" ? `conv:${resolved.conversationId}` : null;
  const tightened = ctx.agentRules?.[tool] === "ask";
  const alwaysKey = tightened || ctx.tainted ? null : alwaysKeyFor(tool, risk, targetKey);
  return {
    ok: true as const,
    tool,
    input: resolved,
    risk,
    targetKey,
    ...(o.readGoogle ? { readGoogle: true as const } : {}),
    preview: {
      title: o.title ?? `Run ${tool}`,
      ...(alwaysKey ? { alwaysKey, alwaysLabel: "Approve and don't ask again" } : {}),
      ...(ctx.tainted ? { lines: [CONNECTOR_COPY.askedAfterReading] } : {}),
    },
  };
}

const FAKE_TOOL_PROPS: Record<string, unknown> = {
  ...Object.fromEntries(
    [
      "query", "text", "conversationId", "title", "email", "channel", "assigneeEmail", "taskId", "role", "heading", "docId", "key", "value", "name", "instructions", "message", "teammate", "request", "subject", "body", "threadId", "messageId",
      // The calendar's (Phase 3 step 4).
      "from", "start", "end", "eventId", "response", "location", "description",
    ].map((k) => [k, { type: "string" }]),
  ),
  // The Google tools' lists, count and flags (connector-tools.ts).
  to: { type: "array", items: { type: "string" } },
  cc: { type: "array", items: { type: "string" } },
  limit: { type: "integer" },
  unreadOnly: { type: "boolean" },
  replyAll: { type: "boolean" },
  attendees: { type: "array", items: { type: "string" } },
  addAttendees: { type: "array", items: { type: "string" } },
  removeAttendees: { type: "array", items: { type: "string" } },
  with: { type: "array", items: { type: "string" } },
  durationMinutes: { type: "integer" },
};

/** Every tool, each recording its call and answering fx.answers[tool]. */
export function fakeTools() {
  const tools: Record<string, { name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown> }; handler: (ctx: never, input: Record<string, unknown>) => Promise<unknown> }> = {};
  for (const name of [...PPMS_TOOL_NAMES, ...TEAMMATE_TOOL_NAMES]) {
    tools[name] = {
      name,
      description: "",
      // The text fields the tests send, as the real tools declare them: the
      // executor drops what a tool's schema does not declare (input-check.ts).
      input_schema: { type: "object", properties: FAKE_TOOL_PROPS },
      handler: async (ctx: never, input: Record<string, unknown>) => {
        fx.handlerCalls.push({ tool: name, ctx, input });
        const answer = fx.answers[name];
        if (answer instanceof Error) throw answer;
        return answer ?? { ok: true };
      },
    };
  }
  return tools;
}

export async function fakeLogActivity(a: Record<string, unknown>): Promise<void> {
  fx.activity.push(a);
}

export async function fakeIsModuleActive(_organizationId: string, slug: string): Promise<boolean> {
  return slug === "workwrk-talk" ? fx.modules.talkOn : fx.modules.tablesOn;
}
