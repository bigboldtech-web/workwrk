// Org-wide recycle bin. moveToTrash() snapshots a row (+ essential children)
// into TrashItem, then removes it from its live table — so it disappears from
// every existing list with no query changes. restoreFromTrash() re-creates it
// from the snapshot. Items are purged 60 days after deletion.

import { unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { isS3Configured, deleteObject } from "@/lib/s3";
import { TRASH_ROW_HREF, trashRowHref, type TrashTypeKey } from "@/lib/trash-view";
import type { Prisma } from "@/generated/prisma";
import { captureListLinks, listLinksAvailable, reconcileListLinks } from "@/lib/list-links-server";
import { parseBoardSchema } from "@/lib/field-catalog";
import { fieldKeySets } from "@/lib/list-connect";
import { retargetTaskSnapshot } from "@/lib/trash-retarget";

export type TrashType =
  | "note" | "sop" | "whiteboard" | "table" | "file" | "policy" | "contract"
  // A form with every response it has received, as one snapshot (Phase 5:
  // DELETE /api/forms/[id] used to be a hard delete that cascaded responses).
  | "form"
  // Project hierarchy — "board" is the ClickUp "List", "item" is a Task.
  | "space" | "folder" | "board" | "item"
  // A drive folder (FileFolder) with its subfolders and files as one snapshot.
  | "file_folder"
  // A Meeting with its attendees and action items as one snapshot.
  | "meeting";

/** The trash kinds whose snapshot names file blobs (freed on permanent delete). */
export const BLOB_TRASH_TYPES: readonly string[] = ["file", "file_folder"];

// Best-effort: free the underlying file blob (local dev file or S3 object) so
// storage is actually reclaimed on PERMANENT deletion. Never throws.
async function freeFileBlob(url: unknown): Promise<void> {
  if (typeof url !== "string" || !url) return;
  try {
    if (url.startsWith("/api/uploads/")) {
      const name = url.split("/").pop();
      if (name) await unlink(path.join(process.cwd(), "public", "uploads", name)).catch(() => {});
    } else if (/^https?:\/\//.test(url) && isS3Configured()) {
      const key = new URL(url).pathname.replace(/^\/+/, "");
      if (key) await deleteObject(key).catch(() => {});
    }
  } catch { /* best-effort — purge proceeds regardless */ }
}

// Free any external storage a trashed item references (currently file blobs).
// Call before permanently deleting a TrashItem.
export async function freeTrashStorage(entityType: string, snapshot: unknown): Promise<void> {
  if (entityType === "file") {
    const url = (snapshot as { row?: { url?: unknown } } | null)?.row?.url;
    await freeFileBlob(url);
    return;
  }
  if (entityType === "file_folder") {
    const files = (snapshot as { children?: { files?: { url?: unknown }[] } } | null)?.children?.files ?? [];
    for (const f of files) await freeFileBlob(f?.url);
  }
}

export const TRASH_LABEL: Record<TrashType, string> = {
  note: "Note", sop: "SOP", whiteboard: "Canvas", table: "Table", form: "Form",
  file: "File", policy: "Policy", contract: "Contract",
  space: "Space", folder: "Folder", board: "List", item: "Task",
  file_folder: "Folder", meeting: "Meeting",
};

/**
 * Where a restored row lives.
 *
 * ONE TABLE, read from `src/lib/trash-view.ts`. That module is pure and the
 * Trash page can import it; this one reaches prisma and it cannot. The two
 * name the same kinds differently (the restore registry stores "note",
 * "whiteboard", "board", "item"), so the mapping below is the whole of the
 * difference and there is no second list of URLs to drift.
 *
 * IT TAKES THE ID NOW, AND THAT IS THE POINT. Four of these rows used to be
 * the bare string "/library": restore a doc, a canvas, a table or a file and
 * the Trash page offered you a page that listed all of them and did not know
 * which one you had just brought back. /library is retired in Phase 3
 * (spec-docs-knowledge section 0). The Trash page wires it: restoring one row
 * toasts "Restored X" with an Open action that goes straight to it.
 */
const REGISTRY_TO_KEY: Record<TrashType, TrashTypeKey> = {
  note: "doc",
  sop: "sop",
  whiteboard: "canvas",
  table: "table",
  form: "form",
  file: "file",
  policy: "policy",
  contract: "contract",
  // Hierarchy rows live in the Work sidebar tree; a bare href is
  // informational, because a Space and a Folder are reached by slug, not id.
  space: "space",
  folder: "folder",
  board: "list",
  item: "task",
  // A drive folder files under the Folder pill with the Space Folders; it is
  // reached from /files, so its restore href is informational like theirs.
  file_folder: "folder",
  meeting: "meeting",
};

export const TRASH_HREF: Record<TrashType, string> = Object.fromEntries(
  (Object.entries(REGISTRY_TO_KEY) as Array<[TrashType, TrashTypeKey]>)
    .map(([t, k]) => [t, TRASH_ROW_HREF[k]]),
) as Record<TrashType, string>;

/** The href for one restored row. Falls back to the list page when there is no id. */
export function trashHref(entityType: TrashType, id: string | null | undefined): string {
  return trashRowHref(REGISTRY_TO_KEY[entityType], id);
}

type Row = Record<string, unknown>;
type Snapshot = { row: Row; children?: Record<string, Row[]> };
type TrashDb = Pick<
  typeof prisma,
  "dataTable" | "dataTableRow" | "formDefinition" | "formSubmission" | "item" | "board" | "view" | "boardMember" | "folder" | "space" | "itemListLink"
>;

// Snapshots are dynamic JSON; Prisma create inputs require statically-known
// keys. This single cast bridges them (date strings are accepted by Prisma).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asData = (r: unknown): any => r;

/** The client a hierarchy restore writes through: its transaction. */
type RestoreDb = Pick<Prisma.TransactionClient, "item" | "board" | "view" | "boardMember" | "folder" | "space">;

type Entry = {
  /** `db` is the client to read through: the transaction, for the types
   *  moveToTrash captures under a row lock (table, form). */
  capture: (id: string, db?: TrashDb) => Promise<{ label: string; snapshot: Snapshot } | null>;
  /** `db` is the restore's transaction, for the hierarchy types
   *  (restoreFromTrash puts their rows and their links back in one). */
  restore: (s: Snapshot, db?: RestoreDb) => Promise<void>;
};

// Self-referencing tables (Item.parentItemId, Folder.parentFolderId) must be
// re-created parents-first or the FK insert fails. Insert in generations: each
// pass creates every row whose parent already exists (or lives outside the set),
// then repeats on the remainder. A final catch-all inserts any cycle leftovers.
async function createTreeParentsFirst(
  rows: Row[],
  parentKey: string,
  create: (batch: Row[]) => Promise<void>,
): Promise<void> {
  if (!rows.length) return;
  const inSet = new Set(rows.map((r) => r.id as string));
  const done = new Set<string>();
  let remaining = rows;
  while (remaining.length) {
    const ready = remaining.filter((r) => {
      const parent = r[parentKey] as string | null | undefined;
      return !parent || !inSet.has(parent) || done.has(parent);
    });
    if (!ready.length) { await create(remaining); return; } // cycle safety
    await create(ready);
    for (const r of ready) done.add(r.id as string);
    const readyIds = new Set(ready.map((r) => r.id as string));
    remaining = remaining.filter((r) => !readyIds.has(r.id as string));
  }
}

const createItemsParentsFirst = (rows: Row[], db: RestoreDb = prisma) =>
  createTreeParentsFirst(rows, "parentItemId", (batch) =>
    db.item.createMany({ data: asData(batch), skipDuplicates: true }).then(() => {}));

const createFoldersParentsFirst = (rows: Row[], db: RestoreDb = prisma) =>
  createTreeParentsFirst(rows, "parentFolderId", (batch) =>
    db.folder.createMany({ data: asData(batch), skipDuplicates: true }).then(() => {}));

const createDriveFoldersParentsFirst = (rows: Row[]) =>
  createTreeParentsFirst(rows, "parentId", (batch) =>
    prisma.fileFolder.createMany({ data: asData(batch), skipDuplicates: true }).then(() => {}));

// Every descendant drive folder of a FileFolder (BFS, parents before children).
async function captureDriveFolderSubtree(rootId: string): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length) {
    const kids = await prisma.fileFolder.findMany({ where: { parentId: { in: frontier } } });
    const fresh = kids.filter((k) => !seen.has(k.id));
    if (!fresh.length) break;
    for (const k of fresh) seen.add(k.id);
    out.push(...(fresh as unknown as Row[]));
    frontier = fresh.map((k) => k.id);
  }
  return out;
}

