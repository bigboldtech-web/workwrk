// Group chats, the server half (docs/plans/ai-teammates-phase2.md step 3):
// one person's chat with two to five of their teammates. A group is a
// ChatSession of kind TEAMMATE_GROUP that belongs to the person who made it
// (userId), with no agentId; its teammates are ChatSessionTeammate rows. The
// pure rules (who answers, the member checks, the default name) are
// group-chat.ts.
//
// WHOSE IT IS. Only its person reads or changes a group: every read goes
// through GROUP_SESSION_WHERE, so another person's group, an archived one and
// a one-teammate chat all answer "not found", the same body. A member is used
// only while the person may use it now (canUseAgent); one they cannot is
// shown as unable to answer, never run.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import type { Viewer } from "@/lib/access/types";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { writeEventLine } from "./actions";
import { GROUP_LIMITS, groupNameFrom, leadOf, memberProblem, skipReasonOf, type GroupMember } from "./group-chat";
import { hueForAgent } from "./hues";
import { canUseAgent } from "./teammate-access";
import { GROUP_COPY, TEAMMATE_ROUTE_ERRORS, titleList } from "./teammate-copy";
import { MESSAGE_SELECT, SHOWN_MESSAGES, TEAMMATE_SELECT, loadTeammate, type TeammateRecord } from "./teammate-server";
import { lastLineFor, messageViewFromRow, type GroupDetail, type GroupMemberView, type GroupRow } from "./teammate-thread";

export { groupActionHref } from "./teammate-thread";

export const GROUP_KIND = "TEAMMATE_GROUP";

/** This person's live group with this id: the only way a group is read. */
export const GROUP_SESSION_WHERE = (viewer: Pick<Viewer, "organizationId" | "userId">, id: string): Prisma.ChatSessionWhereInput => ({
  id,
  organizationId: viewer.organizationId,
  userId: viewer.userId,
  kind: GROUP_KIND,
  archivedAt: null,
});

const GROUP_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  lastReadAt: true,
  teammates: { select: { position: true, agent: { select: TEAMMATE_SELECT } }, orderBy: { position: "asc" } },
} as const satisfies Prisma.ChatSessionSelect;

export interface GroupRecord {
  id: string;
  title: string | null;
  createdAt: Date;
  lastReadAt: Date | null;
  members: Array<{ position: number; agent: TeammateRecord }>;
}

type GroupRowSelected = Prisma.ChatSessionGetPayload<{ select: typeof GROUP_SELECT }>;

function recordOf(row: GroupRowSelected, organizationId: string): GroupRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    lastReadAt: row.lastReadAt,
    // A teammate of another workspace can never be a member; held here too.
    members: row.teammates.filter((m) => m.agent.organizationId === organizationId).map((m) => ({ position: m.position, agent: m.agent })),
  };
}

/** The person's group with this id, or null: another person's, an archived one, or not a group. */
export async function loadGroup(id: string, viewer: Viewer): Promise<GroupRecord | null> {
  if (typeof id !== "string" || !id || id.length > 200) return null;
  const row = await prisma.chatSession.findFirst({ where: GROUP_SESSION_WHERE(viewer, id), select: GROUP_SELECT });
  return row ? recordOf(row, viewer.organizationId) : null;
}

function statusOf(s: string): GroupMember["status"] {
  return s === "DISABLED" || s === "ARCHIVED" ? s : "ENABLED";
}

/** The group's members as the rules read them (group-chat.ts), for this person now. */
export function groupMembersFor(g: Pick<GroupRecord, "members">, viewer: Viewer): GroupMember[] {
  return g.members.map((m) => ({
    agentId: m.agent.id,
    slug: m.agent.slug,
    name: m.agent.name,
    template: m.agent.template,
    position: m.position,
    status: statusOf(m.agent.status),
    usable: canUseAgent(m.agent, viewer),
  }));
}

