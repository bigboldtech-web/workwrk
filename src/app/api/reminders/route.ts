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

type ReminderRow = { entityType: string | null; entityId: string | null };

/** Blank the entity link on any BOARD_ITEM reminder whose task is no longer a
 *  live, openable item (hard-deleted, in another org, or archived/trashed).
 *  The bell and the fired-reminder popup both render an "Open" deep-link
 *  straight from entityType/entityId — without this a reminder for a deleted
 *  or trashed task lands on /item/[id] as "Task not found". Stripping the link
 *  here degrades it to a plain personal reminder for every surface at once. */
async function stripDeadEntityLinks<T extends ReminderRow>(reminders: T[], orgId: string): Promise<T[]> {
  const itemIds = [
    ...new Set(
      reminders
        .filter((r) => r.entityType === "BOARD_ITEM" && r.entityId)
        .map((r) => r.entityId as string),
    ),
  ];
  if (itemIds.length === 0) return reminders;
  const live = await prisma.item.findMany({
    where: { id: { in: itemIds }, organizationId: orgId, archivedAt: null },
    select: { id: true },
  });
  const liveIds = new Set(live.map((i) => i.id));
  return reminders.map((r) =>
    r.entityType === "BOARD_ITEM" && r.entityId && !liveIds.has(r.entityId)
      ? { ...r, entityType: null, entityId: null }
      : r,
  );
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
  // the task Schedule → Reminder tab); no filter = all my reminders in the
  // requested state.
  //
  // ?status= selects the lifecycle slice (default PENDING, back-compat):
  //   PENDING   — upcoming, not yet fired (the bell's Overdue/Today/Upcoming
  //               groups + the task Reminder tab).
  //   FIRED     — fired but not yet acted on (the persistent popup + the bell's
  //               "Fired" section). A fired reminder used to vanish here because
  //               only PENDING was ever queried.
  //   DISMISSED — recently done, last 14 days (the bell's read-only history so
  //               a missed/handled reminder stays findable).
  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const entityFilter = entityType && entityId ? { entityType, entityId } : {};
  const status = (url.searchParams.get("status") || "PENDING").toUpperCase();

  if (status === "FIRED") {
    const rows = await prisma.reminder.findMany({
      where: { userId: c.userId, status: "FIRED", ...entityFilter },
      orderBy: { firedAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ reminders: await stripDeadEntityLinks(rows, c.orgId) });
  }

  if (status === "DISMISSED") {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const rows = await prisma.reminder.findMany({
      where: { userId: c.userId, status: "DISMISSED", updatedAt: { gte: since }, ...entityFilter },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ reminders: await stripDeadEntityLinks(rows, c.orgId) });
  }

  const rows = await prisma.reminder.findMany({
    where: { userId: c.userId, status: "PENDING", ...entityFilter },
    orderBy: { remindAt: "asc" },
    take: 100,
  });
  return NextResponse.json({ reminders: await stripDeadEntityLinks(rows, c.orgId) });
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
