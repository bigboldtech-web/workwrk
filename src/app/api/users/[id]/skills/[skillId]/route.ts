// PATCH /api/users/[id]/skills/[skillId] { selfRating?, managerRating? } and
// DELETE. The person writes their own self rating and removes their own
// skills; the reporting chain, the People team, the org-wide levels and
// Admins write the manager rating (never on their own record); an Admin may
// also remove a skill from anyone.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { isRating } from "@/lib/people/skills-aggregate";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

async function load(id: string, skillId: string, organizationId: string) {
  return prisma.userSkill.findFirst({
    where: { id: skillId, userId: id, user: { organizationId } },
    select: { id: true, userId: true },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; skillId: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  const { id, skillId } = await params;
  if (!(await load(id, skillId, ctx.organizationId))) return err(404, "Not found");
  const relation = relationTo(ctx, id);
  if (relation === "none") return err(404, "Not found");
  const body = (await req.json().catch(() => null)) as { selfRating?: unknown; managerRating?: unknown } | null;
  if (!body) return err(400, "Send a JSON object");
  const data: { selfRating?: number; managerRating?: number | null } = {};
  if (body.selfRating !== undefined) {
    if (relation !== "self") return err(403, "Only the person rates themselves.", { code: "field_forbidden", fields: ["selfRating"] });
    if (!isRating(body.selfRating)) return err(400, "A rating is 1 to 5", { field: "selfRating" });
    data.selfRating = body.selfRating;
  }
  if (body.managerRating !== undefined) {
    if (relation === "self") return err(403, "Your manager or the People team gives the manager rating.", { code: "field_forbidden", fields: ["managerRating"] });
    if (body.managerRating !== null && !isRating(body.managerRating)) return err(400, "A rating is 1 to 5", { field: "managerRating" });
    data.managerRating = body.managerRating as number | null;
  }
  if (Object.keys(data).length === 0) return err(400, "Nothing to change");
  const skill = await prisma.userSkill.update({ where: { id: skillId }, data, select: { id: true, name: true, selfRating: true, managerRating: true } });
  return NextResponse.json(skill);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; skillId: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  const { id, skillId } = await params;
  if (!(await load(id, skillId, ctx.organizationId))) return err(404, "Not found");
  const relation = relationTo(ctx, id);
  if (!(relation === "self" || relation === "admin")) return err(403, "Only the person or an Admin removes a skill.");
  await prisma.userSkill.delete({ where: { id: skillId } });
  return NextResponse.json({ ok: true });
}
