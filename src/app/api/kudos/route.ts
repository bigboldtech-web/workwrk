import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { sendEmail } from "@/lib/email";
import { kudosTemplate } from "@/lib/email-templates";

// GET: Kudos feed (company-wide, paginated) or per-user
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { organizationId: orgId };
  if (userId) where.receiverId = userId;

  const [kudos, total] = await Promise.all([
    prisma.kudos.findMany({
      where,
      include: {
        giver: {
          select: { id: true, firstName: true, lastName: true, avatar: true, role: { select: { title: true } } },
        },
        receiver: {
          select: { id: true, firstName: true, lastName: true, avatar: true, role: { select: { title: true } }, department: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.kudos.count({ where }),
  ]);

  return jsonSuccess({
    data: kudos,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST: Send kudos
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const giverId = getUserId(session);
  const body = await req.json();
  const { receiverId, message, companyValue } = body;

  if (!receiverId || !message?.trim()) {
    return jsonError("receiverId and message are required");
  }

  if (receiverId === giverId) {
    return jsonError("You cannot give kudos to yourself");
  }

  // Verify receiver belongs to same org
  const receiver = await prisma.user.findFirst({
    where: { id: receiverId, organizationId: orgId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!receiver) return jsonError("User not found", 404);

  const kudos = await prisma.kudos.create({
    data: {
      message: message.trim(),
      companyValue: companyValue?.trim() || null,
      giverId,
      receiverId,
      organizationId: orgId,
    },
    include: {
      giver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      receiver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    },
  });

  // Notify the receiver
  await prisma.notification.create({
    data: {
      title: "You received kudos!",
      message: `${kudos.giver.firstName} ${kudos.giver.lastName} recognized you: "${message.trim().slice(0, 80)}"`,
      type: "KUDOS",
      link: "/dashboard",
      userId: receiverId,
    },
  });

  // Send kudos email
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const { subject, html } = kudosTemplate({
    senderName: `${kudos.giver.firstName} ${kudos.giver.lastName}`,
    message: message.trim(),
    dashboardLink: `${baseUrl}/dashboard`,
  });

  sendEmail({
    to: receiver.email || "",
    subject,
    html,
    template: "kudos",
    variables: { senderName: `${kudos.giver.firstName} ${kudos.giver.lastName}`, message: message.trim() },
    organizationId: orgId,
    userId: receiverId,
    category: "kudos",
  });

  logActivity({
    type: "kudos_given",
    actorId: giverId,
    organizationId: orgId,
    description: `Gave kudos to ${receiver.firstName} ${receiver.lastName}${companyValue ? ` for ${companyValue}` : ""}`,
    targetId: receiverId,
    targetType: "user",
  });

  // Recalculate receiver's performance score (kudos bonus)
  triggerRecalculation(receiverId, orgId);

  return jsonSuccess(kudos, 201);
}
