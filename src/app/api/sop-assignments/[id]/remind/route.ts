import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";
import { sendEmail } from "@/lib/email";
import { sopAssignedTemplate } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/app-url";

/**
 * POST /api/sop-assignments/[id]/remind (spec-process section 2, the People
 * tab row menu): one Inbox row plus one email nudge to the assignee. Gated
 * the way assigning is: a manager over the person, or an org-wide role.
 * Idempotent per call, never on a completed assignment.
 */
const ORG_WIDE = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);

  const assignment = await prisma.sOPAssignment.findFirst({
    where: { id, sop: { organizationId: orgId } },
    include: { sop: { select: { id: true, title: true } }, user: { select: { id: true, email: true } } },
  });
  if (!assignment) return jsonError("Assignment not found", 404);
  if (assignment.status === "COMPLETED") return jsonError("This assignment is already done.", 409);

  const level = (session.user as { accessLevel?: string }).accessLevel ?? "";
  if (!ORG_WIDE.has(level)) {
    const team = new Set(await getTeamUserIds(orgId, getUserId(session)));
    if (!team.has(assignment.userId)) return jsonError("You can only remind people who report to you.", 403);
  }

  await prisma.notification.create({
    data: {
      title: "Reminder: SOP to acknowledge",
      message: `"${assignment.sop.title}" is waiting for you${assignment.dueDate ? `, due ${assignment.dueDate.toISOString().slice(0, 10)}` : ""}.`,
      type: "sop",
      link: `/sops/${assignment.sop.id}`,
      userId: assignment.userId,
    },
  });

  const { subject, html } = sopAssignedTemplate({
    sopTitle: assignment.sop.title,
    dueDate: assignment.dueDate ? assignment.dueDate.toISOString().slice(0, 10) : undefined,
    // One helper for every outbound absolute link (src/lib/app-url.ts), so a
    // reminder never points at a host the recipient cannot open.
    sopLink: absoluteUrl(`/sops/${assignment.sop.id}`),
  });
  try {
    await sendEmail({
      to: assignment.user.email,
      subject: `Reminder: ${subject}`,
      html,
      template: "sop-assigned",
      variables: { sopTitle: assignment.sop.title },
      organizationId: orgId,
      userId: assignment.userId,
      category: "sop",
    });
  } catch (e) {
    console.error("[sop remind] email failed", e);
  }

  return jsonSuccess({ reminded: true });
}
