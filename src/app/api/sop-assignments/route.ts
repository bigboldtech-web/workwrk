import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { sopAssignedTemplate } from "@/lib/email-templates";

// GET: Get SOP assignments — by userId (my assignments) or by sopId (who's assigned)
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const sopId = searchParams.get("sopId");
  const userId = searchParams.get("userId");
  const status = searchParams.get("status");
  const orgId = getOrgId(session);

  const where: any = {
    sop: { organizationId: orgId },
  };

  if (sopId) where.sopId = sopId;
  if (userId) {
    where.userId = userId;
  } else if (!sopId) {
    // Default: show current user's assignments
    where.userId = getUserId(session);
  }
  if (status) where.status = status;

  const assignments = await prisma.sOPAssignment.findMany({
    where,
    include: {
      sop: {
        select: {
          id: true, title: true, category: true, status: true,
          content: true, version: true, sopType: true,
        },
      },
      user: {
        select: {
          id: true, firstName: true, lastName: true, email: true,
          department: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return jsonSuccess(assignments);
}

// POST: Assign SOP to person(s) — bulk assign with userIds[]
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { sopId, userIds, departmentId, dueDate, mandatory } = body;

  if (!sopId) return jsonError("sopId is required");

  // Verify SOP belongs to org
  const sop = await prisma.sOP.findFirst({
    where: { id: sopId, organizationId: orgId },
  });
  if (!sop) return jsonError("SOP not found", 404);

  // Reference SOPs (WRITTEN / RECORDED) are guides, not trackable work —
  // leave stepsTotal at 0 so they never show a completion percentage or
  // graduate into a "Completed" bucket. Only CHECKLIST SOPs accumulate
  // step progress, because those are the ones users actually run.
  const content = sop.content as any;
  let stepsTotal = 0;
  if (sop.sopType === "CHECKLIST") {
    const sections = (content?.sections as any[]) || [];
    stepsTotal = sections.reduce((sum, s) => sum + (s?.steps?.length || 0), 0);
  }

  // Resolve user IDs — either from userIds array or from departmentId
  let resolvedUserIds: string[] = userIds || [];

  if (departmentId) {
    const deptUsers = await prisma.user.findMany({
      where: { departmentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    });
    resolvedUserIds = [...new Set([...resolvedUserIds, ...deptUsers.map((u) => u.id)])];
  }

  if (resolvedUserIds.length === 0) {
    return jsonError("No users specified. Provide userIds[] or departmentId");
  }

  const assignerId = getUserId(session);
  const data = resolvedUserIds.map((uid: string) => ({
    sopId,
    userId: uid,
    mandatory: mandatory ?? true,
    dueDate: dueDate ? new Date(dueDate) : null,
    stepsTotal,
    assignedBy: assignerId,
  }));

  const result = await prisma.sOPAssignment.createMany({
    data,
    skipDuplicates: true,
  });

  // Notify assigned users
  const notifications = resolvedUserIds.map((uid: string) => ({
    title: "SOP Assigned",
    message: `You have been assigned "${sop.title}". ${dueDate ? `Due by ${new Date(dueDate).toLocaleDateString()}.` : ""}`,
    type: "SOP",
    link: `/sops/my-sops`,
    userId: uid,
  }));

  await prisma.notification.createMany({ data: notifications });

  // Send SOP assignment emails
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const assignedUsers = await prisma.user.findMany({
    where: { id: { in: resolvedUserIds } },
    select: { id: true, email: true },
  });

  for (const user of assignedUsers) {
    const { subject, html } = sopAssignedTemplate({
      sopTitle: sop.title,
      dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : undefined,
      sopLink: `${baseUrl}/sops/my-sops`,
    });

    try {
      await sendEmail({
        to: user.email,
        subject,
        html,
        template: "sop-assigned",
        variables: { sopTitle: sop.title, dueDate },
        organizationId: orgId,
        userId: user.id,
        category: "sop",
      });
    } catch (emailErr) {
      console.error("[SOPAssignment] Email send failed:", emailErr);
    }
  }

  return jsonSuccess({ message: `${result.count} assignments created`, count: result.count }, 201);
}
