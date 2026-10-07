// The server half of the AI teammate routes (docs/plans/ai-teammates.md 4):
// loadTeammate, which reads one teammate through the rules in
// teammate-access.ts; the list's rows (what waits, what is unread, the last
// line), read for every teammate at once; the plan's limits; a teammate's
// settings and its tool table; and the one shape every refusal answers with,
// { error: "<sentence>", code }.
//
// ANOTHER PERSON'S PRIVATE TEAMMATE IS NOT THERE. loadTeammate never reads
// one (agentUsableWhere is in its query) and checks canUseAgent on what it
// reads, so every route answers it with the 404 a slug that does not exist
// gets: nobody learns that someone else's teammate exists, or what it is
// called.
//
// Server-only: imports prisma.

import { NextResponse } from "next/server";
// `Prisma` is a value here: Prisma.DbNull is the only way to say "the JSON
// column is SQL NULL" in a filter.
import { Prisma } from "@/generated/prisma";
import type { Viewer } from "@/lib/access/types";
import { UNLIMITED_AI } from "@/lib/ai-allowance";
import { isModuleActive } from "@/lib/entitlements";
import { TEAMMATE_LIMITS } from "@/lib/plan-limits-data";
import { prisma } from "@/lib/prisma";
import { actionViews } from "./actions";
import { agentMonthUsage } from "./budget";
import { hueForAgent } from "./hues";
import { agentUsableWhere, canManageAgent, canUseAgent, type TeammateVisibility } from "./teammate-access";
import { GROUP_FALLBACK, TEAMMATE_ROUTE_ERRORS, TEAMMATE_SETTINGS, channelPlace, dmPlace, teammateLimitMessage } from "./teammate-copy";
import { lastLineFor, messageViewFromRow, type ActionView, type TeammateMessageView } from "./teammate-thread";
import { teammateToolNames } from "./teammate-tools";
import { toolSettings, type TeammateDetail, type TeammateLimits, type TeammateRow, type TeammateStatus, type ToolSetting } from "./teammate-views";

// ── Refusals ────────────────────────────────────────────────────────

/** A teammate route's refusal: { error: "<sentence>", code: "<machine>" }. */
export function teammateError(status: number, code: string, error: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ error, code }, { status, ...(headers ? { headers } : {}) });
}

/** A teammate that does not exist, and another person's private one. */
export function teammateNotFound(): NextResponse {
  return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.teammateNotFound);
}

export function invalidRequest(): NextResponse {
  return teammateError(400, "invalid", TEAMMATE_ROUTE_ERRORS.invalid);
}

/** A person who can use a workspace teammate but not change it. */
export function notManager(): NextResponse {
  return teammateError(403, "not_manager", TEAMMATE_SETTINGS.managedByAdmins);
}

// ── One teammate ────────────────────────────────────────────────────

/**
 * The Agent columns the teammate routes read: everything a turn reads
 * (engine.ts TEAMMATE_AGENT_SELECT, so a row passes to teammateAgentFrom),
 * who may use and manage it, and the legacy schedule a pause stops.
 */
export const TEAMMATE_SELECT = {
  id: true,
  organizationId: true,
  slug: true,
  name: true,
  description: true,
  systemPrompt: true,
  modelOverride: true,
  productSlug: true,
  toolNames: true,
  approvalRules: true,
  avatar: true,
  hue: true,
  visibility: true,
  ownerId: true,
  status: true,
  template: true,
  monthlyQuestionCap: true,
  autonomousEnabled: true,
  scheduleCron: true,
} as const;

export type TeammateRecord = Prisma.AgentGetPayload<{ select: typeof TEAMMATE_SELECT }>;

/**
 * The teammate with this slug, when this person may use it (see the file
 * header); null otherwise. A removed (ARCHIVED) one only with
 * `includeRemoved`: its chat, memories and activity stay readable, and its
 * manager can add it back.
 */
