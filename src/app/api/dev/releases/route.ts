// GET/POST /api/dev/releases

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const releases = await prisma.release.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json({ releases });
}

const createSchema = z.object({
  version: z.string().min(1).max(40),
  name: z.string().max(120).optional(),
  description: z.string().max(8000).optional(),
  changelog: z.string().max(20000).optional(),
  releaseType: z.string().max(20).optional(),
  scheduledFor: z.string().optional(),
  isPublic: z.boolean().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    const release = await prisma.release.create({
      data: {
        organizationId: ctx.orgId,
        version: parsed.data.version,
        name: parsed.data.name,
        description: parsed.data.description,
        changelog: parsed.data.changelog,
        releaseType: parsed.data.releaseType,
        scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
        isPublic: parsed.data.isPublic ?? false,
      },
    });
    return NextResponse.json({ release });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return NextResponse.json({ error: "version already exists" }, { status: 409 });
    }
    throw e;
  }
}
