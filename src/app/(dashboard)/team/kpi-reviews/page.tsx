// /team/kpi-reviews — manager queue for submitted KPI scores. Sibling of
// /team/reviews (weekly reviews). Two sections: "Awaiting your approval"
// (SUBMITTED) with inline Approve / Request-changes, and "Recently acted".

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAccess, meets } from "@/lib/access";
import { listKpiReviewsForManager } from "@/lib/kpi-record";
import { KpiReviewsClient } from "@/components/team/kpi-reviews-client";
import Link from "next/link";
import { Award } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TeamKpiReviewsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const decision = await resolveAccess(
    { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" },
    { type: "module", name: "team/kpi-reviews" },
  );
  if (!meets(decision, "read")) redirect("/today");

  const [pending, acted] = await Promise.all([
    listKpiReviewsForManager(u.id, u.organizationId, { status: "SUBMITTED", take: 50 }),
    listKpiReviewsForManager(u.id, u.organizationId, { statuses: ["APPROVED", "REJECTED"], take: 30 }),
  ]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>KPI approvals</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#f59e0b]/10 shrink-0">
            <Award className="h-5 w-5 text-[#f59e0b]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">KPI approvals</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">sign off on reported KPI scores, or send back for changes</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 max-w-[1280px]">
        <KpiReviewsClient pending={pending} acted={acted} />
      </div>
    </div>
  );
}
