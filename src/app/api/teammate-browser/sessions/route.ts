// GET /api/teammate-browser/sessions?chat=<id>
//
// The signed-in person's own browsers in one of their teammate chats, newest
// six, as the browser card reads them (docs/plans/ai-teammates-phase4.md step
// 2): steps as kinds and hosts only, pictures still kept. A signed-in viewer
// only, never the AI app (Decision 29: a person with AI off can still see and
// stop their own browser). Their own rows only, read by their own id
// (Decision 30): nobody else's, an Owner's included.

import { NextResponse } from "next/server";
import { viewerFromSession } from "@/lib/access/viewer";
import { BROWSER_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { sessionsInChat } from "@/lib/browser/sessions";

export async function GET(req: Request) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const chat = new URL(req.url).searchParams.get("chat") ?? "";
  return NextResponse.json({ sessions: await sessionsInChat(viewer, chat) }, { headers: { "Cache-Control": "no-store" } });
}
