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
import { visibleSpaceIds } from "@/lib/space";
import { canReadBoard } from "@/lib/board";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;

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

  // Phase 22 — gate by Space visibility. Files with spaceId=null stay
  // visible to everyone in the org (unscoped). Files tagged to a Space
  // are returned only if the viewer can read that Space.
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const userId = getUserId(session);
  const scopedIds = files.map((f) => f.spaceId).filter((s): s is string => Boolean(s));
  const visible = scopedIds.length > 0
    ? await visibleSpaceIds(scopedIds, userId, accessLevel)
    : new Set<string>();
  const gated = files.filter((f) => !f.spaceId || visible.has(f.spaceId));

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
  const s3Key = typeof body.s3Key === "string" && body.s3Key ? body.s3Key.slice(0, 512) : null;
  const folderId = typeof body.folderId === "string" && body.folderId ? body.folderId : null;
  let spaceId = typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
  const spaceFolderId = typeof body.spaceFolderId === "string" && body.spaceFolderId ? body.spaceFolderId : null;
  const description = typeof body.description === "string" ? body.description.slice(0, 500) : null;

  if (!name || !url) return jsonError("name + url required");

  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, organizationId: orgId }, select: { id: true } });
    if (!folder) return jsonError("folder not found", 404);
  }

  // Cross-tenant safety: the spaceId must belong to the caller's org.
  // No membership check here — uploading from a board the caller can
  // see is already permission-gated by the surface that hosts the upload
  // (e.g. BoardItemDrawer enforces canEdit before exposing the form).
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

  const entry = await prisma.fileEntry.create({
    data: { organizationId: orgId, name, mimeType, size, url,
      s3Key, folderId, spaceId, spaceFolderId, uploadedById: userId, description },
  });

  return jsonSuccess(entry, 201);
}
