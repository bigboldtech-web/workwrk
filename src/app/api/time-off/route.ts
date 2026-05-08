// Time-off requests — list + create.
//
// scope:
//   "mine"     → own requests (default)
//   "approve"  → pending requests assigned to me as approver
//   "team"     → requests from my direct reports
//   "all"      → manager+ org-wide audit
//
// Auto-approval: when policy.requiresApproval = false (e.g. bereavement),
// new requests land APPROVED on submit so the employee can show their
// calendar block immediately without an HR step.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE_MAX = 200;

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") ?? "mine";
  const statusFilter = sp.get("status");
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), PAGE_SIZE_MAX);

  const where: Record<string, unknown> = { organizationId: orgId };

  if (scope === "mine") {
    where.userId = userId;
  } else if (scope === "approve") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    where.status = "PENDING";
    where.OR = [{ approverId: userId }, { approverId: null }];
  } else if (scope === "team") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    const directReports = await prisma.user.findMany({
      where: { managerId: userId },
      select: { id: true },
    });
    where.userId = { in: directReports.map((r) => r.id) };
  } else if (scope === "all") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
  } else {
    return jsonError("Invalid scope");
  }

  if (statusFilter) {
    if (!VALID_STATUSES.has(statusFilter)) return jsonError("Invalid status");
    if (scope !== "approve") where.status = statusFilter;
  }

  const requests = await prisma.timeOffRequest.findMany({
    where,
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      startDate: true,
      endDate: true,
      hours: true,
      reason: true,
      status: true,
      decisionAt: true,
      decisionNote: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
      policy: { select: { id: true, name: true, type: true, color: true } },
    },
  });

  const serialized = requests.map((r) => ({
    ...r,
    hours: Number(r.hours),
  }));
  return jsonSuccess(serialized);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const policyId = typeof body.policyId === "string" ? body.policyId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
  const startDate = body.startDate ? new Date(body.startDate) : null;
  const endDate = body.endDate ? new Date(body.endDate) : null;
  const hoursRaw = body.hours;

  if (!policyId) return jsonError("policyId is required");
  if (!startDate || Number.isNaN(startDate.getTime())) return jsonError("Invalid startDate");
  if (!endDate || Number.isNaN(endDate.getTime())) return jsonError("Invalid endDate");
  if (endDate < startDate) return jsonError("endDate must be on/after startDate");

  // Auto-derive default hours if caller didn't pass any: (days + 1) * 8.
  const days = Math.floor((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
  const hours = hoursRaw === undefined || hoursRaw === null || hoursRaw === ""
    ? days * 8
    : Number(hoursRaw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 99_999) {
    return jsonError("Invalid hours");
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const policy = await prisma.timeOffPolicy.findFirst({
    where: { id: policyId, organizationId: orgId, archived: false },
  });
  if (!policy) return jsonError("Policy not found", 404);

  // Default approver: requester's manager. Fall back to null (open
  // queue) if no manager assigned. Auto-approve policies skip this.
  let approverId: string | null = null;
  let initialStatus: "PENDING" | "APPROVED" = "PENDING";
  if (policy.requiresApproval) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    approverId = me?.managerId ?? null;
  } else {
    initialStatus = "APPROVED";
  }

  const request = await prisma.timeOffRequest.create({
    data: {
      organizationId: orgId,
      userId,
      policyId,
      startDate,
      endDate,
      hours,
      reason,
      status: initialStatus,
      approverId,
      // Auto-approved rows still need a stamp for downstream reporting.
      decisionAt: initialStatus === "APPROVED" ? new Date() : null,
    },
  });

  logActivity({
    type: "time_off_requested",
    actorId: userId,
    organizationId: orgId,
    description: `Requested ${hours}h ${policy.name} (${initialStatus.toLowerCase()})`,
    targetId: request.id,
    targetType: "time_off_request",
  });

  return jsonSuccess({ ...request, hours: Number(request.hours) }, 201);
}
