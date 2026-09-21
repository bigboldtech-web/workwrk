// /docs/trash: the Notes trash. Those rows are the Doc cut of the one Trash's Archived tab. This one matters most: /docs/[id] is a sibling DYNAMIC route, so without a static segment here the path falls through to it and renders "Couldn't load doc: HTTP 404".
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
//
// PHASE 3: the target lost its `&tab=archived`. `resolveTrashTab` on the
// Trash page now reads `?type=doc` and picks the Archived tab itself,
// because a Doc is archived in place and has no TrashItem row.

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET() {
  permanentRedirect("/trash?type=doc");
}
