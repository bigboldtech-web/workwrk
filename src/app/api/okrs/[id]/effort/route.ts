// GET /api/okrs/[id]/effort: the AUTOMATED effort signal for a goal (the
// Effort card): hours, tasks done and open, who is driving it and when it
// last moved, from every piece of work linked to the goal (KRAs, Lists,
// Spaces; src/lib/goal-effort.ts). Contributors carry their avatar.
// Visibility mirrors the goal itself (canSeeGoal). Reads only. A repeating
// goal also reads its hours inside one period (?period=<key>, else the one
// running now), docs/plans/recurring-goals.md E4.
//
// lastMovedAt is the card's "Last moved": the newest of task activity and a
// target check-in, the same definition the goals list (GET /api/okrs) uses,
// so one goal never reads "9h ago" on the list and "Never" on its own page.
// lastActivityAt stays task-only (computeGoalEffort is shared with the
// assess route, whose effort must not count check-ins).

import { viewerFromSession } from "@/lib/access/viewer";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";
import { computeGoalEffort, type EffortWindow } from "@/lib/goal-effort";
import { firstDayKey, isGoalCadence, lastDayKey, periodAt, periodSettingsOf } from "@/lib/goals/goal-period";

/**
 * A repeating goal's window (docs/plans/recurring-goals.md E4): the period
 * `?period=` names, else the one running now (else its latest started), as
 * its first and last day in the workspace zone. Null for a one-time goal.
 */
async function windowOf(orgId: string, okrId: string, key: string | null, now: Date): Promise<{ key: string; window: EffortWindow } | null> {
  const periods = await prisma.goalPeriod.findMany({ where: { okrId }, orderBy: { startsAt: "asc" }, select: { key: true, cadence: true, startsAt: true, endsAt: true } });
  const started = periods.filter((p) => isGoalCadence(p.cadence) && p.startsAt.getTime() <= now.getTime());
  const p = (key ? started.find((x) => x.key === key) : null) ?? periodAt(started, now) ?? started[started.length - 1] ?? null;
  if (!p) return null;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = periodSettingsOf(org?.settings);
  return { key: p.key, window: { firstKey: firstDayKey(p, s), lastKey: lastDayKey(p, s) } };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: orgId } });
  if (!okr) return jsonError("Not found", 404);
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);
  const asked = new URL(req.url).searchParams.get("period");
  const period = okr.repeat ? await windowOf(orgId, id, asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null, new Date()) : null;

  // KRA tasks + linked-board/space item time, the join point between a goal
  // and the real work moving it.
  // Under the viewer's access: a List they cannot open never counts here.
  // A repeating goal's hours are also read inside the period on screen
  // (periodHours, "Hours this period").
  const [effort, lastCheckIn] = await Promise.all([
    computeGoalEffort(orgId, id, await viewerFromSession(), period?.window ?? null),
    // The goal's newest target check-in (the list's lastByKr, for one goal).
    prisma.kRCheckIn.aggregate({ where: { keyResult: { okrId: id } }, _max: { createdAt: true } }),
  ]);
  const lastCheckInAt = lastCheckIn._max.createdAt ?? null;
  const lastMovedAt = [effort.lastActivityAt, lastCheckInAt]
    .reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
  return jsonSuccess({ ...effort, lastCheckInAt, lastMovedAt, periodKey: period?.key ?? null });
}