// Capture every descendant subtask of an item (BFS, level by level so the
// returned array is already parent-before-child).
async function captureItemSubtree(rootId: string, db: TrashDb = prisma): Promise<Row[]> {
  const out: Row[] = [];
  let frontier = [rootId];
  while (frontier.length) {
    const kids = await db.item.findMany({ where: { parentItemId: { in: frontier } } });
    if (!kids.length) break;
    out.push(...(kids as unknown as Row[]));
    frontier = kids.map((k) => k.id);
  }
  return out;
}

// Capture the boards of a Space/Folder plus their items/views/members — the
// shared child bundle for the "board" / "folder" / "space" registry entries.
async function captureBoardBundle(boardIds: string[], db: TrashDb = prisma): Promise<{ items: Row[]; views: Row[]; members: Row[]; listLinks: Row[] }> {
  if (!boardIds.length) return { items: [], views: [], members: [], listLinks: [] };
  const [items, views, members] = await Promise.all([
    db.item.findMany({ where: { boardId: { in: boardIds } } }),
    db.view.findMany({ where: { boardId: { in: boardIds } } }),
    db.boardMember.findMany({ where: { boardId: { in: boardIds } } }),
  ]);
  // Phase 5b: the links INTO these Lists and the links OF their tasks, so a
  // List restored from Trash comes back shared exactly as it was.
  const listLinks = (await listLinksAvailable())
    ? await captureListLinks(db as never, { boardIds, itemIds: items.map((i) => i.id) })
    : [];
  return {
    items: items as unknown as Row[],
    views: views as unknown as Row[],
    members: members as unknown as Row[],
    listLinks: listLinks as unknown as Row[],
  };
}

