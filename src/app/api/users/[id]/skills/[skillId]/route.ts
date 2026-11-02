// PATCH /api/users/[id]/skills/[skillId] { selfRating?, managerRating? } and
// DELETE. The person writes their own self rating and removes their own
// skills; the reporting chain, the People team, the org-wide levels and
// Admins write the manager rating (never on their own record); an Admin may
// also remove a skill from anyone.
//
// THE MANAGER RATING IS THIS WORKSPACE'S (docs/plans/workspace-status.md, the
// final review, security M2; src/lib/people/skill-ratings.ts): the write
// sets only this workspace's key of managerRatings, and every other
// workspace's rating stays exactly as it was. The row is read and written
// with its updatedAt as the guard, so a write another workspace (or the
// person) made a moment before is never lost: the write is made again on
// the row as it is now, and after three clashes the answer asks to try again.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { staleTabRefusal } from "@/lib/access/tab-workspace-check";
import { isRating } from "@/lib/people/skills-aggregate";
import { ratingHere, withRatingHere } from "@/lib/people/skill-ratings";

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
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  const { id, skillId } = await params;
  if (!(await load(id, skillId, ctx.organizationId))) return err(404, "Not found");
  const relation = relationTo(ctx, id);
  if (relation === "none") return err(404, "Not found");
  const body = (await req.json().catch(() => null)) as { selfRating?: unknown; managerRating?: unknown } | null;
  if (!body) return err(400, "Send a JSON object");
  const data: { selfRating?: number } = {};
  let rating: { value: number | null } | null = null;
  if (body.selfRating !== undefined) {
    if (relation !== "self") return err(403, "Only the person rates themselves.", { code: "field_forbidden", fields: ["selfRating"] });
    if (!isRating(body.selfRating)) return err(400, "A rating is 1 to 5", { field: "selfRating" });
    data.selfRating = body.selfRating;
  }
  if (body.managerRating !== undefined) {
    if (relation === "self") return err(403, "Your manager or the People team gives the manager rating.", { code: "field_forbidden", fields: ["managerRating"] });
    // A dotted-line manager (or a report's manager below manager tier) reads
    // the record but rates nothing, the same door as every other write here.
    if (relation === "chain-view") return err(403, "Their manager or the People team gives the manager rating.", { code: "field_forbidden", fields: ["managerRating"] });
    if (body.managerRating !== null && !isRating(body.managerRating)) return err(400, "A rating is 1 to 5", { field: "managerRating" });
    rating = { value: body.managerRating as number | null };
  }
  if (Object.keys(data).length === 0 && !rating) return err(400, "Nothing to change");
  // Only this workspace's key of the ratings (see the header), on the row as it is now.
  for (let attempt = 0; ; attempt += 1) {
    const now = await prisma.userSkill.findUnique({ where: { id: skillId }, select: { managerRatings: true, updatedAt: true } });
    if (!now) return err(404, "Not found");
    const n = await prisma.userSkill.updateMany({
      where: { id: skillId, updatedAt: now.updatedAt },
      data: { ...data, ...(rating ? { managerRatings: withRatingHere(now.managerRatings, ctx.organizationId, rating.value) } : {}), updatedAt: new Date() },
    });
    if (n.count === 1) break;
    if (attempt >= 2) return err(409, "Someone else changed this skill at the same moment. Try again.", { code: "skill_changed" });
  }
  const skill = await prisma.userSkill.findUnique({ where: { id: skillId }, select: { id: true, name: true, selfRating: true, managerRatings: true } });
  if (!skill) return err(404, "Not found");
  return NextResponse.json({ id: skill.id, name: skill.name, selfRating: skill.selfRating, managerRating: ratingHere(skill.managerRatings, ctx.organizationId) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; skillId: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  const { id, skillId } = await params;
  if (!(await load(id, skillId, ctx.organizationId))) return err(404, "Not found");
  const relation = relationTo(ctx, id);
  if (!(relation === "self" || relation === "admin")) return err(403, "Only the person or an Admin removes a skill.");
  await prisma.userSkill.delete({ where: { id: skillId } });
  return NextResponse.json({ ok: true });
}
