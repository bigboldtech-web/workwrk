// The node-access parity table (Phase 8 stage E).
//
// node-access.ts is THE live resolver for Space, Folder, List (and its
// tasks), Doc, Table, Canvas and Form, and its header says the engine's
// parity job must compare can() against it, not against the Phase 0
// transcription. scripts/access-parity-job.mjs's node section does that for
// every sampled (person, object) pair, plus three stores node-access does not
// own: SOP folders (sop-access.ts), goals (goal-audience.ts canSeeGoal) and
// the Workspace settings door (settings-legacy.ts against SETTINGS_PAGE_GATES).
//
// A case is one question; a mismatch is a case where the two answers differ.
// Every mismatch must match a row below, which names WHY the engine answers
// differently on purpose; an unmatched one exits the job 1 and blocks the
// flip. Rows carry the flag state they apply to: most exist only while
// ACCESS_V2_TABLES is off (the engine then reads the old tables without the
// AccessGrant rows, the docSharing store or the Private rule), and must
// vanish once the bridge is on (node-bridge.ts).
//
// Pure: no prisma, no next.

export type NodeParitySection = "node" | "sop_folder" | "goal" | "settings" | "matrix";

export type ParityRole = "FULL" | "EDIT" | "COMMENT" | "VIEW" | "none";

export interface NodeParityCase {
  id: string;
  section: NodeParitySection;
  /** node kind, "item", "sop_folder", "goal" or the settings page key. */
  kind: string;
  objectId: string;
  viewer: {
    userId: string;
    accessLevel: string | null;
    orgAdmin: boolean;
    peopleTeam: boolean;
    agent: boolean;
    hasReports: boolean;
    /** The account status (ACTIVE, INACTIVE, ...). */
    status?: string;
  };
  /** The live answer (node-access, sop-access, canSeeGoal, the legacy settings rule). */
  truth: ParityRole;
  /** can(viewer, "view", ref).role, or for boolean sections "VIEW" / "none". */
  engine: ParityRole;
  /** Why the engine answered (Decision.via), for the report. */
  engineVia?: string;
  /** Why node-access answered (NodeDecision.via.type), for the report. */
  truthVia?: string;
  /** Facts the classifier reads. */
  facts?: Record<string, string | boolean | number | null>;
}

export interface FlagState {
  resolver: boolean;
  tables: boolean;
}

export interface NodeExpectation {
  key: string;
  reason: string;
  /** Flag states where the row applies. */
  when: (f: FlagState) => boolean;
  match: (c: NodeParityCase) => boolean;
}

const RANK: Record<ParityRole, number> = { none: 0, VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };

export function parityRank(r: ParityRole): number {
  return RANK[r];
}

/** node-access's panel role in the four-role vocabulary (the Space Owner rung is Full). */
export function parityRoleOf(role: string | null | undefined): ParityRole {
  switch (role) {
    case "OWNER":
    case "FULL":
      return "FULL";
    case "EDIT":
      return "EDIT";
    case "ASSIGNED":
    case "COMMENT":
      return "COMMENT";
    case "VIEW":
      return "VIEW";
    default:
      return "none";
  }
}

const tablesOff = (f: FlagState) => !f.tables;
const always = () => true;

export const NODE_EXPECTED_MISMATCHES: readonly NodeExpectation[] = [
  {
    key: "tables-off-engine-reads-old-tables",
    reason:
      "With ACCESS_V2_TABLES off the engine's loader reads only SpaceMember, FolderMember, BoardMember and the visibility columns (facts.ts). node-access also reads the AccessGrant rows (Tables, Canvases, Forms), the docSharing store, the Private rule, the legacy floor, lifts, pierces and path containers. Those answers are node-access's and stay live; the helpers do not delegate to the engine for node objects while the flag is off (flags.ts delegateOn('node')). This row must match nothing with the flag on.",
    when: tablesOff,
    match: (c) => c.section === "node",
  },
  {
    key: "agent-cap-clamps-full-to-edit",
    reason:
      "Rule 12 (spec 2.4): an Agent never holds Full access, it is capped at Can edit. node-access has no Agent cap on containers. Intended: the engine is the stricter answer.",
    when: always,
    match: (c) => c.viewer.agent && c.truth === "FULL" && c.engine === "EDIT",
  },
  {
    key: "archived-object-reads-view-only",
    reason:
      "Rule 13 (spec 5.4): an archived object is read-only, so the engine caps its role at Can view; node-access keeps the holder's role and the routes refuse the write on archivedAt. Same outcome for a write, a lower number in the report.",
    when: always,
    match: (c) => c.facts?.archived === true && parityRank(c.engine) < parityRank(c.truth) && c.engine !== "none",
  },
  {
    key: "inactive-person-has-no-session",
    reason:
      "A deactivated (INACTIVE) person is refused by rule 1 in the engine and by node-access (nodeCtxForUser denies them). item-gate does not re-read the status because it never meets one: auth.ts revokes an INACTIVE account's session at the next check, so no route reaches gateItem for them. The engine's answer (none) is what every route gives them.",
    when: always,
    match: (c) => c.viewer.status === "INACTIVE" && c.engine === "none",
  },
  {
    key: "task-assignee-rule-9",
    reason:
      "Rule 9: an assignee of a task holds Can edit on that task even without a role on its List; item-gate.ts gives the same row through decideItem. Where the two assignee answers differ in rung (the engine's EDIT against item-gate's own table) the item-gate answer stays live on every item route.",
    when: always,
    match: (c) => c.kind === "item" && c.facts?.assignee === true,
  },
  {
    key: "task-creator-rule-5",
    reason:
      "Rule 5 on tasks: item-gate reads the creator from the CREATED activity row and gives them Full access; the engine's item facts carry no creator (Item.ownerId is the DRI, not the creator). item-gate stays live on every item route.",
    when: always,
    match: (c) => c.kind === "item" && c.facts?.creator === true,
  },
  {
    key: "task-linked-list-reader",
    reason:
      "Phase 5b: a reader of a List a task is linked into may view the task (item-gate viaLinkedList). The engine does not model multi-List tasks yet; item-gate stays live.",
    when: always,
    match: (c) => c.kind === "item" && c.facts?.linkedList === true,
  },
];

