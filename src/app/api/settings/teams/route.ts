// GET  /api/settings/teams   the workspace's Teams with their people
// POST /api/settings/teams   { name, description? } make one (Owner and Admin)
//
// Settings > Members > Teams (access-model-spec 3.4, Phase 8 stage E). A Team
// is a named group of people. Reading is for the people who open Members;
// making and changing Teams is Owner and Admin. Every change is audited
// (team.created, team.updated, team.members_changed, team.archived).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { issueKey } from "@/lib/zod-issue-key";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { settingsDoorAllows } from "@/lib/access/settings-door";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const createSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(280).optional() }).strict();

export async function GET() {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (!(await settingsDoorAllows("members", session))) return NextResponse.json({ error: "no_access", page: "members" }, { status: 403, headers: NO_STORE });
  const teams = await prisma.team.findMany({
    where: { organizationId: orgId, archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      members: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true, deletedAt: true, organizationId: true } } },
      },
    },
  });
  return NextResponse.json(
    {
      canEdit: sessionIsWorkspaceAdmin(session),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        members: t.members
          .filter((m) => m.user.deletedAt === null && m.user.organizationId === orgId)
          .map((m) => ({ id: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email, avatar: m.user.avatar, lead: m.lead })),
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (!sessionIsWorkspaceAdmin(session)) return NextResponse.json({ error: "no_access", page: "members" }, { status: 403, headers: NO_STORE });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const key = issueKey(parsed.error.issues[0]);
    return NextResponse.json({ error: "invalid_body", key }, { status: 400, headers: NO_STORE });
  }
  const clash = await prisma.team.findFirst({ where: { organizationId: u.organizationId, name: { equals: parsed.data.name, mode: "insensitive" } }, select: { id: true, archivedAt: true } });
  if (clash && !clash.archivedAt) return NextResponse.json({ error: "name_taken", key: "name" }, { status: 409, headers: NO_STORE });
  // Reusing an archived Team's name revives that row EMPTY: its old members
  // are not carried back in unseen (the answer says members: [] and that is
  // the truth). The ids that were on it go on the activity row.
  let former: string[] = [];
  let team: { id: string; name: string; description: string | null };
  try {
    team = clash
      ? await prisma.$transaction(async (tx) => {
          const rows = await tx.teamMember.findMany({ where: { teamId: clash.id }, select: { userId: true } });
          former = rows.map((r) => r.userId);
          await tx.teamMember.deleteMany({ where: { teamId: clash.id } });
          return tx.team.update({ where: { id: clash.id }, data: { archivedAt: null, description: parsed.data.description ?? null } });
        })
      : await prisma.team.create({ data: { organizationId: u.organizationId, name: parsed.data.name, description: parsed.data.description ?? null, createdById: u.id } });
  } catch (err) {
    // Two Admins making the same name at once: the unique index answers the
    // loser, and the loser gets the same 409 the clash check gives.
    if ((err as { code?: string } | null)?.code === "P2002") return NextResponse.json({ error: "name_taken", key: "name" }, { status: 409, headers: NO_STORE });
    throw err;
  }
  await logActivity({
    organizationId: u.organizationId,
    actorId: u.id,
    type: "team.created",
    targetType: "Team",
    targetId: team.id,
    description: clash ? `Made the team ${team.name} again (an archived team's name; it starts empty)` : `Created the team ${team.name}`,
    ...(former.length ? { metadata: { revived: true, formerMemberIds: former } } : {}),
  }).catch(() => {});
  return NextResponse.json({ team: { id: team.id, name: team.name, description: team.description, members: [] } }, { status: 201, headers: NO_STORE });
}
