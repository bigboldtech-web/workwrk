// Stopping a timer, the one way: the session is closed AND its time reaches
// the person's timesheet.
//
// Pen test 2026-11-28 (V-16): starting a timer on a second task stopped the
// first with a bare update and never logged it, so the normal "switch to
// another task" click dropped the earlier hours from the person's week, its
// approvals and payroll, with no message. POST /api/timers/start and
// POST /api/timers/stop both stop through here now.
//
// The stop CLAIMS the session (an update that only matches while it is still
// running), so two requests stopping the same session at once log its time
// once, never twice.

import type { TimerSession } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logTimerToTimesheet, timerBridgeMessage, type TimerBridgeResult } from "@/lib/timesheet";

export interface StoppedTimer {
  session: TimerSession;
  /** What the timesheet said, for a task's timer; null when nothing was due. */
  timesheet: { logged: boolean; message: string | null } | null;
}

export async function stopTimerSession(active: TimerSession, ctx: { orgId: string; userId: string }, now: Date = new Date()): Promise<StoppedTimer | null> {
  const durationMs = Math.max(0, now.getTime() - active.startedAt.getTime());
  const { count } = await prisma.timerSession.updateMany({
    where: { id: active.id, stoppedAt: null },
    data: { stoppedAt: now, durationMs },
  });
  // Another request stopped it first, and logged it.
  if (count === 0) return null;
  const session = await prisma.timerSession.findUniqueOrThrow({ where: { id: active.id } });

  // Tracked time on a task flows into the person's weekly timesheet, linked
  // back to the task. Best-effort: the TimerSession is the record of the work,
  // and a week that cannot take the entry says so (time.md #21).
  let bridge: TimerBridgeResult | null = null;
  if (active.entityType === "BOARD_ITEM" && durationMs > 0) {
    try {
      const item = await prisma.item.findUnique({
        where: { id: active.entityId },
        select: { id: true, title: true, organizationId: true },
      });
      if (item && item.organizationId === ctx.orgId) {
        bridge = await logTimerToTimesheet({
          orgId: ctx.orgId, userId: ctx.userId, itemId: item.id,
          title: item.title, durationMs, when: now,
        });
      }
    } catch (err) {
      console.error("timer to timesheet bridge failed", err);
    }
  }
  return { session, timesheet: bridge ? { logged: bridge.logged, message: timerBridgeMessage(bridge) } : null };
}

/**
 * A task's timer (start, a manual entry, the list of sessions) only on a task
 * this person can open (pen test 2026-11-28, V-24 and V-59): a timer or an
 * entry on any id, another company's or a private task's, was accepted, and
 * the person's timesheet then showed that task's title. Null when allowed;
 * other entity kinds are not tasks and pass.
 */
export async function taskTimerRefusal(entityType: string, entityId: string): Promise<Response | null> {
  if (entityType !== "BOARD_ITEM") return null;
  const { gateItem, itemCtx } = await import("@/lib/item-gate");
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const gate = await gateItem(entityId, c, "view");
  return "error" in gate ? Response.json({ error: "not found" }, { status: 404 }) : null;
}
