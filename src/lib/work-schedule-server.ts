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
 * Whether a query failed because the schema is not there yet: the table
 * (P2021) or one of its columns (P2022), which is what a release deployed
 * ahead of prisma/sql/2026-09-22-work-schedule.sql sees. Any other failure
 * (the pool, a timeout, the network) is a real one.
 */
export function isSchemaMissing(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/**
 * The organization's schedule, the defaults when no row or no table is there,
 * and a THROW for any other failure.
 *
 * The settings card and its PUT read through this, never through the
 * forgiving reader below. Defaults standing in for a failed read are harmless
 * on a capacity grid, but on the one surface that writes the record they are
 * a lie the admin can save: the card would show Monday to Friday as if it
 * were real, and its first save would write it over the real week.
 */
export async function readOrgWorkScheduleStrict(organizationId: string): Promise<WorkSchedule> {
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
  } catch (e) {
    if (isSchemaMissing(e)) return WORK_SCHEDULE_DEFAULTS;
    throw e;
  }
}

/**
 * The organization's schedule, or the defaults.
 *
 * NEVER THROWS, and that is load-bearing rather than defensive habit: the
 * two callers are a Workload grid and a Timesheets list, and neither is
 * allowed to fail because a schema file has not been applied yet. The catch
 * covers exactly two cases, and both mean the same thing to a reader: the
 * table is not there (a release ahead of the SQL), or the query failed.
 * Nothing that WRITES the record reads through this (readOrgWorkScheduleStrict).
 */
export async function readOrgWorkSchedule(organizationId: string): Promise<WorkSchedule> {
  try {
    return await readOrgWorkScheduleStrict(organizationId);
  } catch {
    return WORK_SCHEDULE_DEFAULTS;
  }
}
