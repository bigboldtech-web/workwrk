import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { broadcastWebhook } from "@/lib/webhooks";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const pagination = parsePaginationParams(req);

  const where: any = { organizationId: getOrgId(session) };
  if (type) where.type = type;
  if (pagination.search) {
    where.title = { contains: pagination.search, mode: "insensitive" };
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
      orderBy: { scheduledAt: "desc" },
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

  const body = await req.json();
  const { title, type, scheduledAt, duration, agenda, attendeeIds } = body;

  if (!title || !type || !scheduledAt) {
    return jsonError("Title, type, and scheduled time are required");
  }

  const meeting = await prisma.meeting.create({
    data: {
      title,
      type,
      scheduledAt: new Date(scheduledAt),
      duration: duration || 30,
      agenda,
      organizationId: getOrgId(session),
      attendees: attendeeIds ? {
        create: attendeeIds.map((id: string) => ({ userId: id })),
      } : undefined,
    },
  });

  const orgId = getOrgId(session);

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
    payload: { meetingId: meeting.id, title, type, scheduledAt },
  });

  return jsonSuccess(meeting, 201);
}
