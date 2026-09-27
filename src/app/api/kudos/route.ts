import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { sendEmail } from "@/lib/email";
import { kudosTemplate } from "@/lib/email-templates";
import { notifyKudosPosted } from "@/services/slackNotifier";
import { shouldNotify, shouldEmail } from "@/lib/notify-prefs";
import { viewerFromSession } from "@/lib/access/viewer";
import { toCsv } from "@/lib/people/people-csv";
import type { Prisma } from "@/generated/prisma";

// GET: the kudos feed (spec-teams-performance /kudos Data).
//
//   view=all|received|given   received and given are the VIEWER's own
//   userId=&direction=received|given   one person's kudos (a record's tab)
//   value=<word>|none, q=<text in the message>, person=<giver or receiver>
//   from=&to= (YYYY-MM-DD), sort=recent|reactions
//   cursor=<opaque> & limit (at most 50): cursor pagination for the feed;
//   page & limit still work for the person record's "Show more".
//
// `pagination.total` is the server's count over the whole filtered set,
// never the loaded page. Guests never read the feed (access 3.3 Kudos).
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const viewer = await viewerFromSession();
  if (viewer?.orgRole === "GUEST") return jsonError("Not found", 404);
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  const userId = url.searchParams.get("userId");
  const direction = url.searchParams.get("direction") === "given" ? "given" : "received";
  const givenBy = url.searchParams.get("givenBy");
  const value = url.searchParams.get("value");
  const q = (url.searchParams.get("q") ?? "").trim();
  const person = url.searchParams.get("person");
  const dept = url.searchParams.get("dept");
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const sort = url.searchParams.get("sort") === "reactions" ? "reactions" : "recent";
  const cursor = url.searchParams.get("cursor");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20), 50);

  const where: Prisma.KudosWhereInput = { organizationId: orgId };
  const and: Prisma.KudosWhereInput[] = [];
  if (view === "received") where.receiverId = currentUserId;
  else if (view === "given") where.giverId = currentUserId;
  if (userId) {
    if (direction === "given") where.giverId = userId;
    else where.receiverId = userId;
  }
  if (givenBy) where.giverId = givenBy;
  if (value === "none") where.companyValue = null;
  else if (value) where.companyValue = value;
  if (q) where.message = { contains: q, mode: "insensitive" };
  if (person) and.push({ OR: [{ giverId: person }, { receiverId: person }] });
  if (dept) and.push({ OR: [{ giver: { departmentId: dept } }, { receiver: { departmentId: dept } }] });
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if ((fromRaw && DATE.test(fromRaw)) || (toRaw && DATE.test(toRaw))) {
    where.createdAt = {
      ...(fromRaw && DATE.test(fromRaw) ? { gte: new Date(`${fromRaw}T00:00:00.000Z`) } : {}),
      ...(toRaw && DATE.test(toRaw) ? { lte: new Date(`${toRaw}T23:59:59.999Z`) } : {}),
    };
  }
  if (and.length) where.AND = and;

  // Cursor: an offset the server hands back, so both sorts page the same
  // way and a new kudos arriving never shows a row twice within a sort.
  const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : (page - 1) * limit;
  const orderBy: Prisma.KudosOrderByWithRelationInput[] = sort === "reactions"
    ? [{ reactions: { _count: "desc" } }, { createdAt: "desc" }, { id: "desc" }]
    : [{ createdAt: "desc" }, { id: "desc" }];

  const isAdmin = viewer?.orgRole === "OWNER" || viewer?.orgRole === "ADMIN";
  const isAgent = viewer?.isAgent === true;

  // Export CSV: the People team and Admin, never an Agent; every row the
  // filters hold, not the page.
  if (url.searchParams.get("format") === "csv") {
    if (isAgent || !(isAdmin || viewer?.peopleTeam)) return jsonError("Only the People team or an Admin can export kudos", 403);
    const all = await prisma.kudos.findMany({
      where,
      orderBy,
      select: {
        createdAt: true, message: true, companyValue: true,
        giver: { select: { firstName: true, lastName: true, email: true } },
        receiver: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { reactions: true } },
      },
    });
    const csv = toCsv(
      ["Date", "From", "From email", "To", "To email", "Company value", "Message", "Reactions"],
      all.map((k) => [
        k.createdAt.toISOString(),
        `${k.giver.firstName ?? ""} ${k.giver.lastName ?? ""}`.trim(), k.giver.email,
        `${k.receiver.firstName ?? ""} ${k.receiver.lastName ?? ""}`.trim(), k.receiver.email,
        k.companyValue ?? "", k.message, k._count.reactions,
      ]),
    );
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="kudos.csv"', "Cache-Control": "no-store" } });
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [kudos, total, thisWeek] = await Promise.all([
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
      orderBy,
      skip: offset,
      take: limit,
    }),
    prisma.kudos.count({ where }),
    // The feed's "This week" group count, over the whole filtered set.
    prisma.kudos.count({ where: { AND: [where, { createdAt: { gte: weekAgo } }] } }),
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
      // The giver and an Admin may delete, never an Agent (access 3.3).
      canDelete: !isAgent && (k.giverId === currentUserId || isAdmin),
    };
  });

  const next = offset + kudos.length;
  return jsonSuccess({
    data: shaped,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      nextCursor: next < total ? String(next) : null,
    },
    groups: { thisWeek, earlier: Math.max(0, total - thisWeek) },
  });
}

// POST: Send kudos
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const giverId = getUserId(session);
  // A Guest never gives kudos (access 3.3 Kudos: every Member EDIT).
  const viewer = await viewerFromSession();
  if (viewer?.orgRole === "GUEST") return jsonError("Not found", 404);
  const body = await req.json().catch(() => ({}));
  const { receiverId, message } = body as { receiverId?: string; message?: unknown };
  const companyValue = typeof body.companyValue === "string" && body.companyValue.trim() ? body.companyValue.trim().slice(0, 80) : null;

  if (!receiverId || typeof message !== "string" || !message.trim()) {
    return jsonError("Choose who to thank and write a message");
  }
  if (message.trim().length > 500) return jsonError("A kudos message is up to 500 characters");

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
      companyValue,
      giverId,
      receiverId,
      organizationId: orgId,
    },
    include: {
      giver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      receiver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    },
  });

  // Notify the receiver (honors the "Kudos & recognition" inbox toggle)
  if (await shouldNotify(receiverId, "kudos")) await prisma.notification.create({
    data: {
      title: "You received kudos!",
      message: `${kudos.giver.firstName} ${kudos.giver.lastName} recognized you: "${message.trim().slice(0, 80)}"`,
      type: "kudos_received",
      // Their Received view (spec-teams-performance /kudos Realtime).
      link: "/kudos?view=received",
      userId: receiverId,
    },
  });

  // Send kudos email
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const { subject, html } = kudosTemplate({
    senderName: `${kudos.giver.firstName} ${kudos.giver.lastName}`,
    message: message.trim(),
    dashboardLink: `${baseUrl}/kudos?view=received`,
  });

  // Gated by both the /settings/notifications email toggle and the legacy
  // EmailPreference kudos category (checked inside sendEmail).
  if (receiver.email && await shouldEmail(receiverId, "kudos")) {
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
    value: companyValue,
    message: message.trim(),
  }).catch(() => {});

  return jsonSuccess(kudos, 201);
}
