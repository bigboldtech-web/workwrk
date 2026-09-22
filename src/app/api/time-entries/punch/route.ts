// Clock in and clock out. GET returns the active punch, if any. POST
// starts or stops one.
//
// Body shape:
//   { action: "start" | "stop", itemId?: string, taskId?: string,
//     description?: string }
// "start" while already running is a no-op and returns the existing row
// with alreadyRunning: true.
//
// THE 16 HOUR RULE CHANGED IN PHASE 4. A punch left running overnight used
// to be refused at stop time with a 409, which left the person with a
// clock they could not stop and no way to record the hours they did work.
// spec-planner.md section 2 /clock Data now says: close the entry at
// start + 16h, prefix the description so it is findable, and answer
// { autoStopped: true } so the page can say what happened. The row is
// never deleted and never silently dropped.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { weekStartUTC } from "@/lib/timesheet-week";
import { utcDayKey, dayStartInZone } from "@/lib/time-format";
import { logAuditEvent } from "@/lib/activity";
import { getEffectivePreferences } from "@/lib/preferences";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";

/**
 * The punching person's own IANA zone (home.locale.timezone), or null.
 *
 * Never throws: a preference read is not allowed to stop somebody clocking
 * in. Falling through to null means "use the organization's zone, then UTC",
 * which is the behaviour every row written before this release had.
 */
async function readViewerZone(userId: string, orgId: string): Promise<string | null> {
  try {
    const prefs = await getEffectivePreferences(userId, orgId);
    const tz = prefs.home?.locale?.timezone;
    return typeof tz === "string" && tz.trim() ? tz.trim() : null;
  } catch {
    return null;
  }
}

const MIN_PUNCH_SECONDS = 5; // refuse "stop" within 5s of "start": almost always a double click
const MAX_PUNCH_HOURS = 16; // a single clock running past 16h is almost always a forgotten stop
const AUTO_STOP_PREFIX = "Check: auto-stopped after 16h";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const active = await prisma.timeEntry.findFirst({
    where: { userId, clockedInAt: { not: null }, clockedOutAt: null },
    select: {
      id: true,
      timesheetId: true,
      day: true,
      clockedInAt: true,
      description: true,
      taskId: true,
      itemId: true,
      item: { select: { id: true, title: true } },
      timesheet: { select: { id: true, status: true, weekStartDate: true } },
    },
  });

  if (!active) {
    // Not clocked in. The page still needs to know whether this week will
    // accept a punch at all, so it can say "your week is submitted" before
    // the click rather than as a 409 after it (spec-planner /clock States,
    // Read-only row).
    // THE SAME WEEK A PUNCH WOULD LAND IN, AND THAT MEANS THE SAME ZONE.
    // The POST path stamps the day in the puncher's own zone (see the long
    // note below it); this advisory read used the SERVER's UTC week, so near
    // a week boundary the two disagreed: at 00:30 on Monday in Asia/Kolkata
    // (19:00 Sunday UTC) the page was told about LAST week's timesheet while
    // a clock-in would open this one, and a person could be shown a
    // read-only "your week is submitted" derived from a week their punch
    // would never touch.
    const [punchZone, orgZone] = await Promise.all([
      readViewerZone(userId, orgId),
      readOrgWorkSchedule(orgId).then((s) => s.timezone),
    ]);
    const weekStart = weekStartUTC(dayStartInZone(new Date(), punchZone ?? orgZone ?? null));
    const sheet = await prisma.timesheet.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
      select: { id: true, status: true, weekStartDate: true },
    });
    return jsonSuccess({ active: null, week: sheet ?? { id: null, status: "DRAFT", weekStartDate: weekStart } });
  }
  return jsonSuccess({
    active: { ...active, itemTitle: active.item?.title ?? null },
    week: active.timesheet,
  });
}

/**
 * The whole of "clock in", serialised per person.
 *
 * Returns either the row it created, or the row that was already running,
 * or one of the week's three refusals. Every caller of this is inside the
 * advisory lock, so the check and the insert cannot interleave with another
 * clock-in by the same person.
 */
