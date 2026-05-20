// GET /api/autopilot/workflows — list AUTOMATION workflows + recent runs
// POST /api/autopilot/workflows — create a new automation
// PATCH — toggle active / edit (handled by /[id])
//
// Distinct from /api/workflows (legacy approval chain endpoint).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, accessLevel: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  return { userId: user.id, orgId: user.organizationId, accessLevel: user.accessLevel };
}

function adminOnly(c: { accessLevel: string | null | undefined }) {
  return c.accessLevel === "SUPER_ADMIN" || c.accessLevel === "COMPANY_ADMIN";
}

export async function GET() {
  const c = await ctx();
  if ("error" in c) return c.error;

  const workflows = await prisma.workflow.findMany({
    where: { organizationId: c.orgId, kind: "AUTOMATION" },
    orderBy: { updatedAt: "desc" },
  });
  const recentRuns = await prisma.workflowRun.findMany({
    where: { organizationId: c.orgId, workflow: { kind: "AUTOMATION" } },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { workflow: { select: { name: true, triggerEvent: true } } },
  });
  return NextResponse.json({ workflows, recentRuns });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  triggerEvent: z.string().min(1).max(80),
  targetType: z.string().max(40).optional(),
  conditions: z.unknown().optional(),
  steps: z.array(z.object({
    type: z.enum(["notify", "create_task", "log"]),
    config: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(20),
  active: z.boolean().optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!adminOnly(c)) return NextResponse.json({ error: "admin only" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });

  try {
    // Default targetType derived from triggerEvent prefix (e.g.
    // "lead.created" → "LEAD"). Admins can override.
    const targetType = parsed.data.targetType
      ?? (parsed.data.triggerEvent.split(".")[0] ?? "GENERIC").toUpperCase();

    const wf = await prisma.workflow.create({
      data: {
        organizationId: c.orgId,
        name: parsed.data.name,
        kind: "AUTOMATION",
        triggerEvent: parsed.data.triggerEvent,
        targetType,
        conditions: (parsed.data.conditions ?? {}) as object,
        steps: parsed.data.steps as object,
        active: parsed.data.active ?? true,
      },
    });
    return NextResponse.json({ workflow: wf });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return NextResponse.json({ error: "name already exists" }, { status: 409 });
    }
    throw e;
  }
}
