// GET /api/crm/accounts — list this org's accounts
// POST /api/crm/accounts — create an account

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCrmContext } from "@/lib/crm/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const accounts = await prisma.account.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { opportunities: true } },
    },
    take: 200,
  });

  return NextResponse.json({ accounts });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  domain: z.string().max(120).optional(),
  industry: z.string().max(80).optional(),
  size: z.string().max(40).optional(),
  website: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  description: z.string().max(4000).optional(),
  type: z.enum(["PROSPECT", "CUSTOMER", "PARTNER", "CHURNED", "COMPETITOR"]).optional(),
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

  try {
    const account = await prisma.account.create({
      data: {
        organizationId: ctx.orgId,
        name: parsed.data.name,
        domain: parsed.data.domain,
        industry: parsed.data.industry,
        size: parsed.data.size,
        website: parsed.data.website,
        phone: parsed.data.phone,
        description: parsed.data.description,
        type: parsed.data.type ?? "PROSPECT",
        ownerId: parsed.data.ownerId ?? ctx.userId,
      },
    });
    return NextResponse.json({ account });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return NextResponse.json({ error: "an account with that name already exists" }, { status: 409 });
    }
    throw e;
  }
}
