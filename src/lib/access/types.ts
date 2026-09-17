// The access engine's vocabulary. One file, one copy of every name the
// model uses, so nothing downstream re-declares a ladder.
//
// Source of truth: docs/plans/ui-refresh/access-model-spec.md sections 2, 3
// and 5.1. Every type below is either quoted from section 5.1 or derived
// from a numbered rule in section 4.
//
// This module is PURE: no imports at all, so the golden suite can load it in
// vitest's node environment (the config resolves no "@/" alias, see
// vitest.config.ts and the note at the top of rail-apps.test.ts).

// ── Org roles (spec 2.1) ──────────────────────────────────────────

export type OrgRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

/** The two delegable Admin scopes an Owner can switch on per Admin (spec 2.1). */
export type AdminScope = "billing" | "security";

/**
 * User.status values rule 1 admits. Kept as a string union rather than the
 * Prisma enum so this file stays import-free.
 */
export type ViewerStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "ON_LEAVE"
  | "PROBATION"
  | "PIP"
  | "NOTICE_PERIOD";

// ── Object roles (spec 3.1) ───────────────────────────────────────

export type ObjectRole = "FULL" | "EDIT" | "COMMENT" | "VIEW";

/** Rank for the rule-11 maximum and the rule-13 action check. */
export const ROLE_RANK: Record<ObjectRole | "none", number> = {
  none: 0,
  VIEW: 1,
  COMMENT: 2,
  EDIT: 3,
  FULL: 4,
};

