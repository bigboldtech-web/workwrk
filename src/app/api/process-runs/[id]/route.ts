import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isOrgAdmin, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { canManageRun } from "@/lib/process-run-access";
import { effectiveRunStatus } from "@/lib/process-runs";
import { runProgress } from "@/lib/sop-kind";

/**
 * /api/process-runs/[id] (spec-process section 2 `/process-runs` Data):
 *
 *   GET     the Run drawer payload: the run, its SOP's sections and steps,
 *           which steps are done and the values typed into each, the
 *           assignee and the org. Polled every 15s while the drawer is open.
 *   PATCH   { action: "cancel" | "reassign" | "due", assigneeId?, dueDate? }
 *   DELETE  Owner or Admin (a run is not a container: toggle 8 is not read).
 *
 * Who may read: the assignee, anyone in whose report tree the assignee sits,
 * and the org-wide roles; the same scope GET /api/process-runs serves.
 */
const canSee = canManageRun;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);

  const run = await prisma.processRun.findFirst({
    where: { id, organizationId: orgId },
    include: { sop: { select: { id: true, title: true, content: true, folderId: true } } },
  });
  if (!run) return jsonError("Run not found", 404);
  if (!(await canSee(session as { user: { accessLevel?: string } }, orgId, callerId, run.assigneeId))) return jsonError("Run not found", 404);

  const [assignee, org] = await Promise.all([
    run.assigneeId ? prisma.user.findUnique({ where: { id: run.assigneeId }, select: { id: true, firstName: true, lastName: true, email: true, avatar: true } }) : Promise.resolve(null),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logo: true } }),
  ]);
  const sections = ((run.sop.content as { sections?: unknown[] } | null)?.sections ?? []) as never[];
  const progress = runProgress(sections, (run.completedSteps as string[]) ?? []);

  return jsonSuccess({
    id: run.id,
    title: run.title,
    status: effectiveRunStatus(run.status, run.dueDate),
    storedStatus: run.status,
    progress: run.progress,
    steps: { done: progress.done, total: progress.total },
    dueDate: run.dueDate,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    shareToken: run.shareToken,
    assignee,
    sop: { id: run.sop.id, title: run.sop.title },
    sections,
    completedSteps: run.completedSteps ?? [],
    stepData: run.stepData ?? {},
    org,
    canManage: true,
    canDelete: isOrgAdmin(session),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const body = await req.json().catch(() => ({}));
  const action = body?.action as string | undefined;

  const run = await prisma.processRun.findFirst({ where: { id, organizationId: orgId }, select: { id: true, title: true, assigneeId: true, status: true } });
  if (!run) return jsonError("Run not found", 404);
  const allowed = await canManageRun(session as { user: { accessLevel?: string } }, orgId, callerId, run.assigneeId);
  if (!allowed) return jsonError("You can only change runs assigned to you or to your reports.", 403);

  if (action === "cancel") {
    if (run.status === "COMPLETED") return jsonError("A completed run cannot be cancelled.", 409);
    await prisma.processRun.update({ where: { id }, data: { status: "CANCELLED" } });
    logActivity({ type: "process_run_cancelled", actorId: callerId, organizationId: orgId, description: `Cancelled "${run.title}"`, targetId: id, targetType: "process_run" });
    return jsonSuccess({ status: "CANCELLED" });
  }
  if (action === "reassign") {
    const next = typeof body.assigneeId === "string" && body.assigneeId && body.assigneeId !== "none" ? body.assigneeId : null;
    if (next) {
      const person = await prisma.user.findFirst({ where: { id: next, organizationId: orgId }, select: { id: true } });
      if (!person) return jsonError("Person not found", 404);
    }
    await prisma.processRun.update({ where: { id }, data: { assigneeId: next } });
    if (next && next !== callerId) {
      await prisma.notification.create({
        data: { title: "A run was assigned to you", message: `"${run.title}" is now yours to run.`, type: "run_assigned", link: `/process-runs?run=${id}`, userId: next },
      }).catch(() => undefined);
    }
    return jsonSuccess({ assigneeId: next });
  }
  if (action === "due") {
    const due = body.dueDate ? new Date(body.dueDate) : null;
    if (due && Number.isNaN(due.getTime())) return jsonError("Invalid due date");
    await prisma.processRun.update({ where: { id }, data: { dueDate: due } });
    return jsonSuccess({ dueDate: due });
  }
  return jsonError("Invalid action");
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only admins can delete a run.", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const run = await prisma.processRun.findFirst({ where: { id, organizationId: orgId }, select: { id: true, title: true } });
  if (!run) return jsonError("Run not found", 404);
  await prisma.processRun.delete({ where: { id } });
  logActivity({ type: "process_run_deleted", actorId: getUserId(session), organizationId: orgId, description: `Deleted run "${run.title}"`, targetId: id, targetType: "process_run" });
  return jsonSuccess({ deleted: true });
}
