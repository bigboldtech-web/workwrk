// GET    /api/forms/[id]/responses/[responseId]   one response, in the list's row shape
//        { data: row, people, canDelete }, for a copied ?response= link whose row is not on
//        the page the Responses tab loaded. Same reach as the list (an editor's right).
// DELETE /api/forms/[id]/responses/[responseId]   delete one response
//
// The Responses tab's row "..." and the response drawer's "Delete response"
// (spec-tables-forms section 2 /forms/[id]). Full access: the form's creator
// or an Owner or Admin, never an Agent (lib/forms/responses-server). The
// response is written to the audit log in full before it goes, so an answer
// deleted by mistake can still be read back by an admin. The task or table
// row it created is NOT touched: that belongs to the destination now.

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { FORM_SELECT } from "@/lib/forms/form-select";
import { optionalResponderViewer } from "@/lib/forms/session-viewer";
import { answersForDisplay, canDeleteResponses, canReadResponses, peopleForResponses, wentLinks } from "@/lib/forms/responses-server";
import { readFormFields } from "@/lib/forms/fields";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; responseId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id, responseId } = await params;

  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId }, select: FORM_SELECT });
  if (!form) return jsonError("not found", 404);
  const reader = await optionalResponderViewer();
  if (!(await canReadResponses(form, reader))) return jsonError("not found", 404);
  const row = await prisma.formSubmission.findFirst({ where: { id: responseId, formId: id, organizationId: orgId } });
  if (!row) return jsonError("not found", 404);
  const fields = readFormFields(form.fields);
  const [people, went, data] = await Promise.all([
    peopleForResponses(orgId, [row], fields.filter((f) => f.type === "people").map((f) => f.id)),
    wentLinks(orgId, [row]),
    answersForDisplay(form.fields, row.data, orgId),
  ]);
  return jsonSuccess({
    data: { id: row.id, data, submittedAt: row.submittedAt, submittedById: row.submittedById, went: went[row.id] ?? [] },
    people,
    canDelete: canDeleteResponses(form, reader),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; responseId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id, responseId } = await params;

  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId }, select: FORM_SELECT });
  if (!form) return jsonError("not found", 404);
  const reader = await optionalResponderViewer();
  if (!(await canReadResponses(form, reader))) return jsonError("not found", 404);
  const row = await prisma.formSubmission.findFirst({ where: { id: responseId, formId: id, organizationId: orgId } });
  if (!row) return jsonError("not found", 404);
  if (!canDeleteResponses(form, reader)) return jsonError("Only the person who made this form, or an admin, can delete its responses.", 403);

  await prisma.formSubmission.delete({ where: { id: row.id } });
  void logAuditEvent({
    type: "form.response.deleted",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Deleted a response to form "${form.name}"`,
    targetId: id,
    targetType: "FormDefinition",
    oldValue: { id: row.id, submittedAt: row.submittedAt.toISOString(), submittedById: row.submittedById, data: row.data as Prisma.InputJsonValue },
  });
  return jsonSuccess({ deleted: true });
}
