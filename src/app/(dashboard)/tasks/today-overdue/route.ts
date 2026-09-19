// /tasks/today-overdue: the legacy Today / Overdue list. My work groups by due date by
// default, which is the same three buckets this page showed.
//
// Phase 2 W4 (docs/plans/ui-refresh/spec-work-home.md section 0, the redirect
// table). The page that lived here ran on the legacy `Task` table; those rows
// are Items now (scripts/migrate-legacy-tasks.ts) and My work shows them.
//
// A belt-and-braces twin of the `next.config.ts` redirect table.
//
// WHY BOTH, AND WHY A ROUTE HANDLER. `redirects()` in next.config is read once,
// when the server starts, so a config-only redirect is unverifiable until the
// next restart and is silently absent on any process that predates the edit.
// This file is part of the app's module graph, so it takes effect with hot
// reload and can be curled on the spot.
//
// It is a route handler and not a page because `permanentRedirect` inside a
// streaming page renders the shell first and emits the redirect as a client
// meta tag: a blank frame, a 200, and no Location header. A route handler
// answers with a real 308 before anything paints, which is what a bookmark, an
// old reminder email, a link unfurler and a crawler all need.
//
// WITHOUT THIS FILE the path is not a 404: `/tasks/[id]` is a sibling dynamic
// segment, so `/tasks/backlog` would be read as a task id and answer HTTP 200
// with the in-shell "We couldn't find that page" — a soft 404 that no 404
// monitor ever sees.
//
// In production the config row still answers first (it runs before routing),
// so this file is only ever reached when the table has not been loaded.

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET() {
  permanentRedirect("/my-work?group=due");
}
