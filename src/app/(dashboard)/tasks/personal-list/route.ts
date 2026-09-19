// /tasks/personal-list: a pure move. The SAME Item-backed board lives at /my-work/personal.
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
// answers with a real 308 before anything paints.
//
// In production the config row still answers first (it runs before routing),
// so this file is only ever reached when the table has not been loaded.

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET() {
  permanentRedirect("/my-work/personal");
}
