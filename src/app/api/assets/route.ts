import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, hasPermission, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import {
  ASSET_CONDITIONS, ASSET_TYPES, applyAssetFilters, assetOrderBy, parseAssetFilters, parseAssetPaging, resolveAssetReadScope,
} from "@/lib/assets/asset-query";

// GET /api/assets (spec-tools-misc 2.2)
//
//   ?mine=1            the viewer's own kit (the profile's Assets tab, access
//                      9 assets.viewOwn). Any signed-in Member; no app gate.
//   ?assignedToId=me   the same door, the way the profile tab has always
//                      asked (a Member looking at their own profile).
//   otherwise          the `assets` app key (anyone with reports, the People
//                      team, Admin; a Member without reports gets the same
//                      404 the page gives them), then
//   ?scope=team|all    a manager's report chain, or the org for the People
//                      team and Admin. A manager asking for ?scope=all gets
//                      their team and `scopeStripped: true` (access 5.5
//                      situation 2: the page strips the param and says so).
//   ?status= ?condition= ?type= ?assignedTo= ?warrantyWithin=30|60|90 ?q= ?sort=
//   ?page= ?pageSize=  real paging (100 a page by default, 500 at most), so a
//                      register past a thousand rows is never silently cut.
//
// Response: { assets, total, totalValue, page, pageSize, scope, scopes,
//             scopeStripped, canAdd, canEdit, canAssign, canDelete }.
// `total` and `totalValue` are the server's count and sum over the whole
// filtered set, never the page's length.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const callerId = getUserId(session);
  const { searchParams } = new URL(req.url);
  const assignedToId = searchParams.get("assignedTo") ?? searchParams.get("assignedToId");
  const mine = searchParams.get("mine") === "1" || (assignedToId !== null && assignedToId === callerId);
  const filters = parseAssetFilters(searchParams);
  const { page, pageSize } = parseAssetPaging(searchParams);

  const scope = await resolveAssetReadScope(session, { mine, requestedScope: searchParams.get("scope"), assignedToId });
  if ("error" in scope) return scope.error;
  const where = applyAssetFilters(scope.where, filters);

  const [assets, total, sum] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
      },
      orderBy: assetOrderBy(filters.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.asset.count({ where }),
    prisma.asset.aggregate({ where, _sum: { purchaseCost: true } }),
  ]);

  // The write rights, so the page renders Add, the row menu and the bulk bar
  // only for the people the PATCH and DELETE below accept.
  const [canAdd, canEdit, canAssign, canDelete] = scope.mine
    ? [false, false, false, false]
    : await Promise.all([
        hasPermission(session, "assets", "create"),
        hasPermission(session, "assets", "edit"),
        hasPermission(session, "assets", "assign"),
        hasPermission(session, "assets", "delete"),
      ]);

  return jsonSuccess({
    assets,
    total,
    totalValue: sum._sum.purchaseCost ?? 0,
    page,
    pageSize,
    scope: scope.scope,
    scopes: scope.canSeeAll ? ["team", "all"] : [scope.scope],
    scopeStripped: scope.scopeStripped,
    canAdd, canEdit, canAssign, canDelete,
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "assets", "create");
  if (denied) return denied;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { name, type, brand, model, serialNumber, imeiNumber, purchaseDate, purchaseCost, warrantyExpiry, condition, notes, assignedToId } = body;

  if (!name?.trim() || !type) return jsonError("Name and type are required");
  if (!ASSET_TYPES.has(type)) return jsonError("Invalid asset type");
  if (condition && !ASSET_CONDITIONS.has(condition)) return jsonError("Invalid condition");

  // Cross-org guard: an assignee id must belong to THIS org (the same
  // IDOR lesson as the appraisal letter). Never trust a client-supplied id.
  if (assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assignedToId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!assignee) return jsonError("Assignee not found in your organization", 400);
  }

  const asset = await prisma.asset.create({
    data: {
      name: name.trim(),
      type,
      brand: brand || null,
      model: model || null,
      serialNumber: serialNumber || null,
      imeiNumber: imeiNumber || null,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      purchaseCost: purchaseCost ? parseFloat(purchaseCost) : null,
      warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
      condition: condition || "GOOD",
      notes: notes || null,
      status: assignedToId ? "ASSIGNED" : "AVAILABLE",
      assignedToId: assignedToId || null,
      assignedAt: assignedToId ? new Date() : null,
      organizationId: orgId,
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify if assigned at creation
  if (assignedToId) {
    await prisma.notification.create({
      data: {
        userId: assignedToId,
        type: "asset_assigned",
        title: "Asset Assigned",
        message: `You have been assigned: ${asset.name}${asset.serialNumber ? ` (S/N: ${asset.serialNumber})` : ""}`,
        link: "/people/" + assignedToId,
      },
    });
  }

  // Asset registry mutations feed into IT-compliance reviews; log
  // assignment-at-creation as a separate metadata field for filtering.
  logActivity({
    type: "asset.create",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Registered asset: ${asset.name}${asset.serialNumber ? ` (S/N ${asset.serialNumber})` : ""}`,
    targetId: asset.id,
    targetType: "Asset",
    metadata: { type: asset.type, condition: asset.condition, assignedToId: assignedToId || null },
  });

  return jsonSuccess(asset, 201);
}
