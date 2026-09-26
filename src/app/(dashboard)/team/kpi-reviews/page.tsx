// /team/kpi-reviews: the manager's KPI page. Two views, one URL each:
//   (default)       Awaiting approval: SUBMITTED numbers with inline Approve
//                   and Request changes, then "Recently acted".
//   ?view=record    Record numbers: the per-person monthly entry that lived
//                   at /kra-kpi/review (which now 308s here, carrying
//                   ?period=), so a manager can still record on behalf.
// The two merge into one per-person table in the KPI reviews build
// (spec-goals section 4 step 5); until then both halves stay reachable.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { gatePage } from "@/lib/access/gate";
import { listKpiReviewsForManager } from "@/lib/kpi-record";
import { KpiReviewsClient } from "@/components/team/kpi-reviews-client";
import Link from "next/link";
import { ViewTab } from "@/components/ui/view-tabs";
import RecordNumbers from "@/app/(dashboard)/kra-kpi/review/review-client";
import { Award } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TeamKpiReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const view = sp.view === "record" ? "record" : "approve";
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  // The one gate shape (Phase 6): the `kpi-reviews` APP_RULES row, anyone with
  // reports (solid or dotted) over their chain, the People team and Admin
  // over the org; anyone else gets the in-shell 404.
  await gatePage("view", { type: "app", key: "kpi-reviews" }, { callbackUrl: "/team/kpi-reviews" });

  const [pending, acted] = view === "approve"
    ? await Promise.all([
        listKpiReviewsForManager(u.id, u.organizationId, { status: "SUBMITTED", take: 50 }),
        listKpiReviewsForManager(u.id, u.organizationId, { statuses: ["APPROVED", "REJECTED"], take: 30 }),
      ])
    : [[], []];

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>KPI reviews</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#f59e0b]/10 shrink-0">
            <Award className="h-5 w-5 text-[#f59e0b]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">KPI reviews</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">approve the numbers your people record, or record them yourself</span>
        </div>
        <div className="mt-3 flex items-center gap-1" role="tablist">
          <ViewTab label="Awaiting approval" active={view === "approve"} href="/team/kpi-reviews" />
          <ViewTab label="Record numbers" active={view === "record"} href="/team/kpi-reviews?view=record" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 max-w-[1280px]">
        {view === "record" ? <RecordNumbers embedded /> : <KpiReviewsClient pending={pending} acted={acted} />}
      </div>
    </div>
  );
}
