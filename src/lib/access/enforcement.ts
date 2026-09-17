// ENFORCED_AT — where each action, toggle, rule and cap is actually enforced.
//
// Spec 1.1 principle 7 ("nothing is decorative") and invariant 21: every
// member of the Action union, every OrgAction, every toggle key, every rule
// and cap, and every ObjectRef type must appear here and in at least one
// golden case. The completeness test in resolve.test.ts fails otherwise. That
// test is the thing that stops a second batch of 55 cosmetic permission cells.
//
// Values are the route or function that owns the check. While the engine is
// inert (step 0) they name the call site the step-1 delegate will sit on; they
// are strings, not imports, so this file stays pure.
//
// Pure: imports ./types and ./settings only.

import {
  ACTIONS,
  OBJECT_TYPES,
  ORG_ACTIONS,
  type Action,
  type AppKey,
  type ObjectType,
  type OrgAction,
  type SettingsPageKey,
} from "./types";
import { APP_KEYS, SETTINGS_PAGE_KEYS, TOGGLE_KEYS, type ToggleKey } from "./settings";

export type RuleKey =
  | "rule.1.org-scope"
  | "rule.2.module-off"
  | "rule.3.owner-only"
  | "rule.4.org-admin"
  | "rule.5.owner"
  | "rule.6.user-grant"
  | "rule.7.group-grant"
  | "rule.8.everyone-grant"
  | "rule.9.relationship"
  | "rule.10.inheritance"
  | "rule.11.maximum"
  | "rule.12.caps"
  | "rule.13.action"
  | "rule.14.discoverable";

export type CapKey =
  | "cap.guest.full"
  | "cap.guest.share"
  | "cap.agent.delete"
  | "cap.agent.export"
  | "cap.agent.create_space"
  | "cap.agent.full"
  | "cap.acting-as"
  | "cap.archived";

export type EnforcementKey =
  | `action.${Action}`
  | `org.${OrgAction}`
  | `toggle.${ToggleKey}`
  | `object.${ObjectType}`
  | `app.${AppKey}`
  | `settings.${SettingsPageKey}`
  | RuleKey
  | CapKey
  | "talk.call_link";

const ACTION_ENFORCEMENT: Record<`action.${Action}`, string> = {
  "action.view": "gatePage / requireCan on every object route",
  "action.comment": "POST /api/items/[id]/comments, POST /api/docs/[id]/comments",
  "action.edit": "PATCH /api/items/[id], PUT /api/docs/[id], POST /api/tables/[id]/rows",
  "action.create_child": "POST /api/boards, POST /api/folders, POST /api/boards/[id]/items",
  "action.share": "POST /api/access-grants (today: spaces/[id]/members, boards/[id]/members, folders/[id]/members)",
  "action.invite_guest": "POST /api/invitations, POST /api/spaces/[id]/invitations",
  "action.publish": "PATCH /api/sops/[id] (status), PATCH /api/policies/[id] (status)",
  "action.manage": "PATCH /api/spaces/[id], PATCH /api/boards/[id], PATCH /api/folders/[id]",
  "action.restrict": "PATCH /api/spaces/[id] and PATCH /api/folders/[id] (restricted)",
  "action.findable": "PATCH /api/spaces/[id] (findable)",
  "action.move": "POST /api/boards/[id]/move, POST /api/folders/reorder, POST /api/spaces/[id]/move",
  "action.archive": "DELETE /api/boards/[id] (archive), DELETE /api/spaces/[id]",
  "action.delete": "DELETE /api/spaces/[id], /api/folders/[id], /api/boards/[id], /api/docs/[id], /api/tables/[id]",
  "action.transfer": "PATCH /api/spaces/[id] (ownerId), grants.ts transferOwnership",
  "action.export": "GET /api/audit-log/export, /api/tables/[id]/export, /api/docs/[id]/export",
};

const ORG_ENFORCEMENT: Record<`org.${OrgAction}`, string> = {
  "org.create_space": "POST /api/spaces",
  "org.create_team": "POST /api/teams",
  "org.invite_member": "POST /api/invitations",
  "org.invite_guest": "POST /api/invitations (orgRole GUEST), POST /api/spaces/[id]/invitations",
  "org.create_automation": "POST /api/automation/workflows",
  "org.archive_channel": "PATCH /api/conversations/[id] (archive)",
  "org.export_people": "GET /api/people/export, /api/users/export",
};

