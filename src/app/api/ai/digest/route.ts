// GET /api/ai/digest: the last seven days in numbers, for the signed-in
// viewer. Nothing in the app calls it yet.
//
// EVERY TILE IS WHAT THE VIEWER MAY READ, and its label says whose it is.
// - Mood and check-ins: only the check-ins the viewer may read one by one
//   (src/lib/check-in-access.server.ts, docs-found fixes batch 5), of this
//   workspace only (batch 6).
// - KPI updates and active KRAs: only the records of the people whose
//   alignment data the viewer reads, as GET /api/kpi-records reads them
//   (visibleAlignmentUserIds for the list, mayActOnKpisOf for one person),
//   at the level the viewer holds in this workspace, read fresh (PeopleCtx).
//   Docs-found fixes batch 6: they counted and averaged every KPI reading of
//   the workspace for anyone signed in, a Guest and an Agent included, so in
//   a week with one reading the tile was that person's exact score. Counted
//   in the database (aggregate), never loaded row by row.
// - Published SOPs: the ones the viewer can open (sop-access.ts).
// - Team size: the live people who hold a level here (anchored here, or a
//   membership here), never removed or deactivated accounts.
// A Guest reads no one's people or alignment data here, so their digest holds
// their own check-ins and nothing about the workspace.
//
// The low-mood alert counts people, never check-ins: one person's four low
// days are one person.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { peopleCtx, type PeopleCtx } from "@/lib/people/person-access.server";
import { checkInReach, readableCheckInsWhere } from "@/lib/check-in-access.server";
import { mayActOnKpisOf } from "@/lib/kpi-review.server";
import { workspacePeopleLines } from "@/lib/access/acting-workspace";
import { sopVisibilityWhere } from "@/lib/sop-access";

type Reach = "workspace" | "team" | "own";

/** More low-mood people than this in a week raise the alert. */
const LOW_MOOD_ALERT_PEOPLE = 3;
const LIVE = { deletedAt: null, status: { not: "INACTIVE" as const } };

/**
 * Whose alignment data this viewer reads here: everyone's, these people's,
 * or (a Guest) no one's. GET /api/kpi-records lists visibleAlignmentUserIds
 * (everyone at an org-wide level, else the viewer and their solid report
 * tree) and opens one more person's for mayActOnKpisOf; the union of the two
 * is this. ctx.orgWide is those org-wide levels at the level held here, plus
 * Owner, Admin and the People team, for whom mayActOnKpisOf opens anyone; and
 * ctx.chain already holds the solid tree (peopleCtxForViewer), so the
 * viewer and the chain people mayActOnKpisOf opens are the rest. An Agent
 * reads their own alone.
 */
function alignmentReach(ctx: PeopleCtx): { everyone: true } | { everyone: false; ids: string[] } | null {
  if (ctx.orgRole === "GUEST") return null;
  if (!ctx.isAgent && ctx.orgWide) return { everyone: true };
  const ids = new Set([ctx.userId]);
  for (const id of ctx.chain) if (mayActOnKpisOf(ctx, id)) ids.add(id);
  return { everyone: false, ids: [...ids] };
}

