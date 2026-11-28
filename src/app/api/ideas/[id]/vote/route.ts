import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { allOwned } from "@/lib/access/company-wall";

// POST: Toggle vote on an idea
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: ideaId } = await params;
  const userId = getUserId(session);
  // The company wall (pen test 2026-11-28, V-06): a vote on another
  // company's idea was written, and its count handed back.
  if (!(await allOwned("idea", [ideaId], getOrgId(session)))) return jsonError("Idea not found", 404);

  const existing = await prisma.ideaVote.findUnique({
    where: { ideaId_userId: { ideaId, userId } },
  });

  if (existing) {
    await prisma.ideaVote.delete({ where: { id: existing.id } });
    const count = await prisma.ideaVote.count({ where: { ideaId } });
    return jsonSuccess({ voted: false, count });
  } else {
    await prisma.ideaVote.create({ data: { ideaId, userId } });
    const count = await prisma.ideaVote.count({ where: { ideaId } });
    return jsonSuccess({ voted: true, count });
  }
}
