// Dashboards: the pure access rules the routes, the pages and the sidebar
// share, so one predicate answers each question everywhere.
//
// DASHBOARDS ARE FOR MEMBERS. A Guest's `home` app row grants My work and
// Inbox and nothing else, so every dashboard and report route answers a Guest
// exactly like a missing object (404), the pages render the in-shell 404, and
// the Work sidebar has no Dashboards row for them. One predicate,
// dashboardsAllowedFor, decides all three. A missing role fails closed.
//
// THE SPACE OVERVIEW IS ONE ROW WITH A KNOWN ID. A Space's widget set is the
// Dashboard row whose id is spaceOverviewId(spaceId). Finding it by id rather
// than as "the first dashboard pinned to the Space" is what makes a second
// Overview impossible (two concurrent creates collide on the primary key), a
// legacy pinned dashboard never turn into the Overview, and an unpin or an
// archive unable to hand the Overview to someone else.
//
// Pure: type-only imports.

import type { WidgetSource } from "./widgets";

export const SPACE_OVERVIEW_PREFIX = "sov_";

/** The Dashboard id of a Space's Overview widgets. */
export function spaceOverviewId(spaceId: string): string {
  return `${SPACE_OVERVIEW_PREFIX}${spaceId}`;
}

export function isSpaceOverviewId(id: string): boolean {
  return typeof id === "string" && id.startsWith(SPACE_OVERVIEW_PREFIX) && id.length > SPACE_OVERVIEW_PREFIX.length;
}

const MEMBER_ROLES: ReadonlySet<string> = new Set(["OWNER", "ADMIN", "MEMBER"]);

/** Owner, Admin or Member. A Guest, a missing role or an unknown one is refused. */
export function dashboardsAllowedFor(orgRole: string | null | undefined): boolean {
  return typeof orgRole === "string" && MEMBER_ROLES.has(orgRole);
}

/**
 * A card on a Space's Overview counts only that Space: its source is the
 * Space itself or Lists inside it. `listSpaceIds` maps each named List to its
 * spaceId (one board query by the caller); a List the map does not hold is
 * treated as outside, so an unknown or deleted id can never slip through.
 */
export function overviewSourceProblem(
  source: WidgetSource,
  spaceId: string,
  listSpaceIds: ReadonlyMap<string, string | null>,
): "overview_source" | null {
  if (source.kind === "all") return "overview_source";
  if (source.kind === "space") return source.spaceId === spaceId ? null : "overview_source";
  if (source.listIds.length === 0) return "overview_source";
  for (const id of source.listIds) {
    if (listSpaceIds.get(id) !== spaceId) return "overview_source";
  }
  return null;
}
