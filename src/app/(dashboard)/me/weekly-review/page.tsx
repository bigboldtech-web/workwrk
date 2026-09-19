// /me/weekly-review: your weekly check-in.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/me/weekly-review).
//
// WHAT CHANGED. The page had a hand-rolled "Today › Weekly review" breadcrumb
// under a 2xl h1, no hub sidebar, no way back to any other week (so a review
// written on Friday was unreachable on Monday: work-tasks 1.15, misc-apps
// 1.25), a subline that told people the cadence was mandatory, an empty state
// that printed a raw path ("/kra-kpi"), and an explicit "Save draft" button
// with no autosave at all, on a form people type paragraphs into.
//
// Now: the standard header stack with a BackButton and the AutosaveIndicator,
// eight week pills with a dot on the submitted ones, and every field saving on
// blur and two seconds after the last keystroke.
//
// ONLY THE CURRENT WEEK AUTO-CREATES A DRAFT. Clicking back through the pills
// reads; it never writes eight empty reviews into a manager's history.

import { gatePage } from "@/lib/access/gate";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOrCreateWeeklyReview } from "@/lib/weekly-review";
import { isCurrentWeek, parseWeekKey, weekKey, weekOptions, weekStartOf } from "@/lib/weeks";
import { WeeklyReviewClient } from "./weekly-review-client";

export const dynamic = "force-dynamic";

const PILL_COUNT = 8;

export default async function WeeklyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/me/weekly-review" });
  // A Guest has no KRAs, no manager chain and no heartbeat to file.
  if (viewer.orgRole === "GUEST") notFound();

  const sp = await searchParams;
  const asked = parseWeekKey(sp.week) ?? weekStartOf(new Date());
  const askedKey = weekKey(asked);
  const current = isCurrentWeek(askedKey);

  const review = current
    ? await getOrCreateWeeklyReview({ userId: viewer.userId, organizationId: viewer.organizationId })
    : await prisma.weeklyReview
        .findUnique({ where: { userId_periodStart: { userId: viewer.userId, periodStart: asked } } })
        .then((row) => (row ? JSON.parse(JSON.stringify(row)) : null))
        .catch(() => null);

  const pills = weekOptions(new Date(), PILL_COUNT);
  // Which pills carry a submitted dot: one query over the whole window, not
  // one per pill.
  const oldest = pills[pills.length - 1].start;
  const rows = await prisma.weeklyReview
    .findMany({
      where: { userId: viewer.userId, periodStart: { gte: oldest } },
      select: { periodStart: true, status: true },
    })
    .catch(() => []);
  const byWeek = new Map(rows.map((r) => [weekKey(r.periodStart), r.status]));

  const assignments = await prisma.kRAAssignment.findMany({
    where: { userId: viewer.userId, status: "ACTIVE" },
    include: {
      kra: {
        select: {
          id: true, name: true, category: true,
          kpis: { select: { id: true, name: true, unit: true, frequency: true, targetValue: true, lowerIsBetter: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <WeeklyReviewClient
      weekKeyValue={askedKey}
      weeks={pills.map((p) => ({
        ...p,
        hasReview: byWeek.has(p.key),
        submitted: byWeek.get(p.key) === "SUBMITTED" || byWeek.get(p.key) === "ACKNOWLEDGED",
      }))}
      review={review}
      editable={current}
      kras={assignments.map((a) => ({
        id: a.kra.id,
        name: a.kra.name,
        category: a.kra.category,
        weightage: a.weightage,
        kpis: a.kra.kpis,
      }))}
    />
  );
}