/** The members as the page shows them, in position order. */
export function memberViews(g: Pick<GroupRecord, "members">, viewer: Viewer): GroupMemberView[] {
  const members = groupMembersFor(g, viewer);
  const lead = leadOf(members);
  const byId = new Map(g.members.map((m) => [m.agent.id, m.agent]));
  return members
    .sort((a, b) => a.position - b.position)
    .map((m) => {
      const agent = byId.get(m.agentId);
      return {
        agentId: m.agentId,
        slug: m.slug,
        name: m.name,
        hue: agent ? hueForAgent({ hue: agent.hue, slug: agent.slug }) : null,
        avatar: agent?.avatar ?? null,
        status: m.status,
        canAnswer: skipReasonOf(m) === null,
        position: m.position,
        lead: lead?.agentId === m.agentId,
      };
    });
}

/** The group's name: its own, else its first three teammates'. */
export function groupNameOf(g: Pick<GroupRecord, "title" | "members">): string {
  const own = (g.title ?? "").trim();
  return own || GROUP_COPY.groupDefaultName(g.members.map((m) => m.agent.name).slice(0, 3));
}

// ── Making and changing one ─────────────────────────────────────────

export type GroupResult = { ok: true; group: GroupRecord } | { ok: false; status: number; code: string; error: string };

const refuse = (status: number, code: string, error: string): GroupResult => ({ ok: false, status, code, error });

const PROBLEM: Record<"too_few" | "too_many" | "duplicate_name", { status: number; error: string }> = {
  too_few: { status: 400, error: GROUP_COPY.pickMore },
  too_many: { status: 400, error: GROUP_COPY.tooMany },
  duplicate_name: { status: 400, error: GROUP_COPY.duplicateName },
};

function uniqueSlugs(slugs: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const s of slugs) if (typeof s === "string" && s && !out.includes(s)) out.push(s);
  return out;
}

/**
 * The teammates these slugs name, each one the person may use and not
 * removed, else the refusal. A slug the person cannot use answers exactly
 * as one that does not exist.
 */
async function teammatesFor(slugs: readonly string[], viewer: Viewer): Promise<{ ok: true; agents: TeammateRecord[] } | { ok: false; refusal: GroupResult }> {
  const agents: TeammateRecord[] = [];
  for (const slug of slugs) {
    const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
    if (!agent) return { ok: false, refusal: refuse(404, "not_found", TEAMMATE_ROUTE_ERRORS.teammateNotFound) };
    if (agent.status === "ARCHIVED") return { ok: false, refusal: refuse(409, "agent_removed", GROUP_COPY.removedCantJoin(agent.name)) };
    agents.push(agent);
  }
  return { ok: true, agents };
}

/** Make a group of 2 to 5 of the person's teammates (Decision 13). */
export async function createGroup(viewer: Viewer, input: { name?: string | null; agentSlugs: readonly unknown[] }): Promise<GroupResult> {
  const slugs = uniqueSlugs(input.agentSlugs);
  if (slugs.length < GROUP_LIMITS.minMembers) return refuse(400, "too_few", GROUP_COPY.pickMore);
  if (slugs.length > GROUP_LIMITS.maxMembers) return refuse(400, "too_many", GROUP_COPY.tooMany);
  const found = await teammatesFor(slugs, viewer);
  if (!found.ok) return found.refusal;
  const problem = memberProblem(found.agents.map((a) => ({ name: a.name, status: a.status })));
  if (problem) return refuse(PROBLEM[problem].status, problem, PROBLEM[problem].error);
  const live = await prisma.chatSession.count({ where: { organizationId: viewer.organizationId, userId: viewer.userId, kind: GROUP_KIND, archivedAt: null } });
  if (live >= GROUP_LIMITS.perPerson) return refuse(403, "limit", GROUP_COPY.limit(GROUP_LIMITS.perPerson));
  const title = groupNameFrom(input.name, found.agents.map((a) => a.name));
  const id = await prisma.$transaction(async (tx) => {
    const chat = await tx.chatSession.create({
      data: { organizationId: viewer.organizationId, userId: viewer.userId, kind: GROUP_KIND, agentId: null, title },
      select: { id: true },
    });
    await tx.chatSessionTeammate.createMany({ data: found.agents.map((a, i) => ({ sessionId: chat.id, agentId: a.id, position: i })) });
    return chat.id;
  });
  const group = await loadGroup(id, viewer);
  return group ? { ok: true, group } : refuse(404, "not_found", GROUP_COPY.notFound);
}

