// What scripts/rotate-secrets-key.ts would do, worked out before it does it:
// for every sealed cell of every column in SEALED_COLUMNS
// (src/lib/connectors/seal.ts), whether it already opens with the new key,
// opens only with the old one (and so moves), holds nothing (a nullable
// column left empty), or opens with neither. Pure, so its counting is tested
// (rotation-plan.test.ts) without a database: a column the script forgot to
// count would leave its secrets on a key that is about to be deleted. The
// paging that reads each column (readColumnCells) is here too, given the
// model's findMany, so a page boundary that moves under it is tested the same
// way.

import { SEALED_COLUMNS } from "../../src/lib/connectors/seal";
import { decryptSecretWith } from "../../src/lib/secrets-crypto";

/** One sealed value: the model and field it lives in, its row, and the blob as read. */
export interface SealedCell {
  model: string;
  column: string;
  id: string;
  blob: unknown;
}

export interface ColumnCounts {
  model: string;
  column: string;
  rows: number;
  onNew: number;
  onOld: number;
  /** A nullable column holding nothing: there is no secret to move. */
  empty: number;
  unreadable: number;
}

export interface RotationPlan {
  /** Every SEALED_COLUMNS entry, in its order, counted even when it has no rows. */
  columns: ColumnCounts[];
  /** The cells to re-seal, with what they hold. */
  moves: Array<{ cell: SealedCell; plain: string }>;
  unreadable: SealedCell[];
  /** Some secret already opens with the new key: the running app holds it (step 1b). */
  anyOnNew: boolean;
  /** Cells holding a secret, and how many of them are on the new key already. */
  total: number;
  onNew: number;
}

/** The one read this file pages a column with: a Prisma model's findMany. */
export type FindPage = (args: { select: Record<string, boolean>; where?: { id: { gt: string } }; orderBy: { id: "asc" }; take: number }) => Promise<Array<Record<string, unknown>>>;

/**
 * Every cell of one sealed column, page by page: ids after the last one read,
 * in id order (review of step 2). Never Prisma's `cursor` with `skip`: that
 * reads the cursor row itself first, so when the last row of a page is
 * deleted before the next read (a disconnect, a used connect, a revoke
 * drained) the next page comes back empty, the scan stops there, and the rest
 * of the column is never counted, while the run says every secret is on the
 * new key.
 */
export async function readColumnCells(c: { model: string; column: string }, findMany: FindPage, pageSize: number): Promise<SealedCell[]> {
  const cells: SealedCell[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await findMany({
      select: { id: true, [c.column]: true },
      ...(after ? { where: { id: { gt: after } } } : {}),
      orderBy: { id: "asc" },
      take: pageSize,
    });
    for (const r of page) cells.push({ model: c.model, column: c.column, id: String(r.id), blob: r[c.column] ?? null });
    if (page.length < pageSize) break;
    after = String(page[page.length - 1].id);
  }
  return cells;
}

/** What a blob opens to with this key, or null. */
export function opensWith(blob: unknown, key: string): string | null {
  if (!key) return null;
  try {
    return decryptSecretWith(blob, key);
  } catch {
    return null;
  }
}

/** The plan for these cells. A cell of a column SEALED_COLUMNS does not list is a mistake in the caller, and throws. */
export function planRotation(cells: readonly SealedCell[], keys: { newKey: string; oldKey?: string | null }): RotationPlan {
  const columns: ColumnCounts[] = SEALED_COLUMNS.map((c) => ({ model: c.model, column: c.column, rows: 0, onNew: 0, onOld: 0, empty: 0, unreadable: 0 }));
  const indexOf = new Map(SEALED_COLUMNS.map((c, i) => [`${c.model}.${c.column}`, i]));
  const moves: RotationPlan["moves"] = [];
  const unreadable: SealedCell[] = [];
  for (const cell of cells) {
    const i = indexOf.get(`${cell.model}.${cell.column}`);
    if (i === undefined) throw new Error(`${cell.model}.${cell.column} is not in SEALED_COLUMNS.`);
    const counts = columns[i];
    counts.rows += 1;
    if (cell.blob === null || cell.blob === undefined) {
      if (SEALED_COLUMNS[i].nullable) {
        counts.empty += 1;
        continue;
      }
      counts.unreadable += 1;
      unreadable.push(cell);
      continue;
    }
    if (opensWith(cell.blob, keys.newKey) !== null) {
      counts.onNew += 1;
      continue;
    }
    const plain = keys.oldKey ? opensWith(cell.blob, keys.oldKey) : null;
    if (plain === null) {
      counts.unreadable += 1;
      unreadable.push(cell);
      continue;
    }
    counts.onOld += 1;
    moves.push({ cell, plain });
  }
  const onNew = columns.reduce((n, c) => n + c.onNew, 0);
  const total = columns.reduce((n, c) => n + c.rows - c.empty, 0);
  return { columns, moves, unreadable, anyOnNew: onNew > 0, total, onNew };
}
