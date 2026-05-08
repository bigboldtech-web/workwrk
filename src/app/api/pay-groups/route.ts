// Pay groups — list + create. Org-admin only. A pay group ties a
// frequency + currency + anchor date together; pay runs roll up
// against it.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

const VALID_FREQ = new Set(["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"]);

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const groups = await prisma.payGroup.findMany({
    where: { organizationId: orgId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { payRuns: true, payslips: true } } },
  });
  return jsonSuccess(groups);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name is required");
  if (name.length > 80) return jsonError("name too long");

  const frequency = typeof body.frequency === "string" ? body.frequency.toUpperCase() : "BIWEEKLY";
  if (!VALID_FREQ.has(frequency)) return jsonError("invalid frequency");

  const country = typeof body.country === "string" ? body.country.trim().toUpperCase() : "US";
  if (country.length !== 2) return jsonError("country must be a 2-letter ISO code");

  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "USD";
  if (currency.length !== 3) return jsonError("currency must be a 3-letter code");

  const anchorRaw = typeof body.anchorDate === "string" ? body.anchorDate : null;
  const anchorDate = anchorRaw ? new Date(anchorRaw) : null;
  if (!anchorDate || Number.isNaN(anchorDate.getTime())) return jsonError("anchorDate required (YYYY-MM-DD)");

  const offset = Math.max(0, Math.min(30, Number(body.payOffsetDays) || 3));

  const orgId = getOrgId(session);
  try {
    const group = await prisma.payGroup.create({
      data: {
        organizationId: orgId,
        name,
        country,
        currency,
        frequency: frequency as "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY",
        anchorDate,
        payOffsetDays: offset,
      },
    });
    return jsonSuccess(group, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("A pay group with that name already exists", 409);
    }
    throw e;
  }
}
