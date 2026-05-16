import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";

/**
 * Cron — hard-delete tenants whose 30-day grace window has elapsed.
 *
 * Work queue: organizations with status=CANCELLED whose
 * settings.scheduledHardDeleteAt is in the past.
 *
 * Each row is deleted in its own transaction so a misbehaving cascade
 * on one tenant doesn't block the rest of the batch. Prisma cascades
 * on the Organization relations clean up users, departments, tasks,
 * etc. The audit row we write here lives on the actor's row (which
 * survives) but the targetId points at an org that's about to vanish —
 * the audit trail is the only post-deletion forensic surface.
 *
 * Recommended schedule: hourly. Lateness tolerance is ~1 day since
 * the grace window is already 30 days.
 *
 * Guard with CRON_SECRET in production.
 */
interface OrgSettingsWithDeletion {
  cancelledAt?: string;
  cancelledById?: string;
  scheduledHardDeleteAt?: string;
  [key: string]: unknown;
}

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

  // We can't filter on a JSON field's date string portably across
  // Postgres dialects, so scan the small CANCELLED set in-memory.
  // CANCELLED orgs are rare; this query stays cheap.
  const candidates = await prisma.organization.findMany({
    where: { status: "CANCELLED" },
    select: { id: true, name: true, settings: true },
    take: 200,
  });

  const due = candidates.filter((org) => {
    const settings = (org.settings ?? {}) as OrgSettingsWithDeletion;
    const scheduled = settings.scheduledHardDeleteAt;
    if (!scheduled) return false;
    const at = new Date(scheduled);
    return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
  });

  let deleted = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const org of due) {
    const settings = (org.settings ?? {}) as OrgSettingsWithDeletion;
    const actorId = settings.cancelledById ?? null;
    try {
      // Audit FIRST while the org still exists — once we delete the
      // org, the cascade may wipe related rows and we want the trail
      // anchored to a clean state. The actor row survives (Users on
      // *other* orgs aren't touched; the requester's own row vanishes
      // with the org, which is correct).
      logAuditEvent({
        type: "organization_hard_deleted",
        actorId: actorId ?? org.id, // fall back to org id so we always have a value
        organizationId: org.id,
        description: `Hard-deleted organization "${org.name}" after 30-day grace expired.`,
        targetId: org.id,
        targetType: "organization",
        metadata: {
          cancelledAt: settings.cancelledAt ?? null,
          scheduledHardDeleteAt: settings.scheduledHardDeleteAt ?? null,
        },
        severity: "critical",
      });

      await prisma.organization.delete({ where: { id: org.id } });
      deleted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[org-hard-delete] failed for ${org.id}:`, err);
      failures.push({ id: org.id, error: message });
    }
  }

  return Response.json({
    ok: true,
    scanned: candidates.length,
    eligible: due.length,
    deleted,
    failures,
  });
}
