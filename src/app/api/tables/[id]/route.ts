// GET    /api/tables/[id]   table + row count + canManage (may the viewer delete it or change its public link) + publicLinksAllowed (toggle 10)
// PATCH  /api/tables/[id]   update name / description / columns / views / settings; isPublic and spaceId (Move to Space) only for its creator or an admin
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
import { moveToTrash } from "@/lib/trash";
import {
  getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { readableTableWithRole, tableCtx } from "@/lib/table-gate";
import { MANAGE_REFUSAL } from "@/lib/object-manage";
import { logAuditEvent } from "@/lib/activity";
import { orgPublicLinksAllowed } from "@/lib/public-links";
import { moveAllowed } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

// The gate is the one resolver's table rule (R7, lib/table-gate
// readableTableWithRole): hide existence (404, not 403) so viewers can't
// probe for table ids in Spaces they shouldn't see. Full access on the table
// (its creator with reach, a Full holder of its Space, an org admin, a Full
// table grant) deletes it and changes its public link; a move needs the
// creator with reach or an org admin, never a table grant (M3).

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
  }
  // Move to Space (the row menu's Move to Space..., the File menu's). Moving
  // changes who can open the table, so it is the same people who may change
  // its public link: the creator or an Owner or Admin. null = No Space. The
  // target Space must be in this org and readable by the mover.
  if ("spaceId" in body && body.spaceId !== existing.spaceId) {
    const next = typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
    if (next !== existing.spaceId) {
      if (next) {
        const inOrg = await prisma.space.findFirst({ where: { id: next, organizationId: orgId }, select: { id: true } });
        if (!inOrg) return jsonError("space not found", 404);
      }
      const dest = next ? { kind: "space" as const, id: next } : { kind: "none" as const };
      if (!(await moveAllowed(tableCtx(orgId, getUserId(session), session), { kind: "table", id }, dest))) {
        return jsonError(MANAGE_REFUSAL.move, 403);
      }
      data.spaceId = next;
    }
  }
  // Sheet settings bucket (named ranges, etc.), a plain object, replaced whole.
  if (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
    data.settings = body.settings;
  }

  const updated = await prisma.dataTable.update({ where: { id }, data });
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
  return jsonSuccess(updated);
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