const TOGGLE_ENFORCEMENT: Record<`toggle.${ToggleKey}`, string> = {
  "toggle.whoCanCreateSpaces": "POST /api/spaces, POST /api/teams",
  "toggle.newSpaceDefault": "POST /api/spaces (the EVERYONE grant written on create)",
  "toggle.findableSpaces": "gatePage discoverability, GET /api/access/peek",
  "toggle.editorsCanShare": "POST /api/access-grants",
  "toggle.whoCanInviteGuests": "POST /api/invitations",
  "toggle.peopleTeam": "can(person), review / policy / survey / asset routes",
  "toggle.whoCanPublish": "PATCH /api/sops/[id], PATCH /api/policies/[id]",
  "toggle.whoCanDelete": "container DELETE routes",
  "toggle.guestExpiryDays": "grants.ts (default expiresAt on Guest grants)",
  "toggle.publicLinks": "SOP.shareToken, DataTable.isPublic, FormDefinition.isPublic",
};

const RULE_ENFORCEMENT: Record<RuleKey, string> = {
  "rule.1.org-scope": "resolve.ts decide() rule 1",
  "rule.2.module-off": "resolve.ts decide() rule 2 (today: getSessionAndModule, /tlk and /tables layouts)",
  "rule.3.owner-only": "resolve.ts decide() rule 3 (today: doc-access.ts NOTEPAD branch)",
  "rule.4.org-admin": "resolve.ts decide() rule 4 (today: six copies of the org-admin Set)",
  "rule.5.owner": "resolve.ts decide() rule 5",
  "rule.6.user-grant": "resolve.ts decide() rule 6 (today: SpaceMember/FolderMember/BoardMember rows)",
  "rule.7.group-grant": "resolve.ts decide() rule 7 (AccessGrant group subjects, step 4)",
  "rule.8.everyone-grant": "resolve.ts decide() rule 8 (today: Visibility.ORG)",
  "rule.9.relationship": "resolve.ts decide() rule 9 (today: api/items/[id]/route.ts:27-31 and friends)",
  "rule.10.inheritance": "resolve.ts decide() rule 10 (today: resolveFolder's 8-hop loop)",
  "rule.11.maximum": "resolve.ts decide() rule 11",
  "rule.12.caps": "resolve.ts decide() rule 12",
  "rule.13.action": "resolve.ts decide() rule 13",
  "rule.14.discoverable": "resolve.ts decide() rule 14, gate.ts notFound()/404 split",
};

const CAP_ENFORCEMENT: Record<CapKey, string> = {
  "cap.guest.full": "resolve.ts rule 12, grants.ts role picker",
  "cap.guest.share": "resolve.ts rule 12 + rule 13 share",
  "cap.agent.delete": "every container and item DELETE route",
  "cap.agent.export": "every export route and the Export buttons",
  "cap.agent.create_space": "POST /api/spaces, POST /api/teams",
  "cap.agent.full": "resolve.ts rule 12",
  "cap.acting-as": "viewer.ts viewerFromApiKey / viewerForAgentRun / viewerForCron",
  "cap.archived": "resolve.ts rule 12",
};

