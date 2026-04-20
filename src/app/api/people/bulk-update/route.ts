import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { userIds, action, payload } = body;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return jsonError("userIds array is required");
  }
  if (!action) return jsonError("action is required");

  // Verify all users belong to this org
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  const validIds = users.map((u) => u.id);
  if (validIds.length === 0) return jsonError("No valid users found");

  let description = "";

  switch (action) {
    case "change_department": {
      if (!payload?.departmentId) return jsonError("departmentId is required");
      await prisma.user.updateMany({
        where: { id: { in: validIds } },
        data: { departmentId: payload.departmentId },
      });
      const dept = await prisma.department.findUnique({ where: { id: payload.departmentId }, select: { name: true } });
      description = `Moved ${validIds.length} people to ${dept?.name || "department"}`;
      break;
    }

    case "change_manager": {
      if (!payload?.managerId) return jsonError("managerId is required");
      await prisma.user.updateMany({
        where: { id: { in: validIds } },
        data: { managerId: payload.managerId },
      });
      const mgr = await prisma.user.findUnique({ where: { id: payload.managerId }, select: { firstName: true, lastName: true } });
      description = `Changed manager to ${mgr?.firstName} ${mgr?.lastName} for ${validIds.length} people`;
      break;
    }

    case "change_office": {
      const officeId = payload?.officeId || null;
      if (officeId) {
        const office = await prisma.office.findFirst({
          where: { id: officeId, organizationId: orgId },
          select: { id: true, name: true },
        });
        if (!office) return jsonError("Office not found", 404);
        await prisma.user.updateMany({
          where: { id: { in: validIds } },
          data: { officeId: office.id },
        });
        description = `Assigned ${validIds.length} people to office "${office.name}"`;
      } else {
        await prisma.user.updateMany({
          where: { id: { in: validIds } },
          data: { officeId: null },
        });
        description = `Removed office assignment from ${validIds.length} people`;
      }
      break;
    }

    case "assign_kra": {
      // Support multi-KRA assignment via kraEntries array
      const entries = payload?.kraEntries || (payload?.kraId ? [{ kraId: payload.kraId, weightage: payload.weightage }] : []);
      if (entries.length === 0) return jsonError("At least one KRA is required");

      let totalAssigned = 0;
      for (const entry of entries) {
        if (!entry.kraId || !entry.weightage) continue;
        const existing = await prisma.kRAAssignment.findMany({
          where: { userId: { in: validIds }, kraId: entry.kraId },
          select: { userId: true },
        });
        const existingUserIds = new Set(existing.map((e: any) => e.userId));
        const newIds = validIds.filter((id: string) => !existingUserIds.has(id));

        if (newIds.length > 0) {
          await prisma.kRAAssignment.createMany({
            data: newIds.map((userId: string) => ({
              userId,
              kraId: entry.kraId,
              weightage: parseFloat(entry.weightage) || 0,
              period: payload.period || "Q1 2026",
              status: "ACTIVE",
            })),
          });

          // Notify newly assigned users
          const kraInfo = await prisma.kRA.findUnique({ where: { id: entry.kraId }, select: { name: true } });
          if (kraInfo) {
            await prisma.notification.createMany({
              data: newIds.map((userId: string) => ({
                userId,
                type: "kra_assigned",
                title: "New KRA Assigned",
                message: `You have been assigned the KRA: ${kraInfo.name} (${entry.weightage}% weightage)`,
                link: "/kra-kpi",
              })),
            });
          }

          totalAssigned += newIds.length;
        }
      }
      description = `Assigned ${entries.length} KRA${entries.length > 1 ? "s" : ""} to ${validIds.length} people`;
      break;
    }

    case "assign_sop": {
      if (!payload?.sopId) return jsonError("sopId is required");
      const sop = await prisma.sOP.findUnique({ where: { id: payload.sopId }, select: { title: true, content: true } });
      if (!sop) return jsonError("SOP not found", 404);

      const content = sop.content as any;
      const stepsTotal = Array.isArray(content?.steps) ? content.steps.length : 0;

      await prisma.sOPAssignment.createMany({
        data: validIds.map((userId) => ({
          sopId: payload.sopId,
          userId,
          assignedBy: getUserId(session),
          stepsTotal,
          dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
          mandatory: payload.mandatory ?? true,
        })),
        skipDuplicates: true,
      });
      description = `Assigned SOP "${sop.title}" to ${validIds.length} people`;
      break;
    }

    default:
      return jsonError(`Unknown action: ${action}`);
  }

  logActivity({
    type: "bulk_update",
    actorId: getUserId(session),
    organizationId: orgId,
    description,
    metadata: { action, count: validIds.length },
  });

  return jsonSuccess({ message: description, count: validIds.length });
}