export async function loadTeammate(slug: string, viewer: Viewer, opts: { includeRemoved?: boolean } = {}): Promise<TeammateRecord | null> {
  if (typeof slug !== "string" || !slug || slug.length > 200) return null;
  const where: Prisma.AgentWhereInput = { organizationId: viewer.organizationId, slug, ...agentUsableWhere(viewer.userId) };
  if (!opts.includeRemoved) where.status = { not: "ARCHIVED" };
  const row = await prisma.agent.findFirst({ where, select: TEAMMATE_SELECT });
  return row && canUseAgent(row, viewer) ? row : null;
}

/** This person's one live chat with this teammate (engine.ts getOrCreateTeammateSession makes it). */
export function liveChatWhere(agent: { id: string; organizationId: string }, userId: string): Prisma.ChatSessionWhereInput {
  return { organizationId: agent.organizationId, agentId: agent.id, userId, kind: "TEAMMATE", archivedAt: null };
}

/** The messages a thread shows (teammate-thread.ts messageViewFromRow): turns, reports, lines and cards. */
export const SHOWN_MESSAGES: Prisma.ChatMessageWhereInput = {
  OR: [{ kind: null, role: { in: ["USER", "ASSISTANT"] } }, { kind: { in: ["REPORT", "EVENT", "APPROVAL"] } }],
};

/** The ChatMessage columns a thread reads. */
export const MESSAGE_SELECT = { id: true, role: true, content: true, toolCalls: true, kind: true, meta: true, createdAt: true } as const;

const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;

/**
 * A page of one chat the person owns, oldest first (?before=<messageId>,
 * ?take=1..100), with the cards its approval rows and lines name (the
 * person's own only). The caller has checked the chat is theirs: a
 * teammate's (liveChatWhere) or a group's (group-server.ts loadGroup).
 */
export async function messagesPage(
  sessionId: string,
  viewerId: string,
  sp: URLSearchParams,
): Promise<{ session: { id: string }; messages: TeammateMessageView[]; actions: Record<string, ActionView>; hasMore: boolean }> {
  const takeRaw = parseInt(sp.get("take") ?? "", 10);
  const take = Math.min(PAGE_MAX, Math.max(1, Number.isFinite(takeRaw) ? takeRaw : PAGE_DEFAULT));
  // The page before a message of this chat; a cursor that names none starts at the newest.
  const before = sp.get("before");
  const cursor = before ? await prisma.chatMessage.findFirst({ where: { id: before, sessionId }, select: { id: true, createdAt: true } }) : null;
  const where: Prisma.ChatMessageWhereInput = {
    sessionId,
    AND: [
      SHOWN_MESSAGES,
      ...(cursor ? [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] : []),
    ],
  };
  const rows = await prisma.chatMessage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1, select: MESSAGE_SELECT });
  const page = rows.slice(0, take).reverse();
  const messages = page.map(messageViewFromRow).filter((m): m is TeammateMessageView => m !== null);
  const actionIds = messages.flatMap((m) => (m.kind === "approval" ? m.actionIds : m.kind === "event" && m.actionId ? [m.actionId] : []));
  return { session: { id: sessionId }, messages, actions: await actionViews(actionIds, viewerId), hasMore: rows.length > take };
}

/** Talk and Tables, which some tools need. */
export async function workspaceModules(organizationId: string): Promise<{ tablesOn: boolean; talkOn: boolean }> {
  const [tablesOn, talkOn] = await Promise.all([isModuleActive(organizationId, "workwrk-tables"), isModuleActive(organizationId, "workwrk-talk")]);
  return { tablesOn, talkOn };
}

// ── The list's rows ─────────────────────────────────────────────────

function statusOf(s: string): TeammateStatus {
  return s === "DISABLED" || s === "ARCHIVED" ? s : "ENABLED";
}

/**
 * The list's rows for these teammates, as this person sees them: the
 * requests waiting for them, an answer or report after their read cursor
 * (AgentPersonSetting.lastReadAt), and the chat's last line. Six queries
 * however many teammates there are. Unsorted (teammate-thread.ts
 * sortTeammates orders them).
 */
