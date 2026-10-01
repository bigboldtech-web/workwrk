// /api/sops/[id]/run-steps: run a step-by-step SOP (src/lib/sop-spawn.ts).
//
// GET   who each step would go to right now (the soonest available rule,
//       src/lib/sop-step-owner.ts) and the SOP's default List. Read only.
// POST  { boardId, runId } creates the task of every "Creates a task" step on
//       that List. The same runId twice never makes the work twice.
//
// Gates: the SOP is one the caller may read (sopVisibilityWhere, the rule
// every SOP read path uses), it is a step-by-step SOP, and a run needs it
// PUBLISHED (a draft is not the process yet); the List is in this
// workspace, not archived, and the caller may add tasks to it (Can edit or
// better on the List, from the one node resolver), the same right creating a
// task by hand needs.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { sopVisibilityWhere } from "@/lib/sop-access";
import { getSopKind } from "@/lib/sop-kind";
import { nodeCtxFromSession, nodeRole } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { logActivity } from "@/lib/activity";
import { planSopRun, runSopSteps } from "@/lib/sop-spawn";
import { contentSpawnBoardId, SOONEST_AVAILABLE_RULE } from "@/lib/sop-step-owner";

type Session = Parameters<typeof sopVisibilityWhere>[0];

/** May this viewer add tasks to the List (Can edit or better, node access)? */
async function mayAddTasks(boardId: string): Promise<boolean> {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return false;
  const d = await nodeRole(ctx, { kind: "list", id: boardId });
  return roleAtLeast(d.role, "EDIT");
}

async function readableSop(session: Session, orgId: string, id: string) {
  const vis = await sopVisibilityWhere(session);
  return prisma.sOP.findFirst({
    where: { AND: [{ id, organizationId: orgId }, vis] },
    select: { id: true, title: true, status: true, sopType: true, content: true, kraId: true },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const sop = await readableSop(session as Session, orgId, id);
  if (!sop) return jsonError("SOP not found", 404);
  if (getSopKind(sop.sopType, sop.content) !== "steps") return jsonError("Only a step-by-step SOP runs its steps as tasks.", 400);

  const plan = await planSopRun(orgId, sop.content);
  const defaultId = contentSpawnBoardId(sop.content);
  let defaultBoard: { id: string; name: string } | null = null;
  if (defaultId) {
    const b = await prisma.board.findFirst({ where: { id: defaultId, organizationId: orgId, archivedAt: null }, select: { id: true, name: true } });
    if (b && (await mayAddTasks(b.id))) defaultBoard = b;
  }
  return jsonSuccess({
    published: sop.status === "PUBLISHED",
    rule: SOONEST_AVAILABLE_RULE,
    defaultBoard,
    steps: plan.map((s) => ({
      stepId: s.stepId,
      n: s.n,
      title: s.title,
      createsTask: s.createsTask,
      jobTitle: s.jobTitle ? (s.currentTitle ?? s.jobTitle.title) : null,
      pick: s.pick
        ? s.pick.kind === "assigned"
          ? { kind: "assigned" as const, userId: s.pick.userId, name: s.pick.name, holders: s.pick.holders }
          : { kind: s.pick.kind, notice: s.pick.notice, holders: s.pick.holders }
        : null,
    })),
  });
}

const RUN_ID = /^[A-Za-z0-9_-]{8,64}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = (await req.json().catch(() => ({}))) as { boardId?: unknown; runId?: unknown };
  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!boardId) return jsonError("Choose the List the tasks go on.", 400);
  if (!RUN_ID.test(runId)) return jsonError("A run id is required.", 400);

  const sop = await readableSop(session as Session, orgId, id);
  if (!sop) return jsonError("SOP not found", 404);
  if (getSopKind(sop.sopType, sop.content) !== "steps") return jsonError("Only a step-by-step SOP runs its steps as tasks.", 400);
  if (sop.status !== "PUBLISHED") return jsonError("Publish the SOP before running it.", 400);

  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId: orgId, archivedAt: null }, select: { id: true, slug: true, name: true } });
  if (!board) return jsonError("That List no longer exists.", 404);
  if (!(await mayAddTasks(board.id))) {
    return jsonError("You can't add tasks to that List. Ask its owner for Can edit, or choose another List.", 403);
  }

  try {
    const tasks = await runSopSteps({ organizationId: orgId, actorId: userId, sop, boardId: board.id, runId });
    if (tasks.length === 0) return jsonError("No step in this SOP is marked to create a task.", 400);
    const made = tasks.filter((t) => !t.existing).length;
    if (made > 0) {
      logActivity({
        type: "sop_steps_run",
        actorId: userId,
        organizationId: orgId,
        description: `Ran SOP "${sop.title}": ${made} task${made === 1 ? "" : "s"} on ${board.name}`,
        targetId: sop.id,
        targetType: "sop",
        metadata: { runId, boardId: board.id, itemIds: tasks.map((t) => t.itemId) },
      }).catch(() => {});
    }
    return jsonSuccess({ board, tasks }, made > 0 ? 201 : 200);
  } catch (e) {
    console.error("[sops/run-steps]", e);
    // Retrying with the same run id finishes the run without doubling it.
    return jsonError("Some tasks were not created. Try again: the ones already made are kept, never doubled.", 500);
  }
}
