// GET /api/teammate-connections: the signed-in person's own Google
// connection for their AI teammates in this workspace, the teammates that use
// it and what they allowed each (docs/plans/ai-teammates-phase3.md step 2;
// connection-views.ts TeammateConnectionsView).
//
// No AI gate (Decision 27): a person with AI off still sees their connection,
// so they can always disconnect it. Their own row only, and no other
// person's: Owners and Admins read counts at /policy.

import { NextResponse } from "next/server";
import { viewerFromSession } from "@/lib/access/viewer";
import { CONNECTIONS_COPY } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { teammateConnectionsView } from "@/lib/connectors/connection-views-server";

export async function GET() {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", CONNECTIONS_COPY.signedOut);
  return NextResponse.json(await teammateConnectionsView(viewer), { headers: { "Cache-Control": "no-store" } });
}
