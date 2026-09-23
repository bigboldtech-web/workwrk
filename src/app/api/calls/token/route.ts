// POST /api/calls/token — mint a LiveKit access token for a call room
// (docs/plans/native-calls.md Phase 1). The ONLY door to the media
// server: access is checked HERE, LiveKit trusts the JWT. For a chat
// call that check is the Talk gate, the same one the Call button asked
// before it rendered; for a meeting it is the meeting's own org scope.
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
import { requireConversation } from "@/lib/talk-gate";
import { canCall } from "@/lib/talk-access";
import { chatRoomName, meetingRoomName } from "@/lib/meeting-room";
import { ensureCallSession } from "@/lib/call-session";

function callsConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

export async function POST(req: NextRequest) {
  // This route is dual-purpose: a chat call (conversationId) belongs to the
  // Talk MODULE, but a meeting call (meetingId) is the CORE Calendar feature.
  // So gate only the chat branch below — never the whole route, or an org with
  // Talk off couldn't join a scheduled meeting's video.
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
    // Chat call → the Talk gate decides, exactly as the Call button did.
    // It carries the module check (same 403 body this branch used to write
    // itself), so an org with Talk off still can't open a chat call while a
    // scheduled meeting's video is untouched.
    //
    // This used to be a bare conversationMember.findFirst, and that asked the
    // wrong question in both directions:
    //
    //   * Too narrow. A Full holder with no membership row, meaning an Owner
    //     or Admin on a public channel or its creator after they used Leave,
    //     is admitted by talkRole() and so sees the Call button and can post
    //     the "Started a call" card, but had no row here and got a 404. The
    //     one person locked out of the call was the person who started it.
    //   * Too wide. Archive froze posting, reacting, adding people and the
    //     guest link, and stopped at the call layer: any remaining member of
    //     an archived channel could still mint a publishing grant inside a
    //     conversation the product presents as frozen. canCall() says no, and
    //     now this says no with it.
    const { error: gateError, ctx } = await requireConversation(conversationId, {
      floor: "edit",
      allow: canCall,
      what: "call here",
    });
    if (gateError) return gateError;
    room = chatRoomName(conversationId, ctx.conversation.callEpoch);
    // The tile name is this viewer's own, and the session already carries it,
    // so there is no row to join for it now the membership lookup is gone.
    const me = session.user as { firstName?: string; lastName?: string };
    displayName = `${me.firstName ?? ""} ${me.lastName ?? ""}`.trim() || displayName;
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