/**
 * SOP folders. sop-access.ts is live: an org admin is Full, a grant on the
 * folder or any ancestor gives its role, nothing else holds a role on the
 * folder (unfiled SOPs are not folders).
 */
export const SOP_FOLDER_EXPECTED_MISMATCHES: readonly NodeExpectation[] = [
  {
    key: "sop-folder-everyone-view-of-published",
    reason:
      "Spec 9 sops.view: the engine gives every Member Can view on a SOP folder's published SOPs through the EVERYONE grant the backfill writes; sop-access.ts today shows a folder's SOPs only to its grantees (an unfiled published SOP is everyone's). The engine is wider here, so sop-access stays live for SOPs until the SOP folder grants are migrated (access step 7 covers containers and goals, not SOP folders).",
    when: always,
    match: (c) => c.section === "sop_folder" && c.truth === "none" && c.engine === "VIEW",
  },
];

/** Goals: canSeeGoal is live for every goal read. */
export const GOAL_EXPECTED_MISMATCHES: readonly NodeExpectation[] = [
  {
    key: "goal-canseegoal-wider-than-engine",
    reason:
      "canSeeGoal is wider than the engine's goal branch in three places: the legacy manager tier sees every unowned goal, a DEPARTMENT-level goal is visible to its department by the old departmentId match, and a person with reports sees their reports' goals through the team list. The engine reads the audience rows and the report tree only. Goals are NOT delegated in this stage (no helper answers a goal through can()), so canSeeGoal stays the answer; these rows are the list to decide before goals move.",
    when: always,
    match: (c) => c.section === "goal" && c.truth === "VIEW" && c.engine === "none",
  },
  {
    key: "goal-people-team-org-wide",
    reason:
      "Spec 9 okrs.view: the People team and Admins read every goal org-wide in the engine; canSeeGoal gives org-wide reach through isOrgWideAlignment, which the People team does not always hold. canSeeGoal stays live for goals.",
    when: always,
    match: (c) => c.section === "goal" && c.truth === "none" && c.engine === "VIEW" && c.viewer.peopleTeam,
  },
];

/**
 * The Workspace settings door. Today: admin pages for SUPER_ADMIN and
 * COMPANY_ADMIN, the manager tier on Members, Access and Scoring. The engine:
 * Owner and Admin on every page, the People team reads Members, Structure,
 * Access and Scoring, Billing, Security and API for Owners and scoped Admins.
 */
export const SETTINGS_EXPECTED_MISMATCHES: readonly NodeExpectation[] = [
  {
    key: "settings-manager-tier-narrows-to-people-team",
    reason:
      "Spec 6.6 and 10.1: Members, Access and Scoring close to the manager tier (C-level, VP, Director, Manager, Team lead) and stay open to the People team. Decided; the first week runs log-only (SETTINGS_GATE_LOG_ONLY).",
    when: always,
    match: (c) => c.section === "settings" && c.truth === "VIEW" && c.engine === "none" && !c.viewer.orgAdmin && !c.viewer.peopleTeam,
  },
  {
    key: "settings-people-team-reads-structure",
    reason:
      "Spec 6.6: the People team (HR and the configured list) reads Structure, which the legacy admin-only rule refused. Decided.",
    when: always,
    match: (c) => c.section === "settings" && c.kind === "structure" && c.truth === "none" && c.engine !== "none" && c.viewer.peopleTeam,
  },
  {
    key: "settings-people-team-configured-member",
    reason:
      "Spec 7.3 toggle 6: a person an Owner put on the People team reads Members, Access and Scoring even below the manager tier. Decided.",
    when: always,
    match: (c) => c.section === "settings" && c.truth === "none" && c.engine !== "none" && c.viewer.peopleTeam,
  },
  {
    key: "settings-owner-pages-need-owner-or-scope",
    reason:
      "Spec 6.6: Billing, Security and API open for an Owner or an Admin holding the billing or security scope. An Admin without the scope is refused by the engine; today every Admin opens them until SETTINGS_OWNER_SPLIT is approved and on.",
    when: always,
    match: (c) => c.section === "settings" && (c.kind === "billing" || c.kind === "security" || c.kind === "api") && c.truth === "VIEW" && c.engine === "none" && c.viewer.orgAdmin,
  },
];

