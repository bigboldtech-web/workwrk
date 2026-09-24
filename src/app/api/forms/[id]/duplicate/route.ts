// POST /api/forms/[id]/duplicate   -> 201 { id }
//
// The form row menu's Duplicate (spec-tables-forms section 2 /forms). The
// copy is a new form named "Copy of {name}", made by the caller, with the
// source's description, fields, destination and field mapping, and NO
// responses (answers belong to the form they were given to). Its public link
// is OFF: publishing is a separate, confirmed act.
//
// Gate: any signed-in member of the org who can open the form, the same set
// that could read it yesterday (the access engine stays inert this phase). A
// Guest may copy only a form they made (the one form a Guest can open,
// components/access/forms-gate.tsx); any other id is the same 404.
//
// The copy's settings are the source's, except "Tell these people about each
// new response": nobody is subscribed to a form they did not ask about, so
// the copy starts with an empty notify list and the daily summary off.

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { copyName } from "@/lib/tables-forms-list";
import { viewerFromSession } from "@/lib/access/viewer";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const viewer = await viewerFromSession().catch(() => null);
  const guest = viewer?.orgRole === "GUEST";
  const source = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId, ...(guest ? { createdById: userId } : {}) } });
  if (!source) return jsonError("not found", 404);

  // The additive `settings` bucket rides along when the column exists; the
  // spread keeps this route working for the one release it may be absent.
  const raw = (source as unknown as { settings?: unknown }).settings;
  const settings = raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>), notifyUserIds: [], dailySummary: false }
    : raw;
  const copy = await prisma.formDefinition.create({
    data: {
      organizationId: orgId,
      name: copyName(source.name, "Untitled form"),
      description: source.description,
      fields: source.fields as Prisma.InputJsonValue,
      isPublic: false,
      targetBoardId: source.targetBoardId,
      targetTableId: source.targetTableId,
      fieldMappings: source.fieldMappings as Prisma.InputJsonValue,
      createdById: userId,
      ...(settings && typeof settings === "object" ? { settings: settings as Prisma.InputJsonValue } : {}),
    } as Prisma.FormDefinitionUncheckedCreateInput,
  });

  return jsonSuccess({ id: copy.id }, 201);
}
