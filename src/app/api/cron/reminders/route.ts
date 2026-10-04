// /api/cron/reminders — scheduled firing of ALL due reminders org-wide (for
// when users are offline). Accepts either `x-cron-secret: <secret>` or
// `Authorization: Bearer <secret>` (same as /api/cron/recurring-tasks), so every
// WorkwrK cron can use one identical header. Register ~every 5 min.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fireReminder } from "@/lib/reminders";
import { cronRefusal } from "@/lib/cron-auth";

export async function POST(req: Request) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const due = await prisma.reminder.findMany({
    where: { status: "PENDING", remindAt: { lte: new Date() } },
    take: 500,
  });
  let fired = 0;
  for (const r of due) {
    // fireReminder claims PENDING → FIRED atomically; false = another worker
    // (the per-user ticker) beat us to this row.
    try { if (await fireReminder(r)) fired++; } catch (e) { console.error("fireReminder failed", e); }
  }
  return NextResponse.json({ fired, scanned: due.length });
}
