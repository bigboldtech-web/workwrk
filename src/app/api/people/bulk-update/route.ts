// POST /api/people/bulk-update { userIds, action, payload }: every Directory
// bulk action is ONE request for the whole selection (spec-teams-people
// /people, CG-12). Returns { updated, skipped } for the one toast.
//
// Scope, per person: a selected id the caller may not edit (outside their
// chain, for a manager) is SKIPPED and counted, never written and never an
// error for the rest. Callers: the manager tier (as yesterday), the People
// team and Admins. Every target (department, manager, office, KRA, SOP, tag)
// must be the org's own; change_manager refuses loops and Agents per person.
//
// Actions: change_department, change_manager, change_office, assign_kra,
// assign_sop (unchanged behaviour) and add_tag (new).

import { NextResponse, type NextRequest } from "next/server";
import { accessV2Resolver } from "@/lib/access/flags";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { followReportingLine } from "@/lib/performance/review-cycle.server";
import {
  checkManagerCandidate,
  isPeopleAdmin,
  managerMapFor,
  peopleCtx,
  relationTo,
} from "@/lib/people/person-access.server";
import { canWritePersonGroup } from "@/lib/people/person-fields";
import { wouldCreateCycle } from "@/lib/people/reporting-lines";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

type KraEntry = { kraId?: unknown; weightage?: unknown };

