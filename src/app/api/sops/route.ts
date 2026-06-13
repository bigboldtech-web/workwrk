import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager, requirePermission } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { logActivity } from "@/lib/activity";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";
import { sopVisibilityWhere, canWriteToFolder, descendantFolderIds } from "@/lib/sop-access";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  // category semantics:
  //   null / unset       → no narrowing
  //   "__none__"         → category IS NULL (uncategorized)
  //   "<name>"           → category = <name>
  // subcategory semantics:
  //   null / unset       → no narrowing
  //   "__none__"         → subcategory IS NULL (only sensible alongside a category)
  //   "<name>"           → subcategory = <name>
  const category = searchParams.get("category");
  const subcategory = searchParams.get("subcategory");
  const status = searchParams.get("status");
  const kraId = searchParams.get("kraId");
  // folderId semantics:
  //   null / unset       → no folder narrowing (all visible)
  //   "none"             → unfoldered SOPs only
  //   "<id>"             → that folder + every descendant (inclusive)
  const folderId = searchParams.get("folderId");
  // tags: comma-separated list. Match SOPs that have ALL the listed tags
  // (intersection — fits user expectation of progressively narrowing).
  const tagsParam = searchParams.get("tags");
  const pagination = parsePaginationParams(req);

  const where: any = { organizationId: getOrgId(session) };
  if (category === "__none__") where.category = null;
  else if (category) where.category = category;
  if (subcategory === "__none__") where.subcategory = null;
  else if (subcategory) where.subcategory = subcategory;
  if (status) {
    where.status = status;
  } else {
    // By default, exclude archived SOPs from the main listing
    where.status = { not: "ARCHIVED" };
  }
  if (kraId) where.kraId = kraId;
  if (pagination.search) {
    where.AND = [
      {
        OR: [
          { title: { contains: pagination.search, mode: "insensitive" } },
          { description: { contains: pagination.search, mode: "insensitive" } },
        ],
      },
    ];
  }

  if (tagsParam) {
    const tags = tagsParam.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) where.tags = { hasEvery: tags };
  }

  // Folder scoping — admins see everything; others see unfoldered + their
  // granted folders (and descendants). An explicit `folderId` param
  // narrows further: picking "HR" rolls in "HR / Onboarding" too.
  const visibility = await sopVisibilityWhere(session);
  if (Object.keys(visibility).length > 0) Object.assign(where, visibility);
  if (folderId === "none") {
    where.folderId = null;
  } else if (folderId) {
    const ids = await descendantFolderIds(folderId);
    where.folderId = ids.length > 0 ? { in: ids } : folderId;
  }

  const [sops, total] = await Promise.all([
    prisma.sOP.findMany({
      where,
      select: {
        id: true, title: true, description: true, category: true, subcategory: true,
        sopType: true, version: true, status: true, shareToken: true,
        folderId: true, tags: true,
        createdAt: true, updatedAt: true, publishedAt: true,
        _count: { select: { compliance: true } },
        kra: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true, color: true, parentId: true } },
      },
      orderBy: { updatedAt: "desc" },
      ...skipTake(pagination),
    }),
    prisma.sOP.count({ where }),
  ]);

  return jsonSuccess(paginatedResult(sops, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "create");
  if (denied) return denied;

  // Plan limit enforcement
  const planCheck = await checkPlanLimit(getOrgId(session), "sops");
  if (!planCheck.allowed) return jsonError(planCheck.message, 403);

  const body = await req.json();
  const { title: rawTitle, description: rawDescription, category, subcategory, content, kraId, sopType, folderId, tags } = body;

  // Trim before the emptiness check. A leading-space title used to slip
  // past `if (!title)` and create a near-duplicate of an existing SOP
  // (we hit this with "Lead Reallocation Rules" in prod). Same fix
  // applied in PATCH.
  const title = typeof rawTitle === "string" ? rawTitle.trim() : rawTitle;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : rawDescription;

  if (!title) return jsonError("SOP title is required");

  // Validate folder: exists in caller's org AND caller has write access.
  const resolvedFolderId: string | null = folderId || null;
  if (resolvedFolderId) {
    const folder = await prisma.sOPFolder.findFirst({
      where: { id: resolvedFolderId, organizationId: getOrgId(session) },
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

  const sop = await prisma.sOP.create({
    data: {
      title,
      description,
      category,
      subcategory: subcategory || null,
      sopType: sopType || "WRITTEN",
      content: content || { steps: [] },
      folderId: resolvedFolderId,
      tags: cleanTags,
      organizationId: getOrgId(session),
      createdById: getUserId(session),
      ...(kraId ? { kraId } : {}),
    },
  });

  logActivity({
    type: "sop_created",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Created SOP "${title}"`,
    targetId: sop.id,
    targetType: "sop",
    metadata: { category },
  });

  return jsonSuccess(sop, 201);
}
