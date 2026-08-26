// POST /api/calls/guest-token — the public door's exchange (native-calls
// Phase 3). NO auth: the signed code in the body IS the credential,
// exactly like the /meet/[code] page it serves. Body: { code, name }.
// Meeting codes ("<id>.<sig>") and Room-huddle codes ("c.<id>.<epoch>.
// <sig>") both work; a rotated-away huddle epoch is a dead link.
// Guests can publish (talk, share) but hold no admin rights, and their
// identity is a random guest id — never a WorkwrK user id.

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { chatRoomName, meetingRoomName, verifyChatGuestCode, verifyMeetingGuestCode } from "@/lib/meeting-room";
import { ensureCallSession } from "@/lib/call-session";

export async function POST(req: NextRequest) {
  if (!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)) {
    return jsonError("Native calls not configured", 503);
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!code) return jsonError("Missing code", 400);
  if (!name) return jsonError("Tell us your name first", 400);

  let room: string | null = null;
  let organizationId: string | null = null;
  let conversationId: string | null = null;
  let meetingId: string | null = null;

  const chat = verifyChatGuestCode(code);
  if (chat) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: chat.conversationId },
      select: { id: true, organizationId: true, callEpoch: true },
    });
    // Epoch mismatch = the link was rotated away (a member left). Dead.
    if (!conversation || conversation.callEpoch !== chat.epoch) return jsonError("This link is no longer valid", 404);
    room = chatRoomName(conversation.id, conversation.callEpoch);
    organizationId = conversation.organizationId;
    conversationId = conversation.id;
  } else {
    const mid = verifyMeetingGuestCode(code);
    if (!mid) return jsonError("This link is no longer valid", 404);
    const meeting = await prisma.meeting.findUnique({
      where: { id: mid },
      select: { id: true, organizationId: true, scheduledAt: true },
    });
    if (!meeting) return jsonError("This link is no longer valid", 404);
    // Meeting guest links die 24h after the meeting's start — a leaked
    // link from last month must not let a stranger lurk in future calls
    // that happen to reuse the meeting page. (Members are unaffected.)
    if (Date.now() > meeting.scheduledAt.getTime() + 24 * 3600_000) {
      return jsonError("This link has expired", 410);
    }
    room = meetingRoomName(meeting.id);
    organizationId = meeting.organizationId;
    meetingId = meeting.id;
  }

  // Presence: guests join the same live session members see.
  try {
    await ensureCallSession({ organizationId, roomName: room, conversationId, meetingId });
  } catch (e) { console.error("guest call session record failed", e); }

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: `guest-${randomBytes(6).toString("hex")}`,
    name: `${name} (guest)`,
    ttl: "4h",
  });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });

  return jsonSuccess({ url: process.env.LIVEKIT_URL, token: await at.toJwt(), room });
}
