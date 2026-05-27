// GET  /api/files/folders   list all folders in the org (tree-flat — UI nests)
// POST /api/files/folders   { name, parentId? }

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const folders = await prisma.fileFolder.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, parentId: true, createdAt: true, updatedAt: true,
      _count: { select: { files: true, children: true } },
    },
  });

  return jsonSuccess(folders);
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
