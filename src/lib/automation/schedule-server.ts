// The automation schedule cron's body (POST /api/cron/automation-schedule):
// fires "On a schedule" and "A task's date arrives" for every ACTIVE
// automation on those triggers. Every guard of the event path still applies,
// because each fire goes through runAutomationForWorkflow (pause, published
// version, scope, conditions, idempotency, usage, the per-record cap).
// Never throws.

import { prisma } from "@/lib/prisma";
import { isEverywhere, liveDefinition, readScope, readWhen } from "./definition";
import { getBoardStatuses, isDoneStatus } from "@/lib/board-items-shared";
import { runAutomationForWorkflow } from "./engine";
import { dateArrivesRange, dueScheduleInstant, readDateArrivesWhen } from "./schedule";

/** One page of the task query; the loop walks every page in the window. */
const TASK_PAGE = 200;
/** A backstop per automation per tick, far above any real window, so one
 *  runaway automation can never hold the cron for the rest. */
const TASKS_PER_WORKFLOW_MAX = 20_000;

/** Counts RUNS the tick created (a fire the scope, a condition-free skip or
 *  the idempotency key dropped is not counted), so the cron log can show an
 *  automation that fires but never runs. */
export interface ScheduleTickResult {
  scheduled: number;
  dateArrives: number;
  errors: number;
}

export async function processAutomationSchedules(now: Date = new Date()): Promise<ScheduleTickResult> {
  const result: ScheduleTickResult = { scheduled: 0, dateArrives: 0, errors: 0 };
  let workflows: Array<{ id: string; organizationId: string; triggerEvent: string | null; definition: unknown; publishedVersionId: string | null; publishedAt: Date | null }> = [];
  try {
    workflows = await prisma.automationWorkflow.findMany({
      where: { status: "ACTIVE", triggerEvent: { in: ["schedule.every", "task.date_arrives"] } },
      select: { id: true, organizationId: true, triggerEvent: true, definition: true, publishedVersionId: true, publishedAt: true },
      take: 5000,
    });
  } catch {
    return { ...result, errors: 1 };
  }
  const versionIds = workflows.map((w) => w.publishedVersionId).filter((v): v is string => !!v);
  const versions = versionIds.length
    ? await prisma.automationWorkflowVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, definitionJson: true } }).catch(() => [])
    : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));

  for (const wf of workflows) {
    try {
      const live = liveDefinition(wf, wf.publishedVersionId ? versionById.get(wf.publishedVersionId) : null);
      const when = readWhen(live);
      if (wf.triggerEvent === "schedule.every") {
        const at = dueScheduleInstant(when, now, wf.publishedAt);
        if (!at) continue;
        result.scheduled += await runAutomationForWorkflow({
          organizationId: wf.organizationId,
          workflowId: wf.id,
          event: "schedule.every",
          payload: { firedAt: at.toISOString(), period: typeof when.every === "string" ? when.every : "day", eventTs: at.toISOString() },
        });
        continue;
      }
      // task.date_arrives: every task in the window, in the automation's own
      // Lists, on Lists that are not archived, walked page by page so a busy
      // window never starves a List of its turn. The engine still checks
      // scope, the creator's reach and idempotency for each one.
      const w = readDateArrivesWhen(when);
      const range = dateArrivesRange(when, now, wf.publishedAt);
      const scope = readScope(live);
      const boardWhere = isEverywhere(scope)
        ? { archivedAt: null }
        : {
            archivedAt: null,
            OR: [
              ...(scope.listIds.length ? [{ id: { in: scope.listIds } }] : []),
              ...(scope.folderIds.length ? [{ folderId: { in: scope.folderIds } }] : []),
              ...(scope.spaceIds.length ? [{ spaceId: { in: scope.spaceIds } }] : []),
            ],
          };
      const statusesByBoard = new Map<string, ReturnType<typeof getBoardStatuses>>();
      let cursor: string | null = null;
      let seen = 0;
      for (;;) {
        const tasks: Array<{ id: string; boardId: string; title: string; status: string | null; ownerId: string | null; priority: string | null; dueAt: Date | null; startAt: Date | null; board: { statuses: unknown } }> = await prisma.item.findMany({
          where: {
            organizationId: wf.organizationId,
            archivedAt: null,
            [w.dateField]: { gte: range.from, lt: range.to },
            board: boardWhere,
          },
          select: { id: true, boardId: true, title: true, status: true, ownerId: true, priority: true, dueAt: true, startAt: true, board: { select: { statuses: true } } },
          orderBy: [{ [w.dateField]: "asc" }, { id: "asc" }],
          take: TASK_PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const t of tasks) {
          const date = t[w.dateField];
          if (!date) continue;
          if (!w.includeDone) {
            let statuses = statusesByBoard.get(t.boardId);
            if (!statuses) {
              statuses = getBoardStatuses(t.board);
              statusesByBoard.set(t.boardId, statuses);
            }
            if (isDoneStatus(statuses, t.status)) continue;
          }
          const fireAt = new Date(date.getTime() + range.offsetMs);
          result.dateArrives += await runAutomationForWorkflow({
            organizationId: wf.organizationId,
            workflowId: wf.id,
            event: "task.date_arrives",
            payload: {
              id: t.id,
              boardId: t.boardId,
              title: t.title,
              status: t.status,
              ownerId: t.ownerId,
              assigneeId: t.ownerId,
              priority: t.priority,
              dueAt: t.dueAt,
              startAt: t.startAt,
              dateField: w.dateField,
              eventTs: fireAt.toISOString(),
            },
          });
        }
        seen += tasks.length;
        if (tasks.length < TASK_PAGE || seen >= TASKS_PER_WORKFLOW_MAX) break;
        cursor = tasks[tasks.length - 1].id;
      }
    } catch {
      result.errors++;
    }
  }
  return result;
}
