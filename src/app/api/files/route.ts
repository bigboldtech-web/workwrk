// GET  /api/files?folderId=…   list files (in a folder, or root if omitted)
// POST /api/files               create a FileEntry after upload returns a URL
//
// Upload itself stays in /api/upload (multipart). This route only owns
// the DB record + folder placement. Star/rename/move/delete via [id].

import { NextRequest } from "next/server";
import { withFreshFileUrls } from "@/lib/file-urls";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { canReadBoard } from "@/lib/board";
import { readableFileRows } from "@/lib/file-access";
import { canCreateAt, nodeCtxFromLevel } from "@/lib/access/node-access";
import { checkCreate } from "@/lib/access/node-placement";
import { getEffectivePreferences } from "@/lib/preferences";
import { matchesFilesFilters, matchesFilesView, parseFilesListQuery, sortFiles, type FileCandidate } from "@/lib/files-list";
import { sliceByCursor } from "@/lib/list-query";

/**
 * The read gate over a set of files, one world for the whole batch
 * (src/lib/file-access.ts, the one resolver): a file with no Space is
 * org-wide; a file in a Space folder shows to whoever can view that Folder;
 * a file tagged to a Space shows to whoever can view that Space.
 */
async function gateFiles<T extends { id: string; spaceId: string | null; spaceFolderId: string | null }>(
  files: T[],
  viewer: { organizationId: string; userId: string; accessLevel: string },
): Promise<T[]> {
  return readableFileRows(files, viewer);
}

/**
 * GET /api/files?view=all|starred|recent|spaces&folderId=&q=&type=&uploadedBy=
 *   &from=&to=&sort=name|uploaded|size|type&dir=&cursor=&limit=40
 *   -> { data: FileRow[], total, totalBytes, nextCursor }
 *
 * The /files list page (spec-docs-knowledge section 2). Filters COMPOSE
 * (search inside a folder, starred of one type), the gate runs before the
 * page slice so the total is real, and the 500-row cap is gone. The legacy
 * array shape survives for the callers that pass none of the list params
 * (Space file cards, attachments).
 */
