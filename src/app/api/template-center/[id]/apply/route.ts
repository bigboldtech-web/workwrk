// POST /api/template-center/[id]/apply — materialize a template.
//   TASK  → returns { kind:"TASK", config }  (the create-task modal fills itself)
//   LIST  → body { spaceId, folderId?, name? } → creates a Board → { kind:"LIST", boardId, slug }
//   SPACE → body { name?, visibility? } → creates a Space + child Lists → { kind:"SPACE", spaceId, slug }

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getSpaceForReader, canEditSpace } from "@/lib/space";
import { applyListTemplate, applySpaceTemplate, type ListTemplatePayload, type SpaceTemplatePayload } from "@/lib/template-center";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    if (tpl.kind === "TASK") {
      await bumpUsed(id);
      return jsonSuccess({ kind: "TASK", config: payload });
    }

    if (tpl.kind === "LIST") {
      const spaceId = typeof body.spaceId === "string" ? body.spaceId : null;
      if (!spaceId) return jsonError("spaceId is required for a list template", 400);
      // Gate: the target Space must be readable + editable by the caller.
      const space = await getSpaceForReader(spaceId, userId, accessLevel);
      if (!space) return jsonError("Space not found", 404);
      if (!(await canEditSpace(spaceId, userId, accessLevel))) return jsonError("Forbidden", 403);
      const res = await applyListTemplate(payload as ListTemplatePayload, {
        organizationId: orgId,
        userId,
        spaceId,
        folderId: typeof body.folderId === "string" ? body.folderId : null,
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : tpl.name,
      });
      await bumpUsed(id);
      return jsonSuccess({ kind: "LIST", ...res }, 201);
    }

    if (tpl.kind === "SPACE") {
      const vis = body.visibility;
      const res = await applySpaceTemplate(payload as SpaceTemplatePayload, {
        organizationId: orgId,
        userId,
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : tpl.name,
        visibility: vis === "PRIVATE" || vis === "WORKSPACE" || vis === "ORG" ? vis : undefined,
      });
      await bumpUsed(id);
      return jsonSuccess({ kind: "SPACE", ...res }, 201);
    }

    return jsonError(`Applying ${tpl.kind} templates is not supported yet`, 400);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Failed to apply template", 400);
  }
}

function bumpUsed(id: string) {
  return prisma.template.update({ where: { id }, data: { usedCount: { increment: 1 } } }).catch(() => {});
}
