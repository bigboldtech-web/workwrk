// The Responses tab's server half (spec-tables-forms section 2 /forms/[id],
// Responses tab): who may read, export and delete a form's responses, the
// people a page of responses names, where each response went, and fresh
// links for uploaded files. Shared by GET /api/forms/[id]/responses, the
// export, the two DELETE routes and the daily summary. Server only.
//
// The access engine stays inert this phase: reading responses is an editor's
// right, resolved with the same helpers the responder uses (creator, Owner or
// Admin, or reach on the form's anchor), and a Guest never reads responses to
// a form they did not make. Deleting responses is Full access: the form's
// creator or an Owner or Admin (lib/object-manage), never an Agent.

import { prisma } from "@/lib/prisma";
import { isS3Configured, presignGetUrlStable } from "@/lib/s3";
import { viewerCanRespondAsMember, type ResponderForm, type ResponderViewer } from "./responder-access";
import { canManageObject } from "@/lib/object-manage";
import { fileAnswerInOrg, readFileAnswer, readFormFields, readWentTo, WENT_KEY, type FormAnswers } from "./fields";

export async function canReadResponses(form: ResponderForm, reader: ResponderViewer | null): Promise<boolean> {
  if (!reader || reader.organizationId !== form.organizationId) return false;
  if (reader.orgRole === "GUEST" && form.createdById !== reader.userId) return false;
  return viewerCanRespondAsMember(form, reader);
}

export function canDeleteResponses(form: { createdById: string }, reader: ResponderViewer | null): boolean {
  if (!reader || reader.isAgent) return false;
  return canManageObject(reader, form.createdById);
}

/** The Responses tab's Filter (`?q=`): a response matches when any of its
 *  answers contains the text (case-insensitive, over the stored JSON) or
 *  when the person who sent it has a matching name or email. Returns the
 *  Prisma `where` for FormSubmission, scoped to the form and org; an empty
 *  query is every response. */
export async function responsesWhere(orgId: string, formId: string, q: string | null | undefined) {
  const base = { formId, organizationId: orgId };
  const text = (q ?? "").trim().slice(0, 200);
  if (!text) return base;
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [hits, people] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "FormSubmission" WHERE "formId" = ${formId} AND "organizationId" = ${orgId} AND data::text ILIKE ${pattern} LIMIT 50000`,
    prisma.user.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { firstName: { contains: text, mode: "insensitive" } },
          { lastName: { contains: text, mode: "insensitive" } },
          { email: { contains: text, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 500,
    }),
  ]);
  return {
    ...base,
    OR: [
      { id: { in: hits.map((h) => h.id) } },
      ...(people.length ? [{ submittedById: { in: people.map((p) => p.id) } }] : []),
    ],
  };
}

export interface ResponsePerson {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  firstName: string | null;
  lastName: string | null;
}

/** The people a page of responses names: every responder, plus every person
 *  a People answer picked. Only people in the form's org are resolved. */
export async function peopleForResponses(
  orgId: string,
  rows: Array<{ submittedById: string | null; data: unknown }>,
  peopleFieldIds: string[],
): Promise<Record<string, ResponsePerson>> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.submittedById) ids.add(r.submittedById);
    const d = (r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : {}) as Record<string, unknown>;
    for (const fid of peopleFieldIds) {
      const v = d[fid];
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x) ids.add(x);
    }
  }
  if (ids.size === 0) return {};
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] }, organizationId: orgId },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  });
  const out: Record<string, ResponsePerson> = {};
  for (const u of users) {
    out[u.id] = {
      id: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "Member",
      email: u.email ?? null,
      avatar: u.avatar ?? null,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
    };
  }
  return out;
}

export interface WentLink {
  kind: "list" | "table";
  /** The task or the table, when it landed. */
  href: string | null;
  label: string;
  /** Why it was not sent, when it was not. */
  error: string | null;
}

/** "Went to" for a page of responses: a link to the task or the table the
 *  response created, or the reason it was not sent. Boards and tables that
 *  no longer exist read as "Not sent" with that reason. */
export async function wentLinks(orgId: string, rows: Array<{ id: string; data: unknown }>): Promise<Record<string, WentLink[]>> {
  const wents = rows.map((r) => ({ id: r.id, w: readWentTo(r.data) }));
  const boardIds = [...new Set(wents.map((x) => x.w.list?.boardId).filter((x): x is string => !!x))];
  const tableIds = [...new Set(wents.map((x) => x.w.table?.tableId).filter((x): x is string => !!x))];
  const [boards, tables] = await Promise.all([
    boardIds.length ? prisma.board.findMany({ where: { id: { in: boardIds }, organizationId: orgId }, select: { id: true, name: true } }) : Promise.resolve([]),
    tableIds.length ? prisma.dataTable.findMany({ where: { id: { in: tableIds }, organizationId: orgId }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  const tableName = new Map(tables.map((t) => [t.id, t.name]));
  const out: Record<string, WentLink[]> = {};
  for (const { id, w } of wents) {
    const links: WentLink[] = [];
    if (w.list) {
      const name = boardName.get(w.list.boardId);
      if ("itemId" in w.list && name) links.push({ kind: "list", href: `/item/${w.list.itemId}`, label: name, error: null });
      else links.push({ kind: "list", href: null, label: name ?? "A List", error: "error" in w.list ? w.list.error : "The List is gone" });
    }
    if (w.table) {
      const name = tableName.get(w.table.tableId);
      if ("rowId" in w.table && name) links.push({ kind: "table", href: `/tables/${w.table.tableId}?row=${w.table.rowId}`, label: name, error: null });
      else links.push({ kind: "table", href: null, label: name ?? "A table", error: "error" in w.table ? w.table.error : "The table is gone" });
    }
    out[id] = links;
  }
  return out;
}

/** The answers alone (the reserved "$went" key stripped), with every file
 *  answer's link refreshed when it lives in the object store (a presigned
 *  URL written at submit time expires). */
export async function answersForDisplay(formFields: unknown, data: unknown, orgId: string): Promise<FormAnswers> {
  const src = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const out: FormAnswers = {};
  for (const [k, v] of Object.entries(src)) if (k !== WENT_KEY) out[k] = v;
  const s3 = isS3Configured();
  const fileFields = readFormFields(formFields).filter((f) => f.type === "file");
  for (const f of fileFields) {
    const v = out[f.id];
    if (!Array.isArray(v)) continue;
    out[f.id] = await Promise.all(v.map(async (x) => {
      const file = readFileAnswer(x);
      if (!file) return x;
      // Only this org's own uploads ever get a working link: a key or an
      // outside link that points anywhere else (written before the submit
      // route checked it) is shown by its name alone.
      if (!fileAnswerInOrg(file, orgId)) return { name: file.name, url: "", s3Key: null };
      if (!file.s3Key || !s3) return file;
      try { return { ...file, url: await presignGetUrlStable(file.s3Key) }; } catch { return file; }
    }));
  }
  return out;
}
