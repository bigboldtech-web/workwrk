import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager, requirePermission } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { logActivity } from "@/lib/activity";
import { categoryChainFor } from "@/lib/sop-taxonomy";
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

const SOP_TYPES = ["WRITTEN", "CHECKLIST", "RECORDED"] as const;
type SopType = (typeof SOP_TYPES)[number];

// Content `type` tags each sopType may legitimately carry. WRITTEN has
// accumulated several shapes over time ('steps' list, blocks editor,
// richtext HTML, plain body) — all stay valid, and a bare { steps: [] }
// with no type tag (the oldest WRITTEN shape) passes the null-tag path.
// RECORDED accepts both casings ('recorded' from the extension route,
// 'RECORDED' from the legacy screen-recording stub).
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

  // sopType drives which editor opens and how assignments count steps.
  // An invalid value used to 500 at the Prisma enum, and a type/content
  // mismatch (e.g. checklist sections stored on a WRITTEN row) renders
  // as an empty SOP with no recovery path.
  const resolvedType = (sopType ?? "WRITTEN") as SopType;
  if (!SOP_TYPES.includes(resolvedType)) {
    return jsonError(`Invalid sopType "${sopType}". Expected WRITTEN, CHECKLIST, or RECORDED.`);
  }
  const resolvedContent = content || defaultSOPContent(resolvedType);
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

  // One taxonomy: when a folder is supplied, the mirrored category/subcategory
  // strings come from the folder chain, never from the body.
  const chain = resolvedFolderId
    ? await categoryChainFor(getOrgId(session), resolvedFolderId)
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
