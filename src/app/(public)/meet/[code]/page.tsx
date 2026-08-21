// Public guest door for a WorkwrK meeting call. The signed code in the URL is
// the only credential: external guests and AI notetaker bots open this page
// (no account, no login) and land in the same Jitsi room as the internal
// attendees. Invalid or tampered codes 404 — meeting titles never leak.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyMeetingGuestCode, meetingRoomName } from "@/lib/meeting-room";
import { GuestCallClient } from "./guest-call-client";

export default async function GuestMeetingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const meetingId = verifyMeetingGuestCode(decodeURIComponent(code));
  if (!meetingId) notFound();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, title: true, scheduledAt: true, duration: true, organization: { select: { name: true } } },
  });
  if (!meeting) notFound();

  return (
    <GuestCallClient
      room={meetingRoomName(meeting.id)}
      title={meeting.title}
      orgName={meeting.organization.name}
      scheduledAt={meeting.scheduledAt.toISOString()}
    />
  );
}
