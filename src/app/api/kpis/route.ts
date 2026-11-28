import { NextRequest } from "next/server";
import { enumRefusal, KPI_FREQUENCIES, KPI_TYPES } from "@/lib/alignment-enums";
import { BAD_JSON, badJson } from "@/lib/http/json-body";
import { goalsFedBy, refreshGoals, refreshGoalsFedBy } from "@/lib/goals/kpi-goal-refresh";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { canTouchUserAlignment, isOrgWideAlignment } from "@/lib/alignment-scope";
import { KPI_ORDER } from "@/lib/alignment";
import { allOwned } from "@/lib/access/company-wall";
import type { Prisma } from "@/generated/prisma";

// Direction of "good" + north-star flag. `direction` (when set) wins over
// the legacy `lowerIsBetter` boolean; null explicitly clears it back to
// the legacy fallback. Validated here so a typo'd direction can never
// silently corrupt how a gauge is graded.
const alignmentFieldsSchema = z.object({
  direction: z.enum(["HIGHER", "LOWER", "MAINTAIN"]).nullable().optional(),
  isNorthStar: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const kraId = searchParams.get("kraId");
  const userId = searchParams.get("userId");

  // KPI definitions are org reference data, but a person's RECORDS are
  // not: reading someone else's readings requires self / report-tree /
  // org-wide standing (three-door scoping).
  if (userId && !(await canTouchUserAlignment(session, userId))) {
    return jsonError("You can only view KPI records for yourself or your reports.", 403);
  }

  const where: Prisma.KPIWhereInput = { organizationId: getOrgId(session) };
  if (kraId) where.kraId = kraId;

  const kpis = await prisma.kPI.findMany({
    where,
    include: {
      kra: { select: { id: true, name: true } },
      records: userId ? {
        where: { userId },
        orderBy: { period: "desc" },
        take: 6,
      } : false,
    },
    // North-star gauges first, then alphabetical.
    orderBy: KPI_ORDER,
  });

  return jsonSuccess(kpis);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "create");
  if (denied) return denied;

  const body = await req.json().catch(() => BAD_JSON);

  if (body === BAD_JSON) return badJson();
  const { name, description, type, unit, frequency, kraId, targetValue, targetLabel, lowerIsBetter, ownership, formula, baselineValue, baselineLabel } = body;
  const badEnumCreate = enumRefusal("type", type, KPI_TYPES) ?? enumRefusal("frequency", frequency, KPI_FREQUENCIES);
  if (badEnumCreate) return jsonError(badEnumCreate, 400);

  if (!name) return jsonError("KPI name is required");

  // Same spine as KRA→job title: a KPI is a gauge UNDER a result area, so
  // it cannot float on its own. (KRA → role → person is the whole chain;
  // a parentless KPI measures nothing anybody owns.) Legacy parentless
  // rows stay readable and re-homable via PATCH, no new ones are born.
  if (!kraId || typeof kraId !== "string") {
    return jsonError("KPI must sit under a KRA. Pick the result area (kraId) it measures.");
  }
  const parentKra = await prisma.kRA.findFirst({
    where: { id: kraId, organizationId: getOrgId(session) },
    select: { id: true },
  });
  if (!parentKra) return jsonError("KRA not found in this organization", 404);

  const parsedAlignment = alignmentFieldsSchema.safeParse(body);
  if (!parsedAlignment.success) {
    return jsonError("direction must be HIGHER, LOWER or MAINTAIN; isNorthStar must be a boolean");
  }
  const { direction, isNorthStar } = parsedAlignment.data;

  const kpi = await prisma.kPI.create({
    data: {
      name,
      description,
      type: type || "QUANTITATIVE",
      unit,
      frequency: frequency || "MONTHLY",
      targetValue: targetValue != null ? Number(targetValue) : null,
      targetLabel: targetLabel ?? null,
      lowerIsBetter: lowerIsBetter === true,
      // 🆕 Operating core, owned vs shared, formula, baseline.
      ownership: ownership === "SHARED" ? "SHARED" : "OWNED",
      // Direction of "good" (wins over lowerIsBetter when set) + north star.
      direction: direction ?? null,
      isNorthStar: isNorthStar === true,
      formula: formula ?? null,
      baselineValue: baselineValue != null ? Number(baselineValue) : null,
      baselineLabel: baselineLabel ?? null,
      kraId,
      organizationId: getOrgId(session),
    },
  });

  return jsonSuccess(kpi, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "edit");
  if (denied) return denied;

  const body = await req.json().catch(() => BAD_JSON);

  if (body === BAD_JSON) return badJson();
  const { id, name, description, type, unit, frequency, kraId, targetValue, targetLabel, lowerIsBetter, ownership, formula, baselineValue, baselineLabel } = body;
  const badEnumEdit = enumRefusal("type", type, KPI_TYPES) ?? enumRefusal("frequency", frequency, KPI_FREQUENCIES);
  if (badEnumEdit) return jsonError(badEnumEdit, 400);

  if (!id) return jsonError("KPI id is required");

  const parsedAlignment = alignmentFieldsSchema.safeParse(body);
  if (!parsedAlignment.success) {
    return jsonError("direction must be HIGHER, LOWER or MAINTAIN; isNorthStar must be a boolean");
  }
  const { direction, isNorthStar } = parsedAlignment.data;

  const existing = await prisma.kPI.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("KPI not found", 404);
  // The company wall (pen test 2026-11-28, V-03): the create checked the KRA,
  // the edit did not, and a KPI moved under another company's KRA showed on
  // that company's job title page, where they could not remove it.
  if (kraId !== undefined && kraId !== null && kraId !== "") {
    if (typeof kraId !== "string" || !(await allOwned("kra", [kraId], getOrgId(session)))) return jsonError("KRA not found", 404);
  }

  const kpi = await prisma.kPI.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(type !== undefined && { type }),
      ...(unit !== undefined && { unit }),
      ...(frequency !== undefined && { frequency }),
      ...(kraId !== undefined && { kraId: kraId || null }),
      ...(targetValue !== undefined && { targetValue: targetValue != null ? Number(targetValue) : null }),
      ...(targetLabel !== undefined && { targetLabel: targetLabel || null }),
      ...(lowerIsBetter !== undefined && { lowerIsBetter: lowerIsBetter === true }),
      // Direction of "good", null clears back to the lowerIsBetter fallback.
      ...(direction !== undefined && { direction }),
      ...(isNorthStar !== undefined && { isNorthStar }),
      // 🆕 Operating core fields.
      ...(ownership !== undefined && { ownership: ownership === "SHARED" ? "SHARED" : "OWNED" }),
      ...(formula !== undefined && { formula: formula || null }),
      ...(baselineValue !== undefined && { baselineValue: baselineValue != null ? Number(baselineValue) : null }),
      ...(baselineLabel !== undefined && { baselineLabel: baselineLabel || null }),
    },
  });

  // A KPI's target or direction feeds the goals it measures (V-32).
  refreshGoalsFedBy(getOrgId(session), [id]);
  return jsonSuccess(kpi);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "delete");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("KPI id is required");

  const existing = await prisma.kPI.findFirst({
    where: { id, organizationId: getOrgId(session) },
    select: { id: true, _count: { select: { records: true, keyResults: true } } },
  });
  if (!existing) return jsonError("KPI not found", 404);
  // A delete takes every person's recorded values with it, and unlinks the
  // goals it feeds (pen test 2026-11-28, V-12: any team lead or manager did
  // it, with no undo). In use (values recorded, or a goal fed by it), only
  // the org-wide roles may (Admin, Owner, HR, executives: the roles trusted
  // with anyone's KRAs); a KPI nothing uses yet stays a manager's to remove.
  if ((existing._count.records > 0 || existing._count.keyResults > 0) && !isOrgWideAlignment(session)) {
    return jsonError("This KPI has recorded values or feeds a goal. Only an Admin, the Owner, HR or an executive can delete it.", 403);
  }

  // The goals it feeds, read before the delete unlinks them, re-saved after (V-32).
  const fedGoals = await goalsFedBy(getOrgId(session), [id]);
  await prisma.kPI.delete({ where: { id } });
  await refreshGoals(getOrgId(session), fedGoals);

  return jsonSuccess({ message: "KPI deleted" });
}
