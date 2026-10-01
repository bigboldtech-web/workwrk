// "N people lose access to {app}" (settings-architecture 5.3 and S7, Phase 8
// stage F): who a hide or a minimum-role change on Settings > Apps & modules
// takes an app away from, BEFORE it is saved. Pure.
//
// Two rules, the one in force decides:
//
//   engine   (the app gates enforce: ACCESS_V2_RESOLVER on and the log-only
//            week over, flags.ts appGatesEnforce) rule 2 as resolve.ts
//            enforces it: a hidden app is off for everyone (Owners and
//            Admins too); a floor is cleared by Owners and Admins always,
//            "hr-admin" by the People team, "manager" by the People team or
//            anyone with a report (solid or dotted), "org-admin" by nobody
//            else (viewer-tiers.ts engineTiers, the tiers boot then ships)
//   legacy   (otherwise) the rail's display tiers (viewer-tiers.ts
//            tiersOfLevel): what people see in their rail today, and what
//            the pages that already gate on the app key answer
//
// THE BASELINE COUNTS. A person is named only when they HAVE the app before
// the change. Legacy: the catalog baseline (the app's requiredAccess tier,
// the rail's first filter), since a hide or floor then changes the rail and
// the launcher only. Engine: the app's APP_RULES audience, since a hide or
// floor then closes the ROUTE, which the audience opens (Policies is an
// hr-admin launcher entry but every Member's page, reached from the Docs
// sidebar); a Guest counts on a Guest-visible app only when something of
// that kind is shared with them (unknown counts as shared, the engine's own
// permissive answer). Without a baseline a floor on Build apps, which only
// Admins ever see, named every Member as losing it.

import type { AppKey } from "./types";
import type { ViewerTier, ViewerTiers } from "./viewer-tiers";
import { clearsTier, engineTiers } from "./viewer-tiers";
import { APP_RULES } from "./settings";
import { appAudienceAllows } from "../nav/app-audience";

export interface ImpactPerson {
  id: string;
  name: string;
  /** OWNER | ADMIN | MEMBER | GUEST */
  orgRole: string;
  peopleTeam: boolean;
  hasReports: boolean;
  /** Today's display tiers (legacy rule). */
  tiers: ViewerTiers;
  /**
   * A Guest only: something of this app's kind is shared with them (the
   * engine's appShared). undefined when unanswerable, which keeps the app.
   */
  shared?: boolean;
}

export interface AppVisibility {
  hidden: boolean;
  floor?: ViewerTier | null;
}

/** Who has the app with no org config at all: the catalog tier and the engine key. */
export interface AppBaseline {
  /** The catalog's requiredAccess (app-access.ts), the rail's baseline. */
  requiredAccess?: ViewerTier | null;
  /** The APP_RULES key, when the app has one (the engine's audience). */
  appKey?: AppKey | null;
}

export type ImpactRule = "engine" | "legacy";

function engineAudienceAllows(p: ImpactPerson, appKey: AppKey | null | undefined): boolean {
  if (!appKey) return true;
  const rule = APP_RULES[appKey];
  if (!rule) return false;
  if (p.orgRole === "GUEST") {
    if (rule.guest === "none") return false;
    if (rule.guest === "shared") return p.shared !== false;
    return true;
  }
  return appAudienceAllows(appKey, p);
}

/** Does this person keep the app under this config, by the rule in force? */
export function keepsApp(p: ImpactPerson, v: AppVisibility, rule: ImpactRule, baseline: AppBaseline = {}): boolean {
  const tiers = rule === "engine" ? engineTiers(p) : p.tiers;
  if (rule === "legacy" && !clearsTier(tiers, baseline.requiredAccess)) return false;
  if (rule === "engine" && !engineAudienceAllows(p, baseline.appKey)) return false;
  if (v.hidden) return false;
  if (!v.floor) return true;
  return clearsTier(tiers, v.floor);
}

/** The people who have the app before and lose it after, by name. */
export function appAccessImpact(
  people: readonly ImpactPerson[],
  before: AppVisibility,
  after: AppVisibility,
  rule: ImpactRule,
  baseline: AppBaseline = {},
): ImpactPerson[] {
  return people.filter((p) => keepsApp(p, before, rule, baseline) && !keepsApp(p, after, rule, baseline));
}

/** The sentence the Apps page shows. */
export function impactSentence(count: number, appLabel: string): string {
  if (count === 0) return `Nobody loses access to ${appLabel}.`;
  return `${count} ${count === 1 ? "person loses" : "people lose"} access to ${appLabel}.`;
}
