// Overtime policies — list + create. Org-admin only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const policies = await prisma.overtimePolicy.findMany({
    where: { organizationId: orgId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return jsonSuccess(policies);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name required");
  if (name.length > 80) return jsonError("name too long");

  const jurisdiction = typeof body.jurisdiction === "string" ? body.jurisdiction.trim() : "";
  if (!jurisdiction) return jsonError("jurisdiction required");

  const orgId = getOrgId(session);
  try {
    const policy = await prisma.overtimePolicy.create({
      data: {
        organizationId: orgId,
        name,
        jurisdiction,
        dailyOtAfter: body.dailyOtAfter != null ? Number(body.dailyOtAfter) : null,
        dailyDtAfter: body.dailyDtAfter != null ? Number(body.dailyDtAfter) : null,
        weeklyOtAfter: body.weeklyOtAfter != null ? Number(body.weeklyOtAfter) : null,
        seventhDayOt: body.seventhDayOt === true,
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
      },
    });
    return jsonSuccess(policy, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("Policy with that name exists", 409);
    }
    throw e;
  }
}
