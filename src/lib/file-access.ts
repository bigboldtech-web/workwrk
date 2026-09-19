// Who may READ a stored file, in one place.
//
// The rule already lived inside GET /api/files and nowhere else, so every other
// surface that touched a FileEntry by id had to either repeat it or skip it.
// The comment-attachment path skipped it: `POST /api/items/[id]/updates`
// validated `attachmentIds` for ORG membership only, then wrote them as
// attachments whose name, type, size and URL every viewer of the task reads
// back. A caller holding a file id from a Space they are not on could attach it
// and read it out, or republish a restricted Space's file into a task with a
// wider audience.
//
// The rule, transcribed from /api/files and unchanged:
//
//   * a file with no `spaceId` is unscoped and readable by the whole org;
//   * a file tagged to a Space is readable when the viewer reads that Space;
//   * or when the viewer holds a grant on the SPACE FOLDER the file sits in
//     (their own folder's files, and only those).
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { visibleSpaceIds } from "@/lib/space";
import { accessibleFolderIds } from "@/lib/folder";

/**
 * Narrow a set of FileEntry ids to the ones this viewer may read.
 *
 * Order is not preserved and unknown ids are dropped, so the result is always a
 * subset of what was asked for. Never throws: a failure answers with an empty
 * list, which refuses the attachment rather than leaking it.
 */
export async function readableFileIds(args: {
  ids: string[];
  /**
   * The caller's request context, passed WHOLE (`itemCtx()`'s return value, or
   * any object with the same three fields). It is passed rather than destructured
   * at the call site so the legacy `accessLevel` read stays in this one module
   * instead of spreading back out to every route that attaches a file.
   */
  viewer: { organizationId: string; userId: string; accessLevel?: string | null };
}): Promise<string[]> {
  const { organizationId, userId } = args.viewer;
  const ids = [...new Set(args.ids)].filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return [];
  try {
    const files = await prisma.fileEntry.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, spaceId: true, spaceFolderId: true },
    });
    const scoped = files.map((f) => f.spaceId).filter((s): s is string => Boolean(s));
    const [visible, folders] = scoped.length
      ? await Promise.all([
          visibleSpaceIds(scoped, userId, args.viewer.accessLevel ?? "EMPLOYEE"),
          accessibleFolderIds(userId),
        ])
      : [new Set<string>(), new Set<string>()];
    return files
      .filter(
        (f) =>
          !f.spaceId ||
          visible.has(f.spaceId) ||
          (!!f.spaceFolderId && folders.has(f.spaceFolderId)),
      )
      .map((f) => f.id);
  } catch {
    return [];
  }
}
