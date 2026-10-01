// Running a step-by-step SOP: every step marked "Creates a task" becomes a
// task on a List, assigned by the step's job title through the soonest
// available rule (src/lib/sop-step-owner.ts), and linked back to the step.
//
// What one run writes, per spawned step:
//   - the task, through createBoardItem (positions, the CREATED activity row
//     with meta.source naming the SOP step, every normal invariant)
//   - Item.metadata.sopStep (SopStepOrigin): the SOP, the step, the run id,
//     the job title, and the notice when nobody could be picked
//   - Item.metadata.kraId when the SOP is owned by a KRA, so the task lands
//     on the Effort card of every goal linked to that KRA
//   - an EntityLink BOARD_ITEM -> SOP (Required reading, position = the
//     step number, context "Step 3: ...") so the task's Related section
//     and the SOP's "Used by" both show it
//   - the assignment notification for the person picked
//
// ONCE PER RUN. The caller passes a run id made when the dialog opened; a
// second POST with the same id (a double click, a retry after a timeout that
// did land) finds the tasks that run already made and returns them, so it
// never doubles the work. A run that failed part way is finished by retrying
// with the same id: the steps it already created are skipped.
//
// Server only: prisma.

import { prisma } from "@/lib/prisma";
import { createBoardItem } from "@/lib/board-items";
import { notifyItemAssigned } from "@/lib/notify-item";
import { jobTitleHolders } from "@/lib/access/job-title-holders";
import {
  pickJobTitleHolder,
  runnableSteps,
  type HolderCandidate,
  type RunnableStep,
  type HolderPick,
  type SopStepOrigin,
} from "@/lib/sop-step-owner";

const DONE_NAMES = ["done", "complete", "completed", "closed", "resolved"];

/** The current holders of each job title, with what the rule needs, in a fixed number of queries. */
export async function loadHolders(organizationId: string, roleIds: string[]): Promise<Map<string, HolderCandidate[]>> {
  const out = new Map<string, HolderCandidate[]>();
  const people = await jobTitleHolders(organizationId, roleIds);
  const personIds = people.map((p) => p.id);
  const counts = new Map<string, number>();
  if (personIds.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ userId: string; n: number }>>`
      SELECT u AS "userId", COUNT(*)::int AS n
      FROM "Item" i, unnest(i."assigneeIds") AS u
      WHERE i."organizationId" = ${organizationId}
        AND i."archivedAt" IS NULL
        AND u = ANY(${personIds}::text[])
        AND (i."status" IS NULL OR lower(i."status") <> ALL(${DONE_NAMES}::text[]))
      GROUP BY u`;
    for (const r of rows) counts.set(r.userId, Number(r.n) || 0);
  }
  for (const p of people) {
    const list = out.get(p.roleId) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      status: p.status,
      isAgent: p.isAgent,
      deletedAt: p.deletedAt,
      presenceStatus: p.presenceStatus,
      presenceUntil: p.presenceUntil,
      openTasks: counts.get(p.id) ?? 0,
    });
    out.set(p.roleId, list);
  }
  return out;
}

export interface PlannedStep extends RunnableStep {
  pick: HolderPick | null;
  /** The job title's CURRENT name (a renamed title reads as it is now), or null when it was deleted. */
  currentTitle: string | null;
}

/** Who each step would go to right now. Read only. */
export async function planSopRun(organizationId: string, content: unknown, now: Date = new Date()): Promise<PlannedStep[]> {
  const steps = runnableSteps(content);
  const roleIds = steps.map((s) => s.jobTitle?.roleId).filter((x): x is string => !!x);
  const [holders, roles] = await Promise.all([
    loadHolders(organizationId, roleIds),
    roleIds.length
      ? prisma.role.findMany({ where: { organizationId, id: { in: [...new Set(roleIds)] } }, select: { id: true, title: true } })
      : Promise.resolve([] as Array<{ id: string; title: string }>),
  ]);
  const titleOf = new Map(roles.map((r) => [r.id, r.title]));
  return steps.map((s) => {
    if (!s.jobTitle) return { ...s, pick: null, currentTitle: null };
    const currentTitle = titleOf.get(s.jobTitle.roleId) ?? null;
    const label = currentTitle ?? s.jobTitle.title;
    // A deleted job title has no holders: the same visible "nobody" notice.
    const pick = pickJobTitleHolder(currentTitle ? holders.get(s.jobTitle.roleId) ?? [] : [], label, now);
    return { ...s, pick, currentTitle };
  });
}

