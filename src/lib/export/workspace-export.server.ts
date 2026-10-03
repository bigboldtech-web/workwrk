// The whole workspace as ZIP entries (GET /api/export/all), read a page at a
// time so a large workspace streams through src/lib/zip-stream.ts and never
// sits in memory whole.
//
// WHAT IT HOLDS (decided addition f, the enterprise target: a real copy of
// the workspace, not a people-and-HR slice):
//   the people and HR tables, as before
//   spaces, folders, lists, list-fields (each List's fields), goals, tables
//   list-tasks.csv     every task for a spreadsheet: description, checklist,
//                      tags, status name and its home List's field values
//   list-tasks.jsonl   every task EXACTLY as stored, one JSON object a line:
//                      the columns, its tags, the other Lists it is in, and
//                      its whole metadata (description, checklist, every
//                      List's field values)
//   list-links.csv     each task shown in another List, with that List's values
//   task-comments.csv  every live comment on a task, for a spreadsheet
//   task-comments.jsonl every live comment exactly as stored
//   docs/*.md          every live Doc as Markdown, sub-pages linked by file
//   tables/*.csv       every table's rows, the values the grid shows
//   sops/*.md          every SOP as Markdown
//   manifest.json      last: the counts, each file's size and rows, and
//                      every limit hit
//
// The CSVs are for spreadsheets, so a text cell that starts with = + - @, a
// tab or a return gets one leading apostrophe (csv.ts csvExportCell), the
// guard Excel needs; the JSON Lines files carry the same text unguarded, so
// nothing is lost.
//
// Never in it: personal notes and the pages under them (node-rules R6a: an
// admin cannot open them either, see src/lib/export/workspace-format.ts),
// Docs in Trash (listed in docs.csv, no page), and files: comments name the
// files they carry, the files themselves are not inside. The manifest says
// what else is not in it.
//
// Every paged read is a keyset on the id (never a cursor row that a delete
// could take away mid-export), and each streamed file's manifest entry says
// how many rows it wrote.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { getBoardStatuses, makeStatusLookup } from "@/lib/board-items-shared";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { docToMarkdown } from "@/lib/docs/content-markdown";
import { sopToMarkdown } from "@/lib/sop-markdown";
import { tableCsv } from "@/lib/table-csv";
import { isModuleActive } from "@/lib/entitlements";
import { CSV_BOM, csvLine, toCsv, type CsvCell } from "@/lib/csv";
import type { ZipStreamEntry } from "@/lib/zip-stream";
import type { Item, Prisma } from "@/generated/prisma";
import {
  COMMENT_COLUMNS,
  FIELD_COLUMNS,
  LINK_COLUMNS,
  commentCsvLine,
  commentJsonLine,
  contentFileName,
  fieldCsvLine,
  isNoteDoc,
  linkCsvLine,
  taskCsvHeader,
  taskCsvLine,
  taskJsonLine,
  type DocTreeRow,
} from "@/lib/export/workspace-format";

/**
 * Rows read per query for the large files, and the most text one piece of a
 * file holds before it is handed on, so a page's rows are garbage before the
 * next is read. Measured on a dev server exporting 60,000 tasks with long
 * descriptions (79 MB of CSV): 2,000-row pages grew it by about 780 MB,
 * 500-row pages with 256 KB pieces by about 280 MB, and it never grew again
 * on later runs.
 */
const PAGE = 500;
const PIECE_CHARS = 256 * 1024;
/** Docs and SOPs carry their whole content, so they are read fewer at a time. */
const CONTENT_PAGE = 100;
export const EXPORT_LIMITS = {
  tasks: 200_000,
  links: 200_000,
  comments: 500_000,
  docs: 50_000,
  tables: 2_000,
  tableRows: 100_000,
  sops: 20_000,
} as const;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");
const n = (v: number) => v.toLocaleString("en-US");

// ── One export at a time ─────────────────────────────────────────────

/** Running exports by workspace, with when each started. */
const running = new Map<string, number>();
/** A slot older than this is treated as free: a download the server never saw end. */
const STALE_MS = 30 * 60_000;
/** Exports this process runs at once, across workspaces. */
const MAX_RUNNING = 2;

