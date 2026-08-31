// GET /api/calls/incoming — live incoming calls in the viewer's conversations,
// for the real-time ring watcher (so a call rings in a few seconds, not on the
// 15s notification poll). A call is "incoming" when there's an OPEN CallSession
// with a live roster, started in the last ~2 minutes, in a conversation the
// viewer belongs to (not muted, not closed), that the viewer is NOT already in.
//
// Talk-module gated. Cheap: two indexed reads plus a label fetch.

import { NextResponse } from "next/server";
import { getSessionAndModule, getOrgId, getUserId } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

const FRESH_MS = 120_000; // only ring genuinely fresh calls, not hour-old ones

type RosterEntry = { identity: string; name: string };

export async function GET() {
  const { error, session } = await getSessionAndModule("workwrk-talk");
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const memberships = await prisma.conversationMember.findMany({
    where: { userId, hidden: false, notifyLevel: { not: "mute" } },
    select: { conversationId: true },
  });
  const convoIds = memberships.map((m) => m.conversationId);
  if (convoIds.length === 0) return NextResponse.json({ calls: [] });

  const sessions = await prisma.callSession.findMany({
    where: {
      organizationId: orgId,
      conversationId: { in: convoIds },
      endedAt: null,
      startedAt: { gt: new Date(Date.now() - FRESH_MS) },
    },
    select: { conversationId: true, roomName: true, participants: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });

  // A live roster the viewer isn't already part of.
  const live = sessions.filter((s) => {
    const roster = Array.isArray(s.participants) ? (s.participants as RosterEntry[]) : [];
    return roster.length > 0 && !roster.some((p) => p.identity === userId);
  });
  if (live.length === 0) return NextResponse.json({ calls: [] });

  const convos = await prisma.conversation.findMany({
    where: { id: { in: live.map((s) => s.conversationId).filter((x): x is string => !!x) } },
    select: {
      id: true,
      type: true,
      name: true,
      members: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });
  const byId = new Map(convos.map((c) => [c.id, c]));

  const calls = live.map((s) => {
    const c = byId.get(s.conversationId as string);
    const roster = s.participants as RosterEntry[];
    const callerName = roster[0]?.name || "Someone";
    const isDM = c?.type === "DM";
    const other = isDM ? c?.members.find((m) => m.user.id !== userId)?.user : null;
    const label = isDM
      ? other ? `${other.firstName} ${other.lastName}`.trim() : callerName
      : c?.name || "a channel";
    return {
      conversationId: s.conversationId,
      roomName: s.roomName,
      callerName,
      label,
      isDM,
      startedAt: s.startedAt.toISOString(),
    };
  });

  return NextResponse.json({ calls });
}
