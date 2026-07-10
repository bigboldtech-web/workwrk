// /api/reminders — personal reminders (create + list mine).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctx() {
  const s = await getServerSession(authOptions);
  const u = s?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return null;
  return { userId: u.id, orgId: u.organizationId };
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  remindAt: z.string(),
  notifyEmail: z.boolean().optional(),
  // Optional entity link — task reminders pass entityType "BOARD_ITEM" + the
  // item id so the bell can deep-link and recurrence can re-arm them.
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
});

export async function GET(req: Request) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Optional ?entityType=&entityId= scopes to one entity's reminders (used by
  // the task Schedule → Reminder tab); no filter = all my pending reminders
  // (the topbar bell).
  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const reminders = await prisma.reminder.findMany({
    where: {
      userId: c.userId,
      status: "PENDING",
      ...(entityType && entityId ? { entityType, entityId } : {}),
    },
    orderBy: { remindAt: "asc" },
    take: 100,
  });
  return NextResponse.json({ reminders });
}

export async function POST(req: Request) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const remindAt = new Date(parsed.data.remindAt);
  if (isNaN(remindAt.getTime())) return NextResponse.json({ error: "invalid remindAt" }, { status: 400 });
  const reminder = await prisma.reminder.create({
    data: {
      organizationId: c.orgId, userId: c.userId,
      title: parsed.data.title, body: parsed.data.body ?? null,
      remindAt, notifyEmail: parsed.data.notifyEmail ?? false,
      entityType: parsed.data.entityType ?? null,
      entityId: parsed.data.entityId ?? null,
    },
  });
  return NextResponse.json({ reminder }, { status: 201 });
}
