// What scripts/rotate-secrets-key.ts would do, worked out before it does it:
// for every sealed cell of every column in SEALED_COLUMNS
// (src/lib/connectors/seal.ts), whether it already opens with the new key,
// opens only with the old one (and so moves), holds nothing (a nullable
// column left empty), or opens with neither. Pure, so its counting is tested
// (rotation-plan.test.ts) without a database: a column the script forgot to
// count would leave its secrets on a key that is about to be deleted.

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
