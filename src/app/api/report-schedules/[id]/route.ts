// GET    /api/report-schedules/[id]: one schedule with its run log (counts for admins only)
// PATCH  /api/report-schedules/[id]: change timing, recipients or active
// DELETE /api/report-schedules/[id]: remove the schedule (configuration, not content)
//
// Its creator or an org admin; anyone else gets a 404, which never confirms
// the schedule exists. A PATCH is a compare-and-swap on updatedAt
// (expectedUpdatedAt is required), so a stale recipient list can never re-add
// someone who just removed themselves. The target never changes. Recipients
// are re-validated as on POST (reportRecipientProblems over recipientRows). A
// Guest caller is answered 404 by requireWorkApp.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { requireWorkApp } from "@/lib/dashboards/dashboard-server";
import { nextReportRunAt, parseRunLog, reportRecipientProblems, runLogForViewer, validateSchedulePatch } from "@/lib/reports/schedule";
import { recipientRows, viewerIsOrgAdmin } from "@/lib/list-links-server";
import { canEditSchedule, privateViewOwner, specOf, toScheduleDTOs, withReportTable } from "@/lib/reports/report-server";

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
      // Eligible members only (this org, live, not INACTIVE, not a Guest), one
      // answer that echoes no id.
      const users = await recipientRows(v.recipientUserIds, c.organizationId);
      if (reportRecipientProblems(v.recipientUserIds, users, c.organizationId).length) {
        return NextResponse.json({ error: "invalid_recipients" }, { status: 400 });
      }
    }
    // A private view goes to its owner only, whoever the editor is. The rule
    // is checked against what this edit SENDS, never against a stored list
    // the edit leaves alone: a view made private after it was scheduled to
    // colleagues keeps them on the stored list, and refusing every edit over
    // that left the owner unable to pause, retime or fix the schedule, with a
    // Retry that could never succeed (the cron already skips the colleagues).
    //   - Recipients in the body are the person's own list: refused, as on
    //     POST, if it names anyone but the owner.
    //   - Left out, on a schedule that will send: trimmed to the owner, and
    //     the answer carries the trimmed list. Refused only when that leaves
    //     nobody, because a schedule cannot run with no one to send to.
    //   - Left out, on a paused schedule: untouched. Pausing always works.
    //   Privacy comes from the view row, never from who is editing: an org
    //   admin who cannot read the owner's private view is held to the same
    //   rule, so no colleague is ever stored on it.
    const privateOwner = await privateViewOwner(row.targetKind, row.targetId, c.organizationId);
    let recipientUserIds = v.recipientUserIds;
    if (privateOwner) {
      const owner = privateOwner;
      if (v.patch.recipientUserIds) {
        if (recipientUserIds.some((uid) => uid !== owner)) {
          return NextResponse.json({ error: "private_view_recipients" }, { status: 400 });
        }
      } else if (v.active) {
        recipientUserIds = recipientUserIds.filter((uid) => uid === owner);
        if (recipientUserIds.length === 0) {
          return NextResponse.json({ error: "private_view_recipients" }, { status: 400 });
        }
      }
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
        recipientUserIds,
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
