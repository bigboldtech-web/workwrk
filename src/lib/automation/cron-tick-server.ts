// When the automation-schedule cron last ran (AutomationCronTick, one row
// per endpoint). The trigger catalog reads it so the two time triggers, "A
// task's date arrives" and "On a schedule", are shown as live only while the
// cron row is really ticking: a host without the row (scripts/CRON-SETUP.md,
// the founder installs it) would otherwise show Active on an automation that
// never runs, with nothing on screen saying why.
//
// Both functions tolerate the table being absent for one release: the tick
// is dropped and the triggers read as not live, which is the safe reading.

import { prisma } from "@/lib/prisma";

export const SCHEDULE_TICK = "automation-schedule";

/** The cron runs every 5 minutes; a stamp older than this means it stopped. */
export const TICK_STALE_MS = 20 * 60_000;

export async function noteScheduleTick(now: Date = new Date()): Promise<void> {
  try {
    await prisma.automationCronTick.upsert({
      where: { name: SCHEDULE_TICK },
      create: { name: SCHEDULE_TICK, lastTickAt: now },
      update: { lastTickAt: now },
    });
  } catch {
    // The table is not there yet (deploy order is free): nothing to stamp.
  }
}

/** Pure, for the tests: is a stamp recent enough to call the cron live. */
export function tickIsLive(lastTickAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !!lastTickAt && now.getTime() - lastTickAt.getTime() < TICK_STALE_MS;
}

/** True while the automation-schedule cron has ticked in the last 20 minutes. */
export async function timeTriggersLive(now: Date = new Date()): Promise<boolean> {
  try {
    const row = await prisma.automationCronTick.findUnique({ where: { name: SCHEDULE_TICK }, select: { lastTickAt: true } });
    return tickIsLive(row?.lastTickAt, now);
  } catch {
    return false;
  }
}
