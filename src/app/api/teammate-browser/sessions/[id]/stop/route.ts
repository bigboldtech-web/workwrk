// POST /api/teammate-browser/sessions/[id]/stop { organizationId }
//
// The person closes their own browser (docs/plans/ai-teammates-phase4.md
// Decisions 6 and 29): at once, its waiting steps cancelled, nothing it did
// undone. A signed-in viewer only, never the AI app, so a person with AI off
// can always close a browser holding their sign-in. Their own only (404
// otherwise). Idempotent: an ended one answers as it is.

import { NextResponse } from "next/server";
import { z } from "zod";
import { viewerFromSession } from "@/lib/access/viewer";
import { BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { endBrowserSession, ownSessionRow, sessionViewFor } from "@/lib/browser/sessions";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ organizationId: z.string().min(1).max(200).optional() }).strict();

export async function POST(req: Request, { params }: Params) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const id = (await params).id;
  const row = await ownSessionRow(viewer, id);
  if (!row) return teammateError(404, "not_found", BROWSER_ROUTE_ERRORS.notFound);
  await endBrowserSession(row.id, "stopped", { id: viewer.userId, type: "person" });
  const view = await sessionViewFor(viewer, row.id);
  if (!view) return teammateError(404, "not_found", BROWSER_ROUTE_ERRORS.notFound);
  return NextResponse.json({ session: view }, { headers: { "Cache-Control": "no-store" } });
}
