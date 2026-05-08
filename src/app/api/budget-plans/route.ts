// Budget plans — list + create. Org-admin only.
//
// Creating a plan auto-creates a default scenario (`Base`) so the
// org can start adding lines without picking a scenario first.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

const VALID_TYPES = new Set(["BUDGET", "FORECAST", "STRATEGIC", "WHAT_IF"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const fiscalYearId = sp.get("fiscalYearId");
  const status = sp.get("status")?.toUpperCase();

  const where: Record<string, unknown> = { organizationId: orgId };
  if (fiscalYearId) where.fiscalYearId = fiscalYearId;
  if (status) where.status = status;

  const plans = await prisma.budgetPlan.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: {
      fiscalYear: { select: { id: true, label: true } },
      scenarios: { select: { id: true, name: true, isDefault: true } },
      _count: { select: { lines: true } },
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
  if (!name) return jsonError("name required");
  if (name.length > 120) return jsonError("name too long");

  const type = typeof body.type === "string" ? body.type.toUpperCase() : "BUDGET";
  if (!VALID_TYPES.has(type)) return jsonError("invalid type");

  const fiscalYearId = typeof body.fiscalYearId === "string" ? body.fiscalYearId : "";
  if (!fiscalYearId) return jsonError("fiscalYearId required");

  const orgId = getOrgId(session);
  const fy = await prisma.fiscalYear.findFirst({
    where: { id: fiscalYearId, organizationId: orgId },
    select: { id: true },
  });
  if (!fy) return jsonError("fiscal year not found", 404);

  try {
    const plan = await prisma.budgetPlan.create({
      data: {
        organizationId: orgId,
        fiscalYearId,
        name,
        type: type as "BUDGET" | "FORECAST" | "STRATEGIC" | "WHAT_IF",
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        scenarios: {
          create: [{ organizationId: orgId, name: "Base", isDefault: true }],
        },
      },
      include: { scenarios: true },
    });
    return jsonSuccess(plan, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("A plan with that name + version already exists", 409);
    }
    throw e;
  }
}
