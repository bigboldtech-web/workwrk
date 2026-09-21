// legacy-task-routes.ts: where each retired /tasks/* page lands.
//
// The seven pages ran on the legacy `Task` table and are gone; their rows are
// Items and My work shows them. This table is the ONE statement of the
// destinations. `next.config.ts` carries the same rows as literals (a config
// file cannot import from the app's module graph without pulling the whole
// tree into the build step), and the route-handler twins under
// src/app/(dashboard)/tasks/* read this table, so a test can pin that the
// config, the handlers and this file agree.
//
// Gantt and Sprint used to land on plain /my-work, which is a delete dressed
// as a redirect: the personal Gantt and the sprint room were pages people
// used, and My work now has both as views, so the bookmark lands on the view.

export const LEGACY_TASK_ROUTES: Readonly<Record<string, string>> = {
  "/tasks/assigned-to-me": "/my-work",
  "/tasks/today-overdue": "/my-work?group=due",
  "/tasks/backlog": "/my-work?group=due&bucket=nodate",
  "/tasks/board": "/my-work?view=board",
  "/tasks/gantt": "/my-work?view=gantt",
  "/tasks/sprint": "/my-work?view=sprint",
  "/tasks/calendar": "/planner",
};

/** The destination for a retired /tasks/* path, or null when the path is not one. */
export function legacyTaskDestination(path: string): string | null {
  return LEGACY_TASK_ROUTES[path] ?? null;
}
