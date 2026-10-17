// What ends at once when a person leaves, is deactivated or can no longer
// be acted for, or a workspace is deleted or suspended
// (docs/plans/ai-teammates-phase4.md Decision 27): their Google connections
// for AI teammates (Phase 3) and their teammates' browsers (Phase 4). Every
// path that ended Google connections calls these instead, so a browser
// signed in to a person's accounts never outlives their access.
//
// THEIR SKILLS (docs/plans/ai-teammates-phase5.md Decision 14, step 3): a
// person who left or was deactivated has their skills in that workspace
// marked at once (store.ts markSkillsOrphaned), a third half after the two
// Phase 4 ones; they are deleted 30 days later only if the person is still
// gone then (src/lib/skills/orphans.ts checks each again). Never for
// "no_access" (a Guest, an agent account, AI off): those skills are kept.
// A person made a live member again (a reactivation, an invitation
// accepted) has them cleared at once by store.ts skillsBackFor, after that
// write commits, never failing its route.
//
// BOTH HALVES ALWAYS RUN. A throw in one never stops the other; the first
// error is thrown after both ran, so the caller's own log line still says
// the hook failed. Each caller already runs it after its write commits and
// never fails its route on it; the cron sweep ends whatever a failed hook
// left (connections.ts sweepConnections, browser/sessions.ts
// sweepBrowserSessions).
//
// Server-only.

import { endAllBrowserSessionsOf, endBrowserSessionsFor, endWorkspaceBrowserSessions } from "@/lib/browser/sessions";
import { endAllConnectionsOf, endConnectionsFor, endSuspendedWorkspaceConnections, endWorkspaceConnections } from "@/lib/connectors/connections";
import { markSkillsOrphaned } from "@/lib/skills/store";

/** Run every half, then throw the first error any of them threw. */
async function both(halves: ReadonlyArray<() => Promise<unknown>>): Promise<void> {
  let first: unknown = null;
  for (const half of halves) {
    try {
      await half();
    } catch (err) {
      first ??= err;
    }
  }
  if (first !== null) throw first;
}

/** People leaving, deactivated, or made a Guest or an agent account here. */
export async function endTeammateAccessFor(organizationId: string, userIds: readonly string[], reason: "left" | "deactivated" | "no_access", actorId: string | null): Promise<void> {
  await both([
    () => endConnectionsFor(organizationId, userIds, reason, actorId),
    () => endBrowserSessionsFor(organizationId, userIds, reason, actorId),
    // Their skills here begin their 30 days (Phase 5 Decision 14): a person who left or was deactivated, never one only out of reach.
    ...(reason === "left" || reason === "deactivated" ? [() => markSkillsOrphaned({ organizationId, userIds }, new Date())] : []),
  ]);
}


/** A person's own account deleted (POST /api/me/delete): in every workspace. */
export async function endAllTeammateAccessOf(userId: string, actorId: string | null): Promise<void> {
  await both([() => endAllConnectionsOf(userId, "left", actorId), () => endAllBrowserSessionsOf(userId, actorId)]);
}

/** The workspace deleted by its Owner or closed by staff, or suspended by staff. */
export async function endWorkspaceTeammateAccess(organizationId: string, reason: "workspace_deleted" | "suspended", actorId: string | null): Promise<void> {
  await both([
    () => (reason === "suspended" ? endSuspendedWorkspaceConnections(organizationId) : endWorkspaceConnections(organizationId, "workspace_deleted", actorId)),
    () => endWorkspaceBrowserSessions(organizationId, "workspace_closed", reason === "suspended" ? null : actorId),
  ]);
}