// Re-create a board's children from a snapshot bundle (views + members flat,
// items parents-first). Boards themselves must already exist.
async function restoreBoardChildren(s: Snapshot, db: RestoreDb = prisma): Promise<void> {
  const views = s.children?.views ?? [];
  const members = s.children?.members ?? [];
  const items = s.children?.items ?? [];
  if (views.length) await db.view.createMany({ data: asData(views), skipDuplicates: true });
  if (members.length) await db.boardMember.createMany({ data: asData(members), skipDuplicates: true });
  if (items.length) await createItemsParentsFirst(items, db);
}

const REGISTRY: Record<TrashType, Entry> = {
  note: {
    capture: async (id) => {
      const row = await prisma.doc.findUnique({ where: { id } });
      return row ? { label: row.title || "Untitled note", snapshot: { row } } : null;
    },
    restore: async (s) => { await prisma.doc.create({ data: asData(s.row) }); },
  },
  sop: {
    capture: async (id) => {
      const row = await prisma.sOP.findUnique({ where: { id } });
      return row ? { label: row.title || "Untitled SOP", snapshot: { row } } : null;
    },
    restore: async (s) => { await prisma.sOP.create({ data: asData(s.row) }); },
  },
  whiteboard: {
    capture: async (id) => {
      const row = await prisma.whiteboard.findUnique({ where: { id } });
      return row ? { label: row.name || "Untitled canvas", snapshot: { row } } : null;
    },
    restore: async (s) => { await prisma.whiteboard.create({ data: asData(s.row) }); },
  },
  table: {
    capture: async (id, db = prisma) => {
      const row = await db.dataTable.findUnique({ where: { id } });
      if (!row) return null;
      const rows = await db.dataTableRow.findMany({ where: { tableId: id } });
      return { label: row.name || "Untitled table", snapshot: { row, children: { rows } } };
    },
    restore: async (s) => {
      await prisma.dataTable.create({ data: asData(s.row) });
      const rows = s.children?.rows ?? [];
      if (rows.length) await prisma.dataTableRow.createMany({ data: asData(rows), skipDuplicates: true });
    },
  },
  form: {
    // The responses ride as children: a form restored from Trash comes back
    // with every answer it had, which a hard delete used to lose for good.
    capture: async (id, db = prisma) => {
      const row = await db.formDefinition.findUnique({ where: { id } });
      if (!row) return null;
      const submissions = await db.formSubmission.findMany({ where: { formId: id } });
      return { label: row.name || "Untitled form", snapshot: { row, children: { submissions } } };
    },
    restore: async (s) => {
      // The form comes back PRIVATE. Turning a public link on needs its
      // creator or an admin, a confirm and an access.public_link.on audit row
      // (PATCH /api/forms/[id]); a restore is none of those, so it never
      // revives a live link. The Share dialog turns it back on.
      const row = { ...(s.row as Record<string, unknown>), isPublic: false };
      await prisma.formDefinition.create({ data: asData(row) });
      const submissions = s.children?.submissions ?? [];
      if (submissions.length) await prisma.formSubmission.createMany({ data: asData(submissions), skipDuplicates: true });
    },
  },
  file: {
    capture: async (id) => {
      const row = await prisma.fileEntry.findUnique({ where: { id } });
      return row ? { label: row.name || "File", snapshot: { row } } : null;
    },
    restore: async (s) => { await prisma.fileEntry.create({ data: asData(s.row) }); },
  },
  policy: {
    capture: async (id) => {
      const row = await prisma.policy.findUnique({ where: { id } });
      return row ? { label: row.title || "Untitled policy", snapshot: { row } } : null;
    },
    restore: async (s) => { await prisma.policy.create({ data: asData(s.row) }); },
  },
  contract: {
    capture: async (id) => {
      const row = await prisma.agreement.findUnique({ where: { id } });
      if (!row) return null;
      const parties = await prisma.agreementParty.findMany({ where: { agreementId: id } });
      return { label: row.title || "Untitled contract", snapshot: { row, children: { parties } } };
    },
    restore: async (s) => {
      await prisma.agreement.create({ data: asData(s.row) });
      const parties = s.children?.parties ?? [];
      if (parties.length) await prisma.agreementParty.createMany({ data: asData(parties), skipDuplicates: true });
    },
  },

  // A Meeting, with its attendee list and its action items. Both cascade on
  // delete, so both have to be IN the snapshot or a restored meeting comes
  // back empty: the notes and the decisions are columns on the row, but the
  // people and the follow-ups are not, and those are the part somebody
  // actually needs back.
  meeting: {
    capture: async (id) => {
      const row = await prisma.meeting.findUnique({ where: { id } });
      if (!row) return null;
      const [attendees, actionItems] = await Promise.all([
        prisma.meetingAttendee.findMany({ where: { meetingId: id } }),
        prisma.actionItem.findMany({ where: { meetingId: id } }),
      ]);
      return {
        label: row.title || "Untitled meeting",
        snapshot: { row: row as unknown as Row, children: { attendees: attendees as unknown as Row[], actionItems: actionItems as unknown as Row[] } },
      };
    },
    restore: async (s) => {
      await prisma.meeting.create({ data: asData(s.row) });
      const attendees = s.children?.attendees ?? [];
      if (attendees.length) await prisma.meetingAttendee.createMany({ data: asData(attendees), skipDuplicates: true });
      const actionItems = s.children?.actionItems ?? [];
      if (actionItems.length) await prisma.actionItem.createMany({ data: asData(actionItems), skipDuplicates: true });
    },
  },

  // A Task. Snapshot the item + its whole subtask subtree; the live delete
  // cascades the subtasks (Item.parentItem onDelete: Cascade), so restore
  // rebuilds the root then its descendants parents-first.
  item: {
    capture: async (id, db = prisma) => {
      const row = await db.item.findUnique({ where: { id } });
      if (!row) return null;
      const subtasks = await captureItemSubtree(id, db);
      // Phase 5b: the Lists the task (and its subtree) appears in besides its
      // home, put back by reconcileListLinks on restore.
      const listLinks = (await listLinksAvailable())
        ? await captureListLinks(db as never, { itemIds: [id, ...subtasks.map((t) => t.id as string)] })
        : [];
      return { label: row.title || "Untitled task", snapshot: { row, children: { subtasks, listLinks: listLinks as unknown as Row[] } } };
    },
    restore: async (s, db = prisma) => {
      await createItemsParentsFirst([s.row, ...(s.children?.subtasks ?? [])], db);
    },
  },

  // A List (Board). Deleting cascades its Items/Views/BoardMembers, so we
  // snapshot all three, then delete just the board.
  board: {
    capture: async (id, db = prisma) => {
      const row = await db.board.findUnique({ where: { id } });
      if (!row) return null;
      const bundle = await captureBoardBundle([id], db);
      return { label: row.name || "Untitled list", snapshot: { row, children: bundle } };
    },
    restore: async (s, db = prisma) => {
      await db.board.create({ data: asData(s.row) });
      await restoreBoardChildren(s, db);
    },
  },

  // A Folder + the boards it holds. Board.folder is onDelete:SetNull, so the
  // live delete (in moveToTrash) removes the boards explicitly in a transaction.
  folder: {
    capture: async (id, db = prisma) => {
      const row = await db.folder.findUnique({ where: { id } });
      if (!row) return null;
      const boards = await db.board.findMany({ where: { folderId: id } });
      const bundle = await captureBoardBundle(boards.map((b) => b.id), db);
      return {
        label: row.name || "Untitled folder",
        snapshot: { row, children: { boards: boards as unknown as Row[], ...bundle } },
      };
    },
    restore: async (s, db = prisma) => {
      await db.folder.create({ data: asData(s.row) });
      const boards = s.children?.boards ?? [];
      if (boards.length) await db.board.createMany({ data: asData(boards), skipDuplicates: true });
      await restoreBoardChildren(s, db);
    },
  },

  // A whole Space — folders + boards + all their children. Mirrors deleteSpace
  // (src/lib/space.ts) but snapshots first so it's recoverable.
  space: {
    capture: async (id, db = prisma) => {
      const row = await db.space.findUnique({ where: { id } });
      if (!row) return null;
      const [folders, boards] = await Promise.all([
        db.folder.findMany({ where: { spaceId: id } }),
        db.board.findMany({ where: { spaceId: id } }),
      ]);
      const bundle = await captureBoardBundle(boards.map((b) => b.id), db);
      return {
        label: row.name || "Untitled space",
        snapshot: {
          row,
          children: { folders: folders as unknown as Row[], boards: boards as unknown as Row[], ...bundle },
        },
      };
    },
    restore: async (s, db = prisma) => {
      await db.space.create({ data: asData(s.row) });
      const folders = s.children?.folders ?? [];
      if (folders.length) await createFoldersParentsFirst(folders, db); // folders can nest
      const boards = s.children?.boards ?? [];
      if (boards.length) await db.board.createMany({ data: asData(boards), skipDuplicates: true });
      await restoreBoardChildren(s, db);
    },
  },

  // A DRIVE folder (FileFolder) with everything under it: its descendant
  // folders (BFS on parentId) and every FileEntry in any of them, as ONE
  // restorable snapshot (spec-docs-knowledge section 2, /files: "a trashed
  // folder carries its files to Trash as one restorable snapshot"). Both FKs
  // are onDelete:SetNull, so the live delete removes files and folders
  // explicitly in a transaction rather than scattering files to the root.
  file_folder: {
    capture: async (id) => {
      const row = await prisma.fileFolder.findUnique({ where: { id } });
      if (!row) return null;
      const folders = await captureDriveFolderSubtree(id);
      const ids = [id, ...folders.map((f) => f.id as string)];
      const files = await prisma.fileEntry.findMany({ where: { folderId: { in: ids } } });
      return {
        label: row.name || "Untitled folder",
        snapshot: { row, children: { folders, files: files as unknown as Row[] } },
      };
    },
    restore: async (s) => {
      await prisma.fileFolder.create({ data: asData(s.row) });
      const folders = s.children?.folders ?? [];
      if (folders.length) await createDriveFoldersParentsFirst(folders);
      const files = s.children?.files ?? [];
      if (files.length) await prisma.fileEntry.createMany({ data: asData(files), skipDuplicates: true });
    },
  },
};

