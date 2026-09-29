// Review cycle page. Gate (Phase 6, spec-teams-performance section 1 Access,
// PO-2): the page opens to everyone the cycle is about, not only HR. Every
// notification and email about a cycle links here, and the people they go to
// (subjects, reviewers, peers) used to get the in-shell 404.
//
//   the subject of a review in the cycle          My review
//   the reviewer of a review in the cycle         Manager reviews
//   someone asked for peer feedback in the cycle  Peer feedback
//   anyone above a subject in the chain           the cycle's counts
//   the People team, Admin, the cycle's starter   everything, plus launch,
//                                                 calibrate and finalize
//
// Anyone else gets the 404: the cycle is not discoverable to them, so its
// name is never confirmed. Each section's API scopes its own rows again.

import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { canManageReviewCycle, chainOf } from "@/lib/people/review-cycle-access";
import ReviewDetailClient, { type CycleFaces } from "./review-detail-client";

export const dynamic = "force-dynamic";

export default async function ReviewCycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await viewerFromSession();
  if (!viewer) redirect(`/login?callbackUrl=${encodeURIComponent(`/reviews/${id}`)}`);
  if (viewer.orgRole === "GUEST") notFound();

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: viewer.organizationId },
    select: { id: true, createdById: true },
  });
  if (!cycle) notFound();

  const [canManage, subjectRows, reviewerRows, peerRows, chain] = await Promise.all([
    canManageReviewCycle(null, cycle),
    prisma.review.count({ where: { cycleId: id, subjectId: viewer.userId } }),
    prisma.review.count({ where: { cycleId: id, reviewerId: viewer.userId, subjectId: { not: viewer.userId } } }),
    prisma.peerFeedback.count({ where: { giverId: viewer.userId, review: { cycleId: id } } }),
    chainOf(viewer.userId),
  ]);
  const chainRows = chain.length > 0
    ? await prisma.review.count({ where: { cycleId: id, subjectId: { in: chain } } })
    : 0;

  const peopleOrAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN" || viewer.peopleTeam === true;
  const faces: CycleFaces = {
    self: subjectRows > 0,
    team: reviewerRows > 0,
    peer: peerRows > 0,
    canManage,
    chain: chainRows > 0,
    // The Review cycles row (APP_RULES reviews): anyone with reports, the
    // People team and Admin. A subject without it goes back to My profile,
    // never to a page that would 404 for them.
    canSeeList: peopleOrAdmin || chain.length > 0,
  };
  if (!faces.self && !faces.team && !faces.peer && !faces.canManage && !faces.chain) notFound();

  return (
    <div className="flex h-full min-h-0 flex-col bg-raised">
      {/* bg-raised is the white canvas the list pages use; bg-surface is the
          legacy warm grey (#F7F7F6) and made this page float on grey. */}
      <Suspense>
        <ReviewDetailClient cycleId={id} faces={faces} />
      </Suspense>
    </div>
  );
}