async function pagedList(req: NextRequest, session: { user: unknown }, orgId: string) {
  const q = parseFilesListQuery(new URL(req.url).searchParams);
  const userId = getUserId(session as Parameters<typeof getUserId>[0]);
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";

  const [rows, prefs] = await Promise.all([
    prisma.fileEntry.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, mimeType: true, size: true, folderId: true, spaceId: true, spaceFolderId: true, uploadedById: true, starred: true, createdAt: true, updatedAt: true },
    }),
    getEffectivePreferences(userId, orgId),
  ]);
  const gated = await gateFiles(rows, { organizationId: orgId, userId, accessLevel });
  const home = prefs.home as { favoriteFileIds?: string[] };
  const facts = { favoriteIds: new Set<string>(Array.isArray(home.favoriteFileIds) ? home.favoriteFileIds : []) };

  const filtered: FileCandidate[] = gated.filter((f) => matchesFilesView(f, q, facts) && matchesFilesFilters(f, q));
  const sorted = sortFiles(filtered, q.sort, q.dir);
  const totalBytes = sorted.reduce((acc, f) => acc + (f.size || 0), 0);
  const { page, nextCursor } = sliceByCursor(sorted, q.cursor, q.limit);

  const pageIds = page.map((f) => f.id);
  const full = pageIds.length ? await prisma.fileEntry.findMany({ where: { id: { in: pageIds } } }) : [];
  const byId = new Map(full.map((f) => [f.id, f]));
  const ordered = pageIds.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f);

  const uploaderIds = [...new Set(ordered.map((f) => f.uploadedById))];
  const sfIds = [...new Set(ordered.map((f) => f.spaceFolderId).filter((x): x is string => !!x))];
  const spIds = [...new Set(ordered.map((f) => f.spaceId).filter((x): x is string => !!x))];
  const folderIds = [...new Set(ordered.map((f) => f.folderId).filter((x): x is string => !!x))];
  const [users, sfs, sps, folders, fresh] = await Promise.all([
    uploaderIds.length ? prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, firstName: true, lastName: true, avatar: true } }) : Promise.resolve([]),
    sfIds.length ? prisma.folder.findMany({ where: { id: { in: sfIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    spIds.length ? prisma.space.findMany({ where: { id: { in: spIds } }, select: { id: true, name: true, slug: true, icon: true, color: true } }) : Promise.resolve([]),
    folderIds.length ? prisma.fileFolder.findMany({ where: { id: { in: folderIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    withFreshFileUrls(ordered),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const sfById = new Map(sfs.map((f) => [f.id, f]));
  const spById = new Map(sps.map((x) => [x.id, x]));
  const folderById = new Map(folders.map((f) => [f.id, f]));

  const data = fresh.map((f) => {
    const u = userById.get(f.uploadedById);
    const sp = f.spaceId ? spById.get(f.spaceId) : undefined;
    const sf = f.spaceFolderId ? sfById.get(f.spaceFolderId) : undefined;
    const fo = f.folderId ? folderById.get(f.folderId) : undefined;
    return {
      ...f,
      favorite: facts.favoriteIds.has(f.id),
      uploadedBy: u ? { id: u.id, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null, avatar: u.avatar, firstName: u.firstName, lastName: u.lastName } : null,
      folder: fo ? { id: fo.id, name: fo.name } : null,
      spaceFolder: sf ? { id: sf.id, name: sf.name } : null,
      space: sp ? { id: sp.id, name: sp.name, slug: sp.slug, icon: sp.icon, color: sp.color } : null,
    };
  });
  return jsonSuccess({ data, total: sorted.length, totalBytes, nextCursor });
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;

  if (parseFilesListQuery(sp).paged && !sp.get("boardId")) return pagedList(req, session, orgId);

  // ?boardId= — files attached to this board's items via EntityLink
  // (BOARD_ITEM → FILE). Powers the board File-gallery view. Gated by
  // the board read resolver, so per-board visibility composes in.
  const boardId = sp.get("boardId");
  if (boardId) {
    const accessLevelB = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
    const canRead = await canReadBoard(boardId, getUserId(session), accessLevelB);
    if (!canRead) return jsonError("not found", 404);
    const items = await prisma.item.findMany({
      where: { boardId, archivedAt: null },
      select: { id: true },
    });
    const itemIds = items.map((i) => i.id);
    const links = itemIds.length
      ? await prisma.entityLink.findMany({
          where: {
            organizationId: orgId,
            targetType: "FILE",
            sourceType: "BOARD_ITEM",
            sourceId: { in: itemIds },
          },
          select: { targetId: true, sourceId: true },
        })
      : [];
    const fileIds = Array.from(new Set(links.map((l) => l.targetId)));
    const files = fileIds.length
      ? await prisma.fileEntry.findMany({
          where: { id: { in: fileIds }, organizationId: orgId },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    // Map each file back to one of its source items for "open task".
    const itemByFile = new Map<string, string>();
    for (const l of links) if (!itemByFile.has(l.targetId)) itemByFile.set(l.targetId, l.sourceId);
    const fresh = await withFreshFileUrls(files);
    return jsonSuccess(fresh.map((f) => ({ ...f, itemId: itemByFile.get(f.id) ?? null })));
  }

  const folderIdRaw = sp.get("folderId");
  const folderId = folderIdRaw === "root" || folderIdRaw === null ? null : folderIdRaw;
  const starred = sp.get("starred") === "true";
  const search = sp.get("q")?.trim().toLowerCase() ?? "";
  const spaceIdFilter = sp.get("spaceId"); // "" or null = all; specific id = scoped

  const spaceFolderIdFilter = sp.get("spaceFolderId");
  const spaceRoot = sp.get("spaceRoot") === "1"; // files at a Space's root (no folder)

  const where: Record<string, unknown> = { organizationId: orgId };
  if (search) where.name = { contains: search, mode: "insensitive" };
  else if (starred) where.starred = true;
  else if (spaceFolderIdFilter) where.spaceFolderId = spaceFolderIdFilter;
  else if (spaceRoot && spaceIdFilter) where.spaceFolderId = null;
  else where.folderId = folderId;
  if (spaceIdFilter) where.spaceId = spaceIdFilter;

  const files = await prisma.fileEntry.findMany({
    where,
    orderBy: [{ starred: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });

  // The read gate: files with spaceId=null stay visible to everyone in the
  // org (unscoped); a Space folder's files to whoever can view that Folder;
  // a Space's own files to whoever can view that Space. One world per page.
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const userId = getUserId(session);
  const gated = await gateFiles(files, { organizationId: orgId, userId, accessLevel });

  // Attach the Space-folder name so the Library drive can show where a
  // space-anchored file lives (chip linking back to the folder).
  const sfIds = [...new Set(gated.map((f) => f.spaceFolderId).filter((x): x is string => !!x))];
  const sfNames = sfIds.length
    ? new Map((await prisma.folder.findMany({ where: { id: { in: sfIds } }, select: { id: true, name: true } })).map((f) => [f.id, f.name]))
    : new Map<string, string>();
  // Space chip for space-root files (no folder): name + slug for the link.
  const spIds = [...new Set(gated.filter((f) => f.spaceId && !f.spaceFolderId).map((f) => f.spaceId as string))];
  const spInfo = spIds.length
    ? new Map((await prisma.space.findMany({ where: { id: { in: spIds } }, select: { id: true, name: true, slug: true } })).map((x) => [x.id, x]))
    : new Map<string, { id: string; name: string; slug: string }>();
  const freshGated = await withFreshFileUrls(gated);
  const enriched = freshGated.map((f) => ({
    ...f,
    spaceFolder: f.spaceFolderId && sfNames.has(f.spaceFolderId) ? { id: f.spaceFolderId, name: sfNames.get(f.spaceFolderId)! } : null,
    space: f.spaceId && !f.spaceFolderId && spInfo.has(f.spaceId) ? spInfo.get(f.spaceId)! : null,
  }));

  return jsonSuccess(enriched);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
  const size = Number(body.size) || 0;
  const url = typeof body.url === "string" ? body.url : "";
  // The client passes s3Key explicitly; as a belt-and-braces for any
  // caller that forgets, derive it from a presigned S3 URL's path
  // (fleet finding: seven upload flows each had to remember this).
  let s3Key = typeof body.s3Key === "string" && body.s3Key ? body.s3Key.slice(0, 512) : null;
  if (!s3Key && typeof body.url === "string" && body.url.includes("X-Amz-")) {
    try {
      const path = decodeURIComponent(new URL(body.url).pathname.replace(/^\//, ""));
      const bucket = process.env.S3_BUCKET || "";
      s3Key = (bucket && path.startsWith(bucket + "/") ? path.slice(bucket.length + 1) : path).slice(0, 512) || null;
    } catch { /* not a parsable URL — leave null */ }
  }
  const folderId = typeof body.folderId === "string" && body.folderId ? body.folderId : null;
  let spaceId = typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
  const spaceFolderId = typeof body.spaceFolderId === "string" && body.spaceFolderId ? body.spaceFolderId : null;
  const description = typeof body.description === "string" ? body.description.slice(0, 500) : null;

  if (!name || !url) return jsonError("name + url required");

  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, organizationId: orgId }, select: { id: true } });
    if (!folder) return jsonError("folder not found", 404);
  }

  // Cross-tenant safety: the spaceId must belong to the caller's org. The
  // viewer's reach into it is checked below, once the folder is known.
  if (spaceId) {
    const space = await prisma.space.findFirst({ where: { id: spaceId, organizationId: orgId }, select: { id: true } });
    if (!space) return jsonError("space not found", 404);
  }

  // Space-folder anchor: validate in-org and DERIVE spaceId from the folder,
  // so Library space filters + Space visibility gating apply automatically.
  if (spaceFolderId) {
    const sf = await prisma.folder.findFirst({
      where: { id: spaceFolderId, space: { organizationId: orgId } },
      select: { id: true, spaceId: true },
    });
    if (!sf) return jsonError("space folder not found", 404);
    spaceId = sf.spaceId ?? spaceId;
  }

  // The upload gate (the one resolver). A file placed in a Space folder is a
  // node of that Folder, so it takes the placement rule (node-rules P1): Can
  // edit or higher on the Folder; Can view never adds content. A file TAGGED
  // to a Space (a task attachment) needs Can view on the Space, or the Space
  // being on the viewer's way to something they were given (a List member
  // attaching a file to a task); an unscoped file is the org's. A container
  // the viewer cannot open is refused as not found.
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const nodeCtx = nodeCtxFromLevel(userId, orgId, accessLevel);
  if (spaceFolderId) {
    const gate = await checkCreate(nodeCtx, { kind: "folder", id: spaceFolderId }, "file");
    if (!gate.ok) return jsonError(gate.status === 404 ? "space folder not found" : gate.error, gate.status);
  } else if (spaceId && !(await canCreateAt(nodeCtx, { kind: "space", id: spaceId }, "file"))) {
    return jsonError("space not found", 404);
  }

  const entry = await prisma.fileEntry.create({
    data: { organizationId: orgId, name, mimeType, size, url,
      s3Key, folderId, spaceId, spaceFolderId, uploadedById: userId, description },
  });

  return jsonSuccess(entry, 201);
}
