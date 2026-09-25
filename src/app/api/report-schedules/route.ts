// GET  /api/report-schedules?targetKind=&targetId=&received=1
// POST /api/report-schedules: schedule a dashboard or a saved view by email
//
// Gap 16. RECIPIENTS ARE ORG MEMBERS, by id, never free-text addresses: an
// address field on a report is an exfiltration door, because the report is
// computed under a member's access and then mailed wherever someone typed.
// Each copy is computed at send time under ITS recipient's access
// (src/lib/reports/report-server.ts), so the sender's access is never mailed.
//
// Org admins see every schedule in the org, everyone else the ones they made;
// ?received=1 answers the schedules the caller is ON, without the recipient
// list or the run log: { id, targetKind, targetId (only when the caller can
// read the target now), targetName, cadence, weekday, monthDay, timeOfDay,
// timezone, cadenceText, nextRunAt, createdBy }.
//
// Recipients must be ELIGIBLE members (reportRecipientProblems over
// recipientRows): this org, not deleted, not INACTIVE, not a Guest. One
// invalid_recipients answer, echoing no id. A Guest caller is answered 404 by
// requireWorkApp.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { recipientRows, viewerIsOrgAdmin } from "@/lib/list-links-server";
import { requireWorkApp } from "@/lib/dashboards/dashboard-server";
import { cadenceText, nextReportRunAt, reportRecipientProblems, validateScheduleInput } from "@/lib/reports/schedule";
import { cronInstalled, readableTarget, specOf, toScheduleDTOs, withReportTable } from "@/lib/reports/report-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const sp = new URL(req.url).searchParams;
  return withReportTable(async () => {
    if (sp.get("received") === "1") {
      const rows = await prisma.reportSchedule.findMany({
        where: { organizationId: c.organizationId, recipientUserIds: { has: c.userId } },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const creators = await prisma.user.findMany({
        where: { id: { in: Array.from(new Set(rows.map((r) => r.createdById))) }, organizationId: c.organizationId },
        select: { id: true, firstName: true, lastName: true },
      });
      const byId = new Map(creators.map((u) => [u.id, u] as const));
      const schedules = [];
      for (const r of rows) {
        const target = await readableTarget(r.targetKind, r.targetId, c);
        const who = byId.get(r.createdById);
        schedules.push({
          id: r.id,
          targetKind: r.targetKind,
          // Only when the caller can read the target now, so a row never
          // confirms which dashboard or view an unreadable schedule is about.
          targetId: target ? r.targetId : null,
          targetName: target?.name ?? null,
          cadence: r.cadence,
          weekday: r.weekday,
          monthDay: r.monthDay,
          timeOfDay: r.timeOfDay,
          timezone: r.timezone,
          cadenceText: cadenceText(specOf(r)),
          nextRunAt: r.nextRunAt,
          createdBy: who ? { firstName: who.firstName, lastName: who.lastName } : null,
        });
      }
      return NextResponse.json({ schedules, cronInstalled: cronInstalled() }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const targetKind = sp.get("targetKind");
    const targetId = sp.get("targetId");
    const rows = await prisma.reportSchedule.findMany({
      where: {
        organizationId: c.organizationId,
        ...(viewerIsOrgAdmin(c) ? {} : { createdById: c.userId }),
        ...(targetKind ? { targetKind } : {}),
        ...(targetId ? { targetId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json(
      { schedules: await toScheduleDTOs(rows, c), cronInstalled: cronInstalled() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function POST(req: Request) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const body = await req.json().catch(() => null);
  return withReportTable(async () => {
    const v = validateScheduleInput(body);
    if (!v.ok) return NextResponse.json({ error: "invalid_schedule", issues: v.issues }, { status: 400 });
    const s = v.value;
    // The caller must be able to read the target NOW.
    const target = await readableTarget(s.targetKind, s.targetId, c);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const users = await recipientRows(s.recipientUserIds, c.organizationId);
    // One answer, echoing no id, so this cannot be used to test who exists.
    if (reportRecipientProblems(s.recipientUserIds, users, c.organizationId).length) {
      return NextResponse.json({ error: "invalid_recipients" }, { status: 400 });
    }
    if (target.privateOwnerId && s.recipientUserIds.some((id) => id !== target.privateOwnerId)) {
      return NextResponse.json({ error: "private_view_recipients" }, { status: 400 });
    }
    const created = await prisma.reportSchedule.create({
      data: {
        organizationId: c.organizationId,
        createdById: c.userId,
        targetKind: s.targetKind,
        targetId: s.targetId,
        cadence: s.cadence,
        weekday: s.weekday,
        monthDay: s.monthDay,
        timeOfDay: s.timeOfDay,
        timezone: s.timezone,
        recipientUserIds: s.recipientUserIds,
        active: s.active,
        nextRunAt: s.active ? nextReportRunAt(specOf(s), new Date()) : null,
      },
    });
    const [schedule] = await toScheduleDTOs([created], c);
    return NextResponse.json({ schedule }, { status: 201 });
  });
}
