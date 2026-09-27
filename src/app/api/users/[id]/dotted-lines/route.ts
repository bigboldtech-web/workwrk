// A person's dotted-line managers (spec-teams-people /people/[id] Edit
// details and the org chart's edit mode). PUT replaces the whole set in one
// transaction, so two quick edits never leave half of each. Writers: the
// reporting chain, the People team, the org-wide levels and Admins (the same
// people who write placement). Never self, never an Agent as the manager,
// never the solid-line manager twice.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { agentIdsAmong, peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { canWritePersonGroup } from "@/lib/people/person-fields";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

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
  return NextResponse.json({ managers: rows.map((r) => ({ ...r.manager, note: r.role })) });
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
  const relation = relationTo(ctx, id);
  if (!canWritePersonGroup("placement", relation, { managerTierSelf: false }) || relation === "self") {
    return err(403, "You can't change this person's dotted lines.", { code: "field_forbidden", fields: ["dottedLines"] });
  }
  const body = (await req.json().catch(() => null)) as { managerIds?: unknown } | null;
  if (!body || !Array.isArray(body.managerIds) || !body.managerIds.every((x) => typeof x === "string")) {
    return err(400, "Send { managerIds: string[] }");
  }
  const ids = [...new Set(body.managerIds as string[])].filter((m) => m !== id && m !== subject.managerId);
  if (ids.length > 20) return err(400, "Up to 20 dotted-line managers");
  if (ids.length) {
    const { found, agents } = await agentIdsAmong(ctx.organizationId, ids);
    if (found !== ids.length) return err(400, "Someone in that list isn't in this workspace");
    if (agents.length) return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage" });
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
