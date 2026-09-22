// Time entries.
//
// GET  list the caller's own entries for a date range (spec-planner.md
//      section 2 /clock Data: "GET /api/time-entries?mine=1&from=&to="). The
//      Clock page has been calling this since it shipped; until Phase 4 the
//      file exported POST only, so Recent sessions and the Today total were
//      permanently an error line (audit C-2).
// POST create a manual hours entry. Auto-creates the matching weekly
//      Timesheet on demand so an employee's first action on a fresh week
//      does not 404.
//
// The parent Timesheet's status is enforced on write: once submitted or
// finalized, no new entries. A REJECTED week accepts entries again only
// after its owner reopens it (PATCH /api/timesheets/[id] { action:
// "reopen" }), which is the transition spec-planner section 2 /timesheets
// adds for T-2.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { weekStartUTC, dayStartUTC } from "@/lib/timesheet-week";
import { utcDayFromKey } from "@/lib/time-format";
import { normaliseEntryTags } from "@/lib/timesheet-grid";

const MAX_HOURS_PER_ENTRY = 24;
const MAX_LIST = 200;

/** One entry, shaped for the Clock and Timesheets surfaces. `hours` is a
 *  Prisma Decimal on the way out, so it is narrowed to a number here and
 *  never handed to the client as an object. */
