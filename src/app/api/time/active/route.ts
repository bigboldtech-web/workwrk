// GET /api/time/active
//
// The one answer to "is any clock running for me right now".
//
// WHY IT EXISTS. There are two independent time models in this product and
// neither knew about the other:
//
//   TimeEntry with clockedInAt / clockedOutAt   the Clock page's punch,
//     which rolls up into the week's Timesheet and eventually into payroll.
//   TimerSession                                 the task Time tracker's
//     stopwatch, which logs into the same timesheet when it stops.
//
// The top bar pill read only the second, the Clock page only the first, so
// a person clocked in saw nothing in the top bar and a person with a task
// timer saw nothing on the Clock page. spec-planner.md section 2 /clock
// Data names this endpoint as the fix (audit C-4): one read, both clocks,
// shared by the shell pill and the Planner sidebar's Clock row, polled once
// for the whole app rather than once per surface.
//
// Shape:
//   { punch: { id, since, itemId, itemTitle, description, weekStatus } | null,
//     timer: { id, since, entityType, entityId, title, url } | null }
//
// Own rows only. There is no read-around: a punch is people data of its
// owner (access spec section 3.3).

import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { weekStartUTC } from "@/lib/timesheet-week";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const [punchRow, timerRow] = await Promise.all([
    prisma.timeEntry.findFirst({
      where: { userId, organizationId: orgId, clockedInAt: { not: null }, clockedOutAt: null },
      orderBy: { clockedInAt: "desc" },
      select: {
        id: true,
        clockedInAt: true,
        description: true,
        itemId: true,
        item: { select: { title: true } },
        timesheet: { select: { status: true } },
      },
    }),
    prisma.timerSession.findFirst({
      where: { organizationId: orgId, userId, stoppedAt: null },
      orderBy: { startedAt: "desc" },
      select: { id: true, entityType: true, entityId: true, startedAt: true },
    }),
  ]);

  // Hydrate the timer's entity title where the type is one we can resolve.
  // BOARD_ITEM is the only surface that starts a timer today; the others
  // fall through with a null title rather than a guessed one.
  let timerTitle: string | null = null;
  let timerUrl: string | null = null;
  if (timerRow && timerRow.entityType === "BOARD_ITEM") {
    const item = await prisma.item.findFirst({
      where: { id: timerRow.entityId, organizationId: orgId },
      select: { id: true, title: true },
    });
    if (item) {
      timerTitle = item.title;
      timerUrl = `/item/${item.id}`;
    }
  }

  // The current week's status, so a surface can say "your week is
  // submitted" before someone clicks Clock in rather than after.
  const weekStart = weekStartUTC(new Date());
  const week = await prisma.timesheet.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
    select: { id: true, status: true, weekStartDate: true },
  });

  return jsonSuccess({
    punch: punchRow
      ? {
          id: punchRow.id,
          since: punchRow.clockedInAt,
          itemId: punchRow.itemId,
          itemTitle: punchRow.item?.title ?? null,
          description: punchRow.description,
          weekStatus: punchRow.timesheet?.status ?? null,
        }
      : null,
    timer: timerRow
      ? {
          id: timerRow.id,
          since: timerRow.startedAt,
          entityType: timerRow.entityType,
          entityId: timerRow.entityId,
          title: timerTitle,
          url: timerUrl,
        }
      : null,
    week: week ?? { id: null, status: "DRAFT", weekStartDate: weekStart },
  });
}
