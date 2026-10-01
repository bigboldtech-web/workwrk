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
import { settingsWriteGate } from "@/lib/access/settings-write";
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

// The name an archived team takes when a rename claims its old one: the old
// name plus a short id tail (unique per row), cut so the whole stays inside
// the 80-character name limit. Not exported: a route file may only export
// its handlers.
function freedArchivedName(oldName: string, teamId: string): string {
  const tail = ` (archived ${teamId.slice(-6)})`;
  return `${oldName.slice(0, 80 - tail.length).trimEnd()}${tail}`;
}

async function actor() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE }) } as const;
  if (!sessionIsWorkspaceAdmin(session)) return { error: NextResponse.json({ error: "no_access", page: "members" }, { status: 403, headers: NO_STORE }) } as const;
  // Re-read the actor from the database (a demotion lands now, not at the
  // five-minute session check).
  const gate = await settingsWriteGate(session, "members");
  if (!gate.ok) return { error: gate.response } as const;
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
  // Only a LIVE team holds a name. An archived team cannot be seen or
  // restored anywhere, so refusing a rename over it gave a 409 nobody could
  // explain (and POST already lets the same name through by reviving the
  // archived row). An archived clash gives its name up inside the
  // transaction below instead, so the @@unique([organizationId, name])
  // index does not throw.
  let archivedClashes: { id: string; name: string }[] = [];
  if (name && name.toLowerCase() !== team.name.toLowerCase()) {
    const clashes = await prisma.team.findMany({ where: { organizationId: a.organizationId, name: { equals: name, mode: "insensitive" }, id: { not: id } }, select: { id: true, name: true, archivedAt: true } });
    if (clashes.some((c) => !c.archivedAt)) return NextResponse.json({ error: "name_taken", key: "name" }, { status: 409, headers: NO_STORE });
    archivedClashes = clashes.map((c) => ({ id: c.id, name: c.name }));
  }
  const wanted = [...new Set([...add, ...(lead ? [lead.userId] : [])])];
  if (wanted.length) {
    const live = await prisma.user.count({ where: { id: { in: wanted }, organizationId: a.organizationId, deletedAt: null } });
    if (live !== wanted.length) return NextResponse.json({ error: "not_in_org", key: "add" }, { status: 400, headers: NO_STORE });
  }
  try {
    await prisma.$transaction(async (tx) => {
      for (const c of archivedClashes) {
        // Guarded on archivedAt: if another Admin revived this team a moment
        // ago it is live again and keeps its name, and this rename loses with
        // the same 409 a live clash gives.
        const freed = await tx.team.updateMany({ where: { id: c.id, organizationId: a.organizationId, archivedAt: { not: null } }, data: { name: freedArchivedName(c.name, c.id) } });
        if (freed.count === 0) throw Object.assign(new Error("archived team revived during rename"), { code: "P2002" });
      }
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
    metadata: { add, remove, lead: lead ?? null, name: name ?? null, ...(archivedClashes.length ? { freedArchivedTeamIds: archivedClashes.map((c) => c.id) } : {}) },
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
