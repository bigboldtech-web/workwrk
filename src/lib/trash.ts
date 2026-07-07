// Org-wide recycle bin. moveToTrash() snapshots a row (+ essential children)
// into TrashItem, then removes it from its live table — so it disappears from
// every existing list with no query changes. restoreFromTrash() re-creates it
// from the snapshot. Items are purged 60 days after deletion.

import { unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { isS3Configured, deleteObject } from "@/lib/s3";

export type TrashType =
  | "note" | "sop" | "whiteboard" | "table" | "file" | "policy" | "contract"
  // Project hierarchy — "board" is the ClickUp "List", "item" is a Task.
  | "space" | "folder" | "board" | "item";

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
  if (entityType !== "file") return;
  const url = (snapshot as { row?: { url?: unknown } } | null)?.row?.url;
  await freeFileBlob(url);
}

export const TRASH_LABEL: Record<TrashType, string> = {
  note: "Note", sop: "SOP", whiteboard: "Whiteboard", table: "Table",
  file: "File", policy: "Policy", contract: "Contract",
  space: "Space", folder: "Folder", board: "List", item: "Task",
};

export const TRASH_HREF: Record<TrashType, string> = {
  note: "/library", sop: "/sops", whiteboard: "/library", table: "/library",
  file: "/library", policy: "/policies", contract: "/agreements",
  // Hierarchy rows live in the home sidebar tree; a bare href is informational.
  space: "/", folder: "/", board: "/", item: "/",
};

type Row = Record<string, unknown>;
type Snapshot = { row: Row; children?: Record<string, Row[]> };

// Snapshots are dynamic JSON; Prisma create inputs require statically-known
// keys. This single cast bridges them (date strings are accepted by Prisma).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asData = (r: unknown): any => r;

