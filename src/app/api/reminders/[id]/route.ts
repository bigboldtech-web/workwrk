// /api/reminders/[id] — dismiss (default) or snooze/reschedule a reminder.
//   body {}                        → dismiss (mark DISMISSED)
//   body { remindAt: ISO }         → reschedule to that time, keep PENDING
//   body { snoozeMinutes: number } → push remindAt out by N minutes from now

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const patchSchema = z.object({
  remindAt: z.string().optional(),
  snoozeMinutes: z.number().int().positive().max(20160).optional(),
}).optional();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions);
  const u = s?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await prisma.reminder.findFirst({ where: { id, userId: u.id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : undefined;

  let next: Date | null = null;
  if (body?.remindAt) {
    const d = new Date(body.remindAt);
    if (!isNaN(d.getTime())) next = d;
  } else if (body?.snoozeMinutes) {
    next = new Date(Date.now() + body.snoozeMinutes * 60_000);
  }

  const reminder = next
    ? await prisma.reminder.update({ where: { id }, data: { remindAt: next, status: "PENDING", firedAt: null } })
    : await prisma.reminder.update({ where: { id }, data: { status: "DISMISSED" } });
  return NextResponse.json({ reminder });
}
