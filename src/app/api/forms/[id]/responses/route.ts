// GET    /api/forms/[id]/responses?cursor=&limit=&dir=&q=   the form's responses, newest first (dir=asc: oldest),
//        q filters by answer text or the sender's name or email,
//        with `total`, the `people` they name and where each one `went`
// POST   /api/forms/[id]/responses                  send one response (the ONE submit path)
// DELETE /api/forms/[id]/responses { confirm }      delete every response (Full access,
//        typed confirmation: `confirm` must equal the form's name)
//
// Renamed from /submissions (naming canon: Response, never "Submission"; the
// Prisma model keeps its name and is never shown). The old path stays mounted
// for one release and answers IN PLACE through these handlers (a redirect
// would turn a POST into a GET behind the TLS proxy), so a caller in the wild
// keeps working; see ../submissions/route.ts.
//
// POST, in the order it checks:
//   1. Who is sending (lib/forms/responder-access). A member who clears the
//      responder rule (a live public link, or the respond check on the
//      anchor) sends as themselves. Anyone else may send only when the form
//      accepts responses from people without an account (founder decision
//      D16: the public link live AND the form's own switch on); the response
//      then carries no person. Otherwise a signed-out caller gets 401
//      { error: "sign_in_required" } for every id (the responder sends them
//      through /login with their answers kept), and a signed-in one 404, or
//      403 when the form is public but not theirs to write into.
//      The old route wrote an anonymous response whenever isPublic was set;
//      the switch is that capability, now opt-in per form.
//   2. The form's own settings: closed (switch off or close date passed) is a
//      409 carrying the closed message; one-response-per-person likewise (a
//      sender without an account cannot be told apart, so it applies to
//      members only).
//   3. Required fields, with the same rule the responder validates inline.
//      A sender without an account never answers People or File upload
//      questions (the directory and the org's file store need a session), so
//      those answers are dropped from their body before the check.
//
// When the form has a destination, every response also lands there: a task on
// the List (createBoardItem) and/or a row on the Table. A failed push never
// loses the response: it is written first and the push is best-effort.
//
// Idempotency: the responder retries a Submit on a network error or a 5xx, so
// every Submit carries `submissionKey` (32 hex characters, one per Submit of
// one set of answers) and the response is stored under it as its id. A retry
// whose first attempt already landed finds that response and answers 201 with
// it, without a second response, task or row. A body without a key (an older
// client) is written as before.

import { formatDate } from "@/lib/format/date";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { createBoardItem } from "@/lib/board-items";
import { parseBoardSchema } from "@/lib/field-catalog";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity, logAuditEvent } from "@/lib/activity";
import { resolveResponder } from "@/lib/forms/responder-access";
import { FORM_SELECT } from "@/lib/forms/form-select";
import { isBlankValues, reservedKeysOf } from "@/lib/sheet-blank-tail";
import { lastFilledPosition } from "@/lib/table-counts";
import { optionalResponderViewer } from "@/lib/forms/session-viewer";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import {
  SUBMISSION_KEY_RE, WENT_KEY, answerText, isQuestion, keepOrgFiles, missingRequired, pickKnownAnswers, readFormFields,
  type FormField, type WentTo,
} from "@/lib/forms/fields";
import { isFormClosed, readFormSettings } from "@/lib/forms/settings";
import { notifyNewResponse } from "@/lib/forms/notify";
import { dailySummaryInstalled, notifyEachResponse } from "@/lib/forms/daily-summary";
import {
  answersForDisplay, canDeleteResponses, canReadResponses, peopleForResponses, responsesWhere, wentLinks,
} from "@/lib/forms/responses-server";

type FieldMappings = { board?: Record<string, string>; table?: Record<string, string> };


const DEFAULT_LIMIT = 50;
/** Responses without an account, per form and address. */
const ANON_PER_IP = { max: 30, windowMs: 10 * 60 * 1000 };
const MAX_LIMIT = 500;