/**
 * Take this workspace's export slot: the release (safe to call more than
 * once), or why not, "workspace" when this workspace already has one running
 * and "server" when the server is running its limit for every workspace.
 */
export function takeExportSlot(orgId: string, now = Date.now()): { release: () => void } | { busy: "workspace" | "server" } {
  for (const [id, started] of running) if (now - started > STALE_MS) running.delete(id);
  if (running.has(orgId)) return { busy: "workspace" };
  if (running.size >= MAX_RUNNING) return { busy: "server" };
  running.set(orgId, now);
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      if (running.get(orgId) === now) running.delete(orgId);
    },
  };
}

// ── The export ───────────────────────────────────────────────────────

export interface ExportSummary {
  /** The rows each streamed file wrote, by file name. */
  rows: Record<string, number>;
  files: number;
}

export interface PreparedExport {
  /** What the audit row records, known before the first byte is sent. */
  counts: Record<string, number>;
  entries: AsyncGenerator<ZipStreamEntry>;
}

type Sized = { name: string; bytes: number; rows?: number };

function personName(u: { firstName: string | null; lastName: string | null } | undefined): string {
  return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
}

/** Every column of the task, read without a select so a column added later is never left out of the copy. */
type TaskRow = Item;

const COMMENT_SELECT = {
  id: true, entityId: true, authorId: true, body: true, createdAt: true, updatedAt: true, attachments: { select: { fileId: true } },
} as const;
type CommentRow = Prisma.ItemUpdateGetPayload<{ select: typeof COMMENT_SELECT }>;

/**
 * Everything small read now, so a failure is an ordinary error answer, and
 * the counts for the audit row; the large files read as the archive is
 * written. `summarize` runs once when the entries end, however they end,
 * with what was written; whether the archive itself completed is the
 * stream's to say (zip-stream onDone).
 */