type Entry = {
  capture: (id: string) => Promise<{ label: string; snapshot: Snapshot } | null>;
  restore: (s: Snapshot) => Promise<void>;
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

const createItemsParentsFirst = (rows: Row[]) =>
  createTreeParentsFirst(rows, "parentItemId", (batch) =>
    prisma.item.createMany({ data: asData(batch), skipDuplicates: true }).then(() => {}));

const createFoldersParentsFirst = (rows: Row[]) =>
  createTreeParentsFirst(rows, "parentFolderId", (batch) =>
    prisma.folder.createMany({ data: asData(batch), skipDuplicates: true }).then(() => {}));

// Capture every descendant subtask of an item (BFS, level by level so the
// returned array is already parent-before-child).
async function captureItemSubtree(rootId: string): Promise<Row[]> {
  const out: Row[] = [];
  let frontier = [rootId];
  while (frontier.length) {
    const kids = await prisma.item.findMany({ where: { parentItemId: { in: frontier } } });
    if (!kids.length) break;
    out.push(...(kids as unknown as Row[]));
    frontier = kids.map((k) => k.id);
  }
  return out;
}

// Capture the boards of a Space/Folder plus their items/views/members — the
// shared child bundle for the "board" / "folder" / "space" registry entries.
async function captureBoardBundle(boardIds: string[]): Promise<{ items: Row[]; views: Row[]; members: Row[] }> {
  if (!boardIds.length) return { items: [], views: [], members: [] };
  const [items, views, members] = await Promise.all([
    prisma.item.findMany({ where: { boardId: { in: boardIds } } }),
    prisma.view.findMany({ where: { boardId: { in: boardIds } } }),
    prisma.boardMember.findMany({ where: { boardId: { in: boardIds } } }),
  ]);
  return { items: items as unknown as Row[], views: views as unknown as Row[], members: members as unknown as Row[] };
}

// Re-create a board's children from a snapshot bundle (views + members flat,
// items parents-first). Boards themselves must already exist.
async function restoreBoardChildren(s: Snapshot): Promise<void> {
  const views = s.children?.views ?? [];
  const members = s.children?.members ?? [];
  const items = s.children?.items ?? [];
  if (views.length) await prisma.view.createMany({ data: asData(views), skipDuplicates: true });
  if (members.length) await prisma.boardMember.createMany({ data: asData(members), skipDuplicates: true });
  if (items.length) await createItemsParentsFirst(items);
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
      return row ? { label: row.name || "Untitled whiteboard", snapshot: { row } } : null;
    },
    restore: async (s) => { await prisma.whiteboard.create({ data: asData(s.row) }); },
  },
  table: {
    capture: async (id) => {
      const row = await prisma.dataTable.findUnique({ where: { id } });
      if (!row) return null;
      const rows = await prisma.dataTableRow.findMany({ where: { tableId: id } });
      return { label: row.name || "Untitled table", snapshot: { row, children: { rows } } };
    },
    restore: async (s) => {
      await prisma.dataTable.create({ data: asData(s.row) });
      const rows = s.children?.rows ?? [];
      if (rows.length) await prisma.dataTableRow.createMany({ data: asData(rows), skipDuplicates: true });
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

  // A Task. Snapshot the item + its whole subtask subtree; the live delete
  // cascades the subtasks (Item.parentItem onDelete: Cascade), so restore
  // rebuilds the root then its descendants parents-first.
  item: {
    capture: async (id) => {
      const row = await prisma.item.findUnique({ where: { id } });
      if (!row) return null;
      const subtasks = await captureItemSubtree(id);
      return { label: row.title || "Untitled task", snapshot: { row, children: { subtasks } } };
    },
    restore: async (s) => {
      await createItemsParentsFirst([s.row, ...(s.children?.subtasks ?? [])]);
    },
  },

  // A List (Board). Deleting cascades its Items/Views/BoardMembers, so we
  // snapshot all three, then delete just the board.
  board: {
    capture: async (id) => {
      const row = await prisma.board.findUnique({ where: { id } });
      if (!row) return null;
      const bundle = await captureBoardBundle([id]);
      return { label: row.name || "Untitled list", snapshot: { row, children: bundle } };
    },
    restore: async (s) => {
      await prisma.board.create({ data: asData(s.row) });
      await restoreBoardChildren(s);
    },
  },

  // A Folder + the boards it holds. Board.folder is onDelete:SetNull, so the
  // live delete (in moveToTrash) removes the boards explicitly in a transaction.
  folder: {
    capture: async (id) => {
      const row = await prisma.folder.findUnique({ where: { id } });
      if (!row) return null;
      const boards = await prisma.board.findMany({ where: { folderId: id } });
      const bundle = await captureBoardBundle(boards.map((b) => b.id));
      return {
        label: row.name || "Untitled folder",
        snapshot: { row, children: { boards: boards as unknown as Row[], ...bundle } },
      };
    },
    restore: async (s) => {
      await prisma.folder.create({ data: asData(s.row) });
      const boards = s.children?.boards ?? [];
      if (boards.length) await prisma.board.createMany({ data: asData(boards), skipDuplicates: true });
      await restoreBoardChildren(s);
    },
  },

  // A whole Space — folders + boards + all their children. Mirrors deleteSpace
  // (src/lib/space.ts) but snapshots first so it's recoverable.
  space: {
    capture: async (id) => {
      const row = await prisma.space.findUnique({ where: { id } });
      if (!row) return null;
      const [folders, boards] = await Promise.all([
        prisma.folder.findMany({ where: { spaceId: id } }),
        prisma.board.findMany({ where: { spaceId: id } }),
      ]);
      const bundle = await captureBoardBundle(boards.map((b) => b.id));
      return {
        label: row.name || "Untitled space",
        snapshot: {
          row,
          children: { folders: folders as unknown as Row[], boards: boards as unknown as Row[], ...bundle },
        },
      };
    },
    restore: async (s) => {
      await prisma.space.create({ data: asData(s.row) });
      const folders = s.children?.folders ?? [];
      if (folders.length) await createFoldersParentsFirst(folders); // folders can nest
      const boards = s.children?.boards ?? [];
      if (boards.length) await prisma.board.createMany({ data: asData(boards), skipDuplicates: true });
      await restoreBoardChildren(s);
    },
  },
};

// Snapshot the row (+ children) into TrashItem and delete it from its table.
// Returns false if the row no longer exists.
export async function moveToTrash(
  type: TrashType, id: string,
  ctx: { organizationId: string; userId?: string | null; userName?: string | null },
): Promise<boolean> {
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
    case "table": await prisma.dataTable.delete({ where: { id } }); break;
    case "file": await prisma.fileEntry.delete({ where: { id } }); break;
    case "policy": await prisma.policy.delete({ where: { id } }); break;
    case "contract": await prisma.agreement.delete({ where: { id } }); break;
    // Item + Board cascade their children (subtasks / items+views+members).
    case "item": await prisma.item.delete({ where: { id } }); break;
    case "board": await prisma.board.delete({ where: { id } }); break;
    // Folder: boards reference folderId with onDelete:SetNull, so drop them
    // explicitly (their own children cascade) then the folder row.
    case "folder":
      await prisma.$transaction(async (tx) => {
        await tx.board.deleteMany({ where: { folderId: id } });
        await tx.folder.delete({ where: { id } });
      });
      break;
    // Space: boards + folders reference spaceId (SetNull / Cascade); mirror
    // deleteSpace — remove boards + folders first, then the space.
    case "space":
      await prisma.$transaction(async (tx) => {
        await tx.board.deleteMany({ where: { spaceId: id } });
        await tx.folder.deleteMany({ where: { spaceId: id } });
        await tx.space.delete({ where: { id } });
      });
      break;
  }
  return true;
}

// Re-create the row from its snapshot and remove the TrashItem.
export async function restoreFromTrash(item: { id: string; entityType: string; snapshot: unknown }): Promise<void> {
  const type = item.entityType as TrashType;
  const entry = REGISTRY[type];
  if (!entry) return;
  await entry.restore(item.snapshot as Snapshot);
  await prisma.trashItem.delete({ where: { id: item.id } });
}

// Permanently delete trash older than 60 days for an org, freeing file blobs.
export async function purgeExpiredTrash(organizationId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  // Free blobs for expiring files first (snapshot holds the url).
  const expiringFiles = await prisma.trashItem.findMany({
    where: { organizationId, deletedAt: { lt: cutoff }, entityType: "file" },
    select: { entityType: true, snapshot: true },
  });
  for (const it of expiringFiles) await freeTrashStorage(it.entityType, it.snapshot);
  await prisma.trashItem.deleteMany({ where: { organizationId, deletedAt: { lt: cutoff } } });
}
