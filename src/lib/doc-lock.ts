// Doc.lockedById / Doc.lockedAt, read and written WITHOUT the generated
// client's knowledge of the columns.
//
// The columns ship as prisma/sql/2026-09-21-doc-lock.sql, which the founder
// applies by hand. Between the code landing and that file running, two
// things can be behind: the database column, and the Prisma client inside an
// already-running process (a `prisma generate` does not reach a server that
// booted before it). A `select: { lockedById: true }` in either state throws,
// and on the doc SAVE path that is a 500 on every keystroke. So the lock is
// read with one raw query and written with one raw statement, each in a
// try/catch: a missing column reads as "not locked" and refuses to write
// with a named 503, and nothing else about a doc changes.
//
// THE INSTANT IS A JS DATE PARAMETER, never NOW(). `lockedAt` is a
// TIMESTAMP(3) without time zone, and Postgres casts NOW() into it as the
// session's local wall clock, which Prisma then reads back as UTC: on a
// database whose session zone is not UTC the stored lock time was off by the
// zone offset. A bound Date parameter is serialised in UTC on both sides.
//
// The same shape as src/lib/archived-by.ts, for the same reason.
//
// Server-only: prisma.

import { prisma } from "@/lib/prisma";

export interface DocLockRow {
  lockedById: string | null;
  lockedAt: Date | null;
}

/**
 * Set when a query proves the columns are not usable in this process, and
 * re-probed a minute later: the migration is applied by hand while the
 * server keeps running, so a permanent latch would keep answering "not
 * locked" and 503 until the next deploy even after the columns exist.
 */
let unusableUntil = 0;
const REPROBE_MS = 60_000;
const unusable = () => Date.now() < unusableUntil;
const markUnusable = () => { unusableUntil = Date.now() + REPROBE_MS; };

export async function readDocLock(docId: string): Promise<DocLockRow | null> {
  const map = await readDocLocks([docId]);
  return map.get(docId) ?? null;
}

/**
 * The lock rows for many docs in one query (the /docs list gates every row's
 * menu on the lock the same way the single GET does). An unlocked doc is
 * absent from the map; a missing column answers an empty map.
 *
 * `= ANY($1::text[])` with the ids as ONE array parameter, never
 * `IN (${Prisma.join(ids)})`: inside the Next server bundle the generated
 * client's `Prisma.join` rendered `?,?` placeholders, so the IN form matched
 * nothing and read every doc as unlocked without throwing.
 */
export async function readDocLocks(docIds: string[]): Promise<Map<string, DocLockRow>> {
  const out = new Map<string, DocLockRow>();
  if (unusable() || docIds.length === 0) return out;
  try {
    const rows = await prisma.$queryRaw<{ id: string; lockedById: string | null; lockedAt: Date | null }[]>`
      SELECT "id", "lockedById", "lockedAt" FROM "Doc" WHERE "id" = ANY(${docIds}::text[]) AND "lockedById" IS NOT NULL
    `;
    for (const row of rows) out.set(row.id, { lockedById: row.lockedById ?? null, lockedAt: row.lockedAt ?? null });
    return out;
  } catch {
    markUnusable();
    return out;
  }
}

/** Returns false when the columns are not there yet (the caller answers 503). */
export async function writeDocLock(docId: string, lockedById: string | null): Promise<boolean> {
  if (unusable()) return false;
  try {
    if (lockedById) {
      const at = new Date();
      await prisma.$executeRaw`UPDATE "Doc" SET "lockedById" = ${lockedById}, "lockedAt" = ${at} WHERE "id" = ${docId}`;
    } else {
      await prisma.$executeRaw`UPDATE "Doc" SET "lockedById" = NULL, "lockedAt" = NULL WHERE "id" = ${docId}`;
    }
    return true;
  } catch {
    markUnusable();
    return false;
  }
}
