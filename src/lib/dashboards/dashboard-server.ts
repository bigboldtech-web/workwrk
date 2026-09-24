// Dashboards: the shared gate and helpers for the /api/dashboards routes.
//
// A dashboard is ORG-VISIBLE, like a Whiteboard (the model comment says so),
// and editable by its owner and by an org Owner or Admin. One pinned to a
// Space (a Space Overview) is visible where the Space is readable; one whose
// Space no longer exists is treated as unpinned (`spaceMissing`), so deleting
// a Space never makes a dashboard vanish. What any card SHOWS is decided per
// viewer, per card (widget-data.ts), never by this gate.
//
// Server-only: prisma.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import type { Viewer } from "@/lib/access/types";
import { getEffectivePreferences } from "@/lib/preferences";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";
import { isValidTimeZone } from "@/lib/reports/schedule";
import { spaceForViewer, viewerIsOrgAdmin, type LinkViewer } from "@/lib/list-links-server";
import type { WidgetReader } from "./widget-data";

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

/** The Work-hub app key every dashboard route checks, as /api/me/everything does. */
export async function requireWorkApp(): Promise<{ viewer: Viewer } | { error: NextResponse }> {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
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

/** Owner or org admin. (The 2026-08 route had no owner check; it is not restored.) */
export function canEditDashboard(row: Pick<DashboardRow, "ownerId">, c: LinkViewer): boolean {
  return row.ownerId === c.userId || viewerIsOrgAdmin(c);
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
