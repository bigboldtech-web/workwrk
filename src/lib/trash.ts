// Org-wide recycle bin. moveToTrash() snapshots a row (+ essential children)
// into TrashItem, then removes it from its live table — so it disappears from
// every existing list with no query changes. restoreFromTrash() re-creates it
// from the snapshot. Items are purged 60 days after deletion.

import { prisma } from "@/lib/prisma";

export type TrashType = "note" | "sop" | "whiteboard" | "table" | "file" | "policy" | "contract";

export const TRASH_LABEL: Record<TrashType, string> = {
  note: "Note", sop: "SOP", whiteboard: "Whiteboard", table: "Table",
  file: "File", policy: "Policy", contract: "Contract",
};

export const TRASH_HREF: Record<TrashType, string> = {
  note: "/library", sop: "/sops", whiteboard: "/library", table: "/library",
  file: "/library", policy: "/policies", contract: "/agreements",
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

// Permanently delete trash older than 60 days for an org.
export async function purgeExpiredTrash(organizationId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await prisma.trashItem.deleteMany({ where: { organizationId, deletedAt: { lt: cutoff } } });
}
