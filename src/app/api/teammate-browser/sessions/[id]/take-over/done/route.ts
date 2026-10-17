// POST /api/teammate-browser/sessions/[id]/take-over/done { organizationId, finished: boolean }
//
// The person hands their browser back (docs/plans/ai-teammates-phase4.md
// Decision 19, browser/take-over.ts finishTakeOver): Done (`finished`) or
// Give it back. The teammate's card, when it asked, becomes EXECUTED with
// only { done }, and `resume` says the chat continues once, as a decision's
// answer does. A recording (docs/plans/ai-teammates-phase5.md step 2) ends
// with it: Done keeps its steps as a draft (`recorded`: the skill and how
// many steps), Discard (finished false) deletes them (`recorded` null). A
// signed-in viewer only, never the AI app (Decision 29: a person can always
// hand back or stop their own browser). 409 not_handed_over when they do not
// have it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { viewerFromSession } from "@/lib/access/viewer";
import { BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { finishTakeOver } from "@/lib/browser/take-over";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ organizationId: z.string().min(1).max(200).optional(), finished: z.boolean() }).strict();

export async function POST(req: Request, { params }: Params) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const out = await finishTakeOver(viewer, (await params).id, parsed.data.finished);
  if (!out.ok) return teammateError(out.status, out.code, out.error);
  return NextResponse.json({ session: out.view, resume: out.resume, chat: out.chat, recorded: out.recorded }, { headers: { "Cache-Control": "no-store" } });
}
