// ENFORCED_AT, where each action, toggle, rule and cap is actually enforced.
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
  "org.manage_process": "POST /api/sop-folders (top level), PATCH /api/settings {section:\"process\"}",
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
  "toggle.guestExpiryDays": "NOT YET: planned in grants.ts (a default expiresAt on Guest grants); nothing writes expiresAt today, and only the engine's resolve.ts (rule 20) reads it, not access-grant-store.ts",
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
  "object.goal": "goal-audience.ts canSeeGoal, goals/goal-rights.ts mayEditGoal and mayDeleteGoal",
  "object.kra": "api/kras/[id], access.ts resolveKra",
  "object.channel": "api/conversations/[id] (getSessionAndModule + ConversationMember)",
  "object.team": "api/teams/[id] (step 4)",
  "object.tool": "api/tools/[id] (ToolShare)",
  "object.asset": "api/assets/[id]",
  "object.survey": "api/pulse-surveys/[id] (survey.server.ts surveyFaces)",
  "object.announcement": "api/announcements/[id]",
  "object.review_cycle": "api/reviews/[id] and its sub-routes (review-cycle.server.ts, review-cycle-access.ts)",
  "object.automation": "automation/gate.ts, api/automation/workflows/[id]",
  "object.form": "api/forms/[id]",
  "object.template": "api/template-center/[id]",
  "object.timesheet": "api/timesheets/[id] (resolves to person)",
  "object.kudos": "api/kudos/[id]",
  "object.candor": "api/candor/[id] (candor.server.ts candorFaces)",
  "object.person": "PATCH /api/users/[id] and the people-data routes",
  "object.person_card": "GET /api/people/pick, GET /api/users",
};

/**
 * The app keys' real gates, one explicit entry per key and each naming the
 * file that enforces it. There is no template: a key added to APP_RULES
 * without a row here is a compile error (the Record is exhaustive), and
 * stage-f.test.ts checks that the file each row names exists, so the
 * completeness check can catch an app key with no gate again.
 */
