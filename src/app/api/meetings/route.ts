import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isOrgAdmin } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { broadcastWebhook } from "@/lib/webhooks";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { MEETING_TYPES, isMeetingType } from "@/lib/meeting-type";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const pagination = parsePaginationParams(req);

  const viewerId = getUserId(session);
  const where: Record<string, unknown> = { organizationId: getOrgId(session), deletedAt: null };
  if (type) where.type = type;

  // WHO SEES WHICH MEETINGS. spec-planner.md section 1 Access: "the list is
  // scoped: meetings where the viewer is an attendee or the creator; Owners
  // and Admins see every meeting in the org (rule 4)."
  //
  // Until Phase 4 this list was org-wide for everyone, so every Member saw
  // every one to one in the company in the sidebar count and on /meetings.
  // That is the visible behaviour change this release makes: a Member who
  // was browsing meetings they do not attend stops seeing them.
  //
  // `createdById` is nullable (it arrived with this release), so the OR
  // below answers correctly for historical rows too: they match on
  // attendance alone, which is the only thing those rows record.
  //
  // THE LIST AND THE DETAIL ANSWER THE SAME QUESTION. An earlier draft of
  // this route added an `unowned` clause, so a meeting recording nobody
  // (createdById null AND no attendees, which the pre Phase 4 POST wrote
  // whenever the caller supplied no attendeeIds) stayed visible to every
  // Member. src/lib/meeting-access.ts resolves that same row to "none" for
  // everyone but an org admin, and deliberately: granting Can edit on it
  // hands the row, its agenda and its notes to the whole organization.
  //
  // The two disagreeing was observable. A Member saw ORPHAN PROBE on
  // /meetings and got the in-shell 404 when they opened it: a row in a list
  // that cannot be opened is a dead control, which is the one thing this
  // refresh does not ship.
  //
  // The gate wins, and the reachability problem the clause was solving is a
  // data problem solved with data: scripts/backfill-meeting-created-by.mjs
  // reads the meeting_created ActivityLog row that the POST below has
  // always written and puts the REAL creator into createdById, so a
  // historical row resolves through "I created it" rather than through a
  // hole in two places at once. It never guesses: a row whose creator is
  // recorded nowhere is left NULL and reported. Until the script runs, and
  // for those unresolved rows afterwards, an org admin still sees every row
  // under rule 4 and can hand one back by adding its attendees.
  const orgWide = isOrgAdmin(session);
  const scopedToMe = [
    { attendees: { some: { userId: viewerId } } },
    { createdById: viewerId },
  ];
  if (!orgWide) {
    where.OR = scopedToMe;
  }
  // ?mine=1 narrows further, to the viewer's own meetings, for the
  // Notetaker's "Mine" view. For anyone but an Owner or Admin the scope
  // above already says the same thing; for an Owner or Admin it is the
  // difference between "my day" and "the whole company".
  if (searchParams.get("mine") === "1") {
    where.OR = scopedToMe;
  }
  if (pagination.search) {
    where.title = { contains: pagination.search, mode: "insensitive" };
  }

  // ?view=upcoming|past and ?from / ?to (spec-planner.md section 2
  // /meetings Data). Without a view the page asked for one page of every
  // meeting ordered newest first, so an organization with more meetings
  // than the page size saw only the most recent ones and "Past" could come
  // back empty while hundreds of past meetings existed. Each view now gets
  // its own page, in its own order.
  //
  // The upcoming boundary reaches back a day rather than starting at `now`,
  // because a meeting that STARTED before now and has not ended yet is
  // still upcoming (src/lib/meeting-list.ts splits on the end instant, and
  // the duration is not a column SQL can add to scheduledAt here). The
  // client's split then decides exactly; the extra day is a margin, not a
  // second rule.
  const view = searchParams.get("view");
  const now = new Date();
  const range: Record<string, Date> = {};
  if (view === "upcoming") range.gte = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (view === "past") range.lt = now;

  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  if (fromRaw) {
    const d = new Date(fromRaw);
    if (Number.isNaN(d.getTime())) return jsonError("from must be a date");
    range.gte = d;
  }
  if (toRaw) {
    const d = new Date(toRaw);
    if (Number.isNaN(d.getTime())) return jsonError("to must be a date");
    range.lte = d;
  }
  if (Object.keys(range).length) where.scheduledAt = range;

  // ?people=<ids> narrows to meetings those people attend. It can only
  // narrow: the scope clause above has already decided whose meetings are
  // visible, and this is ANDed on top of it.
  const peopleRaw = searchParams.get("people");
  if (peopleRaw) {
    const ids = peopleRaw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (ids.length) {
      const and = Array.isArray(where.AND) ? (where.AND as unknown[]) : [];
      where.AND = [...and, { attendees: { some: { userId: { in: ids } } } }];
    }
  }

  const [meetings, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      include: {
        attendees: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
        },
        actionItems: {
          select: { id: true, status: true },
        },
      },
      orderBy: { scheduledAt: view === "upcoming" ? "asc" : "desc" },
      ...skipTake(pagination),
    }),
    prisma.meeting.count({ where }),
  ]);

  // Enrich with stats
  const enriched = meetings.map((m) => {
    const aiTotal = m.actionItems.length;
    const aiDone = m.actionItems.filter((a) => a.status === "COMPLETED").length;
    let decisionCount = 0;
    try {
      const parsed = m.decisions ? JSON.parse(m.decisions) : [];
      decisionCount = Array.isArray(parsed) ? parsed.length : (m.decisions ? 1 : 0);
    } catch {
      decisionCount = m.decisions ? 1 : 0;
    }
    return {
      ...m,
      actionItems: undefined,
      stats: {
        hasNotes: !!m.notes,
        decisionCount,
        actionItemsTotal: aiTotal,
        actionItemsDone: aiDone,
      },
    };
  });

  return jsonSuccess(paginatedResult(enriched, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  // A missing or malformed body answers the contract, not a bare 500 with an
  // empty response (audit C-1, the same fix the punch route carries).
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return jsonError("Title, type, and scheduled time are required");
  }
  const { title, type, scheduledAt, duration, agenda, attendeeIds } = body as {
    title?: unknown; type?: unknown; scheduledAt?: unknown;
    duration?: unknown; agenda?: unknown; attendeeIds?: unknown;
  };

  if (!title || !type || !scheduledAt) {
    return jsonError("Title, type, and scheduled time are required");
  }
  // `type` went straight into prisma.meeting.create, so a body naming a word
  // that is not in enum MeetingType answered a bare 500 from the database
  // instead of a 400 naming the six words it accepts.
  if (!isMeetingType(type)) {
    return jsonError(`type must be one of: ${MEETING_TYPES.join(", ")}`);
  }
  const when = new Date(String(scheduledAt));
  if (Number.isNaN(when.getTime())) return jsonError("scheduledAt must be a date");
  const minutes = Number(duration);
  const durationMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60
    ? Math.round(minutes)
    : 30;

  const orgId = getOrgId(session);
  const creatorId = getUserId(session);

  // The creator is always an attendee of their own meeting. Without this a
  // person could schedule a meeting and then not see it, because the list
  // is scoped to attendance and creation from this release on. The Set
  // also de-duplicates a picker that already included them.
  //
  // AND THE SET IS ORG SCOPED. Until now `attendeeIds` went straight into
  // the create, so a body naming a user in ANOTHER organization added them
  // as an attendee here and delivered this meeting's title into their
  // notification inbox, and a body naming an id that does not exist answered
  // a bare 500 from the foreign key. Ids are resolved against this org
  // first; anything else is dropped, the way POST /api/time-entries already
  // drops a foreign itemId.
  const askedIds = Array.isArray(attendeeIds) ? attendeeIds.filter((x: unknown): x is string => typeof x === "string") : [];
  const inOrg = askedIds.length
    ? await prisma.user.findMany({ where: { id: { in: askedIds }, organizationId: orgId }, select: { id: true } })
    : [];
  const attendeeSet = new Set<string>(inOrg.map((u) => u.id));
  attendeeSet.add(creatorId);

  const meeting = await prisma.meeting.create({
    data: {
      title: String(title),
      type,
      scheduledAt: when,
      duration: durationMinutes,
      agenda: typeof agenda === "string" ? agenda : null,
      organizationId: orgId,
      createdById: creatorId,
      attendees: { create: [...attendeeSet].map((id: string) => ({ userId: id })) },
    },
  });

  logActivity({
    type: "meeting_created",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Scheduled meeting "${title}"`,
    targetId: meeting.id,
    targetType: "meeting",
    metadata: { type },
  });

  broadcastWebhook({
    organizationId: orgId,
    event: "meeting_created",
    payload: { meetingId: meeting.id, title: String(title), type, scheduledAt: when.toISOString() },
  });

  // Notify attendees (excluding the creator, who just made it)
  {
    const recipients = [...attendeeSet].filter((id) => id !== creatorId);
    if (recipients.length > 0) {
      // A stored notification is read by people in other zones, so it never
      // carries the SERVER's zone unlabelled. This is the same rule
      // src/app/api/timesheets/[id]/route.ts applies to the week key: name
      // the instant in a zone the reader can see, rather than in whichever
      // zone the box happens to run in.
      const whenLabel = `${when.toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
      })} UTC`;
      await prisma.notification.createMany({
        data: recipients.map((uid: string) => ({
          userId: uid,
          type: "meeting_invite",
          title: "Meeting Invite",
          message: `${String(title)} · ${whenLabel}`,
          link: `/meetings/${meeting.id}`,
        })),
      }).catch((err) => console.error("[Meeting] Notification failed:", err));

      // Email attendees
      try {
        const [users, creator] = await Promise.all([
          prisma.user.findMany({ where: { id: { in: recipients } }, select: { id: true, email: true, firstName: true } }),
          prisma.user.findUnique({ where: { id: creatorId }, select: { firstName: true, lastName: true } }),
        ]);
        const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
        for (const u of users) {
          const { subject: emailSubject, html } = genericNotificationTemplate({
            heading: "Meeting Invite",
            recipientName: u.firstName,
            subjectText: `${creator?.firstName || "Someone"} ${creator?.lastName || ""} scheduled a meeting with you.`,
            itemTitle: String(title),
            itemDetails: `${type} · ${whenLabel} · ${durationMinutes} min`,
            actionLabel: "View Meeting",
            actionLink: `${baseUrl}/meetings/${meeting.id}`,
            note: typeof agenda === "string" && agenda ? agenda : undefined,
          });
          sendEmail({
            to: u.email, subject: emailSubject, html,
            template: "meeting-invite",
            variables: { title: String(title), when: whenLabel, type },
            organizationId: orgId, userId: u.id, category: "reminder",
          }).catch((err) => console.error(`[Meeting] Email failed:`, err));
        }
      } catch (err) { console.error("[Meeting] Email batch failed:", err); }
    }
  }

  return jsonSuccess(meeting, 201);
}
