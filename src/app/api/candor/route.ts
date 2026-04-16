import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const userIsManager = isManager(session);

  // Get user's department
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true },
  });

  const sessions = await prisma.candorSession.findMany({
    where: {
      organizationId: orgId,
      OR: [
        // Active sessions for my department or org-wide
        { status: "ACTIVE", departmentId: me?.departmentId || undefined },
        { status: "ACTIVE", departmentId: null },
        // Managers see all their sessions (any status)
        ...(userIsManager ? [{ createdBy: userId }] : []),
      ],
    },
    include: {
      _count: { select: { responses: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Check which sessions the user has already responded to
  const sessionIds = sessions.map((s) => s.id);
  const myResponses = await prisma.candorResponse.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { sessionId: true, id: true },
  });
  // Since responses are anonymous, we can't filter by userId. Instead, we use a localStorage-based
  // "already responded" check on the frontend. Here we just return response counts.

  const enriched = sessions.map((s) => ({
    ...s,
    responseCount: s._count.responses,
    isOwner: s.createdBy === userId,
  }));

  return jsonSuccess(enriched);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Only managers can create Candor sessions", 403);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { title, description, prompts, departmentId, status } = body;

  if (!title?.trim()) return jsonError("Title is required");
  if (!Array.isArray(prompts) || prompts.length === 0) return jsonError("At least one prompt is required");

  const candor = await prisma.candorSession.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      prompts,
      departmentId: departmentId || null,
      status: status || "DRAFT",
      createdBy: userId,
      organizationId: orgId,
      launchedAt: status === "ACTIVE" ? new Date() : null,
    },
  });

  // If launching immediately, notify team
  if (status === "ACTIVE") {
    await notifyTeamForCandor(candor, orgId, userId);
  }

  return jsonSuccess(candor, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { id, status, title, description, prompts } = body;

  if (!id) return jsonError("Session ID required");

  const existing = await prisma.candorSession.findFirst({
    where: { id, organizationId: orgId, createdBy: userId },
  });
  if (!existing) return jsonError("Session not found", 404);

  const data: any = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (prompts !== undefined) data.prompts = prompts;

  if (status === "ACTIVE" && existing.status !== "ACTIVE") {
    data.status = "ACTIVE";
    data.launchedAt = new Date();
  }
  if (status === "CLOSED" && existing.status !== "CLOSED") {
    data.status = "CLOSED";
    data.closedAt = new Date();
  }

  const updated = await prisma.candorSession.update({
    where: { id },
    data,
  });

  // If just launched, notify
  if (status === "ACTIVE" && existing.status !== "ACTIVE") {
    await notifyTeamForCandor(updated, orgId, userId);
  }

  return jsonSuccess(updated);
}

async function notifyTeamForCandor(session: any, orgId: string, creatorId: string) {
  const where: any = { organizationId: orgId, deletedAt: null, id: { not: creatorId } };
  if (session.departmentId) where.departmentId = session.departmentId;

  const users = await prisma.user.findMany({
    where,
    select: { id: true, email: true, firstName: true },
  });

  if (users.length > 0) {
    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: "candor_session",
        title: "Anonymous Candor Session",
        message: `"${session.title}" — Share your honest feedback anonymously.`,
        link: "/candor",
      })),
    });

    const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
    for (const u of users) {
      const { subject, html } = genericNotificationTemplate({
        heading: "Candor Session — Your Honest Feedback Needed",
        recipientName: u.firstName,
        subjectText: "A new anonymous feedback session has been launched for your team.",
        itemTitle: session.title,
        itemDetails: session.description || "Share what's working, what's not, and what should change.",
        actionLabel: "Share Feedback",
        actionLink: `${baseUrl}/candor`,
        note: "Your response is 100% anonymous — no names, no tracking.",
      });
      sendEmail({
        to: u.email, subject, html,
        template: "candor-session",
        variables: { title: session.title },
        organizationId: orgId, userId: u.id, category: "reminder",
      }).catch(() => {});
    }
  }
}
