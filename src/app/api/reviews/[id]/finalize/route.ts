// POST /api/reviews/[id]/finalize { outcomes?, placeOnTalentGrid? }
//   -> { finalized, remaining, completed, placed }
//
// Finalize outcomes (spec-teams-performance /reviews/[id] Calibration): the
// ONLY path to Completed. The cycle must be In calibration. Every review in
// the runner's reach that carries an outcome is finalized with its score
// (the calibrated score, else the composite from Settings > Scoring and
// reviews), or the explicit `outcomes` list when a caller sends one.
//
// Worst cases decided here:
//   - The cycle is marked Completed only when EVERY review in it is
//     completed. A runner who can reach only part of it (a manager who
//     started a cycle some people have since left their chain), or who
//     finalized only the rows with an outcome, leaves the cycle In
//     calibration and is told how many remain. The old route marked the
//     cycle done and told everybody, including people whose review was
//     never finalized.
//   - Only the people finalized are notified, and only now.
//   - "Also place these people on the talent grid" (on by default) writes
//     one TalentAssessment per finalized review: period = the cycle's name,
//     performance from the score through Settings > Performance bands,
//     potential from the Potential column (Medium when unset), source
//     CALIBRATION with the cycle id. A placement someone made by hand for
//     the same period is never overwritten.

import { canManageReviewCycle, cycleSubjectReach } from "@/lib/people/review-cycle-access";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { reviewCompletedTemplate } from "@/lib/email-templates";
import { broadcastWebhook } from "@/lib/webhooks";
import { triggerRecalculation } from "@/services/performanceScoreService";
import { calibrationNumbers, orgScoring, sopScoresFor } from "@/lib/performance/review-cycle.server";
import { isOutcome, performanceLevel } from "@/lib/performance/review-cycle";

