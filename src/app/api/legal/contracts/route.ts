// GET/POST/PATCH /api/legal/contracts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const contracts = await prisma.contract.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ contracts });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  counterparty: z.string().min(1).max(160),
  counterpartyType: z.string().max(40).optional(),
  type: z.string().max(40).optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  effectiveDate: z.string().optional(),
  expiresAt: z.string().optional(),
  renewalNoticeDays: z.number().int().nonnegative().optional(),
  autoRenew: z.boolean().optional(),
  documentUrl: z.string().max(500).optional(),
  description: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const contract = await prisma.contract.create({
    data: {
      organizationId: ctx.orgId,
      title: parsed.data.title,
      counterparty: parsed.data.counterparty,
      counterpartyType: parsed.data.counterpartyType,
      type: parsed.data.type,
      value: parsed.data.value,
      currency: parsed.data.currency ?? "USD",
      effectiveDate: parsed.data.effectiveDate ? new Date(parsed.data.effectiveDate) : null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      renewalNoticeDays: parsed.data.renewalNoticeDays ?? 60,
      autoRenew: parsed.data.autoRenew ?? false,
      documentUrl: parsed.data.documentUrl,
      description: parsed.data.description,
      ownerId: ctx.userId,
    },
  });
  return NextResponse.json({ contract });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DRAFT", "IN_REVIEW", "IN_NEGOTIATION", "AWAITING_SIGNATURE", "SIGNED", "ACTIVE", "EXPIRED", "RENEWED", "TERMINATED", "CANCELLED"]).optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.contract.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date();
  // SIGNED → stamp signedAt if first time.
  const signedAt = parsed.data.status === "SIGNED" && !existing.signedAt ? now : undefined;

  const contract = await prisma.contract.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(signedAt ? { signedAt } : {}),
    },
  });
  return NextResponse.json({ contract });
}
