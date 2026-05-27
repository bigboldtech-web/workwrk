// GET  /api/files?folderId=…   list files (in a folder, or root if omitted)
// POST /api/files               create a FileEntry after upload returns a URL
//
// Upload itself stays in /api/upload (multipart). This route only owns
// the DB record + folder placement. Star/rename/move/delete via [id].

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const folderIdRaw = sp.get("folderId");
  const folderId = folderIdRaw === "root" || folderIdRaw === null ? null : folderIdRaw;
  const starred = sp.get("starred") === "true";
  const search = sp.get("q")?.trim().toLowerCase() ?? "";

  const where: Record<string, unknown> = { organizationId: orgId };
  if (search) where.name = { contains: search, mode: "insensitive" };
  else if (starred) where.starred = true;
  else where.folderId = folderId;

  const files = await prisma.fileEntry.findMany({
    where,
    orderBy: [{ starred: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });

  return jsonSuccess(files);
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
  const folderId = typeof body.folderId === "string" && body.folderId ? body.folderId : null;
  const description = typeof body.description === "string" ? body.description.slice(0, 500) : null;

  if (!name || !url) return jsonError("name + url required");

  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, organizationId: orgId }, select: { id: true } });
    if (!folder) return jsonError("folder not found", 404);
  }

  const entry = await prisma.fileEntry.create({
    data: { organizationId: orgId, name, mimeType, size, url, folderId, uploadedById: userId, description },
  });

  return jsonSuccess(entry, 201);
}
