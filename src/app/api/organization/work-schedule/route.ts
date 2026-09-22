// GET / PUT /api/organization/work-schedule
//
// The organization's working calendar: which days are work days, how long a
// work day is, its zone, and its holidays. Decided addition (b),
// docs/plans/competitor-gap-2026-09.md section 7.
//
// GET is for EVERY member, like /api/organization/culture, because the two
// surfaces that spend it (the Workload grid's capacity columns and the
// Timesheets week card's expected hours) are things a Member looks at.
// Knowing that the company works Monday to Friday is not privileged.
//
// PUT is Owner and Admin only: it changes what "a full week" means for
// everybody's timesheet, which is the same weight as a payroll setting.
//
// THE ROW MAY NOT EXIST, AND THE TABLE MAY NOT EITHER. GET answers the
// defaults in both cases (readOrgWorkSchedule swallows the missing-table
// error on purpose, see src/lib/work-schedule-server.ts), so this never
// 500s a Workload grid because prisma/sql/2026-09-22-work-schedule.sql has
// not been applied yet. PUT is the one place that surfaces the failure,
// because a save that silently did nothing is the worse outcome there.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, isOrgAdmin, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { parseWorkSchedule, WORK_SCHEDULE_DEFAULTS } from "@/lib/work-schedule";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const schedule = await readOrgWorkSchedule(getOrgId(session));
  // `configured` lets a settings page tell "the admin chose Monday to
  // Friday" from "nobody has been here yet" without a second request, and
  // lets a reader tell a real answer from the fallback.
  const configured = schedule !== WORK_SCHEDULE_DEFAULTS;
  return jsonSuccess({ schedule, configured, canEdit: isOrgAdmin(session) });
}

export async function PUT(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only an Owner or an Admin can change the working calendar.", 403);

  const orgId = getOrgId(session);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Body must be JSON");
  }

  // A PATCH IN PUT'S CLOTHING, AND DELIBERATELY SO. parseWorkSchedule fills
  // an absent key with the DEFAULT, so a client that sent only `holidays`
  // silently reset the workweek to Monday-to-Friday and the day to eight
  // hours: the admin added a bank holiday and quietly undid a four-day week.
  // The body is parsed OVER the record that is already there, so an absent
  // key means "leave it alone" and only what was sent can change.
  const current = await readOrgWorkSchedule(orgId);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const next = parseWorkSchedule({
    workdays: b.workdays === undefined ? current.workdays : b.workdays,
    hoursPerDay: b.hoursPerDay === undefined ? current.hoursPerDay : b.hoursPerDay,
    timezone: b.timezone === undefined ? current.timezone : b.timezone,
    holidays: b.holidays === undefined ? current.holidays : b.holidays,
  });

  try {
    const saved = await prisma.workSchedule.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        workdays: next.workdays,
        hoursPerDay: next.hoursPerDay,
        timezone: next.timezone,
        // Cast: the column is Json and Prisma wants its own InputJsonValue.
        // The value is already normalised by parseWorkSchedule, so this is
        // a shape the reader will accept back.
        holidays: next.holidays as unknown as Prisma.InputJsonValue,
      },
      update: {
        workdays: next.workdays,
        hoursPerDay: next.hoursPerDay,
        timezone: next.timezone,
        holidays: next.holidays as unknown as Prisma.InputJsonValue,
      },
      select: { workdays: true, hoursPerDay: true, timezone: true, holidays: true },
    });

    logActivity({
      type: "work_schedule_changed",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Changed the working calendar to ${next.workdays.length} day(s) a week at ${next.hoursPerDay} hours`,
      targetId: orgId,
      targetType: "organization",
      metadata: { workdays: next.workdays, hoursPerDay: next.hoursPerDay, holidays: next.holidays.length },
    });

    return jsonSuccess({
      schedule: parseWorkSchedule({ ...saved, hoursPerDay: Number(saved.hoursPerDay) }),
      configured: true,
    });
  } catch {
    // The one honest failure: the table is not there yet. Say which file
    // fixes it rather than "Something went wrong", because the only person
    // who can see this message is the person who can apply it.
    return jsonError(
      "The working calendar is not set up on this database yet. Apply prisma/sql/2026-09-22-work-schedule.sql.",
      503,
    );
  }
}
