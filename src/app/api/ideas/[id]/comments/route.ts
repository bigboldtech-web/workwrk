import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { allOwned } from "@/lib/access/company-wall";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: ideaId } = await params;
  const userId = getUserId(session);
  // The company wall (pen test 2026-11-28, V-06): a comment on another
  // company's idea was written, under the commenter's name.
  if (!(await allOwned("idea", [ideaId], getOrgId(session)))) return jsonError("Idea not found", 404);
  const body = await req.json().catch(() => ({}));
  const content = typeof body?.content === "string" ? body.content : "";

  if (!content.trim()) return jsonError("Comment content is required");

  const comment = await prisma.ideaComment.create({
    data: { ideaId, userId, content: content.trim() },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
  });

  return jsonSuccess(comment, 201);
}
