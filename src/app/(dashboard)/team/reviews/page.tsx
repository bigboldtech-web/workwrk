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
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

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
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>Reviews</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#dc2626]/10 shrink-0">
            <ClipboardCheck className="h-5 w-5 text-[#dc2626]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">Reviews</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">weekly reviews from your reports — approve or request changes</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 max-w-[1280px]">
        <TeamReviewsClient pending={pending} acted={acted} />
      </div>
    </div>
  );
}
