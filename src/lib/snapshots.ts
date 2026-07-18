// Content version history — the "never lose it" safety net.
//
// recordSnapshot() is called server-side AFTER a successful save (whiteboard
// scene, doc body). It is best-effort and fully swallowed: a snapshot failure
// must NEVER surface to the caller or affect the save that just succeeded.
// Snapshots are throttled (at most one per THROTTLE window per entity) and
// pruned to the most recent KEEP per entity, so history stays bounded.
//
// Restore copies a snapshot's content back onto the live record — and snapshots
// the current state first, so a restore is itself reversible.

import { prisma } from "@/lib/prisma";

export type SnapshotEntity = "WHITEBOARD" | "DOC";

const THROTTLE_MS = 3 * 60 * 1000; // don't snapshot more than once per 3 min
const KEEP = 40; // retain the most recent 40 per entity

/** Best-effort: record a point-in-time snapshot. Never throws. Pass force=true
 *  to bypass the throttle (e.g. capturing current state right before a restore). */
export async function recordSnapshot(
  entityType: SnapshotEntity,
  entityId: string,
  organizationId: string,
  content: unknown,
  createdById: string | null = null,
  force = false,
): Promise<void> {
  try {
    if (content == null) return;
    if (!force) {
      const last = await prisma.contentSnapshot.findFirst({
        where: { entityType, entityId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (last && Date.now() - last.createdAt.getTime() < THROTTLE_MS) return;
    }

    await prisma.contentSnapshot.create({
      data: { entityType, entityId, organizationId, content: content as object, createdById },
    });

    // Prune everything past the most recent KEEP.
    const stale = await prisma.contentSnapshot.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      skip: KEEP,
      select: { id: true },
    });
    if (stale.length) {
      await prisma.contentSnapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  } catch (e) {
    console.error("recordSnapshot failed", entityType, entityId, e);
  }
}

export type SnapshotSummary = {
  id: string;
  createdAt: Date;
  createdBy: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
};

/** List a piece of content's version history (newest first). */
export async function listSnapshots(entityType: SnapshotEntity, entityId: string, take = 40): Promise<SnapshotSummary[]> {
  const rows = await prisma.contentSnapshot.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, createdAt: true, createdById: true },
  });
  const ids = Array.from(new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x)));
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, avatar: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    createdBy: r.createdById ? byId.get(r.createdById) ?? null : null,
  }));
}

/** Fetch one snapshot's content, scoped to its entity (prevents cross-entity reads). */
export async function getSnapshotContent(
  entityType: SnapshotEntity,
  entityId: string,
  snapshotId: string,
): Promise<unknown | null> {
  const snap = await prisma.contentSnapshot.findFirst({
    where: { id: snapshotId, entityType, entityId },
    select: { content: true },
  });
  return snap ? snap.content : null;
}
