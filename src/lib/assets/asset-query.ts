// The one reader behind GET /api/assets, GET /api/assets/[id] and
// GET /api/export/assets (spec-tools-misc 2.2): who may see which rows, and
// how the list filters and sorts. One function, so the register, the drawer
// deep link and the CSV can never disagree about scope.
//
//   own    a Member reads the kit they hold (access 9 assets.viewOwn):
//          ?mine=1, ?assignedToId=<their id>, or a single asset they hold.
//          Any signed-in person; no app gate.
//   team   the `assets` app key (anyone with reports, the People team,
//          Admin), narrowed to the caller's report chain (self included).
//   all    the People team and Admin: the whole org.
//
// The single-asset read used to skip all of this: any signed-in Member could
// read any asset in the org by id, serial, IMEI and purchase cost included,
// while the list route 404'd for them. Now both answer through here.

import type { Session } from "next-auth";
import { getOrgId, getUserId } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";
import { requireApp, isOwnerOrAdmin } from "@/lib/app-gate";
import { hydrate } from "@/lib/access/viewer";
import type { Viewer } from "@/lib/access/types";
import type { NextResponse } from "next/server";
import type { Prisma, AssetStatus, AssetType, AssetCondition } from "@/generated/prisma";
import { ASSET_PAGE_DEFAULT, ASSET_PAGE_SIZES, parseAssetSort, parseWarrantyWindow, resolveAssetScope, type AssetSort } from "./asset-view";

export const ASSET_TYPES = new Set(["LAPTOP", "DESKTOP", "MONITOR", "PHONE", "TABLET", "KEYBOARD", "MOUSE", "HEADSET", "WEBCAM", "CHAIR", "DESK", "ID_CARD", "ACCESS_CARD", "VEHICLE", "OTHER"]);
export const ASSET_CONDITIONS = new Set(["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"]);
export const ASSET_STATUSES = new Set(["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"]);

export { ASSET_PAGE_SIZES, ASSET_PAGE_DEFAULT };

export type AssetReadScope =
  | { error: NextResponse }
  | {
      mine: true;
      scope: "own";
      scopeStripped: false;
      viewer: null;
      /** The where-clause narrowing rows to what the caller may read. */
      where: Prisma.AssetWhereInput;
      canSeeAll: false;
    }
  | {
      mine: false;
      scope: "team" | "all";
      scopeStripped: boolean;
      viewer: Viewer;
      where: Prisma.AssetWhereInput;
      canSeeAll: boolean;
    };

/**
 * Who the caller is to the register, and the where-clause that keeps them
 * inside it. `assignedToId` is the ?assignedTo= filter (it narrows WITHIN the
 * scope, never widens it); `mine` is the own-kit door.
 */
export async function resolveAssetReadScope(
  session: Session,
  opts: { mine: boolean; requestedScope: string | null; assignedToId: string | null },
): Promise<AssetReadScope> {
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  if (opts.mine) {
    return { mine: true, scope: "own", scopeStripped: false, viewer: null, where: { organizationId: orgId, assignedToId: callerId }, canSeeAll: false };
  }
  const gate = await requireApp("assets");
  if ("error" in gate) return { error: gate.error };
  const viewer = await hydrate(gate.viewer, session as object);
  const canSeeAll = isOwnerOrAdmin(viewer) || viewer.peopleTeam === true;
  const resolved = resolveAssetScope(opts.requestedScope, canSeeAll);
  const where: Prisma.AssetWhereInput = { organizationId: orgId };
  if (resolved.scope === "team") {
    const userIds = [...new Set([callerId, ...(await getTeamUserIds(orgId, callerId))])];
    where.assignedToId = opts.assignedToId
      ? (userIds.includes(opts.assignedToId) ? opts.assignedToId : { in: [] })
      : { in: userIds };
  } else if (opts.assignedToId) {
    where.assignedToId = opts.assignedToId === "unassigned" ? null : opts.assignedToId;
  }
  return { mine: false, scope: resolved.scope, scopeStripped: resolved.stripped, viewer, where, canSeeAll };
}

export interface AssetListFilters {
  status: string | null;
  condition: string | null;
  type: string | null;
  warrantyWithin: number | null;
  q: string;
  sort: AssetSort;
}

/** The filter part of the URL, parsed once for the list and the export. */
export function parseAssetFilters(sp: URLSearchParams): AssetListFilters {
  return {
    status: sp.get("status"),
    condition: sp.get("condition"),
    type: sp.get("type"),
    warrantyWithin: parseWarrantyWindow(sp.get("warrantyWithin")),
    // ?q= is the row search; ?search= stays as its alias.
    q: (sp.get("q") ?? sp.get("search") ?? "").trim().slice(0, 200),
    sort: parseAssetSort(sp.get("sort")),
  };
}

/** Adds the filters to a scope where-clause (mutates and returns it). */
export function applyAssetFilters(where: Prisma.AssetWhereInput, f: AssetListFilters): Prisma.AssetWhereInput {
  if (f.status && ASSET_STATUSES.has(f.status)) where.status = f.status as AssetStatus;
  if (f.condition && ASSET_CONDITIONS.has(f.condition)) where.condition = f.condition as AssetCondition;
  if (f.type && ASSET_TYPES.has(f.type)) where.type = f.type as AssetType;
  if (f.warrantyWithin) {
    where.warrantyExpiry = { gte: new Date(), lte: new Date(Date.now() + f.warrantyWithin * 86_400_000) };
  }
  if (f.q) {
    where.OR = [
      { name: { contains: f.q, mode: "insensitive" } },
      { brand: { contains: f.q, mode: "insensitive" } },
      { model: { contains: f.q, mode: "insensitive" } },
      { serialNumber: { contains: f.q, mode: "insensitive" } },
      { imeiNumber: { contains: f.q, mode: "insensitive" } },
    ];
  }
  return where;
}

export function assetOrderBy(sort: AssetSort): Prisma.AssetOrderByWithRelationInput[] {
  return sort === "name" ? [{ name: "asc" }]
    : sort === "purchase" ? [{ purchaseDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
    : sort === "warranty" ? [{ warrantyExpiry: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
    : sort === "value" ? [{ purchaseCost: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
    : [{ createdAt: "desc" }];
}

/** ?page= (1-based) and ?pageSize= from the URL, clamped. */
export function parseAssetPaging(sp: URLSearchParams): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
  const raw = Math.floor(Number(sp.get("pageSize")) || ASSET_PAGE_DEFAULT);
  const pageSize = (ASSET_PAGE_SIZES as readonly number[]).includes(raw) ? raw : ASSET_PAGE_DEFAULT;
  return { page, pageSize };
}