// Snapshot the row (+ children) into TrashItem and delete it from its table.
// Returns false if the row no longer exists.
export async function moveToTrash(
  type: TrashType, id: string,
  ctx: { organizationId: string; userId?: string | null; userName?: string | null },
): Promise<boolean> {
  // A table or a form keeps receiving children while it is being trashed (a
  // cell edit, a form response from a live public link). Captured outside a
  // lock, a child written between the snapshot and the delete would be
  // removed by the cascade and be in no snapshot. So these two take the
  // parent row FOR UPDATE first: a child insert needs a key-share lock on its
  // parent and waits, then fails its foreign key once the parent is gone,
  // which the writer surfaces (the responder keeps the answers on screen).
  if (type === "table" || type === "form") {
    return prisma.$transaction(async (tx) => {
      if (type === "table") await tx.$queryRaw`SELECT id FROM "DataTable" WHERE id = ${id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "FormDefinition" WHERE id = ${id} FOR UPDATE`;
      const captured = await REGISTRY[type].capture(id, tx);
      if (!captured) return false;
      await tx.trashItem.create({
        data: {
          organizationId: ctx.organizationId,
          entityType: type,
          entityId: id,
          label: captured.label,
          snapshot: captured.snapshot as object,
          deletedById: ctx.userId ?? null,
          deletedByName: ctx.userName ?? null,
        },
      });
      if (type === "table") await tx.dataTable.delete({ where: { id } });
      else await tx.formDefinition.delete({ where: { id } });
      return true;
    }, { timeout: 60_000, maxWait: 10_000 });
  }

  // Phase 5b: a task or a List can be SHARED into other Lists, and those link
  // rows cascade away with it. They are captured, and the row deleted, in ONE
  // transaction under row locks on the Lists and tasks involved: a link
  // insert needs a key-share lock on both its task and its List, so a link
  // added while the snapshot is taken either lands in it or waits and then
  // fails its foreign key. Nothing shared is ever lost to the cascade.
  if (type === "item" || type === "board" || type === "folder" || type === "space") {
    // Asked BEFORE the transaction: the captures below ask it again, and on a
    // cold process the first ask is a query on the global pool, which from
    // inside a transaction waits for a second connection (the pool deadlock
    // listLinksAvailable describes). Answered here, their ask is a cache hit.
    await listLinksAvailable();
    return prisma.$transaction(async (tx) => {
      if (type === "item") {
        await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${id} FOR UPDATE`;
      } else {
        const boards = type === "board"
          ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Board" WHERE id = ${id} FOR UPDATE`
          : type === "folder"
            ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Board" WHERE "folderId" = ${id} FOR UPDATE`
            : await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Board" WHERE "spaceId" = ${id} FOR UPDATE`;
        const boardIds = boards.map((b) => b.id);
        if (boardIds.length) await tx.$queryRaw`SELECT id FROM "Item" WHERE "boardId" = ANY(${boardIds}::text[]) FOR UPDATE`;
      }
      const captured = await REGISTRY[type].capture(id, tx);
      if (!captured) return false;
      await tx.trashItem.create({
        data: {
          organizationId: ctx.organizationId,
          entityType: type,
          entityId: id,
          label: captured.label,
          snapshot: captured.snapshot as object,
          deletedById: ctx.userId ?? null,
          deletedByName: ctx.userName ?? null,
        },
      });
      if (type === "item") await tx.item.delete({ where: { id } });
      else if (type === "board") await tx.board.delete({ where: { id } });
      else if (type === "folder") {
        // Boards reference folderId with onDelete:SetNull, so drop them
        // explicitly (their own children cascade), then the folder row.
        await tx.board.deleteMany({ where: { folderId: id } });
        await tx.folder.delete({ where: { id } });
      } else {
        // Mirror deleteSpace: remove boards + folders first, then the space.
        await tx.board.deleteMany({ where: { spaceId: id } });
        await tx.folder.deleteMany({ where: { spaceId: id } });
        await tx.space.delete({ where: { id } });
      }
      return true;
    }, { timeout: 60_000, maxWait: 10_000 });
  }

  const captured = await REGISTRY[type].capture(id);
  if (!captured) return false;
  await prisma.trashItem.create({
    data: {
      organizationId: ctx.organizationId,
      entityType: type,
      entityId: id,
      label: captured.label,
      snapshot: captured.snapshot as object,
      deletedById: ctx.userId ?? null,
      deletedByName: ctx.userName ?? null,
    },
  });
  // Remove the live row (children cascade). Per-type delegate.
  switch (type) {
    case "note": await prisma.doc.delete({ where: { id } }); break;
    case "sop": await prisma.sOP.delete({ where: { id } }); break;
    case "whiteboard": await prisma.whiteboard.delete({ where: { id } }); break;
    // "table" and "form" are handled above, under the row lock.
    case "file": await prisma.fileEntry.delete({ where: { id } }); break;
    case "policy": await prisma.policy.delete({ where: { id } }); break;
    case "contract": await prisma.agreement.delete({ where: { id } }); break;
    // Meeting cascades its attendees and action items; both are in the
    // snapshot above, so the row leaves the live table and comes back whole.
    case "meeting": await prisma.meeting.delete({ where: { id } }); break;
    // "item", "board", "folder" and "space" are handled above, captured and
    // deleted in one transaction under row locks (Phase 5b, their links).
    // Drive folder: files and subfolders reference it with SetNull, so remove
    // the files, then every folder in the subtree, then the root, in one
    // transaction. The ids come from the snapshot just captured.
    case "file_folder": {
      const snap = captured.snapshot as { children?: { folders?: Row[] } };
      const ids = [id, ...(snap.children?.folders ?? []).map((f) => f.id as string)];
      await prisma.$transaction(async (tx) => {
        await tx.fileEntry.deleteMany({ where: { folderId: { in: ids } } });
        await tx.fileFolder.deleteMany({ where: { id: { in: ids } } });
      });
      break;
    }
  }
  return true;
}

