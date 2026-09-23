// POST /api/calls/guest-token — the public door's exchange (native-calls
// Phase 3). NO auth: the signed code in the body IS the credential,
// exactly like the /meet/[code] page it serves. Body: { code, name }.
// Meeting codes ("<id>.<sig>") and chat call codes ("c.<id>.<epoch>.
// <sig>") both work; a rotated-away call epoch is a dead link.
// Guests can publish (talk, share) but hold no admin rights, and their
// identity is a random guest id — never a WorkwrK user id.

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { chatRoomName, guestCodeExpired, meetingRoomName, verifyChatGuestCode, verifyMeetingGuestCode } from "@/lib/meeting-room";
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
    // Past its own expiry is 410, not 404: the link was real and it is over,
    // which is a different thing from a tampered or rotated code. Chat guest
    // links live 24h from the moment a member copied one.
    if (guestCodeExpired(chat.expiresAt)) {
      return jsonError("This link has expired", 410);
    }
    room = chatRoomName(conversation.id, conversation.callEpoch);
    organizationId = conversation.organizationId;
    conversationId = conversation.id;
  } else {
    const meetingCode = verifyMeetingGuestCode(code);
    if (!meetingCode) return jsonError("This link is no longer valid", 404);
    // The expiry is signed INTO the code now, so it cannot be forgotten by a
    // call site. 410, not 404: the link was real and it is over.
    if (guestCodeExpired(meetingCode.expiresAt)) {
      return jsonError("This link has expired", 410);
    }
    // deletedAt is part of the revocation, not a display filter.
    const meeting = await prisma.meeting.findFirst({
      where: { id: meetingCode.meetingId, deletedAt: null },
      select: { id: true, organizationId: true, scheduledAt: true, duration: true },
    });
    if (!meeting) return jsonError("This link is no longer valid", 404);
    // A LEGACY code (minted before the expiry shipped, inside its 7-day
    // grace) carries no exp of its own, so the old route-side rule still
    // applies to it: dead 24 hours after the meeting's start. Nothing minted
    // from today reaches this branch.
    if (meetingCode.expiresAt === null && Date.now() > meeting.scheduledAt.getTime() + 24 * 3600_000) {
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
