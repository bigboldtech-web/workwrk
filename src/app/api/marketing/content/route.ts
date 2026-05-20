// GET/POST /api/marketing/content — content calendar items

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const items = await prisma.contentItem.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  return NextResponse.json({ items });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(["BLOG_POST", "EMAIL", "SOCIAL_POST", "VIDEO", "PODCAST", "WHITEPAPER", "EBOOK", "CASE_STUDY", "WEBINAR", "ONE_PAGER", "PRESS_RELEASE", "OTHER"]).optional(),
  channel: z.string().max(80).optional(),
  scheduledFor: z.string().optional(),
  campaignId: z.string().optional(),
  notes: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const item = await prisma.contentItem.create({
    data: {
      organizationId: ctx.orgId,
      title: parsed.data.title,
      type: parsed.data.type ?? "BLOG_POST",
      channel: parsed.data.channel,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      campaignId: parsed.data.campaignId,
      notes: parsed.data.notes,
      ownerId: ctx.userId,
      authorId: ctx.userId,
    },
  });
  return NextResponse.json({ item });
}

const patchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(300).optional(),
  type: z.enum(["BLOG_POST", "EMAIL", "SOCIAL_POST", "VIDEO", "PODCAST", "WHITEPAPER", "EBOOK", "CASE_STUDY", "WEBINAR", "ONE_PAGER", "PRESS_RELEASE", "OTHER"]).optional(),
  status: z.enum(["IDEA", "BRIEFED", "IN_DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  channel: z.string().max(80).nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.contentItem.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date();
  const item = await prisma.contentItem.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.channel !== undefined ? { channel: parsed.data.channel } : {}),
      ...(parsed.data.scheduledFor !== undefined ? { scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      // PUBLISHED status auto-stamps publishedAt on first transition.
      ...(parsed.data.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: now } : {}),
    },
  });
  return NextResponse.json({ item });
}
