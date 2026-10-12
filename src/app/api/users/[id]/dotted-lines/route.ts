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
//
// A workspace writes only the dotted lines it owns (docs-found fixes batch
// 6). A UserDottedLine is one row, read by every workspace the person
// belongs to. GET answers the lines to people who hold a level here, and PUT
// replaces only those: a line to someone who holds no level here is another
// workspace's (they work with the person there) and is kept as it is,
// whether or not the body names it. Before, PUT deleted every line the body
// left out, so saving one dotted line here deleted the person's dotted lines
// in their other workspace, and a body that named one was refused as "isn't
// in this workspace". A line no workspace reads (its manager works in none
// of the person's workspaces) is this workspace's to take off.
//
// Both answer how many lines are kept for another workspace (`keptElsewhere`,
// batch 7), never whose, and the person record leaves those lines out of the
// names it shows, so Edit details never offers to take one off. Before, a
// dotted manager who is an Agent here and a manager in the person's other
// workspace was listed on the record, the dialog let it be removed, the PUT
// answered 200 and kept it: the line came back on the next load.

import { NextResponse, type NextRequest } from "next/server";
import { accessV2Resolver } from "@/lib/access/flags";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { agentIdsAmong, managerMapFor, peopleCtx, relationTo, type PeopleCtx } from "@/lib/people/person-access.server";
import { canWritePersonGroup } from "@/lib/people/person-fields";
import { agentIdsIn } from "@/lib/access/manager-candidate";
import { lockOrgRoles } from "@/lib/access/membership";
import { levelsHeldIn, workspaceDottedLines } from "@/lib/access/acting-workspace";
import { othersDottedLines } from "@/lib/access/manager-lines";
import { rolesBusyOrThrow } from "@/lib/access/roles-busy";

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
    // Everyone who works here (docs-found fixes batch 5), as managerMapFor:
    // two indexed halves, never a scan of every workspace's people (batch 6).
    workspaceDottedLines(organizationId),
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
  return canWritePersonGroup("placement", relation, { managerTierSelf: false, chainWritesMembership: !accessV2Resolver() }) && relation !== "self";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (!user) return err(404, "Not found");
  const stored = await prisma.userDottedLine.findMany({
    where: { userId: id },
    select: { managerId: true, role: true, manager: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
  });
  // The lines this workspace manages: never another workspace's (batch 6),
  // nor a line to someone who holds no level here.
  const [held, others] = await Promise.all([levelsHeldIn(ctx.organizationId, stored.map((r) => r.managerId)), othersDottedLines(ctx.organizationId, id)]);
  const rows = stored.filter((r) => held.has(r.managerId) && !others.has(r.managerId));
  // `below` is the person's report tree (solid and dotted), so the Edit
  // details picker can leave every one of them out. Only a writer gets it:
  // a reader has no picker, and the list is placement data.
  const below = writesDottedLines(ctx, id) ? [...(await peopleBelow(ctx.organizationId, id))] : undefined;
  return NextResponse.json({ managers: rows.map((r) => ({ ...r.manager, note: r.role })), keptElsewhere: others.size, ...(below ? { below } : {}) });
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
  // The lines kept as they are (batch 6): to someone who holds no level here
  // but works with the person in another workspace. Named in the body or
  // not, they are that workspace's, never checked or deleted here.
  const elsewhere = await othersDottedLines(ctx.organizationId, id);
  const checked = ids.filter((m) => !elsewhere.has(m));
  if (checked.length) {
    const { found, agents } = await agentIdsAmong(ctx.organizationId, checked);
    if (found !== checked.length) return err(400, "Someone in that list isn't in this workspace");
    if (agents.length) return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage" });
    const below = await peopleBelow(ctx.organizationId, id);
    // `managerIds` names the refused people, so a line saved before this
    // check existed can be found and taken off (removing it always passes).
    const looped = checked.filter((m) => below.has(m));
    if (looped.length) {
      return err(409, "That would make a reporting loop: this person already manages them, directly or further down.", { code: "dotted_line_cycle", field: "dottedLines", managerIds: looped });
    }
  }
  // The set is written under the workspace's role lock, and its managers
  // checked again there (rule 6's race, docs-found fixes batch 3): a role
  // change making one of them an Agent counts their dotted reports under the
  // same lock, so it waits for this write and sees the line, or lands first
  // and this sees an Agent.
  const written = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, ctx.organizationId);
    if (checked.length && (await agentIdsIn(ctx.organizationId, checked, tx)).size > 0) return { agent: true as const };
    // Only this workspace's lines are replaced: the others' stay (batch 6).
    const others = await othersDottedLines(ctx.organizationId, id, tx);
    const keep = [...ids, ...others];
    await tx.userDottedLine.deleteMany({ where: { userId: id, managerId: { notIn: keep } } });
    for (const managerId of checked) {
      await tx.userDottedLine.upsert({
        where: { userId_managerId: { userId: id, managerId } },
        create: { userId: id, managerId },
        update: {},
      });
    }
    return { agent: false as const, kept: others.size };
  }).catch(rolesBusyOrThrow);
  if (written instanceof NextResponse) return written;
  if (written.agent) return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage" });
  void logActivity({
    type: "reporting_line_changed",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Changed ${subject.firstName} ${subject.lastName}'s dotted-line managers`,
    targetId: id,
    targetType: "user",
    metadata: { dottedManagerIds: ids },
  });
  // The lines this workspace manages now, and how many are kept for another
  // workspace (batch 7), so the dialog says so instead of a save that seems
  // to take one off.
  return NextResponse.json({ managerIds: checked, keptElsewhere: written.kept });
}
