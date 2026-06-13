// /team/kpi-reviews — manager queue for submitted KPI scores. Sibling of
// /team/reviews (weekly reviews). Two sections: "Awaiting your approval"
// (SUBMITTED) with inline Approve / Request-changes, and "Recently acted".

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAccess, meets } from "@/lib/access";
import { listKpiReviewsForManager } from "@/lib/kpi-record";
import { KpiReviewsClient } from "@/components/team/kpi-reviews-client";
import { Users as UsersIcon } from "lucide-react";

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
    <div className="px-8 py-6 max-w-[1100px]">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-2">
          <UsersIcon className="w-3.5 h-3.5" />
          <span>Team</span>
          <span>/</span>
          <span>KPI approvals</span>
        </div>
        <h1 className="text-2xl font-semibold">KPI approvals</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-[640px]">
          KPI scores submitted by your direct and dotted reports. Approve them or send them back for
          changes — sent-back scores re-open for the report to resubmit.
        </p>
      </header>

      <KpiReviewsClient pending={pending} acted={acted} />
    </div>
  );
}
