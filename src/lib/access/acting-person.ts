// Acting AS a person who is not the session (spec 2.5, graft G2: keys,
// agents and crons never hold a role of their own; they act as a person, at
// the level that person holds in this workspace now). A goal target counted
// from a List counts as the person who connected it
// (docs/plans/recurring-goals.md C8), whoever opens the goal and whenever
// the cron runs, so the count reads exactly what they could open themselves.
//
// It answers the three shapes the readers it feeds take: the engine's Viewer
// (node access through nodeCtxFromViewer, which denies a removed or
// deactivated person), the List reader's viewer (listReader,
// resolveListScope) and the session shape the goal rules read
// (canEditGoal). Null when the person holds no level here.

import type { Viewer } from "./types";
import { levelHeldIn } from "./acting-workspace";
import { viewerHeldIn } from "./viewer";

export interface ActingPerson {
  viewer: Viewer;
  /** The List reader's viewer (list-links-server.ts LinkViewer). */
  link: { userId: string; organizationId: string; accessLevel: string };
  /** A session for the goal rules (alignment-scope.ts canEditGoal). */
  session: { user: { id: string; organizationId: string; accessLevel: string } };
}

/** The person as this workspace sees them now, or null when they hold no level here. */
export async function actingPerson(organizationId: string, userId: string): Promise<ActingPerson | null> {
  const level = await levelHeldIn(userId, organizationId);
  if (!level) return null;
  const viewer = await viewerHeldIn(organizationId, userId, level);
  if (!viewer) return null;
  return {
    viewer,
    link: { userId, organizationId, accessLevel: level },
    session: { user: { id: userId, organizationId, accessLevel: level } },
  };
}
