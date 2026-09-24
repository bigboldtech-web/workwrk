// GET  /api/forms              list forms in this org (with response counts)
//      With any list-page param (?view=all|mine|shared|favorites, q, goesTo=
//      list:{id}|table:{id}|none, owner, status=open|closed|needs-destination,
//      public=on|off, updatedFrom, updatedTo, sort=updated|name|responses|owner,
//      dir, cursor, limit): the paged envelope the /forms page reads,
//      { data, total, nextCursor, counts }, each row carrying destination
//      { kind, id, name, href }, owner, status, hasPublicLink, isFavorite,
//      responseCount and canManage. Without one, the bare array every older
//      caller (the sidebar, the board Form view picker, the doc block) reads.
// POST /api/forms              create a form { name?, fields?, targetBoardId?, targetTableId?, fieldMappings? }
//      A Guest lists only the forms they made (GET, both shapes).
//      A blank or absent name is "Untitled form" (every create door is promptless).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { getEffectivePreferences } from "@/lib/preferences";
import { viewerFromSession } from "@/lib/access/viewer";
import { canManageObject } from "@/lib/object-manage";
import {
  countListViews, formGoesTo, formStatus, matchesListFilters, matchesListView, parseFormsListQuery, slicePage, sortListRows,
  type ListCandidate,
} from "@/lib/tables-forms-list";
import { validFieldMappingsInput } from "@/lib/forms/fields";
import { PRIVATE_DESTINATION_NAME, readableDestinationIds } from "@/lib/table-gate";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  // A Guest has no share path to a form while the access engine is inert
  // (forms app rule: Guests see shared forms only), so the one set of forms a
  // Guest may list is the ones they made themselves (creator Full access,
  // access 3.3). Everyone else lists the org, as before.
  const viewer = await viewerFromSession().catch(() => null);
  const guestOnly = viewer?.orgRole === "GUEST" ? viewer.userId : null;
  const scope = guestOnly ? { organizationId: orgId, createdById: guestOnly } : { organizationId: orgId };

  const listQuery = parseFormsListQuery(new URL(req.url).searchParams);
  if (listQuery.paged) return pagedList(listQuery, { orgId, userId: getUserId(session), session, scope });

  const forms = await prisma.formDefinition.findMany({
    where: scope,
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { submissions: true } },
    },
  });

  // Decorate with submissionCount at top level so block embed can read it directly.
  return jsonSuccess(forms.map((f: typeof forms[number]) => ({ ...f, submissionCount: f._count.submissions })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("body required");
  if ("name" in body && body.name !== null && typeof body.name !== "string") return jsonError("name must be text");

  const name = (typeof body.name === "string" ? body.name.trim().slice(0, 200) : "") || "Untitled form";
  const description = typeof body.description === "string" ? body.description.slice(0, 2000) : null;
  const fields = Array.isArray(body.fields) ? body.fields : [];
  // A new form is always private. Its public link is turned on in the builder,
  // by its creator or an admin, behind the confirm and with the audit row
  // (PATCH /api/forms/[id]); no product surface ever created a public form in
  // one call, so a body's isPublic is ignored here rather than skipping both.
  const isPublic = false;
  const targetBoardId = typeof body.targetBoardId === "string" && body.targetBoardId ? body.targetBoardId : null;
  const targetTableId = typeof body.targetTableId === "string" && body.targetTableId ? body.targetTableId : null;
  // "From a List..." sends the mapping of each mirrored field to its List
  // field; any other shape is refused rather than stored.
  let fieldMappings: { board?: Record<string, string>; table?: Record<string, string> } | undefined;
  if (body.fieldMappings !== undefined && body.fieldMappings !== null) {
    const fm = validFieldMappingsInput(body.fieldMappings);
    if (!fm) return jsonError("fieldMappings must be { board?: { fieldId: key }, table?: { fieldId: columnId } }");
    fieldMappings = fm;
  }

  const form = await prisma.formDefinition.create({
    data: { organizationId: orgId, name, description, fields, isPublic, targetBoardId, targetTableId, createdById: userId, ...(fieldMappings ? { fieldMappings } : {}) },
  });

  return jsonSuccess(form, 201);
}

type PersonOut = { id: string; firstName: string | null; lastName: string | null; avatar: string | null; email: string | null; name: string | null };

/** The /forms list page: views, filters, sort and cursor pages. */
async function pagedList(q: ReturnType<typeof parseFormsListQuery>, ctx: { orgId: string; userId: string; session: Parameters<typeof readableDestinationIds>[2]; scope: { organizationId: string; createdById?: string } }) {
  const [forms, prefs] = await Promise.all([
    prisma.formDefinition.findMany({
      where: ctx.scope,
      include: { _count: { select: { submissions: true } } },
    }),
    getEffectivePreferences(ctx.userId, ctx.orgId),
  ]);
  const boardIds = [...new Set(forms.map((f) => f.targetBoardId).filter((x): x is string => !!x))];
  const tableIds = [...new Set(forms.map((f) => f.targetTableId).filter((x): x is string => !!x))];
  const ownerIds = [...new Set(forms.map((f) => f.createdById).filter((x): x is string => !!x))];
  const [boards, tables, users] = await Promise.all([
    boardIds.length
      ? prisma.board.findMany({ where: { organizationId: ctx.orgId, id: { in: boardIds } }, select: { id: true, name: true, slug: true, spaceId: true } })
      : Promise.resolve([] as { id: string; name: string; slug: string; spaceId: string | null }[]),
    tableIds.length
      ? prisma.dataTable.findMany({ where: { organizationId: ctx.orgId, id: { in: tableIds } }, select: { id: true, name: true, spaceId: true } })
      : Promise.resolve([] as { id: string; name: string; spaceId: string | null }[]),
    ownerIds.length
      ? prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, firstName: true, lastName: true, avatar: true, email: true } })
      : Promise.resolve([] as { id: string; firstName: string | null; lastName: string | null; avatar: string | null; email: string | null }[]),
  ]);
  // A destination in a Space the viewer cannot open keeps its place (the form
  // still sends there) but not its name or link (lib/forms/destination-reach).
  const reach = await readableDestinationIds({ boards, tables }, ctx.userId, ctx.session);
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const home = prefs.home as { favoriteFormIds?: unknown };
  const favoriteIds = new Set<string>(Array.isArray(home.favoriteFormIds) ? (home.favoriteFormIds as string[]) : []);
  const facts = { userId: ctx.userId, favoriteIds };

  const candidates = forms.map((f) => {
    const board = f.targetBoardId ? boardById.get(f.targetBoardId) : undefined;
    const table = !board && f.targetTableId ? tableById.get(f.targetTableId) : undefined;
    // A destination id whose object is gone reads as "Nowhere yet": the form
    // still takes answers into its own Responses, and the chip says so.
    const destination = board
      ? reach.boards.has(board.id)
        ? { kind: "list" as const, id: board.id, name: board.name, href: `/boards/${board.slug}` as string | null }
        : { kind: "list" as const, id: board.id, name: PRIVATE_DESTINATION_NAME.list, href: null }
      : table
        ? reach.tables.has(table.id)
          ? { kind: "table" as const, id: table.id, name: table.name, href: `/tables/${table.id}` as string | null }
          : { kind: "table" as const, id: table.id, name: PRIVATE_DESTINATION_NAME.table, href: null }
        : null;
    const u = f.createdById ? userById.get(f.createdById) : undefined;
    const ownerName = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "" : "";
    const settings = (f as unknown as { settings?: unknown }).settings;
    const status = formStatus({ targetBoardId: destination?.kind === "list" ? destination.id : null, targetTableId: destination?.kind === "table" ? destination.id : null, settings });
    const row: ListCandidate & { raw: typeof f; destination: typeof destination; owner: PersonOut | null } = {
      id: f.id,
      name: f.name,
      createdById: f.createdById,
      updatedAt: f.updatedAt,
      spaceId: board?.spaceId ?? table?.spaceId ?? null,
      isPublic: f.isPublic,
      ownerName,
      locationName: destination?.name ?? "",
      count: f._count.submissions,
      goesTo: destination ? formGoesTo({ targetBoardId: destination.kind === "list" ? destination.id : null, targetTableId: destination.kind === "table" ? destination.id : null }) : null,
      status,
      raw: f,
      destination,
      owner: u ? { ...u, name: ownerName || null } : null,
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
      destination: r.destination,
      createdById: r.createdById,
      owner: r.owner,
      status: r.status,
      responseCount: r.count ?? 0,
      hasPublicLink: r.isPublic,
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
