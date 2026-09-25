// Dashboards: the shared gate and helpers for the /api/dashboards routes.
//
// A dashboard is ORG-VISIBLE, like a Whiteboard (the model comment says so),
// and editable by its owner and by an org Owner or Admin. One pinned to a
// Space is visible where the Space is readable; one whose Space no longer
// exists is treated as unpinned (`spaceMissing`), so deleting a Space never
// makes a dashboard vanish. What any card SHOWS is decided per viewer, per
// card (widget-data.ts), never by this gate.
//
// A Space's OVERVIEW widgets are the one row whose id is spaceOverviewId
// (dashboard-access.ts). While its Space exists it is edited by that Space's
// managers (canEditSpace: an org admin, the Space's OWNER or ADMIN) whoever
// created it; its ownerId grants nothing. A legacy row pinned to a Space
// under any other id is an ordinary dashboard.
//
// Guests are refused here, once, for every dashboard and report route
// (requireWorkApp): the same 404 as a missing object.
//
// Server-only: prisma.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import type { Viewer } from "@/lib/access/types";
import { getEffectivePreferences } from "@/lib/preferences";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";
import { isValidTimeZone } from "@/lib/reports/schedule";
import { canEditSpaceFor, spaceForViewer, viewerIsOrgAdmin, type LinkViewer } from "@/lib/list-links-server";
import type { WidgetReader } from "./widget-data";
import { dashboardsAllowedFor, spaceOverviewId } from "./dashboard-access";

export type DashboardRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  widgets: unknown;
  ownerId: string | null;
  archivedAt: Date | null;
  spaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The Work-hub app key every dashboard and report route checks, as
 * /api/me/everything does, plus the member rule: a Guest gets the plain 404
 * a missing object gets, so no route confirms that dashboards exist for them.
 */
export async function requireWorkApp(): Promise<{ viewer: Viewer } | { error: NextResponse }> {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
    if (!dashboardsAllowedFor(viewer.orgRole)) return { error: notFound() };
    return { viewer };
  } catch (e) {
    if (e instanceof AccessError) return { error: NextResponse.json(e.body, { status: e.status }) };
    throw e;
  }
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * The read gate: the row in THIS org (a row in another org answers exactly
 * like a missing one), live unless `archived` is asked for, and, when pinned
 * to a Space that still exists, that Space readable. Null means 404.
 */
export async function readDashboard(
  id: string,
  c: LinkViewer,
  opts: { archived?: boolean } = {},
): Promise<{ row: DashboardRow; spaceMissing: boolean } | null> {
  const row = await prisma.dashboard.findFirst({
    where: { id, organizationId: c.organizationId, archivedAt: opts.archived ? { not: null } : null },
  });
  if (!row) return null;
  if (!row.spaceId) return { row, spaceMissing: false };
  const exists = await prisma.space.findFirst({ where: { id: row.spaceId, organizationId: c.organizationId }, select: { id: true } });
  if (!exists) return { row, spaceMissing: true };
  return (await spaceForViewer(c, row.spaceId)) ? { row, spaceMissing: false } : null;
}

/** Is this row a Space's Overview (its id is that Space's overview id)? */
export function isOverviewRow(row: Pick<DashboardRow, "id" | "spaceId">): boolean {
  return !!row.spaceId && row.id === spaceOverviewId(row.spaceId);
}

/**
 * Who may change a dashboard. An org Owner or Admin always. A Space's
 * Overview whose Space exists: that Space's managers (canEditSpace), whoever
 * created it. Every other row, a spaceMissing Overview included: its owner.
 * (The 2026-08 route had no owner check; it is not restored.)
 */
export async function canEditDashboard(
  row: Pick<DashboardRow, "id" | "ownerId" | "spaceId">,
  c: LinkViewer,
  spaceMissing = false,
): Promise<boolean> {
  if (viewerIsOrgAdmin(c)) return true;
  if (isOverviewRow(row) && !spaceMissing) return canEditSpaceFor(c, row.spaceId as string);
  return row.ownerId === c.userId;
}

/**
 * The zone a viewer's cards are computed in: their own preference, else a
 * `tz` the client sent that Intl accepts, else the org's working calendar,
 * else UTC.
 */
export async function viewerZone(c: LinkViewer, tz: string | null): Promise<string> {
  const prefs = await getEffectivePreferences(c.userId, c.organizationId).catch(() => null);
  const own = prefs?.home?.locale?.timezone;
  if (own && isValidTimeZone(own)) return own;
  if (tz && isValidTimeZone(tz)) return tz;
  const org = await readOrgWorkSchedule(c.organizationId);
  if (org.timezone && isValidTimeZone(org.timezone)) return org.timezone;
  return "UTC";
}

export async function widgetReader(c: LinkViewer, viewer: Viewer, tz: string | null, now = new Date()): Promise<WidgetReader> {
  return { ctx: c, viewer, zone: await viewerZone(c, tz), now };
}
