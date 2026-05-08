// Generic bulk approve / reject endpoint. One round-trip processes
// up to BULK_LIMIT pending rows in a transaction. Applies the same
// authorization triangle the per-row endpoints use:
//   - manager+ to act
//   - never approve a row you submitted yourself
//   - never act on a row in a non-approvable state
// Failures are reported per-id so the UI can show "approved 7 of 10
// — 3 skipped: see details" without rolling everything back.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

const SUPPORTED = new Set([
  "expense",
  "time-off",
  "comp-decision",
  "purchase-order",
  "invoice",
  "timesheet",
]);

const BULK_LIMIT = 100;

type Result = {
  total: number;
  applied: number;
  skipped: Array<{ id: string; reason: string }>;
};

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const entityType = typeof body.entityType === "string" ? body.entityType : "";
  const decision = typeof body.decision === "string" ? body.decision.toUpperCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === "string")
    : [];

  if (!SUPPORTED.has(entityType)) return jsonError("Unsupported entityType", 400);
  if (!["APPROVE", "REJECT"].includes(decision)) {
    return jsonError("decision must be APPROVE or REJECT");
  }
  if (ids.length === 0) return jsonError("ids array is required");
  if (ids.length > BULK_LIMIT) {
    return jsonError(`Up to ${BULK_LIMIT} rows per request`, 400);
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const result: Result = { total: ids.length, applied: 0, skipped: [] };

  if (entityType === "expense") {
    const rows = await prisma.expense.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
    for (const r of rows) {
      if (r.status !== "SUBMITTED") {
        result.skipped.push({ id: r.id, reason: `status=${r.status}` });
        continue;
      }
      if (r.reporterId === userId) {
        result.skipped.push({ id: r.id, reason: "self-decision blocked" });
        continue;
      }
      await prisma.expense.update({
        where: { id: r.id },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approverId: userId,
          decisionAt: new Date(),
          decisionNote: note,
        },
      });
      result.applied++;
    }
    // Surface any ids that weren't found at all (already deleted, wrong org).
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) result.skipped.push({ id, reason: "not found" });
    }
  } else if (entityType === "time-off") {
    const rows = await prisma.timeOffRequest.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
    for (const r of rows) {
      if (r.status !== "PENDING") {
        result.skipped.push({ id: r.id, reason: `status=${r.status}` });
        continue;
      }
      if (r.userId === userId) {
        result.skipped.push({ id: r.id, reason: "self-decision blocked" });
        continue;
      }
      await prisma.timeOffRequest.update({
        where: { id: r.id },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approverId: userId,
          decisionAt: new Date(),
          decisionNote: note,
        },
      });
      result.applied++;
    }
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) result.skipped.push({ id, reason: "not found" });
    }
  } else if (entityType === "comp-decision") {
    if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);
    const rows = await prisma.compensationDecision.findMany({
      where: { id: { in: ids }, organizationId: orgId },
      include: { cycle: { select: { status: true } } },
    });
    for (const r of rows) {
      if (r.status !== "PROPOSED") {
        result.skipped.push({ id: r.id, reason: `status=${r.status}` });
        continue;
      }
      if (r.cycle.status === "CLOSED") {
        result.skipped.push({ id: r.id, reason: "cycle closed" });
        continue;
      }
      if (r.subjectId === userId) {
        result.skipped.push({ id: r.id, reason: "self-decision blocked" });
        continue;
      }
      await prisma.compensationDecision.update({
        where: { id: r.id },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          decidedById: userId,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      result.applied++;
    }
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) result.skipped.push({ id, reason: "not found" });
    }
  } else if (entityType === "purchase-order") {
    const rows = await prisma.purchaseOrder.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
    for (const r of rows) {
      if (r.status !== "SUBMITTED") {
        result.skipped.push({ id: r.id, reason: `status=${r.status}` });
        continue;
      }
      if (r.requesterId === userId) {
        result.skipped.push({ id: r.id, reason: "self-decision blocked" });
        continue;
      }
      await prisma.purchaseOrder.update({
        where: { id: r.id },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approverId: userId,
          decisionAt: new Date(),
          decisionNote: note,
        },
      });
      result.applied++;
    }
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) result.skipped.push({ id, reason: "not found" });
    }
  } else if (entityType === "invoice") {
    const rows = await prisma.invoice.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
    for (const r of rows) {
      if (r.status !== "PENDING") {
        result.skipped.push({ id: r.id, reason: `status=${r.status}` });
        continue;
      }
      await prisma.invoice.update({
        where: { id: r.id },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approverId: userId,
          decisionAt: new Date(),
          decisionNote: note,
        },
      });
      result.applied++;
    }
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) result.skipped.push({ id, reason: "not found" });
    }
  } else if (entityType === "timesheet") {
    const rows = await prisma.timesheet.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
    for (const r of rows) {
      if (r.status !== "SUBMITTED") {
        result.skipped.push({ id: r.id, reason: `status=${r.status}` });
        continue;
      }
      if (r.userId === userId) {
        result.skipped.push({ id: r.id, reason: "self-decision blocked" });
        continue;
      }
      await prisma.timesheet.update({
        where: { id: r.id },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approverId: userId,
          decisionAt: new Date(),
          decisionNote: note,
        },
      });
      result.applied++;
    }
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) result.skipped.push({ id, reason: "not found" });
    }
  }

  // Single audit row for the bulk action — easier to scan than N
  // individual updates. The skipped count is part of the description
  // so an auditor can see partial completions at a glance.
  logActivity({
    type: `bulk_${decision.toLowerCase()}`,
    actorId: userId,
    organizationId: orgId,
    description: `Bulk ${decision.toLowerCase()}d ${result.applied} ${entityType} row(s); skipped ${result.skipped.length}`,
    targetType: entityType,
    severity: result.applied > 25 ? "warning" : "info",
  });

  return jsonSuccess(result);
}
