// POST /api/meetings/instant — Zoom's "New meeting" gesture (native-calls
// Phase 3). One click mints a real call with a shareable guest link, no
// scheduling form: a lightweight ADHOC Meeting row so the call has a
// home for notes and transcripts afterwards.

import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { meetingGuestCode } from "@/lib/meeting-room";

export async function POST() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const meeting = await prisma.meeting.create({
    data: {
      title: "Instant call",
      type: "ADHOC",
      scheduledAt: new Date(),
      duration: 60,
      organizationId: orgId,
      attendees: { create: [{ userId }] },
    },
    select: { id: true },
  });

  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  return jsonSuccess({
    id: meeting.id,
    url: `/meetings/${meeting.id}?call=1`,
    guestUrl: `${base}/meet/${meetingGuestCode(meeting.id)}`,
  }, 201);
}