/**
 * Rename it, add teammates (at the end) and remove some, each change a line
 * in the group. A group keeps at least two teammates still in the
 * workspace: a removal below that answers min_members (the person leaves the
 * group instead).
 */
export async function updateGroup(
  g: GroupRecord,
  viewer: Viewer,
  input: { name?: string | null; add?: readonly unknown[]; remove?: readonly unknown[] },
): Promise<GroupResult> {
  const addSlugs = uniqueSlugs(input.add ?? []).filter((s) => !g.members.some((m) => m.agent.slug === s));
  const removeIds = new Set(uniqueSlugs(input.remove ?? []).flatMap((s) => g.members.filter((m) => m.agent.slug === s).map((m) => m.agent.id)));
  const found = await teammatesFor(addSlugs, viewer);
  if (!found.ok) return found.refusal;
  const kept = g.members.filter((m) => !removeIds.has(m.agent.id));
  const after = [...kept.map((m) => ({ name: m.agent.name, status: m.agent.status })), ...found.agents.map((a) => ({ name: a.name, status: a.status }))];
  const changing = found.agents.length > 0 || removeIds.size > 0;
  if (changing) {
    const liveBefore = g.members.filter((m) => m.agent.status !== "ARCHIVED").length;
    const liveAfter = after.filter((m) => m.status !== "ARCHIVED").length;
    if (liveAfter < GROUP_LIMITS.minMembers && liveAfter < liveBefore) return refuse(409, "min_members", GROUP_COPY.minMembers);
    const problem = memberProblem(after);
    // Too few that removing did not cause (a teammate removed from the
    // workspace) never blocks an add or a removal of a removed one.
    if (problem && problem !== "too_few") return refuse(PROBLEM[problem].status, problem, PROBLEM[problem].error);
  }
  const renaming = input.name !== undefined;
  const title = renaming ? groupNameFrom(input.name, after.map((m) => m.name)) : g.title;
  const renamed = renaming && title !== g.title;
  if (!changing && !renamed) return { ok: true, group: g };

  const top = g.members.reduce((max, m) => Math.max(max, m.position), -1);
  await prisma.$transaction(async (tx) => {
    if (removeIds.size > 0) {
      await tx.chatSessionTeammate.deleteMany({ where: { sessionId: g.id, agentId: { in: [...removeIds] } } });
      // What a removed teammate still asked in this group is cancelled: no
      // continue can follow it here (review round 1, as leaving does).
      await tx.agentAction.updateMany({
        where: { sessionId: g.id, actingForId: viewer.userId, agentId: { in: [...removeIds] }, status: "PENDING" },
        data: { status: "CANCELLED", decidedVia: "system", decidedAt: new Date(), error: GROUP_COPY.cancelledRemoved },
      });
    }
    if (found.agents.length > 0) {
      await tx.chatSessionTeammate.createMany({ data: found.agents.map((a, i) => ({ sessionId: g.id, agentId: a.id, position: Math.min(99, top + 1 + i) })), skipDuplicates: true });
    }
    await tx.chatSession.update({ where: { id: g.id }, data: { ...(renamed ? { title } : {}), updatedAt: new Date() } });
  });
  if (renamed && title) await writeEventLine(g.id, { text: GROUP_COPY.renamedLine(title), event: "group_renamed" });
  for (const a of found.agents) await writeEventLine(g.id, { text: GROUP_COPY.addedLine(a.name), event: "group_member_added", agentId: a.id });
  for (const m of g.members.filter((x) => removeIds.has(x.agent.id))) {
    await writeEventLine(g.id, { text: GROUP_COPY.removedLine(m.agent.name), event: "group_member_removed", agentId: m.agent.id });
  }
  // Its cards were cancelled: every open tab and count reads the group again (review round 2).
  for (const id of removeIds) publishToUser(viewer.userId, { type: "agent.changed", agentId: id, sessionId: g.id });
  const group = await loadGroup(g.id, viewer);
  return group ? { ok: true, group } : refuse(404, "not_found", GROUP_COPY.notFound);
}

