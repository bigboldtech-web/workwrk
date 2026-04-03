import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const idea = await prisma.idea.findFirst({
    where: { id, organizationId: orgId },
    include: {
      submitter: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
      reviewer: { select: { id: true, firstName: true, lastName: true } },
      votes: { select: { userId: true } },
      comments: {
        include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { votes: true, comments: true } },
    },
  });

  if (!idea) return jsonError("Idea not found", 404);
  return jsonSuccess(idea);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();

  const idea = await prisma.idea.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!idea) return jsonError("Idea not found", 404);

  // Submitter can edit title/description while SUBMITTED
  if (idea.submitterId === userId && idea.status === "SUBMITTED") {
    const data: any = {};
    if (body.title) data.title = body.title;
    if (body.description) data.description = body.description;
    if (body.category !== undefined) data.category = body.category;

    const updated = await prisma.idea.update({ where: { id }, data });
    return jsonSuccess(updated);
  }

  // Manager actions: status changes
  if (!isManager(session)) return jsonError("Only managers can review ideas", 403);

  const data: any = {};
  if (body.status) {
    data.status = body.status;
    data.reviewerId = userId;
  }
  if (body.reviewNotes !== undefined) data.reviewNotes = body.reviewNotes;
  if (body.rewardType !== undefined) data.rewardType = body.rewardType;
  if (body.rewardValue !== undefined) data.rewardValue = body.rewardValue;
  if (body.status === "REWARDED") data.rewardedAt = new Date();

  const updated = await prisma.idea.update({
    where: { id },
    data,
    include: {
      submitter: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify submitter on status change
  if (body.status) {
    await prisma.notification.create({
      data: {
        userId: idea.submitterId,
        type: "idea_update",
        title: `Your idea "${idea.title}" is now ${body.status.replace(/_/g, " ").toLowerCase()}`,
        message: body.reviewNotes || "",
      },
    });
  }

  return jsonSuccess(updated);
}
