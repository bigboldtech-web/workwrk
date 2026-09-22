// /api/reminders/[id] - act on one of your own reminders.
//
//   PATCH { action: "dismiss" }      mark it done. THE EXPLICIT FORM.
//   PATCH {}                         the same thing, kept for older clients
//   PATCH { remindAt: ISO }          move it, keep it PENDING
//   PATCH { snoozeMinutes: N }       push it out N minutes from now
//   DELETE                           remove it outright
//
// WHY `action: "dismiss"` EXISTS (spec-planner section 2 Reminders, Data;
// audit time.md #31). An empty PATCH body meaning "dismiss" is a contract
// nobody can read at a call site: the task drawer's Reminder tab sent
// `PATCH {}` from a button labelled REMOVE, which marked the reminder
// DISMISSED and left the row in the database, so the tab looked like it had
// deleted something it had not. Both halves are fixed here: dismiss now has
// a word, and remove has a verb.
//
// The empty body still dismisses, deliberately. Two shipped surfaces send it
// (the ticker and the bell), and a release where an old tab's Dismiss button
// silently stops working is worse than a redundant spelling.
//
// OWNER ONLY. Every read is `findFirst({ id, userId })` and every miss is a
// 404: a reminder is a private note to yourself and an Admin has no
// read-around on it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const patchSchema = z
  .object({
    action: z.enum(["dismiss"]).optional(),
    remindAt: z.string().optional(),
    snoozeMinutes: z.number().int().positive().max(20160).optional(),
  })
  .optional();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions);
  const u = s?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await prisma.reminder.findFirst({ where: { id, userId: u.id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send action, remindAt or snoozeMinutes" }, { status: 400 });
  }
  const body = parsed.data;

  // A rescheduling body wins over `action`, so a client that sends both gets
  // the move rather than silently losing it to the dismiss.
  let next: Date | null = null;
  if (body?.remindAt) {
    const d = new Date(body.remindAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "remindAt must be a date" }, { status: 400 });
    }
    next = d;
  } else if (body?.snoozeMinutes) {
    next = new Date(Date.now() + body.snoozeMinutes * 60_000);
  }

  const reminder = next
    ? await prisma.reminder.update({ where: { id }, data: { remindAt: next, status: "PENDING", firedAt: null } })
    : await prisma.reminder.update({ where: { id }, data: { status: "DISMISSED" } });
  return NextResponse.json({ reminder });
}

/**
 * DELETE - remove the reminder row.
 *
 * The task drawer's Reminder tab calls this for "Remove", which is what its
 * button always claimed to do. Dismissing (PATCH) keeps the row so the bell's
 * "Recently done" group can show it; deleting does not, and that difference
 * is the whole reason both exist.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions);
  const u = s?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await prisma.reminder.findFirst({ where: { id, userId: u.id }, select: { id: true } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.reminder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