/** Cancel what still waits for the person in a group they left (a compare-and-swap on PENDING). */
export async function cancelLeftRequests(sessionId: string, userId: string, now: Date = new Date()): Promise<number> {
  const done = await prisma.agentAction.updateMany({
    where: { sessionId, actingForId: userId, status: "PENDING" },
    data: { status: "CANCELLED", decidedVia: "system", decidedAt: now, error: GROUP_COPY.cancelledLeft },
  });
  return done.count;
}

/** Cancel what a teammate asked in a group it was removed from while it answered. */
export async function cancelRemovedRequests(sessionId: string, userId: string, agentId: string, now: Date = new Date()): Promise<number> {
  const done = await prisma.agentAction.updateMany({
    where: { sessionId, actingForId: userId, agentId, status: "PENDING" },
    data: { status: "CANCELLED", decidedVia: "system", decidedAt: now, error: GROUP_COPY.cancelledRemoved },
  });
  return done.count;
}

/** Whether this teammate is still a member of the group (not removed meanwhile). */
export async function stillInGroup(sessionId: string, agentId: string): Promise<boolean> {
  return (await prisma.chatSessionTeammate.count({ where: { sessionId, agentId } })) > 0;
}

/** Whether the person's group is still theirs and live (not left meanwhile). */
export async function groupStillOpen(viewer: Pick<Viewer, "organizationId" | "userId">, id: string): Promise<boolean> {
  return (await prisma.chatSession.count({ where: GROUP_SESSION_WHERE(viewer, id) })) > 0;
}

/**
 * Leave it: it leaves the person's list, and what still waits in it is
 * cancelled (Decision 31). A turn still running when they leave cancels
 * what it asked when it ends (the messages route checks after each turn).
 */
export async function leaveGroup(g: GroupRecord, viewer: Viewer, now: Date = new Date()): Promise<void> {
  await prisma.chatSession.updateMany({ where: { ...GROUP_SESSION_WHERE(viewer, g.id) }, data: { archivedAt: now } });
  await cancelLeftRequests(g.id, viewer.userId, now);
  publishToUser(viewer.userId, { type: "agent.changed", agentId: g.members[0]?.agent.id ?? GROUP_KIND, sessionId: g.id });
}

// ── The list's rows ─────────────────────────────────────────────────

/**
 * The list's rows for these groups, for their person: the requests waiting
 * in each, an answer after its read cursor, and its last line. Four queries
 * however many groups.
 */
