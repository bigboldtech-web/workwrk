import { prisma } from "@/lib/prisma";
import { hasPermission, isOrgAdmin } from "@/lib/api-helpers";

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

type SessionLike = { user?: { id?: string; accessLevel?: string } };

export async function sopVisibilityWhere(
  session: SessionLike,
): Promise<Record<string, unknown>> {
  if (isOrgAdmin(session)) return {};

  const userId = session.user?.id;
  if (!userId) return { id: "__no_session__" };

  const [grants, canEditUnfiled] = await Promise.all([
    prisma.sOPFolderAccess.findMany({
      where: { userId },
      select: { folderId: true, role: true },
    }),
    // An unfiled SOP is writable by every holder of the `sops`/`edit`
    // capability (canWriteToFolder(null) is true for them), which makes them
    // its Can edit viewers; they see its drafts as they would in a folder
    // they can edit. Everyone else reads unfiled SOPs once published.
    hasPermission(session, "sops", "edit"),
  ]);
  // Folders the user can VIEW (any role) vs EDIT (EDITOR/OWNER). Within a
  // folder, viewers see only PUBLISHED SOPs; editors/owners and the author
  // also see drafts.
  const viewFolderIds = await expandAccessibleFolderIds(grants.map((g) => g.folderId));
  const editFolderIds = await expandAccessibleFolderIds(
    grants.filter((g) => g.role === "EDITOR" || g.role === "OWNER").map((g) => g.folderId),
  );

  return {
    OR: [
      // Unfiled SOPs are the EVERYONE VIEW grant once published (spec-process
      // section 1: "unfoldered published SOPs"); archived ones stay readable
      // in the Archived view because they were readable when published.
      // Other people's unfiled DRAFTS are not everyone's to read.
      { folderId: null, status: { in: ["PUBLISHED", "ARCHIVED"] } },
      ...(canEditUnfiled ? [{ folderId: null }] : []),
      // In folders the user can VIEW: published SOPs only.
      ...(viewFolderIds.length > 0 ? [{ status: "PUBLISHED", folderId: { in: viewFolderIds } }] : []),
      // The user's own authored SOPs, any status, wherever they live.
      { createdById: userId },
      // In folders the user can EDIT (Editor/Owner): drafts included.
      ...(editFolderIds.length > 0 ? [{ folderId: { in: editFolderIds } }] : []),
      // SOPs assigned to the user are theirs to read whatever the folder.
      { assignments: { some: { userId } } },
    ],
  };
}

export type FolderGrantRole = "VIEWER" | "EDITOR" | "OWNER";

/**
 * The strongest folder grant the user holds on `folderId` or any of its
 * ancestors (grants cascade down the tree, exactly as sopVisibilityWhere
 * expands them), or null when they hold none. This is the ONE answer both
 * the list and the SOP page read, so a SOP in a subfolder of a granted
 * folder never appears in the list and then 404s on open.
 */
export async function folderGrantRole(
  session: SessionLike,
  folderId: string,
): Promise<FolderGrantRole | null> {
  const userId = session.user?.id;
  if (!userId) return null;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId" FROM "SOPFolder" WHERE id = $1::text
      UNION
      SELECT f.id, f."parentId" FROM "SOPFolder" f
        JOIN chain c ON f.id = c."parentId"
    )
    SELECT id FROM chain
  `, folderId);
  if (rows.length === 0) return null;
  const grants = await prisma.sOPFolderAccess.findMany({
    where: { userId, folderId: { in: rows.map((r) => r.id) } },
    select: { role: true },
  });
  if (grants.some((g) => g.role === "OWNER")) return "OWNER";
  if (grants.some((g) => g.role === "EDITOR")) return "EDITOR";
  if (grants.length > 0) return "VIEWER";
  return null;
}

/**
 * Can the session user write into `folderId`? Admins always can,
 * `null` (unfoldered) is open to everyone, and otherwise we resolve
 * the folder's ancestor chain — a grant on any ancestor is enough.
 */
export async function canWriteToFolder(
  session: SessionLike,
  folderId: string | null,
): Promise<boolean> {
  if (!folderId) return true;
  if (isOrgAdmin(session)) return true;

  const userId = session.user?.id;
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

  // Only EDITOR / OWNER folder roles confer write. VIEWER is read-only.
  const grant = await prisma.sOPFolderAccess.findFirst({
    where: { userId, folderId: { in: rows.map((r) => r.id) }, role: { in: ["EDITOR", "OWNER"] } },
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

export type SopViewerRole = "FULL" | "EDIT" | "COMMENT" | "VIEW";

/**
 * The role the SOP page renders from (spec-process section 1, the access
 * table): Full access for org admins and the author; Can edit for a holder
 * of the `sops`/`edit` capability who can write to the SOP's folder (an
 * unfoldered SOP is writable by every editor today); Can comment for an
 * assignee (they may acknowledge); Can view otherwise. This is the one
 * transcription the page and the share dialog read; the API routes keep
 * enforcing with the same helpers.
 */
export async function resolveSopViewerRole(
  session: { user?: { id?: string; accessLevel?: string } },
  sop: { createdById: string | null; folderId: string | null },
  isAssignee: boolean,
): Promise<SopViewerRole> {
  const userId = session.user?.id;
  if (isOrgAdmin(session)) return "FULL";
  if (userId && sop.createdById === userId) return "FULL";
  if (await hasPermission(session, "sops", "edit")) {
    if (await canWriteToFolder(session, sop.folderId)) return "EDIT";
  }
  return isAssignee ? "COMMENT" : "VIEW";
}
