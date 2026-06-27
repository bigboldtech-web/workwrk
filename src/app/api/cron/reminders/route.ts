// /api/cron/reminders — scheduled firing of ALL due reminders org-wide (for
// when users are offline). Bearer-authed like the other crons; register on a
// frequent schedule (~every 5 min).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fireReminder } from "@/lib/reminders";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const due = await prisma.reminder.findMany({
    where: { status: "PENDING", remindAt: { lte: new Date() } },
    take: 500,
  });
  for (const r of due) {
    try { await fireReminder(r); } catch (e) { console.error("fireReminder failed", e); }
  }
  return NextResponse.json({ fired: due.length });
}