export interface SpawnedTask {
  stepId: string;
  n: number;
  itemId: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  notice: string | null;
  /** true when this run had already created it (a repeat of the same run id). */
  existing: boolean;
}

export interface RunSopInput {
  organizationId: string;
  actorId: string;
  sop: { id: string; title: string; kraId: string | null; content: unknown };
  boardId: string;
  runId: string;
  now?: Date;
}

/** Tasks a run already made, by step id. */
async function tasksOfRun(organizationId: string, sopId: string, runId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string; title: string; ownerId: string | null; stepId: string | null; notice: string | null; n: number | null }>>`
    SELECT "id", "title", "ownerId",
           "metadata" -> 'sopStep' ->> 'stepId' AS "stepId",
           "metadata" -> 'sopStep' ->> 'notice' AS "notice",
           ("metadata" -> 'sopStep' ->> 'n')::int AS "n"
    FROM "Item"
    WHERE "organizationId" = ${organizationId}
      AND "metadata" -> 'sopStep' ->> 'sopId' = ${sopId}
      AND "metadata" -> 'sopStep' ->> 'runId' = ${runId}`;
  return new Map(rows.filter((r) => r.stepId).map((r) => [r.stepId as string, r]));
}

/** Run the SOP: create the task of every "Creates a task" step not yet made by this run. */
export async function runSopSteps(input: RunSopInput): Promise<SpawnedTask[]> {
  const now = input.now ?? new Date();
  const plan = (await planSopRun(input.organizationId, input.sop.content, now)).filter((s) => s.createsTask);
  if (plan.length === 0) return [];
  const already = await tasksOfRun(input.organizationId, input.sop.id, input.runId);
  const names = new Map<string, string>();
  const out: SpawnedTask[] = [];
  for (const step of plan) {
    const prior = already.get(step.stepId);
    if (prior) {
      out.push({ stepId: step.stepId, n: step.n, itemId: prior.id, title: prior.title, assigneeId: prior.ownerId, assigneeName: null, notice: prior.notice, existing: true });
      continue;
    }
    const pick = step.pick;
    const assigneeId = pick?.kind === "assigned" ? pick.userId : null;
    const notice = pick && pick.kind !== "assigned" ? pick.notice : null;
    if (pick?.kind === "assigned") names.set(pick.userId, pick.name);
    const jobTitle = step.jobTitle ? { roleId: step.jobTitle.roleId, title: step.currentTitle ?? step.jobTitle.title } : null;
    const origin: SopStepOrigin = {
      sopId: input.sop.id,
      sopTitle: input.sop.title,
      stepId: step.stepId,
      n: step.n,
      stepTitle: step.title,
      runId: input.runId,
      jobTitle,
      assignedBy: assigneeId ? "job-title" : "none",
      notice,
    };
    const metadata: Record<string, unknown> = { sopStep: origin };
    if (input.sop.kraId) metadata.kraId = input.sop.kraId;
    const item = await createBoardItem(
      {
        organizationId: input.organizationId,
        boardId: input.boardId,
        title: step.title,
        ...(assigneeId ? { assigneeIds: [assigneeId] } : {}),
        metadata,
        actorId: input.actorId,
      },
      { activitySource: { kind: "sop-step", sopId: input.sop.id, stepId: step.stepId, n: step.n, runId: input.runId } },
    );
    // The link back to the step. Upsert: the unique key is the pair and the
    // relation, so a retried run never fails on a link it already wrote.
    await prisma.entityLink.upsert({
      where: {
        sourceType_sourceId_targetType_targetId_relationKind: {
          sourceType: "BOARD_ITEM", sourceId: item.id, targetType: "SOP", targetId: input.sop.id, relationKind: "REQUIRED_READING",
        },
      },
      create: {
        organizationId: input.organizationId,
        sourceType: "BOARD_ITEM", sourceId: item.id, targetType: "SOP", targetId: input.sop.id,
        relationKind: "REQUIRED_READING", position: step.n,
        context: `Step ${step.n}: ${step.title}`.slice(0, 280),
        createdById: input.actorId,
      },
      update: {},
    });
    if (assigneeId) {
      await notifyItemAssigned({
        organizationId: input.organizationId,
        item: { id: item.id, title: item.title, dueAt: item.dueAt ?? null },
        ownerId: assigneeId,
        actorId: input.actorId,
      }).catch(() => 0);
    }
    out.push({ stepId: step.stepId, n: step.n, itemId: item.id, title: item.title, assigneeId, assigneeName: assigneeId ? names.get(assigneeId) ?? null : null, notice, existing: false });
  }
  return out;
}
