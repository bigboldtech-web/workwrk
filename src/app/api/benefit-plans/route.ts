// Benefit plans — list + create. Org-admin only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

const VALID_TYPES = new Set([
  "MEDICAL", "DENTAL", "VISION", "LIFE",
  "DISABILITY_SHORT", "DISABILITY_LONG",
  "RETIREMENT_401K", "RETIREMENT_ROTH",
  "HSA", "FSA", "COMMUTER", "OTHER",
]);

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const plans = await prisma.benefitPlan.findMany({
    where: { organizationId: orgId },
    orderBy: [{ active: "desc" }, { type: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { enrollments: true, tiers: true } },
    },
  });
  return jsonSuccess(plans);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name is required");
  if (name.length > 120) return jsonError("name too long");

  const type = typeof body.type === "string" ? body.type.toUpperCase() : "";
  if (!VALID_TYPES.has(type)) return jsonError("invalid type");

  const effectiveFromRaw = typeof body.effectiveFrom === "string" ? body.effectiveFrom : null;
  const effectiveFrom = effectiveFromRaw ? new Date(effectiveFromRaw) : null;
  if (!effectiveFrom || Number.isNaN(effectiveFrom.getTime())) return jsonError("effectiveFrom required (YYYY-MM-DD)");

  const effectiveTo = typeof body.effectiveTo === "string" && body.effectiveTo
    ? new Date(body.effectiveTo)
    : null;
  if (effectiveTo && Number.isNaN(effectiveTo.getTime())) return jsonError("invalid effectiveTo");
  if (effectiveTo && effectiveTo <= effectiveFrom) return jsonError("effectiveTo must be after effectiveFrom");

  const employeeCost = Math.max(0, Number(body.employeeCost) || 0);
  const employerCost = Math.max(0, Number(body.employerCost) || 0);

  const orgId = getOrgId(session);
  try {
    const plan = await prisma.benefitPlan.create({
      data: {
        organizationId: orgId,
        type: type as "MEDICAL" | "DENTAL" | "VISION" | "LIFE" | "DISABILITY_SHORT" | "DISABILITY_LONG" | "RETIREMENT_401K" | "RETIREMENT_ROTH" | "HSA" | "FSA" | "COMMUTER" | "OTHER",
        name,
        carrier: typeof body.carrier === "string" ? body.carrier.trim() || null : null,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        employeeCost,
        employerCost,
        effectiveFrom,
        effectiveTo,
      },
    });
    return jsonSuccess(plan, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("A plan with that name already exists", 409);
    }
    throw e;
  }
}
