// GET /api/me/sops (spec-process section 2 `/sops/my-sops` Data): the
// session user's SOP assignments in ONE hop, with the To do / Done / All
// views, the search, kind and status filters, the sorts, the count for the
// sidebar badge and the assignee's active run for "Continue run".
//
//   ?view=todo|done|all   default all
//   ?q=                   the SOP title
//   ?kind=written|steps|checklist|recording
//   ?mandatory=1          ?status=ASSIGNED|IN_PROGRESS|COMPLETED|OVERDUE
//   ?dueFrom= ?dueTo=     ?sort=due|assigned|name   ?dir=
//
// The older `sops` array (assignmentId, status, mandatory, pending, sop) is
// still returned beside `data`, so the alignment block that reads it keeps
// working.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSopKind, isSopKind, kindWhere } from "@/lib/sop-kind";
import { effectiveRunStatus } from "@/lib/process-runs";

export type MySopsView = "todo" | "done" | "all";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const view: MySopsView = sp.get("view") === "todo" || sp.get("view") === "done" ? (sp.get("view") as MySopsView) : "all";
  const q = (sp.get("q") ?? "").trim();
  const kindRaw = sp.get("kind");
  const kind = isSopKind(kindRaw) ? kindRaw : null;
  const mandatory = sp.get("mandatory") === "1";
  const status = sp.get("status");
  const sort = sp.get("sort") === "assigned" || sp.get("sort") === "name" ? sp.get("sort")! : "due";
  const dir: "asc" | "desc" = sp.get("dir") === "desc" ? "desc" : "asc";

  const sopWhere: Record<string, unknown> = { organizationId: u.organizationId };
  if (q) sopWhere.title = { contains: q, mode: "insensitive" };
  if (kind) Object.assign(sopWhere, kindWhere(kind));

  const where: Record<string, unknown> = { userId: u.id, sop: sopWhere };
  if (view === "todo") where.status = { not: "COMPLETED" };
  if (view === "done") where.status = "COMPLETED";
  if (mandatory) where.mandatory = true;
  if (status === "ASSIGNED" || status === "IN_PROGRESS" || status === "COMPLETED") where.status = status;
  if (sp.get("dueFrom") || sp.get("dueTo")) {
    const range: Record<string, Date> = {};
    const f = sp.get("dueFrom"); const t = sp.get("dueTo");
    if (f && !Number.isNaN(new Date(f).getTime())) range.gte = new Date(f);
    if (t && !Number.isNaN(new Date(t).getTime())) range.lte = new Date(t);
    if (Object.keys(range).length) where.dueDate = range;
  }

  const orderBy: Array<Record<string, unknown>> =
    sort === "name" ? [{ sop: { title: dir } }]
    : sort === "assigned" ? [{ createdAt: dir }]
    : [{ dueDate: { sort: dir, nulls: "last" } }, { createdAt: "desc" }];

  const [assignments, openCount] = await Promise.all([
    prisma.sOPAssignment.findMany({
      where: where as never,
      include: {
        sop: { select: { id: true, title: true, description: true, status: true, sopType: true, content: true, version: true, category: true } },
      },
      orderBy: orderBy as never,
    }),
    prisma.sOPAssignment.count({ where: { userId: u.id, status: { not: "COMPLETED" } } }),
  ]);

  const checklistIds = assignments.filter((a) => a.sop.sopType === "CHECKLIST").map((a) => a.sopId);
  const runs = checklistIds.length
    ? await prisma.processRun.findMany({
        where: { sopId: { in: checklistIds }, assigneeId: u.id, status: { in: ["ACTIVE", "OVERDUE"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, sopId: true, shareToken: true, progress: true, status: true, dueDate: true },
      })
    : [];
  const runBySop = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!runBySop.has(r.sopId)) runBySop.set(r.sopId, r);

  const now = new Date();
  let overdue = 0;
  let todo = 0;
  let done = 0;
  const data = assignments.map((a) => {
    const isDone = a.status === "COMPLETED";
    const isOverdue = !isDone && !!a.dueDate && a.dueDate.getTime() < now.getTime();
    if (isDone) done += 1; else todo += 1;
    if (isOverdue) overdue += 1;
    const run = runBySop.get(a.sopId) ?? null;
    const sections = Array.isArray((a.sop.content as { sections?: unknown[] } | null)?.sections) ? (a.sop.content as { sections: unknown[] }).sections : [];
    // `content` was read for the kind and the section count only; the list never ships bodies.
    const { content, ...sopRest } = a.sop;
    void content;
    return {
      id: a.id,
      status: isDone ? "COMPLETED" : isOverdue ? "OVERDUE" : a.status,
      mandatory: a.mandatory,
      dueDate: a.dueDate,
      assignedAt: a.createdAt,
      completedAt: a.completedAt,
      stepsTotal: a.stepsTotal,
      stepsCompleted: a.stepsCompleted,
      score: a.score,
      sop: { ...sopRest, kind: getSopKind(a.sop.sopType, a.sop.content), sectionCount: sections.length },
      run: run ? { id: run.id, shareToken: run.shareToken, progress: run.progress, status: effectiveRunStatus(run.status, run.dueDate, now) } : null,
    };
  });

  return NextResponse.json({
    data,
    total: data.length,
    count: openCount,
    summary: { todo, overdue, done },
    // The older shape, kept for the alignment block.
    sops: assignments.map((a) => ({
      assignmentId: a.id,
      status: a.status,
      mandatory: a.mandatory,
      pending: a.status !== "COMPLETED",
      sop: { id: a.sop.id, title: a.sop.title, description: a.sop.description, status: a.sop.status },
    })),
  });
}
