// POST /api/assets/bulk { op: "assign" | "status" | "delete", ids[], value? }
// (spec-tools-misc 2.2): the bulk bar's one request. Each op needs the same
// right the single-row route needs (assign, edit, delete), every id must be
// in this org, and a delete moves each asset to Trash. Answers the counts
// so the page can say "Changed 5 of 6" instead of pretending.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { moveToTrash } from "@/lib/trash";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { requireApp } from "@/lib/app-gate";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  op: z.enum(["assign", "status", "delete"]),
  ids: z.array(z.string().min(1)).min(1).max(200),
  value: z.string().max(80).nullable().optional(),
});
const STATUSES = new Set(["AVAILABLE", "IN_REPAIR", "RETIRED", "LOST"]);

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // The audience gate runs before the body is read, so a Member outside the
  // register (404 on the list) learns nothing about what this route wants.
  const gate = await requireApp("assets");
  if ("error" in gate) return gate.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Send op, ids and a value", 400);
  const { op, value } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];

  // The same permission matrix the single-row PATCH and DELETE read, so the
  // bulk bar can never disagree with the row menu.
  // eslint-disable-next-line no-restricted-syntax
  const denied = await requirePermission(session, "assets", op === "assign" ? "assign" : op === "status" ? "edit" : "delete");
  if (denied) return denied;

  const orgId = getOrgId(session);
  const owned = await prisma.asset.findMany({ where: { id: { in: ids }, organizationId: orgId }, select: { id: true } });
  const ownedIds = owned.map((a) => a.id);
  let done = 0;

  if (op === "assign") {
    const assignee = value ?? null;
    if (assignee) {
      const person = await prisma.user.findFirst({ where: { id: assignee, organizationId: orgId, deletedAt: null }, select: { id: true } });
      if (!person) return jsonError("That person is not in your organization", 400);
    }
    // Who held what before, so the person receiving kit is told exactly as
    // the single-row route tells them, and the change is on the activity log.
    const before = await prisma.asset.findMany({ where: { id: { in: ownedIds } }, select: { id: true, name: true, serialNumber: true, assignedToId: true } });
    const r = await prisma.asset.updateMany({
      where: { id: { in: ownedIds } },
      data: assignee
        ? { assignedToId: assignee, assignedAt: new Date(), returnedAt: null, status: "ASSIGNED" }
        : { assignedToId: null, returnedAt: new Date(), assignedAt: null, status: "AVAILABLE" },
    });
    done = r.count;
    const actorId = getUserId(session);
    if (assignee) {
      const newly = before.filter((a) => a.assignedToId !== assignee);
      if (newly.length > 0) {
        await prisma.notification.createMany({
          data: newly.map((a) => ({
            userId: assignee,
            type: "asset_assigned",
            title: "Asset Assigned",
            message: `You have been assigned: ${a.name}${a.serialNumber ? ` (S/N: ${a.serialNumber})` : ""}`,
            link: "/people/" + assignee,
          })),
        });
      }
    }
    for (const a of before) {
      logActivity({
        type: assignee ? "asset.assign" : "asset.unassign",
        actorId,
        organizationId: orgId,
        description: assignee ? `Assigned ${a.name}` : `Unassigned ${a.name}`,
        targetId: a.id,
        targetType: "Asset",
        metadata: { from: a.assignedToId, to: assignee, bulk: true },
      });
    }
  } else if (op === "status") {
    if (!value || !STATUSES.has(value)) return jsonError("Pick a status", 400);
    const r = await prisma.asset.updateMany({ where: { id: { in: ownedIds } }, data: { status: value as "AVAILABLE" } });
    done = r.count;
  } else {
    const u = session.user as { id?: string; name?: string | null };
    for (const id of ownedIds) {
      try {
        await moveToTrash("asset", id, { organizationId: orgId, userId: u.id ?? getUserId(session), userName: u.name ?? null });
        done++;
      } catch { /* counted below */ }
    }
  }

  return jsonSuccess({ done, failed: ids.length - done });
}