/** Rule 11: the effective role is the maximum of every source. */
export function maxRole(a: ObjectRole | "none", b: ObjectRole | "none"): ObjectRole | "none" {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/** Rule 12: caps take the minimum. */
export function minRole(a: ObjectRole | "none", b: ObjectRole | "none"): ObjectRole | "none" {
  return ROLE_RANK[a] <= ROLE_RANK[b] ? a : b;
}

/** Rule 13: does this role clear the bar the action needs? */
export function meetsRole(role: ObjectRole | "none", required: ObjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

// ── Actions (spec 5.1) ────────────────────────────────────────────

export type Action =
  | "view"
  | "comment"
  | "edit"
  | "create_child"
  | "share"
  | "invite_guest"
  | "publish"
  | "manage"
  | "restrict"
  | "findable"
  | "move"
  | "archive"
  | "delete"
  | "transfer"
  | "export";

export const ACTIONS: readonly Action[] = [
  "view",
  "comment",
  "edit",
  "create_child",
  "share",
  "invite_guest",
  "publish",
  "manage",
  "restrict",
  "findable",
  "move",
  "archive",
  "delete",
  "transfer",
  "export",
];

/**
 * Org-level verbs. The spec sketches these inline in the ObjectRef comment
 * (section 5.1, line 531) without giving them a union; they are named here so
 * `ENFORCED_AT` can key on them and the completeness test can assert on them.
 * They are carried ON the ref (`{ type: "org", action }`), not in `Action`,
 * because they have no object and no role ladder.
 */
export type OrgAction =
  | "create_space"
  | "create_team"
  | "invite_member"
  | "invite_guest"
  | "create_automation"
  | "archive_channel"
  | "export_people";

export const ORG_ACTIONS: readonly OrgAction[] = [
  "create_space",
  "create_team",
  "invite_member",
  "invite_guest",
  "create_automation",
  "archive_channel",
  "export_people",
];

// ── Object references (spec 5.1) ──────────────────────────────────

/** Every row of the section 3.3 hierarchy that takes an id. */
export type ObjectType =
  | "space"
  | "folder"
  | "list"
  | "item"
  | "doc"
  | "table"
  | "whiteboard"
  | "file_folder"
  | "file"
  | "sop"
  | "sop_folder"
  | "policy"
  | "contract"
  | "goal"
  | "kra"
  | "channel"
  | "team"
  | "tool"
  | "asset"
  | "survey"
  | "announcement"
  | "review_cycle"
  | "automation"
  | "form"
  | "template"
  | "timesheet"
  | "kudos"
  | "candor"
  | "person"
  | "person_card";

export const OBJECT_TYPES: readonly ObjectType[] = [
  "space",
  "folder",
  "list",
  "item",
  "doc",
  "table",
  "whiteboard",
  "file_folder",
  "file",
  "sop",
  "sop_folder",
  "policy",
  "contract",
  "goal",
  "kra",
  "channel",
  "team",
  "tool",
  "asset",
  "survey",
  "announcement",
  "review_cycle",
  "automation",
  "form",
  "template",
  "timesheet",
  "kudos",
  "candor",
  "person",
  "person_card",
];

/**
 * Rail hub and folded app keys (spec 5.2.1). The 8 hubs and 19 folded keys
 * come from FOLDED_APP_HUB in src/lib/nav/route-hub.ts; `talent`, `analytics`,
 * `rollup` and `integrations` are routes rather than catalog entries, which is
 * why the section 5.2.1 table has 31 rows where its preamble counts 30.
 */
export type AppKey =
  // hubs
  | "home"
  | "planner"
  | "chat"
  | "docs"
  | "teams"
  | "tables"
  | "ai"
  | "settings"
  // folded catalog entries
  | "goals"
  | "timesheets"
  | "library"
  | "clips"
  | "sops"
  | "policies"
  | "agreements"
  | "reviews"
  | "candor"
  | "kudos"
  | "surveys"
  | "announcements"
  | "forms"
  | "automation"
  | "tools"
  | "assets"
  | "build"
  | "store"
  | "trash"
  // routes without a catalog entry
  | "talent"
  | "analytics"
  | "rollup"
  | "integrations";

/** Workspace and personal settings page keys (spec 6.6). */
export type SettingsPageKey =
  | "overview"
  | "identity"
  | "locale"
  | "apps"
  | "members"
  | "structure"
  | "access"
  | "tasks"
  | "data"
  | "audit"
  | "scoring"
  | "billing"
  | "security"
  | "api"
  | "account/profile"
  | "account/preferences"
  | "account/notifications"
  | "account/security"
  | "account/connections"
  | "account/shortcuts";

export type ObjectRef =
  | { type: ObjectType; id: string }
  | { type: "app"; key: AppKey }
  | { type: "settings"; page: SettingsPageKey }
  | { type: "org"; action: OrgAction };

// ── Viewer (spec 5.1) ─────────────────────────────────────────────

export interface ActingAs {
  type: "api-key" | "agent" | "cron";
  id: string;
  /** Rule 12: the resolved role is min(actingFor's live level, cap). */
  cap: ObjectRole;
}

export interface Viewer {
  userId: string;
  organizationId: string;
  orgRole: OrgRole;
  isAgent: boolean;
  adminScopes: AdminScope[];
  actingAs?: ActingAs;
  /** Rule 1 inputs. Absent means "a live, signed-in person". */
  status?: ViewerStatus;
  deleted?: boolean;
  // lazily loaded, memoised per request by viewer.ts:
  reportTree?: Set<string>;
  peopleTeam?: boolean;
  departmentId?: string | null;
  officeId?: string | null;
  roleId?: string | null;
  teamIds?: string[];
  tagIds?: string[];
}

// ── Facts (spec 5.1) ──────────────────────────────────────────────

/** What a viewer's principal set looks like to a grant row. */
export type GrantSubject =
  | "USER"
  | "TEAM"
  | "DEPARTMENT"
  | "OFFICE"
  | "ROLE"
  | "TAG"
  | "EVERYONE";

export interface GrantFact {
  objectType: ObjectType;
  objectId: string;
  subjectType: GrantSubject;
  /** null when EVERYONE. */
  subjectId: string | null;
  role: ObjectRole;
  /** Rule 20: an expired row contributes nothing. Epoch ms or null. */
  expiresAt: number | null;
  /**
   * Where this grant came from while the old tables are still the store.
   * Kept for `explain()` and the parity report; never read by a rule.
   */
  source?: "SpaceMember" | "FolderMember" | "BoardMember" | "SOPFolderAccess" | "Visibility" | "AccessGrant";
}

/** One ancestor on the way up to the Space (nearest first). */
export interface ChainLink {
  type: ObjectType;
  id: string;
  name: string;
  ownerId: string | null;
  restricted: boolean;
  findable: boolean;
  archived: boolean;
}

export interface ObjectFacts {
  type: ObjectType;
  id: string;
  /** null when the row was not found; rule 1 then treats it as cross-org. */
  organizationId: string | null;
  ownerId: string | null;
  restricted: boolean;
  findable: boolean;
  archived: boolean;
  name?: string;
  /** Rule 2: the premium module this object belongs to ("chat" | "tables"). */
  moduleKey?: string | null;
  /** Rule 2: the app key whose Apps-config floor covers this object. */
  appKey?: AppKey | null;
  /**
   * Rule 3. "notepad" = a Doc anchored NOTEPAD; "dm" and "private-channel" =
   * Talk conversations. `ownerOnlySubjectId` is the Notepad's owner (the
   * anchor's entityId); channel membership comes from
   * `relationships.isConversationMember`.
   */
  ownerOnly?: "notepad" | "dm" | "private-channel" | null;
  ownerOnlySubjectId?: string | null;
  /** SOP / Policy status. Rule 5 on a SOP fires for the author only while DRAFT. */
  published?: boolean;
  /** Announcement org-wide, Policy published org-wide, Goal at COMPANY level. */
  orgWide?: boolean;
  /** Rule 9 VIEW-for-context payload for a List an assignee can see through. */
  context?: Record<string, unknown>;
}

/**
 * Relationship facts (rule 9). The spec names ten; the section 3.3 table needs
 * more than ten, and `decide()` is pure and cannot look anything up, so every
 * relationship a 3.3 row mentions has a boolean here. A missing boolean would
 * silently become a denial.
 */
export interface Relationships {
  /** Item: viewer is in Item.assigneeIds or is Item.ownerId. */
  isAssignee: boolean;
  /** Object's createdById is the viewer (Doc, Tool, Survey, Automation, SOP ...). */
  isCreator: boolean;
  /** Viewer manages the subject person of a people-data object (rule 9 chain). */
  managesSubject: boolean;
  /** Viewer is on the org's People team (spec 2.1; seeded from HR users in step 0). */
  peopleTeam: boolean;
  isConversationMember: boolean;
  isSopAssignee: boolean;
  isPolicyAssignee: boolean;
  isContractParty: boolean;
  isGoalAudience: boolean;
  isTeamMember: boolean;
  // Beyond the spec's ten, required by the section 3.3 rows:
  /** Team lead (FULL on the Team object). */
  isTeamLead: boolean;
  /** SOP author, kept separate from isCreator because it only counts on drafts. */
  isSopAuthor: boolean;
  /** The person the object is about is the viewer (person, timesheet, review). */
  isSelfSubject: boolean;
  /** Asset.assignedToId is the viewer. */
  isAssetAssignee: boolean;
  /** Survey audience row covers the viewer. */
  isSurveyTarget: boolean;
  /** Review subject is the viewer. */
  isReviewSubject: boolean;
  /** Candor session participant. */
  isCandorParticipant: boolean;
  /** Rule 14: the viewer holds a role on some descendant of this object. */
  holdsDescendant: boolean;
  /** Rule 14 / rule 9: the viewer is an assignee of an Item inside this List. */
  hasAssignedItemInside: boolean;
  /** Invariant 3: this Guest shares at least one object with the subject person. */
  sharesObjectWithSubject: boolean;
  /** Announcement.targetAudience covers the viewer (src/lib/announcement-audience.ts). */
  isAnnouncementAudience: boolean;
}

export function emptyRelationships(): Relationships {
  return {
    isAssignee: false,
    isCreator: false,
    managesSubject: false,
    peopleTeam: false,
    isConversationMember: false,
    isSopAssignee: false,
    isPolicyAssignee: false,
    isContractParty: false,
    isGoalAudience: false,
    isTeamMember: false,
    isTeamLead: false,
    isSopAuthor: false,
    isSelfSubject: false,
    isAssetAssignee: false,
    isSurveyTarget: false,
    isReviewSubject: false,
    isCandorParticipant: false,
    holdsDescendant: false,
    hasAssignedItemInside: false,
    sharesObjectWithSubject: false,
    isAnnouncementAudience: false,
  };
}

/** The org rail config as stored in OrgPreference.sidebarDefault.apps. */
export interface AppsConfig {
  order?: string[];
  hidden?: string[];
  /** app key -> tier floor, in the legacy "manager" | "hr-admin" | "org-admin" vocabulary. */
  minAccess?: Record<string, string>;
}

/** Organization.settings.access, the ten toggles of spec section 8. */
export interface AccessSettings {
  /** 1 */ whoCanCreateSpaces: "everyone" | "admins";
  /** 2 */ newSpaceDefault: "everyone_edit" | "everyone_view" | "private";
  /** 3 */ findableSpaces: boolean;
  /** 4 */ editorsCanShare: boolean;
  /** 5 */ whoCanInviteGuests: "full_access" | "admins" | "nobody";
  /** 6 */ peopleTeamUserIds: string[];
  /** 6 */ peopleTeamDepartmentId: string | null;
  /** 7 */ whoCanPublish: "editors" | "admins_people_team";
  /** 8 */ whoCanDelete: "full_access" | "admins";
  /** 9 */ guestExpiryDays: 0 | 30 | 90;
  /** 10 */ publicLinks: "off" | "view";
}

export interface OrgFacts {
  access: AccessSettings;
  /** App keys of every ACTIVE premium module (src/lib/entitlements.ts). */
  activeModules: Set<string>;
  apps: AppsConfig;
  peopleTeamIds: string[];
}

export interface AccessFacts {
  viewer: Viewer;
  object: ObjectFacts;
  /** Nearest first, up to the Space. */
  chain: ChainLink[];
  /** For the object and its chain, the viewer's principals only, plus EVERYONE. */
  grants: GrantFact[];
  relationships: Relationships;
  org: OrgFacts;
  /**
   * Epoch ms, stamped by loadFacts. `decide()` is pure and must not read the
   * clock; grant expiry (invariant 20) compares against this.
   */
  now: number;
  /** The app or settings or org ref being asked about, when the ref was one. */
  app?: AppKey;
  settingsPage?: SettingsPageKey;
  orgAction?: OrgAction;
  /**
   * For an `app` ref whose APP_RULES row says `guest: "shared"`: does this
   * Guest actually hold anything of that kind? `undefined` means the question
   * could not be answered from today's tables for this app key, and decideApp
   * then keeps the permissive answer rather than inventing a narrowing.
   */
  appShared?: boolean;
}

// ── Decision (spec 5.1) ───────────────────────────────────────────

export type DecisionVia =
  | "org-admin"
  | "owner"
  | "shared"
  | "team"
  | "department"
  | "office"
  | "role"
  | "tag"
  | "everyone"
  | "assigned"
  | "manager-chain"
  | "people-team"
  | "inherited"
  | "module-off"
  | "app-off"
  | "none";

export interface Decision {
  allowed: boolean;
  role: ObjectRole | "none";
  via: DecisionVia;
  viaObject?: { type: string; id: string; name: string };
  /** One plain sentence for LockedPage and the audit log. Not a test contract. */
  reason: string;
  discoverable: boolean;
  context?: Record<string, unknown>;
  /** The route or function that owns this action, for the "Enforced at" tooltip. */
  enforcedAt: string;
}
