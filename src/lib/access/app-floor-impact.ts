// "N people lose access to {app}" (settings-architecture 5.3 and S7, Phase 8
// stage F): who a hide or a minimum-role change on Settings > Apps & modules
// takes an app away from, BEFORE it is saved. Pure.
//
// Two rules, the one in force decides:
//
//   engine   (ACCESS_V2_RESOLVER on) rule 2 as resolve.ts enforces it:
//            a hidden app is off for everyone (Owners and Admins too); a
//            floor is cleared by Owners and Admins always, "hr-admin" by the
//            People team, "manager" by the People team or anyone with a
//            report (solid or dotted), "org-admin" by nobody else
//   legacy   (flags off) the rail's display tiers (viewer-tiers.ts): what
//            people see in their rail today, and what the pages that already
//            gate on the app key (gatePage) answer
//
// The app's own audience (APP_RULES) and module state are the same before
// and after a config change, so they never add or remove a name here.

import type { ViewerTier, ViewerTiers } from "./viewer-tiers";
import { clearsTier } from "./viewer-tiers";

export interface ImpactPerson {
  id: string;
  name: string;
  /** OWNER | ADMIN | MEMBER | GUEST */
  orgRole: string;
  peopleTeam: boolean;
  hasReports: boolean;
  /** Today's display tiers (legacy rule). */
  tiers: ViewerTiers;
}

export interface AppVisibility {
  hidden: boolean;
  floor?: ViewerTier | null;
}

export type ImpactRule = "engine" | "legacy";

/** Does this person keep the app under this config, by the rule in force? */
export function keepsApp(p: ImpactPerson, v: AppVisibility, rule: ImpactRule): boolean {
  if (v.hidden) return false;
  if (!v.floor) return true;
  if (rule === "legacy") return clearsTier(p.tiers, v.floor);
  if (p.orgRole === "OWNER" || p.orgRole === "ADMIN") return true;
  if (v.floor === "org-admin") return false;
  if (v.floor === "hr-admin") return p.peopleTeam;
  if (v.floor === "manager") return p.peopleTeam || p.hasReports;
  return false;
}

/** The people who have the app before and lose it after, by name. */
export function appAccessImpact(people: readonly ImpactPerson[], before: AppVisibility, after: AppVisibility, rule: ImpactRule): ImpactPerson[] {
  return people.filter((p) => keepsApp(p, before, rule) && !keepsApp(p, after, rule));
}

/** The sentence the Apps page shows. */
export function impactSentence(count: number, appLabel: string): string {
  if (count === 0) return `Nobody loses access to ${appLabel}.`;
  return `${count} ${count === 1 ? "person loses" : "people lose"} access to ${appLabel}.`;
}
