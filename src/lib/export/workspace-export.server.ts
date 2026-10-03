// The whole workspace as ZIP entries (GET /api/export/all), read a page at a
// time so a large workspace streams through src/lib/zip-stream.ts and never
// sits in memory whole.
//
// WHAT IT HOLDS (decided addition f, the enterprise target: a real copy of
// the workspace, not a people-and-HR slice):
//   the people and HR tables, as before
//   spaces, folders, lists, list-fields (each List's fields), goals, tables
//   list-tasks.csv   every task with its description exactly as stored,
//                    its checklist, tags and its home List's field values
//   list-links.csv   each task shown in another List, with that List's values
//   task-comments.csv every live comment on a task, exactly as stored
//   docs/*.md        every live Doc as Markdown, sub-pages linked by file
//   tables/*.csv     every table's rows, the values the grid shows
//   sops/*.md        every SOP as Markdown
//   manifest.json    last: the counts, each file's size, and every limit hit
//
// Never in it: personal notes and the pages under them (node-rules R6a: an
// admin cannot open them either, see src/lib/export/workspace-format.ts),
// Docs in Trash (listed in docs.csv, no page), and files: comments name the
// files they carry, the files themselves are not inside.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { getBoardStatuses, makeStatusLookup } from "@/lib/board-items-shared";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { docToMarkdown } from "@/lib/docs/content-markdown";
import { sopToMarkdown } from "@/lib/sop-markdown";
import { tableCsv } from "@/lib/table-csv";
import { CSV_BOM, csvLine, toCsv, type CsvCell } from "@/lib/csv";
import type { ZipStreamEntry } from "@/lib/zip-stream";
import {
  COMMENT_COLUMNS,
  FIELD_COLUMNS,
  LINK_COLUMNS,
  commentCsvLine,
  contentFileName,
  fieldCsvLine,
  isNoteDoc,
  linkCsvLine,
  taskCsvHeader,
  taskCsvLine,
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

// ── One export at a time ─────────────────────────────────────────────

/** Running exports by workspace, with when each started. */
const running = new Map<string, number>();
/** A slot older than this is treated as free: a download the server never saw end. */
const STALE_MS = 30 * 60_000;
/** Exports this process runs at once, across workspaces. */
const MAX_RUNNING = 2;

/**
 * Take this workspace's export slot, or null when one is already running
 * (or the server is running its limit). The release is safe to call more
 * than once.
 */
export function takeExportSlot(orgId: string, now = Date.now()): (() => void) | null {
  for (const [id, started] of running) if (now - started > STALE_MS) running.delete(id);
  if (running.has(orgId) || running.size >= MAX_RUNNING) return null;
  running.set(orgId, now);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (running.get(orgId) === now) running.delete(orgId);
  };
}

// ── The export ───────────────────────────────────────────────────────

export interface PreparedExport {
  /** What the audit row records, known before the first byte is sent. */
  counts: Record<string, number>;
  entries: AsyncGenerator<ZipStreamEntry>;
}

type Sized = { name: string; bytes: number };

function personName(u: { firstName: string | null; lastName: string | null } | undefined): string {
  return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
}

/**
 * Everything small read now, so a failure is an ordinary error answer, and
 * the counts for the audit row; the large files read as the archive is
 * written. `done` runs when the entries end, however they end.
 */
