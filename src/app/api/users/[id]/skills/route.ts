// POST /api/users/[id]/skills { name, selfRating }: the write path the
// Skills page never had (spec-teams-people /people/skills, PO-5). The person
// adds their own; the People team and Admins may add for anyone. A name the
// person already holds, in any capitalisation, is a 409, never a second row.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { cleanSkillName, isRating } from "@/lib/people/skills-aggregate";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const { id } = await params;
  const subject = await prisma.user.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } });
  if (!subject) return err(404, "Not found");
  const relation = relationTo(ctx, id);
  if (!(relation === "self" || relation === "admin" || relation === "people-team")) {
    return err(403, "People add skills to their own record.");
  }
  const body = (await req.json().catch(() => null)) as { name?: unknown; selfRating?: unknown } | null;
  const name = cleanSkillName(body?.name);
  if (!name) return err(400, "A skill name is 1 to 60 characters", { field: "name" });
  const selfRating = body?.selfRating == null ? 0 : body.selfRating;
  if (selfRating !== 0 && !isRating(selfRating)) return err(400, "A rating is 1 to 5", { field: "selfRating" });
  const dup = await prisma.userSkill.findFirst({ where: { userId: id, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (dup) return err(409, "That skill is already on the record", { code: "duplicate", skillId: dup.id });
  // Only the person rates themselves; an admin adding for someone leaves the
  // self rating for them.
  const skill = await prisma.userSkill.create({
    data: { userId: id, name, selfRating: relation === "self" ? (selfRating as number) : 0 },
    select: { id: true, name: true, selfRating: true, managerRating: true },
  });
  return NextResponse.json(skill, { status: 201 });
}
