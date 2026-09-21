// GET  /api/files/folders   list all folders in the org (tree-flat — UI nests)
// POST /api/files/folders   { name, parentId? }

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { viewerFromSessionObject } from "@/lib/access/viewer";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const folders = await prisma.fileFolder.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, parentId: true, createdAt: true, updatedAt: true, createdById: true,
      _count: { select: { files: true, children: true } },
    },
  });

  // `canManage` is what the folder row menu gates Move to Trash on (Full
  // access = creator or org admin until the drive has grant rows), so the
  // menu never offers a row the DELETE below would 403.
  const orgRole = viewerFromSessionObject(session)?.orgRole;
  const admin = orgRole === "OWNER" || orgRole === "ADMIN";
  const userId = getUserId(session);
  return jsonSuccess(folders.map((f) => ({ ...f, canManage: admin || f.createdById === userId })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
  if (!name) return jsonError("name required");

  if (parentId) {
    const parent = await prisma.fileFolder.findFirst({ where: { id: parentId, organizationId: orgId }, select: { id: true } });
    if (!parent) return jsonError("parent not found", 404);
  }

  const folder = await prisma.fileFolder.create({
    data: { organizationId: orgId, name, parentId, createdById: userId },
    select: {
      id: true, name: true, parentId: true, createdAt: true, updatedAt: true,
      _count: { select: { files: true, children: true } },
    },
  });

  return jsonSuccess(folder, 201);
}