/**
 * The stored field keys of the List a task snapshot lived in, when that List
 * still exists; null when it is gone (retargetTaskSnapshot then parks every
 * non-task-level key). Read before the restore's transaction opens.
 */
async function oldHomeKeys(snapshot: unknown): Promise<string[] | null> {
  const boardId = (snapshot as Snapshot | null)?.row?.boardId;
  if (typeof boardId !== "string") return null;
  const b = await prisma.board.findUnique({ where: { id: boardId }, select: { schema: true } }).catch(() => null);
  return b ? [...fieldKeySets(parseBoardSchema(b.schema).fields).stored] : null;
}

/**
 * Re-create the row from its snapshot and remove the TrashItem.
 *
 * `targetBoardId` is "Restore to...": a task whose own List is gone goes back
 * into this one instead (the caller has checked it may write there).
 *
 * THE HIERARCHY TYPES (task, List, Folder, Space) RESTORE IN ONE TRANSACTION:
 * the TrashItem read FOR UPDATE, the rows recreated, the TrashItem deleted
 * and the captured links put back (reconcileListLinks) all land together or
 * not at all. The snapshot is the only copy of those links; the old order
 * deleted it and then recreated the links outside any transaction, so one
 * failed insert lost every link in it for good. The lock also serialises
 * this restore with any other restore parking a link into this snapshot, and
 * the snapshot used is the one read under it, parked links included.
 */
