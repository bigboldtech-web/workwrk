// GET /api/helpdesk/customers — list, with open ticket counts
// POST /api/helpdesk/customers — create (upsert by email)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const customers = await prisma.supportCustomer.findMany({
    where: { organizationId: ctx.orgId },
    include: {
      _count: { select: { tickets: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ customers });
}

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().max(160).optional(),
  companyName: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  notes: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const customer = await prisma.supportCustomer.upsert({
    where: { organizationId_email: { organizationId: ctx.orgId, email: parsed.data.email } },
    create: {
      organizationId: ctx.orgId,
      email: parsed.data.email,
      name: parsed.data.name,
      companyName: parsed.data.companyName,
      phone: parsed.data.phone,
      notes: parsed.data.notes,
    },
    update: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.companyName !== undefined ? { companyName: parsed.data.companyName } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    },
  });
  return NextResponse.json({ customer });
}
