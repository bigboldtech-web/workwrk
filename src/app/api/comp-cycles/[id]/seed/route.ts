// Seed a cycle with DRAFT decisions for every active employee. Run
// once when an admin opens a cycle so managers walk in to a populated
// table instead of an empty one. Idempotent: re-running only adds
// rows for employees missing a decision (e.g. new hires after the
// cycle opened).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!cycle) return jsonError("Cycle not found", 404);
  if (cycle.status === "CLOSED") return jsonError("Cycle is closed", 409);

  // Active employees only — TRIAL / SUSPENDED users don't get
  // proposals.  Skip super-admins (platform staff, not org employees).
  const employees = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      accessLevel: { not: "SUPER_ADMIN" },
    },
    select: { id: true, managerId: true },
  });

  // Existing decisions in this cycle, keyed by subjectId, so we don't
  // duplicate. Idempotent re-run.
  const existing = await prisma.compensationDecision.findMany({
    where: { cycleId: id },
    select: { subjectId: true },
  });
  const seen = new Set(existing.map((d) => d.subjectId));

  const toCreate = employees
    .filter((e) => !seen.has(e.id))
    .map((e) => ({
      organizationId: orgId,
      cycleId: id,
      subjectId: e.id,
      proposedById: e.managerId, // pre-fill — the manager owns this row
      currency: cycle.reportingCurrency,
      status: "DRAFT" as const,
    }));

  if (toCreate.length === 0) {
    return jsonSuccess({ created: 0, message: "All employees already seeded." });
  }

  // createMany is much faster than per-row create at Fortune-500 scale
  // (think 50K rows — a per-row create can take minutes).
  const result = await prisma.compensationDecision.createMany({
    data: toCreate,
    skipDuplicates: true,
  });

  logActivity({
    type: "comp_cycle_seeded",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Seeded ${result.count} compensation decisions in "${cycle.name}"`,
    targetId: id,
    targetType: "comp_cycle",
  });

  return jsonSuccess({ created: result.count });
}
