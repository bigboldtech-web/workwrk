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
import { getSpaceForReader } from "@/lib/space";
import { unscopedTableReadable } from "@/lib/table-gate";
import { viewerFromSession } from "@/lib/access/viewer";
import { canManageObject, MANAGE_REFUSAL } from "@/lib/object-manage";
import { logAuditEvent } from "@/lib/activity";
import { orgPublicLinksAllowed } from "@/lib/public-links";

// Phase 32b, gate scoped tables by their parent Space's visibility.
// Mirrors the Files/Whiteboards/Docs per-row gate from Phase 22b.
// Hide existence (404, not 403) so viewers can't probe for table IDs
// in Spaces they shouldn't see.
// A table in no Space is org-wide for Members; a Guest sees only one they
// made (lib/table-visibility). `createdById` is undefined only for the Move
// to Space target check, where spaceId is never null.
async function checkSpaceVisible(
  spaceId: string | null,
  userId: string,
  accessLevel: string | null | undefined,
  createdById?: string | null,
): Promise<boolean> {
  if (!spaceId) return unscopedTableReadable(createdById, userId, accessLevel);
  const space = await getSpaceForReader(spaceId, userId, accessLevel ?? "EMPLOYEE");
  return Boolean(space);
}

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
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  if (!(await checkSpaceVisible(table.spaceId, getUserId(session), accessLevel, table.createdById))) {
    return jsonError("not found", 404);
  }

  const [viewer, org] = await Promise.all([
    viewerFromSession().catch(() => null),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
  ]);
  // publicLinksAllowed: the org's toggle 10 (lib/public-links), which decides
  // whether the Share dialog's Public link row exists at all.
  return jsonSuccess({
    ...table,
    rowCount: table._count.rows,
    canManage: canManageObject(viewer, table.createdById),
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
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  if (!(await checkSpaceVisible(existing.spaceId, getUserId(session), accessLevel, existing.createdById))) {
    return jsonError("not found", 404);
  }

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
    const viewer = await viewerFromSession().catch(() => null);
    if (!canManageObject(viewer, existing.createdById)) return jsonError(MANAGE_REFUSAL.publish, 403);
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
      const viewer = await viewerFromSession().catch(() => null);
      if (!canManageObject(viewer, existing.createdById)) return jsonError(MANAGE_REFUSAL.move, 403);
      if (next) {
        const inOrg = await prisma.space.findFirst({ where: { id: next, organizationId: orgId }, select: { id: true } });
        if (!inOrg || !(await checkSpaceVisible(next, getUserId(session), accessLevel))) return jsonError("space not found", 404);
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
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  if (!(await checkSpaceVisible(existing.spaceId, getUserId(session), accessLevel, existing.createdById))) {
    return jsonError("not found", 404);
  }

  const viewer = await viewerFromSession().catch(() => null);
  if (!canManageObject(viewer, existing.createdById)) return jsonError(MANAGE_REFUSAL.delete, 403);

  await moveToTrash("table", id, { organizationId: orgId, userId: getUserId(session), userName: (session.user as { name?: string }).name ?? null });
  return jsonSuccess({ deleted: true });
}
