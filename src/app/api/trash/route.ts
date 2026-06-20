import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { purgeExpiredTrash } from "@/lib/trash";

const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;

// GET: the org recycle bin (manager-gated). Aggregates two sources:
//   1. TrashItem snapshots (SOPs, Tables, Files, Policies — hard-deleted)
//   2. Archived Docs + Whiteboards (archivedAt = their "trash")
// Items older than 60 days are purged first.
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const cutoff = new Date(Date.now() - SIXTY_DAYS);

  // Purge expired across all sources.
  await purgeExpiredTrash(orgId);
  await prisma.doc.deleteMany({ where: { organizationId: orgId, archivedAt: { lt: cutoff } } });
  await prisma.whiteboard.deleteMany({ where: { organizationId: orgId, archivedAt: { lt: cutoff } } });
  await prisma.agreement.deleteMany({ where: { organizationId: orgId, archivedAt: { lt: cutoff } } });

  const [snaps, docs, whiteboards, contracts] = await Promise.all([
    prisma.trashItem.findMany({
      where: { organizationId: orgId },
      orderBy: { deletedAt: "desc" },
      select: { id: true, entityType: true, entityId: true, label: true, deletedByName: true, deletedAt: true },
    }),
    prisma.doc.findMany({
      where: { organizationId: orgId, archivedAt: { not: null } },
      select: { id: true, title: true, archivedAt: true },
    }),
    prisma.whiteboard.findMany({
      where: { organizationId: orgId, archivedAt: { not: null } },
      select: { id: true, name: true, archivedAt: true },
    }),
    prisma.agreement.findMany({
      where: { organizationId: orgId, archivedAt: { not: null } },
      select: { id: true, title: true, isTemplate: true, archivedAt: true },
    }),
  ]);

  // Virtual items use a prefixed id so restore/delete can route by source.
  const items = [
    ...snaps,
    ...docs.map((d) => ({ id: `doc:${d.id}`, entityType: "note", entityId: d.id, label: d.title || "Untitled note", deletedByName: null, deletedAt: d.archivedAt })),
    ...whiteboards.map((w) => ({ id: `wb:${w.id}`, entityType: "whiteboard", entityId: w.id, label: w.name || "Untitled whiteboard", deletedByName: null, deletedAt: w.archivedAt })),
    ...contracts.map((c) => ({ id: `agr:${c.id}`, entityType: c.isTemplate ? "template" : "contract", entityId: c.id, label: c.title || "Untitled contract", deletedByName: null, deletedAt: c.archivedAt })),
  ].sort((a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime());

  return jsonSuccess({ items });
}
