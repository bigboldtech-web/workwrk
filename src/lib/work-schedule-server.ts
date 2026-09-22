// work-schedule-server.ts: the one database read of the organization's
// working calendar.
//
// Split from src/lib/work-schedule.ts because that file is imported by a
// client hook (use-work-schedule.ts) and by the Workload grid, and a prisma
// import at the top of a module in a client import graph pulls the whole
// client into the browser bundle. The pure math and the parsing live there;
// only this read lives here. Same split, same reason, as trash.ts and
// trash-server.ts.

import { prisma } from "@/lib/prisma";
import { parseWorkSchedule, WORK_SCHEDULE_DEFAULTS, type WorkSchedule } from "@/lib/work-schedule";

/**
 * The organization's schedule, or the defaults.
 *
 * NEVER THROWS, and that is load-bearing rather than defensive habit: the
 * two callers are a Workload grid and a Timesheets list, and neither is
 * allowed to fail because a schema file has not been applied yet. The catch
 * covers exactly two cases, and both mean the same thing to a reader: the
 * table is not there (a release ahead of the SQL), or the query failed.
 */
export async function readOrgWorkSchedule(organizationId: string): Promise<WorkSchedule> {
  try {
    const row = await prisma.workSchedule.findUnique({
      where: { organizationId },
      select: { workdays: true, hoursPerDay: true, timezone: true, holidays: true },
    });
    if (!row) return WORK_SCHEDULE_DEFAULTS;
    return parseWorkSchedule({
      workdays: row.workdays,
      // Decimal comes back as a Decimal instance, not a number.
      hoursPerDay: row.hoursPerDay === null ? undefined : Number(row.hoursPerDay),
      timezone: row.timezone,
      holidays: row.holidays,
    });
  } catch {
    return WORK_SCHEDULE_DEFAULTS;
  }
}
