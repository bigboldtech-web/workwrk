// A person's dotted-line managers (spec-teams-people /people/[id] Edit
// details and the org chart's edit mode). PUT replaces the whole set in one
// transaction, so two quick edits never leave half of each. Writers: the
// reporting chain, the People team, the org-wide levels and Admins (the same
// people who write placement). Never self, never an Agent as the manager,
// never the solid-line manager twice, and never someone below the person.
//
// Why "never below": a dotted line puts the subject in the manager's report
// tree, and that tree is the chain-view read reach (person-access.server.ts),
// so a dotted line from a manager to their own report let the report read
// the manager's phone, skill ratings, KPI history and reviews. The solid
// line's manager_cycle check (PATCH /api/users/[id]) never saw dotted lines.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { agentIdsAmong, managerMapFor, peopleCtx, relationTo, type PeopleCtx } from "@/lib/people/person-access.server";
import { canWritePersonGroup } from "@/lib/people/person-fields";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * Everyone below `subjectId`, over solid lines AND dotted lines, any depth,
 * the subject excluded. None of them may become the subject's dotted-line
 * manager. A loop already in the data never hangs the walk: each person is
 * visited once.
 */
async function peopleBelow(organizationId: string, subjectId: string): Promise<Set<string>> {
  const [managers, dotted] = await Promise.all([
    managerMapFor(organizationId),
    prisma.userDottedLine.findMany({
      where: { user: { organizationId, deletedAt: null } },
      select: { userId: true, managerId: true },
    }),
  ]);
  const under = new Map<string, string[]>();
  const link = (managerId: string | null, userId: string) => {
    if (!managerId || managerId === userId) return;
    const list = under.get(managerId) ?? [];
    list.push(userId);
    under.set(managerId, list);
  };
  for (const [userId, managerId] of managers) link(managerId, userId);
  for (const d of dotted) if (managers.has(d.userId)) link(d.managerId, d.userId);
  const below = new Set<string>();
  const queue = [subjectId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of under.get(cur) ?? []) {
      if (next === subjectId || below.has(next)) continue;
      below.add(next);
      queue.push(next);
    }
  }
  return below;
}

/** The same writers as PUT: the pickers only ask for `below` when they can write. */
function writesDottedLines(ctx: PeopleCtx, id: string): boolean {
  const relation = relationTo(ctx, id);
  return canWritePersonGroup("placement", relation, { managerTierSelf: false }) && relation !== "self";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!user) return err(404, "Not found");
  const rows = await prisma.userDottedLine.findMany({
    where: { userId: id },
    select: { managerId: true, role: true, manager: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
  });
  // `below` is the person's report tree (solid and dotted), so the Edit
  // details picker can leave every one of them out. Only a writer gets it:
  // a reader has no picker, and the list is placement data.
  const below = writesDottedLines(ctx, id) ? [...(await peopleBelow(ctx.organizationId, id))] : undefined;
  return NextResponse.json({ managers: rows.map((r) => ({ ...r.manager, note: r.role })), ...(below ? { below } : {}) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  const { id } = await params;
  const subject = await prisma.user.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, managerId: true, firstName: true, lastName: true },
  });
  if (!subject) return err(404, "Not found");
  if (!writesDottedLines(ctx, id)) {
    return err(403, "You can't change this person's dotted lines.", { code: "field_forbidden", fields: ["dottedLines"] });
  }
  const body = (await req.json().catch(() => null)) as { managerIds?: unknown } | null;
  if (!body || !Array.isArray(body.managerIds) || !body.managerIds.every((x) => typeof x === "string")) {
    return err(400, "Send { managerIds: string[] }");
  }
  // Self is refused out loud. It used to be dropped in silence, and because
  // PUT replaces the whole set, that request also wiped every other entry.
  if ((body.managerIds as string[]).includes(id)) {
    return err(400, "Someone can't be their own dotted-line manager.", { code: "self_dotted_line", field: "dottedLines" });
  }
  const ids = [...new Set(body.managerIds as string[])].filter((m) => m !== subject.managerId);
  if (ids.length > 20) return err(400, "Up to 20 dotted-line managers");
  if (ids.length) {
    const { found, agents } = await agentIdsAmong(ctx.organizationId, ids);
    if (found !== ids.length) return err(400, "Someone in that list isn't in this workspace");
    if (agents.length) return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage" });
    const below = await peopleBelow(ctx.organizationId, id);
    // `managerIds` names the refused people, so a line saved before this
    // check existed can be found and taken off (removing it always passes).
    const looped = ids.filter((m) => below.has(m));
    if (looped.length) {
      return err(409, "That would make a reporting loop: this person already manages them, directly or further down.", { code: "dotted_line_cycle", field: "dottedLines", managerIds: looped });
    }
  }
  await prisma.$transaction([
    prisma.userDottedLine.deleteMany({ where: { userId: id, managerId: { notIn: ids } } }),
    ...ids.map((managerId) =>
      prisma.userDottedLine.upsert({
        where: { userId_managerId: { userId: id, managerId } },
        create: { userId: id, managerId },
        update: {},
      }),
    ),
  ]);
  void logActivity({
    type: "reporting_line_changed",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Changed ${subject.firstName} ${subject.lastName}'s dotted-line managers`,
    targetId: id,
    targetType: "user",
    metadata: { dottedManagerIds: ids },
  });
  return NextResponse.json({ managerIds: ids });
}
