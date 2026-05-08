// Timesheets — server-rendered shell. Fetches the caller's current
// week timesheet (auto-creating if absent), all entries, and the
// active punch (if any). Hands off to the client manager for
// interactivity.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { weekStartUTC } from "@/lib/timesheet-week";
import { TimesheetManager, type TimesheetData, type TimeEntryRow } from "./timesheet-manager";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = (session.user as { id: string }).id;
  const orgId = (session.user as { organizationId: string }).organizationId;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const isManager = !["EMPLOYEE", "AGENT"].includes(accessLevel);

  const weekStart = weekStartUTC();

  // Auto-create the week's timesheet if missing. Catches the unique-
  // constraint race with a re-fetch.
  let timesheet = await prisma.timesheet.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
    include: {
      entries: {
        orderBy: { day: "asc" },
        include: { task: { select: { id: true, title: true } } },
      },
    },
  });
  if (!timesheet) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    try {
      await prisma.timesheet.create({
        data: {
          organizationId: orgId,
          userId,
          weekStartDate: weekStart,
          approverId: me?.managerId ?? null,
        },
      });
    } catch {
      // ignore — concurrent create lost; we'll re-fetch
    }
    timesheet = await prisma.timesheet.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
      include: {
        entries: {
          orderBy: { day: "asc" },
          include: { task: { select: { id: true, title: true } } },
        },
      },
    });
  }
  if (!timesheet) {
    return <div className="p-8 text-sm text-muted">Couldn't load timesheet.</div>;
  }

  const active = await prisma.timeEntry.findFirst({
    where: { userId, clockedInAt: { not: null }, clockedOutAt: null },
    select: {
      id: true,
      day: true,
      clockedInAt: true,
      description: true,
      task: { select: { id: true, title: true } },
    },
  });

  const initial: TimesheetData = {
    id: timesheet.id,
    weekStartDate: timesheet.weekStartDate.toISOString(),
    status: timesheet.status,
    entries: timesheet.entries.map<TimeEntryRow>((e) => ({
      id: e.id,
      day: e.day.toISOString(),
      hours: e.hours === null ? null : Number(e.hours),
      clockedInAt: e.clockedInAt?.toISOString() ?? null,
      clockedOutAt: e.clockedOutAt?.toISOString() ?? null,
      description: e.description,
      source: e.source,
      task: e.task,
    })),
  };

  return (
    <TimesheetManager
      initial={initial}
      activePunch={
        active
          ? {
              id: active.id,
              day: active.day.toISOString(),
              clockedInAt: active.clockedInAt!.toISOString(),
              description: active.description,
              task: active.task,
            }
          : null
      }
      isManager={isManager}
    />
  );
}
