import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { effectiveRunStatus } from "@/lib/process-runs";
import { runProgress } from "@/lib/sop-kind";

/**
 * The public run endpoint (spec-process section 2 `/run/[token]`). The token
 * is the credential: no session.
 *
 *   GET    the run with its sections, done steps, typed values and the org
 *          identity for the page strip. A cancelled run answers 410 with
 *          `{ error: "cancelled" }` so the page can say "This run was
 *          cancelled." instead of the generic 404.
 *   PATCH  { action: "toggle" | "input" | "complete", stepId?, value?, inputValues? }
 *          plus the older `complete_step` / `uncomplete_step` spellings.
 */
async function load(token: string) {
  if (!token || token.length < 8) return null;
  return prisma.processRun.findUnique({
    where: { shareToken: token },
    include: {
      sop: { select: { id: true, title: true, description: true, content: true, organizationId: true } },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const run = await load(token);
  if (!run) return jsonError("This link is no longer available", 404);
  if (run.status === "CANCELLED") return jsonError("cancelled", 410);

  const [org, assignee] = await Promise.all([
    prisma.organization.findUnique({ where: { id: run.organizationId }, select: { name: true, logo: true } }),
    run.assigneeId ? prisma.user.findUnique({ where: { id: run.assigneeId }, select: { firstName: true, lastName: true } }) : Promise.resolve(null),
  ]);
  const content = run.sop.content as { sections?: { id: string; title: string; steps: unknown[] }[] };
  const sections = content.sections || [];
  const progress = runProgress(sections as never[], (run.completedSteps as string[]) ?? []);

  return jsonSuccess({
    id: run.id,
    title: run.title,
    sopTitle: run.sop.title,
    description: run.sop.description || "",
    progress: run.progress,
    steps: { done: progress.done, total: progress.total },
    status: effectiveRunStatus(run.status, run.dueDate),
    dueDate: run.dueDate,
    completedAt: run.completedAt,
    assignee: assignee ? `${assignee.firstName ?? ""} ${assignee.lastName ?? ""}`.trim() : null,
    sections,
    completedSteps: run.completedSteps || [],
    stepData: run.stepData || {},
    org: org ? { name: org.name, logo: org.logo } : null,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const { action, stepId, inputValues, value } = body as { action?: string; stepId?: string; inputValues?: Record<string, unknown> | null; value?: Record<string, unknown> | null };

  const run = await load(token);
  if (!run) return jsonError("This link is no longer available", 404);
  if (run.status === "CANCELLED") return jsonError("This run was cancelled", 410);
  // A finished run is read-only: the page says so, and the token is the
  // only credential, so the route has to say so too.
  if (run.status === "COMPLETED") return jsonError("This run is complete and can no longer be changed.", 409);

  const content = run.sop.content as { sections?: { steps?: { id: string }[] }[] };
  const totalSteps = content.sections?.reduce((sum, s) => sum + (s.steps?.length || 0), 0) || 1;
  const completedSteps = ((run.completedSteps as string[]) || []).slice();
  const stepData = { ...((run.stepData as Record<string, unknown>) || {}) };
  const values = (inputValues ?? value ?? null) as Record<string, unknown> | null;

  // Ticking the last step never completes the run by itself: the person
  // presses "Finish run" (action "complete"), so a mis-tick on the last row
  // can still be undone. Progress can read 100 on an ACTIVE run.
  const write = async (done: string[], data: Record<string, unknown>, forceComplete = false) => {
    const progress = Math.round((done.length / totalSteps) * 100);
    const isComplete = forceComplete;
    await prisma.processRun.update({
      where: { id: run.id },
      data: {
        completedSteps: done as unknown as Prisma.InputJsonValue,
        stepData: data as unknown as Prisma.InputJsonValue,
        progress,
        status: isComplete ? "COMPLETED" : "ACTIVE",
        completedAt: isComplete ? new Date() : null,
      },
    });
    return jsonSuccess({ progress, completedSteps: done, stepData: data, status: isComplete ? "COMPLETED" : "ACTIVE", completedAt: isComplete ? new Date() : null });
  };

  const isDone = !!stepId && completedSteps.includes(stepId);
  const resolved =
    action === "toggle" ? (isDone ? "uncomplete_step" : "complete_step")
    : action === "complete_step" || action === "uncomplete_step" || action === "input" || action === "complete" ? action
    : null;

  if (resolved === "complete_step" && stepId) {
    if (!completedSteps.includes(stepId)) completedSteps.push(stepId);
    stepData[stepId] = { ...((stepData[stepId] as object) ?? {}), completedAt: new Date().toISOString(), completedBy: "public", inputValues: values ?? (stepData[stepId] as { inputValues?: unknown } | undefined)?.inputValues ?? null };
    return write(completedSteps, stepData);
  }
  if (resolved === "uncomplete_step" && stepId) {
    const next = completedSteps.filter((s) => s !== stepId);
    const prior = stepData[stepId] as { inputValues?: unknown } | undefined;
    // Typed values survive an untick; only the completion stamp goes.
    if (prior?.inputValues) stepData[stepId] = { inputValues: prior.inputValues }; else delete stepData[stepId];
    return write(next, stepData);
  }
  if (resolved === "input" && stepId) {
    stepData[stepId] = { ...((stepData[stepId] as object) ?? {}), inputValues: values ?? null };
    return write(completedSteps, stepData);
  }
  if (resolved === "complete") {
    if (completedSteps.length < totalSteps) return jsonError("Tick every step before finishing the run.", 409);
    return write(completedSteps, stepData, true);
  }

  return jsonError("Invalid action");
}
