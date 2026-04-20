import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { sendEmail } from "@/lib/email";
import { kudosTemplate } from "@/lib/email-templates";
import { notifyKudosPosted } from "@/services/slackNotifier";

// GET: Kudos feed (company-wide, paginated) or per-user
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const givenBy = url.searchParams.get("givenBy");
  const value = url.searchParams.get("value");
  const sort = url.searchParams.get("sort") || "recent";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { organizationId: orgId };
  if (userId) where.receiverId = userId;
  if (givenBy) where.giverId = givenBy;
  if (value) where.companyValue = value;

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
        reactions: {
          select: { emoji: true, userId: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.kudos.count({ where }),
  ]);

  const shaped = kudos.map((k) => {
    const byEmoji = new Map<string, number>();
    const mine: string[] = [];
    for (const r of k.reactions) {
      byEmoji.set(r.emoji, (byEmoji.get(r.emoji) || 0) + 1);
      if (r.userId === currentUserId) mine.push(r.emoji);
    }
    const reactionCounts = Array.from(byEmoji.entries())
      .map(([emoji, count]) => ({ emoji, count }))
      .sort((a, b) => b.count - a.count);
    return {
      id: k.id,
      message: k.message,
      companyValue: k.companyValue,
      giver: k.giver,
      receiver: k.receiver,
      createdAt: k.createdAt,
      reactionCounts,
      totalReactions: k.reactions.length,
      myReactions: mine,
    };
  });

  if (sort === "reactions") {
    shaped.sort((a, b) => b.totalReactions - a.totalReactions);
  }

  return jsonSuccess({
    data: shaped,
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

  if (receiver.email) {
    try {
      await sendEmail({
        to: receiver.email,
        subject,
        html,
        template: "kudos",
        variables: { senderName: `${kudos.giver.firstName} ${kudos.giver.lastName}`, message: message.trim() },
        organizationId: orgId,
        userId: receiverId,
        category: "kudos",
      });
    } catch (emailErr) {
      console.error("[Kudos] Email send failed:", emailErr);
    }
  }

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

  // Fan out to Slack if the org has a webhook configured. Non-blocking
  // on failure — Slack hiccups never break the kudos flow.
  notifyKudosPosted({
    organizationId: orgId,
    giverName: `${kudos.giver.firstName} ${kudos.giver.lastName}`,
    receiverName: `${kudos.receiver.firstName} ${kudos.receiver.lastName}`,
    value: companyValue?.trim() || null,
    message: message.trim(),
  }).catch(() => {});

  return jsonSuccess(kudos, 201);
}
