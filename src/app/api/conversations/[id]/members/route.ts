import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Add people to a group or channel. Any current member can add;
// DMs never grow (start a group instead). New members see the full
// history — same model as Slack.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-talk");
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const membership = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId, conversation: { organizationId: orgId } },
    select: { id: true, conversation: { select: { type: true } } },
  });
  if (!membership) return jsonError("Conversation not found", 404);
  if (membership.conversation.type === "DM") {
    return jsonError("Direct messages can't grow — start a group chat instead", 400);
  }

  const body = await req.json().catch(() => null);
  const rawIds: unknown = body?.userIds;
  const userIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  if (userIds.length === 0) return jsonError("Pick at least one person", 400);
  if (userIds.length > 50) return jsonError("Too many people at once", 400);

  const valid = await prisma.user.count({
    where: { id: { in: userIds }, organizationId: orgId, deletedAt: null },
  });
  if (valid !== userIds.length) return jsonError("Some people could not be added", 400);

  const notifyLevel = membership.conversation.type === "CHANNEL" ? "mentions" : "all";
  const result = await prisma.conversationMember.createMany({
    data: userIds.map((uid) => ({ conversationId: id, userId: uid, notifyLevel })),
    skipDuplicates: true,
  });

  return jsonSuccess({ added: result.count });
}
