import { prisma } from "@/lib/prisma";
import { isOrgAdmin } from "@/lib/api-helpers";

/**
 * Centralised SOP visibility rules. Every SOP read path goes through here.
 *
 * Folder access cascades down the tree. If a user has access to "HR",
 * they can also see "HR / Onboarding", "HR / Hiring", etc., without
 * needing a separate grant for each child. This is computed via a
 * recursive CTE so it stays fast even on deep trees.
 *
 *   · Org admins → no scoping (see every SOP in the org).
 *   · Everyone else → SOPs with `folderId IS NULL` (unfoldered, org-wide
 *     visible) OR whose folder is in the user's accessible-folder set
 *     (own grants + descendants of those).
 */

/**
 * Walk down from each folder in `seedIds` and return the full set of
 * folders the user can reach by inheritance. Pure DB work — one round
 * trip, no per-row queries.
 */
async function expandAccessibleFolderIds(seedIds: string[]): Promise<string[]> {
  if (seedIds.length === 0) return [];

  // Recursive CTE: start from the seed folders, walk children depth-first.
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    WITH RECURSIVE accessible AS (
      SELECT id FROM "SOPFolder" WHERE id = ANY($1::text[])
      UNION
      SELECT f.id FROM "SOPFolder" f
        JOIN accessible a ON f."parentId" = a.id
    )
    SELECT id FROM accessible
  `, seedIds);

  return rows.map((r) => r.id);
}

export async function sopVisibilityWhere(
  session: any,
): Promise<Record<string, unknown>> {
  if (isOrgAdmin(session)) return {};

  const userId = session.user?.id as string;
  if (!userId) return { id: "__no_session__" };

  const grants = await prisma.sOPFolderAccess.findMany({
    where: { userId },
    select: { folderId: true },
  });
  const seedIds = grants.map((g) => g.folderId);
  const folderIds = await expandAccessibleFolderIds(seedIds);

  return {
    OR: [
      { folderId: null },
      ...(folderIds.length > 0 ? [{ folderId: { in: folderIds } }] : []),
    ],
  };
}

/**
 * Can the session user write into `folderId`? Admins always can,
 * `null` (unfoldered) is open to everyone, and otherwise we resolve
 * the folder's ancestor chain — a grant on any ancestor is enough.
 */
export async function canWriteToFolder(
  session: any,
  folderId: string | null,
): Promise<boolean> {
  if (!folderId) return true;
  if (isOrgAdmin(session)) return true;

  const userId = session.user?.id as string;
  if (!userId) return false;

  // Walk ancestors of `folderId` and check if any of them is in the
  // user's grant list.
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId" FROM "SOPFolder" WHERE id = $1::text
      UNION
      SELECT f.id, f."parentId" FROM "SOPFolder" f
        JOIN chain c ON f.id = c."parentId"
    )
    SELECT id FROM chain
  `, folderId);

  if (rows.length === 0) return false;

  const grant = await prisma.sOPFolderAccess.findFirst({
    where: { userId, folderId: { in: rows.map((r) => r.id) } },
    select: { folderId: true },
  });
  return !!grant;
}

/**
 * Returns the descendant set (inclusive) for `folderId`. Useful when
 * filtering SOPs by a single folder pick — clicking "HR" should also
 * surface SOPs in "HR / Onboarding".
 */
export async function descendantFolderIds(folderId: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    WITH RECURSIVE descendants AS (
      SELECT id FROM "SOPFolder" WHERE id = $1::text
      UNION
      SELECT f.id FROM "SOPFolder" f
        JOIN descendants d ON f."parentId" = d.id
    )
    SELECT id FROM descendants
  `, folderId);
  return rows.map((r) => r.id);
}
