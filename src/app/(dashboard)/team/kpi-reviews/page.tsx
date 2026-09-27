// /team/kpi-reviews: KPI reviews, the manager's one KPI page (spec-goals
// section 2). Per person, per month: approve what they recorded, ask for a
// change, or record the number yourself. It absorbed the two pages that did
// this job: /kra-kpi/review (the typing page, which 308s here carrying
// ?period=) and the old approval queue (the "Awaiting approval" cards and
// the retired ?view=record tab, both this one table now).
//
// Gate: the `kpi-reviews` APP_RULES row (anyone with reports over their
// chain, the People team and Admin over the org); anyone else gets the
// in-shell 404. ?person= outside the viewer's reach is a 404 too, so the
// page never confirms who else exists. ?period=YYYY-MM picks the month (a
// future or malformed month falls back to the current one).

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { gatePage } from "@/lib/access/gate";
import { currentKpiPeriod, resolveKpiPeriod } from "@/lib/kpi-period";
import { kpiActorCtx, listAwaitingKpiNumbers, mayActOnKpisOf, listRecentKpiDecisions } from "@/lib/kpi-review.server";
import { KpiReviewsView } from "@/components/team/kpi-reviews-view";

export const dynamic = "force-dynamic";

export default async function TeamKpiReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) redirect("/login");
  await gatePage("view", { type: "app", key: "kpi-reviews" }, { callbackUrl: "/team/kpi-reviews" });

  const sp = await searchParams;
  const period = resolveKpiPeriod(typeof sp.period === "string" ? sp.period : undefined);
  const person = typeof sp.person === "string" && sp.person ? sp.person : null;
  const ctx = await kpiActorCtx();
  if (!ctx) redirect("/login");
  if (person && (person === u.id || !mayActOnKpisOf(ctx, person))) notFound();

  // Submitted numbers from any month for the people this page lists (the
  // sidebar badge's own list), so a number sent in for last month is never
  // hidden behind the month control.
  const [waiting, recent] = await Promise.all([listAwaitingKpiNumbers(ctx), listRecentKpiDecisions(ctx)]);
  const byMonth = new Map<string, number>();
  for (const w of waiting) byMonth.set(w.period, (byMonth.get(w.period) ?? 0) + 1);

  return (
    <div className="flex h-full flex-col bg-surface">
      <KpiReviewsView
        initialPeriod={period}
        currentPeriod={currentKpiPeriod()}
        initialPerson={person}
        otherMonths={[...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([p, count]) => ({ period: p, count }))}
        viewerId={u.id}
        recentDecisions={recent}
      />
    </div>
  );
}
