import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager, requirePermission } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { logActivity } from "@/lib/activity";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";
import { sopVisibilityWhere, canWriteToFolder } from "@/lib/sop-access";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const kraId = searchParams.get("kraId");
  const folderId = searchParams.get("folderId"); // "none" = unfoldered, "<id>" = specific folder, null = all-visible
  const pagination = parsePaginationParams(req);

  const where: any = { organizationId: getOrgId(session) };
  if (category) where.category = category;
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

  // Folder scoping — admins see everything; others see unfoldered + their
  // granted folders. An explicit `folderId` param narrows further.
  const visibility = await sopVisibilityWhere(session);
  if (Object.keys(visibility).length > 0) Object.assign(where, visibility);
  if (folderId === "none") {
    where.folderId = null;
  } else if (folderId) {
    where.folderId = folderId;
  }

  const [sops, total] = await Promise.all([
    prisma.sOP.findMany({
      where,
      select: {
        id: true, title: true, description: true, category: true, subcategory: true,
        sopType: true, version: true, status: true, shareToken: true,
        folderId: true,
        createdAt: true, updatedAt: true, publishedAt: true,
        _count: { select: { compliance: true } },
        kra: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true, color: true } },
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
  const { title, description, category, subcategory, content, kraId, sopType, folderId } = body;

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

  const sop = await prisma.sOP.create({
    data: {
      title,
      description,
      category,
      subcategory: subcategory || null,
      sopType: sopType || "WRITTEN",
      content: content || { steps: [] },
      folderId: resolvedFolderId,
      organizationId: getOrgId(session),
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
