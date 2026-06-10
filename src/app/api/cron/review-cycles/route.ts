import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getReviewCadences, cadenceWindow, anchorReached,
  CADENCE_LABELS, CADENCE_REVIEW_TYPE,
  type CadenceKey,
} from "@/lib/review-cadence";

/**
 * Cron — auto-opens performance review cycles from each org's configured
 * cadences (Settings → Scoring & reviews → reviewCadences).
 *
 * For every org and every enabled cadence with autoOpen=true, once the
 * cadence's anchor lands within the current period (e.g. monthly anchor =
 * day-of-month), we ensure a DRAFT ReviewCycle exists for that period. A
 * manager then launches it (populates Review rows) from /reviews.
 *
 * The weekly check-in is NOT handled here — it's the per-user WeeklyReview
 * created on demand by getOrCreateWeeklyReview. This cron only covers the
 * org-wide ReviewCycle cadences: monthly / quarterly / annual.
 *
 * Idempotency: a cycle is keyed by (organizationId, type, startDate). We
 * skip creation if one already exists for the current period window, so
 * running daily is safe.
 *
 * Schedule: once a day. Guard with CRON_SECRET in production.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const now = new Date();
  // Cadences that map to a ReviewCycle (weekly is per-user, handled elsewhere).
  const CYCLE_CADENCES: Exclude<CadenceKey, "weekly">[] = ["monthly", "quarterly", "annual"];

  const orgs = await prisma.organization.findMany({ select: { id: true, settings: true } });

  let orgsScanned = 0;
  let cyclesCreated = 0;
  const created: Array<{ organizationId: string; type: string; name: string }> = [];

  for (const org of orgs) {
    orgsScanned++;
    const cadences = getReviewCadences(org.settings as Record<string, unknown> | null);

    for (const cadence of CYCLE_CADENCES) {
      const cfg = cadences[cadence];
      if (!cfg.enabled || !cfg.autoOpen) continue;
      if (!anchorReached(cadence, cfg.anchor, now)) continue;

      const { key, start, end } = cadenceWindow(cadence, now);
      const type = CADENCE_REVIEW_TYPE[cadence];

      // Already opened for this period? (dedup on the period start).
      const existing = await prisma.reviewCycle.findFirst({
        where: { organizationId: org.id, type, startDate: start },
        select: { id: true },
      });
      if (existing) continue;

      const name = `${key} · ${CADENCE_LABELS[cadence]}`;
      await prisma.reviewCycle.create({
        data: {
          organizationId: org.id,
          name,
          type,
          startDate: start,
          endDate: end,
          status: "DRAFT",
        },
      });
      cyclesCreated++;
      created.push({ organizationId: org.id, type, name });
    }
  }

  return Response.json({
    ran: true,
    at: now.toISOString(),
    orgsScanned,
    cyclesCreated,
    created,
  });
}
