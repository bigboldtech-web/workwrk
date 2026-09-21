import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import { getTeamUserIds } from "@/lib/team";
import { logActivity } from "@/lib/activity";
import { canManageRun } from "@/lib/process-run-access";
import crypto from "crypto";
import { allowedRunsViews, effectiveRunStatus, isRunStatus, parseRunsSort, type RunsView } from "@/lib/process-runs";
import { runProgress } from "@/lib/sop-kind";

const ORG_WIDE = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

function viewerOf(session: { user: { accessLevel?: string } }) {
  const level = session.user.accessLevel ?? "";
  const orgWide = ORG_WIDE.has(level);
  return {
    level,
    orgWide,
    // The People team and the org-wide legacy roles hold All; anyone who
    // manages holds Team (the report tree answers whether it has rows).
    viewer: { hasReports: isManager(session), peopleTeam: orgWide, orgRole: level === "SUPER_ADMIN" ? "OWNER" : level === "COMPANY_ADMIN" ? "ADMIN" : "MEMBER" },
  };
}

/**
 * GET /api/process-runs (spec-process section 2 `/process-runs` Data):
 *
 *   ?scope=mine|team|all   (the older "own" is accepted). Scope never widens
 *                          past what the viewer holds: a Member asking for
 *                          `all` gets `mine`, and the envelope names the
 *                          scope actually served plus every scope allowed.
 *   ?q=        run title or SOP title       ?status=  ?sopId=  ?assigneeId=
 *   ?dueFrom= ?dueTo= ?startedFrom= ?startedTo=
 *   ?sort=started|due|progress|sop  ?dir=   ?page= ?pageSize=
 *
 * Every row carries the SOP, the assignee, the derived status (Overdue is
 * computed from the due date) and the step counts; `counts` is by status
 * over the scope so the summary line agrees with the rows.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const sp = new URL(req.url).searchParams;
  const { viewer } = viewerOf(session as { user: { accessLevel?: string } });
  const allowed = allowedRunsViews(viewer);

  const requestedRaw = sp.get("scope");
  const requested: RunsView | null = requestedRaw === "own" ? "mine" : requestedRaw === "mine" || requestedRaw === "team" || requestedRaw === "all" ? requestedRaw : null;
  // No scope named: the widest the viewer holds (what the page used to get).
  const scope: RunsView = requested && allowed.includes(requested) ? requested : requested ? "mine" : allowed[allowed.length - 1];

  const where: Record<string, unknown> = { organizationId: orgId };
  const status = sp.get("status");
  if (status && isRunStatus(status)) {
    // Overdue is derived, so the filter reads it from the due date.
    if (status === "OVERDUE") { where.status = { in: ["ACTIVE", "OVERDUE"] }; where.dueDate = { lt: new Date() }; }
    else if (status === "ACTIVE") { where.status = { in: ["ACTIVE", "OVERDUE"] }; where.OR = [{ dueDate: null }, { dueDate: { gte: new Date() } }]; }
    else where.status = status;
  }
  const sopId = sp.get("sopId");
  if (sopId) where.sopId = sopId;
  const assigneeId = sp.get("assigneeId");
  if (assigneeId && scope !== "mine") where.assigneeId = assigneeId;
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    where.AND = [{ OR: [{ title: { contains: q, mode: "insensitive" } }, { sop: { title: { contains: q, mode: "insensitive" } } }] }];
  }
  const range = (from: string | null, to: string | null) => {
    const r: Record<string, Date> = {};
    if (from && !Number.isNaN(new Date(from).getTime())) r.gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) r.lte = new Date(to);
    return Object.keys(r).length ? r : null;
  };
  const due = range(sp.get("dueFrom"), sp.get("dueTo"));
  if (due) where.dueDate = { ...(where.dueDate as object ?? {}), ...due };
  const started = range(sp.get("startedFrom"), sp.get("startedTo"));
  if (started) where.startedAt = started;

  if (scope !== "all") {
    const userIds = scope === "team" ? await getTeamUserIds(orgId, callerId) : [callerId];
    // An explicit ?assigneeId= narrows INSIDE the scope; someone outside the
    // viewer's report tree yields no rows rather than widening the scope.
    where.assigneeId = assigneeId && scope === "team" ? { in: userIds.includes(assigneeId) ? [assigneeId] : [] } : { in: userIds };
  }

  const sort = parseRunsSort(sp.get("sort"));
  const dir: "asc" | "desc" = sp.get("dir") === "asc" ? "asc" : sp.get("dir") === "desc" ? "desc" : sort === "started" ? "desc" : "asc";
  const orderBy: Array<Record<string, unknown>> =
    sort === "due" ? [{ dueDate: { sort: dir, nulls: "last" } }, { createdAt: "desc" }]
    : sort === "progress" ? [{ progress: dir }, { createdAt: "desc" }]
    : sort === "sop" ? [{ sop: { title: dir } }, { createdAt: "desc" }]
    : [{ createdAt: dir }];

  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = [40, 100].includes(Number(sp.get("pageSize"))) ? Number(sp.get("pageSize")) : 40;

  const [runs, total, statusRows] = await Promise.all([
    prisma.processRun.findMany({
      where: where as never,
      include: { sop: { select: { id: true, title: true, category: true, sopType: true, content: true } } },
      orderBy: orderBy as never,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.processRun.count({ where: where as never }),
    prisma.processRun.findMany({
      where: { organizationId: orgId, ...(scope !== "all" ? { assigneeId: where.assigneeId as never } : {}) } as never,
      select: { status: true, dueDate: true },
    }),
  ]);

  const assigneeIds = Array.from(new Set(runs.map((r) => r.assigneeId).filter((x): x is string => !!x)));
  const people = assigneeIds.length
    ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, firstName: true, lastName: true, email: true, avatar: true } })
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));

  const now = new Date();
  const counts: Record<string, number> = { ACTIVE: 0, OVERDUE: 0, COMPLETED: 0, CANCELLED: 0 };
  for (const r of statusRows) counts[effectiveRunStatus(r.status, r.dueDate, now)] += 1;

  const data = runs.map((r) => {
    const sections = ((r.sop.content as { sections?: unknown[] } | null)?.sections ?? []) as never[];
    const progress = runProgress(sections, (r.completedSteps as string[]) ?? []);
    const { content, ...sopRest } = r.sop;
    void content;
    return {
      id: r.id,
      title: r.title,
      status: effectiveRunStatus(r.status, r.dueDate, now),
      storedStatus: r.status,
      progress: r.progress,
      steps: { done: progress.done, total: progress.total, sections: sections.length },
      dueDate: r.dueDate,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      assigneeId: r.assigneeId,
      assignee: r.assigneeId ? personById.get(r.assigneeId) ?? null : null,
      sopId: r.sopId,
      shareToken: r.shareToken,
      sop: sopRest,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return jsonSuccess({
    data,
    scope,
    allowedScopes: allowed,
    counts,
    pagination: { page, limit: pageSize, total, totalPages, hasMore: page < totalPages },
  });
}

// POST: Start a new process run
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { sopId, title, assigneeId, dueDate } = body;

  if (!sopId) return jsonError("SOP ID is required");

  const sop = await prisma.sOP.findFirst({
    where: { id: sopId, organizationId: orgId, sopType: "CHECKLIST" },
  });

  if (!sop) return jsonError("Checklist SOP not found", 404);

  const shareToken = crypto.randomBytes(16).toString("hex");

  // The picker returns null for "Anyone with the link"; the retired "none"
  // sentinel is still folded to null so an older client cannot write it.
  const assignee = typeof assigneeId === "string" && assigneeId && assigneeId !== "none" ? assigneeId : null;

  const run = await prisma.processRun.create({
    data: {
      sopId,
      title: title || sop.title,
      assigneeId: assignee,
      dueDate: dueDate ? new Date(dueDate) : null,
      shareToken,
      organizationId: orgId,
    },
    include: {
      sop: { select: { id: true, title: true } },
    },
  });

  if (assignee && assignee !== getUserId(session)) {
    await prisma.notification.create({
      data: {
        title: "A run was assigned to you",
        message: `"${run.title}" from the SOP "${run.sop.title}"${run.dueDate ? `, due ${run.dueDate.toISOString().slice(0, 10)}` : ""}.`,
        type: "run_assigned",
        link: `/process-runs?run=${run.id}`,
        userId: assignee,
      },
    }).catch((e) => console.error("[process-runs] notify failed", e));
  }

  logActivity({
    type: "process_run_started",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Started "${run.title}" (from SOP "${run.sop.title}")`,
    targetId: run.id,
    targetType: "process_run",
    metadata: { sopId, assigneeId: assignee },
  });

  return jsonSuccess({
    ...run,
    shareLink: `${process.env.NEXTAUTH_URL || "https://workwrk.com"}/run/${shareToken}`,
  }, 201);
}

// PATCH: Update a process run (complete step, update status). Kept for the
// callers that send `{ id, action }` in the body. It shares canManageRun
// with the per-run route /api/process-runs/[id], so the two paths hold the
// same gate; the per-run route is the one new code calls.
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { id, action, stepId, notes, inputValues } = body;

  if (!id) return jsonError("Process run ID is required");

  const run = await prisma.processRun.findFirst({
    where: { id, organizationId: orgId },
    include: { sop: true },
  });

  if (!run) return jsonError("Process run not found", 404);
  // The same gate the per-run route applies: the assignee, their manager
  // chain, or the org-wide roles. Org membership alone ticks nothing.
  if (!(await canManageRun(session as { user: { accessLevel?: string } }, orgId, userId, run.assigneeId))) {
    return jsonError("You can only change runs assigned to you or to your reports.", 403);
  }
  if (run.status === "COMPLETED" && action !== "cancel") return jsonError("This run is complete and can no longer be changed.", 409);

  if (action === "complete_step" && stepId) {
    const completedSteps = (run.completedSteps as string[]) || [];
    const stepData = (run.stepData as Record<string, unknown>) || {};

    if (!completedSteps.includes(stepId)) {
      completedSteps.push(stepId);
    }

    stepData[stepId] = {
      completedAt: new Date().toISOString(),
      completedBy: userId,
      notes: notes || null,
      inputValues: inputValues || null,
    };

    // Calculate progress
    const content = run.sop.content as { sections?: { steps?: { id: string }[] }[] };
    const totalSteps = content.sections?.reduce((sum, s) => sum + (s.steps?.length || 0), 0) || 1;
    const progress = Math.round((completedSteps.length / totalSteps) * 100);

    const isComplete = progress >= 100;

    await prisma.processRun.update({
      where: { id },
      data: {
        completedSteps: completedSteps as unknown as Prisma.InputJsonValue,
        stepData: stepData as unknown as Prisma.InputJsonValue,
        progress,
        status: isComplete ? "COMPLETED" : "ACTIVE",
        completedAt: isComplete ? new Date() : null,
      },
    });

    return jsonSuccess({ progress, completedSteps, status: isComplete ? "COMPLETED" : "ACTIVE" });
  }

  if (action === "uncomplete_step" && stepId) {
    const completedSteps = ((run.completedSteps as string[]) || []).filter(s => s !== stepId);
    const stepData = (run.stepData as Record<string, unknown>) || {};
    delete stepData[stepId];

    const content = run.sop.content as { sections?: { steps?: { id: string }[] }[] };
    const totalSteps = content.sections?.reduce((sum, s) => sum + (s.steps?.length || 0), 0) || 1;
    const progress = Math.round((completedSteps.length / totalSteps) * 100);

    await prisma.processRun.update({
      where: { id },
      data: {
        completedSteps: completedSteps as unknown as Prisma.InputJsonValue,
        stepData: stepData as unknown as Prisma.InputJsonValue,
        progress,
        status: "ACTIVE",
        completedAt: null,
      },
    });

    return jsonSuccess({ progress, completedSteps, status: "ACTIVE" });
  }

  if (action === "cancel") {
    if (run.status === "COMPLETED") return jsonError("A completed run cannot be cancelled.", 409);
    await prisma.processRun.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    logActivity({
      type: "process_run_cancelled",
      actorId: userId,
      organizationId: orgId,
      description: `Cancelled "${run.title}"`,
      targetId: id,
      targetType: "process_run",
    });
    return jsonSuccess({ status: "CANCELLED" });
  }

  return jsonError("Invalid action");
}