export async function teammateRows(agents: readonly TeammateRecord[], viewer: Viewer, now: Date = new Date()): Promise<TeammateRow[]> {
  if (agents.length === 0) return [];
  const ids = agents.map((a) => a.id);
  // A card that lives in a group chat is the group row's to count, never the
  // teammate's own row (docs/plans/ai-teammates-phase2.md step 3).
  const groups = await prisma.chatSession.findMany({
    where: { organizationId: viewer.organizationId, userId: viewer.userId, kind: "TEAMMATE_GROUP" },
    select: { id: true },
    take: 500,
  });
  const notInGroups: Prisma.AgentActionWhereInput =
    groups.length > 0 ? { OR: [{ sessionId: null }, { sessionId: { notIn: groups.map((g) => g.id) } }] } : {};
  const [sessions, settings, waiting] = await Promise.all([
    prisma.chatSession.findMany({
      where: { organizationId: viewer.organizationId, userId: viewer.userId, kind: "TEAMMATE", archivedAt: null, agentId: { in: ids } },
      select: { id: true, agentId: true },
    }),
    prisma.agentPersonSetting.findMany({ where: { userId: viewer.userId, agentId: { in: ids } }, select: { agentId: true, lastReadAt: true } }),
    prisma.agentAction.groupBy({
      by: ["agentId"],
      where: { organizationId: viewer.organizationId, actingForId: viewer.userId, status: "PENDING", expiresAt: { gt: now }, agentId: { in: ids }, ...notInGroups },
      _count: { _all: true },
    }),
  ]);
  const sessionIds = sessions.map((s) => s.id);
  const [lastShown, lastAnswer] = await Promise.all([
    prisma.chatMessage.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, AND: [SHOWN_MESSAGES] }, _max: { createdAt: true } }),
    // An answer or a routine's report: what the unread dot is for.
    prisma.chatMessage.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, role: "ASSISTANT" }, _max: { createdAt: true } }),
  ]);
  const pairs = lastShown.flatMap((g) => (g._max.createdAt ? [{ sessionId: g.sessionId, createdAt: g._max.createdAt }] : []));
  const lastRows =
    pairs.length > 0
      ? await prisma.chatMessage.findMany({ where: { AND: [SHOWN_MESSAGES, { OR: pairs }] }, select: { ...MESSAGE_SELECT, sessionId: true } })
      : [];
  // Two rows at one instant: the larger id, as the thread orders them.
  const lastBySession = new Map<string, (typeof lastRows)[number]>();
  for (const row of lastRows) {
    const seen = lastBySession.get(row.sessionId);
    if (!seen || row.id > seen.id) lastBySession.set(row.sessionId, row);
  }
  const sessionOf = new Map(sessions.map((s) => [s.agentId, s.id]));
  const readAt = new Map(settings.map((s) => [s.agentId, s.lastReadAt]));
  const waitingOf = new Map(waiting.map((w) => [w.agentId, w._count._all]));
  const answeredAt = new Map(lastAnswer.map((g) => [g.sessionId, g._max.createdAt]));

  return agents.map((a): TeammateRow => {
    const sessionId = sessionOf.get(a.id) ?? null;
    const last = sessionId ? lastBySession.get(sessionId) : undefined;
    const view = last ? messageViewFromRow(last) : null;
    const answered = sessionId ? answeredAt.get(sessionId) : null;
    const read = readAt.get(a.id) ?? null;
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      job: a.description,
      hue: hueForAgent({ hue: a.hue, slug: a.slug }),
      avatar: a.avatar,
      visibility: a.visibility === "PRIVATE" ? "PRIVATE" : "WORKSPACE",
      status: statusOf(a.status),
      template: a.template,
      legacy: a.toolNames === null,
      canManage: canManageAgent(a, viewer),
      waiting: waitingOf.get(a.id) ?? 0,
      unread: Boolean(answered && (!read || answered.getTime() > read.getTime())),
      lastAt: last ? last.createdAt.toISOString() : null,
      lastLine: lastLineFor(view),
    };
  });
}

