// The one 410 body every retired /api/tasks* route answers with.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 4, W4, "/api/tasks*
// return 410 for one release then are deleted".
//
// WHY 410 AND NOT 404. 410 Gone says "this existed, it is not coming back,
// stop asking", which is exactly true here and is what a 404 does not say. An
// integration polling a 404 retries forever; one reading a 410 with a named
// replacement can be fixed by whoever owns it.
//
// WHY A ONE-RELEASE WINDOW RATHER THAN DELETING THE FILES TODAY. Anything
// outside this repo that still calls these paths (a script, a Zap, somebody's
// curl) gets a body that names the route to move to. Deleting the files
// instead answers the App Router's own 404 HTML, which tells the caller
// nothing. The routes come out in the release after this one.

/** The JSON body. `replacement` is the path that does the same job on Items. */
export interface GoneBody {
  error: "Gone";
  /** What used to be here, so a log line identifies itself. */
  retired: string;
  /** The path to call instead. Null when nothing replaces it. */
  replacement: string | null;
  /** One sentence a person can act on. */
  detail: string;
}

export function goneBody(retired: string, replacement: string | null, detail: string): GoneBody {
  return { error: "Gone", retired, replacement, detail };
}

/** A 410 Response carrying that body. */
export function gone(retired: string, replacement: string | null, detail: string): Response {
  return new Response(JSON.stringify(goneBody(retired, replacement, detail)), {
    status: 410,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * The retired routes and where their work went. Exported so the table is
 * testable and so there is exactly one place that answers "what replaced it".
 */
export const RETIRED_TASK_ROUTES: Record<string, { replacement: string | null; detail: string }> = {
  "/api/tasks": {
    replacement: "/api/me/work",
    detail:
      "Tasks live on the Item model. Read your own work at GET /api/me/work, a List's tasks at GET /api/boards/<id>/items, and one task at GET /api/items/<id>. Create a personal task with POST /api/me/work, or a task on a List with POST /api/boards/<id>/items.",
  },
  "/api/tasks/[id]/comments": {
    replacement: "/api/items/[id]/updates",
    detail: "Task comments are ItemUpdates. GET and POST /api/items/<id>/updates, which also carries reactions and attachments.",
  },
  "/api/tasks/batch": {
    replacement: "/api/items/bulk",
    detail: "Bulk task writes go to PATCH /api/items/bulk.",
  },
  "/api/tasks/reorder-day": {
    replacement: "/api/items/bulk",
    detail:
      "Within-day ordering was a column on the legacy table that only the retired planner day view wrote. Ordering a List is PATCH /api/items/bulk with positions.",
  },
  "/api/tasks/workload": {
    replacement: null,
    detail:
      "The workload heatmap reads Items directly now and needs no route: open the Workload view on any List, or /team/workload for a manager's whole team.",
  },
  "/api/tasks/run-sla-check": {
    replacement: null,
    detail:
      "The SLA escalation cron is retired with the legacy task table and has no Item equivalent; the cron row is removed in scripts/CRON-SETUP.md. Nothing replaces it: SLA hours, escalation and the escalation chain were legacy-task-only columns.",
  },
};
