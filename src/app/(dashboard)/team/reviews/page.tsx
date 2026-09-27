// Teams > Weekly reviews (spec-teams-performance /team/reviews): read the
// weekly reviews your people wrote and approve them or ask for changes.
//
// Gate: the `weekly-reviews` APP_RULES row, anyone with reports (solid or
// dotted, any depth) over their chain, the People team and Admin over the
// org; anyone else gets the in-shell 404 (an app-key denial, access 5.5
// rule 6). Their own weekly review lives at /me/weekly-review.
//
// The page is the standard header stack over a TableCard (views Waiting on
// you, Acted and All; Filter, Sort, Group), and a review opens in a drawer at
// ?review={id}. Everything reads GET /api/weekly-reviews and
// GET /api/weekly-reviews/[id]; a decision is the one PATCH the Alignment
// board writes too (PO-1).

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { gatePage } from "@/lib/access/gate";
import { weeklyQueueCtx } from "@/lib/people/weekly-queue.server";
import { WeeklyReviewsView } from "@/components/team/weekly-reviews-view";

export const dynamic = "force-dynamic";

export default async function TeamReviewsPage() {
  await gatePage("view", { type: "app", key: "weekly-reviews" }, { callbackUrl: "/team/reviews" });
  const ctx = await weeklyQueueCtx();
  if (!ctx) redirect("/login?callbackUrl=%2Fteam%2Freviews");
  return (
    <div className="flex h-full flex-col bg-surface">
      <Suspense>
        <WeeklyReviewsView
          viewerId={ctx.userId}
          hasReports={ctx.hasReports}
          canExportAll={ctx.peopleTeamOrAdmin}
          isAgent={ctx.isAgent}
        />
      </Suspense>
    </div>
  );
}
