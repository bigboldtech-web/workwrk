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
// The rule, from the one resolver (src/lib/access/node-access.ts), for a
// whole batch in one world:
//
//   * a file with no `spaceId` is unscoped and readable by the whole org;
//   * a file in a Space folder is readable by whoever holds Can view on that
//     Folder (its own grant, a parent's, its Space's, unless it is PRIVATE);
//   * a file tagged to a Space is readable by whoever holds Can view on that
//     Space. Under the legacy Private rule a Space reader also keeps the files
//     of a PRIVATE folder they cannot open, which is today's reach (A8); the
//     strict rule applies the Private cut to them.
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { NodeEvaluator, roleAtLeast, type NodeCtx, type NodeRef } from "@/lib/access/node-rules";
import { loadWorld } from "@/lib/access/node-world";

type FileRow = { id: string; spaceId: string | null; spaceFolderId: string | null };

async function readableSubset(
  files: FileRow[],
  viewer: { organizationId: string; userId: string; accessLevel?: string | null },
): Promise<FileRow[]> {
  return readableSubsetFor(files, nodeCtxFromLevel(viewer.userId, viewer.organizationId, viewer.accessLevel ?? "EMPLOYEE"));
}

/** The rule over one world for a resolved viewer (a NodeCtx), for callers that hold one. */
async function readableSubsetFor(files: FileRow[], ctx: NodeCtx): Promise<FileRow[]> {
  const refs: NodeRef[] = [];
  for (const f of files) {
    if (f.spaceId) refs.push({ kind: "space", id: f.spaceId });
    if (f.spaceFolderId) refs.push({ kind: "folder", id: f.spaceFolderId });
  }
  if (refs.length === 0) return files;
  const { rows, grants } = await loadWorld(ctx, refs);
  const ev = new NodeEvaluator(rows, grants);
  const reads = (ref: NodeRef) => roleAtLeast(ev.effective(ref).role, "VIEW");
  const legacy = rows.privateRule !== "strict";
  return files.filter((f) => {
    if (!f.spaceId) return true;
    const space = reads({ kind: "space", id: f.spaceId });
    if (!f.spaceFolderId) return space;
    return reads({ kind: "folder", id: f.spaceFolderId }) || (legacy && space);
  });
}

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
  const { organizationId } = args.viewer;
  const ids = [...new Set(args.ids)].filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return [];
  try {
    const files = await prisma.fileEntry.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, spaceId: true, spaceFolderId: true },
    });
    return (await readableSubset(files, args.viewer)).map((f) => f.id);
  } catch {
    return [];
  }
}

/** The same rule over rows the caller already loaded (the /files list). */
export async function readableFileRows<T extends FileRow>(
  files: T[],
  viewer: { organizationId: string; userId: string; accessLevel?: string | null },
): Promise<T[]> {
  const ok = new Set((await readableSubset(files, viewer)).map((f) => f.id));
  return files.filter((f) => ok.has(f.id));
}

/**
 * The same rule for ONE file row, for the per-file routes (GET /api/files/[id],
 * /[id]/url, PATCH, DELETE), so a row the /files list shows never answers 404
 * on Preview or Download.
 */
export async function canReadFile(
  file: { spaceId: string | null; spaceFolderId: string | null; organizationId?: string },
  userId: string,
  accessLevel: string | null | undefined,
  organizationId?: string,
): Promise<boolean> {
  if (!file.spaceId) return true;
  const orgId =
    organizationId ??
    file.organizationId ??
    (await prisma.space.findUnique({ where: { id: file.spaceId }, select: { organizationId: true } }))?.organizationId;
  if (!orgId) return false;
  const [ok] = await readableSubset([{ id: "file", spaceId: file.spaceId, spaceFolderId: file.spaceFolderId }], { organizationId: orgId, userId, accessLevel });
  return !!ok;
}

/**
 * The same rule for ONE file, for a viewer the caller already resolved (a
 * NodeCtx from the session), so a route asks it without reading the session's
 * access level itself: the file Move dialog's places (GET
 * /api/move/destinations?kind=file) answer only for a file the person can read.
 */
export async function canReadFileAs(ctx: NodeCtx, file: { spaceId: string | null; spaceFolderId: string | null }): Promise<boolean> {
  if (ctx.denied) return false;
  if (!file.spaceId) return true;
  const [ok] = await readableSubsetFor([{ id: "file", spaceId: file.spaceId, spaceFolderId: file.spaceFolderId }], ctx);
  return !!ok;
}