/**
 * Whether any teammate this person may use, and that was not removed, has an
 * answer or report they have not read: a row's unread dot (teammateRows), for
 * every teammate at once. The AI sidebar's dot. Three queries at most.
 */
export async function anyTeammateUnread(viewer: Viewer): Promise<boolean> {
  const sessions = await prisma.chatSession.findMany({
    where: {
      organizationId: viewer.organizationId,
      userId: viewer.userId,
      kind: "TEAMMATE",
      archivedAt: null,
      agent: { organizationId: viewer.organizationId, status: { not: "ARCHIVED" }, ...agentUsableWhere(viewer.userId) },
    },
    select: { id: true, agentId: true },
  });
  const live = sessions.flatMap((s) => (s.agentId ? [{ id: s.id, agentId: s.agentId }] : []));
  if (live.length === 0) return false;
  const [settings, lastAnswer] = await Promise.all([
    prisma.agentPersonSetting.findMany({ where: { userId: viewer.userId, agentId: { in: live.map((s) => s.agentId) } }, select: { agentId: true, lastReadAt: true } }),
    prisma.chatMessage.groupBy({ by: ["sessionId"], where: { sessionId: { in: live.map((s) => s.id) }, role: "ASSISTANT" }, _max: { createdAt: true } }),
  ]);
  const readAt = new Map(settings.map((s) => [s.agentId, s.lastReadAt]));
  const answeredAt = new Map(lastAnswer.map((g) => [g.sessionId, g._max.createdAt]));
  return live.some((s) => {
    const answered = answeredAt.get(s.id);
    const read = readAt.get(s.agentId) ?? null;
    return Boolean(answered && (!read || answered.getTime() > read.getTime()));
  });
}

// ── The plan's limits ───────────────────────────────────────────────

/** The person's own teammates that count toward the plan: PRIVATE, theirs, not removed. */
export function personalCountWhere(organizationId: string, userId: string): Prisma.AgentWhereInput {
  return { organizationId, visibility: "PRIVATE", ownerId: userId, status: { not: "ARCHIVED" } };
}

/**
 * The workspace teammates that count: shared, not removed, and made as
 * teammates (toolNames set). Catalog and custom agents the workspace already
 * had (toolNames null) never count, so no workspace is held back by what it
 * had before teammates.
 */
export function workspaceCountWhere(organizationId: string): Prisma.AgentWhereInput {
  return { organizationId, visibility: "WORKSPACE", status: { not: "ARCHIVED" }, toolNames: { not: Prisma.DbNull } };
}

export interface PlanTeammateLimits extends TeammateLimits {
  plan: string;
}

/** TEAMMATE_LIMITS for this workspace's plan, and what counts against them now. */
export async function teammateLimits(organizationId: string, userId: string): Promise<PlanTeammateLimits> {
  const [org, personal, workspace] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } }),
    prisma.agent.count({ where: personalCountWhere(organizationId, userId) }),
    prisma.agent.count({ where: workspaceCountWhere(organizationId) }),
  ]);
  const plan = String(org?.plan ?? "STARTER");
  const caps = TEAMMATE_LIMITS[plan] ?? TEAMMATE_LIMITS.STARTER;
  // 99999 is no limit, as the plan's AI questions read it.
  const max = (n: number) => (n >= UNLIMITED_AI ? null : n);
  return { plan, personal: { used: personal, max: max(caps.personal) }, workspace: { used: workspace, max: max(caps.workspace) } };
}

/** The 403 for one more teammate of this visibility past the plan's limit, or null when there is room. */
export function overLimit(limits: PlanTeammateLimits, visibility: TeammateVisibility): NextResponse | null {
  const l = visibility === "PRIVATE" ? limits.personal : limits.workspace;
  if (l.max === null || l.used < l.max) return null;
  return teammateError(403, "limit", teammateLimitMessage(l.used, limits.plan, visibility === "PRIVATE" ? "personal" : "workspace"));
}

// ── Settings ────────────────────────────────────────────────────────

