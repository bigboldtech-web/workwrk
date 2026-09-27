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
import { gatePage } from "@/lib/access/gate";
import { listReviewsForManager } from "@/lib/weekly-review";
import { TeamReviewsClient } from "@/components/team/team-reviews-client";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TeamReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  // The one gate shape (Phase 6): the `weekly-reviews` APP_RULES row, anyone with
  // reports (solid or dotted) over their chain, the People team and Admin
  // over the org; anyone else gets the in-shell 404.
  await gatePage("view", { type: "app", key: "weekly-reviews" }, { callbackUrl: "/team/reviews" });

  // Pending is every review awaiting this manager (uncapped, the same where
  // clause as the sidebar badge, so the two never disagree). Acted is the
  // last 30 days of decisions on their reports, plus the ones they made
  // themselves elsewhere (a skip-level Approve on the Alignment board).
  const [allPending, allActed] = await Promise.all([
    listReviewsForManager(u.id, { status: "SUBMITTED" }),
    listReviewsForManager(u.id, { status: "ACKNOWLEDGED", sinceDays: 30, alsoDecidedBy: true }),
  ]);
  // ?person= (Alignment's row menu, Open weekly review): that person's
  // reviews only, from the same queue, so it never reveals anyone the queue
  // would not list. Unknown ids simply show nobody.
  const sp = await searchParams;
  const person = typeof sp.person === "string" && sp.person ? sp.person : null;
  const pending = person ? allPending.filter((r) => r.userId === person) : allPending;
  const acted = person ? allActed.filter((r) => r.userId === person) : allActed;
  const focusName = person
    ? (() => { const s = [...allPending, ...allActed].find((r) => r.userId === person)?.subject; return s ? `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim() || s.email : null; })()
    : null;

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>Weekly reviews</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#dc2626]/10 shrink-0">
            <ClipboardCheck className="h-5 w-5 text-[#dc2626]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">Weekly reviews</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">from the people who report to you: approve or request changes</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 max-w-[1280px]">
        {person ? (
          <p className="mb-3 text-sm text-ink-2">
            {focusName ? `Showing ${focusName}'s weekly reviews.` : "Nothing from this person is waiting for you or was decided in the last 30 days."}{" "}
            <Link href="/team/reviews" className="text-brand-deep hover:underline">Show everyone</Link>
          </p>
        ) : null}
        <TeamReviewsClient pending={pending} acted={acted} />
      </div>
    </div>
  );
}
