import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

const ALLOWED_EMOJIS = new Set([
  "🙌", "🔥", "💚", "💯", "🎯", "👏", "🪔", "❤️", "🚀", "✨", "💪", "🎉",
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id: kudosId } = await params;

  const body = await req.json().catch(() => ({}));
  const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
  if (!emoji || !ALLOWED_EMOJIS.has(emoji)) {
    return jsonError("Invalid emoji");
  }

  const kudos = await prisma.kudos.findFirst({
    where: { id: kudosId, organizationId: orgId },
    select: { id: true, receiverId: true, giverId: true, message: true },
  });
  if (!kudos) return jsonError("Kudos not found", 404);

  const existing = await prisma.kudosReaction.findUnique({
    where: { kudosId_userId_emoji: { kudosId, userId, emoji } },
    select: { id: true },
  });

  let added: boolean;
  if (existing) {
    await prisma.kudosReaction.delete({ where: { id: existing.id } });
    added = false;
  } else {
    await prisma.kudosReaction.create({
      data: { kudosId, userId, emoji },
    });
    added = true;

    if (kudos.receiverId !== userId) {
      const reactor = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const reactorName = reactor ? `${reactor.firstName} ${reactor.lastName}` : "Someone";
      await prisma.notification.create({
        data: {
          title: "New reaction on your kudos",
          message: `${reactorName} reacted ${emoji} to: "${kudos.message.slice(0, 60)}"`,
          type: "KUDOS",
          link: "/dashboard/kudos",
          userId: kudos.receiverId,
        },
      }).catch(() => {});
    }
  }

  const [reactions, counts] = await Promise.all([
    prisma.kudosReaction.findMany({
      where: { kudosId },
      select: { id: true, emoji: true, userId: true },
    }),
    prisma.kudosReaction.groupBy({
      by: ["emoji"],
      where: { kudosId },
      _count: { emoji: true },
    }),
  ]);

  return jsonSuccess({
    added,
    emoji,
    total: reactions.length,
    byEmoji: counts.map((c) => ({ emoji: c.emoji, count: c._count.emoji })),
    myReactions: reactions.filter((r) => r.userId === userId).map((r) => r.emoji),
  });
}
