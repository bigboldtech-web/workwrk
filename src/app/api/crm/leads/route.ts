// GET /api/crm/leads — list this org's leads
// POST /api/crm/leads — create a lead

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCrmContext } from "@/lib/crm/auth";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const leads = await prisma.lead.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(status ? { status: status as "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED" | "CONVERTED" | "DISQUALIFIED" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ leads });
}

const createSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  company: z.string().max(120).optional(),
  title: z.string().max(120).optional(),
  source: z.string().max(40).optional(),
  notes: z.string().max(4000).optional(),
  ownerId: z.string().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId: ctx.orgId,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email || undefined,
      phone: parsed.data.phone,
      company: parsed.data.company,
      title: parsed.data.title,
      source: parsed.data.source,
      notes: parsed.data.notes,
      ownerId: parsed.data.ownerId ?? ctx.userId,
    },
  });

  return NextResponse.json({ lead });
}
