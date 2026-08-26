// Public guest door for WorkwrK calls. The signed code in the URL is
// the only credential: external guests and AI notetaker bots open this
// page (no account, no login) and land in the same room as the internal
// attendees — scheduled meetings ("<id>.<sig>" codes) and live Room
// huddles ("c.<id>.<epoch>.<sig>" codes) both. Invalid, tampered, or
// rotated-away codes 404 — titles never leak.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  chatRoomName, meetingRoomName, verifyChatGuestCode, verifyMeetingGuestCode,
} from "@/lib/meeting-room";
import { GuestCallClient } from "./guest-call-client";

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
    const title = conversation.type === "CHANNEL"
      ? `#${conversation.name ?? "channel"} huddle`
      : conversation.name ? `${conversation.name} huddle` : "Team huddle";
    return (
      <GuestCallClient
        code={code}
        fallbackRoom={chatRoomName(conversation.id, conversation.callEpoch)}
        title={title}
        orgName={conversation.organization.name}
        scheduledAt={null}
      />
    );
  }

  const meetingId = verifyMeetingGuestCode(code);
  if (!meetingId) notFound();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, title: true, scheduledAt: true, organization: { select: { name: true } } },
  });
  if (!meeting) notFound();

  return (
    <GuestCallClient
      code={code}
      fallbackRoom={meetingRoomName(meeting.id)}
      title={meeting.title}
      orgName={meeting.organization.name}
      scheduledAt={meeting.scheduledAt.toISOString()}
    />
  );
}
