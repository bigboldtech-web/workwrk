import { prisma } from "@/lib/prisma";
import { isOrgAdmin } from "@/lib/api-helpers";

/**
 * Centralised SOP visibility rule used by every SOP read path.
 *
 * Returns a Prisma `where` clause that scopes a query to the SOPs
 * a given session user is allowed to see:
 *
 *   · Org admins → no scoping (see every SOP in the org).
 *   · Everyone else → SOPs with `folderId IS NULL` (legacy / unfoldered,
 *     treated as org-wide visible) OR whose folder the user has been
 *     granted access to via SOPFolderAccess.
 *
 * The caller is expected to compose this with org scoping (organizationId).
 */
export async function sopVisibilityWhere(
  session: any,
): Promise<Record<string, unknown>> {
  if (isOrgAdmin(session)) return {};

  const userId = session.user.id as string;
  const rows = await prisma.sOPFolderAccess.findMany({
    where: { userId },
    select: { folderId: true },
  });
  const folderIds = rows.map((r) => r.folderId);

  return {
    OR: [
      { folderId: null },
      ...(folderIds.length > 0 ? [{ folderId: { in: folderIds } }] : []),
    ],
  };
}

/**
 * Check whether a user can write to (create/modify/delete SOPs in) a
 * particular folder. Admins can touch any folder. Other users must
 * have SOPFolderAccess granted.
 *
 * `null` folderId means "unfoldered" — allowed for everyone so they
 * can keep creating uncategorized SOPs the same way they always did.
 */
export async function canWriteToFolder(
  session: any,
  folderId: string | null,
): Promise<boolean> {
  if (!folderId) return true;
  if (isOrgAdmin(session)) return true;

  const userId = session.user.id as string;
  const row = await prisma.sOPFolderAccess.findUnique({
    where: { folderId_userId: { folderId, userId } },
    select: { folderId: true },
  });
  return !!row;
}
