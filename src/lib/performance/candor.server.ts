// Candor on the server: who may see, answer, run and read a session, one
// place, so the list, the page, the respond route and the results agree.
//
//   runner      the session's owner, the People team, Owner and Admin:
//               launch, close, reopen, delete a draft, read the results
//   respondent  anyone inside the session's scope (everyone, or its one
//               department) while it is Open, and never its owner (their
//               answer would count toward the floor of results they read)
//   anyone else a session is not discoverable (404, never a locked page)
//
// Server only.

import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";

export interface CandorCtx {
  userId: string;
  organizationId: string;
  departmentId: string | null;
  peopleTeamOrAdmin: boolean;
  isAgent: boolean;
}

export async function candorCtx(): Promise<CandorCtx | null> {
  const v = await viewerFromSession();
  if (!v || v.orgRole === "GUEST") return null;
  const me = await prisma.user.findUnique({ where: { id: v.userId }, select: { departmentId: true } });
  return {
    userId: v.userId,
    organizationId: v.organizationId,
    departmentId: me?.departmentId ?? null,
    peopleTeamOrAdmin: v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true,
    isAgent: v.isAgent,
  };
}

export function candorFaces(ctx: CandorCtx, s: { createdBy: string; status: string; departmentId: string | null }, hasResponded: boolean) {
  const isOwner = s.createdBy === ctx.userId;
  const canManage = isOwner || ctx.peopleTeamOrAdmin;
  const inScope = !s.departmentId || s.departmentId === ctx.departmentId;
  const canRespond = !isOwner && inScope && s.status === "ACTIVE" && !hasResponded;
  const visible = canManage || (inScope && s.status === "ACTIVE");
  return { isOwner, canManage, canSeeResults: canManage, inScope, canRespond, hasResponded, visible };
}

/** Has this person answered this session (CandorRespondent; absent table reads as no). */
export async function hasAnsweredCandor(sessionId: string, userId: string): Promise<boolean> {
  try {
    const r = await prisma.candorRespondent.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { id: true } });
    return !!r;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2021") return false;
    throw e;
  }
}

/**
 * Tell everyone in a session's scope that it is open (never its owner): an
 * Inbox row "A candor session is open: {title}" that links the session
 * itself, and an email. Called on launch, never on reopen.
 */
export async function notifyCandorOpen(
  session: { id: string; title: string; description: string | null; departmentId: string | null },
  orgId: string,
  creatorId: string,
): Promise<void> {
  const { sendEmail } = await import("@/lib/email");
  const { genericNotificationTemplate } = await import("@/lib/email-templates");
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null, id: { not: creatorId }, ...(session.departmentId ? { departmentId: session.departmentId } : {}) },
    select: { id: true, email: true, firstName: true },
  });
  if (!users.length) return;
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: "candor_open",
      title: `A candor session is open: ${session.title}`,
      message: "Your answers are anonymous.",
      link: `/candor/${session.id}`,
    })),
  });
  const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
  for (const u of users) {
    const { subject, html } = genericNotificationTemplate({
      heading: "A candor session is open",
      recipientName: u.firstName,
      subjectText: "Your team is asking for honest, anonymous feedback.",
      itemTitle: session.title,
      itemDetails: session.description || "Say what is working, what is not, and what should change.",
      actionLabel: "Answer",
      actionLink: `${baseUrl}/candor/${session.id}`,
      note: "Your answers are anonymous. WorkwrK records that you answered, never what you answered.",
    });
    sendEmail({
      to: u.email, subject, html,
      template: "candor-session",
      variables: { title: session.title },
      organizationId: orgId, userId: u.id, category: "reminder",
    }).catch(() => {});
  }
}