/** One key per ObjectRef type (invariant 21, spec 5.1 line 508). */
const OBJECT_ENFORCEMENT: Record<`object.${ObjectType}`, string> = {
  "object.space": "getSpaceForReader / canEditSpace / canContributeSpace",
  "object.folder": "folderReadable / folderVisibleTo / folderAccessForSpace",
  "object.list": "getBoardForReader / canEditBoard / canContributeBoard",
  "object.item": "api/items/[id]/route.ts loadAndGateRead + loadAndGate",
  "object.doc": "doc-access.ts docAccessible + doc-sharing.ts requireDocRole",
  "object.table": "api/tables/[id]/* (getSpaceForReader today)",
  "object.whiteboard": "api/whiteboards/[id]/*",
  "object.file_folder": "api/files (folder scope)",
  "object.file": "api/files/[id] and the signed-URL minter",
  "object.sop": "api/sops/[id] (sopVisibilityWhere + canWriteToFolder)",
  "object.sop_folder": "sop-access.ts canWriteToFolder, /api/sop-folders/[id]/access",
  "object.policy": "api/policies/[id]",
  "object.contract": "api/agreements/[id]",
  "object.goal": "goal-audience.ts canSeeGoal, alignment-scope.ts canEditOkrOwner",
  "object.kra": "api/kras/[id], access.ts resolveKra",
  "object.channel": "api/conversations/[id] (getSessionAndModule + ConversationMember)",
  "object.team": "api/teams/[id] (step 4)",
  "object.tool": "api/tools/[id] (ToolShare)",
  "object.asset": "api/assets/[id]",
  "object.survey": "api/surveys/[id]",
  "object.announcement": "api/announcements/[id]",
  "object.review_cycle": "api/review-cycles/[id]",
  "object.automation": "automation/hub-access.ts, api/automation/workflows/[id]",
  "object.form": "api/forms/[id]",
  "object.template": "api/template-center/[id]",
  "object.timesheet": "api/timesheets/[id] (resolves to person)",
  "object.kudos": "api/kudos/[id]",
  "object.candor": "api/candor/[id]",
  "object.person": "PATCH /api/users/[id] and the people-data routes",
  "object.person_card": "GET /api/people/pick, GET /api/users",
};

function appEnforcement(): Record<`app.${AppKey}`, string> {
  const out = {} as Record<`app.${AppKey}`, string>;
  for (const key of APP_KEYS) {
    out[`app.${key}`] = `the ${key} hub or route layout, via gatePage("view", { type: "app", key: "${key}" })`;
  }
  return out;
}

function settingsEnforcement(): Record<`settings.${SettingsPageKey}`, string> {
  const out = {} as Record<`settings.${SettingsPageKey}`, string>;
  for (const page of SETTINGS_PAGE_KEYS) {
    out[`settings.${page}`] = `src/app/(dashboard)/settings/layout.tsx via SETTINGS_PAGE_GATES["${page}"]`;
  }
  return out;
}

export const ENFORCED_AT: Record<EnforcementKey, string> = {
  ...ACTION_ENFORCEMENT,
  ...ORG_ENFORCEMENT,
  ...TOGGLE_ENFORCEMENT,
  ...RULE_ENFORCEMENT,
  ...CAP_ENFORCEMENT,
  ...OBJECT_ENFORCEMENT,
  ...appEnforcement(),
  ...settingsEnforcement(),
  // The Talk guest door stays outside can() on purpose (spec 14): the signed
  // code and its 24h expiry are the enforcement.
  "talk.call_link": "POST /api/calls/guest-token, /meet/[code] (code signature + 24h expiry)",
};

/** Every key the completeness test must find. */
export const REQUIRED_ENFORCEMENT_KEYS: EnforcementKey[] = [
  ...ACTIONS.map((a) => `action.${a}` as EnforcementKey),
  ...ORG_ACTIONS.map((a) => `org.${a}` as EnforcementKey),
  ...TOGGLE_KEYS.map((t) => `toggle.${t}` as EnforcementKey),
  ...OBJECT_TYPES.map((t) => `object.${t}` as EnforcementKey),
  ...APP_KEYS.map((k) => `app.${k}` as EnforcementKey),
  ...SETTINGS_PAGE_KEYS.map((p) => `settings.${p}` as EnforcementKey),
  ...(Object.keys(RULE_ENFORCEMENT) as RuleKey[]),
  ...(Object.keys(CAP_ENFORCEMENT) as CapKey[]),
];

/** The enforcement point an action's Decision carries. */
export function enforcedAtFor(action: Action, type?: ObjectType): string {
  if (type) {
    const objectKey = `object.${type}` as EnforcementKey;
    const actionKey = `action.${action}` as EnforcementKey;
    return `${ENFORCED_AT[actionKey]} (${ENFORCED_AT[objectKey]})`;
  }
  return ENFORCED_AT[`action.${action}` as EnforcementKey];
}
