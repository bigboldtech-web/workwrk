// Version history for one automation (spec-ai-automation
// /automation/workflows/[id], "Version history modal"). A version row is
// written on every publish, and once more when a restore replaces a draft
// that had changes nobody published (so the restore is reversible: that
// draft is kept as its own numbered row). The definition itself is not
// returned to the list, so the modal stays cheap.

import { prisma } from "@/lib/prisma";
import { readSnapshotNote } from "./definition";

export interface VersionRow {
  number: number;
  /** When it was published, or kept. */
  publishedAt: string;
  /** gone: no longer in the workspace (the engine then reaches no List with this version, author-reach.ts). */
  publishedBy: { id: string; name: string; gone: boolean } | null;
  /** The version the automation runs right now. */
  isLive: boolean;
  /** "published", or "kept" for a draft saved before a restore replaced it. */
  kind: "published" | "kept";
  restoredFrom: number | null;
}

export async function listVersions(orgId: string, workflowId: string, publishedVersionId: string | null): Promise<VersionRow[]> {
  const rows = await prisma.automationWorkflowVersion.findMany({
    where: { organizationId: orgId, workflowId },
    orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, definitionJson: true, createdById: true, createdAt: true },
    take: 200,
  });
  const userIds = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  return rows.map((r) => {
    const note = readSnapshotNote(r.definitionJson);
    return {
      number: r.versionNumber,
      publishedAt: r.createdAt.toISOString(),
      publishedBy: r.createdById ? { id: r.createdById, name: nameById.get(r.createdById) ?? "Former member", gone: !nameById.has(r.createdById) } : null,
      isLive: r.id === publishedVersionId,
      kind: note ? "kept" : "published",
      restoredFrom: note?.restoredFrom ?? null,
    };
  });
}
