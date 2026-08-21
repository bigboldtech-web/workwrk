import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Self-service join — CHANNELS ONLY. Org channels are open to everyone
// in the org; DMs and groups stay invite-only (members add people).

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const channel = await prisma.conversation.findFirst({
    where: { id, organizationId: getOrgId(session), type: "CHANNEL" },
    select: { id: true },
  });
  if (!channel) return jsonError("Channel not found", 404);

  // Channel memberships default to mention-only bells (Slack parity);
  // unread badges still count everything.
  await prisma.conversationMember.createMany({
    data: [{ conversationId: id, userId, notifyLevel: "mentions" }],
    skipDuplicates: true,
  });

  return jsonSuccess({ ok: true });
}
