// The access engine's public surface.
//
//   can(viewer, action, ref)           = decide(await loadFacts(viewer, ref))
//   canMany(viewer, action, refs)      the batched form
//   accessibleIds(viewer, type, min)   whole-list reads, two typed sets
//   accessibleUsers(viewer, ref) / explain()   who, and why
//   requireCan() / gatePage()          the API and page boundaries
//
// The two client hooks, useAccess() and useViewer(), live in ./use-access.tsx
// and are NOT re-exported here: this module's transitive imports include
// prisma, so a client component must import them from "@/lib/access/use-access"
// directly.
//
// STATUS: the app and settings halves of decide() are LIVE (gatePage and
// requireCan on app and settings refs, the settings door); object refs reach
// can() only through the delegates behind ACCESS_V2_RESOLVER and
// ACCESS_V2_TABLES (flags.ts), both default OFF.
// Step 1 turns the ~37 legacy helpers into one-line delegates over this file;
// step 2's parity harness (./parity.ts) is what proves that pivot changes no
// answers before it happens.
//
// IMPORT PATH: the legacy FILE src/lib/access.ts that used to shadow this
// directory (the specifier "@/lib/access" resolved to it) moved to
// ./legacy-resolve.ts in Phase 8 stage F, so "@/lib/access" is this module
// now. Naming a subpath (`@/lib/access/index`, `@/lib/access/gate`) still
// works and stays the convention.
//
// Server-only: this module's transitive imports include prisma. The pure half
// (types, labels, org-role, settings, enforcement, resolve, guards, parity)
// never imports it, which is what lets the golden suite run in node.

import { loadFacts } from "./facts";
import { decide } from "./resolve";
import type { Action, Decision, ObjectRef, Viewer } from "./types";

export async function can(viewer: Viewer, action: Action, ref: ObjectRef): Promise<Decision> {
  const facts = await loadFacts(viewer, ref);
  return decide(facts, action);
}

/**
 * The batched form. Refs are resolved in parallel; the map is keyed by
 * `${type}:${id|key|page|action}` so a caller can look a ref back up.
 */
export async function canMany(
  viewer: Viewer,
  action: Action,
  refs: ObjectRef[],
): Promise<Map<string, Decision>> {
  const entries = await Promise.all(
    refs.map(async (ref) => [refKey(ref), await can(viewer, action, ref)] as const),
  );
  return new Map(entries);
}

export function refKey(ref: ObjectRef): string {
  if (ref.type === "app") return `app:${ref.key}`;
  if (ref.type === "settings") return `settings:${ref.page}`;
  if (ref.type === "org") return `org:${ref.action}`;
  return `${ref.type}:${ref.id}`;
}

export { loadFacts, loadOrgFacts } from "./facts";
export {
  decide,
  explainSources,
  hasReports,
  shortCircuit,
  RULE_1_DENIED_STATUSES,
} from "./resolve";
export { accessibleIds, type AccessibleIds } from "./ids";
export {
  atLeast,
  roleFromSopRole,
  roleFromSpaceRole,
  emptyIds,
} from "./id-sets";
export {
  adminOwnsGuard,
  denialSampleKey,
  invitationOrgRoleFor,
  lastFullHolderGuard,
  lastOwnerGuard,
  mayMintSignedUrl,
  orgRolePromotionGuard,
  peopleFieldAccess,
  publicLinkRole,
  shouldLogDenial,
  transferTargetFor,
  writeBumpsTokenVersion,
  DENIAL_SAMPLE_WINDOW_MS,
  PEOPLE_FIELD_GROUP,
  type FieldAccess,
  type GuardResult,
  type PeopleFieldGroup,
  type PeopleRelationship,
} from "./guards";
export { accessibleUsers, explain, type AccessibleUser } from "./users";
export {
  viewerFromSession,
  viewerFromSessionObject,
  viewerFromApiKey,
  viewerForAgentRun,
  viewerForCron,
} from "./viewer";
export { AccessError, gatePage, requireCan, notFoundError, type AccessErrorKind } from "./gate";
export { orgRoleOf, isAgentOf, adminScopesOf, accessLevelMirror } from "./org-role";
export {
  APP_BY_OBJECT_TYPE,
  APP_RULES,
  MODULE_BY_OBJECT_TYPE,
  SETTINGS_PAGE_GATES,
  DEFAULT_ACCESS_SETTINGS,
  LOCK_IT_DOWN_ACCESS_SETTINGS,
  TODAY_EQUIVALENT_ACCESS_SETTINGS,
  parseAccessSettings,
  parseOrgAppsConfig,
  roleFromDefaultPermission,
  type AppRule,
  type PageGate,
} from "./settings";
export { ENFORCED_AT, enforcedAtFor } from "./enforcement";
export {
  OBJECT_ROLE_BLURB,
  OBJECT_ROLE_LABEL,
  OBJECT_ROLE_ORDER,
  ORG_ROLE_BLURB,
  ORG_ROLE_LABEL,
  ORG_ROLE_ORDER,
} from "./labels";
export * from "./types";
