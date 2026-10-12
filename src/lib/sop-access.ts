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

// organizationId: hasPermission reads the workspace's own permission matrix
// by it; a session without one falls back to the built-in defaults.
type SessionLike = { user?: { id?: string; accessLevel?: string; organizationId?: string } };

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
  // folder, viewers see PUBLISHED and ARCHIVED SOPs (an archived SOP stays
  // readable because it was readable when published, as an unfiled one does,
  // and GET /api/sops/[id] opens it for them); editors/owners and the author
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
      // In folders the user can VIEW: published SOPs, and archived ones,
      // exactly what the SOP page opens for a Can view grant. Before, the
      // page opened an archived SOP that the list, search, a task's links
      // and the connection trail all hid.
      ...(viewFolderIds.length > 0 ? [{ status: { in: ["PUBLISHED", "ARCHIVED"] }, folderId: { in: viewFolderIds } }] : []),
      // The user's own authored SOPs, any status, wherever they live.
      { createdById: userId },
      // In folders the user can EDIT (Editor/Owner): drafts included.
      ...(editFolderIds.length > 0 ? [{ folderId: { in: editFolderIds } }] : []),
      // SOPs assigned to the user are theirs to read whatever the folder.
      { assignments: { some: { userId } } },
    ],
  };
}

/** One question for sopsEachCanRead: may this reader open this SOP? `accessLevel` is the level they hold in the workspace asked about. */
export interface SopReadAsk {
  reader: { id: string; accessLevel: string };
  sopId: string;
}

/** The statuses everyone who reads a folder (or every unfiled SOP) reads. */
const READ_ONCE_PUBLISHED = new Set(["PUBLISHED", "ARCHIVED"]);

/**
 * Each SOP folder asked for, with itself and every folder above it: a grant
 * on any of them reaches it, the same cascade expandAccessibleFolderIds
 * walks down. One round trip for every folder. A folder that no longer
 * exists reaches nothing, as it is in no expanded set.
 */
async function foldersAbove(folderIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (folderIds.length === 0) return out;
  const rows = await prisma.$queryRawUnsafe<{ startId: string; id: string }[]>(`
    WITH RECURSIVE above AS (
      SELECT id AS "startId", id, "parentId" FROM "SOPFolder" WHERE id = ANY($1::text[])
      UNION
      SELECT a."startId", f.id, f."parentId" FROM "SOPFolder" f
        JOIN above a ON f.id = a."parentId"
    )
    SELECT "startId", id FROM above
  `, folderIds);
  for (const r of rows) {
    const set = out.get(r.startId) ?? new Set<string>();
    set.add(r.id);
    out.set(r.startId, set);
  }
  return out;
}

/**
 * sopVisibilityWhere for many readers at once, each asked about their own
 * SOPs: for each reader, the ids of the SOPs asked for them that the SOP
 * list and the SOP page open for them, by the very same rules (an Admin
 * reads every SOP here; anyone else a published or archived unfiled one,
 * any unfiled one with the `sops`/`edit` capability, a published or
 * archived one in a folder they or a folder above it grants them, any in a
 * folder they edit, their own, and one assigned to them). The reads are the
 * same few whatever the number of readers: the SOPs, the folders above
 * theirs, the readers' grants on those folders and their assignments to
 * those SOPs; the capability is asked only for a reader whose answer rests
 * on it (an unfiled draft). A SOP in another workspace, or gone, is none.
 * Docs-found fixes batch 6: the overdue SOP digest named a SOP to a
 * person's manager by title with no read check at all.
 */
export async function sopsEachCanRead(organizationId: string, asks: Iterable<SopReadAsk>): Promise<Map<string, Set<string>>> {
  const byReader = new Map<string, { accessLevel: string; sops: Set<string> }>();
  for (const a of asks) {
    if (!a.sopId || !a.reader?.id) continue;
    const e = byReader.get(a.reader.id) ?? { accessLevel: a.reader.accessLevel, sops: new Set<string>() };
    e.sops.add(a.sopId);
    byReader.set(a.reader.id, e);
  }
  const out = new Map<string, Set<string>>([...byReader.keys()].map((id) => [id, new Set<string>()]));
  if (byReader.size === 0) return out;
  const sessionOf = (id: string, accessLevel: string): SessionLike => ({ user: { id, accessLevel, organizationId } });
  const sopIds = [...new Set([...byReader.values()].flatMap((e) => [...e.sops]))];
  const sops = new Map(
    (await prisma.sOP.findMany({ where: { id: { in: sopIds }, organizationId }, select: { id: true, folderId: true, status: true, createdById: true } })).map((s) => [s.id, s]),
  );
  const others = [...byReader].filter(([id, e]) => !isOrgAdmin(sessionOf(id, e.accessLevel))).map(([id]) => id);
  const folderIds = [...new Set([...sops.values()].map((s) => s.folderId).filter((f): f is string => !!f))];
  const above = others.length > 0 ? await foldersAbove(folderIds) : new Map<string, Set<string>>();
  const reachable = [...new Set([...above.values()].flatMap((s) => [...s]))];
  const [grants, assigned] = await Promise.all([
    others.length > 0 && reachable.length > 0
      ? prisma.sOPFolderAccess.findMany({ where: { userId: { in: others }, folderId: { in: reachable } }, select: { userId: true, folderId: true, role: true } })
      : Promise.resolve([] as Array<{ userId: string; folderId: string; role: string }>),
    others.length > 0 && sops.size > 0
      ? prisma.sOPAssignment.findMany({ where: { sopId: { in: [...sops.keys()] }, userId: { in: others } }, select: { sopId: true, userId: true } })
      : Promise.resolve([] as Array<{ sopId: string; userId: string }>),
  ]);
  const roles = new Map<string, Set<string>>();
  for (const g of grants) {
    const key = `${g.userId}|${g.folderId}`;
    roles.set(key, (roles.get(key) ?? new Set<string>()).add(g.role));
  }
  const assignedTo = new Set(assigned.map((a) => `${a.userId}|${a.sopId}`));

  for (const [readerId, e] of byReader) {
    const mine = out.get(readerId) as Set<string>;
    const session = sessionOf(readerId, e.accessLevel);
    if (isOrgAdmin(session)) {
      for (const id of e.sops) if (sops.has(id)) mine.add(id);
      continue;
    }
    let editsUnfiled: boolean | null = null;
    for (const id of e.sops) {
      const s = sops.get(id);
      if (!s) continue;
      const published = READ_ONCE_PUBLISHED.has(String(s.status));
      if (s.createdById === readerId || assignedTo.has(`${readerId}|${id}`)) {
        mine.add(id);
      } else if (!s.folderId) {
        if (published || (editsUnfiled ??= await hasPermission(session, "sops", "edit"))) mine.add(id);
      } else {
        let views = false;
        let edits = false;
        for (const f of above.get(s.folderId) ?? []) {
          const held = roles.get(`${readerId}|${f}`);
          if (!held) continue;
          views = true;
          if (held.has("EDITOR") || held.has("OWNER")) edits = true;
        }
        if (edits || (views && published)) mine.add(id);
      }
    }
  }
  return out;
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
