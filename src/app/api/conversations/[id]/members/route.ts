import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requireConversation } from "@/lib/talk-gate";
import { canAddPeople } from "@/lib/talk-access";

// Add people to a group or channel. On a public channel any member may add;
// on a private channel or a group it takes Full access, and an archived
// conversation takes nobody. DMs never grow (start a group instead). New
// members see the full history, the same model as Slack.
//
// canAddPeople is that whole rule, and it is the same function the page
// reads to decide whether to draw the control.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error, ctx } = await requireConversation(id, { floor: "edit", allow: canAddPeople, what: "add people here" });
  if (error) return error;
  if (ctx.conversation.type === "DM") {
    return jsonError("Direct messages can't grow. Start a group chat instead.", 400);
  }

  const body = await req.json().catch(() => null);
  const rawIds: unknown = body?.userIds;
  const userIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  if (userIds.length === 0) return jsonError("Pick at least one person", 400);
  if (userIds.length > 50) return jsonError("Too many people at once", 400);

  const valid = await prisma.user.count({
    where: { id: { in: userIds }, organizationId: ctx.gate.organizationId, deletedAt: null },
  });
  if (valid !== userIds.length) return jsonError("Some people could not be added", 400);

  const notifyLevel = ctx.conversation.type === "CHANNEL" ? "mentions" : "all";
  const result = await prisma.conversationMember.createMany({
    data: userIds.map((uid) => ({ conversationId: id, userId: uid, notifyLevel })),
    skipDuplicates: true,
  });

  return jsonSuccess({ added: result.count });
}
