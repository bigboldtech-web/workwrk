// /team/reviews — manager queue for weekly reviews.
//
// Two sections:
//   1. Awaiting your review (status=SUBMITTED, managerStatus=PENDING)
//      — each card expands to show body + Approve / Request changes
//   2. Recently acted (status=ACKNOWLEDGED, last 30 days)
//      — read-only summary of what was decided

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAccess, meets } from "@/lib/access";
import { listReviewsForManager } from "@/lib/weekly-review";
import { TeamReviewsClient } from "@/components/team/team-reviews-client";
import { Users as UsersIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TeamReviewsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const decision = await resolveAccess(
    { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" },
    { type: "module", name: "team/reviews" },
  );
  if (!meets(decision, "read")) redirect("/today");

  const [pending, acted] = await Promise.all([
    listReviewsForManager(u.id, { status: "SUBMITTED", take: 50 }),
    listReviewsForManager(u.id, { status: "ACKNOWLEDGED", take: 30 }),
  ]);

  return (
    <div className="px-8 py-6 max-w-[1100px]">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-2">
          <UsersIcon className="w-3.5 h-3.5" />
          <span>Team</span>
          <span>/</span>
          <span>Weekly reviews</span>
        </div>
        <h1 className="text-2xl font-semibold">Weekly reviews</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-[640px]">
          Reviews submitted by your direct and dotted reports. Approve or request changes so the rollup stays current.
        </p>
      </header>

      <TeamReviewsClient pending={pending} acted={acted} />
    </div>
  );
}
