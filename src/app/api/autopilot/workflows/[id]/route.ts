// PATCH /api/autopilot/workflows/[id] — toggle active / edit
// DELETE — soft (set active=false) or hard? We hard-delete for now;
//          WorkflowRun rows survive via cascade=Cascade.

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
  if (user.accessLevel !== "SUPER_ADMIN" && user.accessLevel !== "COMPANY_ADMIN") return { error: NextResponse.json({ error: "admin only" }, { status: 403 }) };
  return { userId: user.id, orgId: user.organizationId };
}

const patchSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(1).max(120).optional(),
  conditions: z.unknown().optional(),
  steps: z.array(z.object({
    type: z.enum(["notify", "create_task", "log"]),
    config: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;

  const existing = await prisma.workflow.findFirst({
    where: { id, organizationId: c.orgId, kind: "AUTOMATION" },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const wf = await prisma.workflow.update({
    where: { id },
    data: {
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.conditions !== undefined ? { conditions: parsed.data.conditions as object } : {}),
      ...(parsed.data.steps !== undefined ? { steps: parsed.data.steps as object } : {}),
    },
  });
  return NextResponse.json({ workflow: wf });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;

  const existing = await prisma.workflow.findFirst({
    where: { id, organizationId: c.orgId, kind: "AUTOMATION" },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.workflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
