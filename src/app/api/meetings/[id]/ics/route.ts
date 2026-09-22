// One meeting as an .ics file.
//
// This is the "Add to my calendar" row of the meeting page's "..." menu
// (spec-planner.md section 2 /meetings/[id]). The spec writes it as "Add to
// my Google Calendar"; a downloaded .ics is the honest version of that,
// because it works in Google Calendar, Apple Calendar and Outlook alike and
// needs no OAuth connection the organization may not have made. Workwrk
// already renders iCalendar for the subscription feed
// (src/services/icalExport.ts), so this is that renderer over one row.
//
// ACCESS IS THE SAME QUESTION THE PAGE ASKS. The file carries the meeting's
// title, time and agenda, so it goes through src/lib/meeting-access.ts like
// every other read of this object: you attend it, you created it, or you are
// an Owner or an Admin. Anything else is a 404, never a 403, because a
// meeting you are not in should not confirm that it exists (rule 14).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isOrgAdmin } from "@/lib/api-helpers";
import { canReadMeeting } from "@/lib/meeting-access";
import { renderICalendar } from "@/services/icalExport";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;

  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId: getOrgId(session), deletedAt: null },
    select: {
      id: true,
      title: true,
      agenda: true,
      scheduledAt: true,
      duration: true,
      createdById: true,
      updatedAt: true,
      attendees: { select: { userId: true } },
    },
  });
  if (!meeting) return new Response("Meeting not found", { status: 404 });

  const allowed = canReadMeeting({
    viewerId: getUserId(session),
    isOrgAdmin: isOrgAdmin(session),
    createdById: meeting.createdById,
    attendeeIds: meeting.attendees.map((a) => a.userId),
  });
  if (!allowed) return new Response("Meeting not found", { status: 404 });

  const base = process.env.NEXTAUTH_URL ?? "";
  const body = renderICalendar(
    [{
      kind: "meeting",
      id: meeting.id,
      title: meeting.title || "Untitled meeting",
      description: meeting.agenda,
      startAt: meeting.scheduledAt,
      // `duration` is minutes and is always set; the fallback keeps a row
      // written by an older client from producing a zero-length event.
      endAt: new Date(meeting.scheduledAt.getTime() + (meeting.duration || 30) * 60_000),
      updatedAt: meeting.updatedAt,
      url: base ? `${base}/meetings/${meeting.id}` : undefined,
    }],
    { calendarName: meeting.title || "Meeting" },
  );

  // A filename with no spaces or punctuation, so every operating system and
  // every mail client keeps it intact.
  const safe = (meeting.title || "meeting").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "meeting";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
