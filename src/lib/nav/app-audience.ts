// The APP_RULES audience of an app key, answered from the boot viewer facts,
// for client surfaces that decide whether to RENDER a row (a sidebar row, a
// palette entry). It mirrors resolve.ts appAudienceAllows exactly, over the
// same APP_RULES table, so a row is drawn for precisely the viewers the page
// gate lets in. The org's hide and floor config is the rail's job
// (visibleRailApps) and is applied on top by the caller.
//
// Pure and client safe: APP_RULES lives in a module with no server imports.

import { APP_RULES } from "@/lib/access/settings";
import type { AppKey } from "@/lib/access/types";

export interface AudienceViewer {
  orgRole: string;
  peopleTeam?: boolean;
  hasReports?: boolean;
}

export function appAudienceAllows(key: AppKey, v: AudienceViewer): boolean {
  const rule = APP_RULES[key];
  if (!rule) return false;
  const guest = v.orgRole === "GUEST";
  if (guest && rule.guest === "none") return false;
  const admin = v.orgRole === "OWNER" || v.orgRole === "ADMIN";
  switch (rule.audience) {
    case "signed-in":
      return true;
    case "member":
      return !guest;
    case "reports-people-team-admin":
      return admin || Boolean(v.peopleTeam) || Boolean(v.hasReports);
    case "people-team-admin":
      return admin || Boolean(v.peopleTeam);
    case "owner-admin":
      return admin;
    default:
      return false;
  }
}
