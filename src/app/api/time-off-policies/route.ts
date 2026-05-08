// Time-off policies — list + create. Org-admin only for create/edit;
// any signed-in user can read so the request UI can render the
// policy dropdown.

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
  "PTO",
  "SICK",
  "PERSONAL",
  "BEREAVEMENT",
  "PARENTAL",
  "UNPAID",
  "OTHER",
]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
  const where: Record<string, unknown> = { organizationId: orgId };
  if (!includeArchived) where.archived = false;

  const policies = await prisma.timeOffPolicy.findMany({
    where,
    orderBy: [{ archived: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      color: true,
      description: true,
      annualHours: true,
      carryoverHours: true,
      requiresApproval: true,
      archived: true,
    },
  });

  const serialized = policies.map((p) => ({
    ...p,
    annualHours: Number(p.annualHours),
    carryoverHours: Number(p.carryoverHours),
  }));

  return jsonSuccess(serialized);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type : "PTO";
  const color = typeof body.color === "string" ? body.color.trim() || null : null;
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const annualHours = Number(body.annualHours);
  const carryoverHours = body.carryoverHours === undefined ? 0 : Number(body.carryoverHours);
  const requiresApproval = body.requiresApproval !== false;

  if (!name) return jsonError("name is required");
  if (name.length > 80) return jsonError("name too long");
  if (!VALID_TYPES.has(type)) return jsonError("Invalid type");
  if (!Number.isFinite(annualHours) || annualHours < 0 || annualHours > 100_000) {
    return jsonError("Invalid annualHours");
  }
  if (!Number.isFinite(carryoverHours) || carryoverHours < 0 || carryoverHours > annualHours) {
    return jsonError("Invalid carryoverHours");
  }

  const orgId = getOrgId(session);

  const existing = await prisma.timeOffPolicy.findUnique({
    where: { organizationId_name: { organizationId: orgId, name } },
    select: { id: true },
  });
  if (existing) return jsonError("A policy with that name already exists", 409);

  const policy = await prisma.timeOffPolicy.create({
    data: {
      organizationId: orgId,
      name,
      type: type as never,
      color,
      description,
      annualHours,
      carryoverHours,
      requiresApproval,
    },
  });

  return jsonSuccess(
    {
      ...policy,
      annualHours: Number(policy.annualHours),
      carryoverHours: Number(policy.carryoverHours),
    },
    201,
  );
}
