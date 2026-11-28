// GET    /api/tables/[id]   table + row count + canManage (may the viewer delete it or change its public link) + publicLinksAllowed (toggle 10)
// PATCH  /api/tables/[id]   update name / description / columns / views / settings; isPublic for Full access; spaceId (Move to Space) under the placement rule
// DELETE /api/tables/[id]   move to the one Trash (rows are snapshotted with it); only its creator or an admin
//
// Phase 5 gates (spec-tables-forms section 3 ask 1, section 4 step 1, with the
// access engine still inert): DELETE and a change to isPublic need the
// table's creator or an Owner or Admin (lib/object-manage.ts), and a public
// link change writes an audit row. Everything else a reader of the Space could
// do yesterday they can still do: read implies write stays the rule for
// content (docs/plans/tables.md 3a) until the engine lands Can view.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { tablePublicRef } from "@/lib/tables/public-link";
import { moveToTrash } from "@/lib/trash";
import {
  getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { TABLE_EDIT_REFUSAL, readableTableWithRole, tableCtx } from "@/lib/table-gate";
import { MANAGE_REFUSAL } from "@/lib/object-manage";
import { logAuditEvent } from "@/lib/activity";
import type { Prisma } from "@/generated/prisma";
import { orgPublicLinksAllowed } from "@/lib/public-links";
import { checkMove, resolvePlacement } from "@/lib/access/node-placement";
import { roleAtLeast } from "@/lib/access/node-rules";

// The gate is the one resolver's table rule (R7, lib/table-gate
// readableTableWithRole): hide existence (404, not 403) so viewers can't
// probe for table ids in Spaces they shouldn't see. Full access on the table
// (its creator with reach, a Full holder of its Space, an org admin, a Full
// table grant) deletes it and changes its public link; a move is the
// placement rule's (node-rules P2): Full access on the table and on the Space
// it leaves, Can edit where it goes, never from a table grant alone (M3).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { rows: { where: { deletedAt: null } } } } },
  });
  if (!table) return jsonError("not found", 404);
  const gate = await readableTableWithRole(id, orgId, getUserId(session), session);
  if (!gate) return jsonError("not found", 404);

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  // publicLinksAllowed: the org's toggle 10 (lib/public-links), which decides
  // whether the Share dialog's Public link row exists at all.
  return jsonSuccess({
    ...table,
    rowCount: table._count.rows,
    canManage: roleAtLeast(gate.role, "FULL"),
    // The public link's address (pen test V-30: the id and its signature),
    // for the people who manage the link; nobody else needs to copy it.
    publicRef: table.isPublic && roleAtLeast(gate.role, "FULL") ? tablePublicRef(table) : null,
    // Can view reads only (R7b): the grid shows a read only table.
    canEdit: roleAtLeast(gate.role, "EDIT"),
    publicLinksAllowed: orgPublicLinksAllowed(org?.settings),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.dataTable.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);
  const gate = await readableTableWithRole(id, orgId, getUserId(session), session);
  if (!gate) return jsonError("not found", 404);

  // A change to the table's content (its name, description, columns, views
  // or sheet settings) is a write: Can edit on the table (R7b), never Can
  // view. The public link and a move keep their own, higher gates below.
  const writesContent = typeof body.name === "string" || typeof body.description === "string" || body.description === null
    || Array.isArray(body.columns) || Array.isArray(body.views) || (!!body.settings && typeof body.settings === "object");
  if (writesContent && !roleAtLeast(gate.role, "EDIT")) return jsonError(TABLE_EDIT_REFUSAL, 403);

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 200);
  if (typeof body.description === "string" || body.description === null) data.description = body.description?.slice?.(0, 2000) ?? null;
  if (Array.isArray(body.columns)) data.columns = body.columns;
  if (Array.isArray(body.views)) data.views = body.views;
  // The public link: only its creator or an admin may CHANGE it. A PATCH that
  // repeats the current value (an old client sending the whole table) is not
  // a change and is not refused.
  let publicChange: boolean | null = null;
  if (typeof body.isPublic === "boolean" && body.isPublic !== existing.isPublic) {
    if (!roleAtLeast(gate.role, "FULL")) return jsonError(MANAGE_REFUSAL.publish, 403);
    data.isPublic = body.isPublic;
    publicChange = body.isPublic;
    // Each time the link is turned on it is a NEW link (pen test V-30): the
    // generation it is signed with goes up, so a link from before stops working.
    if (body.isPublic) data.publicEpoch = (existing.publicEpoch ?? 0) + 1;
  }
  // Reset the link: a new one while it stays on, every older one ended. A
  // table made public before V-30 moves from its bare-id link to a signed one.
  let publicReset = false;
  if (body.resetPublicLink === true) {
    if (!roleAtLeast(gate.role, "FULL")) return jsonError(MANAGE_REFUSAL.publish, 403);
    if (!existing.isPublic) return jsonError("The public link is off. Turn it on to get a new link.", 409);
    data.publicEpoch = (existing.publicEpoch ?? 0) + 1;
    publicReset = true;
  }
  // Move to Space (the row menu's Move to Space..., the File menu's). null =
  // No Space. The placement rule (node-rules P2 and P3) through its one move
  // helper: Full access on the table (never from its own grant alone, M3) and
  // on the Space it leaves, Can edit on the Space it goes to (or the org for
  // No Space), in this org. It is checked here and written with the rest of
  // the patch below, so a refused move writes nothing.
  if ("spaceId" in body && body.spaceId !== existing.spaceId) {
    const next = typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
    if (next !== existing.spaceId) {
      const placed = await resolvePlacement(orgId, { spaceId: next }, { root: true });
      if (!placed.ok) return jsonError(placed.message, placed.status);
      const check = await checkMove(tableCtx(orgId, getUserId(session), session), { kind: "table", id }, placed.spaceId ? { kind: "space", id: placed.spaceId } : null);
      if (!check.ok) return jsonError(check.error, check.status);
      data.spaceId = placed.spaceId;
    }
  }
  // Sheet settings bucket (named ranges, etc.), a plain object, replaced whole.
  if (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
    data.settings = body.settings;
  }

  // THE STRUCTURE GUARD (pen test 2026-11-28, V-18). Columns, views and
  // settings are written whole, and the sheet has no live sync: a tab loaded
  // earlier wrote back its old list on any column action, and the columns,
  // views and named ranges other people had added since were deleted, with
  // 200 for both writers. The editor now sends `expect`, the value of each
  // key as it last saw it from the server; the write lands only while the
  // stored value still equals it (jsonb equality, so key order never
  // matters), in the same statement, so of two saves at once one gets the
  // 409 with the table as it is now, which the editor shows and adopts. A
  // client that sends no `expect` writes as before.
  const expect = body.expect && typeof body.expect === "object" && !Array.isArray(body.expect) ? (body.expect as Record<string, unknown>) : null;
  const guard: Prisma.DataTableWhereInput = {};
  if (expect) {
    if (data.columns !== undefined && Array.isArray(expect.columns)) guard.columns = { equals: expect.columns as Prisma.InputJsonValue };
    if (data.views !== undefined && Array.isArray(expect.views)) guard.views = { equals: expect.views as Prisma.InputJsonValue };
    if (data.settings !== undefined && expect.settings && typeof expect.settings === "object" && !Array.isArray(expect.settings)) {
      guard.settings = { equals: expect.settings as Prisma.InputJsonValue };
    }
  }
  let updated;
  if (Object.keys(guard).length > 0) {
    const { count } = await prisma.dataTable.updateMany({ where: { id, organizationId: orgId, ...guard }, data });
    if (count === 0) {
      const live = await prisma.dataTable.findUnique({ where: { id }, select: { columns: true, views: true, settings: true, updatedAt: true } });
      return Response.json(
        { error: "conflict", message: "Someone else changed this table's columns, views or settings. It now shows their changes; make your change again.", table: live },
        { status: 409 },
      );
    }
    updated = await prisma.dataTable.findUniqueOrThrow({ where: { id } });
  } else {
    updated = await prisma.dataTable.update({ where: { id }, data });
  }
  if (publicReset) {
    void logAuditEvent({
      type: "access.public_link.on",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Reset the public link for table "${existing.name}": the old link no longer opens`,
      targetId: id,
      targetType: "DataTable",
      oldValue: { publicEpoch: existing.publicEpoch },
      newValue: { publicEpoch: data.publicEpoch as number },
    });
  }
  if (publicChange !== null) {
    void logAuditEvent({
      type: publicChange ? "access.public_link.on" : "access.public_link.off",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `${publicChange ? "Turned on" : "Turned off"} the public link for table "${existing.name}"`,
      targetId: id,
      targetType: "DataTable",
      oldValue: { isPublic: existing.isPublic },
      newValue: { isPublic: publicChange },
    });
  }
  return jsonSuccess({ ...updated, publicRef: updated.isPublic && roleAtLeast(gate.role, "FULL") ? tablePublicRef(updated) : null });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.dataTable.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);
  const gate = await readableTableWithRole(id, orgId, getUserId(session), session);
  if (!gate) return jsonError("not found", 404);
  if (!roleAtLeast(gate.role, "FULL")) return jsonError(MANAGE_REFUSAL.delete, 403);

  await moveToTrash("table", id, { organizationId: orgId, userId: getUserId(session), userName: (session.user as { name?: string }).name ?? null });
  return jsonSuccess({ deleted: true });
}
