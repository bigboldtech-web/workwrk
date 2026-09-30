// PATCH  /api/settings/teams/:id  { name?, description?, add?: userId[], remove?: userId[], lead?: { userId, lead } }
// DELETE /api/settings/teams/:id  archive the Team (its members stay people; nothing else changes)
//
// Owner and Admin only (Settings > Members > Teams, Phase 8 stage E). Added
// people must be live people of this workspace. Every change is one audit row.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { issueKey } from "@/lib/zod-issue-key";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const ID = z.string().min(1).max(64);
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(280).nullable().optional(),
    add: z.array(ID).max(200).optional(),
    remove: z.array(ID).max(200).optional(),
    lead: z.object({ userId: ID, lead: z.boolean() }).strict().optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

async function actor() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE }) } as const;
  if (!sessionIsWorkspaceAdmin(session)) return { error: NextResponse.json({ error: "no_access", page: "members" }, { status: 403, headers: NO_STORE }) } as const;
  return { userId: u.id, organizationId: u.organizationId } as const;
}

export async function PATCH(req: Request, { params }: Params) {
  const a = await actor();
  if ("error" in a) return a.error;
  const { id } = await params;
  const team = await prisma.team.findFirst({ where: { id, organizationId: a.organizationId, archivedAt: null } });
  if (!team) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const key = issueKey(parsed.error.issues[0]);
    return NextResponse.json({ error: "invalid_body", key }, { status: 400, headers: NO_STORE });
  }
  const { name, description, add = [], remove = [], lead } = parsed.data;
  if (name && name.toLowerCase() !== team.name.toLowerCase()) {
    const clash = await prisma.team.findFirst({ where: { organizationId: a.organizationId, name: { equals: name, mode: "insensitive" }, id: { not: id } }, select: { id: true } });
    if (clash) return NextResponse.json({ error: "name_taken", key: "name" }, { status: 409, headers: NO_STORE });
  }
  const wanted = [...new Set([...add, ...(lead ? [lead.userId] : [])])];
  if (wanted.length) {
    const live = await prisma.user.count({ where: { id: { in: wanted }, organizationId: a.organizationId, deletedAt: null } });
    if (live !== wanted.length) return NextResponse.json({ error: "not_in_org", key: "add" }, { status: 400, headers: NO_STORE });
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (name !== undefined || description !== undefined) {
        await tx.team.update({ where: { id }, data: { ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}) } });
      }
      for (const userId of add) {
        await tx.teamMember.upsert({ where: { teamId_userId: { teamId: id, userId } }, create: { teamId: id, userId }, update: {} });
      }
      if (remove.length) await tx.teamMember.deleteMany({ where: { teamId: id, userId: { in: remove } } });
      if (lead) {
        await tx.teamMember.upsert({ where: { teamId_userId: { teamId: id, userId: lead.userId } }, create: { teamId: id, userId: lead.userId, lead: lead.lead }, update: { lead: lead.lead } });
      }
    });
  } catch (err) {
    // A rename racing another Admin's team of the same name: the same 409
    // the clash check gives, never a 500.
    if ((err as { code?: string } | null)?.code === "P2002") return NextResponse.json({ error: "name_taken", key: "name" }, { status: 409, headers: NO_STORE });
    throw err;
  }
  const type = add.length || remove.length ? "team.members_changed" : "team.updated";
  await logActivity({
    organizationId: a.organizationId,
    actorId: a.userId,
    type,
    targetType: "Team",
    targetId: id,
    description: add.length || remove.length ? `Changed the people on ${name ?? team.name}` : `Updated the team ${name ?? team.name}`,
    metadata: { add, remove, lead: lead ?? null, name: name ?? null },
  }).catch(() => {});
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(_req: Request, { params }: Params) {
  const a = await actor();
  if ("error" in a) return a.error;
  const { id } = await params;
  const r = await prisma.team.updateMany({ where: { id, organizationId: a.organizationId, archivedAt: null }, data: { archivedAt: new Date() } });
  if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  await logActivity({ organizationId: a.organizationId, actorId: a.userId, type: "team.archived", targetType: "Team", targetId: id, description: "Archived a team" }).catch(() => {});
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
