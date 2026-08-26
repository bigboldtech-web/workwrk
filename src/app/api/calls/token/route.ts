// POST /api/calls/token — mint a LiveKit access token for a call room
// (docs/plans/native-calls.md Phase 1). The ONLY door to the media
// server: membership is checked HERE, LiveKit trusts the JWT.
//
// Body: { conversationId } XOR { meetingId }.
// Returns { url, token, room } — or 503 while the calls box isn't
// configured yet, which the client reads as "fall back to Jitsi".
// callEpoch rides the room name, so a member leaving a conversation
// still rotates its room and orphans old guest links.

import { NextRequest } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { chatRoomName, meetingRoomName } from "@/lib/meeting-room";
import { ensureCallSession } from "@/lib/call-session";

function callsConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  if (!callsConfigured()) return jsonError("Native calls not configured", 503);

  const body = await req.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
  const meetingId = typeof body?.meetingId === "string" ? body.meetingId : null;
  if (!conversationId === !meetingId) return jsonError("Pass conversationId or meetingId", 400);

  let room: string;
  let displayName = "Member";

  if (conversationId) {
    const membership = await prisma.conversationMember.findFirst({
      where: { conversationId, userId, conversation: { organizationId: orgId } },
      select: { conversation: { select: { callEpoch: true } }, user: { select: { firstName: true, lastName: true } } },
    });
    if (!membership) return jsonError("Conversation not found", 404);
    room = chatRoomName(conversationId, membership.conversation.callEpoch);
    displayName = `${membership.user.firstName} ${membership.user.lastName}`.trim();
  } else {
    const attendee = await prisma.meetingAttendee.findFirst({
      where: { meetingId: meetingId!, userId, meeting: { organizationId: orgId } },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    // Meeting creator may not be an attendee row — allow any org member
    // to join org meetings they can open (same visibility the meeting
    // page itself enforces via its org-scoped GET).
    if (!attendee) {
      const meeting = await prisma.meeting.findFirst({
        where: { id: meetingId!, organizationId: orgId },
        select: { id: true },
      });
      if (!meeting) return jsonError("Meeting not found", 404);
      const me = await prisma.user.findFirst({ where: { id: userId }, select: { firstName: true, lastName: true } });
      displayName = me ? `${me.firstName} ${me.lastName}`.trim() : displayName;
    } else {
      displayName = `${attendee.user.firstName} ${attendee.user.lastName}`.trim();
    }
    room = meetingRoomName(meetingId!);
  }

  // Presence mapping: room names are HMAC-derived and irreversible, so
  // THIS is where a live CallSession learns which conversation/meeting a
  // room belongs to — and where stale/abandoned sessions self-heal.
  try {
    await ensureCallSession({ organizationId: orgId, roomName: room, conversationId, meetingId });
  } catch (e) { console.error("call session record failed", e); }

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: userId,
    name: displayName,
    ttl: "2h",
  });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });

  return jsonSuccess({ url: process.env.LIVEKIT_URL, token: await at.toJwt(), room });
}
