// GET /api/teammate-browser/sessions/[id]
//
// One of the signed-in person's own browsers (docs/plans/ai-teammates-phase4.md
// step 2, Decisions 29 and 30): anyone else's, an Owner's included, is 404,
// as a missing one is. A signed-in viewer only, never the AI app.

import { NextResponse } from "next/server";
import { viewerFromSession } from "@/lib/access/viewer";
import { BROWSER_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { sessionViewFor } from "@/lib/browser/sessions";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const view = await sessionViewFor(viewer, (await params).id);
  if (!view) return teammateError(404, "not_found", BROWSER_ROUTE_ERRORS.notFound);
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