export async function prepareWorkspaceExport(
  orgId: string,
  exportedAt: Date,
  summarize: (summary: ExportSummary) => void,
): Promise<PreparedExport> {
  const [users, departments, legacyTasks, sops, reviews, meetings, kras, activity] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, firstName: true, lastName: true, email: true, status: true, accessLevel: true,
        department: { select: { name: true } }, role: { select: { title: true } },
        createdAt: true, deletedAt: true,
      },
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, _count: { select: { members: true } } },
    }),
    prisma.task.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, title: true, status: true, date: true,
        assignee: { select: { firstName: true, lastName: true } },
        kra: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.sOP.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, category: true, status: true, version: true, createdAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.reviewCycle.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, type: true, status: true, startDate: true, endDate: true, _count: { select: { reviews: true } } },
    }),
    prisma.meeting.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, type: true, scheduledAt: true, duration: true, _count: { select: { attendees: true } } },
    }),
    prisma.kRA.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, category: true, _count: { select: { assignments: true } } },
    }),
    prisma.activityLog.findMany({
      where: { organizationId: orgId },
      select: { id: true, type: true, description: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  const [spaces, folders, lists, docTree, tables, goals, taskCount, linkCount, commentCount] = await Promise.all([
    prisma.space.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, slug: true, visibility: true, ownerId: true, archivedAt: true, createdAt: true } }),
    prisma.folder.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, spaceId: true, visibility: true, archivedAt: true, createdAt: true } }),
    prisma.board.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, spaceId: true, folderId: true, visibility: true, archivedAt: true, createdAt: true, statuses: true, schema: true },
    }),
    prisma.doc.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, entityType: true, entityId: true, parentId: true, isFolder: true, createdById: true, archivedAt: true, createdAt: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.dataTable.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, spaceId: true, createdById: true, createdAt: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.oKR.findMany({ where: { organizationId: orgId }, select: { id: true, title: true, level: true, status: true, progress: true, ownerId: true, parentId: true, startDate: true, createdAt: true } }),
    prisma.item.count({ where: { organizationId: orgId } }),
    prisma.itemListLink.count({ where: { item: { organizationId: orgId } } }),
    prisma.itemUpdate.count({ where: { organizationId: orgId, entityType: "BOARD_ITEM", archivedAt: null } }),
  ]);
  // Tables made while the module was on stay the workspace's data when it is
  // off: they are exported, and the manifest says why they are there.
  const tablesModuleOn = tables.length === 0 || (await isModuleActive(orgId, "workwrk-tables").catch(() => true));

  // Notes (and the pages under them) are their owner's alone: never listed.
  const tree = new Map<string, DocTreeRow>(docTree.map((d) => [d.id, d]));
  const docs = docTree.filter((d) => !isNoteDoc(tree, d));
  const withPage = docs.filter((d) => !d.archivedAt && !d.isFolder).slice(0, EXPORT_LIMITS.docs);
  const pageOf = new Map(withPage.map((d) => [d.id, contentFileName("docs", d.title, d.id, "md", "untitled")]));

  const counts: Record<string, number> = {
    people: users.length,
    departments: departments.length,
    tasks: legacyTasks.length,
    sops: sops.length,
    reviewCycles: reviews.length,
    meetings: meetings.length,
    kras: kras.length,
    activity: activity.length,
    spaces: spaces.length,
    folders: folders.length,
    lists: lists.length,
    listTasks: Math.min(taskCount, EXPORT_LIMITS.tasks),
    listLinks: Math.min(linkCount, EXPORT_LIMITS.links),
    taskComments: Math.min(commentCount, EXPORT_LIMITS.comments),
    docs: docs.length,
    docPages: withPage.length,
    tables: tables.length,
    goals: goals.length,
  };

  const limits: string[] = [];
  if (taskCount > EXPORT_LIMITS.tasks) limits.push(`list-tasks.csv and list-tasks.jsonl hold the first ${n(EXPORT_LIMITS.tasks)} of ${n(taskCount)} tasks.`);
  if (linkCount > EXPORT_LIMITS.links) limits.push(`list-links.csv holds the first ${n(EXPORT_LIMITS.links)} of ${n(linkCount)} tasks shown in other Lists.`);
  if (commentCount > EXPORT_LIMITS.comments) limits.push(`task-comments.csv and task-comments.jsonl hold the first ${n(EXPORT_LIMITS.comments)} of ${n(commentCount)} comments.`);
  const pageable = docs.filter((d) => !d.archivedAt && !d.isFolder).length;
  if (pageable > withPage.length) limits.push(`docs/ holds ${n(withPage.length)} of ${n(pageable)} Docs; export the rest one at a time from each Doc.`);
  if (tables.length > EXPORT_LIMITS.tables) limits.push(`tables/ holds ${n(EXPORT_LIMITS.tables)} of ${n(tables.length)} tables.`);
  if (sops.length > EXPORT_LIMITS.sops) limits.push(`sops/ holds ${n(EXPORT_LIMITS.sops)} of ${n(sops.length)} SOPs.`);
  if (!tablesModuleOn) limits.push("Tables is turned off for this workspace. Its tables are still the workspace's, so tables/ holds them; turn Tables on in Settings, Apps and modules to open them.");

  const fieldsOf = new Map<string, FieldDef[]>(lists.map((l) => [l.id, parseBoardSchema(l.schema).fields.filter((f) => f && typeof f.key === "string")]));
  const statusOf = new Map(lists.map((l) => [l.id, makeStatusLookup(getBoardStatuses(l))]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const statusLabel = (boardId: string, status: string | null) => (status ? statusOf.get(boardId)?.[status]?.label ?? status : "");

  // ── paged reads, each a keyset on the id ─────────────────────────────

  async function* taskPages() {
    let after: string | null = null;
    let sent = 0;
    while (sent < EXPORT_LIMITS.tasks) {
      const take = Math.min(PAGE, EXPORT_LIMITS.tasks - sent);
      const page: TaskRow[] = await prisma.item.findMany({
        where: { organizationId: orgId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take,
      });
      if (page.length === 0) return;
      const ids = page.map((t) => t.id);
      const tagRows = await prisma.tagAssignment.findMany({
        where: { entityType: "BOARD_ITEM", entityId: { in: ids } },
        select: { entityId: true, tag: { select: { name: true, archived: true, organizationId: true } } },
        orderBy: { createdAt: "asc" },
      });
      const tags = new Map<string, string[]>();
      for (const r of tagRows) {
        if (r.tag.archived || r.tag.organizationId !== orgId) continue;
        tags.set(r.entityId, [...(tags.get(r.entityId) ?? []), r.tag.name]);
      }
      yield { page, tags };
      sent += page.length;
      after = page[page.length - 1].id;
      if (page.length < take) return;
    }
  }

  async function* commentPages() {
    let after: string | null = null;
    let sent = 0;
    while (sent < EXPORT_LIMITS.comments) {
      const take = Math.min(PAGE, EXPORT_LIMITS.comments - sent);
      const page: CommentRow[] = await prisma.itemUpdate.findMany({
        where: { organizationId: orgId, entityType: "BOARD_ITEM", archivedAt: null, ...(after ? { id: { gt: after } } : {}) },
        select: COMMENT_SELECT,
        orderBy: { id: "asc" },
        take,
      });
      if (page.length === 0) return;
      // A comment on a task that no longer exists is not shown anywhere.
      const [live, fileRows] = await Promise.all([
        prisma.item.findMany({ where: { id: { in: [...new Set(page.map((c) => c.entityId))] }, organizationId: orgId }, select: { id: true } }),
        prisma.fileEntry.findMany({
          where: { organizationId: orgId, id: { in: [...new Set(page.flatMap((c) => c.attachments.map((a) => a.fileId)))] } },
          select: { id: true, name: true },
        }),
      ]);
      const liveIds = new Set(live.map((i) => i.id));
      const fileName = new Map(fileRows.map((f) => [f.id, f.name]));
      yield {
        page: page.filter((c) => liveIds.has(c.entityId)).map((c) => ({
          ...c,
          author: personName(c.authorId ? userById.get(c.authorId) : undefined),
          fileIds: c.attachments.map((a) => a.fileId),
          files: c.attachments.map((a) => fileName.get(a.fileId)).filter((f): f is string => !!f),
        })),
      };
      sent += page.length;
      after = page[page.length - 1].id;
      if (page.length < take) return;
    }
  }

  async function* entries(): AsyncGenerator<ZipStreamEntry> {
    const files: Sized[] = [];
    const folderSizes: Record<string, { files: number; bytes: number }> = {};
    const rowsOf: Record<string, number> = {};
    const whole = (name: string, data: string): ZipStreamEntry => {
      files.push({ name, bytes: Buffer.byteLength(data) });
      return { name, data };
    };
    const inFolder = (folder: string, name: string, data: string): ZipStreamEntry => {
      const f = (folderSizes[folder] ??= { files: 0, bytes: 0 });
      f.files += 1;
      f.bytes += Buffer.byteLength(data);
      return { name, data };
    };
    // A streamed file is written a piece at a time; its size and rows are
    // known once its last piece is out. Each piece generator counts its rows
    // into rowsOf[name].
    const streamed = (name: string, pieces: AsyncIterable<string>): ZipStreamEntry => ({
      name,
      data: (async function* () {
        let bytes = 0;
        for await (const p of pieces) {
          bytes += Buffer.byteLength(p);
          yield p;
        }
        files.push({ name, bytes, rows: rowsOf[name] ?? 0 });
      })(),
    });
    // Lines gathered into pieces of at most PIECE_CHARS.
    async function* lines(name: string, header: string, source: AsyncIterable<string[]>): AsyncGenerator<string> {
      rowsOf[name] = 0;
      let chunk = header;
      for await (const batch of source) {
        for (const line of batch) {
          chunk += line;
          rowsOf[name] += 1;
          if (chunk.length >= PIECE_CHARS) {
            yield chunk;
            chunk = "";
          }
        }
      }
      if (chunk) yield chunk;
    }
    const csv = (rows: Record<string, CsvCell>[], columns: string[]) => toCsv(rows, columns, { formulaSafe: true });

    try {
      yield whole("people.csv", csv(
        users.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, status: u.status, accessLevel: u.accessLevel, department: u.department?.name ?? "", role: u.role?.title ?? "", createdAt: iso(u.createdAt), deletedAt: iso(u.deletedAt) })),
        ["id", "firstName", "lastName", "email", "status", "accessLevel", "department", "role", "createdAt", "deletedAt"],
      ));
      yield whole("departments.csv", csv(departments.map((d) => ({ id: d.id, name: d.name, memberCount: d._count.members })), ["id", "name", "memberCount"]));
      yield whole("spaces.csv", csv(
        spaces.map((x) => ({ id: x.id, name: x.name, slug: x.slug, visibility: x.visibility, ownerId: x.ownerId, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })),
        ["id", "name", "slug", "visibility", "ownerId", "archivedAt", "createdAt"],
      ));
      yield whole("folders.csv", csv(
        folders.map((x) => ({ id: x.id, name: x.name, spaceId: x.spaceId, visibility: x.visibility, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })),
        ["id", "name", "spaceId", "visibility", "archivedAt", "createdAt"],
      ));
      yield whole("lists.csv", csv(
        lists.map((x) => ({ id: x.id, name: x.name, spaceId: x.spaceId, folderId: x.folderId, visibility: x.visibility, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })),
        ["id", "name", "spaceId", "folderId", "visibility", "archivedAt", "createdAt"],
      ));
      {
        let body = CSV_BOM + csvLine([...FIELD_COLUMNS]);
        for (const l of lists) for (const f of fieldsOf.get(l.id) ?? []) body += fieldCsvLine(l.id, f);
        yield whole("list-fields.csv", body);
      }

      yield streamed("list-tasks.csv", lines("list-tasks.csv", taskCsvHeader(), (async function* () {
        for await (const { page, tags } of taskPages()) {
          yield page.map((t) => taskCsvLine(t, { statusLabel: statusLabel(t.boardId, t.status), tags: tags.get(t.id) ?? [], fields: fieldsOf.get(t.boardId) ?? [] }));
        }
      })()));

      yield streamed("list-tasks.jsonl", lines("list-tasks.jsonl", "", (async function* () {
        for await (const { page, tags } of taskPages()) {
          const placed = await prisma.itemListLink.findMany({
            where: { itemId: { in: page.map((t) => t.id) } },
            select: { itemId: true, boardId: true, position: true, createdAt: true },
            orderBy: [{ itemId: "asc" }, { boardId: "asc" }],
          });
          const others = new Map<string, Array<{ listId: string; position: number; addedAt: string }>>();
          for (const p of placed) others.set(p.itemId, [...(others.get(p.itemId) ?? []), { listId: p.boardId, position: p.position, addedAt: iso(p.createdAt) }]);
          yield page.map((t) => taskJsonLine(t, { statusLabel: statusLabel(t.boardId, t.status), tags: tags.get(t.id) ?? [], otherLists: others.get(t.id) ?? [] }));
        }
      })()));

      yield streamed("list-links.csv", lines("list-links.csv", CSV_BOM + csvLine([...LINK_COLUMNS]), (async function* () {
        let sent = 0;
        let after: { itemId: string; boardId: string } | null = null;
        while (sent < EXPORT_LIMITS.links) {
          const take = Math.min(PAGE, EXPORT_LIMITS.links - sent);
          const page: Array<{ itemId: string; boardId: string; position: number; createdAt: Date; item: { metadata: unknown } }> = await prisma.itemListLink.findMany({
            where: {
              item: { organizationId: orgId },
              ...(after ? { OR: [{ itemId: { gt: after.itemId } }, { itemId: after.itemId, boardId: { gt: after.boardId } }] } : {}),
            },
            select: { itemId: true, boardId: true, position: true, createdAt: true, item: { select: { metadata: true } } },
            orderBy: [{ itemId: "asc" }, { boardId: "asc" }],
            take,
          });
          if (page.length === 0) return;
          yield page.map((l) => linkCsvLine(l, l.item.metadata, fieldsOf.get(l.boardId) ?? []));
          sent += page.length;
          after = { itemId: page[page.length - 1].itemId, boardId: page[page.length - 1].boardId };
          if (page.length < take) return;
        }
      })()));

      yield streamed("task-comments.csv", lines("task-comments.csv", CSV_BOM + csvLine([...COMMENT_COLUMNS]), (async function* () {
        for await (const { page } of commentPages()) yield page.map((c) => commentCsvLine(c, c.author, c.files));
      })()));

      yield streamed("task-comments.jsonl", lines("task-comments.jsonl", "", (async function* () {
        for await (const { page } of commentPages()) yield page.map((c) => commentJsonLine(c, c.author, c.fileIds, c.files));
      })()));

      // Docs: the pages first, then docs.csv naming only the files written.
      // A sub-page links to its own file, in the same folder; one without a
      // file (in Trash, a note, past the limit) keeps its title alone.
      const writtenDocs = new Set<string>();
      const linkDoc = (id: string) => {
        const f = pageOf.get(id);
        return f ? f.slice("docs/".length) : null;
      };
      for (let i = 0; i < withPage.length; i += CONTENT_PAGE) {
        const ids = withPage.slice(i, i + CONTENT_PAGE).map((d) => d.id);
        const rows = await prisma.doc.findMany({ where: { id: { in: ids }, organizationId: orgId }, select: { id: true, title: true, content: true } });
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const id of ids) {
          const d = byId.get(id);
          if (!d) continue;
          writtenDocs.add(id);
          yield inFolder("docs", pageOf.get(id)!, docToMarkdown(d.title, d.content, linkDoc));
        }
      }
      yield whole("docs.csv", csv(
        docs.map((x) => ({ id: x.id, title: x.title, entityType: x.entityType, entityId: x.entityId, parentId: x.parentId, createdById: x.createdById, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt), isFolder: x.isFolder, file: writtenDocs.has(x.id) ? pageOf.get(x.id) ?? "" : "" })),
        ["id", "title", "entityType", "entityId", "parentId", "createdById", "archivedAt", "createdAt", "updatedAt", "isFolder", "file"],
      ));

      // Tables: the files first, then tables.csv naming only the files written.
      const tableFile = new Map<string, string>();
      for (const t of tables.slice(0, EXPORT_LIMITS.tables)) {
        const [full, rows] = await Promise.all([
          prisma.dataTable.findFirst({ where: { id: t.id, organizationId: orgId }, select: { columns: true, settings: true } }),
          prisma.dataTableRow.findMany({
            where: { tableId: t.id, deletedAt: null },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            select: { id: true, values: true },
            take: EXPORT_LIMITS.tableRows + 1,
          }),
        ]);
        if (!full) continue;
        const name = contentFileName("tables", t.name, t.id, "csv", "table");
        if (rows.length > EXPORT_LIMITS.tableRows) {
          limits.push(`${name} holds the first ${n(EXPORT_LIMITS.tableRows)} rows; export the table itself for all of them.`);
        }
        tableFile.set(t.id, name);
        yield inFolder("tables", name, tableCsv(full, rows.slice(0, EXPORT_LIMITS.tableRows)));
      }
      yield whole("tables.csv", csv(
        tables.map((x) => ({ id: x.id, name: x.name, spaceId: x.spaceId, createdById: x.createdById, createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt), file: tableFile.get(x.id) ?? "" })),
        ["id", "name", "spaceId", "createdById", "createdAt", "updatedAt", "file"],
      ));

      yield whole("goals.csv", csv(
        goals.map((x) => ({ id: x.id, title: x.title, level: x.level, status: x.status, progress: x.progress, ownerId: x.ownerId, parentId: x.parentId, startDate: iso(x.startDate), createdAt: iso(x.createdAt) })),
        ["id", "title", "level", "status", "progress", "ownerId", "parentId", "startDate", "createdAt"],
      ));

      // SOPs: the files first, then sops.csv naming only the files written.
      const sopFile = new Map<string, string>();
      const sopIds = sops.slice(0, EXPORT_LIMITS.sops).map((s) => s.id);
      for (let i = 0; i < sopIds.length; i += CONTENT_PAGE) {
        const ids = sopIds.slice(i, i + CONTENT_PAGE);
        const rows = await prisma.sOP.findMany({
          where: { id: { in: ids }, organizationId: orgId },
          select: { id: true, title: true, description: true, category: true, status: true, version: true, sopType: true, content: true },
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const id of ids) {
          const s = byId.get(id);
          if (!s) continue;
          const name = contentFileName("sops", s.title, s.id, "md", "sop");
          sopFile.set(id, name);
          yield inFolder("sops", name, sopToMarkdown(s));
        }
      }
      yield whole("sops.csv", csv(
        sops.map((s) => ({ id: s.id, title: s.title, category: s.category, status: s.status, version: s.version, createdAt: iso(s.createdAt), file: sopFile.get(s.id) ?? "" })),
        ["id", "title", "category", "status", "version", "createdAt", "file"],
      ));

      yield whole("tasks.csv", csv(
        legacyTasks.map((t) => ({ id: t.id, title: t.title, status: t.status, date: t.date ? t.date.toISOString().split("T")[0] : "", assignee: personName(t.assignee ?? undefined), kra: t.kra?.name ?? "", createdAt: iso(t.createdAt) })),
        ["id", "title", "status", "date", "assignee", "kra", "createdAt"],
      ));
      yield whole("reviews.csv", csv(
        reviews.map((r) => ({ id: r.id, name: r.name, type: r.type, status: r.status, startDate: iso(r.startDate), endDate: iso(r.endDate), reviewCount: r._count.reviews })),
        ["id", "name", "type", "status", "startDate", "endDate", "reviewCount"],
      ));
      yield whole("meetings.csv", csv(
        meetings.map((m) => ({ id: m.id, title: m.title, type: m.type, scheduledAt: iso(m.scheduledAt), duration: m.duration, attendeeCount: m._count.attendees })),
        ["id", "title", "type", "scheduledAt", "duration", "attendeeCount"],
      ));
      yield whole("kras.csv", csv(kras.map((k) => ({ id: k.id, name: k.name, category: k.category, assignmentCount: k._count.assignments })), ["id", "name", "category", "assignmentCount"]));
      yield whole("activity.csv", csv(activity.map((a) => ({ id: a.id, type: a.type, description: a.description, createdAt: iso(a.createdAt) })), ["id", "type", "description", "createdAt"]));

      // Last, so it can say what every file above holds.
      const manifest = {
        organizationId: orgId,
        exportedAt: exportedAt.toISOString(),
        format: 2,
        files,
        folders: folderSizes,
        counts,
        limits,
        notes: [
          "WorkwrK workspace export. Spreadsheet files are UTF-8 CSV starting with a byte order mark, so Excel reads accents (Python: encoding='utf-8-sig'). Docs and SOPs are Markdown.",
          "In the CSV files a text cell that starts with =, +, -, @, a tab or a return has one apostrophe added in front, so a spreadsheet does not run it as a formula. list-tasks.jsonl and task-comments.jsonl hold the same text exactly as stored.",
          "list-tasks.csv holds every task on every List: its description, checklist, tags, status name and its home List's field values as one JSON object keyed by field name (choices by their label, people and connected tasks as ids, which people.csv and list-tasks.csv resolve). list-fields.csv names each List's fields; a field it marks stored=no (formula, rollup, mirror, automatic progress, button) is worked out when shown and has no values here.",
          "list-tasks.jsonl holds every task exactly as stored: every column of the task (its repeat rule and group included), its tags, the other Lists it is in, and its whole metadata, every List's field values included (under $lists for the Lists it is linked into). listId and parentId repeat boardId and parentItemId under the names the CSV uses.",
          "list-links.csv holds each task shown in a List other than its home, with that List's own field values.",
          "task-comments.csv holds every live comment on a task, with the names of the files it carries. The files themselves are not inside this archive.",
          "docs/ holds every Doc as Markdown; a sub-page links to its own file. Docs in Trash are listed in docs.csv without a file. Personal notes are their owner's alone and are not in this export.",
          "tables/ holds each table's rows as the grid shows them. sops/ holds each SOP as Markdown.",
          "tasks.csv is the older task table. activity.csv is the 500 most recent rows; the full audit log is its own export.",
        ],
        notIncluded: [
          "Files and attachments (comments list the names of theirs)",
          "Canvases (whiteboards)",
          "Forms and their responses",
          "Talk messages and calls",
          "Comments on Docs",
          "Review answers and scores (reviews.csv lists the review cycles)",
          "Images inside Docs (their links point at the workspace)",
        ],
      };
      yield whole("manifest.json", JSON.stringify(manifest, null, 2));
    } finally {
      summarize({ rows: { ...rowsOf }, files: files.length + Object.values(folderSizes).reduce((a, f) => a + f.files, 0) });
    }
  }

  return { counts, entries: entries() };
}
