// /me/weekly-review — the heartbeat surface.
//
// SSR page resolves the current-week review (auto-creates a DRAFT)
// and hands it to a client form for editing. Sections:
//   - KRA progress sliders (one per active KRA assignment)
//   - KPI snapshot inputs (one per active KPI under those KRAs)
//   - Highlights / Blockers / Plan text areas
//   - Save draft / Submit / (if SUBMITTED) Reopen
//
// Status banner reflects DRAFT / SUBMITTED / ACKNOWLEDGED + manager
// status (PENDING / APPROVED / CHANGES_REQUESTED).

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrCreateWeeklyReview, formatWeekRange } from "@/lib/weekly-review";
import { WeeklyReviewForm } from "@/components/me/weekly-review-form";
import Link from "next/link";
import { ChevronRight, ClipboardCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WeeklyReviewPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const review = await getOrCreateWeeklyReview({
    userId: u.id,
    organizationId: u.organizationId,
  });

  // Fetch the user's active KRAs (with their KPIs) so the form can
  // render one row per KRA / KPI without a client round-trip.
  const assignments = await prisma.kRAAssignment.findMany({
    where: { userId: u.id, status: "ACTIVE" },
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

  const kras = assignments.map((a) => ({
    id: a.kra.id,
    name: a.kra.name,
    category: a.kra.category,
    weightage: a.weightage,
    kpis: a.kra.kpis,
  }));

  return (
    <div className="px-8 py-6 max-w-[920px]">
      <header className="mb-5">
        <div className="flex items-center gap-2 text-sm text-muted mb-2">
          <Link href="/today" className="hover:text-foreground">Today</Link>
          <ChevronRight className="w-3 h-3" />
          <span>Weekly review</span>
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-[var(--os-brand)]" />
          Weekly review
        </h1>
        <p className="text-sm text-muted mt-1">
          {formatWeekRange(review.periodStart)} · the cadence is mandatory; your manager rolls this up.
        </p>
      </header>

      <WeeklyReviewForm initialReview={review} kras={kras} />
    </div>
  );
}