// GET, interim reach until the access engine flips (requireCan is the access
// unit's step 1): reading responses is an editor's right, so a Guest never
// reads them (unless they made the form), and anyone else must be the
// creator, an Owner or Admin, or reach the form's anchor (the List or Table it
// feeds), the same check the responder uses. Everything else is a 404, like a
// form that does not exist.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId }, select: FORM_SELECT });
  if (!form) return jsonError("not found", 404);
  const reader = await optionalResponderViewer();
  if (!(await canReadResponses(form, reader))) return jsonError("not found", 404);

  const sp = new URL(req.url).searchParams;
  const cursor = sp.get("cursor");
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MAX_LIMIT, Math.floor(limitRaw)) : DEFAULT_LIMIT;

  // Keyset on (submittedAt desc, id desc) through Prisma's cursor: the row
  // with this id is skipped and the page continues after it.
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  // The toolbar's Filter: answers or the sender's name or email.
  const where = await responsesWhere(orgId, id, sp.get("q"));
  const rows = await prisma.formSubmission.findMany({
    where,
    orderBy: [{ submittedAt: dir }, { id: dir }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? page[page.length - 1]?.id ?? null : null;
  const fields = readFormFields(form.fields);
  const [total, people, went, answers] = await Promise.all([
    prisma.formSubmission.count({ where }),
    peopleForResponses(orgId, page, fields.filter((f) => f.type === "people").map((f) => f.id)),
    wentLinks(orgId, page),
    Promise.all(page.map((r) => answersForDisplay(form.fields, r.data, orgId))),
  ]);
  return jsonSuccess({
    data: page.map((r, i) => ({
      id: r.id,
      data: answers[i],
      submittedAt: r.submittedAt,
      submittedById: r.submittedById,
      went: went[r.id] ?? [],
    })),
    nextCursor,
    total,
    people,
    canDelete: canDeleteResponses(form, reader),
  });
}

/** Delete every response. Full access (the form's creator or an admin, never
 *  an Agent) and a typed confirmation: the body's `confirm` is the form's
 *  name, exactly as the builder's dialog asks for it. The count and who did
 *  it go to the audit log. The tasks and table rows the responses already
 *  created are NOT touched: they are the destination's rows now. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId }, select: FORM_SELECT });
  if (!form) return jsonError("not found", 404);
  const reader = await optionalResponderViewer();
  if (!(await canReadResponses(form, reader))) return jsonError("not found", 404);
  if (!canDeleteResponses(form, reader)) return jsonError("Only the person who made this form, or an admin, can delete its responses.", 403);
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  const typed = typeof body?.confirm === "string" ? body.confirm.trim() : "";
  if (typed !== (form.name || "Untitled form").trim()) return jsonError("Type the form's name to delete every response.", 400);

  const res = await prisma.formSubmission.deleteMany({ where: { formId: id, organizationId: orgId } });
  void logAuditEvent({
    type: "form.responses.deleted",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Deleted all ${res.count} responses to form "${form.name}"`,
    targetId: id,
    targetType: "FormDefinition",
    oldValue: { count: res.count },
  });
  return jsonSuccess({ deleted: res.count });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError("invalid body", 400); }
  const rawAnswers = (body as { data?: unknown } | null)?.data;

  const viewer = await optionalResponderViewer();

  const rawKey = (body as { submissionKey?: unknown } | null)?.submissionKey;
  if (rawKey !== undefined && (typeof rawKey !== "string" || !SUBMISSION_KEY_RE.test(rawKey))) {
    return jsonError("invalid submissionKey", 400);
  }
  const submissionKey = typeof rawKey === "string" ? rawKey : null;

  const decision = await resolveResponder(id, viewer);
  // Signed out and not open to people without an account: the same 401 for
  // every id, so a stranger learns nothing about which forms exist.
  if (!viewer && !decision?.anonymousSubmit) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  if (!decision) return jsonError("not found", 404);
  if (!decision.canSubmit && !decision.anonymousSubmit) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const { form } = decision;
  // The person the response is credited to: a member, or nobody.
  const senderId = decision.canSubmit && viewer ? viewer.userId : null;
  // A caller without an account is told only that the response landed, never
  // the stored row (a replayed key must not read answers back to a stranger).
  const created = (row: { id: string; submittedAt: Date }) =>
    jsonSuccess(senderId ? row : { id: row.id, submittedAt: row.submittedAt }, 201);

  if (!senderId) {
    // An open write with no account behind it: a per-address ceiling far
    // above a person filling a form, low enough that a script cannot flood
    // the destination List or Table.
    const limited = rateLimit(`form-anon:${form.id}:${ipFromRequest(req)}`, ANON_PER_IP);
    if (!limited.ok) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
    }
  }

  // A replay of a Submit that already landed: answer with the first response,
  // before the closed and one-per-person checks, which that response itself
  // would now trip.
  if (submissionKey) {
    const prior = await findPriorResponse(submissionKey, form.id, senderId);
    if (prior === "foreign") return jsonError("invalid submissionKey", 400);
    if (prior) return created(prior);
  }

  const settings = readFormSettings(form.settings);
  if (isFormClosed(settings)) {
    return NextResponse.json({ error: "closed", message: settings.closedMessage }, { status: 409 });
  }
  if (settings.oneResponsePerPerson && senderId) {
    const already = await prisma.formSubmission.findFirst({ where: { formId: form.id, submittedById: senderId }, select: { id: true } });
    if (already) return NextResponse.json({ error: "already_answered", message: "You have already answered this form." }, { status: 409 });
  }

  const fields = readFormFields(form.fields);
  // Answers coerced to their types, then every file entry that is not this
  // org's own upload dropped (a client-named key from another tenant, or an
  // outside link, would otherwise be presigned on every Responses read).
  const data = keepOrgFiles(fields, pickKnownAnswers(fields, rawAnswers), form.organizationId);
  if (!senderId) {
    for (const f of fields) if (f.type === "people" || f.type === "file") delete data[f.id];
  }
  const missing = missingRequired(fields, data);
  if (missing.length > 0) return NextResponse.json({ error: "missing_required", fieldIds: missing }, { status: 400 });

  let sub;
  try {
    sub = await prisma.formSubmission.create({
      data: {
        ...(submissionKey ? { id: submissionKey } : {}),
        organizationId: form.organizationId,
        formId: form.id,
        data: data as Prisma.InputJsonValue,
        submittedById: senderId,
      },
    });
  } catch (err) {
    // Two attempts of the same Submit raced: the other one wrote it.
    if (submissionKey && (err as { code?: string })?.code === "P2002") {
      const prior = await findPriorResponse(submissionKey, form.id, senderId);
      if (prior && prior !== "foreign") return created(prior);
      return jsonError("invalid submissionKey", 400);
    }
    throw err;
  }

  const mappings = (typeof form.fieldMappings === "object" && form.fieldMappings !== null
    ? form.fieldMappings
    : {}) as FieldMappings;

  // Where the response went ("Went to" on the Responses tab), recorded on
  // the response under the reserved "$went" key so the row links to the task
  // or the table row, or says why it was not sent.
  const went: WentTo = {};
  if (form.targetBoardId) {
    try {
      const itemId = await pushToBoard(form.targetBoardId, form.organizationId, fields, data, mappings.board);
      went.list = itemId ? { boardId: form.targetBoardId, itemId } : { boardId: form.targetBoardId, error: "The List is gone" };
    } catch (err) {
      console.error(`form-response: failed to push to board ${form.targetBoardId}`, err);
      went.list = { boardId: form.targetBoardId, error: "The task could not be created" };
    }
  }
  if (form.targetTableId) {
    try {
      // A row needs a creator: the sender, or for a response without an
      // account the form's creator (as the old route credited it).
      const rowId = await pushToTable(form.targetTableId, form.organizationId, fields, data, mappings.table, senderId ?? form.createdById);
      went.table = rowId ? { tableId: form.targetTableId, rowId } : { tableId: form.targetTableId, error: "The table is gone" };
    } catch (err) {
      console.error(`form-response: failed to push to table ${form.targetTableId}`, err);
      went.table = { tableId: form.targetTableId, error: "The row could not be added" };
    }
  }
  if (went.list || went.table) {
    try {
      sub = await prisma.formSubmission.update({
        where: { id: sub.id },
        data: { data: { ...data, [WENT_KEY]: went } as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      // The response itself is safe; only the link back is missing.
      console.error("form-response: could not record where the response went", err);
    }
  }

  // "Tell these people about each new response", unless they asked for the
  // daily summary instead AND its cron is installed (the form-daily-summary
  // cron sends that). Until the row exists, the summary switch is not
  // rendered and a form set to it keeps notifying per response, never quiet.
  if (notifyEachResponse(settings, dailySummaryInstalled())) {
    // No sender id: the notification names "Someone" and nobody is skipped.
    void notifyNewResponse(form, fields, data, settings.notifyUserIds, senderId ?? "").catch((err) => {
      console.error("form-response: notification failed", err);
    });
  }

  void logActivity({
    type: "form.submission",
    // Credit the sender, else the form's creator, so a response without an
    // account still appears in the feed (the old route's rule).
    actorId: senderId ?? form.createdById,
    organizationId: form.organizationId,
    description: senderId ? `Answered form "${form.name}"` : `Form "${form.name}" received a response from someone without an account`,
    targetId: form.id,
    targetType: "FormDefinition",
    metadata: { submissionId: sub.id, anonymous: !senderId },
  });

  return created(sub);
}

/** The response a submission key already names: the row when it is this
 *  person's response to this form, "foreign" when the key is taken by anything
 *  else (never echoed back), null when it is free. */
async function findPriorResponse(key: string, formId: string, userId: string | null) {
  const prior = await prisma.formSubmission.findUnique({ where: { id: key } });
  if (!prior) return null;
  if (prior.formId !== formId || prior.submittedById !== userId) return "foreign" as const;
  return prior;
}

async function pushToTable(
  tableId: string, organizationId: string, formFields: FormField[], data: Record<string, unknown>,
  explicit: Record<string, string> | undefined, createdById: string,
) {
  type TableColumn = { id: string; label: string; type: string };
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, organizationId },
    select: { id: true, columns: true },
  });
  if (!table) return null;

  const tableColumns = Array.isArray(table.columns) ? (table.columns as TableColumn[]) : [];
  const byLabel = new Map<string, string>();
  for (const c of tableColumns) {
    if (c?.label && c?.id) byLabel.set(c.label.trim().toLowerCase(), c.id);
  }

  const values: Record<string, unknown> = {};
  const colType = new Map(tableColumns.filter((c) => c?.id).map((c) => [c.id, c.type]));
  for (const ff of formFields) {
    if (!isQuestion(ff)) continue;
    const answer = data[ff.id];
    if (answer === undefined || answer === null || answer === "") continue;
    const colId = explicit?.[ff.id] || byLabel.get(ff.label.trim().toLowerCase());
    if (!colId || !colType.has(colId)) continue;
    values[colId] = tableCellValue(ff, answer, colType.get(colId) ?? "short_text");
  }

  // Where the row lands: on the first blank row after the last row that
  // holds data, like a CSV import (lib/sheet-blank-tail). A table is born
  // with 1,000 blank rows, and appending at max(position) + 1 put every
  // response at row 1,001 under a screen of empty ones. Each reuse is a
  // compare and set on the row's values as read, so a co-editor who typed
  // into that "blank" row a moment ago keeps what they typed and the
  // response tries the next blank row. A reused row keeps its reserved keys
  // (cell styles, row height). When no blank row is left, it appends.
  // A response with no mapped answer writes nothing a reused row could hold,
  // so it appends as before (its "Went to" link keeps naming its own row).
  const hasValues = Object.keys(values).length > 0;
  const lastFilled = hasValues ? await lastFilledPosition(table.id) : null;
  const candidates = !hasValues ? [] : await prisma.dataTableRow.findMany({
    where: { tableId: table.id, deletedAt: null, ...(lastFilled === null ? {} : { position: { gt: lastFilled } }) },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 5,
    select: { id: true, values: true },
  });
  for (const c of candidates) {
    // A JSON null body cannot be compared here; skip it rather than guess.
    if (c.values === null || !isBlankValues(c.values)) continue;
    const res = await prisma.dataTableRow.updateMany({
      where: { id: c.id, tableId: table.id, deletedAt: null, values: { equals: c.values as Prisma.InputJsonValue } },
      data: { values: { ...reservedKeysOf(c.values), ...values } as unknown as Prisma.InputJsonValue },
    });
    if (res.count === 1) {
      await prisma.dataTable.update({ where: { id: table.id }, data: { updatedAt: new Date() } }).catch(() => undefined);
      return c.id;
    }
  }

  const max = await prisma.dataTableRow.findFirst({
    where: { tableId: table.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const row = await prisma.dataTableRow.create({
    data: {
      organizationId,
      tableId: table.id,
      values: values as unknown as Prisma.InputJsonValue,
      position: (max?.position ?? 0) + 1,
      createdById,
    },
    select: { id: true },
  });
  await prisma.dataTable.update({ where: { id: table.id }, data: { updatedAt: new Date() } }).catch(() => undefined);
  return row.id;
}

/** An answer as a table cell stores it: a file answer becomes the cell's
 *  attachment list, a people answer the person ids, and anything a text
 *  column cannot hold becomes its one-line text. */
function tableCellValue(field: FormField, answer: unknown, colType: string): unknown {
  if (field.type === "file" && Array.isArray(answer)) {
    if (colType === "attachment") return answer.map((f) => ({ name: (f as { name?: string }).name, url: (f as { url?: string }).url }));
    return answerText(field, answer);
  }
  if (field.type === "people" && Array.isArray(answer)) return colType === "person" ? answer : answerText(field, answer);
  return answer;
}

// A response onto a canonical Board as an Item. Maps answers to
// Board.schema.fields keys by explicit mapping, else by label.
async function pushToBoard(boardId: string, organizationId: string, formFields: FormField[], data: Record<string, unknown>, explicit?: Record<string, string>) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId },
    select: { id: true, schema: true },
  });
  if (!board) return null;

  const boardFields = parseBoardSchema(board.schema).fields;
  const fieldByKey = new Map(boardFields.map((bf) => [bf.key, bf]));
  const byLabel = new Map<string, string>();
  for (const bf of boardFields) {
    if (bf?.label && bf?.key) byLabel.set(bf.label.trim().toLowerCase(), bf.key);
  }

  const metadata: Record<string, unknown> = {};
  let title = "";
  for (const ff of formFields) {
    if (!isQuestion(ff)) continue;
    const answer = data[ff.id];
    if (answer === undefined || answer === null || answer === "") continue;
    if (!title && (ff.type === "short_text" || ff.type === "email")) {
      title = String(answer).slice(0, 200);
    }
    const key = explicit?.[ff.id] || byLabel.get(ff.label.trim().toLowerCase());
    const bf = key ? fieldByKey.get(key) : undefined;
    if (key && bf) {
      const v = boardFieldValue(ff, answer, bf);
      if (v !== undefined) metadata[key] = v;
    }
  }
  if (!title) {
    title = `Form response · ${formatDate(new Date(), null, "datetime")}`;
  }

  const item = await createBoardItem({ organizationId, boardId: board.id, title, metadata });
  return (item as { id?: string } | null)?.id ?? null;
}