export async function prepareWorkspaceExport(orgId: string, exportedAt: Date, done: () => void): Promise<PreparedExport> {
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
  if (taskCount > EXPORT_LIMITS.tasks) limits.push(`list-tasks.csv holds the first ${EXPORT_LIMITS.tasks.toLocaleString("en-US")} of ${taskCount.toLocaleString("en-US")} tasks.`);
  if (linkCount > EXPORT_LIMITS.links) limits.push(`list-links.csv holds the first ${EXPORT_LIMITS.links.toLocaleString("en-US")} of ${linkCount.toLocaleString("en-US")} tasks shown in other Lists.`);
  if (commentCount > EXPORT_LIMITS.comments) limits.push(`task-comments.csv holds the first ${EXPORT_LIMITS.comments.toLocaleString("en-US")} of ${commentCount.toLocaleString("en-US")} comments.`);
  const pageable = docs.filter((d) => !d.archivedAt && !d.isFolder).length;
  if (pageable > withPage.length) limits.push(`docs/ holds ${withPage.length.toLocaleString("en-US")} of ${pageable.toLocaleString("en-US")} Docs; export the rest one at a time from each Doc.`);
  if (tables.length > EXPORT_LIMITS.tables) limits.push(`tables/ holds ${EXPORT_LIMITS.tables.toLocaleString("en-US")} of ${tables.length.toLocaleString("en-US")} tables.`);
  if (sops.length > EXPORT_LIMITS.sops) limits.push(`sops/ holds ${EXPORT_LIMITS.sops.toLocaleString("en-US")} of ${sops.length.toLocaleString("en-US")} SOPs.`);

  const fieldsOf = new Map<string, FieldDef[]>(lists.map((l) => [l.id, parseBoardSchema(l.schema).fields.filter((f) => f && typeof f.key === "string")]));
  const statusOf = new Map(lists.map((l) => [l.id, makeStatusLookup(getBoardStatuses(l))]));
  const userById = new Map(users.map((u) => [u.id, u]));

  async function* entries(): AsyncGenerator<ZipStreamEntry> {
    const files: Sized[] = [];
    const folderSizes: Record<string, { files: number; bytes: number }> = {};
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
    // A streamed file's size is known once its last piece is out.
    const streamed = (name: string, pieces: AsyncIterable<string>): ZipStreamEntry => ({
      name,
      data: (async function* () {
        let bytes = 0;
        for await (const p of pieces) {
          bytes += Buffer.byteLength(p);
          yield p;
        }
        files.push({ name, bytes });
      })(),
    });
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

      yield streamed("list-tasks.csv", (async function* () {
        yield taskCsvHeader();
        let cursor: string | undefined;
        let sent = 0;
        while (sent < EXPORT_LIMITS.tasks) {
          const page = await prisma.item.findMany({
            where: { organizationId: orgId },
            select: { id: true, boardId: true, parentItemId: true, title: true, status: true, priority: true, ownerId: true, assigneeIds: true, startAt: true, dueAt: true, archivedAt: true, createdAt: true, updatedAt: true, metadata: true },
            orderBy: { id: "asc" },
            take: Math.min(PAGE, EXPORT_LIMITS.tasks - sent),
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });
          if (page.length === 0) break;
          const tagRows = await prisma.tagAssignment.findMany({
            where: { entityType: "BOARD_ITEM", entityId: { in: page.map((t) => t.id) } },
            select: { entityId: true, tag: { select: { name: true, archived: true, organizationId: true } } },
            orderBy: { createdAt: "asc" },
          });
          const tags = new Map<string, string[]>();
          for (const r of tagRows) {
            if (r.tag.archived || r.tag.organizationId !== orgId) continue;
            tags.set(r.entityId, [...(tags.get(r.entityId) ?? []), r.tag.name]);
          }
          let chunk = "";
          for (const t of page) {
            const label = t.status ? statusOf.get(t.boardId)?.[t.status]?.label ?? t.status : "";
            chunk += taskCsvLine(t, { statusLabel: label, tags: tags.get(t.id) ?? [], fields: fieldsOf.get(t.boardId) ?? [] });
            if (chunk.length >= PIECE_CHARS) {
              yield chunk;
              chunk = "";
            }
          }
          if (chunk) yield chunk;
          sent += page.length;
          cursor = page[page.length - 1].id;
          if (page.length < PAGE) break;
        }
      })());

      yield streamed("list-links.csv", (async function* () {
        yield CSV_BOM + csvLine([...LINK_COLUMNS]);
        let sent = 0;
        let after: { itemId: string; boardId: string } | null = null;
        while (sent < EXPORT_LIMITS.links) {
          const page: Array<{ itemId: string; boardId: string; position: number; createdAt: Date; item: { metadata: unknown } }> = await prisma.itemListLink.findMany({
            where: {
              item: { organizationId: orgId },
              ...(after ? { OR: [{ itemId: { gt: after.itemId } }, { itemId: after.itemId, boardId: { gt: after.boardId } }] } : {}),
            },
            select: { itemId: true, boardId: true, position: true, createdAt: true, item: { select: { metadata: true } } },
            orderBy: [{ itemId: "asc" }, { boardId: "asc" }],
            take: Math.min(PAGE, EXPORT_LIMITS.links - sent),
          });
          if (page.length === 0) break;
          let chunk = "";
          for (const l of page) {
            chunk += linkCsvLine(l, l.item.metadata, fieldsOf.get(l.boardId) ?? []);
            if (chunk.length >= PIECE_CHARS) {
              yield chunk;
              chunk = "";
            }
          }
          if (chunk) yield chunk;
          sent += page.length;
          after = { itemId: page[page.length - 1].itemId, boardId: page[page.length - 1].boardId };
          if (page.length < PAGE) break;
        }
      })());

      yield streamed("task-comments.csv", (async function* () {
        yield CSV_BOM + csvLine([...COMMENT_COLUMNS]);
        let cursor: string | undefined;
        let sent = 0;
        while (sent < EXPORT_LIMITS.comments) {
          const page = await prisma.itemUpdate.findMany({
            where: { organizationId: orgId, entityType: "BOARD_ITEM", archivedAt: null },
            select: { id: true, entityId: true, authorId: true, body: true, createdAt: true, updatedAt: true, attachments: { select: { fileId: true } } },
            orderBy: { id: "asc" },
            take: Math.min(PAGE, EXPORT_LIMITS.comments - sent),
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });
          if (page.length === 0) break;
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
          let chunk = "";
          for (const c of page) {
            if (!liveIds.has(c.entityId)) continue;
            const names = c.attachments.map((a) => fileName.get(a.fileId)).filter((n): n is string => !!n);
            chunk += commentCsvLine(c, personName(c.authorId ? userById.get(c.authorId) : undefined), names);
            if (chunk.length >= PIECE_CHARS) {
              yield chunk;
              chunk = "";
            }
          }
          if (chunk) yield chunk;
          sent += page.length;
          cursor = page[page.length - 1].id;
          if (page.length < PAGE) break;
        }
      })());

      yield whole("docs.csv", csv(
        docs.map((x) => ({ id: x.id, title: x.title, entityType: x.entityType, entityId: x.entityId, parentId: x.parentId, createdById: x.createdById, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt), isFolder: x.isFolder, file: pageOf.get(x.id) ?? "" })),
        ["id", "title", "entityType", "entityId", "parentId", "createdById", "archivedAt", "createdAt", "updatedAt", "isFolder", "file"],
      ));
      // A sub-page links to its own file, in the same folder; one without a
      // file (in Trash, a note, past the limit) keeps its title alone.
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
          yield inFolder("docs", pageOf.get(id)!, docToMarkdown(d.title, d.content, linkDoc));
        }
      }

      yield whole("tables.csv", csv(
        tables.map((x) => ({ id: x.id, name: x.name, spaceId: x.spaceId, createdById: x.createdById, createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt), file: contentFileName("tables", x.name, x.id, "csv", "table") })),
        ["id", "name", "spaceId", "createdById", "createdAt", "updatedAt", "file"],
      ));
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
        if (rows.length > EXPORT_LIMITS.tableRows) {
          limits.push(`tables/${contentFileName("tables", t.name, t.id, "csv", "table").slice("tables/".length)} holds the first ${EXPORT_LIMITS.tableRows.toLocaleString("en-US")} rows; export the table itself for all of them.`);
        }
        yield inFolder("tables", contentFileName("tables", t.name, t.id, "csv", "table"), tableCsv(full, rows.slice(0, EXPORT_LIMITS.tableRows)));
      }

      yield whole("goals.csv", csv(
        goals.map((x) => ({ id: x.id, title: x.title, level: x.level, status: x.status, progress: x.progress, ownerId: x.ownerId, parentId: x.parentId, startDate: iso(x.startDate), createdAt: iso(x.createdAt) })),
        ["id", "title", "level", "status", "progress", "ownerId", "parentId", "startDate", "createdAt"],
      ));
      yield whole("sops.csv", csv(
        sops.map((s) => ({ id: s.id, title: s.title, category: s.category, status: s.status, version: s.version, createdAt: iso(s.createdAt), file: contentFileName("sops", s.title, s.id, "md", "sop") })),
        ["id", "title", "category", "status", "version", "createdAt", "file"],
      ));
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
          yield inFolder("sops", contentFileName("sops", s.title, s.id, "md", "sop"), sopToMarkdown(s));
        }
      }

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
          "WorkwrK workspace export. Spreadsheet files are UTF-8 CSV; Docs and SOPs are Markdown.",
          "list-tasks.csv holds every task on every List: its description exactly as stored (Markdown; older ones may be HTML), its checklist, its tags, and its home List's field values as one JSON object keyed by field name (people and connected tasks as ids, which people.csv and list-tasks.csv resolve). list-fields.csv names each List's fields.",
          "list-links.csv holds each task shown in a List other than its home, with that List's own field values.",
          "task-comments.csv holds every comment on a task exactly as stored, with the names of the files it carries. The files themselves are not inside this archive.",
          "docs/ holds every Doc as Markdown; a sub-page links to its own file. Docs in Trash are listed in docs.csv without a page. Personal notes are their owner's alone and are not in this export.",
          "tables/ holds each table's rows as the grid shows them. sops/ holds each SOP as Markdown.",
          "tasks.csv is the older task table. activity.csv is the 500 most recent rows; the full audit log is its own export.",
        ],
      };
      yield whole("manifest.json", JSON.stringify(manifest, null, 2));
    } finally {
      done();
    }
  }

  return { counts, entries: entries() };
}