/**
 * The permission matrix's live cells (matrix-rules.ts) against the stored
 * matrix. Every difference in a cell the table owns IS a spec section 9
 * decision (the cell becomes that gate rule when ACCESS_V2_RESOLVER is on);
 * the report's breakdown names each cell and level so the release note can
 * list who gains and who loses what.
 */
export const MATRIX_EXPECTED_MISMATCHES: readonly NodeExpectation[] = [
  {
    key: "matrix-cell-narrows-to-section-9-gate-rule",
    reason:
      "Spec 9: the enforced matrix cells become fixed gate rules (Owner and Admin, the People team, the manager chain, toggle 7 for publishing). Where the rule takes a cell away from someone who holds it today, that is the decided narrowing. With ACCESS_V2_RESOLVER on, hasPermission answers these cells from matrix-rules.ts; off, the stored matrix still decides.",
    when: always,
    match: (c) => c.section === "matrix" && c.truth === "VIEW" && c.engine === "none",
  },
  {
    key: "matrix-cell-widens-by-named-decision",
    reason:
      "Spec 9 names who GAINS a cell: the People team on KRA definitions, Policies, org announcements and Assets, and the People team or a person with reports on the assign cells (the route then checks the target person). Only these cells may widen; any other widening (a SOP content cell, an Owner and Admin cell against a customised grid) is UNEXPECTED and blocks the flip.",
    when: always,
    match: (c) => {
      if (c.section !== "matrix" || c.truth !== "none" || c.engine !== "VIEW") return false;
      const rule = DECIDED_MATRIX_WIDENINGS[c.kind];
      if (!rule) return false;
      if (rule === "people-team") return c.viewer.peopleTeam;
      return c.viewer.peopleTeam || c.viewer.hasReports;
    },
  },
];

/**
 * The cells spec 9 decides to open wider than today's shipped grid, and to
 * whom. A widening anywhere else is unexpected (see the row above).
 */
export const DECIDED_MATRIX_WIDENINGS: Readonly<Record<string, "people-team" | "people-team-or-reports">> = {
  "kras.create": "people-team",
  "kras.edit": "people-team",
  "kras.assign": "people-team-or-reports",
  "policies.create": "people-team",
  "announcements.create": "people-team",
  "assets.create": "people-team",
  "assets.edit": "people-team",
  "assets.assign": "people-team-or-reports",
};

export interface NodeParityReport {
  total: number;
  agreed: number;
  expectedByKey: Record<string, number>;
  unexpected: NodeParityCase[];
}

export function expectationsFor(section: NodeParitySection): readonly NodeExpectation[] {
  switch (section) {
    case "node":
      return NODE_EXPECTED_MISMATCHES;
    case "sop_folder":
      return SOP_FOLDER_EXPECTED_MISMATCHES;
    case "goal":
      return GOAL_EXPECTED_MISMATCHES;
    case "settings":
      return SETTINGS_EXPECTED_MISMATCHES;
    case "matrix":
      return MATRIX_EXPECTED_MISMATCHES;
  }
}

/** The key of the first expectation that explains this mismatch in this flag state, or null. */
export function classifyNodeMismatch(c: NodeParityCase, flags: FlagState): string | null {
  for (const e of expectationsFor(c.section)) {
    if (e.when(flags) && e.match(c)) return e.key;
  }
  return null;
}

export function runNodeParity(cases: readonly NodeParityCase[], flags: FlagState): NodeParityReport {
  const expectedByKey: Record<string, number> = {};
  const unexpected: NodeParityCase[] = [];
  let agreed = 0;
  for (const c of cases) {
    if (c.truth === c.engine) {
      agreed++;
      continue;
    }
    const key = classifyNodeMismatch(c, flags);
    if (key) expectedByKey[key] = (expectedByKey[key] ?? 0) + 1;
    else unexpected.push(c);
  }
  return { total: cases.length, agreed, expectedByKey, unexpected };
}
