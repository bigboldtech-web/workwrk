import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: ideaId } = await params;
  const userId = getUserId(session);
  const { content } = await req.json();

  if (!content?.trim()) return jsonError("Comment content is required");

  const comment = await prisma.ideaComment.create({
    data: { ideaId, userId, content: content.trim() },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
  });

  return jsonSuccess(comment, 201);
}
