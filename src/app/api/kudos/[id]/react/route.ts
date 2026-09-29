import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";
import { parseReactionRequest, reactionWrite } from "@/lib/kudos-reaction";

// POST /api/kudos/[id]/react. Body { emoji, on }: on true adds my reaction,
// on false removes it, and sending the same state again changes nothing, so
// a Try again after a save that landed but answered with an error can never
// undo it. A body without `on` (an older client) still toggles.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id: kudosId } = await params;
  // A Guest never sees kudos (GET, POST and DELETE all answer Not found), so
  // reacting must not be the one door that confirms a kudos exists and shows
  // who reacted with what.
  const viewer = await viewerFromSession();
  if (!viewer || viewer.orgRole === "GUEST") return jsonError("Not found", 404);

  const parsed = parseReactionRequest(await req.json().catch(() => ({})));
  if (!parsed.ok) return jsonError(parsed.error);
  const { emoji, on } = parsed;

  const kudos = await prisma.kudos.findFirst({
    where: { id: kudosId, organizationId: orgId },
    select: { id: true, receiverId: true, giverId: true, message: true },
  });
  if (!kudos) return jsonError("Kudos not found", 404);

  const existing = await prisma.kudosReaction.findUnique({
    where: { kudosId_userId_emoji: { kudosId, userId, emoji } },
    select: { id: true },
  });

  const write = reactionWrite(!!existing, on);
  let created = false;
  let changed = false;
  if (write === "delete") {
    // deleteMany, not delete: a second tab (or a retry) that removed it a
    // moment earlier leaves nothing to delete, which is the state asked for,
    // not a 500.
    const removed = await prisma.kudosReaction.deleteMany({ where: { kudosId, userId, emoji } });
    changed = removed.count > 0;
  } else if (write === "create") {
    try {
      await prisma.kudosReaction.create({ data: { kudosId, userId, emoji } });
      created = true;
      changed = true;
    } catch (e) {
      // Two sends of the same add racing each other: the unique index let
      // one through, and the reaction exists, which is what both asked for.
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }

  // Only a reaction this request really made tells the receiver, so a
  // repeated add never sends a second notification.
  if (created && kudos.receiverId !== userId) {
    const reactor = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const reactorName = reactor ? `${reactor.firstName} ${reactor.lastName}` : "Someone";
    await prisma.notification.create({
      data: {
        title: "New reaction on your kudos",
        message: `${reactorName} reacted ${emoji} to: "${kudos.message.slice(0, 60)}"`,
        type: "kudos",
        // There is no /dashboard/kudos directory and there never was, so
        // every reaction notification written before this line pointed at a
        // hard 404. The real page is /kudos.
        link: "/kudos",
        userId: kudos.receiverId,
      },
    }).catch(() => {});
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

  const mine = reactions.filter((r) => r.userId === userId).map((r) => r.emoji);
  const isOn = mine.includes(emoji);
  return jsonSuccess({
    // `added` kept for older clients: whether my reaction is on now.
    added: isOn,
    on: isOn,
    changed,
    emoji,
    total: reactions.length,
    byEmoji: counts.map((c) => ({ emoji: c.emoji, count: c._count.emoji })),
    myReactions: mine,
  });
}
