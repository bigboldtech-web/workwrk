// POST /api/template-center/save-as: snapshot a List, Folder, Space, Doc or Canvas as a Template.
//   body { source: "LIST",       boardId,      name?, description?, complexity?, category?, useCases?, tags? }
//   body { source: "FOLDER",     folderId,     name?, ... }
//   body { source: "SPACE",      spaceId,      name?, ... }
//   body { source: "DOC",        docId,        name?, ... }   (spec-docs-knowledge section 2, "Save as template")
//   body { source: "WHITEBOARD", whiteboardId, name?, ... }
//
// Every source needs Full access on itself, from the one resolver
// (src/lib/access/node-access.ts): a template is published to everyone in the
// org, so the bar is the management gate. On a doc or a canvas that is its
// creator or owner, a Full holder of its Space or Folder, or an org admin; on
// a Folder it is Full access on that Folder, never a role on its Space.
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
import { snapshotBoard, snapshotFolder, snapshotSpace } from "@/lib/template-center";
import { templatesAppGate } from "@/lib/templates/gate";
import { docAccess } from "@/lib/doc-access";
import { nodeCtxFromLevel, nodeRole, nodeRoles } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

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
  const nodeCtx = nodeCtxFromLevel(userId, orgId, accessLevel);
  // A Folder or Space template carries only the Lists the saver could save
  // one by one (Full access on each, the LIST branch's gate below): a Private
  // List they cannot open, or only read, never reaches the whole org.
  const fullLists = async (boardIds: string[]): Promise<ReadonlySet<string>> => {
    const roles = await nodeRoles(nodeCtx, boardIds.map((id) => ({ kind: "list" as const, id })));
    return new Set(boardIds.filter((id) => roleAtLeast(roles.get(`list:${id}`)?.role ?? "none", "FULL")));
  };

  let kind: "LIST" | "FOLDER" | "SPACE" | "DOC" | "WHITEBOARD";
  let snap: { name: string; payload: object } | null;

  if (input.source === "DOC") {
    if (!input.docId) return jsonError("docId is required", 400);
    const doc = await prisma.doc.findFirst({
      where: { id: input.docId, organizationId: orgId, archivedAt: null },
      select: { id: true, title: true, content: true, entityType: true, entityId: true, createdById: true },
    });
    const access = doc ? await docAccess(nodeCtx, doc.id) : null;
    if (!doc || !access) return jsonError("Doc not found", 404);
    if (!access.canManage) return jsonError("Forbidden", 403);
    kind = "DOC";
    snap = { name: doc.title, payload: { title: doc.title, content: doc.content ?? {} } };
  } else if (input.source === "WHITEBOARD") {
    if (!input.whiteboardId) return jsonError("whiteboardId is required", 400);
    const wb = await prisma.whiteboard.findFirst({
      where: { id: input.whiteboardId, organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, description: true, scene: true, ownerId: true, spaceId: true },
    });
    if (!wb) return jsonError("Canvas not found", 404);
    const canvas = await nodeRole(nodeCtx, { kind: "canvas", id: wb.id });
    if (!roleAtLeast(canvas.role, "VIEW")) return jsonError("Canvas not found", 404);
    if (!roleAtLeast(canvas.role, "FULL")) return jsonError("Forbidden", 403);
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
    // The same pair DELETE /api/folders/[id] uses: Can view on the Folder,
    // then Full access on the Folder itself (a Folder's Full holder manages
    // it without any role on its Space).
    const folder = await prisma.folder.findFirst({
      where: { id: input.folderId, space: { organizationId: orgId } },
      select: { spaceId: true },
    });
    const folderRole = folder ? await nodeRole(nodeCtx, { kind: "folder", id: input.folderId }) : null;
    if (!folder || !folderRole || !roleAtLeast(folderRole.role, "VIEW")) return jsonError("Folder not found", 404);
    if (!roleAtLeast(folderRole.role, "FULL")) return jsonError("Forbidden", 403);
    kind = "FOLDER";
    snap = await snapshotFolder(input.folderId, { canSaveList: fullLists });
  } else {
    if (!input.spaceId) return jsonError("spaceId is required", 400);
    const space = await getSpaceForReader(input.spaceId, userId, accessLevel);
    if (!space) return jsonError("Space not found", 404);
    if (!(await canEditSpace(input.spaceId, userId, accessLevel))) return jsonError("Forbidden", 403);
    kind = "SPACE";
    snap = await snapshotSpace(input.spaceId, { canSaveList: fullLists });
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
