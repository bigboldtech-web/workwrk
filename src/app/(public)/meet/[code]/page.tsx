// Public guest door for WorkwrK calls. The signed code in the URL is the only
// credential: outside guests and AI notetaker bots open this page with no
// account and no login and land in the same room as the internal attendees.
// Both kinds of code work: a scheduled meeting ("m.<id>.<exp>.<sig>") and a
// live conversation call ("c.<id>.<epoch>.<exp>.<sig>"). Codes minted before
// guest-link expiry shipped carry no exp and keep working through their 7-day
// grace (src/lib/meeting-room.ts).
//
// FOUR OUTCOMES, AND THE DIFFERENCE BETWEEN TWO OF THEM MATTERS:
//
//   * invalid, tampered or rotated-away  -> 404, no title, no org name. An
//     outsider holding a dead code learns nothing about what it used to open.
//   * EXPIRED                            -> its own page: "This link has
//     expired. Ask for a new one." The link was real and it is over, which is
//     a different fact from "this was never a link", and a person who was
//     invited deserves to know which of the two happened. It still names
//     nothing.
//   * calls not configured on this deployment -> the join card says so up
//     front and offers no button (spec-talk section 2.5). It used to render a
//     blue Join and let the guest find out by pressing it.
//   * valid -> the join card, then the stage.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { guestCodeExpired, verifyChatGuestCode, verifyMeetingGuestCode } from "@/lib/meeting-room";
import { GuestCallClient } from "./guest-call-client";
import { GuestDoorFrame, GuestDoorMessage } from "./guest-join-card";

/**
 * Is there a media server at all?
 *
 * Read HERE, on the server, and handed down, so the door can be honest BEFORE
 * the click. The three variables are the same three /api/calls/guest-token
 * checks, which is the one that answers 503.
 */
function callsConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

function Expired() {
  return (
    <GuestDoorFrame>
      <GuestDoorMessage
        title="This link has expired"
        body="Ask the person who invited you for a new one."
      />
    </GuestDoorFrame>
  );
}

export default async function GuestMeetingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const chat = verifyChatGuestCode(code);
  if (chat) {
    if (guestCodeExpired(chat.expiresAt)) return <Expired />;
    const conversation = await prisma.conversation.findUnique({
      where: { id: chat.conversationId },
      select: { id: true, name: true, type: true, callEpoch: true, organization: { select: { name: true } } },
    });
    if (!conversation || conversation.callEpoch !== chat.epoch) notFound();
    const title = conversation.type === "CHANNEL"
      // Naming canon (spec-talk section 1): a real-time voice or video session
      // is a "call". Never "huddle", which was Slack's word and was the only
      // place it still showed to a person.
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

  const meetingCode = verifyMeetingGuestCode(code);
  if (!meetingCode) notFound();
  if (guestCodeExpired(meetingCode.expiresAt)) return <Expired />;

  // deletedAt is part of the revocation, not a display filter: without it,
  // anyone holding a link minted before the delete could still read the
  // meeting title and the organization name.
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingCode.meetingId, deletedAt: null },
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
