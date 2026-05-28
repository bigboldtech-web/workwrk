// GET  /api/forms/[id]/submissions   list submissions for a form (org member only)
// POST /api/forms/[id]/submissions   submit; org members always; anonymous only when isPublic
//
// When the form has `targetBoardId` set, every submission also creates
// a StudioItem on that board. Form-field values are mapped to board
// columns by case-insensitive label match — board columns whose label
// matches a form field's label receive the answer keyed by the board
// column's `key`. Unmatched form fields are dropped (users can rename
// either side to wire them up).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import type { Prisma } from "@/generated/prisma";
import {
  getSessionOrFail, getOrgId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

type FormField = { id: string; type: string; label: string };
type BoardField = { key: string; label: string; type: string };
type FieldMappings = { board?: Record<string, string>; table?: Record<string, string> };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!form) return jsonError("not found", 404);

  const subs = await prisma.formSubmission.findMany({
    where: { formId: id, organizationId: orgId },
    orderBy: { submittedAt: "desc" },
    take: 500,
  });

  return jsonSuccess(subs);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data = typeof body.data === "object" && body.data !== null ? body.data : {};

  // Try to read session — if signed in, use orgId from session. If
  // the form is public, allow anonymous submission and read the form
  // first to discover its orgId.
  const session = await getServerSession(authOptions);
  const userId = session?.user ? (session.user as { id?: string }).id ?? null : null;

  const form = await prisma.formDefinition.findUnique({ where: { id } });
  if (!form) return jsonError("not found", 404);

  // Auth gate: signed-in users must belong to the form's org; if
  // unsigned-in, only allowed when isPublic.
  if (!userId) {
    if (!form.isPublic) return jsonError("not authorised", 401);
  } else {
    if (session && (session.user as { organizationId?: string }).organizationId !== form.organizationId) {
      return jsonError("not authorised", 403);
    }
  }

  const sub = await prisma.formSubmission.create({
    data: {
      organizationId: form.organizationId,
      formId: id,
      data,
      submittedById: userId,
    },
  });

  const mappings = (typeof form.fieldMappings === "object" && form.fieldMappings !== null
    ? form.fieldMappings
    : {}) as FieldMappings;

  if (form.targetBoardId) {
    try {
      await pushToBoard(form.targetBoardId, form, data, mappings.board);
    } catch (err) {
      console.error(`form-submission: failed to push to board ${form.targetBoardId}`, err);
    }
  }

  if (form.targetTableId) {
    try {
      await pushToTable(form.targetTableId, form, data, mappings.table);
    } catch (err) {
      console.error(`form-submission: failed to push to table ${form.targetTableId}`, err);
    }
  }

  // Activity log — credit the submitter when signed-in, otherwise the
  // form owner (so anonymous submissions still appear in the feed).
  void logActivity({
    type: "form.submission",
    actorId: userId ?? form.createdById,
    organizationId: form.organizationId,
    description: userId ? `Submitted form "${form.name}"` : `Form "${form.name}" received an anonymous submission`,
    targetId: form.id,
    targetType: "FormDefinition",
    metadata: { submissionId: sub.id, anonymous: !userId },
  });

  return jsonSuccess(sub, 201);
}

async function pushToTable(tableId: string, form: { fields: unknown; organizationId: string }, data: Record<string, unknown>, explicit?: Record<string, string>) {
  type TableColumn = { id: string; label: string; type: string };
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, organizationId: form.organizationId },
    select: { id: true, columns: true },
  });
  if (!table) return;

  const formFields = Array.isArray(form.fields) ? (form.fields as FormField[]) : [];
  const tableColumns = Array.isArray(table.columns) ? (table.columns as TableColumn[]) : [];

  const byLabel = new Map<string, string>();
  for (const c of tableColumns) {
    if (c?.label && c?.id) byLabel.set(c.label.trim().toLowerCase(), c.id);
  }

  const values: Record<string, unknown> = {};
  for (const ff of formFields) {
    const answer = data[ff.id];
    if (answer === undefined || answer === null || answer === "") continue;
    const colId = explicit?.[ff.id] ?? byLabel.get(ff.label.trim().toLowerCase());
    if (colId) values[colId] = answer;
  }

  const max = await prisma.dataTableRow.findFirst({
    where: { tableId: table.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.dataTableRow.create({
    data: {
      organizationId: form.organizationId,
      tableId: table.id,
      values: values as unknown as Prisma.InputJsonValue,
      position: (max?.position ?? 0) + 1,
    },
  });
}

async function pushToBoard(boardId: string, form: { fields: unknown; organizationId: string }, data: Record<string, unknown>, explicit?: Record<string, string>) {
  const board = await prisma.studioBoard.findFirst({
    where: { id: boardId, organizationId: form.organizationId },
    select: { id: true, fields: true },
  });
  if (!board) return;

  const formFields = Array.isArray(form.fields) ? (form.fields as FormField[]) : [];
  const boardFields = Array.isArray(board.fields) ? (board.fields as BoardField[]) : [];

  const byLabel = new Map<string, string>();
  for (const bf of boardFields) {
    if (bf?.label && bf?.key) byLabel.set(bf.label.trim().toLowerCase(), bf.key);
  }

  const values: Record<string, unknown> = {};
  let title = "";
  for (const ff of formFields) {
    const answer = data[ff.id];
    if (answer === undefined || answer === null || answer === "") continue;
    if (!title && (ff.type === "short_text" || ff.type === "email")) {
      title = String(answer).slice(0, 200);
    }
    // Explicit mapping wins over label match.
    const key = explicit?.[ff.id] ?? byLabel.get(ff.label.trim().toLowerCase());
    if (key) values[key] = answer;
  }
  if (!title) {
    title = `Form submission · ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  }

  const max = await prisma.studioItem.findFirst({
    where: { boardId: board.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.studioItem.create({
    data: {
      boardId: board.id,
      title,
      values: values as unknown as Prisma.InputJsonValue,
      position: (max?.position ?? 0) + 1,
    },
  });
}