/** An answer as a List field stores it. Choice fields store the choice's
 *  VALUE, not its label, so a "High" answer is written as the "high" choice
 *  (an answer matching no choice is dropped rather than written as a value
 *  the column cannot show). Everything else is written as given. */
function boardFieldValue(field: FormField, answer: unknown, bf: { type: string; options?: { choices?: Array<{ value: string; label: string }> } }): unknown {
  const choices = bf.options?.choices;
  const toChoice = (label: string) => {
    const l = label.trim().toLowerCase();
    return choices?.find((c) => c.label.trim().toLowerCase() === l || c.value.toLowerCase() === l)?.value;
  };
  if ((bf.type === "DROPDOWN" || bf.type === "TSHIRT_SIZE" || bf.type === "CUSTOM_DROPDOWN") && choices) {
    const first = Array.isArray(answer) ? answer[0] : answer;
    return typeof first === "string" ? toChoice(first) : undefined;
  }
  if ((bf.type === "MULTI_SELECT" || bf.type === "LABELS") && choices) {
    const list = Array.isArray(answer) ? answer : [answer];
    const vals = list.filter((x): x is string => typeof x === "string").map(toChoice).filter((x): x is string => !!x);
    return vals.length ? vals : undefined;
  }
  if (field.type === "file" && Array.isArray(answer)) {
    return bf.type === "FILES" ? answer.map((f) => ({ name: (f as { name?: string }).name, url: (f as { url?: string }).url })) : answerText(field, answer);
  }
  if (field.type === "people" && Array.isArray(answer)) {
    if (bf.type === "USER") return answer[0];
    if (bf.type === "PEOPLE") return answer;
    return undefined;
  }
  return answer;
}