export async function restoreFromTrash(
  item: { id: string; entityType: string; snapshot: unknown },
  opts: { targetBoardId?: string | null } = {},
): Promise<void> {
  const type = item.entityType as TrashType;
  const entry = REGISTRY[type];
  if (!entry) return;
  if (type === "item" || type === "board" || type === "folder" || type === "space") {
    // Everything that reads outside the transaction is answered first: the
    // link table's presence (a global-pool query on a cold process) and the
    // old home's field keys.
    const linksOn = await listLinksAvailable();
    const target = type === "item" ? opts.targetBoardId ?? null : null;
    const fromKeys = target ? await oldHomeKeys(item.snapshot) : null;
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ organizationId: string; snapshot: unknown }>>`
        SELECT "organizationId", snapshot FROM "TrashItem" WHERE id = ${item.id} FOR UPDATE`;
      if (locked.length === 0) throw new Error("This item is no longer in Trash.");
      const stored = locked[0].snapshot as Snapshot | null;
      const snapshot = (target ? retargetTaskSnapshot(stored, target, { fromKeys }) : stored) as Snapshot;
      await entry.restore(snapshot, tx);
      await tx.trashItem.delete({ where: { id: item.id } });
      // The STORED links, parked ones included; a link into a "Restore to..."
      // home is dropped by the reconciliation itself.
      await reconcileListLinks(tx, locked[0].organizationId, stored?.children?.listLinks ?? [], linksOn);
    }, { timeout: 60_000, maxWait: 10_000 });
    return;
  }
  await entry.restore(item.snapshot as Snapshot);
  await prisma.trashItem.delete({ where: { id: item.id } });
}

// Permanently delete trash older than 60 days for an org, freeing file blobs.
export async function purgeExpiredTrash(organizationId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  // Free blobs for expiring files first (snapshot holds the url).
  const expiringFiles = await prisma.trashItem.findMany({
    where: { organizationId, deletedAt: { lt: cutoff }, entityType: { in: [...BLOB_TRASH_TYPES] } },
    select: { entityType: true, snapshot: true },
  });
  for (const it of expiringFiles) await freeTrashStorage(it.entityType, it.snapshot);
  await prisma.trashItem.deleteMany({ where: { organizationId, deletedAt: { lt: cutoff } } });
}
