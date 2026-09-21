// POST /api/template-center/save-as: snapshot a List, Folder, Space, Doc or Canvas as a Template.
//   body { source: "LIST",       boardId,      name?, description?, complexity?, category?, useCases?, tags? }
//   body { source: "FOLDER",     folderId,     name?, ... }
//   body { source: "SPACE",      spaceId,      name?, ... }
//   body { source: "DOC",        docId,        name?, ... }   (spec-docs-knowledge section 2, "Save as template")
//   body { source: "WHITEBOARD", whiteboardId, name?, ... }
//
// DOC and WHITEBOARD need Full access on the source (the creator or an org
// admin; the canvas owner or an admin): a template is published to everyone
// in the org, so the bar is the management gate, as it is for Lists.
//
// FOLDER is here because the Folder "…" menu has always posted it: the schema
// accepted LIST and SPACE only, so that menu row 400d on every click with the
// raw string "Invalid body" shown to the user as a toast.
// Read-gates the source via the same resolvers the apply route uses, then
// stores a Template(kind=LIST|SPACE) the org can re-apply.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canEditBoard, getBoardForReader } from "@/lib/board";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { folderReadable } from "@/lib/folder";
import { snapshotBoard, snapshotFolder, snapshotSpace } from "@/lib/template-center";
import { templatesAppGate } from "@/lib/templates/gate";
import { docAccessible } from "@/lib/doc-access";
import { isDocFull } from "@/lib/doc-sharing";

const COMPLEXITY = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

const schema = z.object({
  source: z.enum(["LIST", "FOLDER", "SPACE", "DOC", "WHITEBOARD"]),
  boardId: z.string().optional(),
  folderId: z.string().optional(),
  spaceId: z.string().optional(),
  docId: z.string().optional(),
  whiteboardId: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  complexity: z.enum(COMPLEXITY).optional(),
  category: z.string().max(120).optional(),
  useCases: z.array(z.string()).max(20).optional(),
  tags: z.array(z.string()).max(30).optional(),
});

export async function POST(req: NextRequest) {
  const denied = await templatesAppGate();
  if (denied) return denied;
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string })?.accessLevel ?? "EMPLOYEE";

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);
  const input = parsed.data;

  let kind: "LIST" | "FOLDER" | "SPACE" | "DOC" | "WHITEBOARD";
  let snap: { name: string; payload: object } | null;

  if (input.source === "DOC") {
    if (!input.docId) return jsonError("docId is required", 400);
    const doc = await prisma.doc.findFirst({
      where: { id: input.docId, organizationId: orgId, archivedAt: null },
      select: { id: true, title: true, content: true, entityType: true, entityId: true, createdById: true },
    });
    if (!doc || !(await docAccessible(doc, userId, accessLevel))) return jsonError("Doc not found", 404);
    if (!isDocFull({ userId, accessLevel }, { createdById: doc.createdById })) return jsonError("Forbidden", 403);
    kind = "DOC";
    snap = { name: doc.title, payload: { title: doc.title, content: doc.content ?? {} } };
  } else if (input.source === "WHITEBOARD") {
    if (!input.whiteboardId) return jsonError("whiteboardId is required", 400);
    const wb = await prisma.whiteboard.findFirst({
      where: { id: input.whiteboardId, organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, description: true, scene: true, ownerId: true, spaceId: true },
    });
    if (!wb) return jsonError("Canvas not found", 404);
    if (wb.spaceId && !(await getSpaceForReader(wb.spaceId, userId, accessLevel))) return jsonError("Canvas not found", 404);
    const isAdmin = ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(accessLevel);
    if (wb.ownerId !== userId && !isAdmin) return jsonError("Forbidden", 403);
    kind = "WHITEBOARD";
    snap = { name: wb.name, payload: { scene: wb.scene ?? {}, description: wb.description ?? undefined } };
  } else if (input.source === "LIST") {
    if (!input.boardId) return jsonError("boardId is required", 400);
    const board = await getBoardForReader(input.boardId, userId, accessLevel);
    if (!board) return jsonError("List not found", 404);
    // Saving a template publishes a list's structure to everyone in the org,
    // so it takes the management gate, not the read gate (spec-spaces-lists
    // section 2: "Save as template needs Full access on the source object").
    if (!(await canEditBoard(input.boardId, userId, accessLevel))) return jsonError("Forbidden", 403);
    kind = "LIST";
    snap = await snapshotBoard(input.boardId);
  } else if (input.source === "FOLDER") {
    if (!input.folderId) return jsonError("folderId is required", 400);
    // The same pair DELETE /api/folders/[id] uses: readable, then editable
    // through the owning Space, which is how every Folder "…" management row
    // is gated.
    const folder = await prisma.folder.findFirst({
      where: { id: input.folderId, space: { organizationId: orgId } },
      select: { spaceId: true },
    });
    if (!folder || !(await folderReadable(input.folderId, userId, accessLevel))) return jsonError("Folder not found", 404);
    if (!(await canEditSpace(folder.spaceId, userId, accessLevel))) return jsonError("Forbidden", 403);
    kind = "FOLDER";
    snap = await snapshotFolder(input.folderId);
  } else {
    if (!input.spaceId) return jsonError("spaceId is required", 400);
    const space = await getSpaceForReader(input.spaceId, userId, accessLevel);
    if (!space) return jsonError("Space not found", 404);
    if (!(await canEditSpace(input.spaceId, userId, accessLevel))) return jsonError("Forbidden", 403);
    kind = "SPACE";
    snap = await snapshotSpace(input.spaceId);
  }

  if (!snap) return jsonError("Source not found", 404);

  const row = await prisma.template.create({
    data: {
      organizationId: orgId,
      createdById: userId,
      kind,
      name: input.name?.trim() || snap.name,
      description: input.description ?? null,
      complexity: input.complexity ?? null,
      category: input.category ?? null,
      useCases: input.useCases ?? [],
      tags: input.tags ?? [],
      payload: snap.payload as object,
    },
    select: { id: true, name: true, kind: true },
  });
  return jsonSuccess({ template: row }, 201);
}