/** The "conv:<id>" targets among stored rules. */
function conversationTargets(rules: unknown): string[] {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return [];
  const ids = new Set<string>();
  for (const key of Object.keys(rules)) {
    const m = /^post_in_talk:conv:([A-Za-z0-9_-]{1,64})$/.exec(key);
    if (m) ids.add(m[1]);
  }
  return [...ids].slice(0, 200);
}

/**
 * The conversations a person's Talk choices name, as they see them: "#name",
 * a group's name, or "your chat with Max Chen". Only ones they are still in;
 * the rest keep no label (a renamed private channel's new name is not theirs
 * to learn).
 */
async function conversationLabels(organizationId: string, userId: string, ids: readonly string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const mine = await prisma.conversationMember.findMany({
    where: { userId, conversationId: { in: [...ids] }, conversation: { organizationId } },
    select: { conversation: { select: { id: true, type: true, name: true } } },
  });
  const dmIds = mine.filter((m) => m.conversation.type === "DM").map((m) => m.conversation.id);
  const others =
    dmIds.length === 0
      ? []
      : await prisma.conversationMember.findMany({
          where: { conversationId: { in: dmIds }, userId: { not: userId } },
          select: { conversationId: true, user: { select: { firstName: true, lastName: true, email: true } } },
        });
  const otherName = new Map(others.map((o) => [o.conversationId, `${o.user.firstName ?? ""} ${o.user.lastName ?? ""}`.trim() || o.user.email]));
  const out: Record<string, string> = {};
  for (const { conversation: c } of mine) {
    const dm = otherName.get(c.id);
    out[`conv:${c.id}`] = c.type === "CHANNEL" ? channelPlace(c.name ?? "channel") : c.type === "GROUP" ? c.name?.trim() || GROUP_FALLBACK : dm ? dmPlace(dm) : GROUP_FALLBACK;
  }
  return out;
}

/**
 * The Tools and approvals table of this teammate for this person
 * (teammate-views.ts toolSettings). `personRules` when the caller already
 * holds them (the approvals PUT, right after saving).
 */
export async function toolTable(
  agent: TeammateRecord,
  userId: string,
  opts: { modules?: { tablesOn: boolean; talkOn: boolean }; personRules?: unknown } = {},
): Promise<ToolSetting[]> {
  const [modules, personRules] = await Promise.all([
    opts.modules ?? workspaceModules(agent.organizationId),
    opts.personRules !== undefined
      ? opts.personRules
      : prisma.agentPersonSetting
          .findUnique({ where: { agentId_userId: { agentId: agent.id, userId } }, select: { approvalRules: true } })
          .then((s) => s?.approvalRules ?? {}),
  ]);
  const targetLabels = await conversationLabels(agent.organizationId, userId, conversationTargets(personRules));
  return toolSettings({
    enabled: teammateToolNames(agent, modules),
    agentRules: agent.approvalRules,
    personRules,
    talkOn: modules.talkOn,
    tablesOn: modules.tablesOn,
    targetLabels,
  });
}

/** One teammate's settings for this person (GET /api/agents/teammates/[slug]). */
export async function teammateDetail(agent: TeammateRecord, viewer: Viewer): Promise<TeammateDetail> {
  const modules = await workspaceModules(agent.organizationId);
  const [rows, tools, usage, chat] = await Promise.all([
    teammateRows([agent], viewer),
    toolTable(agent, viewer.userId, { modules }),
    agentMonthUsage(agent.id),
    prisma.chatSession.findFirst({ where: liveChatWhere(agent, viewer.userId), select: { id: true } }),
  ]);
  return {
    ...rows[0],
    instructions: agent.systemPrompt,
    toolNames: teammateToolNames(agent, modules),
    monthlyQuestionCap: agent.monthlyQuestionCap,
    usage: { month: usage.monthStart.toISOString().slice(0, 10), used: usage.used, cap: agent.monthlyQuestionCap },
    tools,
    sessionId: chat?.id ?? null,
  };
}
