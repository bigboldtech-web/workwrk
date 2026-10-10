// DELETE /api/teammate-connections/google { organizationId }: the signed-in person disconnects
// their own Google from their AI teammates in this workspace
// (docs/plans/ai-teammates-phase3.md step 2, Decision 19).
//
// NO AI GATE (Decision 27): a person with AI off can always remove their
// tokens. Only their own row, read by their own session.
//
// The row goes and its revoke is queued in one transaction
// (connections.ts removeConnections), then Google is told at once, with five
// seconds to answer. The answer says where that stands:
//   revoked "now"         Google confirmed
//   revoked "queued"      Google did not answer in time; the cron keeps trying
//   revoked "kept_shared" the same account is connected elsewhere in WorkwrK
//                         (another workspace, or another person), so Google is
//                         not told (it would end that one too)
// Google is told through the revoke settings alone (googleRevokeConfig), so
// a WorkwrK that stopped offering Google still revokes (review of step 2).
//
// THE WORKSPACE THE PAGE SHOWED (review round 1 of Phase 3). The card's body
// says which workspace's card was on screen ({ organizationId }); when the
// session is in another one now (switched in another tab), nothing is removed
// and the answer is 409 workspace_changed, so the page reloads instead of
// ending the other workspace's connection.

import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { CONNECTION_ROUTE_ERRORS, CONNECTIONS_COPY } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { connectionFor, removeConnections, revokeQueued } from "@/lib/connectors/connections";
import { googleRevokeConfig } from "@/lib/connectors/google/config";

export async function DELETE(req: Request) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", CONNECTIONS_COPY.signedOut);
  // The workspace the page showed, required: a caller that names another, or
  // none (an API client, a page from before review round 1 of Phase 3), is
  // refused below (comment corrected in review round 2 of Phase 3).
  const body = (await req.json().catch(() => null)) as { organizationId?: unknown } | null;
  const shownIn = body && typeof body === "object" ? body.organizationId : undefined;
  // Required (lead, after review round 1): a page that names no workspace,
  // such as one loaded before this release, reloads rather than act on
  // whichever workspace the session holds now.
  if (shownIn !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const connection = await connectionFor(viewer);
  if (!connection) return teammateError(404, "not_connected", CONNECTION_ROUTE_ERRORS.notConnected);

  const { removed, queued } = await removeConnections({
    where: Prisma.sql`"id" = ${connection.id} AND "organizationId" = ${viewer.organizationId} AND "userId" = ${viewer.userId}`,
    reason: "disconnected",
    actor: { id: viewer.userId, type: "person" },
  });
  // A second click, or another tab, got there first.
  if (removed.length === 0) return teammateError(404, "not_connected", CONNECTION_ROUTE_ERRORS.notConnected);
  if (queued.length === 0) return NextResponse.json({ disconnected: true, revoked: "kept_shared" });

  const cfg = googleRevokeConfig();
  if (!cfg) return NextResponse.json({ disconnected: true, revoked: "queued" });
  const r = await revokeQueued(queued, cfg, { timeoutMs: 5_000, budgetMs: 5_000 }).catch(() => ({ revoked: 0, kept: queued.length, dropped: 0, stillHeld: 0, unopenable: 0 }));
  // The account connected again meanwhile (here or elsewhere): its grant is in use, so it was kept.
  if (r.stillHeld === queued.length) return NextResponse.json({ disconnected: true, revoked: "kept_shared" });
  return NextResponse.json({ disconnected: true, revoked: r.revoked + r.stillHeld === queued.length ? "now" : "queued" });
}