const MOOD_LABEL: Record<Reach, string> = { workspace: "Team Mood", team: "Your team's mood", own: "Your mood" };
const CHECK_INS_LABEL: Record<Reach, string> = { workspace: "Check-ins", team: "Your team's check-ins", own: "Your check-ins" };
const KPI_LABEL: Record<Reach, string> = { workspace: "KPI Updates", team: "Your team's KPI updates", own: "Your KPI updates" };
const KRA_LABEL: Record<Reach, string> = { workspace: "Active KRAs", team: "Your team's active KRAs", own: "Your active KRAs" };
const KRA_DETAIL: Record<Reach, string> = { workspace: "Assigned across the workspace", team: "Assigned to you and your team", own: "Assigned to you" };
const NO_KPI_ALERT: Record<Reach, string> = {
  workspace: "No KPI records this week. Check that teams are tracking them.",
  team: "No KPI records for you or your team this week.",
  own: "No KPI records for you this week.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function GET() {
  const ctx = await peopleCtx();
  if (!ctx) return jsonError("Unauthorized", 401);
  // The SOP list's own rule reads the session (sop-access.ts).
  const { session } = await getSessionOrFail();
  if (!session) return jsonError("Unauthorized", 401);

  const orgId = ctx.organizationId;
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const thisWeek = { gte: oneWeekAgo };

  const moodReach = checkInReach(ctx);
  const weekCheckIns: Prisma.CheckInWhereInput = { AND: [readableCheckInsWhere(ctx), { createdAt: thisWeek }] };
  const reach = alignmentReach(ctx);
  const alignmentWho: { userId?: { in: string[] } } = reach && !reach.everyone ? { userId: { in: reach.ids } } : {};
  const alignmentScope: Reach = !reach ? "own" : reach.everyone ? "workspace" : reach.ids.length > 1 ? "team" : "own";

  const [moods, lowMoodPeople, workspace] = await Promise.all([
    prisma.checkIn.aggregate({ where: weekCheckIns, _count: { _all: true }, _avg: { mood: true } }),
    prisma.checkIn.findMany({ where: { AND: [weekCheckIns, { mood: { lte: 2 } }] }, distinct: ["userId"], select: { userId: true } }),
    // Nothing about the workspace for a Guest.
    !reach
      ? null
      : Promise.all([
          // Two indexed reads, never one OR with a sublink, which scans every
          // workspace's people (batch 6, acting-workspace.ts workspacePeopleLines).
          workspacePeopleLines(orgId, { activeOnly: true }).then((rows) => rows.length),
          // Joined this week: an account made here, or a membership made here.
          Promise.all([
            prisma.user.count({ where: { ...LIVE, organizationId: orgId, createdAt: thisWeek } }),
            prisma.organizationMembership.count({ where: { organizationId: orgId, createdAt: thisWeek, user: { ...LIVE, organizationId: { not: orgId } } } }),
          ]).then(([anchored, members]) => anchored + members),
          prisma.kRAAssignment.count({ where: { kra: { organizationId: orgId }, status: "ACTIVE", ...alignmentWho } }),
          prisma.kPIRecord.aggregate({ where: { kpi: { organizationId: orgId }, createdAt: thisWeek, ...alignmentWho }, _count: { _all: true }, _avg: { score: true } }),
          sopVisibilityWhere(session).then((visible) => prisma.sOP.count({ where: { AND: [{ organizationId: orgId, status: "PUBLISHED" }, visible] } })),
        ]),
  ]);

  const checkIns = moods._count._all;
  // A check-in with no mood is left out of the average, never read as a 3.
  const avgMood = moods._avg.mood != null ? moods._avg.mood.toFixed(1) : null;
  const lowMood = lowMoodPeople.length;

  const highlights: Array<{ label: string; value: string | number; detail: string }> = [];
  const alerts: string[] = [];
  if (workspace) {
    const [teamSize, joined, activeKras, kpis, sopCount] = workspace;
    const kpiCount = kpis._count._all;
    // No scored reading this week: no average, never NaN.
    const avgKpiScore = kpis._avg.score != null ? Math.round(kpis._avg.score) : null;
    highlights.push(
      { label: "Team Size", value: teamSize, detail: joined > 0 ? `+${joined} new this week` : "No new joins" },
      { label: KRA_LABEL[alignmentScope], value: activeKras, detail: KRA_DETAIL[alignmentScope] },
      { label: KPI_LABEL[alignmentScope], value: kpiCount, detail: avgKpiScore != null ? `Avg score: ${avgKpiScore}` : "This week" },
      { label: "Published SOPs", value: sopCount, detail: "That you can open" },
    );
    if (kpiCount === 0) alerts.push(NO_KPI_ALERT[alignmentScope]);
  }
  highlights.push(
    { label: MOOD_LABEL[moodReach], value: avgMood ?? "N/A", detail: `${plural(lowMood, "person", "people")} with a low mood` },
    { label: CHECK_INS_LABEL[moodReach], value: checkIns, detail: "This week" },
  );
  // About other people only: a viewer who reads their own check-ins alone is never told about "team members".
  if (moodReach !== "own" && lowMood > LOW_MOOD_ALERT_PEOPLE) alerts.unshift(`${lowMood} people reported a low mood this week.`);

  return jsonSuccess({
    period: `${oneWeekAgo.toISOString().split("T")[0]} to ${new Date().toISOString().split("T")[0]}`,
    highlights,
    alerts,
  });
}
