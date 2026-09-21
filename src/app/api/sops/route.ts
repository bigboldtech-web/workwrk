import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { logActivity } from "@/lib/activity";
import { categoryChainFor } from "@/lib/sop-taxonomy";
import { parsePaginationParams } from "@/lib/pagination";
import { sopVisibilityWhere, canWriteToFolder, descendantFolderIds } from "@/lib/sop-access";
import { defaultContentForKind, getSopKind, isSopKind, kindWhere, sopTypeForKind, type SopKind } from "@/lib/sop-kind";
import { parseSopsQuery, sopsOrderBy, sopsSearchWhere, viewStatusWhere, type SopsView } from "@/lib/sop-list";

/**
 * GET /api/sops (spec-process section 2 `/sops` Data): the library, server
 * filtered, sorted and paged.
 *
 *   ?view=all|published|drafts|review|archived   the five views (default all)
 *   ?q=            title, description, tag names
 *   ?kind=         written|steps|checklist|recording (derived from sopType + content.type)
 *   ?folderId=     "none" or an id (plus descendants)   ?tags=a,b   ?ownerId=   ?kraId=
 *   ?status=       one status (the Filter panel's row; the view already narrows)
 *   ?assignedToMe=1
 *   ?updatedFrom= ?updatedTo=
 *   ?sort=updated|name|kind|status|owner  ?dir=asc|desc
 *   ?page=  ?pageSize=40|100
 *
 * The older spellings (`category`, `subcategory`, `search`, `limit`) still
 * answer, so nothing that called this route before the refresh breaks.
 *
 * Every row carries `kind`, the `owner` and `assignedCount`, and the envelope
 * carries the real `total` and the per-view `counts` the views row shows.
 * Visibility is `sopVisibilityWhere` (folder grants, own drafts, unfoldered).
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const query = parseSopsQuery(searchParams);
  const legacy = parsePaginationParams(req);
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // Legacy narrowing kept as-is.
  const category = searchParams.get("category");
  const subcategory = searchParams.get("subcategory");

  const and: Record<string, unknown>[] = [];
  const base: Record<string, unknown> = { organizationId: orgId };
  if (category === "__none__") base.category = null;
  else if (category) base.category = category;
  if (subcategory === "__none__") base.subcategory = null;
  else if (subcategory) base.subcategory = subcategory;
  if (query.kraId) base.kraId = query.kraId;
  if (query.ownerId) base.createdById = query.ownerId;
  if (query.tags.length > 0) base.tags = { hasEvery: query.tags };
  if (query.updatedFrom || query.updatedTo) {
    const range: Record<string, Date> = {};
    if (query.updatedFrom) { const d = new Date(query.updatedFrom); if (!Number.isNaN(d.getTime())) range.gte = d; }
    if (query.updatedTo) { const d = new Date(query.updatedTo); if (!Number.isNaN(d.getTime())) range.lte = d; }
    if (Object.keys(range).length) base.updatedAt = range;
  }
  if (query.assignedToMe) base.assignments = { some: { userId } };

  const term = query.q || legacy.search || "";
  const search = sopsSearchWhere(term);
  if (search) and.push(search);
  if (query.kind) and.push(kindWhere(query.kind));

  // Folder scoping: admins see everything; others see unfoldered + granted
  // folders (and descendants). An explicit folderId narrows further.
  const visibility = await sopVisibilityWhere(session);
  if (Object.keys(visibility).length > 0) and.push(visibility);
  if (query.folderId === "none") base.folderId = null;
  else if (query.folderId) {
    const ids = await descendantFolderIds(query.folderId);
    base.folderId = ids.length > 0 ? { in: ids } : query.folderId;
  }

  // The status axis: an explicit ?status= wins, else the view's rule.
  const statusWhere = query.status ? { status: query.status } : viewStatusWhere(query.view);
  const where = { ...base, ...statusWhere, ...(and.length ? { AND: and } : {}) };

  // Page size: the spec's pageSize, or the legacy limit when a caller sends it.
  const pageSize = searchParams.has("pageSize") || !searchParams.has("limit") ? query.pageSize : legacy.limit;
  const page = query.page;

  const select = {
    id: true, title: true, description: true, category: true, subcategory: true,
    sopType: true, content: true, version: true, status: true, shareToken: true,
    folderId: true, tags: true, createdById: true,
    createdAt: true, updatedAt: true, publishedAt: true,
    _count: { select: { compliance: true, assignments: true } },
    kra: { select: { id: true, name: true } },
    folder: { select: { id: true, name: true, color: true, parentId: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
  } as const;

  const countWhere = (v: SopsView) => ({ ...base, ...viewStatusWhere(v), ...(and.length ? { AND: and } : {}) });

  const [rows, total, cAll, cPublished, cDrafts, cReview, cArchived] = await Promise.all([
    prisma.sOP.findMany({ where, select, orderBy: sopsOrderBy(query.sort, query.dir) as never, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.sOP.count({ where }),
    prisma.sOP.count({ where: countWhere("all") }),
    prisma.sOP.count({ where: countWhere("published") }),
    prisma.sOP.count({ where: countWhere("drafts") }),
    prisma.sOP.count({ where: countWhere("review") }),
    prisma.sOP.count({ where: countWhere("archived") }),
  ]);

  const data = rows.map((r) => {
    // `content` is only read to derive the kind; the list never ships bodies.
    const { content, createdBy, _count, ...rest } = r;
    return {
      ...rest,
      kind: getSopKind(r.sopType, content),
      owner: createdBy,
      assignedCount: _count.assignments,
      _count: { compliance: _count.compliance, assignments: _count.assignments },
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return jsonSuccess({
    data,
    pagination: { page, limit: pageSize, total, totalPages, hasMore: page < totalPages },
    counts: { all: cAll, published: cPublished, drafts: cDrafts, review: cReview, archived: cArchived },
  });
}

const SOP_TYPES = ["WRITTEN", "CHECKLIST", "RECORDED"] as const;
type SopType = (typeof SOP_TYPES)[number];

// Content `type` tags each sopType may legitimately carry. WRITTEN has
// accumulated several shapes over time ('steps' list, blocks editor,
// richtext HTML, plain body, process_flow) and all stay valid; a bare
// { steps: [] } with no type tag (the oldest WRITTEN shape) passes the
// null-tag path. RECORDED accepts both casings ('recorded' from the
// extension route, 'RECORDED' from the legacy screen-recording stub).
const CONTENT_TYPES_BY_SOP_TYPE: Record<SopType, ReadonlySet<string>> = {
  WRITTEN: new Set(["steps", "blocks", "WRITTEN", "richtext", "process_flow"]),
  CHECKLIST: new Set(["CHECKLIST"]),
  RECORDED: new Set(["recorded", "RECORDED"]),
};

function defaultSOPContent(type: SopType) {
  if (type === "CHECKLIST") return { type: "CHECKLIST", sections: [] };
  if (type === "RECORDED") return { type: "recorded", steps: [] };
  return { type: "WRITTEN", body: "" };
}

/**
 * POST /api/sops: create a SOP.
 *
 *   { kind, title, folderId?, tags?, content? }   the create routes' shape
 *      (create-on-first-change sends `kind`; the server picks sopType and
 *      the empty content shape for it)
 *   { sopType, title, content, ... }              the older shape, unchanged
 *   { duplicateOf }                               copy an existing SOP the
 *      viewer can read into a new draft ("Untitled" never; the copy is
 *      "{title} (copy)")
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "create");
  if (denied) return denied;

  // Plan limit enforcement
  const planCheck = await checkPlanLimit(getOrgId(session), "sops");
  if (!planCheck.allowed) return jsonError(planCheck.message, 403);

  const body = await req.json();
  const orgId = getOrgId(session);

  if (typeof body?.duplicateOf === "string" && body.duplicateOf) {
    const source = await prisma.sOP.findFirst({
      where: { id: body.duplicateOf, organizationId: orgId, ...(await sopVisibilityWhere(session)) } as never,
    });
    if (!source) return jsonError("SOP not found", 404);
    if (source.folderId && !(await canWriteToFolder(session, source.folderId))) {
      return jsonError("You don't have access to that folder", 403);
    }
    const copy = await prisma.sOP.create({
      data: {
        title: `${source.title} (copy)`,
        description: source.description,
        category: source.category,
        subcategory: source.subcategory,
        sopType: source.sopType,
        content: source.content as never,
        folderId: source.folderId,
        tags: source.tags,
        kraId: source.kraId,
        organizationId: orgId,
        createdById: getUserId(session),
      },
    });
    logActivity({ type: "sop_created", actorId: getUserId(session), organizationId: orgId, description: `Duplicated SOP "${source.title}"`, targetId: copy.id, targetType: "sop" });
    return jsonSuccess(copy, 201);
  }

  const { title: rawTitle, description: rawDescription, category, subcategory, content, kraId, folderId, tags } = body;
  const kind: SopKind | null = isSopKind(body?.kind) ? body.kind : null;

  // Trim before the emptiness check. A leading-space title used to slip
  // past `if (!title)` and create a near-duplicate of an existing SOP
  // (we hit this with "Lead Reallocation Rules" in prod). Same fix
  // applied in PATCH. The create routes send "Untitled SOP" until a title
  // exists, so a row is never nameless.
  const title = typeof rawTitle === "string" ? rawTitle.trim() : rawTitle;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : rawDescription;

  if (!title) return jsonError("SOP title is required");

  // sopType drives which editor opens and how assignments count steps.
  // An invalid value used to 500 at the Prisma enum, and a type/content
  // mismatch (e.g. checklist sections stored on a WRITTEN row) renders
  // as an empty SOP with no recovery path.
  const resolvedType = (kind ? sopTypeForKind(kind) : (body.sopType ?? "WRITTEN")) as SopType;
  if (!SOP_TYPES.includes(resolvedType)) {
    return jsonError(`Invalid sopType "${body.sopType}". Expected WRITTEN, CHECKLIST, or RECORDED.`);
  }
  const resolvedContent = content || (kind ? defaultContentForKind(kind) : defaultSOPContent(resolvedType));
  const contentType =
    typeof resolvedContent === "object" && !Array.isArray(resolvedContent) && typeof (resolvedContent as { type?: unknown }).type === "string"
      ? ((resolvedContent as { type: string }).type)
      : null;
  if (contentType && !CONTENT_TYPES_BY_SOP_TYPE[resolvedType].has(contentType)) {
    return jsonError(`content.type "${contentType}" doesn't match sopType ${resolvedType}. Omit content to get the right empty shape.`);
  }

  // Validate folder: exists in caller's org AND caller has write access.
  const resolvedFolderId: string | null = folderId || null;
  if (resolvedFolderId) {
    const folder = await prisma.sOPFolder.findFirst({
      where: { id: resolvedFolderId, organizationId: orgId },
      select: { id: true },
    });
    if (!folder) return jsonError("Folder not found", 404);
    if (!(await canWriteToFolder(session, resolvedFolderId))) {
      return jsonError("You don't have access to that folder", 403);
    }
  }

  // Tags: trim, dedupe, drop empties, cap length to keep things sane.
  const cleanTags = Array.isArray(tags)
    ? Array.from(new Set(
        tags.map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
            .filter((t: string) => t.length > 0 && t.length <= 40),
      ))
    : [];

  // One taxonomy: when a folder is supplied, the mirrored category/subcategory
  // strings come from the folder chain, never from the body.
  const chain = resolvedFolderId
    ? await categoryChainFor(orgId, resolvedFolderId)
    : { category: category ?? null, subcategory: subcategory || null };

  const sop = await prisma.sOP.create({
    data: {
      title,
      description,
      category: chain.category,
      subcategory: chain.subcategory,
      sopType: resolvedType,
      content: resolvedContent,
      folderId: resolvedFolderId,
      tags: cleanTags,
      organizationId: orgId,
      createdById: getUserId(session),
      ...(kraId ? { kraId } : {}),
    },
  });

  logActivity({
    type: "sop_created",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Created SOP "${title}"`,
    targetId: sop.id,
    targetType: "sop",
    metadata: { category },
  });

  return jsonSuccess({ ...sop, kind: getSopKind(sop.sopType, sop.content) }, 201);
}