export async function groupRowsFor(groups: readonly GroupRecord[], viewer: Viewer, now: Date = new Date()): Promise<GroupRow[]> {
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.id);
  const [waiting, lastShown, lastAnswer] = await Promise.all([
    prisma.agentAction.groupBy({
      by: ["sessionId"],
      where: { organizationId: viewer.organizationId, actingForId: viewer.userId, status: "PENDING", expiresAt: { gt: now }, sessionId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.chatMessage.groupBy({ by: ["sessionId"], where: { sessionId: { in: ids }, AND: [SHOWN_MESSAGES] }, _max: { createdAt: true } }),
    prisma.chatMessage.groupBy({ by: ["sessionId"], where: { sessionId: { in: ids }, role: "ASSISTANT" }, _max: { createdAt: true } }),
  ]);
  const pairs = lastShown.flatMap((r) => (r._max.createdAt ? [{ sessionId: r.sessionId, createdAt: r._max.createdAt }] : []));
  const lastRows = pairs.length > 0 ? await prisma.chatMessage.findMany({ where: { AND: [SHOWN_MESSAGES, { OR: pairs }] }, select: { ...MESSAGE_SELECT, sessionId: true } }) : [];
  const lastBySession = new Map<string, (typeof lastRows)[number]>();
  for (const row of lastRows) {
    const seen = lastBySession.get(row.sessionId);
    if (!seen || row.id > seen.id) lastBySession.set(row.sessionId, row);
  }
  const waitingOf = new Map(waiting.flatMap((w) => (w.sessionId ? [[w.sessionId, w._count._all] as const] : [])));
  const answeredAt = new Map(lastAnswer.map((r) => [r.sessionId, r._max.createdAt]));
  return groups.map((g): GroupRow => {
    const last = lastBySession.get(g.id);
    const answered = answeredAt.get(g.id) ?? null;
    return {
      id: g.id,
      name: groupNameOf(g),
      members: memberViews(g, viewer),
      waiting: waitingOf.get(g.id) ?? 0,
      unread: Boolean(answered && (!g.lastReadAt || answered.getTime() > g.lastReadAt.getTime())),
      lastAt: last ? last.createdAt.toISOString() : null,
      lastLine: lastLineFor(last ? messageViewFromRow(last) : null),
    };
  });
}

/** The person's live groups as list rows (at most GROUP_LIMITS.perPerson). */
export async function groupRows(viewer: Viewer, now: Date = new Date()): Promise<GroupRow[]> {
  const rows = await prisma.chatSession.findMany({
    where: { organizationId: viewer.organizationId, userId: viewer.userId, kind: GROUP_KIND, archivedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: GROUP_LIMITS.perPerson,
    select: GROUP_SELECT,
  });
  return groupRowsFor(rows.map((r) => recordOf(r, viewer.organizationId)), viewer, now);
}

/** One group as the page opens it. */
export async function groupDetail(g: GroupRecord, viewer: Viewer, now: Date = new Date()): Promise<GroupDetail> {
  const [row] = await groupRowsFor([g], viewer, now);
  return { ...row, createdAt: g.createdAt.toISOString() };
}

/** Whether any live group has an answer the person has not read: the AI sidebar's dot. Two queries. */
export async function anyGroupUnread(viewer: Pick<Viewer, "organizationId" | "userId">): Promise<boolean> {
  const groups = await prisma.chatSession.findMany({
    where: { organizationId: viewer.organizationId, userId: viewer.userId, kind: GROUP_KIND, archivedAt: null },
    select: { id: true, lastReadAt: true },
    take: GROUP_LIMITS.perPerson,
  });
  if (groups.length === 0) return false;
  const lastAnswer = await prisma.chatMessage.groupBy({ by: ["sessionId"], where: { sessionId: { in: groups.map((g) => g.id) }, role: "ASSISTANT" }, _max: { createdAt: true } });
  const readAt = new Map(groups.map((g) => [g.id, g.lastReadAt]));
  return lastAnswer.some((r) => {
    const answered = r._max.createdAt;
    const read = readAt.get(r.sessionId) ?? null;
    return Boolean(answered && (!read || answered.getTime() > read.getTime()));
  });
}

/** The ids of the person's groups, left ones too: a one-teammate row never counts a card that lives in one. */
export async function liveGroupIds(viewer: Pick<Viewer, "organizationId" | "userId">): Promise<string[]> {
  const rows = await prisma.chatSession.findMany({
    where: { organizationId: viewer.organizationId, userId: viewer.userId, kind: GROUP_KIND },
    select: { id: true },
    take: 500,
  });
  return rows.map((r) => r.id);
}

/** "Triage and Project Manager": names for a sentence. */
export function namesLine(names: readonly string[]): string {
  return titleList(names, GROUP_LIMITS.maxAnswerers);
}
