// GET  /api/tables   list tables in this org (with row counts)
//      With any list-page param (?view=all|mine|shared|favorites, q, location,
//      owner, updatedFrom, updatedTo, hasForm=1, sort=updated|name|rows|owner,
//      dir, cursor, limit): the paged envelope the /tables page reads,
//      { data, total, nextCursor, counts }, each row carrying filledRowCount,
//      owner, spaceName, hasPublicLink, isFavorite and canManage. Without one,
//      the bare array every older caller (the sidebar, the relation picker,
//      the form builder, linked attachments) reads, unchanged.
// POST /api/tables   create a table { name?, description?, columns?, spaceId? }
//      With no columns: the ONE canonical seed (spec-tables-forms section 1
//      Naming canon), 26 unnamed columns A to Z and 1,000 blank rows, named
//      "Untitled table" when no name is given. With columns (a CSV import, a
//      pivot result): exactly those columns and no seeded rows.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { visibleSpaceIds } from "@/lib/space";
import { unscopedTableReadable } from "@/lib/table-gate";
import { viewerFromSession } from "@/lib/access/viewer";
import { canManageObject } from "@/lib/object-manage";
import { getEffectivePreferences } from "@/lib/preferences";
import { filledRowCounts } from "@/lib/table-counts";
import {
  countListViews, matchesListFilters, matchesListView, parseTablesListQuery, slicePage, sortListRows,
  type ListCandidate,
} from "@/lib/tables-forms-list";
import { NEW_SHEET_COLUMNS, NEW_SHEET_ROWS, UNTITLED_TABLE_NAME } from "@/lib/sheet-new";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";

  const sp = new URL(req.url).searchParams;
  const listQuery = parseTablesListQuery(sp);
  if (listQuery.paged) return pagedList(listQuery, { orgId, userId, accessLevel });
  const spaceIdParam = sp.get("spaceId"); // "unscoped" → spaceId IS NULL; specific id → scoped; absent → all

  const where: Record<string, unknown> = { organizationId: orgId };
  if (spaceIdParam === "unscoped") where.spaceId = null;
  else if (spaceIdParam) where.spaceId = spaceIdParam;

  const tables = await prisma.dataTable.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { rows: { where: { deletedAt: null } } } } },
  });

  // Phase 32, gate by Space visibility. Unscoped tables (spaceId=null)
  // stay org-wide for Members (a Guest sees only their own); scoped ones return only if the viewer can read the
  // parent Space. Mirrors the Files/Whiteboards gate from Phase 22.
  const scopedIds = tables.map((t) => t.spaceId).filter((s): s is string => Boolean(s));
  const visible = scopedIds.length > 0
    ? await visibleSpaceIds(scopedIds, userId, accessLevel)
    : new Set<string>();
  // An unscoped table is org-wide for Members and never for a Guest who did
  // not make it (lib/table-visibility).
  const gated = tables.filter((t) =>
    t.spaceId ? visible.has(t.spaceId) : unscopedTableReadable(t.createdById, userId, accessLevel));

  // canManage: may this viewer delete the table or change its public link
  // (its creator or an admin, lib/object-manage). Menus hide those rows
  // for everyone else rather than letting the server refuse them.
  const viewer = await viewerFromSession().catch(() => null);
  // rowCount stays the raw live-row count every older caller reads;
  // filledRowCount is the honest one (the seeded blank rows do not count),
  // and it is what a person is shown.
  const filled = await filledRowCounts(gated.map((t) => t.id));
  return jsonSuccess(gated.map((t) => ({
    ...t, rowCount: t._count.rows, filledRowCount: filled.get(t.id) ?? 0,
    canManage: canManageObject(viewer, t.createdById),
  })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("body required");

  // A name that is given must be text; an absent or blank one is the canon's
  // "Untitled table" (every create door is promptless, the name is edited
  // inline in the title row).
  if ("name" in body && body.name !== null && typeof body.name !== "string") return jsonError("name must be text");
  const name = (typeof body.name === "string" ? body.name.trim().slice(0, 200) : "") || UNTITLED_TABLE_NAME;
  const description = typeof body.description === "string" ? body.description.slice(0, 2000) : null;
  const spaceId = typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
  const seeded = !(Array.isArray(body.columns) && body.columns.length > 0);
  const columns = seeded
    ? Array.from({ length: NEW_SHEET_COLUMNS }, () => ({ id: defaultId(), type: "short_text", label: "" }))
    : body.columns;

  // Cross-tenant safety: spaceId must belong to the caller's org.
  if (spaceId) {
    const space = await prisma.space.findFirst({ where: { id: spaceId, organizationId: orgId }, select: { id: true } });
    if (!space) return jsonError("space not found", 404);
  }

  const table = await prisma.dataTable.create({
    data: { organizationId: orgId, name, description, columns, spaceId, createdById: userId },
  });
  if (seeded) {
    // The 1,000 blank rows, positions 1..1000 on a table that has none yet.
    // A failed seed still returns the table: the grid can add rows, and the
    // table the person just asked for is never lost to a starter-row write.
    await prisma.dataTableRow.createMany({
      data: Array.from({ length: NEW_SHEET_ROWS }, (_, i) => ({
        organizationId: orgId, tableId: table.id, values: {}, position: i + 1, createdById: userId,
      })),
    }).catch(() => undefined);
  }

  void logActivity({
    type: "table.create",
    actorId: userId,
    organizationId: orgId,
    description: `Created table "${table.name}"`,
    targetId: table.id,
    targetType: "DataTable",
  });

  return jsonSuccess(table, 201);
}

function defaultId() { return Math.random().toString(36).slice(2, 10); }

type PersonOut = { id: string; firstName: string | null; lastName: string | null; avatar: string | null; email: string | null; name: string | null };

/** The /tables list page: views, filters, sort and cursor pages over the gated set. */
async function pagedList(
  q: ReturnType<typeof parseTablesListQuery>,
  ctx: { orgId: string; userId: string; accessLevel: string },
) {
  const [tables, prefs, formTargets] = await Promise.all([
    prisma.dataTable.findMany({
      where: { organizationId: ctx.orgId },
      select: { id: true, name: true, description: true, spaceId: true, createdById: true, isPublic: true, updatedAt: true, createdAt: true },
    }),
    getEffectivePreferences(ctx.userId, ctx.orgId),
    prisma.formDefinition.findMany({
      where: { organizationId: ctx.orgId, targetTableId: { not: null } },
      select: { targetTableId: true },
    }),
  ]);
  const scopedIds = [...new Set(tables.map((t) => t.spaceId).filter((s): s is string => Boolean(s)))];
  const visible = scopedIds.length > 0 ? await visibleSpaceIds(scopedIds, ctx.userId, ctx.accessLevel) : new Set<string>();
  const gated = tables.filter((t) =>
    t.spaceId ? visible.has(t.spaceId) : unscopedTableReadable(t.createdById, ctx.userId, ctx.accessLevel));

  const home = prefs.home as { favoriteTableIds?: unknown };
  const favoriteIds = new Set<string>(Array.isArray(home.favoriteTableIds) ? (home.favoriteTableIds as string[]) : []);
  const withForm = new Set(formTargets.map((f) => f.targetTableId).filter((x): x is string => !!x));

  const [counts, users, spaces] = await Promise.all([
    filledRowCounts(gated.map((t) => t.id)),
    (() => {
      const ids = [...new Set(gated.map((t) => t.createdById).filter((x): x is string => !!x))];
      return ids.length
        ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, avatar: true, email: true } })
        : Promise.resolve([] as { id: string; firstName: string | null; lastName: string | null; avatar: string | null; email: string | null }[]);
    })(),
    scopedIds.length
      ? prisma.space.findMany({ where: { organizationId: ctx.orgId, id: { in: scopedIds } }, select: { id: true, name: true, slug: true, icon: true, color: true } })
      : Promise.resolve([] as { id: string; name: string; slug: string; icon: string | null; color: string | null }[]),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const facts = { userId: ctx.userId, favoriteIds };

  const candidates = gated.map((t) => {
    const u = t.createdById ? userById.get(t.createdById) : undefined;
    const ownerName = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "" : "";
    const space = t.spaceId ? spaceById.get(t.spaceId) : undefined;
    const row: ListCandidate & { raw: typeof t; owner: PersonOut | null; space: typeof space } = {
      id: t.id,
      name: t.name,
      createdById: t.createdById,
      updatedAt: t.updatedAt,
      spaceId: t.spaceId,
      isPublic: t.isPublic,
      ownerName,
      locationName: space?.name ?? "",
      count: counts.get(t.id) ?? 0,
      hasForm: withForm.has(t.id),
      raw: t,
      owner: u ? { ...u, name: ownerName || null } : null,
      space,
    };
    return row;
  });

  const filtered = candidates.filter((r) => matchesListView(r, q.view, facts) && matchesListFilters(r, q));
  const sorted = sortListRows(filtered, q.sort, q.dir);
  const { page, nextCursor } = slicePage(sorted, q.cursor, q.limit);
  const viewer = await viewerFromSession().catch(() => null);

  return jsonSuccess({
    data: page.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.raw.description,
      spaceId: r.spaceId,
      spaceName: r.space?.name ?? null,
      space: r.space ? { id: r.space.id, name: r.space.name, slug: r.space.slug, icon: r.space.icon, color: r.space.color } : null,
      createdById: r.createdById,
      owner: r.owner,
      filledRowCount: r.count ?? 0,
      hasPublicLink: r.isPublic,
      hasForm: !!r.hasForm,
      isFavorite: favoriteIds.has(r.id),
      canManage: canManageObject(viewer, r.createdById),
      updatedAt: r.raw.updatedAt,
      createdAt: r.raw.createdAt,
    })),
    total: filtered.length,
    nextCursor,
    counts: countListViews(candidates.filter((r) => matchesListFilters(r, { ...q, view: "all" })), facts),
  });
}
