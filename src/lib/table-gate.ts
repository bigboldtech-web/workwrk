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
import { unscopedTableVisible } from "@/lib/table-visibility";
import { orgRoleOf } from "@/lib/access/org-role";
import { nodeCtxFromLevel, nodeRole, nodeRoles, type NodeCtx } from "@/lib/access/node-access";
import { roleAtLeast, type NodeRole } from "@/lib/access/node-rules";

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

/** The node-access context a table route builds from the session it holds. */
export function tableCtx(orgId: string, userId: string, session: SessionLike): NodeCtx {
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;
  return nodeCtxFromLevel(userId, orgId, accessLevel);
}

/**
 * The table and the viewer's role on it when they can read it, else null. The
 * role is node-access R7: a Space member edits (a Can view Space role from
 * this release reads only, R7b), a Space Full holder manages, an unscoped table is org-wide for Members and
 * a Guest's own only, the creator manages with reach, and a TABLE grant
 * opens the table on its own.
 */
export async function readableTableWithRole(id: string, orgId: string, userId: string, session: SessionLike) {
  const table = await prisma.dataTable.findFirst({ where: { id, organizationId: orgId } });
  if (!table) return null;
  const d = await nodeRole(tableCtx(orgId, userId, session), { kind: "table", id });
  if (!roleAtLeast(d.role, "VIEW")) return null;
  return { table, role: d.role as Exclude<NodeRole, "none"> };
}

/**
 * Can this viewer read this table? The one resolver's R7 over the table's own
 * id, for the table routes that load their own select and only need the read
 * gate. A write asks tableRoleFor for Can edit.
 */
export async function tableReadableBy(
  tableId: string,
  orgId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  const d = await nodeRole(nodeCtxFromLevel(userId, orgId, accessLevel), { kind: "table", id: tableId });
  return roleAtLeast(d.role, "VIEW");
}

/** P6: the one sentence a table content write refused below Can edit answers with. */
export const TABLE_EDIT_REFUSAL = "You need Can edit on this table to change it.";

/**
 * The viewer's role on a table they can read, or null when they cannot (the
 * route's 404). A content write (a row, a cell, a column, a view, a restore
 * or purge of a trashed row) needs Can edit on it (node-rules P1, R7b): a
 * Can view role, whether from a Space grant this release wrote or from a
 * table grant, reads only. Rows from before the cutoff and the org-wide reach
 * still give Can edit, so everyone who wrote to a table before still does.
 */
export async function tableRoleFor(
  tableId: string,
  orgId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<Exclude<NodeRole, "none"> | null> {
  const d = await nodeRole(nodeCtxFromLevel(userId, orgId, accessLevel), { kind: "table", id: tableId });
  return roleAtLeast(d.role, "VIEW") ? (d.role as Exclude<NodeRole, "none">) : null;
}

/** The table when the session's viewer can read it, else null. */
export async function readableTable(id: string, orgId: string, userId: string, session: SessionLike) {
  return (await readableTableWithRole(id, orgId, userId, session))?.table ?? null;
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
  orgId?: string,
): Promise<{ boards: Set<string>; tables: Set<string> }> {
  const boardIds = [...new Set(input.boards.map((b) => b.id))];
  const tableIds = [...new Set(input.tables.map((t) => t.id))];
  const boards = new Set<string>();
  const tables = new Set<string>();
  if (boardIds.length === 0 && tableIds.length === 0) return { boards, tables };
  const organizationId = orgId ?? (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!organizationId) return { boards, tables };
  // One world for every destination, never a gate call per id.
  const decisions = await nodeRoles(tableCtx(organizationId, userId, session), [
    ...boardIds.map((id) => ({ kind: "list" as const, id })),
    ...tableIds.map((id) => ({ kind: "table" as const, id })),
  ]).catch(() => new Map());
  for (const id of boardIds) if (roleAtLeast(decisions.get(`list:${id}`)?.role ?? "none", "VIEW")) boards.add(id);
  for (const id of tableIds) if (roleAtLeast(decisions.get(`table:${id}`)?.role ?? "none", "VIEW")) tables.add(id);
  return { boards, tables };
}
