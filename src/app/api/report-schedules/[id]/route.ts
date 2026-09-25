// GET    /api/report-schedules/[id]: one schedule with its run log (counts for admins only)
// PATCH  /api/report-schedules/[id]: change timing, recipients or active
// DELETE /api/report-schedules/[id]: remove the schedule (configuration, not content)
//
// Its creator or an org admin; anyone else gets a 404, which never confirms
// the schedule exists. A PATCH is a compare-and-swap on updatedAt
// (expectedUpdatedAt is required), so a stale recipient list can never re-add
// someone who just removed themselves. The target never changes.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { requireWorkApp } from "@/lib/dashboards/dashboard-server";
import { nextReportRunAt, parseRunLog, recipientProblems, runLogForViewer, validateSchedulePatch } from "@/lib/reports/schedule";
import { viewerIsOrgAdmin } from "@/lib/list-links-server";
import { canEditSchedule, readableTarget, specOf, toScheduleDTOs, withReportTable } from "@/lib/reports/report-server";

type Ctx = Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>;

async function editable(id: string, c: Ctx) {
  const row = await prisma.reportSchedule.findFirst({ where: { id, organizationId: c.organizationId } });
  return row && canEditSchedule(row, c) ? row : null;
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  return withReportTable(async () => {
    const row = await editable(id, c);
    if (!row) return notFound();
    const [schedule] = await toScheduleDTOs([row], c);
    // Per-run recipient counts only for an org Owner or Admin: with one
    // recipient they would tell the creator that colleague's access.
    const runLog = runLogForViewer(parseRunLog(row.runLog), { admin: viewerIsOrgAdmin(c) });
    return NextResponse.json({ schedule, runLog }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  return withReportTable(async () => {
    const row = await editable(id, c);
    if (!row) return notFound();
    const v = validateSchedulePatch({ ...specOf(row), recipientUserIds: row.recipientUserIds, active: row.active }, body);
    if (!v.ok) {
      return NextResponse.json({ error: v.error, ...(v.issues ? { issues: v.issues } : {}) }, { status: 400 });
    }
    if (v.patch.recipientUserIds) {
      const users = await prisma.user.findMany({
        where: { id: { in: v.recipientUserIds } },
        select: { id: true, organizationId: true, deletedAt: true, status: true },
      });
      if (recipientProblems(v.recipientUserIds, users, c.organizationId).length) {
        return NextResponse.json({ error: "invalid_recipients" }, { status: 400 });
      }
    }
    // The private-view rule holds on every edit, whoever the editor is.
    const target = await readableTarget(row.targetKind, row.targetId, c);
    if (target?.privateOwnerId && v.recipientUserIds.some((uid) => uid !== target.privateOwnerId)) {
      return NextResponse.json({ error: "private_view_recipients" }, { status: 400 });
    }
    const reactivated = v.active && !row.active;
    const nextRunAt = !v.active ? null : v.timingChanged || reactivated ? nextReportRunAt(v.spec, new Date()) : row.nextRunAt;
    const swapped = await prisma.reportSchedule.updateMany({
      where: { id, organizationId: c.organizationId, updatedAt: new Date(v.patch.expectedUpdatedAt) },
      data: {
        cadence: v.spec.cadence,
        weekday: v.spec.weekday,
        monthDay: v.spec.monthDay,
        timeOfDay: v.spec.timeOfDay,
        timezone: v.spec.timezone,
        recipientUserIds: v.recipientUserIds,
        active: v.active,
        nextRunAt,
      },
    });
    if (swapped.count === 0) {
      const live = await prisma.reportSchedule.findFirst({ where: { id, organizationId: c.organizationId }, select: { updatedAt: true } });
      return NextResponse.json({ error: "conflict", liveUpdatedAt: live?.updatedAt ?? null }, { status: 409 });
    }
    const fresh = await prisma.reportSchedule.findFirst({ where: { id, organizationId: c.organizationId } });
    const [schedule] = fresh ? await toScheduleDTOs([fresh], c) : [];
    return NextResponse.json({ schedule });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  return withReportTable(async () => {
    const row = await editable(id, c);
    if (!row) return notFound();
    await prisma.reportSchedule.deleteMany({ where: { id, organizationId: c.organizationId } });
    return NextResponse.json({ ok: true });
  });
}
