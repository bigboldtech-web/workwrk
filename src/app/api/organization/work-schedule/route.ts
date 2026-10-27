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
// defaults in both cases (readOrgWorkScheduleStrict treats the missing table
// as "nothing saved yet", see src/lib/work-schedule-server.ts), so this never
// 500s a Workload grid because prisma/sql/2026-09-22-work-schedule.sql has
// not been applied yet. PUT is the one place that surfaces the missing table,
// because a save that silently did nothing is the worse outcome there.
//
// A FAILED READ IS NEVER ANSWERED AS THE DEFAULTS (settings-cleanup Phase 5
// review, H1). Both handlers read strictly: a query that fails for any other
// reason answers 503 here, never Monday to Friday as if it were the record.
// The capacity hook already falls back to the defaults on a failed GET, so
// Workload and Timesheets draw exactly what they drew before; the settings
// card shows its error and Retry instead of a week it could save. And PUT
// takes `base`, the schedule the card last read: when the record is no
// longer that (another admin, another tab, a card that never really read
// it), nothing is written and the answer is 409.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import {
  WORK_SCHEDULE_CHANGED,
  WORK_SCHEDULE_DEFAULTS,
  WORK_SCHEDULE_READ_FAILED,
  parseWorkSchedule,
  sameWorkSchedule,
  type WorkSchedule,
} from "@/lib/work-schedule";
import { readOrgWorkScheduleStrict } from "@/lib/work-schedule-server";
import { sessionMayEditSettings, settingsWriteGate } from "@/lib/access/settings-write";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  let schedule: WorkSchedule;
  try {
    schedule = await readOrgWorkScheduleStrict(getOrgId(session));
  } catch {
    return jsonError(WORK_SCHEDULE_READ_FAILED, 503);
  }
  // `configured` lets a settings page tell "the admin chose Monday to
  // Friday" from "nobody has been here yet" without a second request, and
  // lets a reader tell a real answer from the fallback.
  const configured = schedule !== WORK_SCHEDULE_DEFAULTS;
  return jsonSuccess({ schedule, configured, canEdit: sessionMayEditSettings(session) });
}

export async function PUT(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "locale");
  if (!writeGate.ok) return writeGate.response;

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
  //
  // That merge is only honest over the record as it IS, so the read is
  // strict: over defaults standing in for a failed read, a body with one key
  // would write Monday to Friday for the rest.
  let current: WorkSchedule;
  try {
    current = await readOrgWorkScheduleStrict(orgId);
  } catch {
    return jsonError(`${WORK_SCHEDULE_READ_FAILED} Nothing was saved.`, 503);
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  // The schedule the writer last read. Absent (an older client) keeps the
  // old behaviour; present and no longer the record, nothing is written.
  if (b.base !== undefined && !sameWorkSchedule(b.base, current)) {
    return jsonError(WORK_SCHEDULE_CHANGED, 409);
  }
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
