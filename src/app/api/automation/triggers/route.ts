// GET /api/automation/triggers
//
// The trigger catalog for the workflow builder, straight from the code
// registry. `isEmitting` tells the UI which triggers fire for real today
// versus catalog-only seeds that light up when their domain ships.

import { NextResponse } from "next/server";
import { requireAutomation } from "@/lib/automation/gate";
import { prisma } from "@/lib/prisma";
import { legacyTriggersEnabled, triggersForOrg } from "@/lib/automation/registry-triggers";
import { timeTriggersLive } from "@/lib/automation/cron-tick-server";

// The Cashkr-era triggers come back with `hidden: true` unless the org's
// product flag (settings.automation.legacyTriggers) is on; see
// triggersForOrg. Nothing is removed from the list. Not cached: the answer
// depends on that per-org flag, so a shared 30 second lookup cache would
// keep the picker stale for minutes after the flag flips.
export async function GET() {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const [org, live] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } }),
    // The time triggers are live only while the schedule cron is ticking.
    timeTriggersLive(),
  ]);

  return NextResponse.json(
    {
      triggers: triggersForOrg(legacyTriggersEnabled(org?.settings), { timeTriggersLive: live }),
      // The time triggers read times in the server's calendar; the builder
      // names this zone beside the time so nobody guesses.
      serverZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
