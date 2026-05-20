// GET/POST/PATCH /api/legal/privacy-requests — GDPR/CCPA DSARs
//
// On create, dueAt is auto-computed from jurisdiction SLA:
//   GDPR: 30 days (extendable to 90)
//   CCPA: 45 days (extendable to 90)
//   Other: 30 days default

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

function slaDays(jurisdiction: string | undefined) {
  if (jurisdiction === "GDPR") return 30;
  if (jurisdiction === "CCPA") return 45;
  if (jurisdiction === "LGPD") return 15;
  if (jurisdiction === "PIPEDA") return 30;
  return 30;
}

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const requests = await prisma.privacyRequest.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 200,
  });
  return NextResponse.json({ requests });
}

const createSchema = z.object({
  type: z.enum(["ACCESS", "RECTIFICATION", "DELETION", "PORTABILITY", "OBJECTION", "CONSENT_WITHDRAWAL", "RESTRICTION", "AUTOMATED_DECISION"]),
  subjectEmail: z.string().email(),
  subjectName: z.string().max(160).optional(),
  jurisdiction: z.string().max(40).optional(),
  notes: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const receivedAt = new Date();
  const dueAt = new Date(receivedAt.getTime() + slaDays(parsed.data.jurisdiction) * 24 * 60 * 60 * 1000);

  const request = await prisma.privacyRequest.create({
    data: {
      organizationId: ctx.orgId,
      type: parsed.data.type,
      subjectEmail: parsed.data.subjectEmail,
      subjectName: parsed.data.subjectName,
      jurisdiction: parsed.data.jurisdiction,
      notes: parsed.data.notes,
      receivedAt,
      dueAt,
      assigneeId: ctx.userId,
    },
  });
  return NextResponse.json({ request });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["RECEIVED", "VERIFYING", "IN_PROGRESS", "PENDING_REVIEW", "COMPLETED", "DENIED", "CANCELLED"]).optional(),
  verified: z.boolean().optional(),
  resolutionNotes: z.string().max(8000).optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.privacyRequest.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date();
  const completedAt = parsed.data.status === "COMPLETED" && !existing.completedAt ? now : undefined;
  const verifiedAt = parsed.data.verified === true && !existing.verifiedAt ? now : parsed.data.verified === false ? null : undefined;

  const request = await prisma.privacyRequest.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.resolutionNotes !== undefined ? { resolutionNotes: parsed.data.resolutionNotes } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(verifiedAt !== undefined ? { verifiedAt } : {}),
    },
  });
  return NextResponse.json({ request });
}
