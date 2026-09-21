// The sampled `access.public_link.used` audit row (access-model invariant 19,
// spec-process section 2 `/share/sop/[token]`): one write in twenty hits, so
// an org can see its public links are used without a row per visit. Kept out
// of the page so the sampling is not a render-time side effect. Server-only.

import { prisma } from "@/lib/prisma";

export const PUBLIC_LINK_AUDIT_SAMPLE = 0.05;

export async function auditPublicLinkUse(input: { organizationId: string; targetType: string; targetId: string; title: string }, sample: number = Math.random()): Promise<boolean> {
  if (sample >= PUBLIC_LINK_AUDIT_SAMPLE) return false;
  // ActivityLog.actorId is required; the record is attributed to the
  // workspace's earliest live account, the same choice the migration scripts make.
  const actor = await prisma.user.findFirst({ where: { organizationId: input.organizationId, deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!actor) return false;
  try {
    await prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: actor.id,
        type: "access.public_link.used",
        targetType: input.targetType,
        targetId: input.targetId,
        description: `Public link opened for "${input.title}"`,
        metadata: { sampled: true },
      },
    });
    return true;
  } catch {
    return false;
  }
}
