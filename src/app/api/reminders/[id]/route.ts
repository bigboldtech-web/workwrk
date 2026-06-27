// /api/reminders/[id] — dismiss a reminder.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions);
  const u = s?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await prisma.reminder.findFirst({ where: { id, userId: u.id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const reminder = await prisma.reminder.update({ where: { id }, data: { status: "DISMISSED" } });
  return NextResponse.json({ reminder });
}