export const APP_GATE_FILES: Record<AppKey, { file: string; how: string }> = {
  home: { file: "src/app/(dashboard)/home/page.tsx", how: 'gatePage("view", { type: "app", key: "home" }), also on my-work, inbox, everything, favorites, activity and dashboards' },
  planner: { file: "src/app/(dashboard)/planner/layout.tsx", how: "FlaggedAppKeyGate" },
  chat: { file: "src/app/(dashboard)/tlk/layout.tsx", how: "the Talk gate (module state, then legacyTierAllows)" },
  docs: { file: "src/app/(dashboard)/docs/(hub)/layout.tsx", how: "FlaggedAppKeyGate on the hub page only; /docs/[id] is decision B3's (CanonicalHubGate)" },
  teams: { file: "src/app/(dashboard)/people/page.tsx", how: 'gatePage("view", { type: "app", key: "teams" }), also on organization and people/*' },
  tables: { file: "src/app/(dashboard)/tables/layout.tsx", how: "TablesModuleGate (and tables/[id]/layout.tsx)" },
  ai: { file: "src/app/(dashboard)/sidekick/layout.tsx", how: "AppKeyGate (and agents/layout.tsx)" },
  settings: { file: "src/components/settings/settings-gate.tsx", how: "SettingsGate, the settings door (settings-door.ts)" },
  goals: { file: "src/app/(dashboard)/okrs/layout.tsx", how: "FlaggedAppKeyGate (and src/lib/page-gates.ts)" },
  trash: { file: "src/app/(dashboard)/trash/page.tsx", how: 'gatePage("view", { type: "app", key: "trash" }), and api/trash/*' },
  templates: { file: "src/app/(dashboard)/templates/page.tsx", how: 'gatePage("view", { type: "app", key: "templates" }), and src/lib/templates/gate.ts' },
  timesheets: { file: "src/app/(dashboard)/timesheets/layout.tsx", how: "FlaggedAppKeyGate" },
  meetings: { file: "src/app/(dashboard)/meetings/layout.tsx", how: "FlaggedAppKeyGate" },
  clock: { file: "src/app/(dashboard)/clock/layout.tsx", how: "FlaggedAppKeyGate" },
  library: { file: "src/app/(dashboard)/files/layout.tsx", how: "FlaggedAppKeyGate" },
  clips: { file: "src/app/(dashboard)/notetaker/layout.tsx", how: "FlaggedAppKeyGate" },
  sops: { file: "src/app/(dashboard)/sops/(app)/layout.tsx", how: "FlaggedAppKeyGate on the SOP centre's own pages; /sops/[id] is decision B3's (CanonicalHubGate)" },
  policies: { file: "src/app/(dashboard)/policies/layout.tsx", how: "FlaggedAppKeyGate" },
  agreements: { file: "src/app/(dashboard)/agreements/page.tsx", how: 'gatePage("view", { type: "app", key: "agreements" })' },
  reviews: { file: "src/app/(dashboard)/reviews/page.tsx", how: 'gatePage("view", { type: "app", key: "reviews" }), and api/reviews' },
  talent: { file: "src/app/(dashboard)/talent/page.tsx", how: 'gatePage("view", { type: "app", key: "talent" })' },
  analytics: { file: "src/app/(dashboard)/analytics/layout.tsx", how: 'gatePage("view", { type: "app", key: "analytics" })' },
  rollup: { file: "src/app/(dashboard)/team/rollup/page.tsx", how: 'gatePage("view", { type: "app", key: "rollup" })' },
  candor: { file: "src/app/(dashboard)/candor/page.tsx", how: 'cultureGate("candor") (src/lib/people/culture-gate.ts), and candor/[id]' },
  kudos: { file: "src/app/(dashboard)/kudos/layout.tsx", how: 'FlaggedAppKeyGate, and cultureGate("kudos") on the page' },
  surveys: { file: "src/app/(dashboard)/surveys/page.tsx", how: 'cultureGate("surveys") (src/lib/people/culture-gate.ts), and surveys/[id]' },
  tools: { file: "src/app/(dashboard)/tools/layout.tsx", how: "AppKeyGate" },
  assets: { file: "src/app/(dashboard)/assets/layout.tsx", how: "AppKeyGate" },
  // The one sanctioned exception to the app-key 404 (access 5.5): /team and
  // /team/workload render LockedPage without Request access, so they ask
  // can() through their own gate instead of gatePage.
  team: { file: "src/app/(dashboard)/team/page.tsx", how: 'teamAppGate (src/lib/people/team-gate.ts, can("view", { type: "app", key: "team" }) with LockedPage)' },
  workload: { file: "src/app/(dashboard)/team/workload/page.tsx", how: 'teamAppGate (src/lib/people/team-gate.ts, can("view", { type: "app", key: "workload" }) with LockedPage)' },
  "weekly-reviews": { file: "src/app/(dashboard)/team/reviews/page.tsx", how: 'gatePage("view", { type: "app", key: "weekly-reviews" })' },
  "kra-kpi": { file: "src/app/(dashboard)/kra-kpi/page.tsx", how: 'gatePage("view", { type: "app", key: "kra-kpi" })' },
  alignment: { file: "src/app/(dashboard)/team/alignment/page.tsx", how: 'gatePage("view", { type: "app", key: "alignment" }), and okrs/page.tsx' },
  "kpi-reviews": { file: "src/app/(dashboard)/team/kpi-reviews/page.tsx", how: 'gatePage("view", { type: "app", key: "kpi-reviews" })' },
  announcements: { file: "src/app/(dashboard)/announcements/layout.tsx", how: "FlaggedAppKeyGate" },
  forms: { file: "src/app/(dashboard)/forms/layout.tsx", how: "FormsGate" },
  automation: { file: "src/app/(dashboard)/automation/layout.tsx", how: "AppKeyGate" },
  build: { file: "src/app/(dashboard)/build/layout.tsx", how: "AppKeyGate" },
  store: { file: "src/app/(dashboard)/store/layout.tsx", how: "AppKeyGate" },
  integrations: { file: "src/app/(dashboard)/integrations/layout.tsx", how: "AppKeyGate" },
};

function appEnforcement(): Record<`app.${AppKey}`, string> {
  const out = {} as Record<`app.${AppKey}`, string>;
  // FlaggedAppKeyGate (Phase 8 stages E and F, settings-architecture S7):
  // open as before with the flags off, logging would-be denials under
  // SETTINGS_GATE_LOG_ONLY, enforcing under ACCESS_V2_RESOLVER.
  for (const key of APP_KEYS) {
    const row = APP_GATE_FILES[key];
    out[`app.${key}`] = `${row.file} via ${row.how}`;
  }
  return out;
}

function settingsEnforcement(): Record<`settings.${SettingsPageKey}`, string> {
  const out = {} as Record<`settings.${SettingsPageKey}`, string>;
  for (const page of SETTINGS_PAGE_KEYS) {
    // Each Workspace segment's layout renders SettingsGate (a parent layout
    // cannot see the pathname); today's table decides until
    // ACCESS_V2_RESOLVER, then SETTINGS_PAGE_GATES (settings-gate-engine.ts).
    out[`settings.${page}`] = page.startsWith("account/")
      ? `src/app/(dashboard)/account/layout.tsx (personal, every signed-in person)`
      : `src/components/settings/settings-gate.tsx SettingsGate (settings-legacy.ts, then SETTINGS_PAGE_GATES["${page}"] under ACCESS_V2_RESOLVER)`;
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
