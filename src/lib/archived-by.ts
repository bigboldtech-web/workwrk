// Recording WHO archived something, without making the write depend on a
// migration having run first.
//
// `archivedById` ships as prisma/sql/2026-09-19-archived-by.sql, which the
// founder applies by hand. Between the code landing and that file running,
// two things can be behind: the database column, and the generated Prisma
// client inside an already-running process. Either one turns
// `data: { archivedAt, archivedById }` into a thrown error, and on an ARCHIVE
// that is not a degraded column, it is a 500 on a destructive-looking action
// the person just confirmed.
//
// So every archive write goes through here: it tries with the actor, and on
// any failure repeats the write without it. The archive always lands; only the
// attribution is lost, and Trash already renders a missing archiver as a blank
// cell rather than guessing. This also makes the deploy order not matter,
// which is the whole point of the "tolerate a new column being absent for one
// release" rule.
//
// Server-only: the callers are prisma writes.

/** True once a write has proved the column is not usable in this process. */
let columnUnusable = false;

/**
 * Run an archive write with the actor, falling back to the same write without
 * it. `run` receives the extra data fields to merge into its own `data`.
 */
export async function withArchivedBy<T>(
  actorId: string | null | undefined,
  run: (extra: { archivedById?: string | null }) => Promise<T>,
): Promise<T> {
  if (columnUnusable || !actorId) return run({});
  try {
    return await run({ archivedById: actorId });
  } catch {
    columnUnusable = true;
    return run({});
  }
}

/**
 * The other half: clear the attribution when the row comes back to life.
 *
 * A restore that sets `archivedAt = null` and leaves `archivedById` set
 * records a person as the archiver of a row that is not archived. It is
 * invisible today because every reader filters on `archivedAt`, but it is the
 * exact fabricated-attribution shape 2026-09-19-archived-by.sql exists to
 * avoid, and the first reader that prints the name without checking the date
 * inherits the bug. Same tolerance as the write above: if the column is not
 * there, the restore still lands.
 */
export async function clearArchivedBy<T>(
  run: (extra: { archivedById?: string | null }) => Promise<T>,
): Promise<T> {
  if (columnUnusable) return run({});
  try {
    return await run({ archivedById: null });
  } catch {
    columnUnusable = true;
    return run({});
  }
}
