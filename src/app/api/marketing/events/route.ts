// GET/POST /api/marketing/events — event briefs (conferences, webinars, ...)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const events = await prisma.eventBrief.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ events });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  type: z.string().max(80).optional(),
  format: z.string().max(40).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().max(200).optional(),
  capacity: z.number().int().nonnegative().optional(),
  budget: z.number().nonnegative().optional(),
  url: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const event = await prisma.eventBrief.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      description: parsed.data.description,
      type: parsed.data.type,
      format: parsed.data.format,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      location: parsed.data.location,
      capacity: parsed.data.capacity,
      budget: parsed.data.budget,
      url: parsed.data.url,
      ownerId: ctx.userId,
    },
  });
  return NextResponse.json({ event });
}
