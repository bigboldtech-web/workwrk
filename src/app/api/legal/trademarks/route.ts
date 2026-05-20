// GET/POST /api/legal/trademarks — IP portfolio

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const trademarks = await prisma.trademark.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ renewalDueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ trademarks });
}

const createSchema = z.object({
  mark: z.string().min(1).max(200),
  type: z.enum(["WORD_MARK", "DESIGN_MARK", "COMBINED_MARK", "SOUND_MARK", "COLOR_MARK", "PATENT", "COPYRIGHT", "TRADE_SECRET", "DOMAIN_NAME"]).optional(),
  jurisdictions: z.array(z.string()).optional(),
  classes: z.array(z.number().int()).optional(),
  registrationNumber: z.string().max(80).optional(),
  applicationNumber: z.string().max(80).optional(),
  filedAt: z.string().optional(),
  registeredAt: z.string().optional(),
  expiresAt: z.string().optional(),
  renewalDueAt: z.string().optional(),
  externalCounselFirm: z.string().max(160).optional(),
  notes: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const trademark = await prisma.trademark.create({
    data: {
      organizationId: ctx.orgId,
      mark: parsed.data.mark,
      type: parsed.data.type ?? "WORD_MARK",
      jurisdictions: (parsed.data.jurisdictions ?? []) as object,
      classes: (parsed.data.classes ?? []) as object,
      registrationNumber: parsed.data.registrationNumber,
      applicationNumber: parsed.data.applicationNumber,
      filedAt: parsed.data.filedAt ? new Date(parsed.data.filedAt) : null,
      registeredAt: parsed.data.registeredAt ? new Date(parsed.data.registeredAt) : null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      renewalDueAt: parsed.data.renewalDueAt ? new Date(parsed.data.renewalDueAt) : null,
      externalCounselFirm: parsed.data.externalCounselFirm,
      notes: parsed.data.notes,
      ownerId: ctx.userId,
    },
  });
  return NextResponse.json({ trademark });
}
