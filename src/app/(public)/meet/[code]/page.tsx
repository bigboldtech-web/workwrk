// Public guest door for WorkwrK calls. The signed code in the URL is
// the only credential: external guests and AI notetaker bots open this
// page (no account, no login) and land in the same room as the internal
// attendees, scheduled meetings ("<id>.<sig>" codes) and live Room
// chat calls ("c.<id>.<epoch>.<exp>.<sig>" codes) both. Invalid, tampered,
// rotated-away and expired codes all 404, so titles never leak. Codes minted
// before guest-link expiry shipped carry no exp and keep working through
// their 7-day grace (src/lib/meeting-room.ts).

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { guestCodeExpired, verifyChatGuestCode, verifyMeetingGuestCode } from "@/lib/meeting-room";
import { GuestCallClient } from "./guest-call-client";

/**
 * Is there a media server at all?
 *
 * Read HERE, on the server, and handed down, so the door can be honest
 * BEFORE the click: spec-talk section 2.5 asks for the sentence and no
 * button when calls are unconfigured. Until now the card rendered a blue
 * "Join call" on a deployment with nothing behind it, and the guest found
 * out by pressing it. The three variables are the same three
 * /api/calls/guest-token checks, which is the one that answers 503.
 */
function callsConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

export default async function GuestMeetingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const chat = verifyChatGuestCode(code);
  if (chat) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: chat.conversationId },
      select: { id: true, name: true, type: true, callEpoch: true, organization: { select: { name: true } } },
    });
    if (!conversation || conversation.callEpoch !== chat.epoch) notFound();
    // An expired link never names the conversation: an outsider holding a
    // dead code learns nothing about what it used to open.
    if (guestCodeExpired(chat.expiresAt)) notFound();
    const title = conversation.type === "CHANNEL"
      // Naming canon (spec-talk section 1): a real-time voice or video
      // session is a "call". Never "huddle", which was Slack's word and was
      // the only place it still showed to a person.
      ? `#${conversation.name ?? "channel"} call`
      : conversation.name ? `${conversation.name} call` : "Team call";
    return (
      <GuestCallClient
        code={code}
        title={title}
        orgName={conversation.organization.name}
        scheduledAt={null}
        configured={callsConfigured()}
      />
    );
  }

  const meetingId = verifyMeetingGuestCode(code);
  if (!meetingId) notFound();

  // A DELETED meeting's guest link must stop resolving. The code is a
  // permanent HMAC of the meeting id, so the row is the only revocation
  // there is: if this read ignored deletedAt, anyone holding a link minted
  // before the delete could still read the meeting title and the
  // organization name, and still mint a guest token.
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, deletedAt: null },
    select: { id: true, title: true, scheduledAt: true, organization: { select: { name: true } } },
  });
  if (!meeting) notFound();

  return (
    <GuestCallClient
      code={code}
      title={meeting.title}
      orgName={meeting.organization.name}
      scheduledAt={meeting.scheduledAt.toISOString()}
      configured={callsConfigured()}
    />
  );
}
