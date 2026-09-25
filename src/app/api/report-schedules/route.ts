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
// timezone, cadenceText, active, nextRunAt, createdBy }. `active` is there so a
// recipient can see that a paused schedule is why no email arrives.
//
// Recipients must be ELIGIBLE members (reportRecipientProblems over
// recipientRows): this org, not deleted, not INACTIVE, not a Guest. One
// invalid_recipients answer, echoing no id. A Guest caller is answered 404 by
// requireWorkApp.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { recipientRows, viewerIsOrgAdmin, type LinkViewer } from "@/lib/list-links-server";
import { requireWorkApp } from "@/lib/dashboards/dashboard-server";
import { cadenceText, nextReportRunAt, reportRecipientProblems, validateScheduleInput } from "@/lib/reports/schedule";
import { cronInstalled, readableTarget, specOf, toScheduleDTOs, withReportTable } from "@/lib/reports/report-server";
import { createReplayDecision, readCreateRequestId, withoutRequestId } from "@/lib/create-request-id";

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
          active: r.active,
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
  const raw = await req.json().catch(() => null);
  // The dialog names the new row's id once and sends it with every Retry of
  // that create, so a POST that committed but lost its answer is answered
  // with its row, never a second schedule that would email everyone twice.
  const requestId = readCreateRequestId(raw);
  const body = withoutRequestId(raw);
  return withReportTable(async () => {
    if (requestId) {
      const replay = await replayedSchedule(requestId, c);
      if (replay) return replay;
    }
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
    const data = {
      ...(requestId ? { id: requestId } : {}),
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
    };
    let created;
    try {
      created = await prisma.reportSchedule.create({ data });
    } catch (err) {
      // The first attempt landed between the check above and this create.
      if (requestId && isUniqueViolation(err)) {
        const replay = await replayedSchedule(requestId, c);
        if (replay) return replay;
      }
      throw err;
    }
    const [schedule] = await toScheduleDTOs([created], c);
    return NextResponse.json({ schedule }, { status: 201 });
  });
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "P2002";
}

/**
 * The answer to a retried create whose id is already taken: the caller's own
 * row (200, replayed), or a refusal that says nothing about someone else's.
 * Null when no row has the id yet.
 */
async function replayedSchedule(id: string, c: LinkViewer) {
  const row = await prisma.reportSchedule.findUnique({ where: { id } });
  const decision = createReplayDecision(row ? { organizationId: row.organizationId, creatorId: row.createdById } : null, c);
  if (decision === "create" || !row) return null;
  if (decision === "refuse") return NextResponse.json({ error: "request_id_taken" }, { status: 409 });
  const [schedule] = await toScheduleDTOs([row], c);
  return NextResponse.json({ schedule, replayed: true }, { status: 200 });
}
