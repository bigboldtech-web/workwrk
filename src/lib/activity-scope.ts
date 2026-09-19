// Who may see whose activity.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/activity):
// "the silent downgrade at `api/activity/route.ts:24` becomes an explicit 403
// `no_access` on `scope=team|all` for a viewer without reports, which the page
// never requests because it never renders those pills."
//
// This file is the ONE answer, so the pills and the route cannot disagree. The
// old route decided with `isManager`, a hard-coded string array of eight
// access levels; this asks the access model's own questions:
//
//   my    everyone
//   team  anyone with reports, at any depth, plus the People team and admins
//   all   the People team, Owner and Admin
//
// It lives in lib rather than in the route because a Next route module may
// only export handlers and a small set of route config keys: anything else
// fails the build's route-type check.

import type { Viewer } from "./access/types";

export type ActivityScope = "my" | "team" | "all";

export const ACTIVITY_SCOPES: ReadonlyArray<{ key: ActivityScope; label: string }> = [
  { key: "my", label: "Just me" },
  { key: "team", label: "My team" },
  { key: "all", label: "Everyone" },
];

export function parseActivityScope(raw: string | null | undefined): ActivityScope {
  return raw === "team" || raw === "all" ? raw : "my";
}

/**
 * The pure rule. The two facts it needs are passed in so the same function
 * answers on the server (from `loadOrgFacts`) and could answer on the client
 * (from the boot payload) without either one re-deriving them.
 */
export function scopeAllowed(
  scope: ActivityScope,
  facts: { isOrgAdmin: boolean; onPeopleTeam: boolean; hasReports: boolean },
): boolean {
  if (scope === "my") return true;
  if (facts.isOrgAdmin) return true;
  if (scope === "all") return facts.onPeopleTeam;
  return facts.hasReports || facts.onPeopleTeam;
}

/** The scopes to render as pills. A pill is never drawn for a scope that 403s. */
export function allowedScopes(facts: { isOrgAdmin: boolean; onPeopleTeam: boolean; hasReports: boolean }): ActivityScope[] {
  return ACTIVITY_SCOPES.map((s) => s.key).filter((s) => scopeAllowed(s, facts));
}

/** The two viewer-side facts, read off the Viewer the gate already built. */
export function viewerScopeFacts(viewer: Viewer, peopleTeamIds: readonly string[]): {
  isOrgAdmin: boolean;
  onPeopleTeam: boolean;
  hasReports: boolean;
} {
  return {
    isOrgAdmin: viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN",
    onPeopleTeam: peopleTeamIds.includes(viewer.userId),
    // `reportTree` excludes the viewer themselves (viewer.ts), so any member
    // at all means this person manages somebody.
    hasReports: (viewer.reportTree?.size ?? 0) > 0,
  };
}