function present(e: {
  id: string;
  day: Date;
  hours: unknown;
  description: string | null;
  source: string;
  clockedInAt: Date | null;
  clockedOutAt: Date | null;
  timesheetId: string;
  taskId: string | null;
  itemId: string | null;
  billable?: boolean;
  tags?: string[];
  item?: { id: string; title: string } | null;
}) {
  const hours = e.hours === null || e.hours === undefined ? null : Number(e.hours);
  return {
    id: e.id,
    day: e.day,
    hours,
    minutes: hours === null ? null : Math.round(hours * 60),
    description: e.description,
    source: e.source,
    clockedInAt: e.clockedInAt,
    clockedOutAt: e.clockedOutAt,
    timesheetId: e.timesheetId,
    taskId: e.taskId,
    itemId: e.itemId,
    billable: e.billable ?? false,
    tags: e.tags ?? [],
    itemTitle: e.item?.title ?? null,
    // The Clock page's own vocabulary, kept so the page reads one shape.
    startTime: e.clockedInAt,
    endTime: e.clockedOutAt,
  };
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const sp = new URL(req.url).searchParams;

  // Own entries only. There is no read-around here: a time entry is people
  // data of its owner (access spec section 3.3), and the manager view reads
  // whole timesheets through /api/timesheets, not raw entries. `mine` is
  // accepted and ignored rather than refused, because the Clock page has
  // always sent it.
  const where: Record<string, unknown> = { userId, organizationId: orgId };

  const fromKey = sp.get("from");
  const toKey = sp.get("to");
  if (fromKey || toKey) {
    const from = fromKey ? utcDayFromKey(fromKey) : null;
    const to = toKey ? utcDayFromKey(toKey) : null;
    if (fromKey && !from) return jsonError("from must be YYYY-MM-DD");
    if (toKey && !to) return jsonError("to must be YYYY-MM-DD");
    const day: Record<string, Date> = {};
    if (from) day.gte = from;
    if (to) day.lte = to;
    where.day = day;
  }

  const timesheetId = sp.get("timesheetId");
  if (timesheetId) where.timesheetId = timesheetId;

  const rawLimit = Number(sp.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIST) : 50;

  const entries = await prisma.timeEntry.findMany({
    where,
    orderBy: [{ day: "desc" }, { clockedInAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      day: true,
      hours: true,
      description: true,
      source: true,
      clockedInAt: true,
      clockedOutAt: true,
      timesheetId: true,
      taskId: true,
      itemId: true,
      billable: true,
      tags: true,
      item: { select: { id: true, title: true } },
    },
  });

  const rows = entries.map(present);
  const totalMinutes = rows.reduce((acc, r) => acc + (r.minutes ?? 0), 0);
  return jsonSuccess({ entries: rows, totalMinutes });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // A missing or malformed body answers the contract, not a bare 500 with an
  // empty response (the same audit C-1 fix the punch route already carries).
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return jsonError("day and hours are required");
  }
  const day = body.day ? new Date(body.day as string) : null;
  if (!day || Number.isNaN(day.getTime())) return jsonError("Invalid day");

  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS_PER_ENTRY) {
    return jsonError(`hours must be > 0 and ≤ ${MAX_HOURS_PER_ENTRY}`);
  }

  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const taskId = typeof body.taskId === "string" ? body.taskId : null;
  const itemId = typeof body.itemId === "string" ? body.itemId : null;

  // Phase 4, time-tracking depth (docs/plans/competitor-gap-2026-09.md
  // section 7c). Both are additive and both default to what the product did
  // before they existed: nothing has ever marked an hour billable, so the
  // default is false rather than true, which would invent revenue.
  const billable = body.billable === true;
  const tags = normaliseEntryTags(body.tags);

  // If caller supplied a taskId, verify it belongs to their org. Soft
  // null on mismatch instead of erroring, which keeps the UI from breaking
  // on stale picker state.
  let validatedTaskId: string | null = null;
  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
      select: { id: true },
    });
    validatedTaskId = task?.id ?? null;
  }

  // Items are what the product has now; the legacy Task table is the one
  // being retired. Same soft-null rule, same reason
  // (spec-planner section 2 /timesheets Data: "POST /api/time-entries
  // accepts itemId (Items, not legacy Tasks)").
  let validatedItemId: string | null = null;
  if (itemId) {
    const item = await prisma.item.findFirst({
      where: { id: itemId, organizationId: orgId },
      select: { id: true },
    });
    validatedItemId = item?.id ?? null;
  }

  const dayStart = dayStartUTC(day);
  const weekStart = weekStartUTC(dayStart);

  // Upsert timesheet first so the FK is satisfied. Concurrent calls
  // for the same week will race, so the unique constraint on
  // (userId, weekStartDate) catches it; we retry the find on conflict.
  let timesheet = await prisma.timesheet.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });
  if (!timesheet) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    try {
      timesheet = await prisma.timesheet.create({
        data: {
          organizationId: orgId,
          userId,
          weekStartDate: weekStart,
          approverId: me?.managerId ?? null,
        },
      });
    } catch {
      timesheet = await prisma.timesheet.findUnique({
        where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
      });
    }
  }
  if (!timesheet) return jsonError("Couldn't reach the week's timesheet");

  // A REJECTED week is not a dead end: its owner reopens it
  // (PATCH /api/timesheets/[id] { action: "reopen" }), which returns it to
  // DRAFT and lets these entries through again. The message says how,
  // because "Cannot add entries to a REJECTED timesheet" told a person
  // their hours were lost.
  if (timesheet.status === "REJECTED") {
    return jsonError("This week was rejected. Reopen it in Timesheets to fix the hours.", 409);
  }
  if (timesheet.status === "APPROVED") {
    return jsonError("This week is approved. Ask your approver to reopen it.", 409);
  }
  if (timesheet.status === "SUBMITTED") {
    return jsonError("Retract the timesheet before adding entries", 409);
  }

  const entry = await prisma.timeEntry.create({
    data: {
      organizationId: orgId,
      timesheetId: timesheet.id,
      userId,
      day: dayStart,
      hours,
      description,
      taskId: validatedTaskId,
      itemId: validatedItemId,
      billable,
      tags,
      source: "WEB",
    },
    select: {
      id: true, organizationId: true, timesheetId: true, userId: true, day: true,
      hours: true, description: true, taskId: true, itemId: true, source: true,
      clockedInAt: true, clockedOutAt: true, createdAt: true, updatedAt: true,
      billable: true, tags: true,
    },
  });

  return jsonSuccess(
    {
      ...entry,
      hours: entry.hours === null ? null : Number(entry.hours),
      minutes: entry.hours === null ? null : Math.round(Number(entry.hours) * 60),
    },
    201,
  );
}
