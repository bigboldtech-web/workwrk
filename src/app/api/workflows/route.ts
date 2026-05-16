// Workflows — list + create. Org-admin only. The `steps` JSON
// payload is validated structurally; per-step rules (approver
// resolution, SLA timers) are interpreted at run time.

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

type StepInput = {
  id: string;
  name: string;
  approverRule: "MANAGER" | "ADMIN" | "ROLE" | "USER";
  approverValue?: string; // role name or user id, depending on rule
  slaHours?: number;
  requireNote?: boolean;
};

const VALID_RULES = new Set(["MANAGER", "ADMIN", "ROLE", "USER"]);

function validateSteps(raw: unknown): StepInput[] | string {
  if (!Array.isArray(raw)) return "steps must be an array";
  if (raw.length === 0) return "at least one step required";
  if (raw.length > 20) return "max 20 steps";
  const out: StepInput[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") return "malformed step";
    const o = s as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) return "step.id required";
    if (typeof o.name !== "string" || !o.name) return "step.name required";
    if (typeof o.approverRule !== "string" || !VALID_RULES.has(o.approverRule)) return "step.approverRule invalid";
    out.push({
      id: o.id,
      name: o.name,
      approverRule: o.approverRule as StepInput["approverRule"],
      approverValue: typeof o.approverValue === "string" ? o.approverValue : undefined,
      slaHours: typeof o.slaHours === "number" ? o.slaHours : undefined,
      requireNote: o.requireNote === true,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const targetType = sp.get("targetType");

  const where: Record<string, unknown> = { organizationId: orgId };
  if (targetType) where.targetType = targetType;

  const flows = await prisma.workflow.findMany({
    where,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { runs: true } } },
  });
  return jsonSuccess(flows);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name required");
  if (name.length > 80) return jsonError("name too long");

  const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
  if (!targetType) return jsonError("targetType required");

  const stepsParsed = validateSteps(body.steps);
  if (typeof stepsParsed === "string") return jsonError(stepsParsed);

  const orgId = getOrgId(session);
  try {
    const flow = await prisma.workflow.create({
      data: {
        organizationId: orgId,
        name,
        targetType,
        steps: stepsParsed,
      },
    });

    logActivity({
      type: "workflow_created",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Created workflow "${name}" for ${targetType} (${stepsParsed.length} step${stepsParsed.length === 1 ? "" : "s"})`,
      targetId: flow.id,
      targetType: "workflow",
      metadata: { targetType, stepCount: stepsParsed.length },
    });

    return jsonSuccess(flow, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("A workflow with that name exists", 409);
    }
    throw e;
  }
}