type Outcome = "PROMOTION_ELIGIBLE" | "HIKE_ELIGIBLE" | "STATUS_QUO" | "PIP_REQUIRED" | "EXIT_RECOMMENDATION";
const TALENT_ACTION: Record<Outcome, string | null> = {
  PROMOTION_ELIGIBLE: "Promote",
  HIKE_ELIGIBLE: "Retain",
  STATUS_QUO: null,
  PIP_REQUIRED: "PIP",
  EXIT_RECOMMENDATION: "Exit",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const orgId = getOrgId(session);
  const actorId = getUserId(session);

  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, organizationId: orgId } });
  if (!cycle) return jsonError("Review cycle not found", 404);
  if (!(await canManageReviewCycle(session, cycle))) {
    return jsonError("Only the People team, an Admin or the manager who started this cycle can finalize it", 403);
  }
  if (cycle.status !== "IN_CALIBRATION") return jsonError("Start calibration before you finalize", 409);

  const body = ((await req.json().catch(() => null)) ?? {}) as { outcomes?: unknown; placeOnTalentGrid?: unknown };
  const place = body.placeOnTalentGrid !== false;
  const explicit = Array.isArray(body.outcomes) ? (body.outcomes as Array<{ reviewId?: unknown; outcome?: unknown; overallScore?: unknown }>) : null;
  if (explicit) {
    for (const o of explicit) if (!isOutcome(o?.outcome)) return jsonError("Unknown outcome", 400);
  }

  const reach = await cycleSubjectReach(session);
  const candidates = await prisma.review.findMany({
    where: {
      cycleId,
      status: { not: "COMPLETED" },
      ...(reach ? { subjectId: { in: [...reach] } } : {}),
      ...(explicit ? { id: { in: explicit.map((o) => String(o.reviewId ?? "")) } } : { outcome: { not: null } }),
    },
    include: { peerFeedback: { where: { status: "SUBMITTED" }, select: { rating: true, collaborationRating: true } } },
  });
  if (explicit && candidates.length !== explicit.length) {
    return jsonError("Some of these reviews are not yours to finalize, are already final, or are not in this cycle", 403);
  }
  if (!candidates.length) return jsonError("Nothing to finalize: set an outcome for at least one person", 400);

  const scoring = await orgScoring(orgId);
  const sop = await sopScoresFor(candidates.map((r) => r.subjectId), { start: cycle.startDate, end: cycle.endDate });
  const explicitById = new Map((explicit ?? []).map((o) => [String(o.reviewId), o] as const));

  const finals = candidates.map((r) => {
    const n = calibrationNumbers({
      kpiScore: r.kpiScore ?? null,
      managerRating: r.managerRating ?? null,
      selfRatings: r.selfRatings,
      peerRatings: r.peerFeedback.map((f) => f.collaborationRating ?? f.rating),
      sopScore: sop.get(r.subjectId) ?? null,
    }, scoring.weights);
    const e = explicitById.get(r.id);
    const outcome = (e?.outcome as Outcome | undefined) ?? (r.outcome as Outcome);
    const eScore = typeof e?.overallScore === "number" && Number.isFinite(e.overallScore) ? e.overallScore : null;
    const score = eScore ?? r.calibratedScore ?? n.composite;
    return { review: r, outcome, score, composite: n.composite };
  });

  // Guarded on "not completed", so two runners finalizing at once never
  // double-notify: only the rows this call moved count.
  const moved: typeof finals = [];
  for (const f of finals) {
    const res = await prisma.review.updateMany({
      where: { id: f.review.id, cycleId, status: { not: "COMPLETED" } },
      data: { outcome: f.outcome, overallScore: f.score ?? undefined, compositeScore: f.composite ?? undefined, status: "COMPLETED" },
    });
    if (res.count) moved.push(f);
  }

  const remaining = await prisma.review.count({ where: { cycleId, status: { not: "COMPLETED" } } });
  let completed = false;
  if (remaining === 0) {
    const r = await prisma.reviewCycle.updateMany({ where: { id: cycleId, status: "IN_CALIBRATION" }, data: { status: "COMPLETED" } });
    completed = r.count > 0;
  }

  // The talent grid feed (existing-direction 5.2: "Talent 9-box still not
  // fed by calibration").
  let placed = 0;
  if (place && moved.length) {
    const period = cycle.name;
    const manual = await prisma.talentAssessment.findMany({
      where: { organizationId: orgId, period, userId: { in: moved.map((m) => m.review.subjectId) }, source: "MANUAL" },
      select: { userId: true },
    });
    const keepManual = new Set(manual.map((m) => m.userId));
    for (const m of moved) {
      if (keepManual.has(m.review.subjectId)) continue;
      const performance = performanceLevel(m.score, scoring.bands);
      if (!performance) continue;
      const potential = m.review.potential && [1, 2, 3].includes(m.review.potential) ? m.review.potential : 2;
      await prisma.talentAssessment.upsert({
        where: { userId_period_organizationId: { userId: m.review.subjectId, period, organizationId: orgId } },
        create: {
          userId: m.review.subjectId, period, performance, potential, boxPosition: `${performance}-${potential}`,
          action: TALENT_ACTION[m.outcome] ?? null, notes: `From review cycle ${cycle.name}`,
          assessedBy: actorId, organizationId: orgId, source: "CALIBRATION", cycleId,
        },
        update: {
          performance, potential, boxPosition: `${performance}-${potential}`,
          action: TALENT_ACTION[m.outcome] ?? null, notes: `From review cycle ${cycle.name}`,
          assessedBy: actorId, source: "CALIBRATION", cycleId,
        },
      });
      placed += 1;
    }
  }

  if (moved.length) {
    await prisma.notification.createMany({
      data: moved.map((m) => ({
        title: `Your ${cycle.name} review is complete`,
        message: "Your result and your appraisal letter are ready.",
        type: "review",
        link: `/reviews/${cycleId}`,
        userId: m.review.subjectId,
      })),
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const subjectUsers = await prisma.user.findMany({
      where: { id: { in: moved.map((m) => m.review.subjectId) } },
      select: { id: true, email: true },
    });
    const { subject, html } = reviewCompletedTemplate({ reviewCycleName: cycle.name, reviewLink: `${baseUrl}/reviews/${cycleId}` });
    await Promise.all(
      subjectUsers.map((user) =>
        sendEmail({
          to: user.email, subject, html, template: "review-completed",
          variables: { reviewCycleName: cycle.name }, organizationId: orgId, userId: user.id, category: "review",
        }).catch((emailErr) => console.error("[ReviewFinalize] Email send failed:", emailErr)),
      ),
    );

    logActivity({
      type: "reviews_finalized",
      actorId,
      organizationId: orgId,
      description: `Finalized ${moved.length} reviews in ${cycle.name}`,
      targetId: cycleId,
      targetType: "review_cycle",
      metadata: { finalized: moved.length, remaining, completed, placed },
    });

    broadcastWebhook({
      organizationId: orgId,
      event: "reviews_finalized",
      payload: { cycleId, cycleName: cycle.name, reviewCount: moved.length },
    });

    for (const m of moved) triggerRecalculation(m.review.subjectId, orgId);
  }

  return jsonSuccess({ finalized: moved.length, remaining, completed, placed, message: `${moved.length} reviews finalized` });
}