export async function POST(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (!(ctx.managerTier || isPeopleAdmin(ctx))) return err(403, "Forbidden");
  const orgId = ctx.organizationId;

  const body = (await req.json().catch(() => null)) as { userIds?: unknown; action?: unknown; payload?: Record<string, unknown> } | null;
  const userIds = Array.isArray(body?.userIds) ? (body!.userIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const action = typeof body?.action === "string" ? body.action : "";
  const payload = body?.payload ?? {};
  if (userIds.length === 0) return err(400, "userIds array is required");
  if (userIds.length > 2000) return err(400, "Up to 2,000 people at a time");
  if (!action) return err(400, "action is required");

  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  // Only the people this caller may edit: everyone for the People team and
  // Admins, the chain for a manager. Self is skipped for placement moves.
  const allowed = users
    .map((u) => u.id)
    .filter((id) => canWritePersonGroup("placement", relationTo(ctx, id), { managerTierSelf: false, chainWritesMembership: !accessV2Resolver() }) && id !== ctx.userId);
  const skipped = userIds.length - allowed.length;
  if (allowed.length === 0) return NextResponse.json({ updated: 0, skipped, message: "Nobody in that selection is yours to change." });

  let description = "";
  let updated = allowed.length;

  switch (action) {
    case "change_department": {
      const departmentId = typeof payload.departmentId === "string" ? payload.departmentId : null;
      if (!departmentId) return err(400, "departmentId is required");
      const dept = await prisma.department.findFirst({ where: { id: departmentId, organizationId: orgId }, select: { name: true } });
      if (!dept) return err(400, "That department isn't in this workspace");
      const r = await prisma.user.updateMany({ where: { id: { in: allowed } }, data: { departmentId } });
      updated = r.count;
      description = `Moved ${updated} ${updated === 1 ? "person" : "people"} to ${dept.name}`;
      break;
    }

    case "change_manager": {
      const managerId = typeof payload.managerId === "string" ? payload.managerId : null;
      if (!managerId) return err(400, "managerId is required");
      const candidate = await checkManagerCandidate(orgId, managerId);
      if (candidate === "not_found") return err(400, "That person isn't in this workspace");
      if (candidate === "agent_cannot_manage") return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage" });
      const managers = await managerMapFor(orgId);
      // Apply one at a time against the moving map, so two people in the
      // selection can never be made each other's manager.
      const ok: string[] = [];
      for (const id of allowed) {
        if (wouldCreateCycle(id, managerId, managers)) continue;
        managers.set(id, managerId);
        ok.push(id);
      }
      if (ok.length) {
        await prisma.user.updateMany({ where: { id: { in: ok } }, data: { managerId } });
        // Open review cycles follow the new line (review-cycle.server.ts).
        await followReportingLine(orgId, ok, ctx.userId).catch((e: unknown) => console.error("followReportingLine failed", e));
      }
      updated = ok.length;
      const mgr = await prisma.user.findUnique({ where: { id: managerId }, select: { firstName: true, lastName: true } });
      description = `${updated} ${updated === 1 ? "person now reports" : "people now report"} to ${mgr?.firstName ?? ""} ${mgr?.lastName ?? ""}`.trim();
      break;
    }

    case "change_office": {
      const officeId = typeof payload.officeId === "string" && payload.officeId ? payload.officeId : null;
      if (officeId) {
        const office = await prisma.office.findFirst({ where: { id: officeId, organizationId: orgId }, select: { id: true, name: true } });
        if (!office) return err(404, "Office not found");
        const r = await prisma.user.updateMany({ where: { id: { in: allowed } }, data: { officeId: office.id } });
        updated = r.count;
        description = `Assigned ${updated} people to office "${office.name}"`;
      } else {
        const r = await prisma.user.updateMany({ where: { id: { in: allowed } }, data: { officeId: null } });
        updated = r.count;
        description = `Removed office assignment from ${updated} people`;
      }
      break;
    }

    case "add_tag": {
      const tagIds = Array.isArray(payload.tagIds) ? (payload.tagIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
      if (tagIds.length === 0) return err(400, "tagIds is required");
      const tags = await prisma.tag.findMany({ where: { id: { in: tagIds }, organizationId: orgId, archived: false }, select: { id: true, name: true } });
      if (tags.length !== new Set(tagIds).size) return err(400, "A tag in that list isn't in this workspace");
      await prisma.tagAssignment.createMany({
        data: tags.flatMap((t) => allowed.map((entityId) => ({ tagId: t.id, entityType: "USER" as const, entityId, organizationId: orgId, assignedById: ctx.userId }))),
        skipDuplicates: true,
      });
      description = `Tagged ${updated} ${updated === 1 ? "person" : "people"} ${tags.map((t) => t.name).join(", ")}`;
      break;
    }

    case "assign_kra": {
      const raw: KraEntry[] = Array.isArray(payload.kraEntries)
        ? (payload.kraEntries as KraEntry[])
        : payload.kraId ? [{ kraId: payload.kraId, weightage: payload.weightage }] : [];
      const entries = raw
        .map((e) => ({ kraId: typeof e?.kraId === "string" ? e.kraId : "", weightage: Number(e?.weightage) }))
        .filter((e) => e.kraId && Number.isFinite(e.weightage) && e.weightage > 0);
      if (entries.length === 0) return err(400, "At least one KRA is required");
      const kraIds = [...new Set(entries.map((e) => e.kraId))];
      const [existingAll, kraInfos] = await Promise.all([
        prisma.kRAAssignment.findMany({ where: { userId: { in: allowed }, kraId: { in: kraIds } }, select: { userId: true, kraId: true } }),
        prisma.kRA.findMany({ where: { id: { in: kraIds }, organizationId: orgId }, select: { id: true, name: true } }),
      ]);
      if (kraInfos.length !== kraIds.length) return err(400, "A KRA in that list isn't in this workspace");
      const taken = new Set(existingAll.map((e) => `${e.userId}:${e.kraId}`));
      const kraNameById = new Map(kraInfos.map((k) => [k.id, k.name]));
      const period = typeof payload.period === "string" && payload.period ? payload.period : "Q1 2026";
      const rows: { userId: string; kraId: string; weightage: number; period: string; status: "ACTIVE" }[] = [];
      const notes: { userId: string; type: string; title: string; message: string; link: string }[] = [];
      for (const e of entries) {
        for (const userId of allowed) {
          if (taken.has(`${userId}:${e.kraId}`)) continue;
          rows.push({ userId, kraId: e.kraId, weightage: e.weightage, period, status: "ACTIVE" });
          notes.push({
            userId,
            type: "kra_assigned",
            title: "New KRA Assigned",
            message: `You have been assigned the KRA: ${kraNameById.get(e.kraId)} (${e.weightage}% weightage)`,
            link: "/people/me?tab=kras",
          });
        }
      }
      if (rows.length) {
        await prisma.kRAAssignment.createMany({ data: rows, skipDuplicates: true });
        await prisma.notification.createMany({ data: notes });
      }
      description = `Assigned ${entries.length} KRA${entries.length > 1 ? "s" : ""} to ${updated} people`;
      break;
    }

    case "assign_sop": {
      const sopId = typeof payload.sopId === "string" ? payload.sopId : null;
      if (!sopId) return err(400, "sopId is required");
      const sop = await prisma.sOP.findFirst({ where: { id: sopId, organizationId: orgId }, select: { title: true, content: true } });
      if (!sop) return err(404, "SOP not found");
      const content = sop.content as { steps?: unknown[] } | null;
      const stepsTotal = Array.isArray(content?.steps) ? content.steps.length : 0;
      await prisma.sOPAssignment.createMany({
        data: allowed.map((userId) => ({
          sopId,
          userId,
          assignedBy: ctx.userId,
          stepsTotal,
          dueDate: typeof payload.dueDate === "string" && payload.dueDate ? new Date(payload.dueDate) : null,
          mandatory: payload.mandatory === false ? false : true,
        })),
        skipDuplicates: true,
      });
      description = `Assigned SOP "${sop.title}" to ${updated} people`;
      break;
    }

    default:
      return err(400, `Unknown action: ${action}`);
  }

  void logActivity({
    type: "bulk_update",
    actorId: ctx.userId,
    organizationId: orgId,
    description,
    metadata: { action, count: updated, skipped: skipped + (allowed.length - updated) },
  });

  return NextResponse.json({ updated, skipped: skipped + (allowed.length - updated), message: description, count: updated });
}
