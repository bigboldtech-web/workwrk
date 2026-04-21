import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessLevel } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, hasRole, jsonError, jsonSuccess } from "@/lib/api-helpers";

const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "HR",
] as AccessLevel[];

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

  const wantsStatusChange =
    body.status !== undefined ||
    body.reviewNotes !== undefined ||
    body.rewardType !== undefined ||
    body.rewardValue !== undefined;
  const wantsContentEdit =
    body.title !== undefined ||
    body.description !== undefined ||
    body.category !== undefined;

  // Manager path: status / review / reward changes
  if (wantsStatusChange) {
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
        submitter: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
        votes: { select: { userId: true } },
        _count: { select: { votes: true, comments: true } },
      },
    });

    if (body.status && body.status !== idea.status) {
      await prisma.notification.create({
        data: {
          userId: idea.submitterId,
          type: "idea_update",
          title: `Your idea "${idea.title}" is now ${body.status.replace(/_/g, " ").toLowerCase()}`,
          message: body.reviewNotes || "",
          link: "/ideas",
        },
      });
    }

    return jsonSuccess(updated);
  }

  // Submitter path: edit own title/description/category while still SUBMITTED
  if (wantsContentEdit) {
    if (idea.submitterId !== userId) return jsonError("Only the submitter can edit this idea", 403);
    if (idea.status !== "SUBMITTED") return jsonError("Idea can no longer be edited", 400);

    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.category !== undefined) data.category = body.category;

    const updated = await prisma.idea.update({
      where: { id },
      data,
      include: {
        submitter: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
        votes: { select: { userId: true } },
        _count: { select: { votes: true, comments: true } },
      },
    });
    return jsonSuccess(updated);
  }

  return jsonError("No valid fields to update", 400);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const idea = await prisma.idea.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, submitterId: true, status: true },
  });
  if (!idea) return jsonError("Idea not found", 404);

  const isAdmin = hasRole(session, ADMIN_ROLES);
  const isSubmitterDraft = idea.submitterId === userId && idea.status === "SUBMITTED";

  if (!isAdmin && !isSubmitterDraft) {
    return jsonError("You don't have permission to delete this idea", 403);
  }

  await prisma.idea.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