type StartOutcome =
  | { kind: "created"; entry: Record<string, unknown> }
  | { kind: "already"; entry: Record<string, unknown> }
  | { kind: "refused"; message: string; status: number };

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // A body that is absent or not JSON is a 400 with the contract in it,
  // never an unhandled throw. Until Phase 4 the Clock page posted no body
  // at all and req.json() threw before the action check could answer (C-1).
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("action must be 'start' or 'stop'");
  }
  const action = typeof body.action === "string" ? body.action : "";
  const taskId = typeof body.taskId === "string" ? body.taskId : null;
  const itemId = typeof body.itemId === "string" ? body.itemId : null;
  const description = typeof body.description === "string" ? body.description.trim() || null : null;

  if (!["start", "stop"].includes(action)) {
    return jsonError("action must be 'start' or 'stop'");
  }

  if (action === "start") {
    // ONE OPEN PUNCH PER PERSON, AND THE DATABASE ENFORCES IT.
    //
    // "Is anything running? No, then create one" is a read followed by a
    // write with nothing between them, so a double click, two tabs, or the
    // retry this route's own client does could all pass the check at the
    // same moment and all create a row. Three overlapping open punches then
    // cover the same wall-clock hours and are counted two or three times in
    // the week total that feeds payroll, and the UI's stop closes exactly
    // one of them.
    //
    // A transaction alone does not fix it (READ COMMITTED lets both
    // transactions see no active row), and a unique index cannot be added
    // safely to a table that may already hold duplicates. A per-user
    // advisory lock held for the length of the transaction serialises the
    // check and the insert for THIS user and nobody else, needs no schema
    // change, and is released whether the transaction commits or rolls back.
    //
    // The two zone reads happen BEFORE the lock, so the lock is held for the
    // check and the insert and nothing else.
    const [punchZone, orgZone] = await Promise.all([
      readViewerZone(userId, orgId),
      readOrgWorkSchedule(orgId).then((s) => s.timezone),
    ]);
    const outcome = await prisma.$transaction(async (tx): Promise<StartOutcome> => {
      // hashtextextended keeps the whole cuid in the key rather than a
      // 32-bit hash of it, and the "punch" literal keeps this lock space
      // from colliding with any other advisory lock in the product.
      //
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns the `void`
      // pseudo-type, which Prisma's result deserializer refuses, and the
      // whole clock-in then answers a bare 500. Nothing reads the result
      // anyway; the lock is the point.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('punch:' || ${userId}, 0))`;

      // EXPLICIT COLUMNS, AND IT IS A DEPLOY-ORDER RULE, NOT A STYLE ONE.
      // Prisma emits EVERY scalar of the model on a query with no `select`,
      // so the moment the generated client knows about TimeEntry.billable
      // and .tags, this query asks a database that may not have them yet for
      // two columns that are not there and the whole clock stops working.
      // Naming the columns keeps the punch path inside the rule the rest of
      // this phase follows: every reader tolerates a new column being absent
      // for one release. The two new columns are deliberately NOT named here
      // (the punch neither reads nor writes them).
      const running = await tx.timeEntry.findFirst({
        where: { userId, clockedInAt: { not: null }, clockedOutAt: null },
        select: {
          id: true, organizationId: true, timesheetId: true, userId: true, day: true,
          hours: true, description: true, taskId: true, itemId: true, source: true,
          clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
        },
      });
      // Already clocked in. Don't silently double-punch.
      if (running) return { kind: "already", entry: running as unknown as Record<string, unknown> };

      // Validate task ownership if supplied.
      let validatedTaskId: string | null = null;
      if (taskId) {
        const task = await tx.task.findFirst({
          where: { id: taskId, organizationId: orgId },
          select: { id: true },
        });
        validatedTaskId = task?.id ?? null;
      }
      // Items are what the Clock's task picker offers now.
      let validatedItemId: string | null = null;
      if (itemId) {
        const item = await tx.item.findFirst({
          where: { id: itemId, organizationId: orgId },
          select: { id: true },
        });
        validatedItemId = item?.id ?? null;
      }

      const now = new Date();
      // THE DAY IS THE PUNCHER'S CALENDAR DAY, NOT THE SERVER'S. Stamping
      // `dayStartUTC(now)` filed a clock-in at 20:19 in New York under the
      // NEXT day, because that instant is 00:19 UTC, so the Clock page's
      // "Today" card listed last night's sessions and could total more than
      // 24 hours on the surface that feeds the timesheet (audit T-7, TC-4).
      // spec-planner section 2: the bucket is computed on the server from
      // the IANA name. The viewer's own zone first, the organization's
      // working calendar second, UTC last, which is what every row written
      // before this release used.
      const zone = punchZone ?? orgZone ?? null;
      const day = dayStartInZone(now, zone);
      const weekStart = weekStartUTC(day);

      let timesheet = await tx.timesheet.findUnique({
        where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
      });
      if (!timesheet) {
        const me = await tx.user.findUnique({
          where: { id: userId },
          select: { managerId: true },
        });
        timesheet = await tx.timesheet.create({
          data: {
            organizationId: orgId,
            userId,
            weekStartDate: weekStart,
            approverId: me?.managerId ?? null,
          },
        });
      }
      if (timesheet.status === "SUBMITTED") {
        return { kind: "refused", message: "Your week is submitted. Retract it in Timesheets to clock time.", status: 409 };
      }
      if (timesheet.status === "REJECTED") {
        return { kind: "refused", message: "This week was rejected. Reopen it in Timesheets to clock time.", status: 409 };
      }
      if (timesheet.status !== "DRAFT") {
        return { kind: "refused", message: "This week is approved. Ask your approver to reopen it.", status: 409 };
      }

      const entry = await tx.timeEntry.create({
        data: {
          organizationId: orgId,
          timesheetId: timesheet.id,
          userId,
          day,
          clockedInAt: now,
          description,
          taskId: validatedTaskId,
          itemId: validatedItemId,
          source: "PUNCH",
        },
        select: {
          id: true, organizationId: true, timesheetId: true, userId: true, day: true,
          hours: true, description: true, taskId: true, itemId: true, source: true,
          clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
        },
      });
      return { kind: "created", entry: entry as unknown as Record<string, unknown> };
    });

    if (outcome.kind === "refused") return jsonError(outcome.message, outcome.status);
    if (outcome.kind === "already") return jsonSuccess({ active: outcome.entry, alreadyRunning: true });
    return jsonSuccess({ active: outcome.entry }, 201);
  }

  // THE STOP IS SERIALISED, FOR THE SAME REASON THE START IS.
  // Reading the open row and updating it with nothing between them let two
  // concurrent stops both find the same row and both run the update: no
  // hours were lost or doubled (both writes computed nearly the same value
  // against the same id), but when the week had since closed BOTH also wrote
  // the audit row and BOTH created the approver notification, so one
  // correction was announced twice. The same per-user advisory lock closes
  // it, and it is the same lock space as the start, so a stop and a start
  // cannot interleave with each other either.
  //
  // Everything that decides the CLOSE is inside the lock: the read, the
  // arithmetic and the write. The audit row and the notification are outside
  // it, because only the transaction that actually closed the row gets here
  // with a `closed` result at all.
  type StopOutcome =
    | { kind: "none" }
    | { kind: "tooSoon" }
    | {
        kind: "closed";
        closed: { id: string; hours: unknown; timesheetId: string | null; [k: string]: unknown };
        sheet: { id: string; status: string; weekStartDate: Date; approverId: string | null } | null;
        autoStopped: boolean;
        hours: number;
      };

  const outcome = await prisma.$transaction(async (tx): Promise<StopOutcome> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('punch:' || ${userId}, 0))`;

    const active = await tx.timeEntry.findFirst({
      where: { userId, clockedInAt: { not: null }, clockedOutAt: null },
      select: {
        id: true, organizationId: true, timesheetId: true, userId: true, day: true,
        hours: true, description: true, taskId: true, itemId: true, source: true,
        clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
      },
    });
    if (!active) return { kind: "none" };

    const now = new Date();
    const startedAt = active.clockedInAt!;
    const elapsedMs = now.getTime() - startedAt.getTime();
    if (elapsedMs < MIN_PUNCH_SECONDS * 1000) return { kind: "tooSoon" };
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    // Past 16 hours the clock is stopped AT 16 hours rather than refused, and
    // the row is marked so it is findable in Timesheets. Refusing left the
    // person holding a clock they could not stop.
    const autoStopped = elapsedHours > MAX_PUNCH_HOURS;
    const clockedOutAt = autoStopped
      ? new Date(startedAt.getTime() + MAX_PUNCH_HOURS * 60 * 60 * 1000)
      : now;
    // Decimal(5,2) hours, so 2 places is all the column holds. A punch under
    // 18 seconds rounds to 0.00 and the person's entry reads as no time at
    // all, which is a silent drop of a row they can see on the page. The
    // floor is the smallest value the column can carry, so a real punch
    // always records something.
    const hours = autoStopped
      ? MAX_PUNCH_HOURS
      : Math.max(0.01, Math.round(elapsedHours * 100) / 100);
    const closingNote = autoStopped
      ? active.description && !active.description.startsWith(AUTO_STOP_PREFIX)
        ? `${AUTO_STOP_PREFIX}. ${active.description}`
        : active.description ?? AUTO_STOP_PREFIX
      : active.description;

    // THE WEEK MAY HAVE MOVED UNDER THE PUNCH. `start` refuses a week that is
    // not DRAFT; `stop` must not, because a clock you cannot stop is exactly
    // what the 16 hour rule was written to end, and the hours are already
    // worked. So the stop always lands, and when the week has since been
    // submitted or approved the people who need to know are told rather than
    // the total quietly growing after a decision:
    //
    //   the audit trail gets the row (approval is billing relevant)
    //   the approver gets a notification naming the week
    //   the response carries weekStatus so the page can say what happened
    //
    // Nothing is reverted and nothing is refused: the entry is the person's
    // time and it is never dropped.
    const sheet = active.timesheetId
      ? await tx.timesheet.findUnique({
          where: { id: active.timesheetId },
          select: { id: true, status: true, weekStartDate: true, approverId: true, userId: true },
        })
      : null;

    const closed = await tx.timeEntry.update({
      where: { id: active.id },
      data: { clockedOutAt, hours, description: closingNote },
      select: {
        id: true, organizationId: true, timesheetId: true, userId: true, day: true,
        hours: true, description: true, taskId: true, itemId: true, source: true,
        clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
      },
    });
    return { kind: "closed", closed, sheet, autoStopped, hours };
  });

  if (outcome.kind === "none") return jsonError("No active punch to stop", 409);
  if (outcome.kind === "tooSoon") return jsonError("Wait a moment before clocking out.", 409);

  const { closed, sheet, autoStopped, hours } = outcome;
  const weekAlreadyClosed = sheet ? sheet.status === "SUBMITTED" || sheet.status === "APPROVED" : false;

  if (sheet && weekAlreadyClosed) {
    const weekKey = utcDayKey(new Date(sheet.weekStartDate));
    logAuditEvent({
      type: "timesheet_changed_after_close",
      actorId: userId,
      organizationId: orgId,
      description: `A clock started before the week closed was stopped into a ${sheet.status} timesheet (week of ${weekKey})`,
      targetId: sheet.id,
      targetType: "timesheet",
      metadata: { weekStartDate: sheet.weekStartDate, hours, entryId: closed.id, status: sheet.status },
    });
    if (sheet.approverId && sheet.approverId !== userId) {
      prisma.notification.create({
        data: {
          userId: sheet.approverId,
          type: "timesheet_changed_after_close",
          title: "Hours added to a closed week",
          message: `A clock that was already running was stopped into the ${sheet.status.toLowerCase()} week of ${weekKey}.`,
          link: `/timesheets?week=${weekKey}`,
        },
      }).catch((err) => console.error("[Punch] Notification failed:", err));
    }
  }

  return jsonSuccess({
    active: null,
    autoStopped,
    /** DRAFT unless the week closed while the clock was running. */
    weekStatus: sheet?.status ?? null,
    closed: {
      ...closed,
      hours: closed.hours === null ? null : Number(closed.hours),
      minutes: closed.hours === null ? null : Math.round(Number(closed.hours) * 60),
    },
  });
}
