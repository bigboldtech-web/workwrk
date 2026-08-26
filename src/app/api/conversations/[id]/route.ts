import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { chatGuestCode, chatRoomName } from "@/lib/meeting-room";

// One conversation: meta + members + the derived call room.
// Membership is the only key — non-members get 404, not 403, so
// conversation existence never leaks.

async function requireMembership(conversationId: string, userId: string, orgId: string) {
  return prisma.conversationMember.findFirst({
    where: { conversationId, userId, conversation: { organizationId: orgId } },
    select: { id: true },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const membership = await requireMembership(id, userId, getOrgId(session));
  if (!membership) return jsonError("Conversation not found", 404);

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      name: true,
      createdById: true,
      createdAt: true,
      callEpoch: true,
      members: {
        select: {
          userId: true,
          notifyLevel: true,
          user: { select: { id: true, firstName: true, lastName: true, avatar: true, email: true } },
        },
      },
    },
  });
  if (!conversation) return jsonError("Conversation not found", 404);

  const { callEpoch, ...rest } = conversation;
  const room = chatRoomName(id, callEpoch);
  // Live huddle roster for the header chip (12h staleness cap, ghost-proof).
  let activeCall: { participants: { identity: string; name: string }[]; startedAt: Date } | null = null;
  try {
    // A conversation can briefly hold several open sessions (epoch
    // rotation mid-call splits rooms) — surface the one people are
    // actually IN, not merely the newest row.
    const sessions = await prisma.callSession.findMany({
      where: { conversationId: id, endedAt: null, startedAt: { gt: new Date(Date.now() - 12 * 3600_000) } },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { participants: true, startedAt: true },
    });
    const live = sessions.find((x) => Array.isArray(x.participants) && (x.participants as unknown[]).length > 0);
    if (live) {
      activeCall = { participants: live.participants as { identity: string; name: string }[], startedAt: live.startedAt };
    }
  } catch (e) { console.error("active call lookup failed", e); }
  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  return jsonSuccess({
    ...rest,
    call: { room, guestUrl: `${base}/meet/${chatGuestCode(id, callEpoch)}` },
    activeCall,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const membership = await requireMembership(id, userId, getOrgId(session));
  if (!membership) return jsonError("Conversation not found", 404);

  const body = await req.json().catch(() => null);

  // Per-member notification level — always self-service.
  if (typeof body?.notifyLevel === "string") {
    if (!["all", "mentions", "mute"].includes(body.notifyLevel)) return jsonError("Invalid notify level", 400);
    await prisma.conversationMember.update({
      where: { id: membership.id },
      data: { notifyLevel: body.notifyLevel },
    });
  }

  // Renames apply to named conversations only — DMs derive their name.
  if (typeof body?.name === "string") {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { type: true, name: true, organizationId: true },
    });
    if (conversation?.type === "DM") return jsonError("Direct messages can't be renamed", 400);
    const name = body.name.trim().replace(/^#/, "").slice(0, 80);
    if (!name) return jsonError("Name can't be empty", 400);
    if (conversation?.type === "CHANNEL") {
      // #general is the org's seeded home channel — its name is its
      // identity (the seeder keys on it), so it can never change.
      if ((conversation.name ?? "").toLowerCase() === "general") {
        return jsonError("#general is the company channel — it can't be renamed", 400);
      }
      const clash = await prisma.conversation.findFirst({
        where: {
          organizationId: conversation.organizationId,
          type: "CHANNEL",
          name: { equals: name, mode: "insensitive" },
          id: { not: id },
        },
        select: { id: true },
      });
      if (clash) return jsonError("A channel with that name already exists", 400);
    }
    await prisma.conversation.update({ where: { id }, data: { name } });
  }

  return jsonSuccess({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const membership = await requireMembership(id, userId, getOrgId(session));
  if (!membership) return jsonError("Conversation not found", 404);

  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { type: true, name: true } });
  if (conversation?.type === "DM") return jsonError("Direct messages can't be left — mute them instead", 400);
  if (conversation?.type === "CHANNEL" && (conversation.name ?? "").toLowerCase() === "general") {
    // Everyone belongs in the company channel (Slack model) — and the
    // directory would auto-rejoin within one poll anyway, which would
    // silently wipe read state. Honest refusal beats a fake leave.
    return jsonError("Everyone's in #general — mute it instead of leaving", 400);
  }

  // Leaving = removing my membership. Messages stay (data integrity).
  // The epoch bump rotates the derived call room so the departing
  // member's captured room name can't rejoin future huddles.
  await prisma.$transaction([
    prisma.conversationMember.delete({ where: { id: membership.id } }),
    prisma.conversation.update({ where: { id }, data: { callEpoch: { increment: 1 } } }),
  ]);
  return jsonSuccess({ ok: true });
}
