// /api/reminders/tick — fire the CURRENT user's due reminders. Polled by the
// client (ReminderTicker) every minute while the app is open, so reminders go
// off without an external scheduler. Returns the ones it just fired.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fireReminder } from "@/lib/reminders";

export async function GET() {
  const s = await getServerSession(authOptions);
  const u = s?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const due = await prisma.reminder.findMany({
    where: { userId: u.id, status: "PENDING", remindAt: { lte: new Date() } },
    take: 20,
  });
  const fired: { id: string; title: string }[] = [];
  for (const r of due) {
    try { await fireReminder(r); fired.push({ id: r.id, title: r.title }); }
    catch (e) { console.error("fireReminder failed", e); }
  }
  return NextResponse.json({ fired });
}
