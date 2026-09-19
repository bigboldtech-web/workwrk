// POST /api/template-center/[id]/apply: materialize a template.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/templates).
//
// Body: { spaceId?, folderId?, boardId?, name?, visibility?, includeSamples? }
//
// Every kind returns the ids src/lib/templates/kinds.ts needs to navigate:
//   TASK       -> { kind, config }                  the create-task modal fills itself
//   LIST       -> { kind, boardId, slug }           -> /boards/<slug>
//   SPACE      -> { kind, spaceId, slug }           -> /spaces/<slug>
//   FOLDER     -> { kind, folderId, spaceId }       -> /folders/<id>
//   DOC        -> { kind, docId }                   -> /docs/<id>
//   WHITEBOARD -> { kind, whiteboardId }            -> /canvas/<id>
//   VIEW       -> { kind, viewId, boardId, boardSlug } -> /boards/<slug>?view=<id>
//
// WHAT CHANGED. Four of the seven kinds used to end here with a 400 reading
// "Applying {kind} templates is not supported yet" (audit High #6): the browse
// grid offered a Folder, Doc, View or Canvas template and the apply refused it.
// The client also decided navigation for LIST and SPACE and dropped every other
// result, so the one shell handler that existed reacted to TASK alone. Both
// halves are fixed: this route materializes all seven, and the caller reads the
// ids off one shape.
//
// GATES. A template is applied INTO a container, so the check is on the target,
// never on the template: `canEditSpace` for a Space-anchored kind, and
// `canEditBoard` for a View, which lands on a List. A kind that needs a
// container and was not given one is a 400 that names the missing field, so the
// modal can ask for it rather than failing silently.
//
// TWO GATES THAT WERE MISSING, AND BOTH WERE HOLES.
//
// 1. THE APP KEY. The page carries `templates` (spec-spaces-lists section 0
//    and section 2: every Member, Guests never) and the routes carried only a
//    signed-in check, so a Guest could apply a template through the API the
//    page never shows them. Page and API answer to the same key now.
// 2. A SPACE TEMPLATE CREATES A SPACE. Every other kind is applied into a
//    container and gated on that container, but SPACE has no container: its
//    branch called applySpaceTemplate with no check at all, so an EMPLOYEE who
//    gets 403 from POST /api/spaces ("Manager-level access required to create
//    Spaces.") got 201 through a Space template. The same manager floor POST
//    /api/spaces uses applies here, because the outcome is identical: a new
//    Space in the workspace.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { templatesAppGate } from "@/lib/templates/gate";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { SPACE_CREATE_LEVELS } from "@/lib/template-center";
import { getSpaceForReader, canEditSpace } from "@/lib/space";
import { canEditBoard, getBoardForReader } from "@/lib/board";
import {
  applyDocTemplate,
  applyFolderTemplate,
  applyListTemplate,
  applySpaceTemplate,
  applyViewTemplate,
  applyWhiteboardTemplate,
  type DocTemplatePayload,
  type FolderTemplatePayload,
  type ListTemplatePayload,
  type SpaceTemplatePayload,
  type ViewTemplatePayload,
  type WhiteboardTemplatePayload,
} from "@/lib/template-center";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const appDenied = await templatesAppGate();
  if (appDenied) return appDenied;
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string })?.accessLevel ?? "EMPLOYEE";

  const tpl = await prisma.template.findFirst({
    where: { id, OR: [{ organizationId: orgId }, { builtIn: true }] },
  });
  if (!tpl) return jsonError("Not found", 404);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const payload = (tpl.payload ?? {}) as Record<string, unknown>;
  const str = (key: string): string | null => (typeof body[key] === "string" && body[key] ? (body[key] as string) : null);
  const name = str("name")?.trim() || tpl.name;
  const spaceId = str("spaceId");
  const folderId = str("folderId");
  const boardId = str("boardId");

  /** Readable AND editable, or the caller hears about the target, not the template. */
  async function gateSpace(targetSpaceId: string): Promise<Response | null> {
    const space = await getSpaceForReader(targetSpaceId, userId, accessLevel);
    if (!space || space.organizationId !== orgId) return jsonError("Not found", 404);
    if (!(await canEditSpace(targetSpaceId, userId, accessLevel))) return jsonError("Forbidden", 403);
    return null;
  }

  try {
    if (tpl.kind === "TASK") {
      await bumpUsed(id);
      return jsonSuccess({ kind: "TASK", config: payload });
    }

    if (tpl.kind === "LIST") {
      if (!spaceId) return jsonError("spaceId is required for a list template", 400);
      const denied = await gateSpace(spaceId);
      if (denied) return denied;
      // "Include sample tasks" is off by default: a template's seed rows are an
      // example, and a person who wanted an empty list should get an empty list.
      const raw = payload as ListTemplatePayload;
      const includeSamples = body.includeSamples === true;
      const res = await applyListTemplate(
        includeSamples ? raw : { ...raw, items: [] },
        { organizationId: orgId, userId, spaceId, folderId, name },
      );
      await bumpUsed(id);
      return jsonSuccess({ kind: "LIST", ...res, slug: res.slug }, 201);
    }

    if (tpl.kind === "SPACE") {
      // The one kind with no container to gate on. Applying it IS creating a
      // Space, so it takes the same floor POST /api/spaces takes, and the
      // sentence is the same one, because it is the same rule.
      if (!SPACE_CREATE_LEVELS.has(accessLevel)) {
        return jsonError("Manager-level access required to create Spaces.", 403);
      }
      const vis = body.visibility;
      const res = await applySpaceTemplate(payload as SpaceTemplatePayload, {
        organizationId: orgId,
        userId,
        name,
        visibility: vis === "PRIVATE" || vis === "WORKSPACE" || vis === "ORG" ? vis : undefined,
      });
      await bumpUsed(id);
      return jsonSuccess({ kind: "SPACE", ...res }, 201);
    }

    if (tpl.kind === "FOLDER") {
      if (!spaceId) return jsonError("spaceId is required for a folder template", 400);
      const denied = await gateSpace(spaceId);
      if (denied) return denied;
      const res = await applyFolderTemplate(payload as FolderTemplatePayload, {
        organizationId: orgId,
        userId,
        spaceId,
        parentFolderId: folderId,
        name,
      });
      await bumpUsed(id);
      return jsonSuccess({ kind: "FOLDER", ...res }, 201);
    }

    if (tpl.kind === "DOC") {
      if (!spaceId) return jsonError("spaceId is required for a doc template", 400);
      const denied = await gateSpace(spaceId);
      if (denied) return denied;
      const res = await applyDocTemplate(payload as DocTemplatePayload, {
        organizationId: orgId,
        userId,
        spaceId,
        name,
      });
      await bumpUsed(id);
      return jsonSuccess({ kind: "DOC", ...res }, 201);
    }

    if (tpl.kind === "WHITEBOARD") {
      if (!spaceId) return jsonError("spaceId is required for a canvas template", 400);
      const denied = await gateSpace(spaceId);
      if (denied) return denied;
      const res = await applyWhiteboardTemplate(payload as WhiteboardTemplatePayload, {
        organizationId: orgId,
        userId,
        spaceId,
        folderId,
        name,
      });
      await bumpUsed(id);
      return jsonSuccess({ kind: "WHITEBOARD", ...res }, 201);
    }

    if (tpl.kind === "VIEW") {
      if (!boardId) return jsonError("boardId is required for a view template", 400);
      const board = await getBoardForReader(boardId, userId, accessLevel);
      if (!board || board.organizationId !== orgId) return jsonError("Not found", 404);
      if (!(await canEditBoard(boardId, userId, accessLevel))) return jsonError("Forbidden", 403);
      // The reader row carries ids, not the slug the URL needs.
      const slugRow = await prisma.board.findUnique({ where: { id: boardId }, select: { slug: true } });
      const res = await applyViewTemplate(payload as ViewTemplatePayload, { userId, boardId, name });
      await bumpUsed(id);
      return jsonSuccess({ kind: "VIEW", ...res, boardSlug: slugRow?.slug ?? null }, 201);
    }

    // Unreachable while TemplateKind has seven members; kept so a new enum
    // value fails loudly here rather than returning a success with no ids.
    return jsonError(`Unknown template kind ${tpl.kind}`, 400);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Failed to apply template", 400);
  }
}

function bumpUsed(id: string) {
  return prisma.template.update({ where: { id }, data: { usedCount: { increment: 1 } } }).catch(() => {});
}
