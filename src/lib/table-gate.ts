// ONE reader gate for the new /api/tables/[id]/* routes this phase adds
// (duplicate, export, presence), on the TABLE ref.
//
// The same rule every existing table route applies, stated once: a table is
// readable when it is in the viewer's org and, when it sits in a Space, the
// viewer can read that Space (Phase 32b; read implies write for content,
// docs/plans/tables.md 3a); when it sits in no Space, it is org-wide for
// Members and a Guest's own only (lib/table-visibility). Anything else is "not found", never a 403, so a
// table id in a private Space cannot be probed.
//
// WHY THIS IS NOT `requireCan` YET. The access engine under src/lib/access is
// still INERT in Phase 5 (spec-tables-forms section 4 step 1 is blocked on the
// access unit). getSpaceForReader already delegates through parity.ts's one
// transcription, so nothing is flipped here; this file is the single place the
// new table routes read the legacy signal, so the day the engine is switched
// on only this file changes (the item-gate.ts precedent).
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { getSpaceForReader } from "@/lib/space";
import { canReadBoard } from "@/lib/board";
import { unscopedTableVisible } from "@/lib/table-visibility";
import { orgRoleOf } from "@/lib/access/org-role";

/**
 * A table in no Space: org-wide for Members, a Guest's own only
 * (lib/table-visibility). Takes the session's legacy level because every
 * table route still holds one while the engine is inert; a missing level
 * reads as EMPLOYEE, the default every table route already applies.
 */
export function unscopedTableReadable(
  createdById: string | null | undefined,
  userId: string,
  accessLevel: string | null | undefined,
): boolean {
  return unscopedTableVisible(createdById, userId, orgRoleOf({ accessLevel: accessLevel ?? "EMPLOYEE" }));
}

type SessionLike = { user?: unknown } | null | undefined;

/** The table when the session's viewer can read it, else null. */
export async function readableTable(id: string, orgId: string, userId: string, session: SessionLike) {
  const table = await prisma.dataTable.findFirst({ where: { id, organizationId: orgId } });
  if (!table) return null;
  if (table.spaceId) {
    const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "EMPLOYEE";
    if (!(await getSpaceForReader(table.spaceId, userId, accessLevel))) return null;
  } else {
    const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
    if (!unscopedTableReadable(table.createdById, userId, accessLevel)) return null;
  }
  return table;
}

// ── Form destinations (Phase 5 Stage D) ──────────────────────────
// Which of a form's destinations (the List and the table it feeds) the viewer
// may read, so the forms list and the builder never show the name or the link
// of a List or a table in a Space the viewer cannot open: a form feeding a
// table in a private Space used to name that table to every Member. Here and
// not in lib/forms because this file is the one place this phase's routes
// read the legacy signal (see the header); the forms routes pass the session.
//
// The same gates the destinations' own pages use: a List through
// canReadBoard (Space membership, a List grant, a private List's explicit
// grant), a table through readableTable's rule (its Space through
// getSpaceForReader; an unscoped table is org-wide). A destination the viewer
// cannot read is still a destination: the form still sends answers there and
// its status is still "Open", so callers keep it, named
// PRIVATE_DESTINATION_NAME and without a link.

export const PRIVATE_DESTINATION_NAME = { list: "A private List", table: "A private table" } as const;

export async function readableDestinationIds(
  input: { boards: { id: string }[]; tables: { id: string; spaceId: string | null }[] },
  userId: string,
  session: SessionLike,
): Promise<{ boards: Set<string>; tables: Set<string> }> {
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "EMPLOYEE";
  const boardIds = [...new Set(input.boards.map((b) => b.id))];
  const spaceIds = [...new Set(input.tables.map((t) => t.spaceId).filter((s): s is string => !!s))];
  const [boardOk, spaceOk] = await Promise.all([
    Promise.all(boardIds.map((id) => canReadBoard(id, userId, accessLevel).catch(() => false))),
    Promise.all(spaceIds.map((id) => getSpaceForReader(id, userId, accessLevel).then(Boolean).catch(() => false))),
  ]);
  const boards = new Set(boardIds.filter((_, i) => boardOk[i]));
  const spaces = new Set(spaceIds.filter((_, i) => spaceOk[i]));
  const tables = new Set(input.tables.filter((t) => !t.spaceId || spaces.has(t.spaceId)).map((t) => t.id));
  return { boards, tables };
}
